/**
 * AURIC VOW — perf/staticBatch.ts
 *
 * Static batching for the level: meshes that share a material and never move
 * are baked into one world-space geometry per spatial cell, so a wall of
 * forty trim boxes is one draw call instead of forty — in the main view and
 * in every shadow map.
 *
 * Lossless by construction, not by tuning:
 *  - Same material OBJECT, so the same shader program, uniforms and textures.
 *  - Positions and normals are baked with the object's own world matrix and
 *    normal matrix, exactly what the vertex shader would have applied. The
 *    only shader patches allowed through read world position through
 *    `modelMatrix` (the world-surface projection, the height fog), so they see
 *    the same world coordinates. Any other patched or custom shader is left
 *    alone, since it might read object-space position.
 *  - Mirrored transforms keep their winding: a negative-determinant batch is
 *    baked through a flip and carries the flip in its own matrix, so three.js
 *    still switches the front face for it.
 *  - Transparent and transmissive surfaces are never merged; their per-object
 *    depth sort is part of how they look.
 *  - Sources are hidden with a render layer, never `visible`, and every
 *    source and every ancestor is watched each frame. The moment anything
 *    about one changes — transform, visibility, parent, material, shadow
 *    flags — its batch is dissolved and the originals come back, in the same
 *    frame, before anything is drawn.
 */
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

export const BATCH_CELL = 36

interface Watched {
  node: THREE.Object3D
  parent: THREE.Object3D | null
  snap: number[]
  visible: boolean
  // sources only
  material?: THREE.Material | THREE.Material[]
  geometry?: THREE.BufferGeometry
  cast?: boolean
  receive?: boolean
  batches: Set<Batch>
}

export interface Batch {
  mesh: THREE.Mesh
  sources: THREE.Mesh[]
  dead: boolean
}

const _S = new THREE.Matrix4().makeScale(-1, 1, 1)
const _M = new THREE.Matrix4()
const _sph = new THREE.Sphere()

function snapOf(o: THREE.Object3D): number[] {
  const p = o.position, q = o.quaternion, s = o.scale
  return [p.x, p.y, p.z, q.x, q.y, q.z, q.w, s.x, s.y, s.z]
}

function sameSnap(o: THREE.Object3D, a: number[]): boolean {
  const p = o.position, q = o.quaternion, s = o.scale
  return (
    p.x === a[0] && p.y === a[1] && p.z === a[2] &&
    q.x === a[3] && q.y === a[4] && q.z === a[5] && q.w === a[6] &&
    s.x === a[7] && s.y === a[8] && s.z === a[9]
  )
}

/** the material's shader either is stock or only reads world position through modelMatrix */
function worldSafeMaterial(m: THREE.Material): boolean {
  if ((m as THREE.ShaderMaterial).isShaderMaterial) return false
  if (m.transparent || m.blending !== THREE.NormalBlending) return false
  const phys = m as THREE.MeshPhysicalMaterial
  if (phys.isMeshPhysicalMaterial && (phys.transmission > 0)) return false
  const patched = m.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile
  if (patched && !m.userData.avSurfaceOpts) return false
  return true
}

function attrSignature(g: THREE.BufferGeometry): string | null {
  if (Object.keys(g.morphAttributes).length) return null
  if (g.drawRange.start !== 0 || g.drawRange.count !== Infinity) return null
  const parts: string[] = []
  for (const name of Object.keys(g.attributes).sort()) {
    const a = g.attributes[name] as THREE.BufferAttribute
    if ((a as unknown as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute) return null
    if ((a as unknown as THREE.InstancedBufferAttribute).isInstancedBufferAttribute) return null
    parts.push(`${name}:${a.itemSize}:${a.normalized ? 1 : 0}:${a.array.constructor.name}`)
  }
  if (!g.attributes.position) return null
  return `${g.index ? 'i' : 'n'}|${parts.join(',')}`
}

function effectivelyVisibleTo(o: THREE.Object3D, root: THREE.Object3D): boolean {
  let n: THREE.Object3D | null = o
  while (n) {
    if (!n.visible) return false
    if (n === root) return true
    n = n.parent
  }
  return false
}

export class StaticBatcher {
  batches: Batch[] = []
  private watched = new Map<THREE.Object3D, Watched>()
  sourcesBatched = 0
  reverts = 0

  private root: THREE.Object3D
  private hide: (o: THREE.Object3D) => void
  private restore: (o: THREE.Object3D) => void

  constructor(
    root: THREE.Object3D,
    hide: (o: THREE.Object3D) => void,
    restore: (o: THREE.Object3D) => void,
  ) {
    this.root = root
    this.hide = hide
    this.restore = restore
  }

  /** find candidates, merge them, hide the originals */
  build(camLayers: THREE.Layers) {
    const root = this.root
    root.updateMatrixWorld(true)
    const groups = new Map<string, THREE.Mesh[]>()
    root.traverse((o) => {
      const m = o as THREE.Mesh
      if (!m.isMesh) return
      if ((m as THREE.InstancedMesh).isInstancedMesh || (m as THREE.SkinnedMesh).isSkinnedMesh) return
      if (m.userData.__perfChunkOf || m.userData.__perfBatch) return
      if (m.userData.__perfLayerSaved !== undefined) return
      if (!m.frustumCulled || !m.layers.test(camLayers)) return
      if (m.onBeforeRender !== THREE.Object3D.prototype.onBeforeRender) return
      if (m.onAfterRender !== THREE.Object3D.prototype.onAfterRender) return
      if (Array.isArray(m.material) || !m.material || !worldSafeMaterial(m.material)) return
      if (!effectivelyVisibleTo(m, root)) return
      const sig = attrSignature(m.geometry)
      if (!sig) return
      if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere()
      _sph.copy(m.geometry.boundingSphere!).applyMatrix4(m.matrixWorld)
      const cell = `${Math.floor(_sph.center.x / BATCH_CELL)},${Math.floor(_sph.center.z / BATCH_CELL)}`
      const det = m.matrixWorld.determinant()
      if (!Number.isFinite(det) || det === 0) return
      const key = [
        m.material.uuid,
        m.castShadow ? 1 : 0,
        m.receiveShadow ? 1 : 0,
        m.layers.mask,
        m.renderOrder,
        det < 0 ? '-' : '+',
        m.customDepthMaterial?.uuid ?? '',
        m.customDistanceMaterial?.uuid ?? '',
        sig,
        cell,
      ].join('|')
      let list = groups.get(key)
      if (!list) groups.set(key, (list = []))
      list.push(m)
    })

    for (const list of groups.values()) {
      if (list.length < 2) continue
      const first = list[0]
      const mirrored = first.matrixWorld.determinant() < 0
      const baked: THREE.BufferGeometry[] = []
      for (const m of list) {
        const g = m.geometry.clone()
        g.clearGroups()
        _M.copy(m.matrixWorld)
        if (mirrored) _M.premultiply(_S)
        g.applyMatrix4(_M)
        baked.push(g)
      }
      const merged = mergeGeometries(baked, false)
      for (const g of baked) g.dispose()
      if (!merged) continue
      merged.computeBoundingBox()
      merged.computeBoundingSphere()

      const mesh = new THREE.Mesh(merged, first.material)
      mesh.name = `batch:${first.name || (first.material as THREE.Material).name || 'mesh'}`
      if (mirrored) mesh.scale.set(-1, 1, 1)
      mesh.updateMatrix()
      mesh.matrixAutoUpdate = false
      mesh.castShadow = first.castShadow
      mesh.receiveShadow = first.receiveShadow
      mesh.layers.mask = first.layers.mask
      mesh.renderOrder = first.renderOrder
      mesh.customDepthMaterial = first.customDepthMaterial
      mesh.customDistanceMaterial = first.customDistanceMaterial
      // flags are copied from the sources; the shadow sweep must not re-decide them
      mesh.userData = { __perfBatch: true, auricNoShadow: true }
      // root's own transform is baked into matrixWorld, so hang it off the scene
      let top: THREE.Object3D = root
      while (top.parent) top = top.parent
      top.add(mesh)

      const batch: Batch = { mesh, sources: list, dead: false }
      this.batches.push(batch)
      for (const m of list) {
        this.hide(m)
        // a hidden leaf never needs its world matrix again unless it moves,
        // and moving dissolves the batch first — skip it in the scene update
        if (m.children.length === 0) {
          m.userData.__perfMatrixAuto = m.matrixAutoUpdate
          m.matrixAutoUpdate = false
          m.matrixWorldAutoUpdate = false
        }
        this.watch(m, batch, true)
        for (let a = m.parent; a; a = a.parent) {
          this.watch(a, batch, false)
          if (a === root) break
        }
      }
      this.sourcesBatched += list.length
    }
  }

  private watch(node: THREE.Object3D, batch: Batch, isSource: boolean) {
    let w = this.watched.get(node)
    if (!w) {
      w = { node, parent: node.parent, snap: snapOf(node), visible: node.visible, batches: new Set() }
      if (isSource) {
        const m = node as THREE.Mesh
        w.material = m.material
        w.geometry = m.geometry
        w.cast = m.castShadow
        w.receive = m.receiveShadow
      }
      this.watched.set(node, w)
    }
    w.batches.add(batch)
  }

  /** every frame, before drawing: dissolve any batch whose sources changed */
  check() {
    let broken: Set<Batch> | null = null
    for (const w of this.watched.values()) {
      const n = w.node
      let changed = n.parent !== w.parent || n.visible !== w.visible || !sameSnap(n, w.snap)
      if (!changed && w.geometry) {
        const m = n as THREE.Mesh
        changed =
          m.material !== w.material ||
          m.geometry !== w.geometry ||
          m.castShadow !== w.cast ||
          m.receiveShadow !== w.receive
      }
      if (changed) {
        if (!broken) broken = new Set()
        for (const b of w.batches) broken.add(b)
      }
    }
    if (broken) {
      for (const b of broken) this.dissolve(b)
      this.batches = this.batches.filter((b) => !b.dead)
      this.rewatch()
    }
  }

  private dissolve(b: Batch) {
    if (b.dead) return
    b.dead = true
    b.mesh.removeFromParent()
    b.mesh.geometry.dispose()
    for (const m of b.sources) {
      this.restore(m)
      if (m.userData.__perfMatrixAuto !== undefined) {
        m.matrixAutoUpdate = m.userData.__perfMatrixAuto
        delete m.userData.__perfMatrixAuto
        m.matrixWorldAutoUpdate = true
        if (m.matrixAutoUpdate) m.updateMatrix()
        m.matrixWorldNeedsUpdate = true
      }
    }
    this.reverts++
  }

  private rewatch() {
    for (const w of this.watched.values()) {
      for (const b of w.batches) if (b.dead) w.batches.delete(b)
      if (!w.batches.size) this.watched.delete(w.node)
    }
  }

  dispose() {
    for (const b of this.batches) this.dissolve(b)
    this.batches = []
    this.watched.clear()
  }
}

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
  instVersion?: number
  instCount?: number
  batches: Set<Batch>
}

export interface Batch {
  mesh: THREE.Mesh
  sources: THREE.Mesh[]
  dead: boolean
}

const _S = new THREE.Matrix4().makeScale(-1, 1, 1)
const _I = new THREE.Matrix4()
const _W = new THREE.Matrix4()

/** an instanced source is baked only if this many triangles or fewer */
const INSTANCED_BAKE_MAX_TRIS = 60000

interface Item {
  mesh: THREE.Mesh
  world: THREE.Matrix4
  /** the source object's own winding (see build) */
  mirrored: boolean
}
const _M = new THREE.Matrix4()
const _sph = new THREE.Sphere()

const _N3 = new THREE.Matrix3()
const _T = new THREE.Vector3()

/**
 * Bake a transform into a geometry the way the vertex shader would have
 * applied it: positions by M, normals by M's normal matrix and tangents by
 * M's upper 3x3 — WITHOUT renormalising. The shader normalises only after
 * interpolation, so renormalising per vertex (as BufferGeometry.applyMatrix4
 * does) would shift the interpolated normal wherever M is non-uniform.
 */
export function bakeTransform(g: THREE.BufferGeometry, M: THREE.Matrix4) {
  g.attributes.position.applyMatrix4(M)
  const n = g.attributes.normal as THREE.BufferAttribute | undefined
  if (n) n.applyMatrix3(_N3.getNormalMatrix(M))
  const t = g.attributes.tangent as THREE.BufferAttribute | undefined
  if (t) {
    for (let i = 0; i < t.count; i++) {
      const x = t.getX(i), y = t.getY(i), z = t.getZ(i)
      const e = M.elements
      _T.set(e[0] * x + e[4] * y + e[8] * z, e[1] * x + e[5] * y + e[9] * z, e[2] * x + e[6] * y + e[10] * z)
      t.setXYZ(i, _T.x, _T.y, _T.z)
    }
  }
  for (const k in g.attributes) g.attributes[k].needsUpdate = true
}

const _axisAligned = new WeakMap<THREE.BufferGeometry, boolean>()

function normalsAxisAligned(g: THREE.BufferGeometry): boolean {
  const cached = _axisAligned.get(g)
  if (cached !== undefined) return cached
  const n = g.attributes.normal as THREE.BufferAttribute | undefined
  let ok = true
  if (n) {
    for (let i = 0; i < n.count && ok; i++) {
      const nz =
        (Math.abs(n.getX(i)) > 1e-4 ? 1 : 0) +
        (Math.abs(n.getY(i)) > 1e-4 ? 1 : 0) +
        (Math.abs(n.getZ(i)) > 1e-4 ? 1 : 0)
      if (nz > 1) ok = false
    }
  }
  _axisAligned.set(g, ok)
  return ok
}

function uniformScale(M: THREE.Matrix4): boolean {
  const e = M.elements
  const a = Math.hypot(e[0], e[1], e[2])
  const b = Math.hypot(e[4], e[5], e[6])
  const c = Math.hypot(e[8], e[9], e[10])
  const lo = Math.min(a, b, c)
  return lo > 0 && Math.max(a, b, c) / lo < 1 + 1e-4
}

/**
 * The world-surface patch derives its projection normal as
 * normalize(mat3(modelMatrix) * normal), while three's lighting uses the
 * true normal matrix. The two only agree under a uniform scale or on normals
 * that lie along a local axis. A baked mesh has an identity model matrix, so
 * it can match one of them, not both: pieces where they disagree stay as
 * they are, or the texture projection would change on them.
 */
export function bakeKeepsSurface(mat: THREE.Material, g: THREE.BufferGeometry, M: THREE.Matrix4): boolean {
  if (!mat.userData.avSurfaceOpts) return true
  return uniformScale(M) || normalsAxisAligned(g)
}

export function snapOf(o: THREE.Object3D): number[] {
  const p = o.position, q = o.quaternion, s = o.scale
  return [p.x, p.y, p.z, q.x, q.y, q.z, q.w, s.x, s.y, s.z]
}

export function sameSnap(o: THREE.Object3D, a: number[]): boolean {
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

export function attrSignature(g: THREE.BufferGeometry): string | null {
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
  private batchesOf = new Map<THREE.Mesh, Set<Batch>>()
  private watched = new Map<THREE.Object3D, Watched>()
  sourcesBatched = 0
  reverts = 0
  /** why candidates were turned away (QA) */
  rejects: Record<string, number> = {}

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

  /**
   * Find candidates, merge them, hide the originals. `staticInstanced` names
   * the InstancedMeshes that were observed not to change: those are baked
   * too, instance by instance, each instance landing in its own cell.
   */
  build(camLayers: THREE.Layers, staticInstanced: Set<THREE.InstancedMesh> = new Set()) {
    const root = this.root
    root.updateMatrixWorld(true)
    const groups = new Map<string, Item[]>()
    const failedSources = new Set<THREE.Mesh>()
    const rej = (why: string) => {
      this.rejects[why] = (this.rejects[why] || 0) + 1
    }
    const add = (m: THREE.Mesh, world: THREE.Matrix4, sig: string) => {
      const g = m.geometry
      if (!g.boundingSphere) g.computeBoundingSphere()
      _sph.copy(g.boundingSphere!).applyMatrix4(world)
      const det = world.determinant()
      if (!Number.isFinite(det) || det === 0) return rej('det')
      if (!bakeKeepsSurface(m.material as THREE.Material, g, world)) {
        // an instanced source must go whole or not at all
        failedSources.add(m)
        return rej('surfaceSkew')
      }
      // three picks the front face from the OBJECT's matrixWorld alone, never
      // from an instance matrix, so a mirrored instance of an unmirrored
      // InstancedMesh is drawn with the object's winding. The bake keeps
      // exactly that rule.
      const mirrored = m.matrixWorld.determinant() < 0
      const cell = `${Math.floor(_sph.center.x / BATCH_CELL)},${Math.floor(_sph.center.z / BATCH_CELL)}`
      const mat = m.material as THREE.Material
      const key = [
        mat.uuid,
        m.castShadow ? 1 : 0,
        m.receiveShadow ? 1 : 0,
        m.layers.mask,
        m.renderOrder,
        mirrored ? '-' : '+',
        m.customDepthMaterial?.uuid ?? '',
        m.customDistanceMaterial?.uuid ?? '',
        sig,
        cell,
      ].join('|')
      let list = groups.get(key)
      if (!list) groups.set(key, (list = []))
      list.push({ mesh: m, world: world.clone(), mirrored })
    }

    root.traverse((o) => {
      const m = o as THREE.Mesh
      if (!m.isMesh) return
      const inst = m as THREE.InstancedMesh
      if ((m as THREE.SkinnedMesh).isSkinnedMesh) return rej('skinned')
      if (m.userData.__perfChunkOf || m.userData.__perfBatch) return
      if (m.userData.__perfLayerSaved !== undefined) return rej('hidden')
      if (inst.isInstancedMesh) {
        if (!staticInstanced.has(inst)) return rej('instancedAnimated')
        if (inst.instanceColor || inst.morphTexture) return rej('instancedColor')
      }
      if (!m.frustumCulled) return rej('noCull')
      if (!m.layers.test(camLayers)) return rej('layer')
      if (m.onBeforeRender !== THREE.Object3D.prototype.onBeforeRender) return rej('onBeforeRender')
      if (m.onAfterRender !== THREE.Object3D.prototype.onAfterRender) return rej('onAfterRender')
      if (Array.isArray(m.material) || !m.material) return rej('multiMat')
      if (!worldSafeMaterial(m.material)) {
        const mm = m.material
        return rej(
          mm.transparent || mm.blending !== THREE.NormalBlending
            ? 'transparent'
            : (mm as THREE.ShaderMaterial).isShaderMaterial
              ? 'shaderMat'
              : 'patchedMat',
        )
      }
      if (!effectivelyVisibleTo(m, root)) return rej('invisible')
      const sig = attrSignature(m.geometry)
      if (!sig) return rej('attrs')
      if (inst.isInstancedMesh) {
        const g = m.geometry
        const triPer = (g.index ? g.index.count : g.attributes.position.count) / 3
        if (triPer * inst.count > INSTANCED_BAKE_MAX_TRIS) return rej('instancedHeavy')
        for (let i = 0; i < inst.count; i++) {
          inst.getMatrixAt(i, _I)
          add(m, _W.multiplyMatrices(m.matrixWorld, _I), sig)
        }
        return
      }
      add(m, m.matrixWorld, sig)
    })

    for (const list of groups.values()) {
      // a lone plain mesh gains nothing; a lone instance still has to be
      // baked, or its InstancedMesh could not be retired
      if (list.length < 2 && !(list[0].mesh as THREE.InstancedMesh).isInstancedMesh) {
        rej('singleton')
        continue
      }
      const first = list[0].mesh
      const mirrored = list[0].mirrored
      const baked: THREE.BufferGeometry[] = []
      for (const it of list) {
        const g = it.mesh.geometry.clone()
        g.clearGroups()
        _M.copy(it.world)
        if (mirrored) _M.premultiply(_S)
        bakeTransform(g, _M)
        baked.push(g)
      }
      const merged = mergeGeometries(baked, false)
      for (const g of baked) g.dispose()
      if (!merged) {
        rej('mergeFailed')
        for (const it of list) failedSources.add(it.mesh)
        continue
      }
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
      // world transforms are baked in, so hang it off the scene itself
      let top: THREE.Object3D = root
      while (top.parent) top = top.parent
      top.add(mesh)

      const sources = [...new Set(list.map((it) => it.mesh))]
      const batch: Batch = { mesh, sources, dead: false }
      this.batches.push(batch)
      for (const m of sources) {
        let bs = this.batchesOf.get(m)
        if (!bs) this.batchesOf.set(m, (bs = new Set()))
        bs.add(batch)
      }
    }

    // a source whose bake failed or was refused anywhere keeps drawing itself
    const failed = new Set<Batch>()
    for (const m of failedSources) for (const b of this.batchesOf.get(m) ?? []) failed.add(b)
    for (const b of failed) this.dissolve(b)
    this.batches = this.batches.filter((b) => !b.dead)

    for (const b of this.batches) {
      for (const m of b.sources) {
        if (m.userData.__perfLayerSaved === undefined) {
          this.hide(m)
          // a hidden leaf never needs its world matrix again unless it moves,
          // and moving dissolves the batch first — skip it in the scene update
          if (m.children.length === 0) {
            m.userData.__perfMatrixAuto = m.matrixAutoUpdate
            m.matrixAutoUpdate = false
            m.matrixWorldAutoUpdate = false
          }
          this.sourcesBatched++
        }
        this.watch(m, b, true)
        for (let a = m.parent; a; a = a.parent) {
          this.watch(a, b, false)
          if (a === root) break
        }
      }
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
        const im = m as THREE.InstancedMesh
        if (im.isInstancedMesh) {
          w.instVersion = im.instanceMatrix.version
          w.instCount = im.count
        }
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
        if (!changed && w.instVersion !== undefined) {
          const im = m as THREE.InstancedMesh
          changed =
            im.instanceMatrix.version !== w.instVersion ||
            im.count !== w.instCount ||
            !!im.instanceColor
        }
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
      // a restored source draws in full, so every other batch holding a
      // piece of it has to go too
      const others = this.batchesOf.get(m)
      if (others) {
        this.batchesOf.delete(m)
        for (const o of others) if (o !== b) this.dissolve(o)
      }
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
    this.batchesOf.clear()
  }
}

/**
 * AURIC VOW — perf/localBatch.ts
 *
 * Local batching for articulated models. The player frame is ~300 small
 * meshes hung off a few dozen joints; every one is a draw call in the main
 * view and in each shadow map, although relative to its joint none of them
 * ever moves. Sibling meshes under one parent that share a material are
 * merged into one mesh in that parent's space and parented to it, so the
 * merged mesh follows the joint exactly as its pieces did.
 *
 * Why the picture cannot change:
 *  - same material object, so the same program and uniforms;
 *  - vertices are baked through each piece's own local matrix (and normals
 *    through its normal matrix), and inverse-transpose is multiplicative, so
 *    world positions and normals come out as before;
 *  - only stock shaders, the world-surface patch (world position through
 *    modelMatrix) and view-space patches (flagged `viewSafePatch`) qualify —
 *    anything that reads object-space position, like the enemy death
 *    dissolve, is left alone;
 *  - transparent materials are excluded, since merging would change the order
 *    their pieces are sorted and drawn in; a material that turns transparent
 *    later (the player's near-camera fade) dissolves its batches at once;
 *  - a piece that moves, hides, re-parents or swaps material dissolves its
 *    batch in the same frame, before anything is drawn.
 *
 * Pieces must hold still across two scans before they are merged, and scans
 * repeat, so models that appear later (and pieces that stop moving) are
 * picked up too.
 */
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { attrSignature, bakeKeepsSurface, bakeTransform, sameSnap, snapOf } from './staticBatch'

const _S = new THREE.Matrix4().makeScale(-1, 1, 1)
const _M = new THREE.Matrix4()

interface LocalBatch {
  mesh: THREE.Mesh
  sources: THREE.Mesh[]
  dead: boolean
}

interface Piece {
  snap: number[]
  parent: THREE.Object3D | null
  visible: boolean
  material: THREE.Material
  transparent: boolean
  geometry: THREE.BufferGeometry
  cast: boolean
  receive: boolean
  batch: LocalBatch | null
}

function localSafeMaterial(m: THREE.Material): boolean {
  if ((m as THREE.ShaderMaterial).isShaderMaterial) return false
  if (m.transparent || m.blending !== THREE.NormalBlending) return false
  const phys = m as THREE.MeshPhysicalMaterial
  if (phys.isMeshPhysicalMaterial && phys.transmission > 0) return false
  const patched = m.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile
  if (patched && !m.userData.avSurfaceOpts && !m.userData.viewSafePatch) return false
  return true
}

export class LocalBatcher {
  batches: LocalBatch[] = []
  sourcesBatched = 0
  reverts = 0
  private pieces = new Map<THREE.Mesh, Piece>()
  private scene: THREE.Scene
  private exclude: (o: THREE.Object3D) => boolean
  private hide: (o: THREE.Object3D) => void
  private restore: (o: THREE.Object3D) => void

  constructor(
    scene: THREE.Scene,
    exclude: (o: THREE.Object3D) => boolean,
    hide: (o: THREE.Object3D) => void,
    restore: (o: THREE.Object3D) => void,
  ) {
    this.scene = scene
    this.exclude = exclude
    this.hide = hide
    this.restore = restore
  }

  private eligible(m: THREE.Mesh): boolean {
    if (!m.isMesh || m.children.length) return false
    if ((m as THREE.InstancedMesh).isInstancedMesh || (m as THREE.SkinnedMesh).isSkinnedMesh) return false
    if ((m as unknown as { isBatchedMesh?: boolean }).isBatchedMesh) return false
    if (m.userData.__perfBatch || m.userData.__perfChunkOf) return false
    if (m.userData.__perfLayerSaved !== undefined) return false
    if (!m.parent || !m.visible) return false
    if (m.onBeforeRender !== THREE.Object3D.prototype.onBeforeRender) return false
    if (m.onAfterRender !== THREE.Object3D.prototype.onAfterRender) return false
    if (Array.isArray(m.material) || !m.material || !localSafeMaterial(m.material)) return false
    return attrSignature(m.geometry) !== null
  }

  /** periodic: observe pieces, and merge the ones that held still since last time */
  scan(camLayers: THREE.Layers) {
    const ready = new Map<string, THREE.Mesh[]>()
    const seen = new Set<THREE.Mesh>()
    const walk = (o: THREE.Object3D) => {
      if (this.exclude(o)) return
      const m = o as THREE.Mesh
      if (m.isMesh && this.eligible(m) && m.layers.test(camLayers)) {
        seen.add(m)
        const p = this.pieces.get(m)
        const mat = m.material as THREE.Material
        if (
          p &&
          !p.batch &&
          p.parent === m.parent &&
          p.material === mat &&
          p.geometry === m.geometry &&
          sameSnap(m, p.snap)
        ) {
          if (m.matrixAutoUpdate) m.updateMatrix()
          const det = m.matrix.determinant()
          if (Number.isFinite(det) && det !== 0 && bakeKeepsSurface(mat, m.geometry, m.matrix)) {
            const key = [
              m.parent!.uuid,
              mat.uuid,
              m.castShadow ? 1 : 0,
              m.receiveShadow ? 1 : 0,
              m.layers.mask,
              m.renderOrder,
              m.frustumCulled ? 1 : 0,
              det < 0 ? '-' : '+',
              m.customDepthMaterial?.uuid ?? '',
              m.customDistanceMaterial?.uuid ?? '',
              attrSignature(m.geometry),
            ].join('|')
            let l = ready.get(key)
            if (!l) ready.set(key, (l = []))
            l.push(m)
          }
        } else if (!p || !p.batch) {
          this.pieces.set(m, {
            snap: snapOf(m),
            parent: m.parent,
            visible: m.visible,
            material: mat,
            transparent: mat.transparent,
            geometry: m.geometry,
            cast: m.castShadow,
            receive: m.receiveShadow,
            batch: null,
          })
        }
      }
      for (const c of o.children) walk(c)
    }
    walk(this.scene)
    // forget unbatched pieces that are gone
    for (const [m, p] of this.pieces) if (!p.batch && !seen.has(m)) this.pieces.delete(m)

    for (const list of ready.values()) {
      if (list.length < 2) continue
      this.merge(list)
    }
  }

  private merge(list: THREE.Mesh[]) {
    const first = list[0]
    const parent = first.parent!
    const mirrored = first.matrix.determinant() < 0
    const baked: THREE.BufferGeometry[] = []
    for (const m of list) {
      const g = m.geometry.clone()
      g.clearGroups()
      _M.copy(m.matrix)
      if (mirrored) _M.premultiply(_S)
      bakeTransform(g, _M)
      baked.push(g)
    }
    const merged = mergeGeometries(baked, false)
    for (const g of baked) g.dispose()
    if (!merged) return
    merged.computeBoundingBox()
    merged.computeBoundingSphere()

    const mesh = new THREE.Mesh(merged, first.material)
    mesh.name = `lbatch:${first.name || parent.name || 'part'}`
    if (mirrored) mesh.scale.set(-1, 1, 1)
    mesh.castShadow = first.castShadow
    mesh.receiveShadow = first.receiveShadow
    mesh.layers.mask = first.layers.mask
    mesh.renderOrder = first.renderOrder
    mesh.frustumCulled = first.frustumCulled
    mesh.customDepthMaterial = first.customDepthMaterial
    mesh.customDistanceMaterial = first.customDistanceMaterial
    mesh.userData = { __perfBatch: true, auricNoShadow: true }
    parent.add(mesh)

    const batch: LocalBatch = { mesh, sources: list, dead: false }
    this.batches.push(batch)
    for (const m of list) {
      const mat = m.material as THREE.Material
      this.pieces.set(m, {
        snap: snapOf(m),
        parent: m.parent,
        visible: m.visible,
        material: mat,
        transparent: mat.transparent,
        geometry: m.geometry,
        cast: m.castShadow,
        receive: m.receiveShadow,
        batch,
      })
      this.hide(m)
      m.userData.__perfMatrixAuto = m.matrixAutoUpdate
      m.matrixAutoUpdate = false
      m.matrixWorldAutoUpdate = false
      this.sourcesBatched++
    }
  }

  /** every frame, before drawing */
  check() {
    let broken: LocalBatch[] | null = null
    for (const b of this.batches) {
      if (b.dead) continue
      for (const m of b.sources) {
        const p = this.pieces.get(m)!
        const mat = m.material as THREE.Material
        if (
          m.parent !== p.parent ||
          m.visible !== p.visible ||
          mat !== p.material ||
          mat.transparent !== p.transparent ||
          m.geometry !== p.geometry ||
          m.castShadow !== p.cast ||
          m.receiveShadow !== p.receive ||
          !sameSnap(m, p.snap)
        ) {
          ;(broken ??= []).push(b)
          break
        }
      }
    }
    if (broken) {
      for (const b of broken) this.dissolve(b)
      this.batches = this.batches.filter((b) => !b.dead)
    }
  }

  private dissolve(b: LocalBatch) {
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
      // start observing afresh
      this.pieces.delete(m)
    }
    this.reverts++
  }

  dispose() {
    for (const b of this.batches) this.dissolve(b)
    this.batches = []
    this.pieces.clear()
  }
}

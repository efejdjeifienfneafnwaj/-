/**
 * AURIC VOW — world/Colliders.ts
 * Static collider registry for the kinematic character controller.
 * Internals: uniform 3D spatial hash (8 m cells) over the Box3 list so
 * raycasts / capsule queries only test nearby colliders.
 * PUBLIC API UNCHANGED: registerCollider / unregisterCollider /
 * clearColliders / getColliders / raycastLevel / collideCapsule.
 *
 * Tags (string, free-form) — conventional values:
 *   'floor' | 'wall' | 'wallrun' | 'platform' | 'objective' | 'extract-pad'
 */
import * as THREE from 'three'

export interface Collider {
  id: number
  box: THREE.Box3
  tags: string[]
}

export interface RaycastHit {
  collider: Collider
  /** distance along the ray */
  distance: number
  point: THREE.Vector3
  normal: THREE.Vector3
}

export interface CapsuleHit {
  collider: Collider
  /** minimum translation vector to push the capsule out of the box */
  mtv: THREE.Vector3
}

let nextId = 0
const colliders: Collider[] = []

// ---------------------------------------------------------------------------
// Spatial hash internals
// ---------------------------------------------------------------------------
const CELL = 8 // meters
const grid = new Map<string, Set<Collider>>()
const cellKeysById = new Map<number, string[]>()

function keyOf(ix: number, iy: number, iz: number): string {
  return ix + '|' + iy + '|' + iz
}

function keysForBox(box: THREE.Box3, out: string[]): string[] {
  out.length = 0
  const x0 = Math.floor(box.min.x / CELL)
  const x1 = Math.floor(box.max.x / CELL)
  const y0 = Math.floor(box.min.y / CELL)
  const y1 = Math.floor(box.max.y / CELL)
  const z0 = Math.floor(box.min.z / CELL)
  const z1 = Math.floor(box.max.z / CELL)
  for (let ix = x0; ix <= x1; ix++)
    for (let iy = y0; iy <= y1; iy++)
      for (let iz = z0; iz <= z1; iz++) out.push(keyOf(ix, iy, iz))
  return out
}

// scratch objects (no per-call allocation)
const _ray = new THREE.Ray()
const _pt = new THREE.Vector3()
const _box = new THREE.Box3()
const _keys: string[] = []
const _candidates = new Set<Collider>()

/** Register a static AABB collider. Returns its id for later removal. */
export function registerCollider(box: THREE.Box3, tags: string[] = []): number {
  const c: Collider = { id: nextId++, box: box.clone(), tags: [...tags] }
  colliders.push(c)
  const keys = keysForBox(c.box, [])
  for (const k of keys) {
    let cell = grid.get(k)
    if (!cell) {
      cell = new Set()
      grid.set(k, cell)
    }
    cell.add(c)
  }
  cellKeysById.set(c.id, keys)
  return c.id
}

/** Remove a collider by id (e.g. when level geometry unmounts / a gate opens). */
export function unregisterCollider(id: number) {
  const i = colliders.findIndex((c) => c.id === id)
  if (i === -1) return
  colliders.splice(i, 1)
  const keys = cellKeysById.get(id)
  if (keys) {
    for (const k of keys) {
      const cell = grid.get(k)
      if (cell) {
        for (const c of cell) if (c.id === id) cell.delete(c)
        if (cell.size === 0) grid.delete(k)
      }
    }
    cellKeysById.delete(id)
  }
}

/** Clear all colliders (used on full level rebuild / reset). */
export function clearColliders() {
  colliders.length = 0
  grid.clear()
  cellKeysById.clear()
}

/** Read-only view of the registry. */
export function getColliders(): readonly Collider[] {
  return colliders
}

/** true when the collider carries at least one of the given tags */
function hasAnyTag(c: Collider, tagFilter?: string[]): boolean {
  if (!tagFilter) return true
  return c.tags.some((t) => tagFilter.includes(t))
}

/**
 * Cast a ray against all static colliders; returns the closest hit or null.
 * Pass `tagFilter` to only test colliders carrying at least one of the tags.
 */
export function raycastLevel(
  origin: THREE.Vector3,
  dir: THREE.Vector3,
  far: number = Infinity,
  tagFilter?: string[],
): RaycastHit | null {
  _ray.origin.copy(origin)
  _ray.direction.copy(dir).normalize()
  const maxDist = far === Infinity ? 600 : far

  // gather candidates by marching the ray through the hash grid
  _candidates.clear()
  const step = CELL * 0.5
  for (let t = 0; t <= maxDist; t += step) {
    _pt.copy(_ray.direction).multiplyScalar(t).add(origin)
    const cell = grid.get(
      keyOf(Math.floor(_pt.x / CELL), Math.floor(_pt.y / CELL), Math.floor(_pt.z / CELL)),
    )
    if (cell) for (const c of cell) _candidates.add(c)
  }

  let best: RaycastHit | null = null
  for (const c of _candidates) {
    if (!hasAnyTag(c, tagFilter)) continue
    const hit = _ray.intersectBox(c.box, _pt)
    if (!hit) continue
    const d = origin.distanceTo(hit)
    if (d > maxDist || (best && d >= best.distance)) continue
    const normal = boxNormalAt(c.box, hit)
    best = { collider: c, distance: d, point: hit.clone(), normal }
  }
  return best
}

/**
 * Capsule-vs-level collision, approximated as the capsule's AABB vs collider
 * boxes. Returns all MTV pushes (apply sequentially, strongest first).
 *
 * @param position capsule bottom-center (feet)
 * @param radius   capsule radius
 * @param height   total capsule height (including caps)
 */
export function collideCapsule(
  position: THREE.Vector3,
  radius: number,
  height: number,
  tagFilter?: string[],
): CapsuleHit[] {
  _box.min.set(position.x - radius, position.y, position.z - radius)
  _box.max.set(position.x + radius, position.y + height, position.z + radius)

  _candidates.clear()
  keysForBox(_box, _keys)
  for (const k of _keys) {
    const cell = grid.get(k)
    if (cell) for (const c of cell) _candidates.add(c)
  }

  const hits: CapsuleHit[] = []
  for (const c of _candidates) {
    if (!hasAnyTag(c, tagFilter)) continue
    if (!_box.intersectsBox(c.box)) continue
    // overlap on each axis → smallest push wins
    const overlapX = Math.min(_box.max.x - c.box.min.x, c.box.max.x - _box.min.x)
    const overlapY = Math.min(_box.max.y - c.box.min.y, c.box.max.y - _box.min.y)
    const overlapZ = Math.min(_box.max.z - c.box.min.z, c.box.max.z - _box.min.z)
    const mtv = new THREE.Vector3()
    if (overlapY <= overlapX && overlapY <= overlapZ) {
      const centerY = (_box.min.y + _box.max.y) / 2
      const cCenterY = (c.box.min.y + c.box.max.y) / 2
      mtv.y = centerY > cCenterY ? overlapY : -overlapY
    } else if (overlapX <= overlapZ) {
      const centerX = (_box.min.x + _box.max.x) / 2
      const cCenterX = (c.box.min.x + c.box.max.x) / 2
      mtv.x = centerX > cCenterX ? overlapX : -overlapX
    } else {
      const centerZ = (_box.min.z + _box.max.z) / 2
      const cCenterZ = (c.box.min.z + c.box.max.z) / 2
      mtv.z = centerZ > cCenterZ ? overlapZ : -overlapZ
    }
    hits.push({ collider: c, mtv })
  }
  return hits
}

/** approximate the face normal of a box at a surface point */
function boxNormalAt(box: THREE.Box3, p: THREE.Vector3): THREE.Vector3 {
  const eps = 1e-3
  if (Math.abs(p.x - box.max.x) < eps) return new THREE.Vector3(1, 0, 0)
  if (Math.abs(p.x - box.min.x) < eps) return new THREE.Vector3(-1, 0, 0)
  if (Math.abs(p.y - box.max.y) < eps) return new THREE.Vector3(0, 1, 0)
  if (Math.abs(p.y - box.min.y) < eps) return new THREE.Vector3(0, -1, 0)
  if (Math.abs(p.z - box.max.z) < eps) return new THREE.Vector3(0, 0, 1)
  return new THREE.Vector3(0, 0, -1)
}

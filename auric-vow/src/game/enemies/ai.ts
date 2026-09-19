/**
 * AURIC VOW — enemies/ai.ts
 * Shared AI infrastructure (enemies-mission.md §4):
 * perception ticks (dist + LOS raycast + FOV), ground movement with gravity
 * vs. level colliders, whisker steering, separation between enemies.
 *
 * All functions take SCALED dt (store.timeScale already applied by caller).
 */
import * as THREE from 'three'
import { collideCapsule, raycastLevel } from '@/game/world/Colliders'
import { PlayerRef } from '@/game/player/PlayerRef'
import { EnemyRegistry, type EnemyEntity } from './EnemyRegistry'

export const PERCEPTION_INTERVAL = 0.15
export const SEPARATION_RADIUS = 1.2
const GRAVITY = 25

const _dir = new THREE.Vector3()
const _whisker = new THREE.Vector3()
const _sep = new THREE.Vector3()
const _flat = new THREE.Vector3()

/** line-of-sight between two world points (static level colliders only) */
export function hasLineOfSight(from: THREE.Vector3, to: THREE.Vector3): boolean {
  _dir.subVectors(to, from)
  const dist = _dir.length()
  if (dist < 0.001) return true
  _dir.divideScalar(dist)
  const hit = raycastLevel(from, _dir, dist - 0.3)
  return hit === null
}

/** can this enemy currently see the player? (range + FOV cone + LOS) */
export function canSeePlayer(e: EnemyEntity, range: number, fovDeg: number, facing: THREE.Vector3): boolean {
  const eye = e.headPosition
  _dir.subVectors(PlayerRef.position, eye)
  _dir.y += PlayerRef.height * 0.5 // aim at torso
  const dist = _dir.length()
  if (dist > range) return false
  if (dist > 0.001) {
    _dir.divideScalar(dist)
    _flat.copy(facing).setY(0)
    if (_flat.lengthSq() > 0.001) {
      _flat.normalize()
      const cosHalf = Math.cos(THREE.MathUtils.degToRad(fovDeg / 2))
      // flatten the look dir too for a fair horizontal cone
      const dFlat = _flat.dot(_dir.clone().setY(0).normalize())
      if (dFlat < cosHalf && dist > 2.5) return false
    }
  }
  return hasLineOfSight(eye, PlayerRef.position.clone().setY(PlayerRef.position.y + PlayerRef.height * 0.5))
}

/** horizontal separation push from other alive enemies (repulsion radius 1.2 m) */
export function separationForce(e: EnemyEntity, out: THREE.Vector3): THREE.Vector3 {
  out.set(0, 0, 0)
  for (const o of EnemyRegistry.list()) {
    if (o.id === e.id || !o.alive) continue
    _sep.subVectors(e.position, o.position)
    _sep.y = 0
    const d = _sep.length()
    const min = SEPARATION_RADIUS + o.radius
    if (d > 0.0001 && d < min) out.addScaledVector(_sep, (min - d) / (min * d))
  }
  return out
}

/**
 * Whisker steering (2 front rays at ±30°): bends `desiredDir` (normalized,
 * horizontal) away from level walls. Mutates and returns desiredDir.
 */
export function whiskerSteer(e: EnemyEntity, desiredDir: THREE.Vector3, lookAhead = 2.2): THREE.Vector3 {
  for (const sign of [-1, 1]) {
    _whisker.copy(desiredDir).applyAxisAngle(UP, (sign * Math.PI) / 6)
    const origin = _flat.copy(e.position).setY(e.position.y + e.height * 0.5)
    const hit = raycastLevel(origin, _whisker, lookAhead, ['wall', 'platform', 'objective'])
    if (hit) {
      // steer away from the blocked side
      desiredDir.applyAxisAngle(UP, (-sign * Math.PI) / 5).normalize()
    }
  }
  return desiredDir
}

const UP = new THREE.Vector3(0, 1, 0)

/**
 * Ground-unit integration: gravity + horizontal velocity + knockback decay,
 * then capsule-vs-level resolve. Mutates entity position/velocity.
 * Returns true if standing on something this frame.
 */
export function integrateGround(e: EnemyEntity, dt: number): boolean {
  e.velocity.y -= GRAVITY * dt
  // knockback decays fast
  e.position.addScaledVector(e.knockback, dt)
  e.knockback.multiplyScalar(Math.max(0, 1 - 8 * dt))

  e.position.x += e.velocity.x * dt
  e.position.z += e.velocity.z * dt
  e.position.y += e.velocity.y * dt

  let grounded = false
  const hits = collideCapsule(e.position, e.radius, e.height)
  for (const h of hits) {
    e.position.add(h.mtv)
    if (h.mtv.y > 0.001) {
      grounded = true
      if (e.velocity.y < 0) e.velocity.y = 0
    } else if (h.mtv.y < -0.001) {
      if (e.velocity.y > 0) e.velocity.y = 0
    } else {
      // wall push — kill inward velocity
      if (Math.abs(h.mtv.x) > 0) e.velocity.x = 0
      if (Math.abs(h.mtv.z) > 0) e.velocity.z = 0
    }
  }
  // void safety — never fall through the world
  if (e.position.y < -20) e.position.y = -20
  e.grounded = grounded
  return grounded
}

/** flying-unit integration: no gravity, still capsule-resolved vs. level */
export function integrateFlying(e: EnemyEntity, dt: number): void {
  e.position.addScaledVector(e.velocity, dt)
  e.position.addScaledVector(e.knockback, dt)
  e.knockback.multiplyScalar(Math.max(0, 1 - 8 * dt))
  const hits = collideCapsule(e.position, e.radius, e.height)
  for (const h of hits) {
    e.position.add(h.mtv)
    if (Math.abs(h.mtv.x) > 0) e.velocity.x *= 0.2
    if (Math.abs(h.mtv.z) > 0) e.velocity.z *= 0.2
    if (Math.abs(h.mtv.y) > 0) e.velocity.y *= 0.2
  }
  if (e.position.y < 0.6) e.position.y = 0.6
}

/** turn a current facing vector toward target, capped at maxRad this frame */
export function turnToward(current: THREE.Vector3, target: THREE.Vector3, maxRad: number): THREE.Vector3 {
  const c = _flat.copy(current).setY(0)
  if (c.lengthSq() < 0.0001) c.set(0, 0, 1)
  c.normalize()
  const t = target.clone().setY(0)
  if (t.lengthSq() < 0.0001) return current
  t.normalize()
  const ang = c.angleTo(t)
  if (ang <= maxRad) {
    current.copy(t)
    return current
  }
  const cross = c.x * t.z - c.z * t.x // y-component of c × t sign
  const s = cross > 0 ? -1 : 1 // three.js +Y rotation turns +Z toward +X
  current.copy(c).applyAxisAngle(UP, s * maxRad)
  return current
}

export { UP }

// ---------------------------------------------------------------------------
// [enemies-hud R1] Threat channel — the HUD's edge chevrons read this.
// Enemy components mark themselves while they are *committing* to an attack
// (burst telegraph, slam/charge windup, melee swing) so the player can be
// told where the danger is even when it is off screen.
// ---------------------------------------------------------------------------

export type ThreatKind = 'fire' | 'melee' | 'charge'

export interface ThreatMark {
  id: number
  kind: ThreatKind
  /** live reference to the enemy's own position vector (never cloned) */
  position: THREE.Vector3
  /** rAF-clock seconds after which the mark expires */
  until: number
}

const threats = new Map<number, ThreatMark>()

/** seconds on the same monotonic clock the HUD uses */
const threatNow = () => performance.now() / 1000

/** enemy AI: "I am about to hurt the player, from here" */
export function markThreat(e: EnemyEntity, kind: ThreatKind, seconds: number): void {
  const existing = threats.get(e.id)
  const until = threatNow() + seconds
  if (existing) {
    existing.kind = kind
    existing.until = Math.max(existing.until, until)
    existing.position = e.headPosition
    return
  }
  threats.set(e.id, { id: e.id, kind, position: e.headPosition, until })
}

/** HUD: live threat marks, expired entries pruned in place */
export function activeThreats(out: ThreatMark[]): ThreatMark[] {
  out.length = 0
  const now = threatNow()
  for (const m of threats.values()) {
    if (m.until <= now) threats.delete(m.id)
    else out.push(m)
  }
  return out
}

export function clearThreat(id: number): void {
  threats.delete(id)
}

// ---------------------------------------------------------------------------
// [enemies-hud R1] N13 — flyers path around cover instead of stalling on it.
// Three probes (forward + ±45°) plus a ceiling/floor probe; the desired
// velocity is bent away from whatever is blocked and lifted over low blockers.
// ---------------------------------------------------------------------------
const _probe = new THREE.Vector3()
const _flyDir = new THREE.Vector3()

export function avoidFlying(e: EnemyEntity, desiredVel: THREE.Vector3, lookAhead = 4): THREE.Vector3 {
  const speed = desiredVel.length()
  if (speed < 0.01) return desiredVel
  _flyDir.copy(desiredVel).divideScalar(speed)
  let bend = 0
  let lift = 0
  for (const sign of [-1, 0, 1]) {
    _probe.copy(_flyDir).applyAxisAngle(UP, (sign * Math.PI) / 4).normalize()
    const hit = raycastLevel(e.position, _probe, lookAhead, ['wall', 'platform', 'objective'])
    if (!hit) continue
    // closer blockers push harder
    const push = 1 - hit.distance / lookAhead
    if (sign === 0) {
      bend += (e.id % 2 === 0 ? 1 : -1) * push
      lift += push
    } else {
      bend -= sign * push
      lift += push * 0.35
    }
  }
  if (bend !== 0) desiredVel.applyAxisAngle(UP, THREE.MathUtils.clamp(bend, -1, 1) * 1.1)
  if (lift > 0) desiredVel.y += lift * speed * 0.55
  return desiredVel
}

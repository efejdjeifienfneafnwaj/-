/**
 * AURIC VOW — combat/DamageSystem.ts
 * Single funnel for player→enemy hit resolution (combat.md intro, §5, §6).
 * Every hit produces a DamageEvent consumed by the HUD damage-number layer,
 * spark/flash VFX through the VFX bus, and a hit-confirm tick via AudioBus.
 *
 * Global crit rule: headshot/weakpoint ×2.0. Ability kills grant bonus score
 * and +10 energy (handled by store.registerKill).
 */
import * as THREE from 'three'
import { EnemyRegistry, type EnemyHandle } from '@/game/enemies/EnemyRegistry'
import { VFX } from '@/game/vfx/VFXBus'
import { AudioBus } from '@/game/AudioBus'
import { useGameStore } from '@/game/store'
import { COLORS } from '@/game/config'

export interface ResolveHitOpts {
  /** world-space impact point (damage number + sparks spawn here) */
  point: THREE.Vector3
  /** headshot/weakpoint — ×2.0 damage */
  crit?: boolean
  /** ability-sourced damage (damage number style + ability-kill score) */
  ability?: boolean
  /** stagger meter add (combat.md §6: katana 30, dash 25, javelin 15, requiem 100, aegis 40) */
  stagger?: number
  knockback?: THREE.Vector3
}

export interface ResolvedHit {
  applied: boolean
  killed: boolean
  amount: number
  crit: boolean
}

/**
 * Apply damage to an enemy and emit all hit feedback.
 * Returns resolution details so callers can trigger hitstop etc.
 */
export function resolveEnemyHit(
  enemy: EnemyHandle,
  baseAmount: number,
  opts: ResolveHitOpts,
): ResolvedHit {
  if (!enemy.alive) return { applied: false, killed: false, amount: 0, crit: false }

  const crit = opts.crit === true
  const amount = Math.round(baseAmount * (crit ? 2 : 1))

  // EnemyRegistry.damage() returns true IFF this hit killed the enemy
  // (we already verified enemy.alive above, so the hit always applies).
  const killed = EnemyRegistry.damage(enemy.id, amount, {
    headshot: crit,
    ability: opts.ability,
    knockback: opts.knockback,
    stagger: opts.stagger,
  })

  const kind = opts.ability ? 'ability' : crit ? 'headshot' : 'normal'

  // floating damage number (HUD drains the queue)
  useGameStore.getState().pushDamageEvent({
    position: opts.point.clone(),
    amount,
    kind,
  })

  // on-flesh impact: teal sparks + faint viridian glow flash (combat.md §1.1)
  VFX.burst({
    position: opts.point,
    color: COLORS.cadenceTeal,
    count: crit ? 10 : 6,
    speed: 4,
    life: 0.25,
    size: 0.05,
    gravity: 4,
  })
  if (crit) {
    VFX.flash({ position: opts.point, color: COLORS.viridianFlare, intensity: 6, distance: 3, life: 0.08 })
  }

  AudioBus.playHit()

  if (killed) {
    useGameStore.getState().registerKill({ headshot: crit, ability: opts.ability })
    // kill feedback: teal soul-wisp rising (combat.md §5) + gold confirm flash
    VFX.burst({
      position: opts.point,
      color: COLORS.cadenceTeal,
      count: 1,
      speed: 2.2,
      life: 0.8,
      size: 0.3,
      gravity: -1.5,
    })
    VFX.burst({
      position: opts.point,
      color: COLORS.aureate,
      count: 12,
      speed: 5,
      life: 0.35,
      size: 0.06,
      gravity: 3,
    })
    VFX.flash({ position: opts.point, color: COLORS.aureate, intensity: 8, distance: 5, life: 0.1 })
  }

  return { applied: true, killed, amount, crit }
}

// ---------------------------------------------------------------------------
// Rifle damage falloff (combat.md §1: 100% → 70% beyond 40 m, range 120 m)
// ---------------------------------------------------------------------------

export const RIFLE_RANGE = 120
export const RIFLE_FALLOFF_START = 40

export function rifleFalloff(distance: number): number {
  if (distance <= RIFLE_FALLOFF_START) return 1
  if (distance >= RIFLE_RANGE) return 0.7
  return 1 - 0.3 * ((distance - RIFLE_FALLOFF_START) / (RIFLE_RANGE - RIFLE_FALLOFF_START))
}

// ---------------------------------------------------------------------------
// Hitscan helpers — ray vs. enemy spheres (head/core crit sphere + body sphere)
// ---------------------------------------------------------------------------

export interface EnemyRayHit {
  enemy: EnemyHandle
  distance: number
  point: THREE.Vector3
  crit: boolean
}

const _oc = new THREE.Vector3()

/** smallest positive ray/sphere intersection t, or null */
function raySphere(
  origin: THREE.Vector3,
  dir: THREE.Vector3,
  center: THREE.Vector3,
  r: number,
): number | null {
  _oc.copy(center).sub(origin)
  const tca = _oc.dot(dir)
  const d2 = _oc.lengthSq() - tca * tca
  const r2 = r * r
  if (d2 > r2) return null
  const thc = Math.sqrt(r2 - d2)
  let t = tca - thc
  if (t < 0) t = tca + thc // origin inside sphere
  return t >= 0 ? t : null
}

/**
 * Cast against all live enemies; returns the closest hit.
 * Headshot if the head/core sphere (headPosition) is hit before the body.
 */
export function raycastEnemies(
  origin: THREE.Vector3,
  dir: THREE.Vector3,
  maxDist: number,
): EnemyRayHit | null {
  let best: EnemyRayHit | null = null
  for (const e of EnemyRegistry.list()) {
    if (!e.alive) continue
    // body sphere: capsule midpoint, generous radius
    const bodyR = Math.max(e.radius, e.height * 0.42)
    _bodyC.copy(e.position)
    _bodyC.y += e.height * 0.5
    const bodyT = raySphere(origin, dir, _bodyC, bodyR)
    // head/core sphere: tight
    const headR = Math.max(0.24, Math.min(0.36, e.radius * 0.6))
    const headT = raySphere(origin, dir, e.headPosition, headR)

    let t: number | null = null
    let crit = false
    if (headT !== null && (bodyT === null || headT <= bodyT + 0.05)) {
      t = headT
      crit = true
    } else if (bodyT !== null) {
      t = bodyT
    }
    if (t === null || t > maxDist) continue
    if (best && t >= best.distance) continue
    best = {
      enemy: e,
      distance: t,
      point: new THREE.Vector3().copy(dir).multiplyScalar(t).add(origin),
      crit,
    }
  }
  return best
}

const _bodyC = new THREE.Vector3()

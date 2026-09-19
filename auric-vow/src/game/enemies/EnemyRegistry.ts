/**
 * AURIC VOW — enemies/EnemyRegistry.ts
 * Live registry of all enemy entities. Combat code damages enemies through
 * `EnemyRegistry.damage()`; enemy components mutate their entity directly
 * (positions are live THREE.Vector3 references shared with the handle).
 *
 * Kill *scoring* is handled by the caller via the store (registerKill);
 * this module only applies hp/stagger/knockback and fires death visuals
 * (teal dissolve burst + core pop + AudioBus chirp).
 */
import * as THREE from 'three'
import { VFX } from '@/game/vfx/VFXBus'
import { AudioBus } from '@/game/AudioBus'
import { COLORS } from '@/game/config'

export type EnemyType = 'drone' | 'trooper' | 'heavy'

export interface EnemyHandle {
  id: number
  type: EnemyType
  /** live world position: feet-center for ground units, body-center for drones */
  position: THREE.Vector3
  /** live world position of the crit/head weakpoint */
  headPosition: THREE.Vector3
  hp: number
  maxHp: number
  alive: boolean
  /** stagger meter 0..100 (100 → staggered; resets after trigger) */
  stagger: number
  radius: number
  height: number
}

/** Internal mutable entity — superset of the public handle. */
export interface EnemyEntity extends EnemyHandle {
  velocity: THREE.Vector3
  /** decaying knockback impulse applied by movement integration */
  knockback: THREE.Vector3
  /** current AI state label (per-type machines) */
  state: string
  /** >0 while staggered (counts down, scaled seconds) */
  staggerTimer: number
  /** >0 while the white hit-flash shows (seconds) */
  hitFlash: number
  /** seconds since death; -1 while alive */
  deathTimer: number
  /** spawn-alerted (waves) or alerted via perception/broadcast */
  alerted: boolean
  grounded: boolean
  /** last wall/charge impact cooldown guard */
  impactCooldown: number
  /** type-specific AI scratch timers (state clocks, fire cooldowns…) */
  ai: Record<string, number>
  /** patrol waypoints (drones / trooper guard loops) */
  waypoints: THREE.Vector3[]
  /** manager bookkeeping: dissolve duration before despawn */
  dissolveSec: number
}

export interface DamageOpts {
  headshot?: boolean
  ability?: boolean
  knockback?: THREE.Vector3
  stagger?: number
}

const entities = new Map<number, EnemyEntity>()
let nextId = 1

const _corePos = new THREE.Vector3()

/** per-type death presentation tuning (enemies-mission.md §6) */
const DEATH_FX: Record<EnemyType, { count: number; speed: number; size: number; flash: number; ring: number }> = {
  drone: { count: 10, speed: 5, size: 0.06, flash: 6, ring: 0 },
  trooper: { count: 16, speed: 6, size: 0.07, flash: 9, ring: 0 },
  heavy: { count: 26, speed: 7, size: 0.09, flash: 14, ring: 1 },
}

export const EnemyRegistry = {
  /** live handles for every registered enemy (check `alive` before use) */
  list(): EnemyHandle[] {
    return [...entities.values()]
  },

  /** internal: full entity for AI components / manager */
  get(id: number): EnemyEntity | undefined {
    return entities.get(id)
  },

  aliveCount(): number {
    let n = 0
    for (const e of entities.values()) if (e.alive) n++
    return n
  },

  /**
   * Apply damage. Returns true iff this hit killed the enemy.
   * - headshot ×2 (core / eye-slit / back-reactor crits)
   * - stagger meter: 100 → stagger 1.2s (heavy immune unless a 100+ stagger
   *   source — i.e. Auric Requiem — which staggers it 0.6s)
   */
  damage(id: number, amount: number, opts?: DamageOpts): boolean {
    const e = entities.get(id)
    if (!e || !e.alive) return false

    const dmg = opts?.headshot ? amount * 2 : amount
    e.hp = Math.max(0, e.hp - dmg)
    e.hitFlash = 0.08

    if (opts?.knockback) e.knockback.add(opts.knockback)

    const stag = opts?.stagger ?? 0
    if (stag > 0) {
      if (e.type === 'heavy') {
        // stagger immune except Requiem-scale hits (enemies-mission.md §3)
        if (stag >= 100) e.staggerTimer = Math.max(e.staggerTimer, 0.6)
      } else {
        e.stagger = Math.min(100, e.stagger + stag)
        if (e.stagger >= 100) {
          e.stagger = 0
          e.staggerTimer = Math.max(e.staggerTimer, 1.2)
          e.state = 'stagger'
        }
      }
    }

    if (e.hp > 0) return false

    // --- death (enemies-mission.md §6) ---
    e.alive = false
    e.deathTimer = 0
    e.state = 'dead'
    const fx = DEATH_FX[e.type]
    _corePos.copy(e.headPosition)
    // core pop — teal particle burst + light flash
    VFX.burst({
      position: _corePos,
      color: COLORS.cadenceTeal,
      count: fx.count,
      speed: fx.speed,
      life: 0.6,
      size: fx.size,
      gravity: -2,
    })
    VFX.flash({ position: _corePos, color: COLORS.cadenceTeal, intensity: fx.flash, distance: 10, life: 0.3 })
    if (fx.ring > 0) {
      VFX.ring({ position: e.position, color: COLORS.cadenceTeal, maxRadius: 4, life: 0.5, width: 0.3 })
    }
    AudioBus.playEnemyChirp()
    return true
  },
}

// ---------------------------------------------------------------------------
// Manager-facing lifecycle (not part of the combat contract)
// ---------------------------------------------------------------------------

export function registerEnemy(init: {
  type: EnemyType
  position: THREE.Vector3
  hp: number
  radius: number
  height: number
  alerted?: boolean
  waypoints?: THREE.Vector3[]
  dissolveSec?: number
}): EnemyEntity {
  const id = nextId++
  const e: EnemyEntity = {
    id,
    type: init.type,
    position: init.position.clone(),
    headPosition: init.position.clone(),
    hp: init.hp,
    maxHp: init.hp,
    alive: true,
    stagger: 0,
    radius: init.radius,
    height: init.height,
    velocity: new THREE.Vector3(),
    knockback: new THREE.Vector3(),
    state: init.waypoints?.length ? 'patrol' : 'guard',
    staggerTimer: 0,
    hitFlash: 0,
    deathTimer: -1,
    alerted: init.alerted ?? false,
    grounded: false,
    impactCooldown: 0,
    ai: {},
    waypoints: init.waypoints ? init.waypoints.map((w) => w.clone()) : [],
    dissolveSec: init.dissolveSec ?? 0.6,
  }
  entities.set(id, e)
  return e
}

export function unregisterEnemy(id: number) {
  entities.delete(id)
}

export function clearEnemies() {
  entities.clear()
}

/** alert broadcast — enemies within `radius` of `pos` become alerted */
export function broadcastAlert(pos: THREE.Vector3, radius: number) {
  for (const e of entities.values()) {
    if (e.alive && !e.alerted && e.position.distanceTo(pos) <= radius) e.alerted = true
  }
}

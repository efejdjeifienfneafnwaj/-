/**
 * AURIC VOW — combat/DamageSystem.ts
 * Single funnel for player→enemy hit resolution (combat.md intro, §5, §6).
 * Every hit produces a DamageEvent consumed by the HUD damage-number layer,
 * spark/flash VFX through the VFX bus, and a hit-confirm tick via AudioBus.
 *
 * Global crit rule: headshot/weakpoint ×2.0. Ability kills grant bonus score
 * and +10 energy (handled by store.registerKill).
 *
 * [combat-feel R1] This file also owns `ImpactFx` — the pooled, velocity-
 * aligned *stretched* spark system every impact in the game sprays. The VFX
 * bus only knows one round soft blob (weakness V3), which reads as fog at
 * 30 m; a hit needs streaks that point away from the surface so the eye can
 * tell what was hit and from where. One InstancedMesh of crossed quads,
 * per-instance colour for the fade, zero runtime allocation. `WeaponSystems`
 * mounts `ImpactFx.object` once and ticks `ImpactFx.update(dt)`.
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
  /**
   * [combat-feel R1] Direction the damage travelled in (unit, optional).
   * Spark ejecta is sprayed back along it so the streaks read as material
   * thrown off the surface rather than a symmetric puff.
   */
  dir?: THREE.Vector3
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

  // ---- on-flesh impact ------------------------------------------------
  // [combat-feel R1] Three layers, all with life >= 0.08 s so a 33 ms capture
  // step can never land between them (work order combat-feel #2):
  //   1. stretched ejecta streaks sprayed back along the incoming direction
  //   2. the bus' soft teal bleed blob underneath, for volume
  //   3. a short impact light so the hit actually relights the enemy plates
  _ejecta.set(0, 0, 0)
  if (opts.dir) _ejecta.copy(opts.dir).multiplyScalar(-1)
  else _ejecta.copy(opts.point).sub(enemy.position).setY(0.35)
  if (_ejecta.lengthSq() < 1e-6) _ejecta.set(0, 1, 0)
  _ejecta.normalize()
  ImpactFx.sparks(opts.point, _ejecta, crit ? 10 : 6, {
    speed: crit ? 9 : 6.5,
    spread: 0.62,
    color: crit ? COLORS.solarWhite : COLORS.aureate,
    life: 0.26,
    width: crit ? 0.026 : 0.02,
  })
  VFX.burst({
    position: opts.point,
    color: COLORS.cadenceTeal,
    count: crit ? 8 : 5,
    speed: 4,
    life: 0.25,
    size: 0.05,
    gravity: 4,
  })
  VFX.flash({
    position: opts.point,
    color: crit ? COLORS.solarWhite : COLORS.aureate,
    intensity: crit ? 9 : 5,
    distance: crit ? 4 : 3,
    life: 0.09,
  })

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
    // [combat-feel R1] a kill throws a full sphere of long streaks, so death
    // reads differently from a body hit even with the numbers turned off
    ImpactFx.sparks(opts.point, _ejecta, 16, {
      speed: 11,
      spread: 1.35,
      color: COLORS.aureate,
      life: 0.42,
      width: 0.028,
      gravity: 7,
    })
    VFX.flash({ position: opts.point, color: COLORS.aureate, intensity: 8, distance: 5, life: 0.12 })
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


// ---------------------------------------------------------------------------
// [combat-feel R1] ImpactFx — pooled velocity-aligned spark ejecta
//
// One InstancedMesh of crossed quads (so a streak never vanishes edge-on),
// +Y = travel direction, vertex alpha ramping 0 at the tail to 1 at the head,
// per-instance colour carrying the life fade. Additive, toneMapped:false,
// depthWrite:false. Nothing is allocated after module load.
// ---------------------------------------------------------------------------

const SPARK_COUNT = 192

interface Spark {
  active: boolean
  age: number
  life: number
  width: number
  gravity: number
  drag: number
  pos: THREE.Vector3
  vel: THREE.Vector3
  color: THREE.Color
}

/** crossed-quad streak: pivot at the tail, unit length along +Y */
function makeStreakGeometry(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry()
  // two perpendicular quads sharing the same axis
  const pos = new Float32Array([
    // XY quad (normal ±Z)
    -0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0,
    // ZY quad (normal ±X)
    0, 0, -0.5, 0, 0, 0.5, 0, 1, 0.5, 0, 1, -0.5,
  ])
  // RGBA: tail transparent, head opaque — the streak fades along its length
  const col = new Float32Array([
    1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, //
    1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1,
  ])
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('color', new THREE.BufferAttribute(col, 4))
  g.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7])
  return g
}

const _sparkDummy = new THREE.Object3D()
const _sparkColor = new THREE.Color()
const _sparkUp = new THREE.Vector3(0, 1, 0)
const _sparkDir = new THREE.Vector3()
const _sparkJitter = new THREE.Vector3()
const _ejecta = new THREE.Vector3()

function makeImpactFx() {
  const geo = makeStreakGeometry()
  const mat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    vertexColors: true,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  })
  const mesh = new THREE.InstancedMesh(geo, mat, SPARK_COUNT)
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  mesh.frustumCulled = false
  mesh.renderOrder = 20
  const group = new THREE.Group()
  group.add(mesh)

  const pool: Spark[] = Array.from({ length: SPARK_COUNT }, () => ({
    active: false,
    age: 0,
    life: 0,
    width: 0.02,
    gravity: 6,
    drag: 3,
    pos: new THREE.Vector3(),
    vel: new THREE.Vector3(),
    color: new THREE.Color(),
  }))

  // park every instance and prime the per-instance colour buffer
  for (let i = 0; i < SPARK_COUNT; i++) {
    _sparkDummy.position.set(0, -1000, 0)
    _sparkDummy.quaternion.identity()
    _sparkDummy.scale.setScalar(0.00001)
    _sparkDummy.updateMatrix()
    mesh.setMatrixAt(i, _sparkDummy.matrix)
    mesh.setColorAt(i, _sparkColor.setRGB(0, 0, 0))
  }
  mesh.instanceMatrix.needsUpdate = true
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true

  let cursor = 0
  let live = 0

  return {
    /** mount this once inside the Canvas (WeaponSystems does it) */
    object: group as THREE.Object3D,

    /**
     * Spray `count` stretched sparks from `point`, centred on `dir`.
     * `spread` is the cone half-angle factor (0 = a needle, 1.4 ≈ a sphere).
     */
    sparks(
      point: THREE.Vector3,
      dir: THREE.Vector3,
      count: number,
      opts?: {
        speed?: number
        spread?: number
        color?: number | string
        life?: number
        width?: number
        gravity?: number
      },
    ): void {
      const speed = opts?.speed ?? 7
      const spread = opts?.spread ?? 0.6
      const life = Math.max(0.09, opts?.life ?? 0.25)
      const width = opts?.width ?? 0.02
      const gravity = opts?.gravity ?? 6
      _sparkColor.set((opts?.color ?? COLORS.aureate) as never)
      for (let n = 0; n < count; n++) {
        // round-robin over the pool: a burst never starves behind stale sparks
        const s = pool[cursor % SPARK_COUNT]!
        cursor++
        if (!s.active) live++
        s.active = true
        s.age = 0
        s.life = life * (0.72 + Math.random() * 0.56)
        s.width = width * (0.7 + Math.random() * 0.7)
        s.gravity = gravity
        s.drag = 2.4 + Math.random() * 2
        s.pos.copy(point)
        _sparkJitter
          .set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5)
          .multiplyScalar(spread * 2)
        _sparkDir.copy(dir).add(_sparkJitter)
        if (_sparkDir.lengthSq() < 1e-6) _sparkDir.set(0, 1, 0)
        _sparkDir.normalize()
        s.vel.copy(_sparkDir).multiplyScalar(speed * (0.45 + Math.random() * 0.9))
        s.color.copy(_sparkColor)
      }
    },

    /** advance the pool; call once per frame with the scaled combat dt */
    update(dt: number): void {
      if (live === 0) return
      let dirty = false
      for (let i = 0; i < SPARK_COUNT; i++) {
        const s = pool[i]!
        if (!s.active) continue
        dirty = true
        s.age += dt
        if (s.age >= s.life) {
          s.active = false
          live--
          _sparkDummy.position.set(0, -1000, 0)
          _sparkDummy.quaternion.identity()
          _sparkDummy.scale.setScalar(0.00001)
          _sparkDummy.updateMatrix()
          mesh.setMatrixAt(i, _sparkDummy.matrix)
          continue
        }
        // integrate: gravity + air drag, so streaks arc and shorten as they die
        s.vel.y -= s.gravity * dt
        s.vel.multiplyScalar(Math.max(0, 1 - s.drag * dt))
        s.pos.addScaledVector(s.vel, dt)
        const speed = s.vel.length()
        if (speed > 1e-4) {
          _sparkDir.copy(s.vel).divideScalar(speed)
          _sparkDummy.quaternion.setFromUnitVectors(_sparkUp.set(0, 1, 0), _sparkDir)
        }
        const t = s.age / s.life
        const fade = (1 - t) * (1 - t * 0.35)
        // length tracks speed: fast sparks are long needles, dying ones are dots
        const len = THREE.MathUtils.clamp(speed * 0.045, 0.05, 0.55)
        _sparkDummy.position.copy(s.pos)
        _sparkDummy.scale.set(s.width, len, s.width)
        _sparkDummy.updateMatrix()
        mesh.setMatrixAt(i, _sparkDummy.matrix)
        mesh.setColorAt(i, _sparkColor.copy(s.color).multiplyScalar(fade))
      }
      if (dirty) {
        mesh.instanceMatrix.needsUpdate = true
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      }
    },

    /** run restart: drop every live streak */
    clear(): void {
      for (let i = 0; i < SPARK_COUNT; i++) {
        pool[i]!.active = false
        _sparkDummy.position.set(0, -1000, 0)
        _sparkDummy.scale.setScalar(0.00001)
        _sparkDummy.updateMatrix()
        mesh.setMatrixAt(i, _sparkDummy.matrix)
      }
      live = 0
      mesh.instanceMatrix.needsUpdate = true
    },
  }
}

export const ImpactFx = makeImpactFx()

/**
 * AURIC VOW — VFXBus.ts
 * Public, component-agnostic VFX API (vfx-hud.md §1). Combat/enemies/mission
 * agents call `VFX.*` from anywhere; the pooled systems (Particles / Trails /
 * Shockwaves / Flashes) drain these queues once per frame inside the Canvas.
 *
 * Events are sparse (per effect, not per frame) so small plain-object
 * allocations here are acceptable; the pools themselves allocate nothing
 * at runtime.
 */
import * as THREE from 'three'
import { COLORS, VFXENERGY } from '../config'
import { PARTICLE_SHAPE, type ParticleShapeName } from './vfxTextures'

// ---------------------------------------------------------------------------
// Public option types (exact cross-agent contract)
// ---------------------------------------------------------------------------

export interface BurstOpts {
  position: THREE.Vector3
  color?: number | string
  count?: number
  speed?: number
  life?: number
  size?: number
  gravity?: number
  /**
   * tangential velocity field strength (m/s) around the burst origin's Y
   * axis — positive = counter-clockwise seen from above. Turns the burst
   * into a vortex (Auric Requiem detonation spiral). 0 = pure radial.
   */
  swirl?: number
  /**
   * [vfx R1] which atlas tile the particles are drawn with. 'spark' (default)
   * is the hot needle, 'ember' the slow drifter, 'debris' a chipped chunk and
   * 'smoke' the ONLY non-additive shape — dark alpha mass that gives an
   * explosion body and lets it occlude what is behind it.
   */
  shape?: ParticleShapeName
  /**
   * [vfx R1] how hard particles stretch along their own velocity, 0 = always
   * round, 1 = full screen-space streak. Defaults to 0.75 for sparks and
   * debris, 0 for smoke and embers, so existing callers get streaks free.
   */
  stretch?: number
}

export interface RingOpts {
  position: THREE.Vector3
  color?: number | string
  maxRadius?: number
  life?: number
  width?: number
  /**
   * [vfx R1] surface normal the ring lies against. Defaults to +Y (ground
   * shockwave); pass the hit normal for wall impacts so the ring stops being
   * a floor disc floating in mid-air.
   */
  normal?: THREE.Vector3
  /**
   * [vfx R4] Master gain, default 1. The ring shader authors its leading edge
   * at up to 2.9x so a shockwave front CLIPS — which is right for a
   * detonation and wrong for the cosmetic ground ring a cast drops at the
   * player's feet. Measured on a driven capture, the volley's launch ring
   * bloomed into a white band across the lower third of the frame: a flat
   * single-layer additive shape at 2 m from the lens. Callers whose ring is
   * punctuation rather than the event itself pass a fraction here.
   */
  intensity?: number
}

export interface FlashOpts {
  position: THREE.Vector3
  color?: number | string
  intensity?: number
  distance?: number
  life?: number
}

/**
 * [vfx R2] Persistent surface mark (V19). Combat leaves nothing on the world
 * today — every impact is a transient additive puff that is gone by the next
 * capture step. A decal is a surface-aligned quad that holds for `life`
 * seconds and fades on a long tail, so a fight reads as having happened.
 */
export interface DecalOpts {
  position: THREE.Vector3
  /** surface normal to lie against (defaults to +Y) */
  normal?: THREE.Vector3
  color?: number | string
  /** metres across */
  size?: number
  life?: number
  /** 0 = sooty subtractive scorch, 1 = additive energy burn */
  energy?: number
}

/**
 * [vfx R3] Pressure / heat distortion (V4). A sphere of screen-space
 * refraction that expands and fades: what a detonation does to the air in
 * front of the architecture. Consumed by Shockwaves.tsx.
 */
export interface DistortOpts {
  position: THREE.Vector3
  /** metres the shell reaches at the end of its life */
  maxRadius?: number
  life?: number
  /** UV-space displacement at the silhouette (0.02 ~ 2% of screen width) */
  strength?: number
  /** 0..1 darkening of the compressed band */
  compress?: number
  tint?: number | string
}

export interface TrailHandle {
  push(p: THREE.Vector3): void
  end(): void
}

// ---------------------------------------------------------------------------
// Internal command queues
// ---------------------------------------------------------------------------

export interface BurstCmd {
  x: number
  y: number
  z: number
  color: number
  count: number
  speed: number
  life: number
  size: number
  gravity: number
  swirl: number
  shape: number
  stretch: number
}

export interface RingCmd {
  x: number
  y: number
  z: number
  color: number
  maxRadius: number
  life: number
  width: number
  nx: number
  ny: number
  nz: number
  intensity: number
}

export interface FlashCmd {
  x: number
  y: number
  z: number
  color: number
  intensity: number
  distance: number
  life: number
}

export interface DecalCmd {
  x: number
  y: number
  z: number
  nx: number
  ny: number
  nz: number
  color: number
  size: number
  life: number
  energy: number
}

export interface DistortCmd {
  x: number
  y: number
  z: number
  maxRadius: number
  life: number
  strength: number
  compress: number
  color: number
}

export interface TrailOp {
  id: string
  end: boolean
  x: number
  y: number
  z: number
}

const burstQueue: BurstCmd[] = []
const ringQueue: RingCmd[] = []
const flashQueue: FlashCmd[] = []
const trailQueue: TrailOp[] = []
const decalQueue: DecalCmd[] = []
const distortQueue: DistortCmd[] = []

const tmpColor = new THREE.Color()

function toHex(color: number | string | undefined, fallback: string): number {
  if (color === undefined) return tmpColor.set(fallback).getHex()
  return tmpColor.set(color as never).getHex()
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const VFX = {
  /** pooled point-particle explosion */
  burst(o: BurstOpts): void {
    if (burstQueue.length > 256) return // backpressure guard
    burstQueue.push({
      x: o.position.x,
      y: o.position.y,
      z: o.position.z,
      color: toHex(o.color, COLORS.aureate),
      count: Math.min(o.count ?? 10, 120),
      speed: o.speed ?? 5,
      life: o.life ?? 0.5,
      size: o.size ?? 0.05,
      gravity: o.gravity ?? 0,
      swirl: o.swirl ?? 0,
      shape: PARTICLE_SHAPE[o.shape ?? 'spark'],
      stretch: o.stretch ?? (o.shape === 'smoke' || o.shape === 'ember' ? 0 : 0.75),
    })
  },

  /** expanding ground-shockwave ring (flat on XZ) */
  ring(o: RingOpts): void {
    if (ringQueue.length > 32) return
    ringQueue.push({
      x: o.position.x,
      y: o.position.y,
      z: o.position.z,
      color: toHex(o.color, COLORS.aureate),
      maxRadius: o.maxRadius ?? 2,
      life: o.life ?? 0.5,
      width: o.width ?? 0.08,
      nx: o.normal ? o.normal.x : 0,
      ny: o.normal ? o.normal.y : 1,
      nz: o.normal ? o.normal.z : 0,
      intensity: Math.max(0, o.intensity ?? 1),
    })
  },

  /** pooled point-light spike + small billboard flash quad */
  flash(o: FlashOpts): void {
    if (flashQueue.length > 32) return
    flashQueue.push({
      x: o.position.x,
      y: o.position.y,
      z: o.position.z,
      color: toHex(o.color, COLORS.solarWhite),
      intensity: o.intensity ?? 15,
      distance: o.distance ?? 8,
      life: o.life ?? 0.15,
    })
  },

  /**
   * [vfx R2] Lay a persistent surface mark (scorch, energy burn). Consumed by
   * Shockwaves.tsx, which owns the surface-FX pool.
   */
  decal(o: DecalOpts): void {
    if (decalQueue.length > 16) return
    decalQueue.push({
      x: o.position.x,
      y: o.position.y,
      z: o.position.z,
      nx: o.normal ? o.normal.x : 0,
      ny: o.normal ? o.normal.y : 1,
      nz: o.normal ? o.normal.z : 0,
      color: toHex(o.color, COLORS.aureate),
      size: o.size ?? 1,
      life: o.life ?? 4,
      energy: o.energy ?? 0.5,
    })
  },

  /**
   * [vfx R3] Bend the frame. One expanding refraction shell — the pressure
   * element every AAA detonation has and this build had none of.
   */
  distort(o: DistortOpts): void {
    if (distortQueue.length > 6) return
    distortQueue.push({
      x: o.position.x,
      y: o.position.y,
      z: o.position.z,
      maxRadius: o.maxRadius ?? 6,
      life: o.life ?? 0.5,
      strength: o.strength ?? 0.022,
      compress: o.compress ?? 0.35,
      color: toHex(o.tint, COLORS.solarWhite),
    })
  },

  /**
   * Acquire a ribbon-trail handle. `push()` a head position each frame while
   * the trail lives, then `end()` to release it (0.25s fade-out).
   * Reusing the same `id` after end() starts a fresh ribbon.
   */
  trail(id: string): TrailHandle {
    return {
      push(p: THREE.Vector3) {
        if (trailQueue.length > 512) return
        trailQueue.push({ id, end: false, x: p.x, y: p.y, z: p.z })
      },
      end() {
        trailQueue.push({ id, end: true, x: 0, y: 0, z: 0 })
      },
    }
  },
}

// ---------------------------------------------------------------------------
// Drain API — used ONLY by the pooled systems (one consumer per queue)
// ---------------------------------------------------------------------------

/** move all pending bursts into `out` (clears the queue) */
export function drainBursts(out: BurstCmd[]): void {
  for (let i = 0; i < burstQueue.length; i++) out.push(burstQueue[i])
  burstQueue.length = 0
}

export function drainRings(out: RingCmd[]): void {
  for (let i = 0; i < ringQueue.length; i++) out.push(ringQueue[i])
  ringQueue.length = 0
}

export function drainFlashes(out: FlashCmd[]): void {
  for (let i = 0; i < flashQueue.length; i++) out.push(flashQueue[i])
  flashQueue.length = 0
}

export function drainTrailOps(out: TrailOp[]): void {
  for (let i = 0; i < trailQueue.length; i++) out.push(trailQueue[i])
  trailQueue.length = 0
}

export function drainDecals(out: DecalCmd[]): void {
  for (let i = 0; i < decalQueue.length; i++) out.push(decalQueue[i])
  decalQueue.length = 0
}

export function drainDistorts(out: DistortCmd[]): void {
  for (let i = 0; i < distortQueue.length; i++) out.push(distortQueue[i])
  distortQueue.length = 0
}

// ---------------------------------------------------------------------------
// [vfx R1] Tracked lights — V17
//
// `VFX.flash()` is a one-shot: it cannot light a javelin in flight or hold a
// nova open for 1.2 s. A tracked light is a leased slot out of a fixed pool
// (VFXENERGY.trackedLights) that an effect drives every frame for its whole
// lifetime and then releases. Flashes.tsx is the single consumer; it syncs
// the slots onto real PointLights so ability VFX relight the architecture and
// the player's plates instead of floating over them.
//
// Zero runtime allocation: slots AND handles are preallocated. `acquire()`
// returns null when the pool is exhausted — callers must tolerate that (the
// effect simply runs without its own light).
// ---------------------------------------------------------------------------

export interface TrackedLightSlot {
  leased: boolean
  /** bumped on every acquire so a stale handle can never drive a re-leased slot */
  gen: number
  x: number
  y: number
  z: number
  color: number
  intensity: number
  distance: number
  decay: number
  /**
   * [vfx R2] Higher priority can EVICT a lower-priority lease when the pool is
   * exhausted. The measured failure this fixes: the ultimate's nova light —
   * the single most important light event in the game — silently got `null`
   * from `acquireLight` whenever a dash and a seven-javelin volley were
   * already holding all six slots, so the nova lit nothing at all.
   */
  priority: number
}

export interface TrackedLightHandle {
  /** move the light and set its current intensity (0 turns it off, keeps the lease) */
  set(x: number, y: number, z: number, intensity: number): void
  /** retint mid-life (nova cooling from white to gold, shield taking a hit) */
  tint(color: number | string): void
  /** change the reach mid-life */
  reach(distance: number): void
  /** give the slot back — always call this, effects that leak starve the pool */
  release(): void
  /**
   * False once the lease was handed back, or force-cleared by `resetVfx()`.
   * Holders that cache a handle must re-acquire when this goes false, or they
   * will silently run without a light for the rest of the session.
   */
  live(): boolean
}

class LightLease implements TrackedLightHandle {
  /**
   * Generation this handle was issued for; a re-leased slot invalidates it.
   *
   * A handle is issued FRESH per acquisition and never recycled. That is
   * load-bearing, not incidental: when one shared handle object per slot was
   * reused, evicting a lease mutated the very object the evicted owner still
   * held, so its `gen` kept matching and `live()` stayed true. The evicted
   * effect then went on driving — and eventually `release()`d — the light
   * that had just been taken from it by a higher-priority event.
   */
  readonly gen: number
  private readonly slot: TrackedLightSlot

  constructor(slot: TrackedLightSlot, gen: number) {
    this.slot = slot
    this.gen = gen
  }

  live(): boolean {
    return this.slot.leased && this.slot.gen === this.gen
  }

  set(x: number, y: number, z: number, intensity: number): void {
    if (!this.live()) return
    this.slot.x = x
    this.slot.y = y
    this.slot.z = z
    this.slot.intensity = intensity
  }

  tint(color: number | string): void {
    if (!this.live()) return
    this.slot.color = toHex(color, COLORS.solarWhite)
  }

  reach(distance: number): void {
    if (!this.live()) return
    this.slot.distance = distance
  }

  release(): void {
    if (!this.live()) return
    this.slot.leased = false
    this.slot.intensity = 0
  }
}

const lightSlots: TrackedLightSlot[] = []

for (let i = 0; i < VFXENERGY.trackedLights; i++) {
  const slot: TrackedLightSlot = {
    leased: false,
    gen: 0,
    x: 0,
    y: 0,
    z: 0,
    color: 0xffffff,
    intensity: 0,
    distance: 12,
    decay: 2,
    priority: 0,
  }
  lightSlots.push(slot)
}

/** [vfx R2] lease priorities — a big event outranks a cosmetic one */
export const LIGHT_PRIORITY = {
  /** ambient / cosmetic: javelin in flight, dash streak */
  cosmetic: 0,
  /** ability body: Aegis shell, charge */
  ability: 1,
  /** the frame-defining event: the Auric Requiem nova */
  event: 2,
} as const

/**
 * Lease a pooled PointLight for the lifetime of an effect.
 *
 * Returns null only when every slot is held at an equal or higher priority.
 * A higher-priority request evicts the dimmest lower-priority lease; the
 * evicted handle stops driving anything immediately (its generation no longer
 * matches), so an effect that loses its light simply runs without one.
 */
export function acquireLight(
  color: number | string,
  distance: number,
  decay = 2,
  priority: number = LIGHT_PRIORITY.cosmetic,
): TrackedLightHandle | null {
  let target = -1
  for (let i = 0; i < lightSlots.length; i++) {
    if (lightSlots[i].leased) continue
    target = i
    break
  }
  if (target < 0) {
    // pool exhausted: take the dimmest strictly-lower-priority lease
    let best = -1
    let bestScore = Infinity
    for (let i = 0; i < lightSlots.length; i++) {
      const s = lightSlots[i]
      if (s.priority >= priority) continue
      const score = s.priority * 1e6 + s.intensity
      if (score < bestScore) {
        bestScore = score
        best = i
      }
    }
    if (best < 0) return null
    target = best
  }
  const slot = lightSlots[target]
  slot.leased = true
  slot.gen++
  slot.color = toHex(color, COLORS.solarWhite)
  slot.distance = distance
  slot.decay = decay
  slot.intensity = 0
  slot.priority = priority
  // a fresh handle per acquisition — see LightLease.gen
  return new LightLease(slot, slot.gen)
}

/** consumer-side read (Flashes.tsx only) */
export function trackedLightSlots(): readonly TrackedLightSlot[] {
  return lightSlots
}

// ---------------------------------------------------------------------------
// Run restart
//
// `resetCombat()` clears the combat state flags, which makes every ability
// update function early-out — so the code paths that would have released a
// leased light or ended a ribbon never run. A restart taken mid-dash or
// mid-volley therefore used to strand slots as `leased` with their last
// intensity, and Flashes.tsx mirrors exactly that: six point lights frozen in
// the level forever, and no tracked light available again for the session.
// Abandoned ribbons behave the same way — a Ribbon that is never `end()`ed is
// never released, so the streak hangs in the world.
//
// The owners cannot fix this themselves: the javelin ribbons and shells live
// in component state that the reset path has no handle on. So the bus clears
// itself, and cached handles are invalidated by the generation bump.
// ---------------------------------------------------------------------------

let epoch = 0

/** bumped by {@link resetVfx}; pooled systems drop their live effects on change */
export function vfxEpoch(): number {
  return epoch
}

/** drop every queued command, live trail and leased light slot */
export function resetVfx(): void {
  epoch++
  burstQueue.length = 0
  ringQueue.length = 0
  flashQueue.length = 0
  trailQueue.length = 0
  decalQueue.length = 0
  distortQueue.length = 0
  PostFxSignals.bloomLoad = 0
  for (const slot of lightSlots) {
    slot.leased = false
    slot.intensity = 0
    slot.priority = 0
    // invalidate every outstanding handle: a stale one must not be able to
    // drive a slot that has since been re-leased by a different effect
    slot.gen++
  }
}

// ---------------------------------------------------------------------------
// [vfx R1] Post-process signals
//
// PostFX.tsx must not infer its behaviour from `timeScale < 1` — that is a
// plateau, not an event, so it produced a chromatic-aberration smear that sat
// on screen for the whole hitstop. Gameplay code raises discrete impulses
// here instead and the post stack decays them on its own curve.
//
// Times are wall-clock seconds (performance.now/1000), NOT game time: post
// response must keep running at timeScale 0.05.
// ---------------------------------------------------------------------------

export function nowSec(): number {
  return (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000
}

export const PostFxSignals = {
  /** last CA impulse (s) — PostFX eases it out over POSTFX.chromaticAberration.impulseSec */
  caImpulseAt: -1e9,
  /** strength of that impulse, 0..1 */
  caImpulseAmount: 0,
  /** wall-clock window during which the ultimate grade is held */
  ultFrom: -1e9,
  ultUntil: -1e9,
  /**
   * [vfx R2] wall-clock window for the ultimate's CHARGE grade — a dimmer,
   * desaturated, tighter-vignetted picture that the nova then punches out of.
   * Held separately from `ult*` so charge and peak never blend into one look.
   */
  chargeFrom: -1e9,
  chargeUntil: -1e9,
  /**
   * [vfx R2] Bloom governor load, 0..POSTFX.bloomGovernor.maxLoad.
   * Effects that are about to cover a large fraction of the frame in additive
   * energy raise this; PostFX divides bloom intensity by (1 + load) and bleeds
   * it off. Without it a single screen-filling quad pins the whole bloom
   * pyramid and every discrete source in frame disappears into the wash.
   */
  bloomLoad: 0,
  /** [vfx R2] true while a full-screen front-end overlay owns the frame */
  grainSuppressed: false,
}

/** kick the chromatic aberration — one shock, not a sustained offset */
export function caImpulse(amount = 1): void {
  const t = nowSec()
  // a stronger impulse always wins; a weaker one never cuts a live shock short
  const elapsed = t - PostFxSignals.caImpulseAt
  if (elapsed < 0.05 && amount < PostFxSignals.caImpulseAmount) return
  PostFxSignals.caImpulseAt = t
  PostFxSignals.caImpulseAmount = Math.min(1, Math.max(0, amount))
}

/**
 * [vfx R2] Raise the bloom governor. `amount` is roughly "fraction of the
 * frame this effect is about to fill with additive energy"; 1.0 halves bloom.
 */
export function addBloomLoad(amount: number): void {
  const cap = 4
  PostFxSignals.bloomLoad = Math.min(cap, PostFxSignals.bloomLoad + Math.max(0, amount))
}

/** [vfx R2] suppress film grain (front-end screens: grain reads as artefact) */
export function setGrainSuppressed(v: boolean): void {
  PostFxSignals.grainSuppressed = v
}

/** [vfx R2] hold the ultimate CHARGE grade (dim, desaturated) for `durationSec` */
export function ultChargeWindow(durationSec: number): void {
  const t = nowSec()
  PostFxSignals.chargeFrom = t
  PostFxSignals.chargeUntil = Math.max(PostFxSignals.chargeUntil, t + durationSec)
}

/** [vfx R2] cut the charge grade short (the nova has fired) */
export function endChargeWindow(): void {
  PostFxSignals.chargeUntil = nowSec()
}

/** hold the ultimate grade (richer, slightly lifted) for `durationSec` */
export function ultGradeWindow(durationSec: number): void {
  const t = nowSec()
  PostFxSignals.ultFrom = t
  PostFxSignals.ultUntil = Math.max(PostFxSignals.ultUntil, t + durationSec)
}

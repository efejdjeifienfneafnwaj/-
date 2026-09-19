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
import { COLORS } from '../config'

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
}

export interface RingOpts {
  position: THREE.Vector3
  color?: number | string
  maxRadius?: number
  life?: number
  width?: number
}

export interface FlashOpts {
  position: THREE.Vector3
  color?: number | string
  intensity?: number
  distance?: number
  life?: number
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
}

export interface RingCmd {
  x: number
  y: number
  z: number
  color: number
  maxRadius: number
  life: number
  width: number
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

/**
 * AURIC VOW — DamageNumbers.tsx
 * Pooled floating damage numbers (vfx-hud.md §2.7): 32 world-anchored DOM
 * divs projected world→screen each frame. Rise 64px over the 1.1s life
 * (ease-out, ±20px x-drift) at FULL opacity for the first 65% of it, then
 * fade. Same-target 'normal' hits within 0.25s merge into a running total.
 * 'player' events render as ember edge readouts instead of world-anchored
 * numbers.
 *
 * [R2] Size is a log ramp on the amount (a 9 and a 120 must not read the
 * same), the base sizes went 22→30 px (34 px for player damage), the stroke
 * to 3 px, and each number sits on its own dark radial scrim (hud.css) so it
 * survives a blown ivory background — the review's first blocker was that
 * hit feedback is simply never visible in a frame.
 *
 * This component DRAINS store.damageEvents once per frame (its rAF) and
 * forwards every event to the HUD hitmarker queue (drainHitmarkerEvents).
 *
 * Camera binding: VFXSystems calls bindCamera(camera) from useThree; the
 * objective marker in HUD.tsx reads it back via getHudCamera().
 *
 * DOM structure is created once; per-frame work is style writes only.
 */
import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { HUD_FEEDBACK } from '../config'
import { useGameStore, type DamageEvent } from '../store'

const POOL = 32
const RISE_PX = 64
/** [R2] 0.75 → 1.1 s, and full opacity is HELD for the first 65% of it.
 *  The old curve started fading at the halfway mark, so a number was already
 *  translucent by the time the eye found it — the review's first blocker. */
const LIFE_SEC = HUD_FEEDBACK.numberLifeSec
const HOLD_FRAC = HUD_FEEDBACK.numberHoldFrac
const MERGE_WINDOW_SEC = 0.25
const MERGE_DIST = 2
/** scale punch: 1.35 → 1.0 over 120 ms so every number lands with weight */
const PUNCH_SEC = 0.12
const PUNCH_AMOUNT = 0.35
/** log size ramp: a 120 damage crit must not read the same as a 9 */
const SIZE_REF = HUD_FEEDBACK.numberRefAmount
const SIZE_MAX = HUD_FEEDBACK.numberMaxScale
function sizeRamp(amount: number): number {
  if (amount <= 0) return 1
  const r = 1 + Math.log(Math.max(1, amount) / SIZE_REF) * 0.42
  return Math.min(SIZE_MAX, Math.max(0.82, r))
}

// ---------------------------------------------------------------------------
// Module-level camera binding + hitmarker forwarding queue
// ---------------------------------------------------------------------------

let hudCamera: THREE.Camera | null = null

/** called by VFXSystems (inside the Canvas) whenever the camera changes */
export function bindCamera(cam: THREE.Camera): void {
  hudCamera = cam
}

export function unbindCamera(cam: THREE.Camera): void {
  if (hudCamera === cam) hudCamera = null
}

/** read by HUD.tsx for the world-space objective marker */
export function getHudCamera(): THREE.Camera | null {
  return hudCamera
}

const hitQueue: DamageEvent[] = []

/** HUD.tsx drains this once per frame to fire hitmarkers */
export function drainHitmarkerEvents(out: DamageEvent[]): void {
  for (let i = 0; i < hitQueue.length; i++) out.push(hitQueue[i])
  hitQueue.length = 0
}

// ---------------------------------------------------------------------------
// Pool
// ---------------------------------------------------------------------------

interface NumSlot {
  active: boolean
  world: THREE.Vector3
  born: number // seconds (rAF clock)
  amount: number
  kind: DamageEvent['kind']
  driftX: number
  /** screen-space readout for player-taken damage */
  edge: boolean
  /** last written log-size multiplier (so we only touch style on change) */
  ramp: number
}

function makeSlots(): NumSlot[] {
  return Array.from({ length: POOL }, () => ({
    active: false,
    world: new THREE.Vector3(),
    born: 0,
    amount: 0,
    kind: 'normal' as const,
    driftX: 0,
    edge: false,
    ramp: 0,
  }))
}

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3)

/** Pooled floating damage numbers — mount once, next to <HUD/>. */
export default function DamageNumbers() {
  const rootRef = useRef<HTMLDivElement>(null)
  const slotsRef = useRef<NumSlot[]>(makeSlots())

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const els = Array.from(root.children) as HTMLElement[]
    const slots = slotsRef.current
    const proj = new THREE.Vector3()
    let raf = 0
    let last = performance.now()

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick)
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      void dt
      const tNow = now / 1000
      const cam = hudCamera
      const w = window.innerWidth
      const h = window.innerHeight

      // 1) drain the store queue
      const evs = useGameStore.getState().drainDamageEvents()
      for (const ev of evs) {
        if (hitQueue.length < 128) hitQueue.push(ev)

        // merge same-target 'normal' hits inside the window
        if (ev.kind === 'normal') {
          const m = slots.find(
            (s) =>
              s.active &&
              s.kind === 'normal' &&
              !s.edge &&
              tNow - s.born < MERGE_WINDOW_SEC &&
              s.world.distanceTo(ev.position) < MERGE_DIST,
          )
          if (m) {
            m.amount += ev.amount
            // restart life + punch so the merged total lands with weight
            m.born = tNow
            continue
          }
        }

        const slot = slots.find((s) => !s.active) ?? slots[0]
        slot.active = true
        slot.born = tNow
        slot.amount = ev.amount
        slot.kind = ev.kind
        slot.driftX = (Math.random() * 2 - 1) * 20
        slot.edge = ev.kind === 'player'
        // force a size write: this slot may be recycled from a different
        // kind, whose base px differs even at the same ramp
        slot.ramp = 0
        slot.world.copy(ev.position)
      }

      // 2) project + style each live slot
      for (let i = 0; i < POOL; i++) {
        const s = slots[i]
        const el = els[i]
        if (!s.active) {
          if (el.style.opacity !== '0') el.style.opacity = '0'
          continue
        }
        const p = (tNow - s.born) / LIFE_SEC
        if (p >= 1) {
          s.active = false
          el.style.opacity = '0'
          continue
        }

        let x: number
        let y: number
        if (s.edge) {
          // player-taken: bottom-center screen edge readout
          x = w * 0.5 + s.driftX * 4
          y = h * 0.8
        } else {
          if (!cam) {
            s.active = false
            el.style.opacity = '0'
            continue
          }
          proj.copy(s.world).project(cam)
          if (proj.z > 1) {
            el.style.opacity = '0'
            continue
          }
          x = (proj.x * 0.5 + 0.5) * w
          y = (-proj.y * 0.5 + 0.5) * h
        }

        const rise = easeOutCubic(p) * RISE_PX
        const opacity = p > HOLD_FRAC ? 1 - (p - HOLD_FRAC) / (1 - HOLD_FRAC) : 1
        const age = tNow - s.born
        const punch = age < PUNCH_SEC ? 1 + PUNCH_AMOUNT * (1 - age / PUNCH_SEC) : 1
        const txt = String(Math.round(s.amount))
        if (el.textContent !== txt) el.textContent = txt
        const cls = `dmg dmg-${s.kind}`
        if (el.className !== cls) el.className = cls
        // log ramp on the amount — written only when it actually changes
        const ramp = sizeRamp(s.amount)
        if (Math.abs(ramp - s.ramp) > 0.01) {
          s.ramp = ramp
          el.style.fontSize = `${(
            (s.edge ? HUD_FEEDBACK.numberPlayerPx : HUD_FEEDBACK.numberBasePx) * ramp
          ).toFixed(1)}px`
        }
        el.style.opacity = opacity.toFixed(3)
        el.style.transform =
          `translate3d(${(x + s.driftX * p).toFixed(1)}px, ${(y - rise).toFixed(1)}px, 0) translate(-50%, -100%) scale(${punch.toFixed(3)})`
      }
    }

    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <div ref={rootRef} className="dmg-layer" aria-hidden="true">
      {Array.from({ length: POOL }, (_, i) => (
        <div key={i} className="dmg" style={{ opacity: 0 }} />
      ))}
    </div>
  )
}

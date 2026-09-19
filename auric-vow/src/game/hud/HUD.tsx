/**
 * AURIC VOW — HUD.tsx
 * Full DOM overlay HUD (design.md §5 / vfx-hud.md §2). pointer-events:none.
 *
 * R2 art pass (enemies-hud work order):
 *  · the mission plate left the centre axis — it hangs under the radar in the
 *    upper-left now, and the distance span leaves the layout entirely when
 *    there is no objective instead of printing an em-dash;
 *  · world-projected enemy nameplates (health + stagger + faction glyph) held
 *    3 s after damage or while aimed at, so a hit is visible on the target;
 *  · the kill hitmarker fires on kills rather than on every ability hit, and
 *    the four tiers are now visually distinct;
 *  · shield numeric with a change flash and a shield-break wash, ammo as
 *    mag/reserve with a low state, an ability cast animation on the same slot
 *    index the tray draws, and a reticle that goes hostile on target;
 *  · the radar gained a wall mask sampled from the collider registry, an
 *    objective bearing pip and elevation glyphs.
 *
 * R1 art pass. Four anchors became three: a contiguous bottom-left L-cluster
 * (vitals → energy → ability tray, energy directly above the diamonds it
 * funds), a bottom-right weapon strip, and ONE top-centre mission plate that
 * swallowed the old objective toast (verb line, wave pips + hostile count,
 * right-aligned tabular distance behind a hairline). New: a diegetic
 * gold-ringed radar, off-screen threat chevrons for hostiles that are
 * actually shooting, a Heavy boss bar, and directional damage arcs.
 *
 * Performance model is unchanged: React renders the static skeleton once; a
 * single rAF loop drives every dynamic element via direct style writes — no
 * per-frame React re-render, no per-frame allocation.
 */
import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import {
  ABILITIES,
  COLORS,
  ENEMY_FX,
  HUD_RADAR,
  MISSION,
  PLAYER,
  type MissionPhaseId,
} from '../config'
import { useGameStore, type DamageEvent } from '../store'
import { Input } from '../Input'
import { PlayerRef } from '@/game/player/PlayerRef'
import { CamRef } from '@/game/player/CameraRig'
import { EnemyRegistry, type EnemyHandle } from '@/game/enemies/EnemyRegistry'
import { getColliders } from '@/game/world/Colliders'
import { CombatState } from '@/game/combat/state'
import { SpawnStatus } from '@/game/enemies/EnemyManager'
import { activeThreats, type ThreatMark } from '@/game/enemies/ai'
import {
  abilityState,
  resetAbilities,
  tickCooldowns,
} from './abilityState'
import { ammoState, resetAmmo, tickReload } from './ammoState'
import { enemyState } from './enemyState'
import { drainHitmarkerEvents, getHudCamera } from './DamageNumbers'
import './hud.css'

// ---------------------------------------------------------------------------
// Static per-phase copy
// ---------------------------------------------------------------------------

const PHASE_BANNER: Partial<Record<MissionPhaseId, string>> = {
  DROPSHIP: MISSION.titleCard,
  INFILTRATE: 'INFILTRATE',
  OBJECTIVE: 'THE NULL RELIQUARY',
  EXTERMINATE: 'EXTERMINATE',
  EXTRACT: 'EXTRACT',
}

/** verb-first objective copy — one imperative, no sentence case (H11) */
const PHASE_OBJECTIVE: Record<MissionPhaseId, string> = {
  DROPSHIP: 'Approach the Anvil of Silence',
  INFILTRATE: 'Breach the Reliquary chamber',
  OBJECTIVE: 'Hold position — purify the Reliquary',
  EXTERMINATE: 'Purge the Cadence',
  EXTRACT: 'Reach the extraction beacon',
  WIN: 'Mission complete',
  LOSE: 'Vessel lost',
}

const ABILITY_KEYS = [ABILITIES.A1.key, ABILITIES.A2.key, ABILITIES.A3.key, ABILITIES.A4.key]
const ABILITY_NAMES = [ABILITIES.A1.name, ABILITIES.A2.name, ABILITIES.A3.name, ABILITIES.A4.name]
const OVERSHIELD_MAX = ABILITIES.A3.extra?.overshield ?? 100
const ENERGY_NOTCHES = [25, 50, 75, 150]
const LOW_HP = PLAYER.maxHealth * 0.3
const THREAT_SLOTS = 6
const HITDIR_SLOTS = 4
const RADAR_RANGE = HUD_RADAR.range
const NP_SLOTS = ENEMY_FX.nameplate.pool
const NP_RANGE = ENEMY_FX.nameplate.range
const NP_HOLD = ENEMY_FX.nameplate.holdSec
const NP_AIM_COS = Math.cos(THREE.MathUtils.degToRad(ENEMY_FX.nameplate.aimDeg))
/** per-type nameplate copy — the faction glyph read, not a debug label */
const NP_NAME: Record<string, string> = {
  drone: 'CHIRP',
  trooper: 'VOTARY',
  heavy: 'CANTOR',
}
/** reticle turns hostile when the aim axis is inside this cone of an enemy */
const RET_HOSTILE_COS = Math.cos(THREE.MathUtils.degToRad(3.2))

const _fwd = new THREE.Vector3()
const _toE = new THREE.Vector3()
const _np = new THREE.Vector3()
const _camPos = new THREE.Vector3()

// ---------------------------------------------------------------------------
// Inline glyphs (SVG — no emoji, no icon font). One silhouette idea each,
// drawn on a shared 24×24 grid with 2 px strokes.
// ---------------------------------------------------------------------------

function AbilityGlyph({ i }: { i: number }) {
  switch (i) {
    // A1 Gilt Dash — chevron trail
    case 0:
      return (
        <svg viewBox="0 0 24 24" className="ab-glyph">
          <path d="M3.5 5.5L10 12l-6.5 6.5" />
          <path d="M11 5.5L17.5 12 11 18.5" />
          <path d="M18.5 8.5L22 12l-3.5 3.5" opacity="0.55" />
        </svg>
      )
    // A2 Sunspike Volley — spear fan
    case 1:
      return (
        <svg viewBox="0 0 24 24" className="ab-glyph">
          <path d="M12 2.5v14" />
          <path d="M12 2.5l2.4 3.6h-4.8z" fill="currentColor" stroke="none" />
          <path d="M4.6 6.2l5.2 11.4" />
          <path d="M4.6 6.2l3.9 1.7-2.4 1.5z" fill="currentColor" stroke="none" />
          <path d="M19.4 6.2l-5.2 11.4" />
          <path d="M19.4 6.2l-3.9 1.7 2.4 1.5z" fill="currentColor" stroke="none" />
          <path d="M6 21h12" opacity="0.5" />
        </svg>
      )
    // A3 Aegis Halo — closed ring
    case 2:
      return (
        <svg viewBox="0 0 24 24" className="ab-glyph">
          <circle cx="12" cy="12" r="8.2" />
          <circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" />
          <path d="M12 1.6v2.6M22.4 12h-2.6M12 22.4v-2.6M1.6 12h2.6" strokeLinecap="round" />
        </svg>
      )
    // A4 Auric Requiem — filled starburst
    default:
      return (
        <svg viewBox="0 0 24 24" className="ab-glyph">
          <path
            d="M12 0.8l2.6 7.2 7.2-2.6-4.6 6.6 4.6 6.6-7.2-2.6L12 23.2l-2.6-7.2-7.2 2.6 4.6-6.6L2.2 5.4l7.2 2.6z"
            fill="currentColor"
            stroke="none"
          />
        </svg>
      )
  }
}

/** hostile glyph prefixing the mission-plate hostile count */
function HostileGlyph() {
  return (
    <svg viewBox="0 0 16 16" className="wc-glyph" aria-hidden="true">
      <path d="M8 1.4l4.6 3v6.2L8 14.6l-4.6-4V4.4z" fill="none" strokeWidth="1.4" />
      <path d="M8 5.2v5.6M5.4 8h5.2" fill="none" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}

function ShieldGlyph() {
  return (
    <svg viewBox="0 0 16 16" className="v-glyph shield" aria-hidden="true">
      <path d="M8 1.3l5.4 2.1v4.2c0 3.2-2.3 5.6-5.4 7.1-3.1-1.5-5.4-3.9-5.4-7.1V3.4z" />
    </svg>
  )
}

function VitaeGlyph() {
  return (
    <svg viewBox="0 0 16 16" className="v-glyph vitae" aria-hidden="true">
      <path d="M8 1.2l4.4 6.6L8 14.8 3.6 7.8z" />
      <path d="M8 4.6l2.2 3.3L8 11.2 5.8 7.9z" opacity="0.6" />
    </svg>
  )
}

function RifleGlyph({ active }: { active?: boolean }) {
  return (
    <svg viewBox="0 0 32 14" className={active ? 'weapon-glyph on' : 'weapon-glyph'}>
      <path
        d="M1 8h18l3-3h4l2 2 3-1v3l-4 1-2 3h-4l1-3H12l-2 2H7l1-2H1z"
        fill="none"
        strokeWidth="1.4"
      />
    </svg>
  )
}

function KatanaGlyph({ active }: { active?: boolean }) {
  return (
    <svg viewBox="0 0 14 32" className={active ? 'weapon-glyph katana on' : 'weapon-glyph katana'}>
      <path d="M7 1v22M4 23h6M7 25v6" fill="none" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Screen projection that survives the camera being turned away (H1)
// ---------------------------------------------------------------------------

const _view = new THREE.Vector3()
const _proj = new THREE.Vector3()

interface ScreenPoint {
  x: number
  y: number
  /** clamped to the border (behind camera or outside the safe frame) */
  off: boolean
  /** bearing from screen centre, radians, 0 = up */
  angle: number
}

const _pt: ScreenPoint = { x: 0, y: 0, off: false, angle: 0 }

function projectPoint(
  world: THREE.Vector3,
  cam: THREE.Camera,
  w: number,
  h: number,
  margin: number,
): ScreenPoint {
  _view.copy(world).applyMatrix4(cam.matrixWorldInverse)
  let x: number
  let y: number
  let behind = false
  if (_view.z < -0.05) {
    _proj.copy(world).project(cam)
    x = (_proj.x * 0.5 + 0.5) * w
    y = (-_proj.y * 0.5 + 0.5) * h
  } else {
    // behind the camera: push far out along the view-space bearing so the
    // clamp below lands it on the correct edge (never a mirrored x + pinned y)
    behind = true
    let dx = _view.x
    let dy = -_view.y
    const len = Math.hypot(dx, dy)
    if (len < 0.0001) {
      dx = 0
      dy = 1
    } else {
      dx /= len
      dy /= len
    }
    x = w * 0.5 + dx * w
    y = h * 0.5 + dy * h
  }
  const cx = Math.min(w - margin, Math.max(margin, x))
  const cy = Math.min(h - margin, Math.max(margin, y))
  _pt.off = behind || cx !== x || cy !== y
  _pt.x = cx
  _pt.y = cy
  _pt.angle = Math.atan2(cy - h * 0.5, cx - w * 0.5)
  return _pt
}

// ---------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------

export default function HUD() {
  const phase = useGameStore((s) => s.phase)
  const wave = useGameStore((s) => s.wave)
  const [banner, setBanner] = useState<{ text: string; key: number } | null>(null)

  // reset per-run mutable registries when a run restarts
  useEffect(() => {
    if (phase === 'DROPSHIP') {
      resetAbilities()
      resetAmmo()
    }
  }, [phase])

  // phase banner: enter 0.6s → hold 2.2s → fade 0.5s
  useEffect(() => {
    const text = PHASE_BANNER[phase]
    if (!text || phase === 'WIN' || phase === 'LOSE') return
    setBanner({ text, key: Date.now() })
    const t = setTimeout(() => setBanner(null), 3300)
    return () => clearTimeout(t)
  }, [phase])

  // ---- element refs driven by the rAF loop ----
  const rootRef = useRef<HTMLDivElement>(null)
  const hpFillRef = useRef<HTMLDivElement>(null)
  const hpTextRef = useRef<HTMLSpanElement>(null)
  const shFillRef = useRef<HTMLDivElement>(null)
  const shTextRef = useRef<HTMLSpanElement>(null)
  const vitalsRef = useRef<HTMLDivElement>(null)
  const shieldVigRef = useRef<HTMLDivElement>(null)
  const osFillRef = useRef<HTMLDivElement>(null)
  const enFillRef = useRef<HTMLDivElement>(null)
  const enTextRef = useRef<HTMLSpanElement>(null)
  const abRootRef = useRef<HTMLDivElement>(null)
  const ammoTextRef = useRef<HTMLSpanElement>(null)
  const ammoResRef = useRef<HTMLSpanElement>(null)
  const weaponRef = useRef<HTMLDivElement>(null)
  const reloadArcRef = useRef<HTMLDivElement>(null)
  const reticleRef = useRef<HTMLDivElement>(null)
  const retTickRefs = useRef<(SVGGElement | null)[]>([null, null, null, null])
  const hitRef = useRef<HTMLDivElement>(null)
  const dmgVigRef = useRef<HTMLDivElement>(null)
  const critVigRef = useRef<HTMLDivElement>(null)
  const hitdirRef = useRef<HTMLDivElement>(null)
  const objDistRef = useRef<HTMLSpanElement>(null)
  const timerRef = useRef<HTMLDivElement>(null)
  const aliveRef = useRef<HTMLSpanElement>(null)
  const markerRef = useRef<HTMLDivElement>(null)
  const radarRef = useRef<HTMLCanvasElement>(null)
  const threatRef = useRef<HTMLDivElement>(null)
  const bossRef = useRef<HTMLDivElement>(null)
  const bossFillRef = useRef<HTMLDivElement>(null)
  const bossStagRef = useRef<HTMLDivElement>(null)
  const bossSubRef = useRef<HTMLSpanElement>(null)
  const channelRef = useRef<HTMLDivElement>(null)
  const chArcRef = useRef<SVGCircleElement>(null)
  const chDotRef = useRef<SVGCircleElement>(null)
  const chPctRef = useRef<SVGTextElement>(null)
  const plateRef = useRef<HTMLDivElement>(null)
  const npRef = useRef<HTMLDivElement>(null)

  // objective/phase change → 250 ms slide + gold flash on the mission plate
  useEffect(() => {
    const el = plateRef.current
    if (!el) return
    el.classList.remove('changed')
    void el.offsetWidth
    el.classList.add('changed')
  }, [phase])

  useEffect(() => {
    const abEls = abRootRef.current
      ? (Array.from(abRootRef.current.querySelectorAll('.ability')) as HTMLElement[])
      : []
    const sweeps = abEls.map((e) => e.querySelector('.ab-sweep') as HTMLElement)
    const edges = abEls.map((e) => e.querySelector('.ab-edge') as HTMLElement)
    const actives = abEls.map((e) => e.querySelector('.ab-active') as HTMLElement)
    const threatEls = threatRef.current
      ? (Array.from(threatRef.current.children) as HTMLElement[])
      : []
    const hitdirEls = hitdirRef.current
      ? (Array.from(hitdirRef.current.children) as HTMLElement[])
      : []
    // nameplate pool: one DOM subtree per slot, resolved once
    const npEls = npRef.current ? (Array.from(npRef.current.children) as HTMLElement[]) : []
    const npParts = npEls.map((el) => ({
      root: el,
      glyph: el.querySelector('.np-glyph') as HTMLElement,
      name: el.querySelector('.np-name') as HTMLElement,
      fill: el.querySelector('.np-fill') as HTMLElement,
      stag: el.querySelector('.np-stag') as HTMLElement,
    }))
    /** id → rAF-clock seconds of the last damage taken (nameplate hold) */
    const damagedAt = new Map<number, number>()
    /** per-slot binding, rebuilt each frame without allocating */
    const npBound: (EnemyHandle | null)[] = new Array(NP_SLOTS).fill(null)
    const npLastId = new Array<number>(NP_SLOTS).fill(-1)

    const hitDrain: DamageEvent[] = []
    const threatList: ThreatMark[] = []
    /** live directional damage arcs: bearing (rad, world) + age */
    const hitdirs = Array.from({ length: HITDIR_SLOTS }, () => ({ yaw: 0, t: 0 }))
    let hitdirNext = 0
    let raf = 0
    let last = performance.now()
    // smoothed display values (bar lerps)
    let dHp = PLAYER.maxHealth
    let dShield = PLAYER.maxShield
    let dEnergy = PLAYER.maxEnergy
    let spread = 6
    let prevVitals = PLAYER.maxHealth + PLAYER.maxShield
    let lastHpText = ''
    let lastShText = ''
    let lastEnText = ''
    let lastAmmoText = ''
    let lastResText = ''
    let wasMelee = false
    let lastDistText = ''
    let distOff = true
    let lastTimerText = ''
    let lastAliveText = ''
    let lastPctText = ''
    let lastSpread = -1
    const lastSweepDeg = [-1, -1, -1, -1]
    const wasCooling = [false, false, false, false]
    const wasPoor = [false, false, false, false]
    let reloading = false
    let bossShown = false
    let lastBossSub = ''

    // radar canvas — backing store sized once to the device pixel ratio
    const radar = radarRef.current
    const rctx = radar ? radar.getContext('2d') : null
    const rdpr = Math.min(2, window.devicePixelRatio || 1)
    let rSize = 0
    const sizeRadar = () => {
      if (!radar) return
      rSize = radar.clientWidth || HUD_RADAR.size
      radar.width = Math.round(rSize * rdpr)
      radar.height = Math.round(rSize * rdpr)
    }
    sizeRadar()
    window.addEventListener('resize', sizeRadar)

    const retrigger = (el: HTMLElement | null, cls: string) => {
      if (!el) return
      el.classList.remove(cls)
      void el.offsetWidth // restart CSS animation
      el.classList.add(cls)
    }

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick)
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      const tNow = now / 1000
      const s = useGameStore.getState()

      tickCooldowns(dt)
      tickReload(dt)

      // -- vitals bars (lerped) --------------------------------------------
      const k = Math.min(1, dt * 12)
      dHp += (s.hp - dHp) * k
      dShield += (s.shield - dShield) * k
      dEnergy += (s.energy - dEnergy) * k
      if (hpFillRef.current) {
        hpFillRef.current.style.transform = `scaleX(${(dHp / PLAYER.maxHealth).toFixed(4)})`
        hpFillRef.current.classList.toggle('low', s.hp <= LOW_HP)
      }
      const hpText = String(Math.ceil(s.hp))
      if (hpText !== lastHpText && hpTextRef.current) {
        hpTextRef.current.textContent = hpText
        lastHpText = hpText
      }
      if (shFillRef.current)
        shFillRef.current.style.transform = `scaleX(${(dShield / PLAYER.maxShield).toFixed(4)})`
      const shText = String(Math.ceil(s.shield))
      if (shText !== lastShText) {
        if (shTextRef.current) {
          shTextRef.current.textContent = shText
          // a change flash on the numeral, so shield loss is felt not read
          retrigger(shTextRef.current, 'chg')
        }
        // shield BREAK is its own event: vitals flash + a screen-edge wash
        if (s.shield <= 0 && Number(lastShText) > 0) {
          retrigger(vitalsRef.current, 'broke')
          retrigger(shieldVigRef.current, 'flash')
        }
        lastShText = shText
      }
      if (osFillRef.current)
        osFillRef.current.style.transform = `scaleX(${Math.min(1, abilityState.overshield / OVERSHIELD_MAX).toFixed(4)})`
      if (enFillRef.current)
        enFillRef.current.style.transform = `scaleX(${(dEnergy / PLAYER.maxEnergy).toFixed(4)})`
      const enText = String(Math.round(s.energy))
      if (enText !== lastEnText && enTextRef.current) {
        enTextRef.current.textContent = enText
        lastEnText = enText
      }

      // -- player damaged → edge flash + low-hp pulse -----------------------
      const vit = s.hp + s.shield
      if (vit < prevVitals - 0.01) retrigger(dmgVigRef.current, 'flash')
      prevVitals = vit
      rootRef.current?.classList.toggle('low-hp', s.hp <= LOW_HP && s.phase !== 'WIN' && s.phase !== 'LOSE')

      // -- ability diamonds -------------------------------------------------
      for (let i = 0; i < 4; i++) {
        const cd = abilityState.cooldowns[i]
        const max = abilityState.cooldownMax[i] || 1
        const frac = cd > 0 ? cd / max : 0
        const deg = Math.round((frac * 360) / 3) * 3 // quantize → fewer repaints
        if (deg !== lastSweepDeg[i]) {
          lastSweepDeg[i] = deg
          sweeps[i].style.background =
            deg > 0 ? `conic-gradient(rgba(6,7,10,0.82) ${deg}deg, transparent ${deg}deg)` : 'none'
          if (edges[i]) {
            edges[i].style.opacity = deg > 0 ? '1' : '0'
            edges[i].style.transform = deg > 0 ? `rotate(${deg}deg)` : 'none'
          }
        }
        const cooling = cd > 0
        if (wasCooling[i] && !cooling) retrigger(abEls[i], 'ready')
        // rising edge = the cast that started this cooldown. This also
        // AUDITS the index contract the review asked about: the slot that
        // animates is the same slot whose sweep and cost are drawn, so a
        // mismatched cast index would be visible immediately.
        if (!wasCooling[i] && cooling) retrigger(abEls[i], 'cast')
        wasCooling[i] = cooling
        const poor = s.energy < abilityState.costs[i]
        if (poor !== wasPoor[i]) {
          wasPoor[i] = poor
          abEls[i].classList.toggle('poor', poor)
        }
        const aMax = abilityState.activeMax[i]
        const aFrac = aMax > 0 && abilityState.actives[i] > 0 ? abilityState.actives[i] / aMax : 0
        actives[i].style.background =
          aFrac > 0
            ? `conic-gradient(${COLORS.aureate} ${Math.round(aFrac * 360)}deg, transparent 0deg)`
            : 'none'
        abEls[i].classList.toggle('on', aFrac > 0)
      }

      // -- weapon panel -------------------------------------------------------
      if (ammoState.reloading !== reloading) {
        reloading = ammoState.reloading
        reloadArcRef.current?.classList.toggle('show', reloading)
        ammoTextRef.current?.classList.toggle('hide', reloading)
      }
      if (reloading && reloadArcRef.current) {
        const deg = Math.round((ammoState.reloadT / ammoState.reloadSec) * 360)
        reloadArcRef.current.style.background = `conic-gradient(${COLORS.aureate} ${deg}deg, rgba(138,143,163,0.22) ${deg}deg)`
      }
      const ammoText = String(ammoState.mag)
      if (ammoText !== lastAmmoText) {
        if (ammoTextRef.current) ammoTextRef.current.textContent = ammoText
        lastAmmoText = ammoText
        // under a quarter mag the count goes ember — a state, not a number
        ammoTextRef.current?.classList.toggle('low', ammoState.mag / ammoState.magSize < 0.25)
      }
      const resText = ammoState.reserve === Infinity ? '/ ∞' : `/ ${Math.floor(ammoState.reserve)}`
      if (resText !== lastResText && ammoResRef.current) {
        ammoResRef.current.textContent = resText
        lastResText = resText
      }
      // the katana has no equip slot — it is "active" while a swing is live
      const melee = CombatState.swing !== null
      if (melee !== wasMelee) {
        wasMelee = melee
        weaponRef.current?.classList.toggle('melee', melee)
      }

      // -- reticle ------------------------------------------------------------
      const firing = Input.held('fire')
      const aiming = Input.held('aim')
      const target = aiming ? 2 : firing ? 17 : 7
      spread += (target - spread) * Math.min(1, dt * 12)
      const sQ = Math.round(spread * 2) / 2
      if (sQ !== lastSpread) {
        lastSpread = sQ
        const t = retTickRefs.current
        t[0]?.setAttribute('transform', `translate(0,${-sQ})`)
        t[1]?.setAttribute('transform', `translate(0,${sQ})`)
        t[2]?.setAttribute('transform', `translate(${-sQ},0)`)
        t[3]?.setAttribute('transform', `translate(${sQ},0)`)
      }
      reticleRef.current?.classList.toggle('aim', aiming)

      // -- hitmarker (events drained by DamageNumbers) ------------------------
      drainHitmarkerEvents(hitDrain)
      let hitKind: 'normal' | 'headshot' | 'ability' | 'kill' | null = null
      for (const ev of hitDrain) {
        if (ev.kind === 'player') {
          // directional arc: bearing of the damage source relative to the view
          const slot = hitdirs[hitdirNext % HITDIR_SLOTS]
          hitdirNext++
          const dx = ev.position.x - PlayerRef.position.x
          const dz = ev.position.z - PlayerRef.position.z
          // camera basis: forward (-sin yaw, -cos yaw), right (cos yaw, -sin yaw).
          // screen bearing = atan2(right·d, forward·d), clockwise from up.
          const cyaw = Math.cos(CamRef.yaw)
          const syaw = Math.sin(CamRef.yaw)
          slot.yaw = Math.atan2(dx * cyaw + dz * -syaw, dx * -syaw + dz * -cyaw)
          slot.t = 0.75
          continue
        }
        if (ev.kind === 'ability') hitKind = hitKind === 'kill' ? 'kill' : 'ability'
        else if (ev.kind === 'headshot' && hitKind !== 'ability' && hitKind !== 'kill')
          hitKind = 'headshot'
        else if (!hitKind) hitKind = 'normal'

        // bind the hit to whichever hostile it landed on, so that enemy holds
        // a health plate for NP_HOLD seconds (the review's "persistent
        // per-enemy health bar off drainHitmarkerEvents")
        const hits = EnemyRegistry.list()
        let bestId = -1
        let bestD = 9
        for (let i = 0; i < hits.length; i++) {
          const en = hits[i]
          if (!en.alive) continue
          const d = en.headPosition.distanceToSquared(ev.position)
          if (d < bestD) {
            bestD = d
            bestId = en.id
          }
        }
        if (bestId >= 0) {
          damagedAt.set(bestId, tNow)
          // [H10] the kill marker is for KILLS. It used to fire on every
          // ability hit, so the strongest piece of feedback in the game was
          // also the most common one.
          for (let i = 0; i < hits.length; i++) {
            if (hits[i].id === bestId && !hits[i].alive) hitKind = 'kill'
          }
        }
      }
      hitDrain.length = 0
      if (hitKind && hitRef.current) {
        hitRef.current.className = 'hitmarker'
        retrigger(
          hitRef.current,
          hitKind === 'kill'
            ? 'hm-kill'
            : hitKind === 'headshot'
              ? 'hm-crit'
              : hitKind === 'ability'
                ? 'hm-ability'
                : 'hm-hit',
        )
        if (hitKind === 'kill' || hitKind === 'headshot') retrigger(critVigRef.current, 'flash')
      }

      // -- directional damage arcs -------------------------------------------
      for (let i = 0; i < HITDIR_SLOTS; i++) {
        const d = hitdirs[i]
        const el = hitdirEls[i]
        if (!el) continue
        if (d.t <= 0) {
          if (el.style.opacity !== '0') el.style.opacity = '0'
          continue
        }
        d.t = Math.max(0, d.t - dt)
        el.style.opacity = (Math.min(1, d.t / 0.35) * 0.9).toFixed(3)
        el.style.transform = `rotate(${(d.yaw * 180) / Math.PI}deg)`
      }

      // -- objective distance + extraction timer ------------------------------
      const obj = s.objectivePosition
      if (obj) {
        const d = Math.round(PlayerRef.position.distanceTo(obj))
        const distText = `${d} M`
        if (distText !== lastDistText && objDistRef.current) {
          objDistRef.current.textContent = distText
          lastDistText = distText
        }
        if (distOff) {
          distOff = false
          objDistRef.current?.classList.remove('off')
        }
      } else if (!distOff) {
        // [R2 blocker] no objective → the span AND its hairline divider leave
        // the layout, instead of printing an em-dash in most of the frames
        distOff = true
        lastDistText = ''
        objDistRef.current?.classList.add('off')
      }

      if (s.phase === 'EXTRACT' && timerRef.current) {
        const t = Math.max(0, Math.ceil(s.extractionTimer))
        const txt = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`
        if (txt !== lastTimerText) {
          timerRef.current.textContent = txt
          lastTimerText = txt
        }
        timerRef.current.classList.toggle('urgent', s.extractionTimer < 15)
      }

      // -- hostile count: alive + still-queued, so it never reads "× 0" -------
      if (aliveRef.current) {
        const remaining = enemyState.alive + Math.max(0, SpawnStatus.pending)
        const txt = `× ${remaining}`
        if (txt !== lastAliveText) {
          aliveRef.current.textContent = txt
          lastAliveText = txt
        }
      }

      const cam = getHudCamera()
      const w = window.innerWidth
      const h = window.innerHeight

      // -- channel arc, anchored to the Reliquary in world space ---------------
      const channel = channelRef.current
      if (channel) {
        if (s.phase !== 'OBJECTIVE' || !obj || !cam) {
          channel.style.opacity = '0'
        } else {
          const p = projectPoint(obj, cam, w, h, 60)
          channel.style.opacity = p.off ? '0.35' : '1'
          channel.style.transform = `translate3d(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px, 0)`
          const C = 2 * Math.PI * 22
          if (chArcRef.current) {
            chArcRef.current.style.strokeDasharray = `${C}`
            chArcRef.current.style.strokeDashoffset = `${(C * (1 - s.channelProgress)).toFixed(2)}`
          }
          if (chDotRef.current) {
            const a = -Math.PI / 2 + s.channelProgress * Math.PI * 2
            chDotRef.current.setAttribute('cx', (27 + Math.cos(a) * 22).toFixed(2))
            chDotRef.current.setAttribute('cy', (27 + Math.sin(a) * 22).toFixed(2))
          }
          const pct = `${Math.round(s.channelProgress * 100)}%`
          if (pct !== lastPctText && chPctRef.current) {
            chPctRef.current.textContent = pct
            lastPctText = pct
          }
        }
      }

      // -- world-space objective marker ----------------------------------------
      const marker = markerRef.current
      if (marker) {
        if (!obj || !cam || s.phase === 'DROPSHIP' || s.phase === 'WIN' || s.phase === 'LOSE') {
          marker.style.opacity = '0'
        } else {
          const dist = PlayerRef.position.distanceTo(obj)
          const p = projectPoint(obj, cam, w, h, 26)
          marker.classList.toggle('edge', p.off)
          // [R2 #8/#14] The marker rests ABOVE the aim point and gets out of
          // the way of it: opacity is multiplied by a smoothstep over
          // 45–110 px from screen centre, it shrinks with distance, and it is
          // suppressed entirely while the channel gauge is drawing the same
          // objective.
          const cdx = p.x - w * 0.5
          const cdy = p.y - h * 0.5
          const centre = Math.hypot(cdx, cdy)
          const tC = THREE.MathUtils.clamp((centre - 45) / 65, 0, 1)
          const centreFade = p.off ? 1 : tC * tC * (3 - 2 * tC)
          const near = dist < 5 ? 0 : dist < 7 ? (dist - 5) / 2 : 1
          const channelOwns = s.phase === 'OBJECTIVE' && (channelRef.current?.style.opacity ?? '0') !== '0'
          marker.style.opacity = channelOwns ? '0' : (near * centreFade * 0.55).toFixed(3)
          const mScale = THREE.MathUtils.clamp(1.15 - dist * 0.006, 0.62, 1.15)
          marker.style.transform =
            `translate3d(${p.x.toFixed(1)}px, ${(p.y - (p.off ? 0 : 16)).toFixed(1)}px, 0) rotate(${p.off ? ((p.angle + Math.PI / 2) * 180) / Math.PI : 0}deg) scale(${mScale.toFixed(3)})`
        }
      }

      // -- radar + threat chevrons + boss bar -----------------------------------
      const list = EnemyRegistry.list()

      // radar: hostiles within range, rotated into camera space
      if (rctx && rSize > 0) {
        const px = rSize * rdpr
        rctx.setTransform(1, 0, 0, 1, 0, 0)
        rctx.clearRect(0, 0, px, px)
        rctx.setTransform(rdpr, 0, 0, rdpr, 0, 0)
        const c = rSize * 0.5
        const scale = (rSize * 0.5 - 12) / RADAR_RANGE
        const rc = Math.cos(CamRef.yaw)
        const rs = Math.sin(CamRef.yaw)

        // --- wall mask (R2 #11): the level's own footprint behind the blips.
        // Without it the radar is dots on a disc and tells the player nothing
        // about cover. Static AABBs, clipped to the plate, drawn once a frame.
        rctx.save()
        rctx.beginPath()
        rctx.arc(c, c, rSize * 0.5 - 7, 0, Math.PI * 2)
        rctx.clip()
        rctx.fillStyle = 'rgba(212,222,240,0.10)'
        const cols = getColliders()
        const px0 = PlayerRef.position.x
        const pz0 = PlayerRef.position.z
        for (let i = 0; i < cols.length; i++) {
          const col = cols[i]
          // walls only: platforms and galleries are walkable, and painting
          // them turns the plate into a solid sheet instead of a floorplan
          if (!col.tags.includes('wall')) continue
          const bx0 = col.box.min.x
          const bx1 = col.box.max.x
          const bz0 = col.box.min.z
          const bz1 = col.box.max.z
          // cheap reject: nearest point of the AABB outside the radar disc
          const nx = Math.max(bx0, Math.min(px0, bx1)) - px0
          const nz = Math.max(bz0, Math.min(pz0, bz1)) - pz0
          if (nx * nx + nz * nz > RADAR_RANGE * RADAR_RANGE) continue
          rctx.beginPath()
          for (let k = 0; k < 4; k++) {
            const wx = (k === 0 || k === 3 ? bx0 : bx1) - px0
            const wz = (k < 2 ? bz0 : bz1) - pz0
            const fwd = wx * -rs + wz * -rc
            const rgt = wx * rc + wz * -rs
            const sx = c + rgt * scale
            const sy2 = c - fwd * scale
            if (k === 0) rctx.moveTo(sx, sy2)
            else rctx.lineTo(sx, sy2)
          }
          rctx.closePath()
          rctx.fill()
        }
        rctx.restore()

        // facing wedge
        rctx.fillStyle = 'rgba(255,184,53,0.13)'
        rctx.beginPath()
        rctx.moveTo(c, c)
        rctx.arc(c, c, rSize * 0.42, -Math.PI / 2 - 0.55, -Math.PI / 2 + 0.55)
        rctx.closePath()
        rctx.fill()
        // player chevron
        rctx.fillStyle = '#FFF3D6'
        rctx.beginPath()
        rctx.moveTo(c, c - 5.5)
        rctx.lineTo(c + 4, c + 4)
        rctx.lineTo(c, c + 1.6)
        rctx.lineTo(c - 4, c + 4)
        rctx.closePath()
        rctx.fill()

        const cy = Math.cos(CamRef.yaw)
        const sy = Math.sin(CamRef.yaw)
        for (let i = 0; i < list.length; i++) {
          const e = list[i]
          if (!e.alive) continue
          const dx = e.position.x - PlayerRef.position.x
          const dz = e.position.z - PlayerRef.position.z
          const d = Math.hypot(dx, dz)
          if (d > RADAR_RANGE) continue
          // camera basis: forward = (-sin yaw, -cos yaw), right = (cos yaw, -sin yaw)
          const fwd = dx * -sy + dz * -cy
          const rgt = dx * cy + dz * -sy
          const bx = c + rgt * scale
          const by = c - fwd * scale
          const heavy = e.type === 'heavy'
          const drone = e.type === 'drone'
          const r = heavy ? 5.5 : 4
          // chevron points back toward the player — "incoming"
          const a = Math.atan2(c - bx, by - c)
          rctx.save()
          rctx.translate(bx, by)
          rctx.rotate(a)
          rctx.beginPath()
          rctx.moveTo(0, -r)
          rctx.lineTo(r * 0.85, r * 0.7)
          rctx.lineTo(0, r * 0.22)
          rctx.lineTo(-r * 0.85, r * 0.7)
          rctx.closePath()
          if (drone) {
            rctx.strokeStyle = '#FF5A66'
            rctx.lineWidth = 1.3
            rctx.stroke()
          } else {
            rctx.fillStyle = heavy ? '#FF7A72' : '#E8404F'
            rctx.fill()
          }
          // elevation tick: a hostile 2 m above or below the player reads as
          // a different glyph, not as the same dot on a flat disc
          const dy = e.position.y - PlayerRef.position.y
          if (Math.abs(dy) > 1.8) {
            rctx.strokeStyle = 'rgba(255,214,214,0.85)'
            rctx.lineWidth = 1.1
            rctx.beginPath()
            const s0 = dy > 0 ? -1 : 1
            rctx.moveTo(-3, r * 1.15 * s0 + 2.5 * s0)
            rctx.lineTo(0, r * 1.15 * s0)
            rctx.lineTo(3, r * 1.15 * s0 + 2.5 * s0)
            rctx.stroke()
          }
          rctx.restore()
        }

        // objective bearing pip — a gold diamond riding the ring
        const objp = s.objectivePosition
        if (objp) {
          const ox = objp.x - px0
          const oz = objp.z - pz0
          const ofwd = ox * -rs + oz * -rc
          const orgt = ox * rc + oz * -rs
          const olen = Math.hypot(ofwd, orgt) || 1
          const rr = rSize * 0.5 - 9
          const bx = c + (orgt / olen) * rr
          const by = c - (ofwd / olen) * rr
          rctx.save()
          rctx.translate(bx, by)
          rctx.rotate(Math.PI / 4)
          rctx.fillStyle = '#FFB835'
          rctx.fillRect(-3, -3, 6, 6)
          rctx.restore()
        }
      }

      // threat chevrons — only hostiles actually committing to an attack
      activeThreats(threatList)
      for (let i = 0; i < THREAT_SLOTS; i++) {
        const el = threatEls[i]
        if (!el) continue
        const m = threatList[i]
        if (!m || !cam) {
          if (el.style.opacity !== '0') el.style.opacity = '0'
          continue
        }
        const p = projectPoint(m.position, cam, w, h, 42)
        if (!p.off) {
          // on screen and readable — the enemy itself is the indicator
          if (el.style.opacity !== '0') el.style.opacity = '0'
          continue
        }
        // [R2 #10] keep the chevrons clear of the weapon cluster's bounds —
        // a threat arrow sitting on the ammo readout costs both of them
        let tx = p.x
        let ty = p.y
        if (tx > w - 250 && ty > h - 130) {
          if (w - tx < h - ty) ty = h - 130
          else tx = w - 250
        }
        if (tx < 210 && ty > h - 190) {
          // and clear of the ability tray in the opposite corner
          if (tx < 210) tx = 210
        }
        el.style.opacity = '1'
        el.style.transform =
          `translate3d(${tx.toFixed(1)}px, ${ty.toFixed(1)}px, 0) rotate(${((p.angle + Math.PI / 2) * 180) / Math.PI}deg)`
      }

      // boss bar — a Heavy on the field owns the top of the frame
      const boss = bossRef.current
      if (boss) {
        let found: (typeof list)[number] | null = null
        for (let i = 0; i < list.length; i++) {
          const e = list[i]
          if (e.type !== 'heavy' || !e.alive) continue
          if (!found || e.hp < found.hp) found = e
        }
        const show = !!found && found.position.distanceTo(PlayerRef.position) < 60
        if (show !== bossShown) {
          bossShown = show
          boss.classList.toggle('show', show)
        }
        if (found && show) {
          const frac = Math.max(0, found.hp / found.maxHp)
          if (bossFillRef.current) bossFillRef.current.style.transform = `scaleX(${frac.toFixed(4)})`
          if (bossStagRef.current)
            bossStagRef.current.style.transform = `scaleX(${(found.stagger / 100).toFixed(3)})`
          const sub = frac < 0.3 ? 'ENRAGED' : 'REAR REACTOR — WEAK POINT'
          if (sub !== lastBossSub && bossSubRef.current) {
            bossSubRef.current.textContent = sub
            lastBossSub = sub
          }
        }
      }

      // -- enemy nameplates + hostile reticle state ---------------------------
      // Two ordered passes over the (≤12 entry) live list: hostiles that have
      // taken damage in the last NP_HOLD seconds claim plates first, then
      // whatever the player is aiming at. No allocation, no sort.
      let npCount = 0
      let aimBest = -1
      for (let i = 0; i < NP_SLOTS; i++) npBound[i] = null
      if (cam) {
        cam.getWorldDirection(_fwd)
        cam.getWorldPosition(_camPos)
        for (let pass = 0; pass < 2 && npCount < NP_SLOTS; pass++) {
          for (let i = 0; i < list.length && npCount < NP_SLOTS; i++) {
            const en = list[i]
            if (!en.alive) continue
            _toE.copy(en.headPosition).sub(_camPos)
            const d = _toE.length()
            if (d > NP_RANGE || d < 0.4) continue
            _toE.divideScalar(d)
            const facing = _toE.dot(_fwd)
            if (facing > aimBest) aimBest = facing
            const hot = tNow - (damagedAt.get(en.id) ?? -999) < NP_HOLD
            const aimed = facing > NP_AIM_COS
            if (pass === 0 ? !hot : hot || !aimed) continue
            let dup = false
            for (let k = 0; k < npCount; k++) if (npBound[k] === en) dup = true
            if (dup) continue
            npBound[npCount++] = en
          }
        }
      }
      // the reticle goes hostile when the aim axis is actually on a body —
      // the single cheapest "this shot will land" tell a shooter can give
      reticleRef.current?.classList.toggle('hostile', aimBest > RET_HOSTILE_COS)

      for (let i = 0; i < NP_SLOTS; i++) {
        const part = npParts[i]
        if (!part) continue
        const en = npBound[i]
        if (!en || !cam) {
          if (part.root.style.opacity !== '0') part.root.style.opacity = '0'
          npLastId[i] = -1
          continue
        }
        _np.copy(en.headPosition)
        _np.y += en.type === 'drone' ? 0.42 : 0.5
        const p = projectPoint(_np, cam, w, h, 8)
        if (p.off) {
          if (part.root.style.opacity !== '0') part.root.style.opacity = '0'
          continue
        }
        if (npLastId[i] !== en.id) {
          npLastId[i] = en.id
          part.name.textContent = NP_NAME[en.type] ?? 'HOSTILE'
          part.root.className = `np np-${en.type}`
        }
        const dist = _camPos.distanceTo(en.headPosition)
        // fade the plate out with distance instead of cutting it off
        const fade = 1 - Math.max(0, (dist - NP_RANGE * 0.6) / (NP_RANGE * 0.4))
        part.root.style.opacity = Math.max(0.15, Math.min(1, fade)).toFixed(2)
        part.root.style.transform = `translate3d(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px, 0) translate(-50%, -100%)`
        part.fill.style.transform = `scaleX(${Math.max(0, en.hp / en.maxHp).toFixed(3)})`
        part.stag.style.transform = `scaleX(${Math.min(1, en.stagger / 100).toFixed(3)})`
      }
      // drop stale hold entries so the map cannot grow across a long run
      if (damagedAt.size > 32) {
        for (const [id, at] of damagedAt) if (tNow - at > NP_HOLD) damagedAt.delete(id)
      }
    }

    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', sizeRadar)
    }
  }, [])

  const hidden = phase === 'DROPSHIP' || phase === 'WIN' || phase === 'LOSE'
  const waveCount = MISSION.exterminateWaves.length

  return (
    <>
      <div id="hud" ref={rootRef} className={hidden ? 'hud-hidden' : ''} aria-hidden="true">
        {/* screen-edge feedback overlays */}
        <div ref={dmgVigRef} className="hud-dmgvig" />
        <div ref={critVigRef} className="hud-critvig" />
        <div ref={shieldVigRef} className="hud-shieldvig" />
        <div className="hud-lowhp" />
        <div ref={hitdirRef} className="hitdir-layer">
          {Array.from({ length: HITDIR_SLOTS }, (_, i) => (
            <div key={i} className="hitdir" style={{ opacity: 0 }}>
              <i />
            </div>
          ))}
        </div>

        {/* ---------- top-left: diegetic radar ---------- */}
        <div className="radar hud-cluster">
          <div className="radar-plate">
            {[0, 90, 180, 270].map((deg) => (
              <i
                key={deg}
                className="radar-tick"
                style={{ transform: `rotate(${deg}deg) translateY(var(--rtick)) rotate(45deg)` }}
              />
            ))}
          </div>
          <canvas ref={radarRef} width={HUD_RADAR.size} height={HUD_RADAR.size} />
          <div className="radar-label">AUSPEX</div>
        </div>

        {/* ---------- bottom-left: vitals → energy → abilities ---------- */}
        <div className="leftcluster hud-cluster">
          <div className="vitals" ref={vitalsRef}>
            <div className="v-grid">
              <div className="bar os-bar v-os">
                <div ref={osFillRef} className="bar-fill os" />
              </div>
              <ShieldGlyph />
              <div className="bar shield-bar">
                <div ref={shFillRef} className="bar-fill shield" />
              </div>
              <div className="v-num shield">
                <span ref={shTextRef} className="n">
                  {PLAYER.maxShield}
                </span>
                <span className="d">/ {PLAYER.maxShield}</span>
              </div>
              <div className="v-rule" />
              <VitaeGlyph />
              <div className="bar hp-bar">
                <div ref={hpFillRef} className="bar-fill hp" />
              </div>
              <div className="v-num">
                <span ref={hpTextRef} className="n">
                  {PLAYER.maxHealth}
                </span>
                <span className="d">/ {PLAYER.maxHealth}</span>
              </div>
            </div>
          </div>

          <div className="energy-row">
            <div className="bar energy-bar">
              <div ref={enFillRef} className="bar-fill energy" />
              {ENERGY_NOTCHES.map((n) => (
                <i key={n} className="notch" style={{ left: `${(n / PLAYER.maxEnergy) * 100}%` }} />
              ))}
            </div>
            <div className="energy-num">
              <span ref={enTextRef} className="n">
                {PLAYER.maxEnergy}
              </span>
              <span className="u">EN</span>
            </div>
          </div>

          <div className="abilities" ref={abRootRef}>
            {[0, 1, 2, 3].map((i) => (
              <div className="ability" key={i} title={ABILITY_NAMES[i]}>
                <span className="ab-frame" />
                <span className="ab-key">{ABILITY_KEYS[i]}</span>
                <div className="ab-rot">
                  <div className="ab-face">
                    <AbilityGlyph i={i} />
                    <div className="ab-sweep" />
                    <div className="ab-edge" />
                    <div className="ab-active" />
                  </div>
                </div>
                <span className="ab-cost">{abilityState.costs[i]}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ---------- bottom-right: weapon only ---------- */}
        <div className="weaponcluster hud-cluster">
          <div className="weapon" ref={weaponRef}>
            <RifleGlyph active />
            <div className="ammo-box">
              <span ref={ammoTextRef} className="ammo">
                {ammoState.magSize}
              </span>
              <span ref={ammoResRef} className="ammo-res">
                / ∞
              </span>
              <span className="ammo-name">VOW</span>
              <div ref={reloadArcRef} className="reload-arc" />
            </div>
            <KatanaGlyph />
          </div>
        </div>

        {/* ---------- center: reticle + hitmarker ---------- */}
        <div ref={reticleRef} className="reticle">
          <svg className="ret-svg" viewBox="-32 -32 64 64">
            {[
              { d: 'M0,-5 v-7' },
              { d: 'M0,5 v7' },
              { d: 'M-5,0 h-7' },
              { d: 'M5,0 h7' },
            ].map((t, i) => (
              <g
                key={i}
                ref={(el) => {
                  retTickRefs.current[i] = el
                }}
              >
                <path className="stroke" d={t.d} />
                <path className="core" d={t.d} />
              </g>
            ))}
            <circle className="dot-stroke" cx="0" cy="0" r="2.5" />
            <circle className="dot" cx="0" cy="0" r="1.3" />
          </svg>
          <div ref={hitRef} className="hitmarker">
            <i className="hm-a" />
            <i className="hm-b" />
            <i className="hm-c" />
            <i className="hm-d" />
            <i className="hm-x1" />
            <i className="hm-x2" />
            <i className="hm-x3" />
            <i className="hm-x4" />
          </div>
        </div>

        {/* ---------- upper-left: the mission plate, off the centre axis ----
            [R2] The objective banner used to sit on the vertical centre line
            directly over the action. It now hangs under the minimap in the
            upper-left reading corner; only the ceremonial phase banner and
            the boss bar still own the centre. ------------------------------ */}
        <div className="missionblock">
          <div className="mission-plate" ref={plateRef}>
            <div className="mp-row">
              <span className="mp-diamond" />
              <span className="mp-verb">{PHASE_OBJECTIVE[phase]}</span>
              <span ref={objDistRef} className="mp-dist off" />
            </div>
            <div className="mp-rule" />
            <div className="mp-row2">
              <span className="wc-label">
                {phase === 'EXTERMINATE' ? `WAVE ${Math.min(wave + 1, waveCount)} / ${waveCount}` : 'THREAT'}
              </span>
              {phase === 'EXTERMINATE' && (
                <span className="wc-pips">
                  {Array.from({ length: waveCount }, (_, i) => (
                    <i key={i} className={i < wave ? 'pip done fill' : 'pip'} />
                  ))}
                </span>
              )}
              <span className="wc-alive">
                <HostileGlyph />
                <span ref={aliveRef} className="wc-count">
                  × 0
                </span>
              </span>
              {phase === 'EXTRACT' && (
                <div ref={timerRef} className="extract-timer">
                  {`${Math.floor(MISSION.extract.timerSec / 60)}:${String(
                    Math.round(MISSION.extract.timerSec % 60),
                  ).padStart(2, '0')}`}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ---------- top-centre: ceremony only (phase banner + boss) ------- */}
        <div className="topcenter">
          {banner && (
            <div key={banner.key} className="phase-banner">
              <span className="pb-line left" />
              <span className="pb-text">{banner.text}</span>
              <span className="pb-line right" />
            </div>
          )}

          <div className="bossbar" ref={bossRef}>
            <div className="bb-head">
              <span className="bb-name">CANTOR</span>
              <span ref={bossSubRef} className="bb-sub">
                REAR REACTOR — WEAK POINT
              </span>
            </div>
            <div className="bb-track">
              <div ref={bossFillRef} className="bb-fill" />
              <div ref={bossStagRef} className="bb-stagger" style={{ transform: 'scaleX(0)' }} />
            </div>
          </div>
        </div>

        {/* ---------- world-projected enemy nameplates ----------
            [R2 blocker/major] Hit feedback that survives the frame: every
            enemy that takes damage (or is aimed at) carries a health bar and
            a faction glyph for 3 s, projected with the same maths as the
            damage numbers. Pooled DOM, styled by the rAF loop only. -------- */}
        <div className="np-layer" ref={npRef}>
          {Array.from({ length: NP_SLOTS }, (_, i) => (
            <div key={i} className="np" style={{ opacity: 0 }}>
              <div className="np-head">
                <i className="np-glyph" />
                <span className="np-name" />
              </div>
              <div className="np-track">
                <i className="np-fill" />
                <i className="np-stag" />
              </div>
            </div>
          ))}
        </div>

        {/* ---------- off-screen threat chevrons ---------- */}
        <div className="threat-layer" ref={threatRef}>
          {Array.from({ length: THREAT_SLOTS }, (_, i) => (
            <div key={i} className="threat" style={{ opacity: 0 }}>
              <i />
            </div>
          ))}
        </div>

        {/* ---------- channel arc, anchored to the Reliquary ---------- */}
        <div className="channel-anchor" ref={channelRef} style={{ opacity: 0 }}>
          <div className="ch-leader" />
          <div className="ch-plate">
            <svg className="ch-svg" viewBox="0 0 54 54">
              <circle className="ch-track" cx="27" cy="27" r="22" />
              <circle
                ref={chArcRef}
                className="ch-arc"
                cx="27"
                cy="27"
                r="22"
                transform="rotate(-90 27 27)"
              />
              {[0, 90, 180, 270].map((a) => {
                const r = (a - 90) * (Math.PI / 180)
                return (
                  <line
                    key={a}
                    className="ch-tick"
                    x1={27 + Math.cos(r) * 18.5}
                    y1={27 + Math.sin(r) * 18.5}
                    x2={27 + Math.cos(r) * 25.5}
                    y2={27 + Math.sin(r) * 25.5}
                  />
                )
              })}
              <circle ref={chDotRef} className="ch-dot" cx="27" cy="5" r="2.6" />
              <text ref={chPctRef} className="ch-pct" x="27" y="27">
                0%
              </text>
            </svg>
            <span className="ch-label">PURIFYING</span>
          </div>
        </div>

        {/* ---------- world-space objective marker ---------- */}
        <div ref={markerRef} className="obj-marker" style={{ opacity: 0 }}>
          <div className="om-ring" />
          <div className="om-diamond" />
          <div className="om-arrow">
            <i />
          </div>
        </div>
      </div>

      {/* dropship skip hint — OUTSIDE #hud, which is faded out in DROPSHIP */}
      {phase === 'DROPSHIP' && <div className="skip-hint">SPACE · FIRE — SKIP</div>}
    </>
  )
}

/**
 * AURIC VOW — HUD.tsx
 * Full DOM overlay HUD (design.md §5 / vfx-hud.md §2). pointer-events:none.
 *
 * Performance model: React renders the static skeleton once; a single rAF
 * loop drives every dynamic element (bars, sweeps, reticle, timers, marker)
 * via direct style/class writes — no per-frame React re-render. Phase-driven
 * blocks (banner, wave chip, channel ring, extraction timer) subscribe to
 * store.phase only.
 */
import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { ABILITIES, COLORS, MISSION, PLAYER, type MissionPhaseId } from '../config'
import { useGameStore, type DamageEvent } from '../store'
import { Input } from '../Input'
import { PlayerRef } from '@/game/player/PlayerRef'
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

const PHASE_OBJECTIVE: Record<MissionPhaseId, string> = {
  DROPSHIP: 'Approach the Anvil of Silence',
  INFILTRATE: 'Reach the Reliquary chamber',
  OBJECTIVE: 'Hold position — purify the Null Reliquary',
  EXTERMINATE: 'Purge the Cadence — survive all waves',
  EXTRACT: 'Reach the extraction beacon',
  WIN: 'Mission complete',
  LOSE: 'Vessel lost',
}

const ABILITY_KEYS = [ABILITIES.A1.key, ABILITIES.A2.key, ABILITIES.A3.key, ABILITIES.A4.key]
const ABILITY_NAMES = [ABILITIES.A1.name, ABILITIES.A2.name, ABILITIES.A3.name, ABILITIES.A4.name]
const OVERSHIELD_MAX = ABILITIES.A3.extra?.overshield ?? 100
const ENERGY_NOTCHES = [25, 50, 75, 150]
const LOW_HP = PLAYER.maxHealth * 0.3

// ---------------------------------------------------------------------------
// Inline glyphs (SVG — no emoji, no icon font)
// ---------------------------------------------------------------------------

function AbilityGlyph({ i }: { i: number }) {
  // fix2: crisper hard-edged glyphs (filled silhouettes + clean strokes)
  // A1: three tapered speed streaks · A2: fan of blades · A3: ringed core · A4: cathedral star
  switch (i) {
    case 0:
      return (
        <svg viewBox="0 0 24 24" className="ab-glyph">
          <path d="M2 5.5h9.5l3 3H5z" fill="currentColor" stroke="none" />
          <path d="M6 10.5h12.5l3 3H9.5z" fill="currentColor" stroke="none" />
          <path d="M2 15.5h8.5l3 3H5.5z" fill="currentColor" stroke="none" />
        </svg>
      )
    case 1:
      return (
        <svg viewBox="0 0 24 24" className="ab-glyph">
          <path d="M12 1.5l1.5 18.2-1.5 2.3-1.5-2.3z" fill="currentColor" stroke="none" />
          <path d="M4.8 3.8l7.9 15.9-1.9 1.5L4 5.6z" fill="currentColor" stroke="none" />
          <path d="M19.2 3.8L11.3 19.7l1.9 1.5L20 5.6z" fill="currentColor" stroke="none" />
        </svg>
      )
    case 2:
      return (
        <svg viewBox="0 0 24 24" className="ab-glyph">
          <circle cx="12" cy="12" r="4.1" strokeWidth="2.2" />
          <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
          <path
            d="M12 1.6a10.4 10.4 0 0 1 9 5.2 M22.4 12a10.4 10.4 0 0 1-5.2 9 M12 22.4a10.4 10.4 0 0 1-9-5.2 M1.6 12a10.4 10.4 0 0 1 5.2-9"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
      )
    default:
      return (
        <svg viewBox="0 0 24 24" className="ab-glyph">
          <path
            d="M12 1.5l2 8.5 8.5 2-8.5 2-2 8.5-8.5-2 8.5-2z"
            fill="currentColor"
            stroke="none"
          />
          <circle cx="12" cy="12" r="2.7" strokeWidth="1.6" />
        </svg>
      )
  }
}

/** Small hostile glyph prefixing the wave-chip alive count (fix2). */
function HostileGlyph() {
  return (
    <svg viewBox="0 0 16 16" className="wc-glyph" aria-hidden="true">
      <path d="M8 1.4l4.6 3v6.2L8 14.6l-4.6-4V4.4z" fill="none" strokeWidth="1.4" />
      <path d="M8 5.2v5.6M5.4 8h5.2" fill="none" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}

function RifleGlyph() {
  return (
    <svg viewBox="0 0 32 14" className="weapon-glyph">
      <path
        d="M1 8h18l3-3h4l2 2 3-1v3l-4 1-2 3h-4l1-3H12l-2 2H7l1-2H1z"
        fill="none"
        strokeWidth="1.4"
      />
    </svg>
  )
}

function KatanaGlyph() {
  return (
    <svg viewBox="0 0 14 32" className="weapon-glyph katana">
      <path d="M7 1v22M4 23h6M7 25v6" fill="none" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
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
  const osFillRef = useRef<HTMLDivElement>(null)
  const enFillRef = useRef<HTMLDivElement>(null)
  const abRootRef = useRef<HTMLDivElement>(null)
  const ammoTextRef = useRef<HTMLSpanElement>(null)
  const reloadArcRef = useRef<HTMLDivElement>(null)
  const reticleRef = useRef<HTMLDivElement>(null)
  const hitRef = useRef<HTMLDivElement>(null)
  const dmgVigRef = useRef<HTMLDivElement>(null)
  const objDistRef = useRef<HTMLSpanElement>(null)
  const timerRef = useRef<HTMLDivElement>(null)
  const aliveRef = useRef<HTMLSpanElement>(null)
  const channelFillRef = useRef<HTMLDivElement>(null)
  const markerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const abEls = abRootRef.current
      ? (Array.from(abRootRef.current.querySelectorAll('.ability')) as HTMLElement[])
      : []
    const sweeps = abEls.map((e) => e.querySelector('.ab-sweep') as HTMLElement)
    const actives = abEls.map((e) => e.querySelector('.ab-active') as HTMLElement)

    const proj = new THREE.Vector3()
    const hitDrain: DamageEvent[] = []
    let raf = 0
    let last = performance.now()
    // smoothed display values (bar lerps)
    let dHp = PLAYER.maxHealth
    let dShield = PLAYER.maxShield
    let dEnergy = PLAYER.maxEnergy
    let spread = 6
    let prevVitals = PLAYER.maxHealth + PLAYER.maxShield
    let lastHpText = ''
    let lastAmmoText = ''
    let lastDistText = ''
    let lastTimerText = ''
    let lastAliveText = ''
    const lastSweepDeg = [-1, -1, -1, -1]
    const wasCooling = [false, false, false, false]
    const wasPoor = [false, false, false, false]
    let reloading = false

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
      const hpText = `${Math.ceil(s.hp)} / ${PLAYER.maxHealth}`
      if (hpText !== lastHpText && hpTextRef.current) {
        hpTextRef.current.textContent = hpText
        lastHpText = hpText
      }
      if (shFillRef.current)
        shFillRef.current.style.transform = `scaleX(${(dShield / PLAYER.maxShield).toFixed(4)})`
      if (osFillRef.current)
        osFillRef.current.style.transform = `scaleX(${Math.min(1, abilityState.overshield / OVERSHIELD_MAX).toFixed(4)})`
      if (enFillRef.current)
        enFillRef.current.style.transform = `scaleX(${(dEnergy / PLAYER.maxEnergy).toFixed(4)})`

      // -- player damaged → viridian edge flash + low-hp pulse --------------
      const vit = s.hp + s.shield
      if (vit < prevVitals - 0.01) retrigger(dmgVigRef.current, 'flash')
      prevVitals = vit
      rootRef.current?.classList.toggle('low-hp', s.hp <= LOW_HP && s.phase !== 'WIN' && s.phase !== 'LOSE')

      // -- ability diamonds -------------------------------------------------
      for (let i = 0; i < 4; i++) {
        const cd = abilityState.cooldowns[i]
        const max = abilityState.cooldownMax[i] || 1
        const frac = cd > 0 ? cd / max : 0
        const deg = Math.round(frac * 360 / 3) * 3 // quantize → fewer repaints
        if (deg !== lastSweepDeg[i]) {
          lastSweepDeg[i] = deg
          sweeps[i].style.background =
            deg > 0 ? `conic-gradient(rgba(8,10,14,0.78) ${deg}deg, transparent ${deg}deg)` : 'none'
        }
        const cooling = cd > 0
        if (wasCooling[i] && !cooling) retrigger(abEls[i], 'ready')
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
        reloadArcRef.current.style.background = `conic-gradient(${COLORS.aureate} ${deg}deg, rgba(138,143,163,0.25) ${deg}deg)`
      }
      const ammoText = String(ammoState.mag)
      if (ammoText !== lastAmmoText && ammoTextRef.current) {
        ammoTextRef.current.textContent = ammoText
        lastAmmoText = ammoText
      }

      // -- reticle ------------------------------------------------------------
      const firing = Input.held('fire')
      const aiming = Input.held('aim')
      const target = aiming ? 3 : firing ? 18 : 8
      spread += (target - spread) * Math.min(1, dt * 10)
      reticleRef.current?.style.setProperty('--spread', `${spread.toFixed(2)}px`)
      reticleRef.current?.classList.toggle('aim', aiming)

      // -- hitmarker (events drained by DamageNumbers) ------------------------
      drainHitmarkerEvents(hitDrain)
      let hitKind: DamageEvent['kind'] | null = null
      for (const ev of hitDrain) {
        if (ev.kind === 'player') continue
        if (ev.kind === 'ability') hitKind = 'ability'
        else if (ev.kind === 'headshot' && hitKind !== 'ability') hitKind = 'headshot'
        else if (!hitKind) hitKind = 'normal'
      }
      hitDrain.length = 0
      if (hitKind && hitRef.current) {
        hitRef.current.className = 'hitmarker'
        retrigger(hitRef.current, `hm-${hitKind === 'ability' ? 'kill' : hitKind === 'headshot' ? 'crit' : 'hit'}`)
      }

      // -- objective distance + extraction timer ------------------------------
      const obj = s.objectivePosition
      if (obj) {
        const d = Math.round(PlayerRef.position.distanceTo(obj))
        const distText = `— ${d} m`
        if (distText !== lastDistText && objDistRef.current) {
          objDistRef.current.textContent = distText
          lastDistText = distText
        }
      } else if (lastDistText && objDistRef.current) {
        objDistRef.current.textContent = ''
        lastDistText = ''
      }

      if (s.phase === 'EXTRACT' && timerRef.current) {
        const t = Math.ceil(s.extractionTimer)
        const txt = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`
        if (txt !== lastTimerText) {
          timerRef.current.textContent = txt
          lastTimerText = txt
        }
        timerRef.current.classList.toggle('urgent', s.extractionTimer < 15)
      }

      // -- wave chip alive count ----------------------------------------------
      if (s.phase === 'EXTERMINATE' && aliveRef.current) {
        const txt = `× ${enemyState.alive}`
        if (txt !== lastAliveText) {
          aliveRef.current.textContent = txt
          lastAliveText = txt
        }
      }

      // -- channel ring ---------------------------------------------------------
      if (s.phase === 'OBJECTIVE' && channelFillRef.current) {
        const deg = Math.round(s.channelProgress * 360)
        channelFillRef.current.style.background = `conic-gradient(${COLORS.aureate} ${deg}deg, rgba(138,143,163,0.2) ${deg}deg)`
      }

      // -- world-space objective marker -----------------------------------------
      const marker = markerRef.current
      if (marker) {
        const cam = getHudCamera()
        if (!obj || !cam || s.phase === 'DROPSHIP' || s.phase === 'WIN' || s.phase === 'LOSE') {
          marker.style.opacity = '0'
        } else {
          const dist = PlayerRef.position.distanceTo(obj)
          proj.copy(obj).project(cam)
          const w = window.innerWidth
          const h = window.innerHeight
          let x = (proj.x * 0.5 + 0.5) * w
          let y = (-proj.y * 0.5 + 0.5) * h
          let off = proj.z > 1
          if (off) {
            x = w - x
            y = h // behind camera → push to bottom edge
          }
          const m = 24
          const cx = Math.min(w - m, Math.max(m, x))
          const cy = Math.min(h - m, Math.max(m, y))
          off = off || cx !== x || cy !== y
          marker.classList.toggle('edge', off)
          if (dist < 5) marker.style.opacity = '0'
          else marker.style.opacity = dist < 7 ? String((dist - 5) / 2) : '1'
          marker.style.transform = `translate3d(${cx.toFixed(1)}px, ${cy.toFixed(1)}px, 0) translate(-50%, -50%)`
        }
      }
    }

    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  const hidden = phase === 'DROPSHIP' || phase === 'WIN' || phase === 'LOSE'
  const waveCount = MISSION.exterminateWaves.length

  return (
    <div id="hud" ref={rootRef} className={hidden ? 'hud-hidden' : ''} aria-hidden="true">
      {/* screen-edge feedback overlays */}
      <div ref={dmgVigRef} className="hud-dmgvig" />
      <div className="hud-lowhp" />

      {/* ---------- bottom-left: vitals ---------- */}
      <div className="vitals hud-cluster">
        <div className="vitals-glyph" />
        <div className="vitals-bars">
          <div className="bar os-bar">
            <div ref={osFillRef} className="bar-fill os" />
          </div>
          <div className="bar shield-bar">
            <div ref={shFillRef} className="bar-fill shield" />
          </div>
          <div className="bar hp-bar">
            <div ref={hpFillRef} className="bar-fill hp" />
            <span ref={hpTextRef} className="bar-num">
              {PLAYER.maxHealth} / {PLAYER.maxHealth}
            </span>
          </div>
        </div>
      </div>

      {/* ---------- bottom-right: abilities + energy + weapon ---------- */}
      <div className="combat hud-cluster">
        <div className="abilities" ref={abRootRef}>
          {[0, 1, 2, 3].map((i) => (
            <div className="ability" key={i} title={ABILITY_NAMES[i]}>
              <span className="ab-frame" />
              <div className="ab-rot">
                <div className="ab-face">
                  <span className="ab-key">{ABILITY_KEYS[i]}</span>
                  <AbilityGlyph i={i} />
                  <div className="ab-sweep" />
                  <div className="ab-active" />
                </div>
              </div>
              <span className="ab-cost">{abilityState.costs[i]}</span>
            </div>
          ))}
        </div>
        <div className="energy-row">
          <div className="bar energy-bar">
            <div ref={enFillRef} className="bar-fill energy" />
            {ENERGY_NOTCHES.map((n) => (
              <i key={n} className="notch" style={{ left: `${(n / PLAYER.maxEnergy) * 100}%` }} />
            ))}
          </div>
          <div className="weapon">
            <RifleGlyph />
            <div className="ammo-box">
              <span ref={ammoTextRef} className="ammo">
                {ammoState.magSize}
              </span>
              <div ref={reloadArcRef} className="reload-arc" />
              <span className="ammo-reserve">/ ∞</span>
            </div>
            <KatanaGlyph />
          </div>
        </div>
      </div>

      {/* ---------- center: reticle + hitmarker ---------- */}
      <div ref={reticleRef} className="reticle" style={{ ['--spread' as never]: '8px' }}>
        <div className="ret-dot" />
        <div className="ret-tick t-n" />
        <div className="ret-tick t-s" />
        <div className="ret-tick t-w" />
        <div className="ret-tick t-e" />
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

      {/* ---------- top-center: banner / waves / channel ---------- */}
      <div className="topcenter">
        {banner && (
          <div key={banner.key} className="phase-banner">
            <span className="pb-line left" />
            <span className="pb-text">{banner.text}</span>
            <span className="pb-line right" />
          </div>
        )}
        {phase === 'EXTERMINATE' && (
          <div className="wave-chip">
            <span className="wc-label">
              WAVE {wave + 1} / {waveCount}
            </span>
            <span className="wc-pips">
              {Array.from({ length: waveCount }, (_, i) => (
                <i key={i} className={i < wave ? 'pip done' : 'pip'} />
              ))}
            </span>
            <span className="wc-alive" title="HOSTILES — enemies remaining in this wave">
              <HostileGlyph />
              <span ref={aliveRef} className="wc-count">
                × 0
              </span>
            </span>
          </div>
        )}
        {phase === 'OBJECTIVE' && (
          <div className="channel">
            <div className="ch-ring">
              <div ref={channelFillRef} className="ch-fill" />
              <div className="ch-hole" />
            </div>
            <span className="ch-label">PURIFYING</span>
          </div>
        )}
      </div>

      {/* ---------- top-right: objective ---------- */}
      <div className="objective hud-cluster">
        <div className="obj-line">
          <span className="obj-diamond" />
          <span className="obj-text">{PHASE_OBJECTIVE[phase]}</span>
          <span ref={objDistRef} className="obj-dist" />
        </div>
        {phase === 'EXTRACT' && (
          <div ref={timerRef} className="extract-timer">
            1:30
          </div>
        )}
      </div>

      {/* ---------- world-space objective marker ---------- */}
      <div ref={markerRef} className="obj-marker" style={{ opacity: 0 }}>
        <div className="om-ring" />
        <div className="om-diamond" />
      </div>

      {/* ---------- dropship skip hint ---------- */}
      {phase === 'DROPSHIP' && <div className="skip-hint">HOLD ANY KEY TO SKIP</div>}
    </div>
  )
}

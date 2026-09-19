/**
 * AURIC VOW — combat/state.ts
 * Shared mutable combat singleton (single-player game — kept out of zustand
 * to avoid per-frame React churn) + HUD hooks + player-damage intercepts
 * (overshield / i-frames live here because the store has no overshield field).
 */
import * as THREE from 'three'
import { ABILITIES, WEAPONS } from '@/game/config'
import { useGameStore } from '@/game/store'
import { ammoState } from '@/game/hud/ammoState'

export type AbilityId = 'A1' | 'A2' | 'A3' | 'A4'
export const ABILITY_IDS: readonly AbilityId[] = ['A1', 'A2', 'A3', 'A4']

export interface TrailHandle {
  push(p: THREE.Vector3): void
  end(): void
}

export interface SwingState {
  step: 0 | 1 | 2
  t: number
  dur: number
  resolved: boolean
  airborne: boolean
  targetId: number | null
  hitIds: Set<number>
  trail: TrailHandle
}

export interface JavelinState {
  active: boolean
  flying: boolean
  pos: THREE.Vector3
  vel: THREE.Vector3
  life: number
}

export const CombatState = {
  /** scaled combat clock (seconds); advances with store.timeScale applied */
  clock: 0,

  // ---- rifle ----
  /** mirror of hud/ammoState.mag (the authoritative ammo store) */
  ammo: WEAPONS.rifle.magSize as number,
  /** mirror of hud/ammoState.reloading */
  reloading: false,
  fireCooldown: 0,
  /** spread bloom added by sustained fire (degrees, decays 4°/s) */
  bloom: 0,
  /** current total spread in degrees (base + bloom) — HUD crosshair ring */
  spreadDeg: 0.6,
  aiming: false,
  /** view-model recoil spring energy (decays 10/s) */
  recoil: 0,
  muzzleFlashAt: -1,
  muzzleFlip: false,

  // ---- katana ----
  swing: null as SwingState | null,
  slashQueued: false,
  /** next combo step to execute (0..2) */
  comboStep: 0,
  comboWindowUntil: 0,
  /** air-slam tracking */
  slamPending: false,
  slamMinVy: 0,
  slamUntil: 0,

  // ---- A1 gilt dash ----
  dashing: false,
  dashUntil: 0,
  dashDir: new THREE.Vector3(0, 0, -1),
  dashHits: new Set<number>(),
  dashTrail: null as TrailHandle | null,
  invulnerableUntil: 0,
  ghostsToSpawn: 0,
  nextGhostAt: 0,

  // ---- A2 sunspike volley ----
  volleyActive: false,
  volleyWindupUntil: 0,
  volleyNextSpawnAt: 0,
  volleySpawned: 0,
  volleyLaunched: false,
  javelins: [] as JavelinState[],

  // ---- A3 aegis halo ----
  aegisUntil: 0,
  overshield: 0,
  overshieldBreakPending: false,
  nextRippleAt: 0,
  /** movement-speed multiplier exposed for the player controller (aegis aura) */
  speedMult: 1,

  // ---- A4 auric requiem ----
  /** 0 = idle, 1 = charging (rooted), 2 = afterglow */
  requiemPhase: 0 as 0 | 1 | 2,
  requiemT: 0,
  requiemOrigin: new THREE.Vector3(),

  /** clock timestamp at which each ability comes off cooldown */
  cooldownReadyAt: { A1: 0, A2: 0, A3: 0, A4: 0 } as Record<AbilityId, number>,
}

// ---------------------------------------------------------------------------
// Frame tick — advance the shared clock exactly once per R3F frame
// ---------------------------------------------------------------------------

let lastElapsed = -1

/** Returns scaled dt; advances CombatState.clock once per frame. */
export function combatTick(elapsed: number, rawDt: number): number {
  const dt = rawDt * useGameStore.getState().timeScale
  if (elapsed !== lastElapsed) {
    lastElapsed = elapsed
    CombatState.clock += dt
  }
  return dt
}

/** combat input allowed? (disabled on end screens / dropship intro).
 *  NOT gated on pointer lock: headless/iframe contexts may reject the lock
 *  request — the game stays fully playable, only mouse-look degrades. */
export function canFight(): boolean {
  const phase = useGameStore.getState().phase
  return phase !== 'WIN' && phase !== 'LOSE' && phase !== 'DROPSHIP'
}

/**
 * Run restart (mission retry): clear persistent combat state that would
 * otherwise leak across runs (Aegis overshield survives via the damage
 * intercept; dash/volley/requiem phases self-expire but start clean anyway).
 * Cooldowns are clock-relative — anchoring them to `now` readies all slots.
 */
export function resetCombat(): void {
  const cs = CombatState
  const now = cs.clock
  cs.fireCooldown = 0
  cs.bloom = 0
  cs.recoil = 0
  cs.swing = null
  cs.slashQueued = false
  cs.comboStep = 0
  cs.slamPending = false
  cs.dashing = false
  cs.dashTrail = null
  cs.invulnerableUntil = 0
  cs.volleyActive = false
  cs.volleySpawned = 0
  cs.volleyLaunched = false
  cs.javelins.length = 0
  cs.aegisUntil = 0
  cs.overshield = 0
  cs.overshieldBreakPending = false
  cs.speedMult = 1
  cs.requiemPhase = 0
  cs.cooldownReadyAt = { A1: now, A2: now, A3: now, A4: now }
}

// ---------------------------------------------------------------------------
// Combat events → HUD (combat.md §4: onCast / onReady / insufficient-energy)
// ---------------------------------------------------------------------------

export type CombatEvent =
  | { type: 'cast'; id: AbilityId }
  | { type: 'ready'; id: AbilityId }
  | { type: 'denied'; id: AbilityId }
  | { type: 'dash' }
  | { type: 'overshield-break' }

const listeners = new Set<(e: CombatEvent) => void>()

/** subscribe to combat events; returns unsubscribe */
export function onCombatEvent(cb: (e: CombatEvent) => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

export function emitCombat(e: CombatEvent): void {
  listeners.forEach((l) => l(e))
}

// ---------------------------------------------------------------------------
// HUD snapshot (design.md §5 hooks: ammo counter, spread ring, cooldown sweep,
// golden overshield segment). HUD layer polls this per frame — plain data.
// ---------------------------------------------------------------------------

export interface AbilityHudInfo {
  id: AbilityId
  name: string
  cost: number
  cooldown: number
  /** seconds until ready (0 = ready) */
  remaining: number
  active: boolean
}

export interface CombatHudSnapshot {
  ammo: number
  magSize: number
  reloading: boolean
  reloadProgress: number
  spreadDeg: number
  aiming: boolean
  comboStep: number
  swinging: boolean
  overshield: number
  aegisRemaining: number
  speedMult: number
  dashing: boolean
  invulnerable: boolean
  abilities: Record<AbilityId, AbilityHudInfo>
}

export function getCombatHudSnapshot(): CombatHudSnapshot {
  const cs = CombatState
  const abilities = {} as Record<AbilityId, AbilityHudInfo>
  for (const id of ABILITY_IDS) {
    const spec = ABILITIES[id]
    abilities[id] = {
      id,
      name: spec.name,
      cost: spec.cost,
      cooldown: spec.cooldownSec,
      remaining: Math.max(0, cs.cooldownReadyAt[id] - cs.clock),
      active:
        (id === 'A1' && cs.dashing) ||
        (id === 'A2' && cs.volleyActive) ||
        (id === 'A3' && cs.clock < cs.aegisUntil) ||
        (id === 'A4' && cs.requiemPhase !== 0),
    }
  }
  return {
    ammo: ammoState.mag,
    magSize: WEAPONS.rifle.magSize,
    reloading: ammoState.reloading,
    reloadProgress: ammoState.reloading
      ? Math.min(1, ammoState.reloadT / ammoState.reloadSec)
      : 1,
    spreadDeg: cs.spreadDeg,
    aiming: cs.aiming,
    comboStep: cs.comboStep,
    swinging: cs.swing !== null,
    overshield: cs.overshield,
    aegisRemaining: Math.max(0, cs.aegisUntil - cs.clock),
    speedMult: cs.speedMult,
    dashing: cs.dashing,
    invulnerable: cs.clock < cs.invulnerableUntil,
    abilities,
  }
}

// ---------------------------------------------------------------------------
// Player-damage intercept — overshield absorbs first (combat.md §6) and
// Gilt Dash i-frames (§3.1). Installed once at module load; survives
// store.resetRun() because resetRun only sets data fields, not actions.
// ---------------------------------------------------------------------------

let interceptInstalled = false

export function installDamageIntercept(): void {
  if (interceptInstalled) return
  interceptInstalled = true
  const orig = useGameStore.getState().damagePlayer
  useGameStore.setState({
    damagePlayer: (amount: number) => {
      const cs = CombatState
      if (cs.clock < cs.invulnerableUntil) return // dash i-frames
      if (cs.overshield > 0) {
        const absorbed = Math.min(cs.overshield, amount)
        cs.overshield -= absorbed
        amount -= absorbed
        if (cs.overshield <= 0.001) {
          cs.overshield = 0
          cs.overshieldBreakPending = true
        }
        if (amount <= 0) return
      }
      orig(amount)
    },
  })
}

installDamageIntercept()

/**
 * AURIC VOW — store.ts
 * Zustand game state. Single store; use sliced selectors to avoid re-render storms.
 * See design.md §1.1, §4, §6.
 */
import { create } from 'zustand'
import * as THREE from 'three'
import { PLAYER, MISSION, SCORE, TIMESCALE, type MissionPhaseId } from './config'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A floating damage-number / hit event consumed by the HUD layer. */
export interface DamageEvent {
  id: number
  /** world-space position of the hit */
  position: THREE.Vector3
  amount: number
  kind: 'normal' | 'headshot' | 'ability' | 'player'
  /** performance.now() timestamp for lifecycle culling */
  createdAt: number
}

export type Grade = 'S' | 'A' | 'B' | 'C'

export interface GameState {
  // --- mission ---
  phase: MissionPhaseId
  /** current wave index during EXTERMINATE (0-based) */
  wave: number
  /** 0..1 channel progress during OBJECTIVE */
  channelProgress: number
  /** seconds remaining during EXTRACT */
  extractionTimer: number
  /** seconds the player has stood on the extraction pad */
  extractionHold: number
  /** world position of the current objective marker (null = hidden) */
  objectivePosition: THREE.Vector3 | null

  // --- player stats ---
  hp: number
  shield: number
  energy: number
  /** timestamp (s, game clock) of last damage taken — drives shield regen delay */
  lastDamageAt: number

  // --- combat tallies ---
  kills: number
  headshots: number
  abilityKills: number
  score: number

  // --- damage number queue (drained by HUD) ---
  damageEvents: DamageEvent[]

  // --- time manipulation ---
  /** global time-scale multiplier: 1 = normal, <1 = slow-mo/hitstop */
  timeScale: number
  /** remaining real seconds for the active hitstop/slow-mo, decays in GameLoop */
  timeScaleTimer: number

  /** monotonic game clock in scaled seconds (advanced by GameLoop) */
  gameTime: number

  // --- render quality ---
  /** adaptive quality tier: 0 = full, 1 = low (0.75 dpr, no shadows/SMAA), 2 = potato (0.5 dpr, no bloom) */
  qualityTier: 0 | 1 | 2

  // --- actions ---
  setPhase: (p: MissionPhaseId) => void
  setWave: (w: number) => void
  setChannelProgress: (v: number) => void
  setExtractionTimer: (v: number) => void
  setExtractionHold: (v: number) => void
  setObjectivePosition: (v: THREE.Vector3 | null) => void

  damagePlayer: (amount: number) => void
  healPlayer: (amount: number) => void
  spendEnergy: (amount: number) => boolean
  addEnergy: (amount: number) => void
  regenTick: (scaledDt: number) => void

  registerKill: (opts?: { headshot?: boolean; ability?: boolean }) => void
  addScore: (points: number) => void

  pushDamageEvent: (ev: Omit<DamageEvent, 'id' | 'createdAt'>) => void
  drainDamageEvents: () => DamageEvent[]

  /** trigger hitstop or slow-mo: sets timeScale for `durationSec` real seconds */
  setTimeScale: (scale: number, durationSec: number) => void
  /** decay timeScaleTimer with real dt; restores 1 when expired */
  tickTimeScale: (realDt: number) => void

  advanceGameTime: (scaledDt: number) => void

  /** set adaptive quality tier (FPS watcher only downgrades) */
  setQualityTier: (t: 0 | 1 | 2) => void

  /** full reset back to mission start values */
  resetRun: () => void

  /** compute final score incl. time/no-death bonuses */
  finalizeScore: (elapsedSec: number) => number
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let damageEventId = 0

export function gradeForScore(score: number): Grade {
  if (score >= SCORE.grades.S) return 'S'
  if (score >= SCORE.grades.A) return 'A'
  if (score >= SCORE.grades.B) return 'B'
  return 'C'
}

const initialStats = () => ({
  hp: PLAYER.maxHealth,
  shield: PLAYER.maxShield,
  energy: PLAYER.maxEnergy,
  lastDamageAt: -Infinity,
  kills: 0,
  headshots: 0,
  abilityKills: 0,
  score: 0,
})

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useGameStore = create<GameState>()((set, get) => ({
  phase: 'DROPSHIP',
  wave: 0,
  channelProgress: 0,
  extractionTimer: MISSION.extract.timerSec,
  extractionHold: 0,
  objectivePosition: null,

  ...initialStats(),

  damageEvents: [],
  timeScale: 1,
  timeScaleTimer: 0,
  gameTime: 0,
  qualityTier: 0,

  setPhase: (phase) => set({ phase }),
  setWave: (wave) => set({ wave }),
  setChannelProgress: (v) => set({ channelProgress: Math.min(1, Math.max(0, v)) }),
  setExtractionTimer: (v) => set({ extractionTimer: Math.max(0, v) }),
  setExtractionHold: (v) => set({ extractionHold: Math.max(0, v) }),
  setObjectivePosition: (objectivePosition) => set({ objectivePosition }),

  damagePlayer: (amount) =>
    set((s) => {
      let { shield, hp } = s
      const absorbed = Math.min(shield, amount)
      shield -= absorbed
      hp = Math.max(0, hp - (amount - absorbed))
      return { shield, hp, lastDamageAt: s.gameTime }
    }),

  healPlayer: (amount) => set((s) => ({ hp: Math.min(PLAYER.maxHealth, s.hp + amount) })),

  spendEnergy: (amount) => {
    const s = get()
    if (s.energy < amount) return false
    set({ energy: s.energy - amount })
    return true
  },

  addEnergy: (amount) => set((s) => ({ energy: Math.min(PLAYER.maxEnergy, s.energy + amount) })),

  /** per-frame regen: energy always; shield only after regen delay */
  regenTick: (scaledDt) =>
    set((s) => {
      const energy = Math.min(PLAYER.maxEnergy, s.energy + PLAYER.energyRegenPerSec * scaledDt)
      let shield = s.shield
      if (s.gameTime - s.lastDamageAt >= PLAYER.shieldRegenDelaySec && shield < PLAYER.maxShield) {
        shield = Math.min(PLAYER.maxShield, shield + PLAYER.shieldRegenPerSec * scaledDt)
      }
      if (energy === s.energy && shield === s.shield) return s
      return { energy, shield }
    }),

  registerKill: (opts) =>
    set((s) => {
      const bonus =
        SCORE.perKill +
        (opts?.headshot ? SCORE.perHeadshotBonus : 0) +
        (opts?.ability ? SCORE.perAbilityKill : 0)
      return {
        kills: s.kills + 1,
        headshots: s.headshots + (opts?.headshot ? 1 : 0),
        abilityKills: s.abilityKills + (opts?.ability ? 1 : 0),
        score: s.score + bonus,
        hp: Math.min(PLAYER.maxHealth, s.hp + PLAYER.healthOrbRestore),
        energy: Math.min(PLAYER.maxEnergy, s.energy + PLAYER.energyPerKill),
      }
    }),

  addScore: (points) => set((s) => ({ score: s.score + points })),

  pushDamageEvent: (ev) =>
    set((s) => ({
      damageEvents: [...s.damageEvents, { ...ev, id: damageEventId++, createdAt: performance.now() }],
    })),

  drainDamageEvents: () => {
    const evs = get().damageEvents
    if (evs.length) set({ damageEvents: [] })
    return evs
  },

  setTimeScale: (scale, durationSec) => set({ timeScale: scale, timeScaleTimer: durationSec }),

  tickTimeScale: (realDt) =>
    set((s) => {
      if (s.timeScaleTimer <= 0) return s.timeScale === 1 ? s : { timeScale: 1 }
      const t = s.timeScaleTimer - realDt
      return t <= 0 ? { timeScale: 1, timeScaleTimer: 0 } : { timeScaleTimer: t }
    }),

  advanceGameTime: (scaledDt) => set((s) => ({ gameTime: s.gameTime + scaledDt })),

  setQualityTier: (t) =>
    set((s) => (t === s.qualityTier ? s : { qualityTier: t })),

  resetRun: () =>
    set({
      phase: 'DROPSHIP',
      wave: 0,
      channelProgress: 0,
      extractionTimer: MISSION.extract.timerSec,
      extractionHold: 0,
      objectivePosition: null,
      ...initialStats(),
      damageEvents: [],
      timeScale: 1,
      timeScaleTimer: 0,
      gameTime: 0,
    }),

  finalizeScore: (elapsedSec) => {
    const s = get()
    const timeBonus = Math.max(
      0,
      Math.round(SCORE.timeBonusMax * (1 - elapsedSec / SCORE.timeBonusDecayFromSec)),
    )
    const total = s.score + timeBonus + SCORE.noDeathBonus
    set({ score: total })
    return total
  },
}))

// ---------------------------------------------------------------------------
// Sliced selectors (subscribe to a slice without re-render storms)
// ---------------------------------------------------------------------------

export const selectPhase = (s: GameState) => s.phase
export const selectWave = (s: GameState) => s.wave
export const selectChannelProgress = (s: GameState) => s.channelProgress
export const selectExtraction = (s: GameState) => ({
  timer: s.extractionTimer,
  hold: s.extractionHold,
})
export const selectObjectivePosition = (s: GameState) => s.objectivePosition
export const selectVitals = (s: GameState) => ({ hp: s.hp, shield: s.shield, energy: s.energy })
export const selectTallies = (s: GameState) => ({
  kills: s.kills,
  headshots: s.headshots,
  abilityKills: s.abilityKills,
  score: s.score,
})
export const selectTimeScale = (s: GameState) => s.timeScale
export const selectQualityTier = (s: GameState) => s.qualityTier

// Convenience re-export of common constants for hitstop usage
export { TIMESCALE }

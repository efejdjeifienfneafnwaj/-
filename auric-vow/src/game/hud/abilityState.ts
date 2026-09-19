/**
 * AURIC VOW — abilityState.ts
 * Tiny mutable cooldown/energy-cost registry driving the HUD ability
 * diamonds. The COMBAT agent owns *triggering*; the HUD owns *ticking*.
 *
 * Combat-agent contract:
 *   import { abilityState, triggerCooldown, triggerActive, canCast, setOvershield } from '@/game/hud'
 *
 *   // cast succeeded → start the diamond's cooldown sweep
 *   triggerCooldown(0)            // uses config cooldown (A1=4s …)
 *   triggerCooldown(2, 10)        // or override seconds
 *
 *   // timed active buff (Aegis Halo 5s) → rotating-dash border + radial fill
 *   triggerActive(2, 5)
 *
 *   // Aegis overshield amount for the 4px gold bar segment (0..100)
 *   setOvershield(100)
 *
 *   // pre-cast check (also read store.energy for spendEnergy)
 *   if (canCast(0, energy)) { spendEnergy(cost); triggerCooldown(0) }
 *
 * DO NOT call tickCooldowns() from combat code — HUD.tsx calls it once per
 * frame. Call resetAbilities() on run restart (HUD hooks store.resetRun).
 */
import { ABILITIES } from '../config'

const SPECS = [ABILITIES.A1, ABILITIES.A2, ABILITIES.A3, ABILITIES.A4]

export interface AbilityState {
  /** seconds of cooldown remaining per slot (0 = ready) */
  cooldowns: [number, number, number, number]
  /** full cooldown duration per slot (for sweep fraction) */
  cooldownMax: [number, number, number, number]
  /** energy cost per slot (from config) */
  costs: [number, number, number, number]
  /** remaining active-buff seconds per slot (Aegis duration etc.) */
  actives: [number, number, number, number]
  /** full active duration per slot */
  activeMax: [number, number, number, number]
  /** current Aegis overshield pool (0..ABILITIES.A3.extra.overshield) */
  overshield: number
}

export const abilityState: AbilityState = {
  cooldowns: [0, 0, 0, 0],
  cooldownMax: [
    SPECS[0].cooldownSec,
    SPECS[1].cooldownSec,
    SPECS[2].cooldownSec,
    SPECS[3].cooldownSec,
  ],
  costs: [SPECS[0].cost, SPECS[1].cost, SPECS[2].cost, SPECS[3].cost],
  actives: [0, 0, 0, 0],
  activeMax: [0, 0, SPECS[2].extra?.durationSec ?? 0, 0],
  overshield: 0,
}

/** start slot i's cooldown sweep (defaults to config duration) */
export function triggerCooldown(i: number, seconds?: number): void {
  if (i < 0 || i > 3) return
  abilityState.cooldowns[i] = seconds ?? abilityState.cooldownMax[i]
}

/** mark slot i as actively running for `seconds` (Aegis barrier etc.) */
export function triggerActive(i: number, seconds: number): void {
  if (i < 0 || i > 3) return
  abilityState.actives[i] = seconds
  abilityState.activeMax[i] = seconds
}

/** set the Aegis overshield pool shown above the shield bar */
export function setOvershield(v: number): void {
  abilityState.overshield = Math.max(0, v)
}

/** ready off cooldown AND affordable with the given energy */
export function canCast(i: number, energy: number): boolean {
  return abilityState.cooldowns[i] <= 0 && energy >= abilityState.costs[i]
}

/** HUD calls this once per frame (real seconds) */
export function tickCooldowns(dt: number): void {
  for (let i = 0; i < 4; i++) {
    if (abilityState.cooldowns[i] > 0) abilityState.cooldowns[i] = Math.max(0, abilityState.cooldowns[i] - dt)
    if (abilityState.actives[i] > 0) abilityState.actives[i] = Math.max(0, abilityState.actives[i] - dt)
  }
}

/** back to mission-start state */
export function resetAbilities(): void {
  abilityState.cooldowns = [0, 0, 0, 0]
  abilityState.actives = [0, 0, 0, 0]
  abilityState.overshield = 0
}

/**
 * AURIC VOW — ammoState.ts
 * The store has no ammo field (task contract), so weapon ammunition lives in
 * this tiny mutable module. The COMBAT agent writes; the HUD reads + ticks.
 *
 * Combat-agent contract:
 *   import { ammoState, consumeAmmo, startReload, resetAmmo } from '@/game/hud'
 *
 *   if (consumeAmmo()) { /* fire the shot *\/ }   // false → mag empty
 *   startReload()                                  // begin 1.4s reload
 *   resetAmmo()                                    // run restart
 *
 * HUD.tsx advances reloadT once per frame and auto-refills the mag from
 * reserve when the reload completes — combat should NOT tick reloadT itself.
 */
import { WEAPONS } from '../config'

export interface AmmoState {
  /** rounds in magazine */
  mag: number
  /** reserve pool (Infinity for the Vow rifle) */
  reserve: number
  /** magazine capacity */
  magSize: number
  /** true while a reload is in progress */
  reloading: boolean
  /** seconds elapsed in the current reload */
  reloadT: number
  /** reload duration in seconds */
  reloadSec: number
}

export const ammoState: AmmoState = {
  mag: WEAPONS.rifle.magSize,
  reserve: Infinity,
  magSize: WEAPONS.rifle.magSize,
  reloading: false,
  reloadT: 0,
  reloadSec: WEAPONS.rifle.reloadSec,
}

/** consume one round; false when the mag is dry or reloading */
export function consumeAmmo(): boolean {
  if (ammoState.reloading || ammoState.mag <= 0) return false
  ammoState.mag -= 1
  return true
}

/** begin a reload (no-op if already reloading or mag full) */
export function startReload(): void {
  if (ammoState.reloading || ammoState.mag >= ammoState.magSize) return
  ammoState.reloading = true
  ammoState.reloadT = 0
}

/** HUD calls this once per frame (real seconds); completes the reload */
export function tickReload(dt: number): void {
  if (!ammoState.reloading) return
  ammoState.reloadT += dt
  if (ammoState.reloadT >= ammoState.reloadSec) {
    const need = ammoState.magSize - ammoState.mag
    const taken = Math.min(need, ammoState.reserve)
    ammoState.mag += taken
    if (ammoState.reserve !== Infinity) ammoState.reserve -= taken
    ammoState.reloading = false
    ammoState.reloadT = 0
  }
}

/** back to mission-start state */
export function resetAmmo(): void {
  ammoState.mag = ammoState.magSize
  ammoState.reserve = Infinity
  ammoState.reloading = false
  ammoState.reloadT = 0
}

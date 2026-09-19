/* eslint-disable react-refresh/only-export-components */
/**
 * AURIC VOW — combat/index.ts
 * Public surface of the combat module. Mount inside the R3F canvas:
 *
 *   <CombatSystems />   — per-frame weapon + ability logic & world VFX
 *   <WeaponViewModel /> — camera-space rifle/katana meshes
 *
 * HUD integration (vfx-hud.md / design.md §5):
 *   ability diamonds + ammo counter are driven via '@/game/hud/abilityState'
 *   and '@/game/hud/ammoState' (triggerCooldown / consumeAmmo / startReload);
 *   getCombatHudSnapshot() + onCombatEvent(cb) expose the rest.
 */
import { WeaponSystems } from './Weapons'
import { AbilitySystems } from './Abilities'

export function CombatSystems() {
  return (
    <>
      <WeaponSystems />
      <AbilitySystems />
    </>
  )
}

export { WeaponViewModel } from './ViewModel'
export { resolveEnemyHit, raycastEnemies, rifleFalloff } from './DamageSystem'
export { CombatState, getCombatHudSnapshot, onCombatEvent, canFight, resetCombat } from './state'
export type { CombatEvent, CombatHudSnapshot, AbilityHudInfo, AbilityId } from './state'
export { getMuzzleWorld } from './Weapons'

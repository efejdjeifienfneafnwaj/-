/**
 * AURIC VOW — hud/index.ts
 * Public surface of the HUD layer.
 *
 * Mount (integrator): <HUD/> and <DamageNumbers/> as DOM siblings OUTSIDE
 * the R3F Canvas; <VFXSystems/> (from '@/game/vfx') inside the Canvas binds
 * the camera for damage numbers + the objective marker.
 */
export { default as HUD } from './HUD'
export { default as DamageNumbers } from './DamageNumbers'
export { bindCamera, unbindCamera, getHudCamera } from './DamageNumbers'
export {
  abilityState,
  triggerCooldown,
  triggerActive,
  setOvershield,
  canCast,
  tickCooldowns,
  resetAbilities,
  type AbilityState,
} from './abilityState'
export {
  ammoState,
  consumeAmmo,
  startReload,
  tickReload,
  resetAmmo,
  type AmmoState,
} from './ammoState'
export { enemyState, setEnemiesAlive } from './enemyState'

/**
 * AURIC VOW — player/index.ts
 * Public surface of the player module. Mount in the scene:
 *   <PlayerController /> <PlayerRig /> <CameraRig />
 * Read PlayerRef live for enemy/combat targeting; call addTrauma(n) for
 * screen shake from combat/abilities.
 */
export { default as PlayerController, resetPlayer } from './PlayerController'
export { default as PlayerRig } from './PlayerRig'
export { default as CameraRig, addTrauma } from './CameraRig'
export { PlayerRef, PlayerAnim } from './PlayerRef'
export type { PlayerState, PlayerRefShape } from './PlayerRef'

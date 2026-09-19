/**
 * AURIC VOW — world/index.ts
 * Environment public surface. The integrator mounts:
 *   <ShrineStation /> <Lighting /> <Skybox /> <Fog /> <EnvironmentFX />
 *   (<ColliderDebug /> optional — ` Backquote toggles collider wireframes)
 */
export { default as ShrineStation } from './ShrineStation'
export { default as Lighting } from './Lighting'
export { default as Skybox } from './Skybox'
export { default as Fog } from './Fog'
export { default as EnvironmentFX } from './EnvironmentFX'
export { default as ColliderDebug } from './ColliderDebug'

// collider registry API (unchanged surface; spatial-hash internals)
export {
  registerCollider,
  unregisterCollider,
  clearColliders,
  getColliders,
  raycastLevel,
  collideCapsule,
} from './Colliders'
export type { Collider, RaycastHit, CapsuleHit } from './Colliders'

// level layout anchors + static collider builder
export {
  SPAWN_POSITION,
  RELIQUARY_POSITION,
  EXTRACTION_PAD_POSITION,
  ARENA_CENTER,
  CHAMBER_CENTER,
  ZONE_Z,
  buildLevelColliders,
} from './layout'

/**
 * AURIC VOW — mission/zones.ts
 * Zone trigger bounds + spawn anchor constants, aligned with environment.md §2
 * (mission flows along +Z; 1 unit = 1 m):
 *   A spawn platform z 0–15 · B canyon z 15–135 · C chamber z 135–165
 *   D arena z 165–225 (60×60) · E bridge+pad z 225–265
 *
 * INTEGRATORS: if the built level deviates from these coordinates, adjust
 * HERE only — EnemyManager / MissionDirector / ObjectiveMarker all read
 * from this module.
 */
import * as THREE from 'three'
import {
  SPAWN_POSITION,
  RELIQUARY_POSITION,
  EXTRACTION_PAD_POSITION,
  ARENA_CENTER,
  ZONE_Z,
} from '@/game/world/layout'

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)

/** Petal Gate sits at the chamber south wall (world/layout.ts PETAL_GATE z≈135) */
const CHAMBER_DOOR_Z = ZONE_Z.chamber[0] - 2 // trigger just before the gate

export const ZONES = {
  /** Zone A — spawn dais center */
  spawn: { center: SPAWN_POSITION.clone() },

  /** Zone B→C boundary: sealed Petal Gate / chamber door */
  chamberDoor: {
    position: v(0, 2, CHAMBER_DOOR_Z),
    triggerZ: CHAMBER_DOOR_Z,
  },

  /** Zone C — Null Reliquary at the rotunda center */
  reliquary: {
    position: RELIQUARY_POSITION.clone(),
    channelRadius: 4,
    /** trickle-in spawn anchors just inside the chamber door */
    defenderSpawns: [v(-8, 0, 141), v(8, 0, 141), v(0, 0, 139)],
  },

  /** Zone D — combat arena (60×60) with 4 petal-door spawns */
  arena: {
    center: ARENA_CENTER.clone(),
    half: 30,
    doors: [
      v(0, 0, 222), // N
      v(0, 0, 168), // S
      v(27, 0, 195), // E
      v(-27, 0, 195), // W
    ] as THREE.Vector3[],
  },

  /** Zone E — extraction bridge + pad (z 225–265, pad at far end) */
  extraction: {
    pad: EXTRACTION_PAD_POSITION.clone(),
    padRadius: 5,
    beacon: EXTRACTION_PAD_POSITION.clone().add(v(0, 1, 0)),
    /** harass-drone air-drop anchors along the bridge */
    bridgeSpawns: [v(-4, 3, 232), v(4, 3, 242), v(-4, 3, 250), v(4, 3, 256)],
  },

  /**
   * Phase-1 patrol loops (4 drones, canyon segments B1–B3, z 15–125).
   * Hover heights keep them above the broken deck.
   */
  dronePatrols: [
    [v(4, 3, 20), v(-4, 4, 32), v(3, 3, 43)], // B1
    [v(-5, 4, 50), v(5, 5, 65), v(-4, 4, 80)], // B2
    [v(6, 6, 90), v(-6, 8, 105), v(0, 9, 120)], // B3 spire
    [v(0, 4, 28), v(6, 5, 60), v(-6, 6, 100)], // long B1→B3 sweep
  ] as THREE.Vector3[][],
} as const

/** fallback objective target per phase when the store has none set */
export function zoneTargetForPhase(phase: string): THREE.Vector3 | null {
  switch (phase) {
    case 'DROPSHIP':
    case 'INFILTRATE':
      return ZONES.chamberDoor.position
    case 'OBJECTIVE':
      return ZONES.reliquary.position
    case 'EXTRACT':
      return ZONES.extraction.beacon
    default:
      return null // EXTERMINATE: arena medallion pulses instead (no marker)
  }
}

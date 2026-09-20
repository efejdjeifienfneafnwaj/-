/**
 * AURIC VOW — world/layout.ts
 * Concrete zone coordinates for the "Anvil of Silence" (environment.md §2).
 * Mission flows along +Z, z = 0..265. 1 unit = 1 m. Floor tops sit at y = 0
 * unless noted. Shared by ShrineStation (geometry) and the collider builder
 * so visuals and collision never drift apart.
 *
 * Collider tag conventions (per environment.md §5):
 *   'floor'       walkable ground
 *   'wall'        blocking surface
 *   'wallrun'     wall-run-tagged slab (always also 'wall')
 *   'platform'    elevated walkable platform (also 'floor')
 *   'objective'   the Null Reliquary blocker
 *   'extract-pad' extraction pad
 */
import * as THREE from 'three'
import { registerCollider } from './Colliders'

// ---------------------------------------------------------------------------
// Key world anchors
// ---------------------------------------------------------------------------
export const SPAWN_POSITION = new THREE.Vector3(0, 0.1, 5)
export const RELIQUARY_POSITION = new THREE.Vector3(0, 3.2, 150)
export const EXTRACTION_PAD_POSITION = new THREE.Vector3(0, 0.1, 258)

export const ARENA_CENTER = new THREE.Vector3(0, 0, 195)
export const CHAMBER_CENTER = new THREE.Vector3(0, 0, 150)

/** zone z-ranges (for fog switching, spawn logic, etc.) */
export const ZONE_Z = {
  spawn: [0, 15],
  canyon: [15, 135],
  chamber: [135, 165],
  arena: [165, 225],
  extraction: [225, 265],
} as const

// ---------------------------------------------------------------------------
// Shared structural boxes (axis-aligned). All lengths in meters.
// ---------------------------------------------------------------------------
export interface BoxSpec {
  x0: number
  y0: number
  z0: number
  x1: number
  y1: number
  z1: number
}

export function boxCenter(b: BoxSpec): [number, number, number] {
  return [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, (b.z0 + b.z1) / 2]
}
export function boxSize(b: BoxSpec): [number, number, number] {
  return [b.x1 - b.x0, b.y1 - b.y0, b.z1 - b.z0]
}

/** Zone B1 deck segments (x −6..6, top y0, 1 m thick). Gaps: 4 m / 6 m / 8 m. */
export const B1_DECKS: BoxSpec[] = [
  { x0: -6, y0: -1, z0: 13.5, x1: 6, y1: 0, z1: 21 },
  { x0: -6, y0: -1, z0: 25, x1: 6, y1: 0, z1: 29 },
  { x0: -6, y0: -1, z0: 35, x1: 6, y1: 0, z1: 37 },
]

/** Wall-run slabs: two in B2, one climbing slab in B3. Gold-veined. */
export const WALLRUN_SLABS: BoxSpec[] = [
  { x0: -4.5, y0: -1, z0: 46, x1: -1.5, y1: 6, z1: 64 }, // B2 slab A (west)
  { x0: 1.5, y0: -1, z0: 66, x1: 4.5, y1: 6, z1: 84 }, // B2 slab B (east)
  { x0: -5, y0: 0, z0: 91, x1: -2, y1: 8.5, z1: 109 }, // B3 climbing slab
]

/** B3 broken spire (top y8 = glide launch) + high landing ledge (top y8). */
export const SPIRE: BoxSpec = { x0: 1.5, y0: 0, z0: 103, x1: 6.5, y1: 8, z1: 109 }
export const HIGH_LEDGE: BoxSpec = { x0: -5, y0: 7, z0: 124, x1: 5, y1: 8, z1: 130 }

/** B4 steps down from the ledge (top y8) to the chamber floor (y0). */
export const B4_STEPS: BoxSpec[] = [
  { x0: -5, y0: 5, z0: 130, x1: 5, y1: 6, z1: 131.5 },
  { x0: -5, y0: 3, z0: 131.5, x1: 5, y1: 4, z1: 133 },
  { x0: -5, y0: 1, z0: 133, x1: 5, y1: 2, z1: 134.5 },
]

/** Petal gate opening in the chamber south wall (z135). */
export const PETAL_GATE: BoxSpec = { x0: -3, y0: 0, z0: 134.4, x1: 3, y1: 8, z1: 135 }

/** Bridge gate seal in the arena north wall (z225) — removed at phase EXTRACT. */
export const BRIDGE_SEAL: BoxSpec = { x0: -4, y0: 0, z0: 224.6, x1: 4, y1: 8, z1: 225 }

/** Arena cover: obsidian pylons 1.2×3×1.2 (x,z centers). */
export const ARENA_PYLONS: [number, number][] = [
  [-10, 182],
  [12, 178],
  [-16, 200],
  [8, 205],
  [18, 192],
  [-6, 214],
]

/** Petal planters: chamber ×4 + arena ×4 (x,z centers). */
export const CHAMBER_PLANTERS: [number, number][] = [
  [-6, 144],
  [6, 144],
  [-6, 156],
  [6, 156],
]
export const ARENA_PLANTERS: [number, number][] = [
  [-20, 175],
  [20, 185],
  [-14, 212],
  [16, 216],
]

/** Arena long low walls (wall-runnable tops), x/z centers, 8×1.2×0.6. */
export const ARENA_LOW_WALLS: [number, number][] = [
  [-7, 186],
  [9, 204],
]

/** Arena wall-run slabs to the upper gallery (east / west). */
export const ARENA_WALLRUN_SLABS: BoxSpec[] = [
  { x0: -29, y0: 0, z0: 170, x1: -28, y1: 7, z1: 190 }, // west
  { x0: 28, y0: 0, z0: 200, x1: 29, y1: 7, z1: 220 }, // east
]

/** Arena upper gallery ledges (top y6): south + north. */
export const ARENA_GALLERIES: BoxSpec[] = [
  { x0: -20, y0: 5, z0: 165, x1: 20, y1: 6, z1: 170 },
  { x0: -20, y0: 5, z0: 220, x1: 20, y1: 6, z1: 225 },
]

/**
 * Arena elevation layers around the central portal ring (fix2 composition):
 * broken low platforms (top y1.2) → floating megaliths (top y3.4) → high
 * megaliths (top y6.4, reachable from the y6 galleries). All landable —
 * registered as 'floor'/'platform' colliders. AABBs match the visual slabs
 * exactly (no yaw) so collision never drifts.
 */
export const ARENA_MEGALITHS: BoxSpec[] = [
  // layer 1 — broken low platforms
  { x0: -24.2, y0: 0.3, z0: 183.8, x1: -19.8, y1: 1.2, z1: 188.2 },
  { x0: 20.8, y0: 0.3, z0: 204.8, x1: 25.2, y1: 1.2, z1: 209.2 },
  { x0: -3.2, y0: 0.3, z0: 170.3, x1: 1.2, y1: 1.2, z1: 174.7 },
  // layer 2 — floating megaliths
  { x0: -15.8, y0: 2.6, z0: 216.2, x1: -12.2, y1: 3.4, z1: 219.8 },
  { x0: 15.2, y0: 2.6, z0: 172.7, x1: 18.8, y1: 3.4, z1: 176.3 },
  // layer 3 — high megaliths (gallery-height hops)
  { x0: 8.4, y0: 5.6, z0: 190.4, x1: 11.6, y1: 6.4, z1: 193.6 },
  { x0: -12.6, y0: 5.6, z0: 197.4, x1: -9.4, y1: 6.4, z1: 200.6 },
]

/** Enemy spawn gates: [x, z, facingDeg] — N, S, E, W arena walls. */
export const SPAWN_GATES: [number, number, number][] = [
  [0, 224.7, 180], // north wall
  [0, 165.3, 0], // south wall
  [29.7, 195, -90], // east wall
  [-29.7, 195, 90], // west wall
]

// ---------------------------------------------------------------------------
// Visual-only data (NO colliders — distant silhouette set dressing)
// ---------------------------------------------------------------------------

/**
 * Distant station monoliths floating in the void (parallax silhouettes).
 * Purely visual — outside the play space, unreachable, no colliders.
 * yaw breaks the silhouette; ShrineStation derives secondary masses,
 * panel lines, gold trim insets and emissive stripes from these.
 */
export interface MonolithSpec {
  p: [number, number, number]
  yaw: number
  s: [number, number, number]
}

export const MONOLITHS: MonolithSpec[] = [
  { p: [52, -14, 40], yaw: 0.22, s: [10, 60, 10] },
  { p: [74, -22, 90], yaw: -0.38, s: [14, 44, 14] },
  { p: [46, -18, 150], yaw: 0.55, s: [8, 50, 8] },
  { p: [88, -26, 210], yaw: -0.18, s: [18, 38, 18] },
  { p: [40, -20, 250], yaw: 0.42, s: [9, 42, 9] },
  { p: [-60, -30, 60], yaw: -0.5, s: [16, 40, 16] },
  { p: [-48, -26, 200], yaw: 0.3, s: [12, 46, 12] },
  { p: [0, -42, 195], yaw: 0.14, s: [26, 40, 26] },
  { p: [-34, -38, 120], yaw: -0.7, s: [10, 34, 10] },
  { p: [62, -30, 262], yaw: 0.62, s: [12, 36, 12] },
]

/**
 * R3 — enclosure tables. VISUAL ONLY: nothing below is read by
 * `buildLevelColliders`, and every piece placed from it sits above or outside
 * the play volume. The level had no ceiling anywhere, which is the single
 * loudest "this is a blockout" signal in a wide shot; these tables drive the
 * coffered vaults, the canyon gantries and the portal reveals that close it.
 */

/** z centres of the six 10 m coffered bays that roof the arena (z 165..225). */
export const ARENA_VAULT_BAYS: number[] = [170, 180, 190, 200, 210, 220]
/** which of those bays leave the ridge open as an oculus slot. */
export const ARENA_VAULT_OCULUS_BAYS: number[] = [190, 200]

/** z centres of the 7 m vault bays over the extraction bridge (z 225..253). */
export const BRIDGE_VAULT_BAYS: number[] = [228.5, 235.5, 242.5, 249.5]

/**
 * Canyon overhead gantries. Each is a deep girder with a coffered soffit
 * carried on a transverse arch, spanning the ravine between the two outer
 * wall cornices (west x −9.5 / y 17.2, east x +14.1 / y 19.2). They cross the
 * top of frame as the player runs beneath, which is the near-camera framing
 * the composition has never had. `lamps` are the x offsets of the pendants
 * hung from each one.
 */
export const CANYON_GANTRIES: number[] = [28, 50, 72, 94, 116]
export const CANYON_GANTRY_SPAN: [number, number] = [-9.5, 14.1]
export const CANYON_GANTRY_Y = 16.4
export const CANYON_PENDANT_X: number[] = [-3.2, 3.4]

/**
 * R4 — arena wall rhythm. VISUAL ONLY.
 *
 * The round-3 panel read the arena as "one panel stamped in a perfect 20×8
 * grid". Half of that is the material (fixed on the surfacing side); the other
 * half was that every applied element sat on the same 6 m metronome, on all
 * four walls, mirrored left to right. These are the pair centres of the
 * coupled colonnade that replaced it — deliberately unequal, and a DIFFERENT
 * run on each of the four walls, with one wide bay off-centre on the west side
 * where the hero buttress lands.
 *
 * Nothing here is read by `buildLevelColliders`. The wall field behind these
 * bays is set back into the wall's own 1 m thickness (outward only), so no
 * surface the player can touch moves and every collider below is unchanged.
 */
export const ARENA_BAY_PAIRS = {
  west: [170.6, 180.4, 191.2, 205.0, 214.4, 221.8],
  east: [168.8, 177.4, 187.0, 198.2, 209.4, 217.2, 223.4],
  south: [-23.6, -15.0, -8.8, 8.8, 15.0, 23.6],
  north: [-22.2, -16.4, -9.4, 9.4, 18.0, 24.2],
} as const
/** half separation of a coupled pair, and the wall-field set-back */
export const ARENA_PAIR_GAP = 1.15
export const ARENA_WALL_RECESS = 0.5

/**
 * The arena's asymmetric hero mass: a canted buttress corbelled off the west
 * wall in the wide bay, leaning out over the floor and crossing the top of
 * frame from most of the room. Everything that projects starts above 2.75 m,
 * clear of the 1.8 m player capsule, so it is visual only like the rest of
 * this block. [wall x, z].
 */
export const ARENA_BUTTRESS: [number, number] = [-30, 198.1]
/** its non-matching answer on the east wall — a framed aedicule sunk in the
 *  wall recess, at a z that deliberately does not mirror the buttress */
export const ARENA_AEDICULE_Z = 187.0

/**
 * Deep portal reveals at every zone threshold: [z of the wall face, half
 * opening width, head height, +1 if the room is on the +z side].
 * These sit in the existing wall openings — no collider is added or moved.
 */
export const PORTALS: [number, number, number, number][] = [
  [135, 3, 8, 1], // canyon → chamber (petal gate)
  [165, 3, 8, 1], // chamber → arena (south gate)
  [225, 4, 8, 1], // arena → extraction bridge
]

// ---------------------------------------------------------------------------
// Static collider build
// ---------------------------------------------------------------------------
const _b = new THREE.Box3()

function addBox(spec: BoxSpec, tags: string[]) {
  _b.min.set(spec.x0, spec.y0, spec.z0)
  _b.max.set(spec.x1, spec.y1, spec.z1)
  registerCollider(_b, tags)
}

function addCentered(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, tags: string[]) {
  _b.min.set(cx - sx / 2, cy - sy / 2, cz - sz / 2)
  _b.max.set(cx + sx / 2, cy + sy / 2, cz + sz / 2)
  registerCollider(_b, tags)
}

/**
 * Register every static AABB for the level. Dynamic gate colliders (petal
 * gate, bridge seal) are owned by their components — they unregister when
 * the gate opens. Canyon gaps deliberately have NO floor colliders (void).
 */
export function buildLevelColliders(): void {
  // ---- Zone A: spawn dais ----
  addBox({ x0: -6, y0: -1, z0: 1.5, x1: 6, y1: 0, z1: 13.5 }, ['floor'])
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8
    addCentered(Math.cos(a) * 5.2, 4.5, 7.5 + Math.sin(a) * 5.2, 1.2, 9, 1.2, ['wall'])
  }

  // ---- Zone B: traversal canyon ----
  for (const d of B1_DECKS) addBox(d, ['floor', 'platform'])
  addBox({ x0: -6, y0: -1, z0: 85, x1: 6, y1: 0, z1: 89 }, ['floor', 'platform']) // B3 start
  addBox({ x0: -6.2, y0: 0, z0: 13.5, x1: -5.8, y1: 1, z1: 37 }, ['wall']) // B1 west rail
  addBox({ x0: -6.4, y0: 0, z0: 40, x1: -5.9, y1: 9, z1: 135 }, ['wall']) // west wall B2–B4
  addBox({ x0: 5.9, y0: 0, z0: 13.5, x1: 6.3, y1: 8, z1: 135 }, ['wall']) // east glass wall
  for (const s of WALLRUN_SLABS) addBox(s, ['wallrun', 'wall', 'platform'])
  addBox(SPIRE, ['wall', 'platform'])
  addBox(HIGH_LEDGE, ['floor', 'platform'])
  for (const s of B4_STEPS) addBox(s, ['floor', 'platform'])

  // ---- Zone C: objective chamber (30×30) ----
  addBox({ x0: -15, y0: -1, z0: 135, x1: 15, y1: 0, z1: 165 }, ['floor'])
  addBox({ x0: -15, y0: 0, z0: 134, x1: -3, y1: 10, z1: 135 }, ['wall']) // south L
  addBox({ x0: 3, y0: 0, z0: 134, x1: 15, y1: 10, z1: 135 }, ['wall']) // south R
  addBox({ x0: -15, y0: 0, z0: 165, x1: -3, y1: 10, z1: 166 }, ['wall']) // north L
  addBox({ x0: 3, y0: 0, z0: 165, x1: 15, y1: 10, z1: 166 }, ['wall']) // north R
  addBox({ x0: 15, y0: 0, z0: 135, x1: 16, y1: 10, z1: 165 }, ['wall']) // east
  addBox({ x0: -16, y0: 0, z0: 135, x1: -15, y1: 10, z1: 165 }, ['wall']) // west
  for (const [px, pz] of CHAMBER_PLANTERS) addCentered(px, 0.55, pz, 2, 1.1, 2, ['wall'])
  addCentered(0, 3.2, 150, 2.2, 2.6, 2.2, ['objective']) // Null Reliquary blocker

  // ---- Zone D: combat arena (60×60) ----
  addBox({ x0: -30, y0: -1, z0: 165, x1: 30, y1: 0, z1: 225 }, ['floor'])
  addBox({ x0: -30, y0: 0, z0: 164, x1: -3, y1: 10, z1: 165 }, ['wall']) // south L
  addBox({ x0: 3, y0: 0, z0: 164, x1: 30, y1: 10, z1: 165 }, ['wall']) // south R
  addBox({ x0: -30, y0: 0, z0: 225, x1: -4, y1: 10, z1: 226 }, ['wall']) // north L
  addBox({ x0: 4, y0: 0, z0: 225, x1: 30, y1: 10, z1: 226 }, ['wall']) // north R
  addBox({ x0: 30, y0: 0, z0: 165, x1: 31, y1: 10, z1: 225 }, ['wall']) // east
  addBox({ x0: -31, y0: 0, z0: 165, x1: -30, y1: 10, z1: 225 }, ['wall']) // west
  for (const g of ARENA_GALLERIES) addBox(g, ['floor', 'platform'])
  for (const s of ARENA_WALLRUN_SLABS) addBox(s, ['wallrun', 'wall', 'platform'])
  for (const [px, pz] of ARENA_PYLONS) addCentered(px, 1.5, pz, 1.2, 3, 1.2, ['wall'])
  for (const [px, pz] of ARENA_PLANTERS) addCentered(px, 0.55, pz, 2, 1.1, 2, ['wall'])
  for (const [px, pz] of ARENA_LOW_WALLS) addCentered(px, 0.6, pz, 8, 1.2, 0.6, ['wallrun', 'wall'])
  for (const m of ARENA_MEGALITHS) addBox(m, ['floor', 'platform']) // fix2 elevation layers

  // ---- Zone E: extraction bridge + pad ----
  addBox({ x0: -4, y0: -1, z0: 225, x1: 4, y1: 0, z1: 253 }, ['floor'])
  addBox({ x0: -4.3, y0: 0, z0: 225, x1: -3.9, y1: 1, z1: 253 }, ['wall']) // west rail
  addBox({ x0: 3.9, y0: 0, z0: 225, x1: 4.3, y1: 1, z1: 253 }, ['wall']) // east rail
  addBox({ x0: -6, y0: -1, z0: 252, x1: 6, y1: 0, z1: 264 }, ['floor', 'extract-pad'])

  // NOTE: no kill-z collider — void falls are handled by the game loop.
}

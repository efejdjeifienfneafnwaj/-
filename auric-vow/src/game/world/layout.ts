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
 * R5 — arena deck services. VISUAL ONLY, and FLUSH.
 *
 * The arena deck is 60 x 60 m and every wide shot spends its bottom third on
 * it, with nothing there but two inlaid rings. These are the sunk sump grates
 * and the bolted access hatches that dress it. Everything placed from these
 * tables lives between y 0.028 and y 0.05 — inside the deck's own top
 * millimetres, lower than the gold inlay already lying on it — so nothing
 * stands proud, nothing is walked into and `buildLevelColliders` is untouched.
 *
 * Positions are chosen to miss the mandala channel radii (8, 13, 18, 22 m) and
 * the medallion ring radii (12, 16, 20 m), so the deck never resolves into a
 * single concentric lattice.
 *
 * grate: [x, z, turned] — `turned` runs the bars along x instead of z.
 * hatch: [x, z].
 */
export const ARENA_DECK_GRATES: [number, number, number][] = [
  [-23.4, 177.6, 0],
  [23.4, 177.6, 0],
  [-23.4, 212.4, 0],
  [23.4, 212.4, 0],
  [0, 171.2, 1],
  [0, 218.8, 1],
]
export const ARENA_DECK_HATCHES: [number, number][] = [
  [-17.2, 190.4],
  [18.6, 199.8],
  [-9.8, 217.4],
  [11.4, 172.6],
]

/**
 * R5 — the arena's dark dado register. VISUAL ONLY.
 *
 * The height the wall changes value at, shared by the dado body, its panelled
 * field and its cap moulding. It is recorded here rather than in
 * `ShrineStation.tsx` because it is the number the enemy-art stream needs if
 * it ever wants to know what value a trooper is seen against at play height:
 * everything below this is umber, everything above it is ivory. It is a
 * SURFACE height on a wall whose collider face does not move, so no collider
 * reads it.
 */
export const ARENA_DADO_TOP = 2.3

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

// ---------------------------------------------------------------------------
// R7 — SERVICE GREEBLE + SOFT MATERIAL FAMILY. VISUAL ONLY.
//
// Nothing below is read by `buildLevelColliders`, and every run is authored
// either ABOVE the 1.8 m player capsule or tight enough to a wall face that it
// sits inside the projection the pilaster nosings already have. No collider
// coordinate in this file changed to make room for any of it.
//
// Why it exists: the reference frame has no square metre of flat anything —
// conduit runs, bolted flanges, vents, cable trays, handrails and growth cross
// every ordered surface at angles that do not agree with the architecture. Our
// arena had a beautifully regular Orokin order and NOTHING crossing it, which
// is why a 200 px crop of its wall resolved to one repeated element.
//
// The z/x positions below are deliberately COPRIME with ARENA_BAY_PAIRS: a
// service run that happens to land on a pier centre reads as more architecture
// rather than as something bolted on afterwards.
// ---------------------------------------------------------------------------

/**
 * Arena horizontal conduit runs on the long walls.
 * [side(+1 east / −1 west), y, z0, z1, radius, dropAtEnd(0 none / −1 z0 / +1 z1)]
 */
export const ARENA_PIPE_LONG: [number, number, number, number, number, number][] = [
  [-1, 7.35, 166.4, 189.7, 0.145, 1],
  [-1, 7.05, 191.6, 213.2, 0.145, 1],
  [-1, 6.62, 172.8, 204.1, 0.075, -1],
  [-1, 4.15, 199.4, 223.6, 0.098, -1],
  [-1, 3.62, 166.9, 182.3, 0.075, 1],
  [1, 7.62, 167.8, 196.4, 0.145, -1],
  [1, 7.28, 198.9, 222.7, 0.145, 1],
  [1, 6.9, 176.2, 211.4, 0.075, 1],
  [1, 4.42, 168.6, 190.8, 0.098, 1],
  [1, 3.48, 203.7, 221.9, 0.075, -1],
]

/**
 * Arena conduit runs on the two end walls.
 * [side(+1 north z225 / −1 south z165), y, x0, x1, radius, dropAtEnd]
 */
export const ARENA_PIPE_END: [number, number, number, number, number, number][] = [
  [-1, 7.18, -28.4, -6.2, 0.13, -1],
  [-1, 6.48, 7.4, 26.8, 0.085, 1],
  [-1, 3.92, -24.1, -9.6, 0.075, 1],
  [1, 7.44, -26.6, -8.1, 0.13, 1],
  [1, 6.72, 6.8, 28.2, 0.085, -1],
  [1, 4.08, 10.2, 27.4, 0.075, -1],
]

/**
 * Vent louvre boxes recessed into the arena wall field.
 * [wall(0 west / 1 east / 2 south / 3 north), along, y, width, height]
 */
export const ARENA_VENTS: [number, number, number, number, number][] = [
  [0, 174.9, 5.15, 2.3, 1.55],
  [0, 196.3, 4.4, 1.7, 1.25],
  [0, 218.6, 5.6, 2.9, 1.4],
  [1, 171.4, 4.75, 2.6, 1.3],
  [1, 193.8, 5.5, 1.9, 1.6],
  [1, 211.2, 4.25, 2.4, 1.2],
  [2, -18.7, 5.3, 2.2, 1.45],
  [2, 12.9, 4.6, 1.8, 1.2],
  [3, -11.4, 5.05, 2.5, 1.35],
  [3, 21.6, 5.7, 2.0, 1.5],
]

/**
 * Sagging catenary cable spans. [x0,y0,z0, x1,y1,z1, sag].
 * All anchors are ≥ 3.9 m so no span can be walked into; the deepest sag on
 * the longest run still clears the capsule by more than a metre.
 */
export const CABLE_SPANS: [number, number, number, number, number, number, number][] = [
  // arena — long diagonals crossing the top of frame
  [-29.4, 8.1, 172.2, -29.4, 8.1, 186.4, 1.15],
  [-29.4, 7.8, 188.6, -29.4, 7.8, 205.1, 1.35],
  [29.4, 8.3, 169.6, 29.4, 8.3, 184.9, 1.2],
  [29.4, 7.9, 201.3, 29.4, 7.9, 219.8, 1.5],
  [-28.9, 6.9, 178.4, -20.2, 6.6, 178.4, 0.95],
  [28.9, 7.1, 207.6, 20.4, 6.7, 207.6, 0.9],
  [-19.6, 6.35, 168.2, 19.6, 6.35, 168.2, 2.2],
  [-19.6, 6.35, 222.4, 19.6, 6.35, 222.4, 2.2],
  [-7.2, 7.4, 193.0, -28.6, 8.2, 187.2, 1.6],
  // chamber — hung across the dome springing
  [-14.6, 7.6, 141.8, 14.6, 7.6, 141.8, 2.4],
  [-14.6, 7.6, 158.6, 14.6, 7.6, 158.6, 2.4],
  [-14.6, 5.9, 149.0, -3.4, 6.4, 149.0, 0.85],
  [14.6, 5.9, 151.4, 3.4, 6.4, 151.4, 0.85],
  // canyon — strung between the wall cornices, crossing the run
  [-5.7, 6.4, 44.0, 5.7, 6.4, 47.2, 1.05],
  [-5.7, 6.9, 68.5, 5.7, 6.9, 65.4, 1.15],
  [-5.7, 6.2, 96.8, 5.7, 6.2, 99.6, 1.0],
  [-5.7, 6.7, 120.4, 5.7, 6.7, 117.1, 1.2],
  // extraction bridge
  [-3.9, 5.4, 231.2, 3.9, 5.4, 233.8, 0.8],
  [-3.9, 5.4, 244.6, 3.9, 5.4, 241.9, 0.8],
]

/**
 * Growth clumps — the second, SOFT material family. [x, y, z, scale, yaw].
 * Placed at wall/floor junctions and on upward ledges where damp collects,
 * concentrated at the aperture bays. The reference frame's only saturated hue
 * is the green growing over the metal; this is our equivalent, and it is the
 * single largest reason that image does not read as a CAD render.
 */
export const GROWTH_CLUMPS: [number, number, number, number, number][] = [
  // arena floor/wall junction — west
  [-29.3, 0, 168.6, 1.25, 0.4], [-29.4, 0, 176.9, 0.9, 1.9], [-29.2, 0, 184.2, 1.45, 2.8],
  [-29.5, 0, 197.4, 1.05, 0.9], [-29.3, 0, 209.8, 1.3, 3.6], [-29.4, 0, 219.1, 0.85, 5.1],
  // arena — east
  [29.3, 0, 171.2, 1.15, 3.3], [29.4, 0, 182.6, 1.5, 4.7], [29.2, 0, 194.8, 0.95, 1.2],
  [29.5, 0, 206.3, 1.35, 2.1], [29.3, 0, 216.7, 1.1, 5.6],
  // arena — end walls, dense at the gate apertures
  [-4.6, 0, 165.4, 1.6, 0.7], [4.9, 0, 165.4, 1.35, 2.4],
  [-5.4, 0, 224.6, 1.5, 4.1], [5.2, 0, 224.6, 1.7, 1.5],
  [-15.8, 0, 165.4, 0.9, 3.0], [17.2, 0, 224.6, 1.0, 5.4],
  // arena galleries — growth on the upward ledge faces
  [-17.4, 6, 167.6, 1.2, 1.1], [11.8, 6, 168.3, 0.95, 4.4],
  [-9.2, 6, 221.8, 1.1, 2.6], [15.6, 6, 222.4, 1.3, 0.3],
  // chamber junctions
  [-14.5, 0, 140.2, 1.2, 2.2], [14.5, 0, 146.8, 1.05, 4.9], [-14.5, 0, 158.4, 1.4, 0.6],
  [14.5, 0, 161.6, 0.9, 3.8], [-6.2, 0, 135.5, 1.5, 1.4], [6.6, 0, 164.5, 1.25, 5.0],
  // canyon deck edges + wall foot
  [-5.6, 0, 16.4, 1.1, 1.8], [5.6, 0, 19.2, 0.95, 4.2], [-5.6, 0, 26.8, 1.3, 0.5],
  [-5.6, 0, 86.4, 1.4, 3.1], [5.6, 0, 87.8, 1.15, 1.0],
  [-5.6, 7, 126.2, 1.05, 2.7], [5.0, 7, 128.4, 1.2, 5.3],
]

/**
 * Debris crates and stacked containers — 1 m scale references, the thing a
 * procedural hall never has. [x, z, yaw, count]. All sit on existing deck and
 * are ≤ 1.1 m tall, so they read as steppable dressing rather than cover; none
 * is registered as a collider (see the note at the top of this block).
 */
export const CRATE_CLUSTERS: [number, number, number, number][] = [
  [-26.4, 173.8, 0.31, 3],
  [27.1, 181.2, -0.52, 2],
  [-24.8, 206.4, 0.18, 4],
  [25.6, 214.9, 0.74, 2],
  [-12.6, 167.4, -0.24, 3],
  [13.9, 223.1, 0.46, 2],
  [-13.8, 138.6, 0.62, 2],
  [13.4, 162.2, -0.35, 3],
  [-4.2, 27.1, 0.28, 2],
  [4.4, 86.8, -0.61, 3],
]

/**
 * Handrail runs — the reference's most repeated near-camera element.
 * [x0, y, z0, x1, z1]. Rails stand on existing platform edges; the posts are
 * 1.05 m and the rail 1.0 m, both above the gallery/ledge tops they sit on.
 */
export const HANDRAIL_RUNS: [number, number, number, number, number][] = [
  // arena galleries — the fronts the camera looks past
  [-20, 6, 169.9, 20, 169.9],
  [-20, 6, 220.1, 20, 220.1],
  // arena low walls get a rail on one side only (asymmetry)
  [-11, 1.2, 186.3, -3, 186.3],
  [5, 1.2, 204.3, 13, 204.3],
  // canyon high ledge + spire crown
  [-5, 8, 124.3, 5, 124.3],
  [1.7, 8, 103.3, 6.3, 103.3],
  // extraction bridge — both sides, the corridor the extraction shot looks down
  [-4.1, 0, 226.5, -4.1, 251.5],
  [4.1, 0, 226.5, 4.1, 251.5],
  // R7c — B1 deck west edge: the reference's left-edge railing, on top of the
  // rail collider band (x −6.2..−5.8, y 0..1) so it collides as it looks
  [-6, 0, 13.7, -6, 20.8],
  [-6, 0, 25.2, -6, 28.8],
  [-6, 0, 35.2, -6, 36.8],
]

// ---------------------------------------------------------------------------
// R7b — WALL GREEBLE PASS + TRAVERSAL NEAR FIELD. VISUAL ONLY.
//
// Nothing below is read by `buildLevelColliders`. Every arena piece lives
// inside the 0.9 m envelope the wall already projects into the room (the
// engaged columns reach |x| 28.9 and the pilaster nosings 29.6, so a fitting
// at |x| ≥ 29.6 is behind a surface the player already cannot reach), or
// above the 1.8 m capsule. Canyon pieces stand on wall faces above 2 m, hang
// from crossings above 2.8 m, or sit OUTSIDE the B1 west rail collider over
// the void where the player cannot walk.
//
// The test the panel set is "does a 200 px square of the wall have as many
// distinct objects as the reference?" At the 11 m combat standoff that square
// is about 3.7 m on a side. A bay of the arena order carried a screen, a
// coffer and two shafts; it now also carries a vertical drop with its clamps
// and gauge, a bolted patch or two, a tray, a lamp, and in a blind bay a
// tank cluster — a different subset in every bay, on positions coprime with
// the bay rhythm.
// ---------------------------------------------------------------------------

/**
 * Vertical conduit drops on the arena walls.
 * [wall(0 west / 1 east / 2 south / 3 north), along, yTop, yBot, radius, fitting]
 * fitting: 0 plain, 1 gauge + valve wheel mid-run, 2 elbow into the wall at
 * the top, 3 both. A drop that ends above the dado cap terminates in a box.
 */
export const ARENA_WALL_DROPS: [number, number, number, number, number, number][] = [
  // west wall: the wall-run slab (x −29..−28, z 170..190) stands a metre off
  // the face, so nothing is authored behind it; the run is 190..225 + 165..170
  [0, 167.4, 8.5, 2.45, 0.075, 1],
  [0, 193.6, 8.5, 2.45, 0.075, 1],
  [0, 195.6, 8.5, 5.3, 0.055, 2],
  [0, 200.9, 8.5, 4.7, 0.09, 2],
  [0, 202.4, 6.4, 2.45, 0.055, 0],
  [0, 208.2, 8.5, 2.45, 0.055, 1],
  [0, 211.3, 6.9, 2.45, 0.075, 0],
  [0, 217.3, 8.5, 2.45, 0.09, 3],
  [0, 218.4, 8.5, 5.6, 0.055, 2],
  // east wall: its slab covers z 200..220
  [1, 166.6, 8.5, 2.45, 0.075, 0],
  [1, 171.8, 8.5, 2.45, 0.075, 1],
  [1, 174.4, 6.6, 2.45, 0.055, 0],
  [1, 181.1, 8.5, 2.45, 0.09, 3],
  [1, 183.6, 8.5, 5.6, 0.055, 2],
  [1, 191.4, 8.5, 2.45, 0.075, 1],
  [1, 194.0, 7.1, 2.45, 0.055, 0],
  [1, 196.2, 8.5, 2.45, 0.055, 2],
  [1, 221.4, 8.5, 5.1, 0.055, 2],
  // end walls: the galleries cover y < 6 for |x| < 20, so the inboard drops
  // stop above the gallery soffit and the outboard ones run to the dado
  [2, -20.6, 8.5, 2.45, 0.09, 1],
  [2, -18.1, 8.5, 6.3, 0.055, 2],
  [2, -12.9, 8.5, 6.3, 0.075, 0],
  [2, 11.0, 8.5, 6.3, 0.055, 2],
  [2, 18.4, 8.5, 2.45, 0.075, 3],
  [2, 20.7, 6.6, 2.45, 0.055, 0],
  [3, -20.3, 8.5, 2.45, 0.075, 3],
  [3, -18.2, 8.5, 6.3, 0.055, 0],
  [3, -13.9, 8.5, 6.3, 0.09, 2],
  [3, 12.7, 8.5, 6.3, 0.075, 1],
  [3, 14.8, 8.5, 6.3, 0.055, 0],
  [3, 20.2, 8.5, 2.45, 0.09, 1],
  [3, 22.1, 7.2, 2.45, 0.055, 2],
]

/** Bay cable trays: a U-channel with cables in it, on brackets, riser at one
 *  end. [wall, a0, a1, y, riserAtEnd(-1 / 0 / +1)] */
export const ARENA_WALL_TRAYS: [number, number, number, number, number][] = [
  [0, 166.0, 168.6, 3.14, 1],
  [0, 192.9, 195.9, 2.92, -1],
  [0, 207.6, 212.0, 2.92, 0],
  [0, 216.4, 219.6, 3.14, 1],
  [1, 171.0, 175.2, 3.14, -1],
  [1, 179.6, 184.6, 3.14, -1],
  [1, 190.6, 194.6, 2.92, 1],
  [2, -21.2, -17.6, 3.14, 1],
  [2, 17.6, 21.2, 2.92, -1],
  [3, -20.3, -18.3, 2.92, 0],
  [3, 19.9, 22.3, 3.14, 1],
]

/** Wall ladders from the dado cap to the corbel course, on the pier between
 *  the shafts of a coupled pair. [wall, along, y0, y1] */
export const ARENA_WALL_LADDERS: [number, number, number, number][] = [
  [0, 221.8, 2.5, 8.45],
  [1, 177.4, 2.5, 8.45],
  [2, -20.9, 2.5, 8.45],
  [3, 21.3, 2.5, 8.45],
]

/** Caged wall lamps: a small hooded box with a lit slit. [wall, along, y] */
export const ARENA_WALL_LAMPS: [number, number, number][] = [
  [0, 168.0, 3.6], [0, 191.0, 3.9], [0, 201.9, 3.3], [0, 209.9, 3.7], [0, 219.0, 3.65],
  [1, 166.0, 3.4], [1, 173.2, 3.6], [1, 180.2, 3.75], [1, 196.8, 3.8], [1, 220.6, 3.6],
  [2, -17.0, 3.5], [2, 20.0, 3.7],
  [3, -24.6, 3.4], [3, 15.4, 3.6],
]

/**
 * Low canyon crossings — the near-field layer for the traversal spine. The
 * R7 cross-conduits sit at 3.9–5.4 m and cross the top of frame; these sit at
 * 3.3–3.6 m with a junction box and a pendant hung beneath, so something
 * dark passes within 1.5–2 m of the lens every ten metres of the run.
 * [z, y, x of the hung box (0 none), lamp(0/1)]. All clear the capsule by
 * a metre or more even at the lowest hung fitting (2.85 m).
 */
export const CANYON_LOW_CROSSINGS: [number, number, number, number][] = [
  [18.6, 3.45, -2.4, 1],
  [27.2, 3.6, 1.8, 0],
  [37.4, 3.3, -0.6, 1],
  [52.8, 3.5, 3.1, 0],
  [63.1, 3.35, -2.9, 1],
  [76.6, 3.55, 0.9, 0],
  [88.4, 3.4, -3.4, 1],
  [101.9, 3.6, 2.2, 0],
  [113.2, 3.35, -1.4, 1],
  [124.7, 3.5, 2.8, 0],
]

/**
 * Service pods cantilevered off the B1 deck edge OVER THE VOID, outside the
 * west rail collider (x < −6.2): a bracketed platform carrying vertical tanks,
 * a cabinet and a hose loop. These are the left-edge machine masses of the
 * reference — unreachable, so they can be full height. [z, yaw, tanks(1–3)]
 */
export const CANYON_EDGE_PODS: [number, number, number][] = [
  [16.2, 0.18, 2],
  [27.0, -0.22, 3],
  [35.8, 0.3, 1],
]

/**
 * Wall cabinets on the canyon's west wall (x −5.9 face), hung above the
 * capsule with a conduit dropping to the deck beside them. [z, y, w, h, d]
 */
export const CANYON_WALL_CABINETS: [number, number, number, number, number][] = [
  [49.6, 2.95, 1.3, 1.6, 0.62],
  [61.2, 3.3, 0.9, 1.2, 0.5],
  [74.8, 2.85, 1.6, 1.4, 0.7],
  [93.4, 3.1, 1.1, 1.8, 0.55],
  [111.6, 2.9, 1.4, 1.3, 0.65],
  [126.9, 3.25, 1.0, 1.5, 0.5],
]

/**
 * Cable runs lying ON the arena deck — flush (35 mm), clamped every few
 * metres, from a wall-foot junction box to a hatch, a crate stack or a
 * planter. The bottom third of every combat frame is deck, and the deck's
 * only lines were the concentric gold inlay; these cross it at angles the
 * mandala does not have. [x0, z0, x1, z1] — x0/z0 is the wall end.
 */
export const ARENA_DECK_CABLES: [number, number, number, number][] = [
  [-29.5, 179.0, -12.4, 190.6],
  [29.5, 196.4, 19.6, 200.4],
  [-4.6, 224.4, -3.2, 209.0],
  [6.2, 165.6, 10.6, 173.0],
  [-29.5, 205.8, -21.6, 206.2],
  [29.5, 221.4, 22.8, 216.2],
  [-13.4, 167.2, -18.4, 174.2],
  [11.6, 224.4, 4.6, 224.2],
]

// ---------------------------------------------------------------------------
// R7c — GALLERY UNDERCROFTS, TRUNK RISERS, FASCIA DRESSING. VISUAL ONLY.
//
// Nothing below is read by `buildLevelColliders`. The combat frame the panel
// judged (08_enemies) looks south from about z 178 at the enemy standing in
// the gate: what fills the frame behind him at play height is the wall UNDER
// the south gallery (z 165, y 0–5, |x| < 20) and the gallery's own front face,
// and the R7b pass authored nothing there — the inboard drops on the end walls
// stop above the gallery soffit. These tables put the small-object layer into
// that undercroft, hang conduit from its soffit, put three-barrel trunk risers
// on the piers of every wall, and dress the gallery fronts.
//
// Clearance: the soffit is at y 5 and the capsule is 1.8 m, so every hung
// fitting stays above 4.2; wall-mounted pieces sit at d ≤ 0.46 from the face,
// inside the pilaster-nosing envelope, exactly as the R7b families do.
// ---------------------------------------------------------------------------

/**
 * Conduit runs on the end walls under the gallery soffits.
 * [side(−1 south z165 / +1 north z225), x0, x1, y, radius, dropAtEnd(0/−1/+1)]
 * Skips |x| < 5.2 — the gate opening and its portal reveals.
 */
export const ARENA_UNDERCROFT_PIPES: [number, number, number, number, number, number][] = [
  // one FAT run per half, high under the soffit; the lower band is taken by
  // the ducts and the hung cabinets below
  [-1, -18.6, -5.4, 4.5, 0.18, 1],
  [-1, 5.6, 18.9, 4.5, 0.16, -1],
  [1, -19.1, -6.4, 4.5, 0.17, 1],
  [1, 6.6, 19.0, 4.5, 0.18, -1],
]

/**
 * Rectangular ductwork under the gallery soffits — the one kind of service
 * run that still reads at the 25–35 m the combat camera actually sees these
 * walls from. [side, x0, x1, y(axis), w(depth off the wall), h, dropAt]: at
 * the `dropAt` end the duct turns down to a plenum sitting on the dado cap.
 * Body 3.64–4.26, plenum 2.3–2.95: nothing below the 1.8 m capsule.
 */
export const ARENA_UNDERCROFT_DUCTS: [number, number, number, number, number, number, number][] = [
  [-1, -19.2, -6.2, 3.95, 0.82, 0.62, 1],
  [-1, 5.8, 17.4, 3.95, 0.7, 0.54, 1],
  // dropAt 0: the bay at either end is full, so it ends in a wall box instead
  [1, -18.4, -7.0, 3.95, 0.76, 0.58, 0],
  [1, 6.4, 19.0, 3.95, 0.86, 0.64, -1],
]

/**
 * Machine cabinets hung on the end walls under the galleries, below the duct
 * line: 2.1–3.55 m, so a player walking the undercroft passes beneath them.
 * [side, x, w, depth]
 */
export const ARENA_UNDERCROFT_CABINETS: [number, number, number, number][] = [
  [-1, -11.6, 1.8, 0.9], [-1, 5.9, 1.6, 0.95], [-1, 12.2, 1.8, 0.8],
  [1, -12.0, 2.0, 0.9], [1, -6.4, 1.4, 0.85], [1, 7.2, 1.0, 0.9], [1, 13.8, 1.6, 0.95],
]

/**
 * Wall cabinets on the arena's long walls and the end walls outside the
 * galleries, hung above the capsule (2.1–3.7 m) between the R7b fittings.
 * [wall, along, w, h, depth]
 */
export const ARENA_WALL_CABINETS: [number, number, number, number, number, number][] = [
  // [wall, along, w, h, depth, yBase] — yBase 3.35 where a cable tray holds the
  // 2.9–3.2 m band; every one is in a bay, clear of the shafts and the drops
  [0, 210.7, 1.0, 1.4, 0.5, 3.35],
  [1, 195.4, 1.1, 1.6, 0.5, 2.1], [1, 182.4, 1.2, 1.4, 0.55, 3.35], [1, 175.0, 0.9, 1.4, 0.5, 3.35],
  [2, -26.4, 1.4, 1.6, 0.55, 2.1], [2, 26.2, 1.3, 1.5, 0.5, 2.1],
  [3, -27.0, 1.4, 1.5, 0.55, 2.1], [3, 27.2, 1.4, 1.7, 0.5, 2.1],
]

/**
 * Big bolted plates — 2–3 m sheets over the wall field (and over a screen
 * where one is there), the flat dark rectangles that break a 30 m tile read
 * the way the reference's riveted panels do. [wall, along, y, w, h]. All in
 * bays, never on a pier, so no engaged shaft is hidden behind one.
 */
export const ARENA_BIG_PLATES: [number, number, number, number, number][] = [
  [0, 210.0, 6.4, 2.6, 1.5], [0, 194.5, 6.6, 1.9, 1.3],
  [1, 180.6, 6.2, 1.8, 1.4], [1, 220.6, 6.4, 1.4, 1.3],
  [2, -19.6, 7.2, 2.6, 1.1], [2, 19.2, 6.9, 2.8, 1.3],
  [3, -19.3, 6.6, 2.4, 1.2], [3, 20.4, 7.4, 0.9, 1.0],
]

/**
 * Conduits hung UNDER the gallery soffit, running across it from the back
 * wall to a junction box at the fascia. [side, x, y]. The soffit is at 5.0;
 * y is the pipe axis, and the lowest hung box bottoms out above 4.25.
 */
export const ARENA_SOFFIT_CONDUITS: [number, number, number][] = [
  // x positions are all in BAYS: the engaged shafts stand at pair ± 1.15 with
  // a 0.45 m radius, and a conduit entering a column is a tell of its own
  [-1, -17.3, 4.62], [-1, -11.1, 4.7], [-1, -6.4, 4.56],
  [-1, 9.2, 4.66], [-1, 15.2, 4.58], [-1, 18.1, 4.72],
  [1, -18.4, 4.6], [1, -12.7, 4.68], [1, -6.3, 4.55],
  [1, 7.4, 4.62], [1, 12.9, 4.7], [1, 15.9, 4.58],
]

/**
 * Three-barrel trunk risers — the fat pipe clusters of the reference frame,
 * rising from a manifold on the dado cap and elbowing into the wall at the
 * top. One per chosen pier, between the shafts of a coupled pair, so the
 * three barrels fit the 1.1 m the shafts leave. [wall, along, yTop, radius].
 * Under a gallery the top is the soffit, so the riser is short and the elbows
 * turn into the wall just below it.
 */
export const ARENA_TRUNK_RISERS: [number, number, number, number][] = [
  [0, 205.0, 8.4, 0.2],
  [0, 214.4, 8.4, 0.17],
  [1, 168.8, 8.4, 0.2],
  [1, 198.2, 8.4, 0.17],
  [2, 23.6, 8.4, 0.2],
  [2, -8.8, 4.55, 0.17],
  [2, 15.0, 4.55, 0.15],
  [3, -22.2, 8.4, 0.2],
  [3, 9.4, 4.55, 0.17],
  [3, -16.4, 4.55, 0.15],
]

/**
 * Bolted plates and caged lamps on the gallery FRONTS (the face at z 170.2
 * south / 219.8 north, y 4.6–6.1) — the surface nearest the camera in every
 * combat frame that has a gallery in it. [side, x, kind(0 patch / 1 lamp)]
 */
export const ARENA_FASCIA_FITTINGS: [number, number, number][] = [
  [-1, -17.6, 0], [-1, -13.2, 1], [-1, -9.1, 0], [-1, -6.4, 0],
  [-1, 5.9, 0], [-1, 8.7, 1], [-1, 12.4, 0], [-1, 16.8, 0], [-1, 18.9, 1],
  [1, -18.7, 1], [1, -14.1, 0], [1, -10.6, 0], [1, -7.2, 1],
  [1, 6.1, 0], [1, 9.8, 0], [1, 13.5, 1], [1, 17.7, 0],
]

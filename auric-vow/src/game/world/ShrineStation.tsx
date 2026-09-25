/**
 * AURIC VOW — world/ShrineStation.tsx
 * The "Anvil of Silence" orbital shrine-station, ~260 m along +Z
 * (environment.md §2): spawn dais → traversal canyon → objective chamber →
 * combat arena → extraction bridge/pad. All geometry is primitives + heavy
 * instancing; materials per design.md §2.4. Registers all static colliders
 * on mount (see layout.ts / Colliders.ts).
 */
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three-stdlib'
import { useFrame } from '@react-three/fiber'
import { useGameStore } from '../store'
import { COLORS } from '../config'
import {
  buildLevelColliders,
  boxCenter,
  boxSize,
  B1_DECKS,
  WALLRUN_SLABS,
  SPIRE,
  HIGH_LEDGE,
  B4_STEPS,
  PETAL_GATE,
  RELIQUARY_POSITION,
  EXTRACTION_PAD_POSITION,
  CHAMBER_PLANTERS,
  ARENA_PLANTERS,
  ARENA_PYLONS,
  ARENA_LOW_WALLS,
  ARENA_WALLRUN_SLABS,
  ARENA_GALLERIES,
  ARENA_MEGALITHS,
  SPAWN_GATES,
  MONOLITHS,
  ARENA_VAULT_BAYS,
  ARENA_VAULT_OCULUS_BAYS,
  BRIDGE_VAULT_BAYS,
  CANYON_GANTRIES,
  CANYON_GANTRY_SPAN,
  CANYON_GANTRY_Y,
  CANYON_PENDANT_X,
  PORTALS,
  ARENA_BAY_PAIRS,
  ARENA_PAIR_GAP,
  ARENA_WALL_RECESS,
  ARENA_BUTTRESS,
  ARENA_AEDICULE_Z,
  ARENA_DECK_GRATES,
  ARENA_DECK_HATCHES,
  ARENA_DADO_TOP,
  ARENA_PIPE_LONG,
  ARENA_PIPE_END,
  ARENA_VENTS,
  CABLE_SPANS,
  GROWTH_CLUMPS,
  CRATE_CLUSTERS,
  HANDRAIL_RUNS,
  ARENA_WALL_DROPS,
  ARENA_WALL_TRAYS,
  ARENA_WALL_LADDERS,
  ARENA_WALL_LAMPS,
  CANYON_LOW_CROSSINGS,
  CANYON_EDGE_PODS,
  CANYON_WALL_CABINETS,
  ARENA_DECK_CABLES,
  ARENA_UNDERCROFT_PIPES,
  ARENA_SOFFIT_CONDUITS,
  ARENA_TRUNK_RISERS,
  ARENA_FASCIA_FITTINGS,
  ARENA_UNDERCROFT_DUCTS,
  ARENA_UNDERCROFT_CABINETS,
  ARENA_WALL_CABINETS,
  ARENA_BIG_PLATES,
  type BoxSpec,
} from './layout'
import { clearColliders, registerCollider, unregisterCollider } from './Colliders'
import {
  ivoryMaterial,
  ivoryContactMaterial,
  goldMaterial,
  goldPolishedMaterial,
  goldEdgeMaterial,
  goldCastMaterial,
  recessMaterial,
  umberMaterial,
  fretTrimMaterial,
  screenMaterial,
  cofferMaterial,
  obsidianMaterial,
  floorMaterial,
  arenaGrooveMaterial,
  rockMaterial,
  glassMaterial,
  veinTealMaterial,
  veinGoldMaterial,
  purifyVeinMaterial,
  medallionMaterial,
  doorGlowMaterial,
  sealMaterial,
  glyphDecalMaterial,
  bannerMaterial,
  growthMaterial,
  cableMaterial,
  clothMaterial,
} from './materials'

// ---------------------------------------------------------------------------
// Shared geometries (unit primitives get per-instance scale)
// ---------------------------------------------------------------------------
const BOX = new THREE.BoxGeometry(1, 1, 1)
/** beveled unit box for major masses (colliders stay on the sharp AABBs) */
const RBOX = new RoundedBoxGeometry(1, 1, 1, 2, 0.05)
const PLANE = new THREE.PlaneGeometry(1, 1)
const CYL = new THREE.CylinderGeometry(1, 1, 1, 20)
const PETAL = new THREE.BoxGeometry(1, 0.12, 2.2)
const OCTA = new THREE.OctahedronGeometry(1, 0)
// (rib geometry is built further down from the keyed RIB_SECTION profile —
//  the plain tori these replaced could not self-shadow)
const WALL_ARCH = new THREE.TorusGeometry(2.2, 0.3, 8, 20, Math.PI)
// arch-bay variants (fix2): B = narrow + heavy, C = wide + slender
const WALL_ARCH_B = new THREE.TorusGeometry(1.55, 0.36, 8, 18, Math.PI)
const WALL_ARCH_C = new THREE.TorusGeometry(2.9, 0.24, 8, 24, Math.PI)
const RING_GEO = new THREE.TorusGeometry(1, 0.012, 6, 72)
const DOME_GEO = new THREE.SphereGeometry(18, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2)
const ICOSA = new THREE.IcosahedronGeometry(1.5, 0)
const ICOSA_INNER = new THREE.IcosahedronGeometry(0.95, 0)
const CIRCLE = new THREE.CircleGeometry(1, 32)

/**
 * Rocky asteroid: icosahedron detail 1 with deterministic vertex jitter.
 * Jitter is hashed from the vertex position so duplicated corners (the
 * geometry is non-indexed) get identical offsets — no cracks.
 */
const ROCK = (() => {
  const g = new THREE.IcosahedronGeometry(1, 1)
  const pos = g.attributes.position as THREE.BufferAttribute
  const v = new THREE.Vector3()
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i)
    const h1 = Math.sin(v.x * 12.9898 + v.y * 78.233 + v.z * 37.719) * 43758.5453
    const h2 = Math.sin(v.x * 39.3468 + v.y * 11.135 + v.z * 83.155) * 24634.6345
    const r1 = h1 - Math.floor(h1)
    const r2 = h2 - Math.floor(h2)
    const radial = 1 + (r1 - 0.5) * 0.55
    v.multiplyScalar(radial)
    v.x += (r2 - 0.5) * 0.18
    v.y += (r1 - 0.5) * 0.16
    v.z += (r2 - r1) * 0.15
    pos.setXYZ(i, v.x, v.y, v.z)
  }
  g.computeVertexNormals()
  return g
})()

// ---------------------------------------------------------------------------
// R1 — Orokin ornament toolkit
//
// Everything here is generated ONCE at module scope and shared by InstancedMesh
// draws, so ornament density costs geometry memory, not draw calls or frame
// time. Three generators:
//   sweepArc / sweepLine — a stepped moulding profile swept along an arch or a
//     straight run (the <OrokinTrim> the review asked for, as geometry rather
//     than a component so it can be instanced)
//   flutedColumn — LatheGeometry-style profile with entasis plus real angular
//     fluting, replacing the plain tapered cylinders
//   bakeContactAO — vertex-colour contact darkening at the foot of a mesh, so
//     grounding survives with the SSAO pass off
// ---------------------------------------------------------------------------

/** Stepped Orokin fascia, [radialOffset, depth] pairs, closed loop. */
const TRIM_PROFILE: [number, number][] = [
  [0.0, -0.085],
  [0.1, -0.085],
  [0.115, -0.055],
  [0.075, -0.03],
  [0.075, 0.03],
  [0.115, 0.055],
  [0.1, 0.085],
  [0.0, 0.085],
]

/** Slimmer inner rail used for the second, tighter trim run on big arches. */
const TRIM_PROFILE_FINE: [number, number][] = [
  [0.0, -0.045],
  [0.055, -0.045],
  [0.062, -0.022],
  [0.03, -0.01],
  [0.03, 0.01],
  [0.062, 0.022],
  [0.055, 0.045],
  [0.0, 0.045],
]

/**
 * R2 — keyed structural rib section (map E14 / work order #5).
 *
 * Every arch rib in the level was a `TorusGeometry`: a circular tube, which is
 * the one section that CANNOT self-shadow, because its surface normal turns
 * smoothly through 360° and produces a single soft gradient from any light
 * direction. That is most of why the architecture read as untextured
 * primitives — ribs are the largest ornament in frame and they had no edges.
 *
 * This is the profile a cast Orokin rib actually has, swept with the same
 * `sweepArc` the gold trim runs use: a flat back against the vault, a chamfer
 * onto the soffit, a pair of quirked grooves, and a bead on the crown. The
 * grooves are 6–8 cm deep at canyon scale, so the key light puts a hard dark
 * line down the whole length of every rib and the ribs finally read as carved.
 *
 * `r` is radial offset from the arc radius (negative = toward the room),
 * `d` is out-of-plane depth.
 *
 * ORDER MATTERS: `sweepArc` emits a fixed index winding, so the section has to
 * be listed with the same handedness as TRIM_PROFILE or every rib renders
 * inside-out (back faces culled, hollow silhouette). TRIM_PROFILE has its flat
 * back at MINIMUM r and runs in increasing `d`; this section's flat back is at
 * MAXIMUM r — it faces the vault, not the room — so it runs in DECREASING `d`
 * to keep the same signed area.
 */
const RIB_SECTION: [number, number][] = [
  [0.55, 0.5],
  [0.18, 0.5],
  [0.1, 0.38],
  [0.2, 0.3],
  [0.2, 0.18],
  [0.02, 0.12],
  [-0.16, 0.06],
  [-0.16, -0.06],
  [0.02, -0.12],
  [0.2, -0.18],
  [0.2, -0.3],
  [0.1, -0.38],
  [0.18, -0.5],
  [0.55, -0.5],
]

function ribSection(scale: number): [number, number][] {
  return RIB_SECTION.map(([r, d]) => [r * scale, d * scale] as [number, number])
}

/**
 * L-profile gold trim run — the machined angle that covers every floor-to-wall
 * and wall-to-ceiling joint. Real buildings have one; the R1 level met floors
 * and walls on a bare 90° corner, which is the junction a blockout has.
 * Unit length along Z (scale Z to the run), sitting in the corner at the
 * origin with the two flanges running +X (floor) and +Y (wall).
 */
const L_TRIM_PROFILE: [number, number][] = [
  [0.0, 0.0],
  [0.26, 0.0],
  [0.26, 0.035],
  [0.09, 0.06],
  [0.06, 0.09],
  [0.035, 0.26],
  [0.0, 0.26],
]

/**
 * Sweep a closed profile around an arc of `radius` spanning `arc` radians in
 * the XY plane (matching TorusGeometry's orientation), profile X = radial
 * offset, profile Y = out-of-plane depth.
 */
function sweepArc(
  profile: [number, number][],
  radius: number,
  arc: number,
  steps: number,
): THREE.BufferGeometry {
  const pn = profile.length
  const pos: number[] = []
  const uv: number[] = []
  const idx: number[] = []
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const a = t * arc
    const ca = Math.cos(a)
    const sa = Math.sin(a)
    for (let j = 0; j < pn; j++) {
      const [pr, pd] = profile[j]
      const r = radius + pr
      pos.push(r * ca, r * sa, pd)
      uv.push(t * radius * 0.5, j / (pn - 1))
    }
  }
  for (let i = 0; i < steps; i++) {
    for (let j = 0; j < pn; j++) {
      const a0 = i * pn + j
      const b0 = i * pn + ((j + 1) % pn)
      const a1 = (i + 1) * pn + j
      const b1 = (i + 1) * pn + ((j + 1) % pn)
      idx.push(a0, a1, b1, a0, b1, b0)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

/** Same profile swept along a unit straight run down +Z (scale Z to length). */
function sweepLine(profile: [number, number][]): THREE.BufferGeometry {
  const pn = profile.length
  const pos: number[] = []
  const uv: number[] = []
  const idx: number[] = []
  for (let i = 0; i <= 1; i++) {
    for (let j = 0; j < pn; j++) {
      const [px, py] = profile[j]
      pos.push(px, py, i - 0.5)
      uv.push(i, j / (pn - 1))
    }
  }
  for (let j = 0; j < pn; j++) {
    const a0 = j
    const b0 = (j + 1) % pn
    const a1 = pn + j
    const b1 = pn + ((j + 1) % pn)
    idx.push(a0, a1, b1, a0, b1, b0)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

/**
 * Fluted Orokin column. `profile` is a list of [y, radius] rows (bottom→top);
 * the shaft band gets `flutes` angular grooves with a soft cosine section that
 * fades out into the base and capital.
 */
function flutedColumn(
  profile: [number, number][],
  flutes: number,
  depth: number,
  shaft: [number, number],
  radial = 48,
): THREE.BufferGeometry {
  const rows = profile.length
  const pos: number[] = []
  const uv: number[] = []
  const idx: number[] = []
  for (let r = 0; r < rows; r++) {
    const [y, rad] = profile[r]
    // flute amplitude fades in/out across the shaft band
    const fadeLo = THREE.MathUtils.smoothstep(y, shaft[0], shaft[0] + 0.45)
    const fadeHi = 1 - THREE.MathUtils.smoothstep(y, shaft[1] - 0.45, shaft[1])
    const amp = depth * fadeLo * fadeHi
    for (let c = 0; c <= radial; c++) {
      const a = (c / radial) * Math.PI * 2
      // rounded grooves: cos^2 lobes between sharp arrises
      const groove = Math.pow(Math.max(0, Math.cos(a * flutes)), 0.6)
      const rr = rad * (1 - amp * groove)
      pos.push(Math.cos(a) * rr, y, Math.sin(a) * rr)
      uv.push(c / radial, y)
    }
  }
  const stride = radial + 1
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < radial; c++) {
      const a0 = r * stride + c
      const b0 = a0 + 1
      const a1 = (r + 1) * stride + c
      const b1 = a1 + 1
      idx.push(a0, a1, b1, a0, b1, b0)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

/**
 * Clone a geometry and bake a vertex-colour contact gradient: vertices at
 * local y ≤ `from` are multiplied by `min`, ramping to white at `to`.
 * Instanced ribs and wall panels use this through ivoryContactMaterial() so a
 * grounded dark band survives even when screen-space AO is off.
 */
function bakeContactAO(
  src: THREE.BufferGeometry,
  from: number,
  to: number,
  min: number,
): THREE.BufferGeometry {
  const g = src.clone()
  const pos = g.attributes.position as THREE.BufferAttribute
  const col = new Float32Array(pos.count * 3)
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i)
    const t = THREE.MathUtils.smoothstep(y, from, to)
    const v = min + (1 - min) * t
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = v
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3))
  return g
}

/**
 * R5 — piecewise vertical shading baked into vertex colour.
 *
 * `bakeContactAO` darkens a contact line. This bakes a whole VERTICAL CURVE
 * into a surface, which is a different job: the panel's standing complaint
 * about the arena is that its 60 m walls are "one flat value from plinth to
 * cornice", i.e. there is no lit falloff. A room lit from its ridge slots and
 * from pools on its own floor does not have a flat wall — it has a dark base
 * where nothing reaches, a lit middle where the floor bounce lands, and a
 * cove shadow under the projecting cornice. The interesting part is that that
 * ramp is a property of the ROOM, not of the light: it is the same every frame
 * because nothing in the arena moves, so it belongs in the mesh rather than in
 * a light that has to be evaluated per fragment on a browser budget.
 *
 * `stops` is a list of [localY, multiplier] rows, bottom to top; values between
 * rows are smoothstepped. Multiplied INTO any existing colour attribute, so it
 * composes with `bakeContactAO` rather than overwriting it.
 */
function bakeGradient(src: THREE.BufferGeometry, stops: [number, number][]): THREE.BufferGeometry {
  const g = src.clone()
  const pos = g.attributes.position as THREE.BufferAttribute
  const prev = g.attributes.color as THREE.BufferAttribute | undefined
  const col = new Float32Array(pos.count * 3)
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i)
    let v = stops[0][1]
    if (y >= stops[stops.length - 1][0]) v = stops[stops.length - 1][1]
    else {
      for (let k = 0; k + 1 < stops.length; k++) {
        if (y >= stops[k][0] && y < stops[k + 1][0]) {
          const t = THREE.MathUtils.smoothstep(y, stops[k][0], stops[k + 1][0])
          v = stops[k][1] + (stops[k + 1][1] - stops[k][1]) * t
          break
        }
      }
    }
    const base = prev ? prev.getX(i) : 1
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = base * v
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3))
  return g
}

/**
 * R5 — plain surface of revolution from a [y, radius] section.
 *
 * `flutedColumn` already lathes a profile; passing it zero flute depth gives a
 * clean lathe, so the two share one tessellator and one seam convention rather
 * than adding a second code path. Rows must be monotonically increasing in y
 * (a row that steps back down flips the winding and the band disappears under
 * front-side culling), so every profile below is written bottom to top.
 */
function latheProfile(profile: [number, number][], radial = 28): THREE.BufferGeometry {
  return flutedColumn(profile, 1, 0, [0, 0], radial)
}

/** Bake a UV repeat into a geometry so one shared trim material can serve
 *  runs of different lengths without cloning the texture. */
function repeatUv(g: THREE.BufferGeometry, ru: number, rv = 1): THREE.BufferGeometry {
  const uv = g.attributes.uv as THREE.BufferAttribute
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * ru, uv.getY(i) * rv)
  uv.needsUpdate = true
  return g
}

/**
 * R3 — ENCLOSURE. The single largest remaining blockout tell in this level is
 * that it has no ceiling: the canyon, the arena and the bridge are walled pits
 * open to the skybox, so the top third of every wide frame is flat purple sky
 * with a few smooth tubes crossing it. No shipped interior looks like that.
 *
 * `vaultShell` builds an inward-facing COFFERED barrel vault as real geometry:
 * a grid of sunken coffer wells, each with a recessed pan, four side reveals
 * and a picture-frame band of soffit left between them. Every well is a cavity
 * the key light cannot reach, so the ceiling carries its own value structure
 * (frame band bright, reveal mid, pan dark) before a single shadow is cast —
 * and the vertex-colour AO is baked in per face, so it survives with SSAO off.
 *
 * Faces are NOT welded: each quad carries its own four vertices, which is what
 * gives a machined coffer its hard arris instead of a smeared gradient.
 *
 * Cost: one geometry, instanced across every bay of a room. An arena bay is
 * ~1.9k triangles and the whole 60 m vault is six instances of it.
 */
interface VaultOpts {
  /** vault radius about the +Z axis (matches the sweepArc ribs' XY plane) */
  radius: number
  /** springing angle and crown-side limit, radians from +X */
  a0: number
  a1: number
  /** bay length along Z (geometry is centred on z = 0) */
  len: number
  /** coffer cells around / along */
  nU: number
  nV: number
  /** how far each coffer pan is sunk away from the room */
  depth: number
  /** soffit band left between adjacent coffers, in metres at the surface */
  frame: number
  /** vertex-colour multiplier at the sunken pan (1 = no darkening) */
  panShade?: number
  /** vertex-colour multiplier on the coffer reveals */
  revealShade?: number
  /** omit cells whose centre lies within this many radians of the crown */
  openCrown?: number
}

function vaultShell(o: VaultOpts): THREE.BufferGeometry {
  const { radius: R, a0, a1, len, nU, nV, depth, frame } = o
  const panShade = o.panShade ?? 0.34
  const revealShade = o.revealShade ?? 0.66
  const pos: number[] = []
  const uvs: number[] = []
  const cols: number[] = []
  const idx: number[] = []
  const A = new THREE.Vector3()
  const B = new THREE.Vector3()
  const C = new THREE.Vector3()
  const D = new THREE.Vector3()
  const e1 = new THREE.Vector3()
  const e2 = new THREE.Vector3()
  const nrm = new THREE.Vector3()
  const want = new THREE.Vector3()

  const at = (a: number, r: number, z: number, out: THREE.Vector3) =>
    out.set(Math.cos(a) * r, Math.sin(a) * r, z)

  /** emit one quad with the winding that makes its normal face `want` */
  function quad(shade: number) {
    e1.subVectors(B, A)
    e2.subVectors(C, A)
    nrm.crossVectors(e1, e2)
    const flip = nrm.dot(want) < 0
    const order = flip ? [A, D, C, B] : [A, B, C, D]
    const base = pos.length / 3
    for (const p of order) {
      pos.push(p.x, p.y, p.z)
      // arc-length / axial UVs so a trim sheet keeps its texel density
      uvs.push(Math.atan2(p.y, p.x) * R * 0.5, p.z * 0.5)
      cols.push(shade, shade, shade)
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }

  const du = (a1 - a0) / nU
  const dz = len / nV
  // convert the metric frame width into angular / axial half-insets
  const fa = Math.min(frame / R, du * 0.45)
  const fz = Math.min(frame, dz * 0.9)
  const z0 = -len / 2

  for (let i = 0; i < nU; i++) {
    const au0 = a0 + i * du
    const au1 = au0 + du
    const ac = (au0 + au1) / 2
    const skip = o.openCrown !== undefined && Math.abs(ac - Math.PI / 2) < o.openCrown
    const ai0 = au0 + fa / 2
    const ai1 = au1 - fa / 2
    for (let j = 0; j < nV; j++) {
      const zu0 = z0 + j * dz
      const zu1 = zu0 + dz
      const zi0 = zu0 + fz / 2
      const zi1 = zu1 - fz / 2

      if (skip) continue

      // --- soffit picture frame at radius R (four strips around the well)
      want.set(-Math.cos(ac), -Math.sin(ac), 0)
      at(au0, R, zu0, A); at(au1, R, zu0, B); at(au1, R, zi0, C); at(au0, R, zi0, D)
      quad(1)
      at(au0, R, zi1, A); at(au1, R, zi1, B); at(au1, R, zu1, C); at(au0, R, zu1, D)
      quad(1)
      at(au0, R, zi0, A); at(ai0, R, zi0, B); at(ai0, R, zi1, C); at(au0, R, zi1, D)
      quad(1)
      at(ai1, R, zi0, A); at(au1, R, zi0, B); at(au1, R, zi1, C); at(ai1, R, zi1, D)
      quad(1)

      // --- sunken pan
      at(ai0, R + depth, zi0, A); at(ai1, R + depth, zi0, B)
      at(ai1, R + depth, zi1, C); at(ai0, R + depth, zi1, D)
      quad(panShade)

      // --- four reveals, each facing into the well
      want.set(-Math.sin(ai0), Math.cos(ai0), 0)
      at(ai0, R, zi0, A); at(ai0, R + depth, zi0, B)
      at(ai0, R + depth, zi1, C); at(ai0, R, zi1, D)
      quad(revealShade)
      want.set(Math.sin(ai1), -Math.cos(ai1), 0)
      at(ai1, R, zi0, A); at(ai1, R + depth, zi0, B)
      at(ai1, R + depth, zi1, C); at(ai1, R, zi1, D)
      quad(revealShade)
      want.set(0, 0, 1)
      at(ai0, R, zi0, A); at(ai1, R, zi0, B)
      at(ai1, R + depth, zi0, C); at(ai0, R + depth, zi0, D)
      quad(revealShade * 0.92)
      want.set(0, 0, -1)
      at(ai0, R, zi1, A); at(ai1, R, zi1, B)
      at(ai1, R + depth, zi1, C); at(ai0, R + depth, zi1, D)
      quad(revealShade * 0.92)
    }
  }

  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  const uvAttr = new THREE.Float32BufferAttribute(uvs, 2)
  g.setAttribute('uv', uvAttr)
  g.setAttribute('uv1', uvAttr)
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

/**
 * The gold boss / rosette positions where a vault's soffit bands cross. Real
 * vaults put a cast boss on every intersection; that is the ornament that
 * tells you a ceiling is built rather than extruded.
 */
function vaultBosses(o: VaultOpts, everyU: number, everyV: number, r: number): InstItem[] {
  const out: InstItem[] = []
  const du = (o.a1 - o.a0) / o.nU
  const dz = o.len / o.nV
  for (let i = 0; i <= o.nU; i += everyU) {
    const a = o.a0 + i * du
    if (o.openCrown !== undefined && Math.abs(a - Math.PI / 2) < o.openCrown) continue
    for (let j = 0; j <= o.nV; j += everyV) {
      const z = -o.len / 2 + j * dz
      out.push({
        p: [Math.cos(a) * (o.radius - 0.02), Math.sin(a) * (o.radius - 0.02), z],
        r: [0, 0, a],
        s: [r * 0.5, r, r],
      })
    }
  }
  return out
}

/**
 * Coffered soffit for a FLAT overhead span (the canyon gantries, the portal
 * reveals): the same sunken-well construction as the vault, in the XZ plane,
 * facing down. Unit square in X/Z so a single geometry serves every span.
 */
function cofferSoffit(nx: number, nz: number, depth: number, frameFrac: number, panShade = 0.32): THREE.BufferGeometry {
  const pos: number[] = []
  const uvs: number[] = []
  const cols: number[] = []
  const idx: number[] = []
  const P = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)
  const push = (q: THREE.Vector3[], shade: number, flipped: boolean) => {
    const base = pos.length / 3
    const order = flipped ? [q[0], q[3], q[2], q[1]] : q
    for (const p of order) {
      pos.push(p.x, p.y, p.z)
      uvs.push(p.x + 0.5, p.z + 0.5)
      cols.push(shade, shade, shade)
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }
  const dx = 1 / nx
  const dz = 1 / nz
  // the tile is instanced onto spans of very different sizes, so the soffit
  // band has to be a fraction of the CELL, not an absolute figure — an
  // absolute one inverts the coffer the moment a span is scaled up.
  const fx = dx * Math.min(0.48, frameFrac)
  const fz = dz * Math.min(0.48, frameFrac)
  for (let i = 0; i < nx; i++) {
    const x0 = -0.5 + i * dx
    const x1 = x0 + dx
    const xi0 = x0 + fx / 2
    const xi1 = x1 - fx / 2
    for (let j = 0; j < nz; j++) {
      const z0 = -0.5 + j * dz
      const z1 = z0 + dz
      const zi0 = z0 + fz / 2
      const zi1 = z1 - fz / 2
      // soffit frame at y = 0, facing down (-Y)
      push([P(x0, 0, z0), P(x1, 0, z0), P(x1, 0, zi0), P(x0, 0, zi0)], 1, true)
      push([P(x0, 0, zi1), P(x1, 0, zi1), P(x1, 0, z1), P(x0, 0, z1)], 1, true)
      push([P(x0, 0, zi0), P(xi0, 0, zi0), P(xi0, 0, zi1), P(x0, 0, zi1)], 1, true)
      push([P(xi1, 0, zi0), P(x1, 0, zi0), P(x1, 0, zi1), P(xi1, 0, zi1)], 1, true)
      // sunken pan
      push([P(xi0, depth, zi0), P(xi1, depth, zi0), P(xi1, depth, zi1), P(xi0, depth, zi1)], panShade, true)
      // reveals
      push([P(xi0, 0, zi0), P(xi0, depth, zi0), P(xi0, depth, zi1), P(xi0, 0, zi1)], 0.62, false)
      push([P(xi1, 0, zi0), P(xi1, depth, zi0), P(xi1, depth, zi1), P(xi1, 0, zi1)], 0.62, true)
      push([P(xi0, 0, zi0), P(xi1, 0, zi0), P(xi1, depth, zi0), P(xi0, depth, zi0)], 0.58, false)
      push([P(xi0, 0, zi1), P(xi1, 0, zi1), P(xi1, depth, zi1), P(xi0, depth, zi1)], 0.58, true)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  const uvAttr = new THREE.Float32BufferAttribute(uvs, 2)
  g.setAttribute('uv', uvAttr)
  g.setAttribute('uv1', uvAttr)
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

// --- shared ornament geometries -------------------------------------------
/** stepped trim run, unit length along Z (scale Z) */
const TRIM_RUN = sweepLine(TRIM_PROFILE)
const TRIM_RUN_FINE = sweepLine(TRIM_PROFILE_FINE)
/** gold L-angle for floor/wall and wall/ceiling joints, unit length along Z */
const L_TRIM_RUN = sweepLine(L_TRIM_PROFILE)

/** keyed structural ribs (chamfer + quirked grooves + crown bead) */
const RIB_CANYON = sweepArc(ribSection(1.0), 7, Math.PI, 30)
const RIB_ARENA = sweepArc(ribSection(1.8), 30, Math.PI, 56)
const RIB_CHAMBER = sweepArc(ribSection(0.9), 14, Math.PI, 34)
const RIB_BRIDGE = sweepArc(ribSection(0.7), 5.5, Math.PI, 24)
/** arch trims matching the three canyon bay variants + chamber/arena/bridge */
const ARCH_TRIM_A = sweepArc(TRIM_PROFILE, 2.05, Math.PI, 22)
const ARCH_TRIM_B = sweepArc(TRIM_PROFILE, 1.42, Math.PI, 20)
const ARCH_TRIM_C = sweepArc(TRIM_PROFILE, 2.72, Math.PI, 26)
const ARCH_TRIM_CANYON = sweepArc(TRIM_PROFILE, 6.4, Math.PI, 40)
const ARCH_TRIM_CANYON_IN = sweepArc(TRIM_PROFILE_FINE, 6.05, Math.PI, 40)
const ARCH_TRIM_CHAMBER = sweepArc(TRIM_PROFILE, 13.4, Math.PI, 52)
const ARCH_TRIM_ARENA = sweepArc(TRIM_PROFILE, 28.9, Math.PI, 72)
const ARCH_TRIM_ARENA_IN = sweepArc(TRIM_PROFILE_FINE, 28.2, Math.PI, 72)
const ARCH_TRIM_BRIDGE = sweepArc(TRIM_PROFILE, 5.05, Math.PI, 26)

/** 9 m fluted column with entasis, base torus and flared capital */
const COLUMN_PROFILE: [number, number][] = (() => {
  const rows: [number, number][] = []
  rows.push([-4.5, 0.9], [-4.34, 0.88], [-4.3, 0.8], [-4.16, 0.78], [-4.1, 0.745])
  for (let i = 0; i <= 16; i++) {
    const t = i / 16
    const y = -4.1 + t * 7.5
    // entasis: slight convex swell, narrowing toward the neck
    const base = 0.735 - t * 0.135
    rows.push([y, base * (1 + 0.035 * Math.sin(Math.PI * t))])
  }
  rows.push([3.46, 0.585], [3.56, 0.56], [3.7, 0.575], [3.86, 0.64], [4.0, 0.78], [4.1, 0.82], [4.34, 0.8], [4.4, 0.86], [4.5, 0.86])
  return rows
})()
const COLUMN_GEO = flutedColumn(COLUMN_PROFILE, 18, 0.07, [-3.9, 3.3], 54)
/**
 * R3 — engaged (three-quarter) column for wall bays. Same lathed profile as
 * the free-standing order — base torus, entasis on the shaft, flared capital,
 * real angular fluting — at half the radial tessellation, because two thirds
 * of it is buried in the wall. The arena and the chamber had NO columns at
 * all: every vertical on a 60 m wall was a flat gold stripe applied to a flat
 * plane, which is the definition of ornament that is painted on rather than
 * bought with geometry.
 */
const COLUMN_ENGAGED = flutedColumn(COLUMN_PROFILE, 16, 0.08, [-3.9, 3.3], 30)
/** flat fret course for wall panels (unit square, scaled per run) */
const FRET_PANEL = repeatUv(new THREE.PlaneGeometry(1, 1), 6)

// --- R2 ornament: pierced screens, coffers, inlay annuli --------------------
/**
 * Pierced screen panels, hung ~7 cm in front of a flat wall span with a
 * recess-black box behind them. A flat span is the tell the critics named
 * ("untextured primitive architecture"); a screen turns it into a silhouette
 * with real depth, and because the material is alpha-TESTED (not blended) it
 * writes depth and therefore casts a pierced shadow of its own.
 * Two aspect variants so the motif stays square on both wide and tall spans.
 */
const SCREEN_WIDE = repeatUv(new THREE.PlaneGeometry(1, 1), 2, 2)
/**
 * R7c — the pierced motif at THREE MORE SCALES. The screen tile carries its own
 * fret border, so an integer repeat always frames cleanly; what it cannot do
 * is stop every bay on a wall showing the same 2×2 lattice, which the 08
 * combat frame still resolved into a grid however irregular the bay pitch.
 * A bay now draws one of four scales — one large vesica, the 2×2, a 3×2 and
 * a 2×3 — chosen by a stable hash of its position, so two neighbouring bays
 * never carry the same hole size. Four instanced draws instead of one.
 */
const SCREEN_ONE = repeatUv(new THREE.PlaneGeometry(1, 1), 1, 1)
const SCREEN_3X2 = repeatUv(new THREE.PlaneGeometry(1, 1), 3, 2)
const SCREEN_2X3 = repeatUv(new THREE.PlaneGeometry(1, 1), 2, 3)
const SCREEN_VARIANTS = [SCREEN_WIDE, SCREEN_ONE, SCREEN_3X2, SCREEN_2X3]
/** deal a screen list across the four variants, never the same scale twice
 *  in a row along a wall (the lists are authored wall by wall in order) */
function dealScreens(items: InstItem[], salt: number): InstItem[][] {
  const out: InstItem[][] = [[], [], [], []]
  let last = -1
  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    let k = Math.floor(h1(Math.round(it.p[0] * 3.1 + it.p[2] * 7.7), salt) * 4) % 4
    if (k === last) k = (k + 1 + Math.floor(h1(i, salt + 1) * 3)) % 4
    out[k].push(it)
    last = k
  }
  return out
}
/** single coffer (stepped frame, punched centre) for the upper wall register */
const COFFER_PANEL = new THREE.PlaneGeometry(1, 1)

/** flat annulus in the XZ plane (rotate −π/2 about X to lay it on a floor) */
function annulus(inner: number, outer: number, seg = 96): THREE.BufferGeometry {
  return new THREE.RingGeometry(inner, outer, seg)
}
const MANDALA_CHANNEL = annulus(0.955, 1.0)
const MANDALA_INLAY = annulus(0.966, 0.99)
/**
 * R4 — the medallion rings, flattened (work order env-art #10).
 *
 * They were `RING_GEO` (a 6-sided torus tube) scaled to a 0.24 m section and
 * lifted 0.15 m off the deck, which is why the panel called them "matte rope
 * crossing the near field": a hexagonal tube standing proud of a floor is a
 * cable, not an inlay. They are now flush ribbons — a wide dark channel cut
 * into the deck with a narrower polished band sunk inside it — so the near
 * field reads as gilding in stone and the rings pick up a grazing specular
 * ramp instead of a dull cylindrical terminator.
 */
const MEDAL_CHANNEL = annulus(0.9966, 1.0034, 256)
const MEDAL_INLAY = annulus(0.99785, 1.00215, 256)
/** flush lozenge for the medallion's radial petals, in its own sunk channel */
const MEDAL_PETAL = (() => {
  const s = new THREE.Shape()
  s.moveTo(0, -1)
  s.bezierCurveTo(0.62, -0.58, 0.62, 0.58, 0, 1)
  s.bezierCurveTo(-0.62, 0.58, -0.62, -0.58, 0, -1)
  const g = new THREE.ShapeGeometry(s, 18)
  g.rotateX(-Math.PI / 2)
  return g
})()
/** column collars + fret bands sized to the fluted profile */
const COLUMN_FRET_LO = repeatUv(new THREE.CylinderGeometry(0.775, 0.775, 0.42, 30, 1, true), 5)
const COLUMN_FRET_HI = repeatUv(new THREE.CylinderGeometry(0.655, 0.655, 0.34, 28, 1, true), 4)
const COLUMN_COLLAR_LO = new THREE.CylinderGeometry(0.84, 0.86, 0.22, 30, 1, true)
const COLUMN_COLLAR_HI = new THREE.CylinderGeometry(0.635, 0.635, 0.18, 28, 1, true)

// --- contact-AO baked variants (drawn with ivoryContactMaterial) ----------
/** wall panel body: plain box (no absurd 0.85 m fillet from scaling RBOX,
 *  map E2) subdivided in Y so the baked contact gradient has vertices */
const PANEL_BOX = bakeContactAO(new THREE.BoxGeometry(1, 1, 1, 1, 26, 1), -0.5, -0.44, 0.36)
/** plinth / base-course box: a grounded dark band at the foot of every
 *  free-standing mass (work order #3 — extend the cavity bake past the ribs) */
const PLINTH_BOX = bakeContactAO(new THREE.BoxGeometry(1, 1, 1, 1, 10, 1), -0.5, -0.24, 0.42)
/** chamber dome: the springing where the shell meets the wall goes dark, so a
 *  18 m vault stops reading as a uniformly lit hemisphere */
const DOME_AO = bakeContactAO(DOME_GEO, 0.4, 6.5, 0.34)
const RIB_CANYON_AO = bakeContactAO(RIB_CANYON, 0, 1.9, 0.4)
const RIB_CHAMBER_AO = bakeContactAO(RIB_CHAMBER, 0, 2.6, 0.4)
const RIB_ARENA_AO = bakeContactAO(RIB_ARENA, 0, 4.4, 0.42)
const RIB_BRIDGE_AO = bakeContactAO(RIB_BRIDGE, 0, 1.4, 0.42)
/** arch springings: the joint where a bay arch lands on its panel is a cavity,
 *  and it was the brightest part of the arch because nothing occluded it */
const WALL_ARCH_AO = bakeContactAO(WALL_ARCH, 0, 0.9, 0.46)
const WALL_ARCH_B_AO = bakeContactAO(WALL_ARCH_B, 0, 0.7, 0.46)
const WALL_ARCH_C_AO = bakeContactAO(WALL_ARCH_C, 0, 1.1, 0.46)

// --- R3 enclosure geometries ----------------------------------------------
/**
 * Arena vault. Springs from y = 11 (just above the 10 m cornice) on both long
 * walls and crowns 30 m over the deck, so the whole upper half of every arena
 * frame becomes coffered architecture instead of flat sky. The two middle bays
 * use the `openCrown` variant, which leaves a 12 m oculus slot along the ridge
 * — the room still reads as open to the void, but through a framed opening
 * rather than because nothing was built.
 *
 * The vault deliberately does NOT cast: its job is to occlude the eye, not the
 * key light. Letting a closed 60 m shell into the shadow pass would put the
 * entire arena floor in permanent shadow and throw away the round-2 shadow fix.
 */
const ARENA_VAULT_A0 = Math.asin(11 / 30)
const ARENA_VAULT_OPTS: VaultOpts = {
  radius: 30,
  a0: ARENA_VAULT_A0,
  a1: Math.PI - ARENA_VAULT_A0,
  len: 10,
  nU: 18,
  nV: 3,
  depth: 0.9,
  frame: 0.62,
  panShade: 0.3,
  revealShade: 0.62,
}
const VAULT_ARENA = vaultShell(ARENA_VAULT_OPTS)
const VAULT_ARENA_OPEN = vaultShell({ ...ARENA_VAULT_OPTS, openCrown: 0.2 })
const VAULT_ARENA_BOSS = vaultBosses(ARENA_VAULT_OPTS, 3, 3, 0.62)
/** gold transverse band lying ON the vault surface, between the structural
 *  ribs — the ceiling keeps a bright line every 5 m even in full shade */
const VAULT_ARENA_BAND = sweepArc(TRIM_PROFILE, 29.72, Math.PI, 72)

/** extraction-bridge vault: a tight ribbed tunnel with a continuous ridge slot */
const BRIDGE_VAULT_A0 = Math.asin(2 / 7.5)
const BRIDGE_VAULT_OPTS: VaultOpts = {
  radius: 7.5,
  a0: BRIDGE_VAULT_A0,
  a1: Math.PI - BRIDGE_VAULT_A0,
  len: 7,
  nU: 12,
  nV: 2,
  depth: 0.42,
  frame: 0.3,
  panShade: 0.32,
  revealShade: 0.64,
  openCrown: 0.24,
}
const VAULT_BRIDGE = vaultShell(BRIDGE_VAULT_OPTS)

/** spawn baldachin: a coffered saucer dome on the eight dais columns */
const BALDACHIN_SHELL = DOME_GEO.clone()
const BALDACHIN_AO = bakeContactAO(BALDACHIN_SHELL, 0.4, 9, 0.38)
const RIB_BALDACHIN = sweepArc(ribSection(0.4), 5.75, Math.PI, 26)
const RIB_BALDACHIN_AO = bakeContactAO(RIB_BALDACHIN, 0, 1.6, 0.44)
const BALDACHIN_BAND = new THREE.TorusGeometry(5.32, 0.15, 4, 64)

/** coffered soffit tile for flat overhead spans (gantries, portal reveals) */
const SOFFIT_WIDE = cofferSoffit(8, 2, 0.24, 0.34)
const SOFFIT_CEIL = cofferSoffit(3, 8, 0.3, 0.32)
const SOFFIT_PORTAL = cofferSoffit(3, 2, 0.2, 0.36)

/** the canyon's high transverse arch — spans the whole ravine well above the
 *  play volume, so the player runs under real structure rather than open sky */
const GANTRY_ARCH = sweepArc(ribSection(1.3), 13.2, Math.PI, 34)
const GANTRY_ARCH_AO = bakeContactAO(GANTRY_ARCH, 0, 5, 0.42)
const GANTRY_ARCH_TRIM = sweepArc(TRIM_PROFILE, 12.6, Math.PI, 34)

/** pendant lamp kit — rod, flared hood, gold collar, recessed lens */
const PENDANT_ROD = new THREE.CylinderGeometry(0.085, 0.085, 1, 8)
const PENDANT_HOOD = new THREE.CylinderGeometry(0.62, 0.17, 0.62, 16)
const PENDANT_COLLAR = new THREE.CylinderGeometry(0.2, 0.26, 0.16, 16)
const PENDANT_LENS = new THREE.SphereGeometry(0.3, 14, 10)

/** dome coffering: square-section ring bands (4 radial segments = hard arris,
 *  unlike the smooth tori that could not self-shadow) */
function domeBandRadius(y: number): number {
  return Math.sqrt(Math.max(0.01, 14 * 14 - y * y))
}
function domeBand(y: number, tube: number): THREE.BufferGeometry {
  // 4 radial segments = a square section rotated 45 deg: hard arrises that
  // catch the key on one face and go dark on the next. A round tube (what the
  // level used everywhere) is the one section that cannot self-shadow.
  return new THREE.TorusGeometry(domeBandRadius(y) - tube * 0.8, tube, 4, 80)
}
const DOME_BAND_Y = [3.5, 7.2, 10.2, 12.4]
const DOME_BANDS = DOME_BAND_Y.map((y, i) => domeBand(y, 0.2 - i * 0.022))

/** secondary (half-step) chamber meridians, so the dome reads 16-ribbed */
const RIB_CHAMBER_FINE = sweepArc(ribSection(0.55), 14, Math.PI, 30)
const RIB_CHAMBER_FINE_AO = bakeContactAO(RIB_CHAMBER_FINE, 0, 2.6, 0.42)

// ---------------------------------------------------------------------------
// Instancing helper
// ---------------------------------------------------------------------------
interface InstItem {
  p: [number, number, number]
  r?: [number, number, number]
  s?: [number, number, number]
}

const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _e = new THREE.Euler()
const _v = new THREE.Vector3()
const _s = new THREE.Vector3()

/**
 * R2 — `receiveShadow` now defaults to TRUE.
 *
 * The runtime diagnosis of the R2 build is unambiguous: 880 meshes in the
 * scene, 122 casters, 80 receivers. The shadow maps were allocated, both
 * cascades were rendering, and the near cascade was correctly framed on the
 * player — every one of those shadows was then thrown away because the surface
 * it landed on had `receiveShadow === false`. That is the whole reason "light
 * never interacts with the scene".
 *
 * Receiving is nearly free (it is a branch in an already-compiled shader, and
 * the depth map is rendered either way); CASTING is what costs, and that stays
 * opt-in per call site. So the default flips here, and ShrineStation's root
 * also sweeps every plain <mesh> in the level (see the traverse in the default
 * export) so no structural surface can be missed by hand.
 */
function Instanced({
  geometry,
  material,
  items,
  receiveShadow = true,
  castShadow = false,
}: {
  geometry: THREE.BufferGeometry
  material: THREE.Material
  items: InstItem[]
  receiveShadow?: boolean
  castShadow?: boolean
}) {
  const ref = useRef<THREE.InstancedMesh>(null!)
  useLayoutEffect(() => {
    const mesh = ref.current
    for (let i = 0; i < items.length; i++) {
      const it = items[i]
      const r = it.r ?? [0, 0, 0]
      const s = it.s ?? [1, 1, 1]
      // YXZ: yaw applied last so pitched petals stay radial after yaw
      _e.set(r[0], r[1], r[2], 'YXZ')
      _q.setFromEuler(_e)
      _v.set(it.p[0], it.p[1], it.p[2])
      _s.set(s[0], s[1], s[2])
      _m.compose(_v, _q, _s)
      mesh.setMatrixAt(i, _m)
    }
    mesh.instanceMatrix.needsUpdate = true
    mesh.computeBoundingSphere()
  }, [items, geometry])
  return (
    <instancedMesh
      ref={ref}
      args={[geometry, material, items.length]}
      receiveShadow={receiveShadow}
      castShadow={castShadow}
    />
  )
}

/** Beveled major-mass mesh from a layout BoxSpec — chamfered edges. */
function MassMesh({
  spec,
  material,
  receiveShadow = true,
  castShadow = false,
  geometry = RBOX,
}: {
  spec: BoxSpec
  material: THREE.Material
  receiveShadow?: boolean
  castShadow?: boolean
  geometry?: THREE.BufferGeometry
}) {
  const c = boxCenter(spec)
  const s = boxSize(spec)
  return (
    <mesh
      geometry={geometry}
      material={material}
      position={c}
      scale={s}
      receiveShadow={receiveShadow}
      castShadow={castShadow}
    />
  )
}

/**
 * R4 — deterministic per-instance variation.
 *
 * The panel's verdict on the last build was that a wall "reads as one panel
 * stamped in a perfect 20×8 grid". Two things make that read, and they are
 * independent: the MATERIAL repeating one tile (fixed on the surfacing side
 * with a per-tile shuffle), and the GEOMETRY sitting on a perfect lattice.
 * This is the geometry half. `h1` is a stable hash so the level is identical
 * on every load — nothing here uses Math.random, which would make two players'
 * screenshots of the same wall differ.
 */
function h1(i: number, salt = 0): number {
  const x = Math.sin(i * 127.1 + salt * 311.7 + 0.5) * 43758.5453
  return x - Math.floor(x)
}

/**
 * Per-instance jitter for repeated ornament. Wall-mounted panels are hung a
 * few centimetres proud of their backing, so rotating them out of plane would
 * poke them through the wall; `yaw`/`pitch` are therefore meant for free
 * blocks (corbels, bosses, fragments) and `scale`/`lift` for applied panels.
 * Returns a NEW array — the source tables stay pristine so anything else
 * deriving from them (fixtures, collider-adjacent data) is unaffected.
 */
function jitterItems(
  items: InstItem[],
  opts: { yaw?: number; pitch?: number; scale?: number; lift?: number; slide?: number; salt?: number },
): InstItem[] {
  const { yaw = 0, pitch = 0, scale = 0, lift = 0, slide = 0, salt = 0 } = opts
  return items.map((it, i) => {
    const r = it.r ?? [0, 0, 0]
    const s = it.s ?? [1, 1, 1]
    const a = h1(i, salt) * 2 - 1
    const b = h1(i, salt + 7) * 2 - 1
    const c = h1(i, salt + 13) * 2 - 1
    return {
      p: [it.p[0] + c * slide, it.p[1] + b * lift, it.p[2] + a * slide],
      r: [r[0] + b * pitch, r[1] + a * yaw, r[2] + c * pitch * 0.5],
      s: [s[0] * (1 + a * scale), s[1] * (1 + b * scale * 0.7), s[2] * (1 + c * scale)],
    } as InstItem
  })
}

/**
 * Coupled-column rhythm. `centres` are the pair centres and `gap` the half
 * separation, so a run of six centres yields twelve shafts in six tight pairs.
 * Classical bays are almost never a single repeat distance; the metronome
 * spacing is precisely what makes a procedural hall read as a blockout.
 */
function coupledRun(centres: number[], gap: number): number[] {
  const out: number[] = []
  for (const c of centres) out.push(c - gap, c + gap)
  return out
}

/** midpoints of consecutive entries — the bay centres a column run leaves */
function bayCentres(run: number[], minWidth: number): number[] {
  const out: number[] = []
  for (let i = 0; i + 1 < run.length; i++) {
    if (run[i + 1] - run[i] >= minWidth) out.push((run[i] + run[i + 1]) / 2)
  }
  return out
}

/** Petal rosette: n flattened petals in a ring, tilted open like a flower. */
function rosette(
  cx: number,
  cy: number,
  cz: number,
  radius: number,
  n: number,
  tilt: number,
  scale: [number, number, number],
): InstItem[] {
  const out: InstItem[] = []
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2
    out.push({
      p: [cx + Math.cos(a) * radius, cy, cz + Math.sin(a) * radius],
      r: [tilt, Math.PI / 2 - a, 0],
      s: scale,
    })
  }
  return out
}

// ---------------------------------------------------------------------------
// Zone A — Spawn Platform (z 0–15)
// ---------------------------------------------------------------------------
const A_PILLARS: InstItem[] = []
const A_CAPITALS: InstItem[] = []
for (let i = 0; i < 8; i++) {
  const a = (i / 8) * Math.PI * 2 + Math.PI / 8
  const x = Math.cos(a) * 5.2
  const z = 7.5 + Math.sin(a) * 5.2
  A_PILLARS.push({ p: [x, 4.5, z] })
  A_CAPITALS.push({ p: [x, 9.15, z], s: [1.5, 0.5, 1.5] })
}
// floor gold lines: thin insets exactly 0.02 m proud of the deck, with a
// brighter gold edge-highlight strip along the walkway-facing lip (fix2)
const A_DAIS_TRIM: InstItem[] = [
  { p: [0, 0.01, 1.72], s: [11.8, 0.02, 0.16] },
  { p: [0, 0.01, 13.28], s: [11.8, 0.02, 0.16] },
  { p: [-5.86, 0.01, 7.5], s: [0.16, 0.02, 11.8] },
  { p: [5.86, 0.01, 7.5], s: [0.16, 0.02, 11.8] },
]
const A_DAIS_TRIM_EDGE: InstItem[] = [
  { p: [0, 0.022, 1.83], s: [11.8, 0.006, 0.035] },
  { p: [0, 0.022, 13.17], s: [11.8, 0.006, 0.035] },
  { p: [-5.75, 0.022, 7.5], s: [0.035, 0.006, 11.8] },
  { p: [5.75, 0.022, 7.5], s: [0.035, 0.006, 11.8] },
]
// pillar dressing: fret bands, gold collars, plinths, base recess ring
const A_PILLAR_FRET_LO: InstItem[] = []
const A_PILLAR_FRET_HI: InstItem[] = []
const A_PILLAR_BAND_LO: InstItem[] = []
const A_PILLAR_BAND_HI: InstItem[] = []
const A_PILLAR_PLINTHS: InstItem[] = []
const A_PILLAR_RECESS: InstItem[] = []
for (const it of A_PILLARS) {
  const [x, y, z] = it.p
  A_PILLAR_FRET_LO.push({ p: [x, y - 3.6, z] })
  A_PILLAR_FRET_HI.push({ p: [x, y + 2.9, z] })
  A_PILLAR_BAND_LO.push({ p: [x, y - 4.15, z] })
  A_PILLAR_BAND_HI.push({ p: [x, y + 3.42, z] })
  A_PILLAR_PLINTHS.push({ p: [x, 0.15, z], s: [2.0, 0.3, 2.0] })
  // dark shadow-gap under the plinth so the column meets the deck on a line
  A_PILLAR_RECESS.push({ p: [x, 0.015, z], s: [2.2, 0.03, 2.2] })
}
// stepped trim course framing the dais edge (the swept Orokin moulding)
const A_DAIS_MOULD: InstItem[] = [
  { p: [0, 0.06, 1.62], r: [0, Math.PI / 2, 0], s: [1, 1, 12] },
  { p: [0, 0.06, 13.38], r: [0, Math.PI / 2, 0], s: [1, 1, 12] },
  { p: [-5.96, 0.06, 7.5], s: [1, 1, 11.9] },
  { p: [5.96, 0.06, 7.5], s: [1, 1, 11.9] },
]
// umber inlay band inside the gold lines — the warm mid-dark the floor lacked
const A_DAIS_UMBER: InstItem[] = [
  { p: [0, 0.008, 2.25], s: [11.2, 0.016, 0.7] },
  { p: [0, 0.008, 12.75], s: [11.2, 0.016, 0.7] },
]
const A_POD_PETALS = rosette(0, 0.55, 9, 1.15, 8, -1.0, [0.7, 1, 0.7])
const A_POD_PETALS_GOLD = rosette(0, 0.35, 9, 0.75, 8, -0.6, [0.45, 0.8, 0.45])

/**
 * R3 — the spawn dais gets a baldachin. This is the establishing shot of the
 * whole mission and it was eight columns holding up nothing under open sky.
 * Now they carry an architrave ring, a coffered saucer dome on a sixteen-rib
 * cage, a gold oculus and a pendant on the axis — a canopy, which is what a
 * ring of columns is FOR.
 */
const A_BALDACHIN_RIBS: InstItem[] = []
for (let i = 0; i < 8; i++)
  A_BALDACHIN_RIBS.push({ p: [0, 9.35, 7.5], r: [0, (i / 8) * Math.PI, 0], s: [1, 0.735, 1] })
const A_ARCHITRAVE: InstItem[] = [
  { p: [0, 9.5, 7.5], r: [-Math.PI / 2, 0, Math.PI / 4], s: [1.06, 1.06, 1.06] },
  { p: [0, 12.6, 7.5], r: [-Math.PI / 2, 0, Math.PI / 4], s: [0.64, 0.64, 0.9] },
]
const A_BALDACHIN_BOSS: InstItem[] = []
for (let k = 0; k < 16; k++) {
  const a = (k / 16) * Math.PI * 2
  A_BALDACHIN_BOSS.push({
    p: [Math.cos(a) * 5.45, 9.62, 7.5 + Math.sin(a) * 5.45],
    r: [0, Math.PI / 2 - a, 0],
    s: [0.26, 0.36, 0.2],
  })
}

function ZoneA() {
  // BackSide contact-ivory for the baldachin shell (same trick as the chamber
  // dome: a clone preserves onBeforeCompile so it keeps its world-space trim)
  const baldachinMat = useMemo(() => {
    const m = ivoryContactMaterial().clone()
    m.side = THREE.BackSide
    return m
  }, [])
  return (
    <group>
      {/* textured obsidian dais + ivory under-skirt */}
      <MassMesh spec={{ x0: -6, y0: -1, z0: 1.5, x1: 6, y1: 0, z1: 13.5 }} material={floorMaterial()} />
      {/* under-skirt in umber: a 14 m ivory slab at the bottom of frame was
          the brightest thing in the spawn shot and carried no information */}
      <MassMesh
        spec={{ x0: -7, y0: -1.9, z0: 0.5, x1: 7, y1: -1, z1: 14.5 }}
        material={umberMaterial()}
      />
      <Instanced geometry={BOX} material={umberMaterial()} items={A_DAIS_UMBER} />
      <Instanced geometry={BOX} material={goldMaterial()} items={A_DAIS_TRIM} />
      <Instanced geometry={BOX} material={goldEdgeMaterial()} items={A_DAIS_TRIM_EDGE} />
      <Instanced geometry={TRIM_RUN} material={goldMaterial()} items={A_DAIS_MOULD} />
      {/* pillar ring: fluted columns, fret bands, gold collars, plinths */}
      <Instanced geometry={BOX} material={recessMaterial()} items={A_PILLAR_RECESS} />
      <Instanced geometry={COLUMN_GEO} material={ivoryMaterial()} items={A_PILLARS} castShadow receiveShadow />
      <Instanced geometry={COLUMN_FRET_LO} material={fretTrimMaterial()} items={A_PILLAR_FRET_LO} />
      <Instanced geometry={COLUMN_FRET_HI} material={fretTrimMaterial()} items={A_PILLAR_FRET_HI} />
      <Instanced geometry={COLUMN_COLLAR_LO} material={goldMaterial()} items={A_PILLAR_BAND_LO} />
      <Instanced geometry={COLUMN_COLLAR_HI} material={goldPolishedMaterial()} items={A_PILLAR_BAND_HI} />
      <Instanced geometry={PLINTH_BOX} material={ivoryContactMaterial()} items={A_PILLAR_PLINTHS} castShadow />
      <Instanced geometry={BOX} material={goldMaterial()} items={A_CAPITALS} castShadow />
      {/* R3 baldachin — coffered saucer dome on the dais colonnade */}
      <mesh
        geometry={BALDACHIN_AO}
        material={baldachinMat}
        position={[0, 9.4, 7.5]}
        scale={[0.335, 0.235, 0.335]}
        receiveShadow
      />
      <Instanced
        geometry={RIB_BALDACHIN_AO}
        material={ivoryContactMaterial()}
        items={A_BALDACHIN_RIBS}
        castShadow
      />
      <Instanced geometry={BALDACHIN_BAND} material={goldMaterial()} items={A_ARCHITRAVE} />
      <Instanced geometry={OCTA} material={goldPolishedMaterial()} items={A_BALDACHIN_BOSS} />
      <mesh
        geometry={RING_GEO}
        material={goldPolishedMaterial()}
        position={[0, 13.5, 7.5]}
        rotation={[Math.PI / 2, 0, 0]}
        scale={[1.5, 1.5, 12]}
      />
      <mesh geometry={PENDANT_ROD} material={goldMaterial()} position={[0, 11.4, 7.5]} scale={[1.2, 3.6, 1.2]} castShadow />
      <mesh geometry={PENDANT_HOOD} material={goldCastMaterial()} position={[0, 9.4, 7.5]} scale={[1.5, 1.5, 1.5]} castShadow />
      <mesh geometry={PENDANT_LENS} material={veinGoldMaterial()} position={[0, 8.85, 7.5]} scale={[1.3, 0.95, 1.3]} />
      {/* insertion pod — opened petal flower, still glowing gold */}
      <Instanced geometry={PETAL} material={ivoryMaterial()} items={A_POD_PETALS} />
      <Instanced geometry={PETAL} material={goldMaterial()} items={A_POD_PETALS_GOLD} />
      <mesh geometry={CYL} material={obsidianMaterial()} position={[0, 0.3, 9]} scale={[0.8, 0.6, 0.8]} />
      <mesh
        geometry={CIRCLE}
        material={veinGoldMaterial()}
        position={[0, 0.62, 9]}
        rotation={[-Math.PI / 2, 0, 0]}
        scale={[0.7, 0.7, 1]}
      />
    </group>
  )
}

// ---------------------------------------------------------------------------
// Zone B — Traversal Canyon (z 15–135)
// ---------------------------------------------------------------------------
// deck meshes + gold edge strips
const B_DECKS: BoxSpec[] = [...B1_DECKS, { x0: -6, y0: -1, z0: 85, x1: 6, y1: 0, z1: 89 }]
// deck gold lines: thin insets 0.02 m proud + edge-highlight lip (fix2)
const B_DECK_TRIM: InstItem[] = []
const B_DECK_TRIM_EDGE: InstItem[] = []
const B_DECK_UMBER: InstItem[] = []
for (const d of B_DECKS) {
  const len = d.z1 - d.z0 - 0.2
  const zc = (d.z0 + d.z1) / 2
  B_DECK_UMBER.push({ p: [-5.3, 0.008, zc], s: [0.8, 0.016, len] })
  B_DECK_UMBER.push({ p: [5.3, 0.008, zc], s: [0.8, 0.016, len] })
  B_DECK_TRIM.push({ p: [-5.85, 0.01, zc], s: [0.16, 0.02, len] })
  B_DECK_TRIM.push({ p: [5.85, 0.01, zc], s: [0.16, 0.02, len] })
  B_DECK_TRIM_EDGE.push({ p: [-5.74, 0.022, zc], s: [0.035, 0.006, len] })
  B_DECK_TRIM_EDGE.push({ p: [5.74, 0.022, zc], s: [0.035, 0.006, len] })
}

// east glass wall: mullions + panes + beams
const B_MULLIONS: InstItem[] = []
const B_PANES: InstItem[] = []
for (let z = 15; z <= 133; z += 3) {
  B_MULLIONS.push({ p: [6, 4, z], s: [0.4, 8, 0.4] })
  if (z + 3 <= 133) B_PANES.push({ p: [5.97, 4, z + 1.5], r: [0, Math.PI / 2, 0], s: [2.6, 7, 1] })
}

// west wall (B2–B4) with gold pilaster strips + vein insets
const B_WEST_PILASTERS: InstItem[] = []
const B_WEST_VEINS: InstItem[] = []
const B_WEST_VEIN_CHANNEL: InstItem[] = []
/**
 * R2 — the canyon's west wall is the surface the player runs beside for 95 m
 * and it was a flat ivory slab with gold stripes on it. Every second bay now
 * carries a tall pierced screen on a black recess: the same amount of wall,
 * with a silhouette and a depth cue.
 */
const B_WEST_SCREEN: InstItem[] = []
const B_WEST_SCREEN_BACK: InstItem[] = []
for (let z = 44; z <= 132; z += 8) {
  B_WEST_PILASTERS.push({ p: [-5.85, 4.5, z], s: [0.25, 9, 0.6] })
  if (((z - 44) / 8) % 2 === 1 && z + 4 <= 132) {
    B_WEST_SCREEN_BACK.push({ p: [-5.88, 4.3, z + 4], s: [0.1, 6.6, 6.6] })
    B_WEST_SCREEN.push({ p: [-5.81, 4.3, z + 4], r: [0, Math.PI / 2, 0], s: [6.2, 6.2, 1] })
  }
  // every other one only — and each sits in a dark channel
  if (((z - 44) / 8) % 2 === 0) {
    B_WEST_VEINS.push({ p: [-5.68, 3, z + 4], s: [0.06, 4.5, 0.3] })
    B_WEST_VEIN_CHANNEL.push({ p: [-5.76, 3, z + 4], s: [0.08, 5.2, 0.66] })
  }
}

/** R7c — the canyon's tall screens alternate between the 2×2 lattice and the
 *  single large vesica, so the run the player sprints past is not five copies */
const B_WEST_SCREEN_V = dealScreens(B_WEST_SCREEN, 67)

// R3 — shadow gaps flanking every west-wall pilaster (see D_PILASTER_FLANK)
const B_PILASTER_FLANK: InstItem[] = []
for (let z = 44; z <= 132; z += 8) {
  for (const dz of [-0.42, 0.42]) {
    B_PILASTER_FLANK.push({ p: [-5.79, 4.5, z + dz], s: [0.12, 8.6, 0.13] })
  }
}

// canyon arch-ribs
const B_RIBS: InstItem[] = []
for (let z = 20; z <= 130; z += 10) B_RIBS.push({ p: [0, 0, z] })

// ---------------------------------------------------------------------------
// Canyon outer wall layers (visual only) — repeating arch-rib bays flanking
// the deck so the player reads as IN a canyon. West: behind the inner wall;
// east: beyond the glass, looming over it. Teal strips = practical glow.
// ---------------------------------------------------------------------------
// fix2: 3 arch-bay variants (standard / narrow+heavy / wide+slender) on an
// irregular spacing rhythm (5,4,6,4,7 m) so the colonnade walls no longer
// read as a stamped-out repeat. Panels, engraving, practicals and ornament
// are all placed per-bay so widths always match.
const B_WALL_PANELS: InstItem[] = []
const B_WALL_ARCH_A: InstItem[] = []
const B_WALL_ARCH_B: InstItem[] = []
const B_WALL_ARCH_C: InstItem[] = []
const B_WALL_TEAL: InstItem[] = []
const B_WALL_TEAL_CHANNEL: InstItem[] = []
const B_WALL_GOLD: InstItem[] = []
const B_WALL_ENGRAVE: InstItem[] = []
const B_WALL_KEYSTONE: InstItem[] = []
const B_WALL_MINIPIL: InstItem[] = []
const B_WALL_NICHE: InstItem[] = []
const B_WALL_FRET: InstItem[] = []
const B_WALL_BASE_UMBER: InstItem[] = []
const B_WALL_SCREEN: InstItem[] = []
const B_WALL_CORBEL: InstItem[] = []
/**
 * R2 colour script — architectural practicals are AUREATE, not cadence teal.
 * Teal is the hostile/corruption hue and nothing else: spawn gates, vein
 * growth, glyph stains. The canyon used to be lit by 30-odd teal strips, which
 * put the enemy colour on 100 m of the player's own shrine and is why the
 * frames read as one cyan-tinted value band.
 */
const B_GOLD_FIXTURES: [number, number, number][] = []

const BAY_RHYTHM = [5, 4, 6, 4, 7]
{
  let z = 20
  let bi = 0
  while (z < 130) {
    const w = BAY_RHYTHM[bi % BAY_RHYTHM.length]
    if (z + w > 131) break
    const zc = z + w / 2
    const variant = bi % 3
    const archScale: [number, number, number] = [w / 4.6, 1, 1] // local X → world Z
    for (const west of [true, false]) {
      const px = west ? -10 : 14.6
      const ax = west ? -9.28 : 13.88
      const ay = west ? 5.2 : 5.8
      const tx = west ? -9.36 : 13.96
      const gx = west ? -9.38 : 13.98
      const ex = west ? -9.41 : 14.01
      const py = west ? 8.5 : 9.5
      const ph = west ? 17 : 19
      const dir = west ? 1 : -1
      const face = west ? 1 : -1 // outward normal of the visible panel face
      B_WALL_PANELS.push({ p: [px, py, zc], s: [1.2, ph, w * 0.94] })
      // near-black inset filling each arch: the bay reads as a recessed niche
      // rather than a decal ring stuck on a flat slab. Sits 1 cm proud of the
      // panel face and 6 cm behind the arch moulding.
      B_WALL_NICHE.push({
        p: [px + face * 0.66, (0.8 + ay + 2.0) / 2, zc],
        s: [0.08, ay + 1.2, w * 0.8],
      })
      const archItem: InstItem = { p: [ax, ay, zc], r: [0, Math.PI / 2, 0], s: archScale }
      if (variant === 0) B_WALL_ARCH_A.push(archItem)
      else if (variant === 1) B_WALL_ARCH_B.push(archItem)
      else B_WALL_ARCH_C.push(archItem)
      // ONE recessed teal practical every other bay (was two per bay, both
      // proud of the wall): cyan count cut ~75%, each one now sits in a dark
      // channel so it reads as a fixture instead of a sticker
      if (bi % 2 === 0) {
        const ty = west ? 2.4 : 2.8
        const th = west ? 3.6 : 4.4
        B_WALL_TEAL_CHANNEL.push({ p: [px + face * 0.58, ty, zc - w * 0.34], s: [0.08, th + 0.7, 0.62] })
        B_WALL_TEAL.push({ p: [tx, ty, zc - w * 0.34], s: [0.1, th, 0.24] })
        B_GOLD_FIXTURES.push([tx + face * 0.3, ty, zc - w * 0.34])
      }
      // Pierced stone screen across the arch niche. The niche box
      // (B_WALL_NICHE, recess black) is already the backing, so the screen has
      // to sit PROUD of its front face — 0.66 + half its 0.08 thickness — and
      // still behind the arch moulding, which stands 0.3 out from the panel.
      B_WALL_SCREEN.push({
        p: [px + face * 0.8, (1.0 + ay + 1.6) / 2, zc],
        r: [0, face * Math.PI / 2, 0],
        s: [w * 0.7, ay + 0.85, 1],
      })
      // corbel bracket under the cornice — fills the upper corner of the frame
      B_WALL_CORBEL.push({
        p: [px + face * 0.92, ph - 1.4, zc],
        s: [0.9, 0.7, w * 0.42],
      })
      // gold vertical seam trim (variants A/B) or flanking mini-pilasters (C)
      if (variant === 2) {
        B_WALL_MINIPIL.push({ p: [gx, 5, zc - w * 0.42], s: [0.16, 7, 0.4] })
        B_WALL_MINIPIL.push({ p: [gx, 5, zc + w * 0.42], s: [0.16, 7, 0.4] })
      } else {
        B_WALL_GOLD.push({ p: [gx, west ? 9.5 : 10.5, zc - dir * (w / 2 - 0.2)], s: [0.14, west ? 13 : 14, 0.3] })
      }
      // engraved segment lines across the panel face (now true recess black)
      for (const ey of [3.8, 7.6]) {
        B_WALL_ENGRAVE.push({ p: [ex, ey, zc], s: [0.05, 0.09, w * 0.7] })
      }
      // filigree course running over the arch crown
      B_WALL_FRET.push({
        p: [ex + face * 0.02, ay + 2.5, zc],
        r: [0, face * Math.PI / 2, 0],
        s: [w * 0.82, 0.5, 1],
      })
      // umber plinth course grounding the panel
      B_WALL_BASE_UMBER.push({ p: [px, 0.55, zc], s: [1.32, 1.1, w * 0.96] })
      // variant B ornament: gold keystone at the arch apex
      if (variant === 1) {
        B_WALL_KEYSTONE.push({ p: [ax, ay + 1.45, zc], s: [0.3, 0.8, 0.5] })
      }
    }
    z += w
    bi++
  }
}

// ---------------------------------------------------------------------------
// Descending under-structure (visual only) — piers drop from the decks /
// wall-run slabs / spire into the void glow, so gaps read as depth. Teal
// under-glow strips rim the deck undersides.
// ---------------------------------------------------------------------------
const B_BUTTRESSES: InstItem[] = []
const B_UNDERGLOW: InstItem[] = []
for (const d of B_DECKS) {
  const zc = (d.z0 + d.z1) / 2
  const len = d.z1 - d.z0 - 0.4
  B_BUTTRESSES.push({ p: [-4.6, -9, zc], s: [1.4, 16, 1.8] })
  B_BUTTRESSES.push({ p: [4.6, -9, zc], s: [1.4, 16, 1.8] })
  // one under-glow rail per deck instead of two (cyan discipline)
  B_UNDERGLOW.push({ p: [5.5, -1.06, zc], s: [0.14, 0.12, len] })
}
// root piers under wall-run slabs + the spire so nothing floats
for (const s of WALLRUN_SLABS) {
  const c = boxCenter(s)
  B_BUTTRESSES.push({ p: [c[0], -7.5, c[2] - 3.5], s: [1.7, 13, 1.7], r: [0.07, 0, 0.05] })
  B_BUTTRESSES.push({ p: [c[0], -6.5, c[2] + 4], s: [1.2, 11, 1.2], r: [-0.06, 0, -0.07] })
}
B_BUTTRESSES.push({ p: [4, -7.5, 106], s: [3.4, 15, 3.4] }) // spire root
B_BUTTRESSES.push({ p: [-3.8, -8, 127], s: [1.5, 16, 1.5], r: [0.05, 0.4, 0] }) // ledge pier

// B1 west railing: posts + petal fins
const B_RAIL_POSTS: InstItem[] = []
const B_RAIL_PETALS: InstItem[] = []
for (let z = 14; z <= 37; z += 2) {
  B_RAIL_POSTS.push({ p: [-6, 0.5, z], s: [0.12, 1, 0.12] })
  B_RAIL_PETALS.push({ p: [-6, 1.05, z], r: [0, Math.PI / 2, 0.55], s: [0.28, 0.6, 0.28] })
}

// wall-run slab gold vein strips (readability: "long gold-veined slabs")
const B_SLAB_VEINS: InstItem[] = []
const B_SLAB_CHANNEL: InstItem[] = []
for (const s of WALLRUN_SLABS) {
  const len = s.z1 - s.z0 - 2
  const zc = (s.z0 + s.z1) / 2
  // one recessed vein per face instead of two proud strips, so the slab reads
  // as carved stone with a lit channel rather than a neon pinstripe
  const fy = s.y0 + (s.y1 - s.y0) * 0.55
  for (const fx of [s.x0 - 0.02, s.x1 + 0.02]) {
    const dir = fx < 0 ? 1 : -1
    B_SLAB_CHANNEL.push({ p: [fx + dir * 0.05, fy, zc], s: [0.08, 0.24, len + 0.4] })
    B_SLAB_VEINS.push({ p: [fx, fy, zc], s: [0.05, 0.12, len] })
  }
  // top edge highlight — gold nosing, not energy
  B_SLAB_VEINS.push({ p: [(s.x0 + s.x1) / 2, s.y1 + 0.02, zc], s: [s.x1 - s.x0 - 0.4, 0.06, len] })
}

// spire trim ring + broken crown
const B_SPIRE_CROWN: InstItem[] = [
  { p: [4, 8.9, 106], r: [0.12, 0.4, 0.22], s: [3.4, 1.8, 4.2] },
  { p: [5.4, 10.6, 105], r: [-0.2, 0.9, 0.5], s: [1.6, 2.6, 1.8] },
]

// high ledge + steps with gold nosing (0.02 m proud + edge highlight, fix2)
const B_LEDGE_STEPS: BoxSpec[] = [HIGH_LEDGE, ...B4_STEPS]
const B_STEP_NOSING: InstItem[] = []
const B_STEP_NOSING_EDGE: InstItem[] = []
for (const s of B_LEDGE_STEPS) {
  B_STEP_NOSING.push({
    p: [(s.x0 + s.x1) / 2, s.y1 + 0.01, s.z0 + 0.1],
    s: [s.x1 - s.x0, 0.02, 0.16],
  })
  B_STEP_NOSING_EDGE.push({
    p: [(s.x0 + s.x1) / 2, s.y1 + 0.022, s.z0 + 0.19],
    s: [s.x1 - s.x0, 0.006, 0.035],
  })
}

// ---------------------------------------------------------------------------
// R3 — canyon overhead structure.
//
// The canyon is 120 m of running with nothing at all above head height: the
// top of the frame is sky for the entire traversal. Five gantries now cross
// the ravine between the two outer cornices — a deep girder with a coffered
// soffit carried on a 26 m transverse arch, with pendant lamps hung under it.
// They are ~13 m up, clear of every jump and wall-run line, and because the
// player runs directly beneath them they sweep through the upper third of the
// frame as near-camera framing, which no shot in this level has ever had.
// Corbel arms along both walls do the same job at a smaller scale every 8 m.
// ---------------------------------------------------------------------------
const GANTRY_CX = (CANYON_GANTRY_SPAN[0] + CANYON_GANTRY_SPAN[1]) / 2
const GANTRY_W = CANYON_GANTRY_SPAN[1] - CANYON_GANTRY_SPAN[0]
const B_GANTRY_ARCH: InstItem[] = []
const B_GANTRY_GIRDER: InstItem[] = []
const B_GANTRY_SOFFIT: InstItem[] = []
const B_GANTRY_RAIL: InstItem[] = []
const B_GANTRY_CAP: InstItem[] = []
const B_GANTRY_SHOE: InstItem[] = []
for (const z of CANYON_GANTRIES) {
  B_GANTRY_ARCH.push({ p: [GANTRY_CX, 2.6, z] })
  B_GANTRY_GIRDER.push({ p: [GANTRY_CX, CANYON_GANTRY_Y, z], s: [GANTRY_W, 1.6, 2.6] })
  B_GANTRY_SOFFIT.push({ p: [GANTRY_CX, CANYON_GANTRY_Y - 0.79, z], s: [GANTRY_W - 0.1, 1, 2.5] })
  B_GANTRY_CAP.push({ p: [GANTRY_CX, CANYON_GANTRY_Y + 0.92, z], s: [GANTRY_W + 0.7, 0.26, 3.1] })
  for (const dz of [-1.32, 1.32]) {
    B_GANTRY_RAIL.push({ p: [GANTRY_CX, CANYON_GANTRY_Y - 0.72, z + dz], s: [GANTRY_W + 0.1, 0.2, 0.16] })
  }
  // the shoes where the arch lands on each outer wall
  for (const sx of [0, 1]) {
    const x = CANYON_GANTRY_SPAN[sx] + (sx === 0 ? 1.1 : -1.1)
    B_GANTRY_SHOE.push({ p: [x, 3.1, z], s: [3.0, 2.6, 3.0] })
  }
}
/**
 * R3 — the canyon gets a ceiling. Not a barrel vault: a barrel would have
 * swallowed the gantries and the outer-wall colonnade that give the ravine its
 * depth. Instead the span between the two outer cornices is closed by coffered
 * slabs at 17.5 m, left open along a 6 m ridge slot so the void, the god rays
 * and the parallax monoliths still come down the axis. Everything below stays
 * exactly as it was; the difference is that the top of the frame is now dark
 * ornament with an intentional bright slot in it, instead of flat skybox.
 */
const B_CEIL_Y = 17.5
const B_CEIL_PANEL: InstItem[] = []
const B_CEIL_BEAM: InstItem[] = []
const B_CEIL_KERB: InstItem[] = []
{
  const edges = [17, ...CANYON_GANTRIES, 134]
  for (let i = 0; i < edges.length - 1; i++) {
    const z0 = edges[i] + (i === 0 ? 0 : 1.5)
    const z1 = edges[i + 1] - (i === edges.length - 2 ? 0 : 1.5)
    const zc = (z0 + z1) / 2
    const len = z1 - z0
    if (len < 1) continue
    // two coffered leaves, leaving the ridge slot (x −2 .. 4) open to space
    B_CEIL_PANEL.push({ p: [-5.75, B_CEIL_Y, zc], s: [7.5, 1, len] })
    B_CEIL_PANEL.push({ p: [9.05, B_CEIL_Y, zc], s: [10.1, 1, len] })
    B_CEIL_BEAM.push({ p: [-5.75, B_CEIL_Y + 0.42, zc], s: [7.6, 0.85, len] })
    B_CEIL_BEAM.push({ p: [9.05, B_CEIL_Y + 0.42, zc], s: [10.2, 0.85, len] })
  }
  // gold kerbs down both lips of the ridge slot
  B_CEIL_KERB.push({ p: [-1.9, B_CEIL_Y + 0.1, 75.5], s: [0.34, 0.5, 117] })
  B_CEIL_KERB.push({ p: [4.1, B_CEIL_Y + 0.1, 75.5], s: [0.34, 0.5, 117] })
}

/** pendant lamps under each gantry */
const B_PENDANT_POS: [number, number, number][] = []
for (const z of CANYON_GANTRIES) {
  for (const x of CANYON_PENDANT_X) B_PENDANT_POS.push([x, 11.2, z])
}
/** wall corbel arms — small overhead mass every 8 m down both canyon walls,
 *  every other one carrying a lamp at camera height */
const B_CORBEL_ARM: InstItem[] = []
const B_CORBEL_PLATE: InstItem[] = []
for (let z = 20, k = 0; z <= 132; z += 8, k++) {
  B_CORBEL_ARM.push({ p: [-5.35, 8.7, z], s: [1.7, 0.68, 0.95] })
  B_CORBEL_ARM.push({ p: [5.45, 8.7, z], s: [1.7, 0.68, 0.95] })
  B_CORBEL_PLATE.push({ p: [-5.05, 9.12, z], s: [1.9, 0.12, 1.1] })
  B_CORBEL_PLATE.push({ p: [5.15, 9.12, z], s: [1.9, 0.12, 1.1] })
  if (k % 2 === 1 && z > 40) B_PENDANT_POS.push([-4.5, 7.5, z])
}
const B_PENDANT_ROD: InstItem[] = B_PENDANT_POS.map(([x, y, z]) => {
  const top = y > 9 ? CANYON_GANTRY_Y - 0.85 : 8.45
  const len = Math.max(0.4, top - y)
  return { p: [x, y + len / 2, z] as [number, number, number], s: [1, len, 1] as [number, number, number] }
})
const B_PENDANT_HOOD: InstItem[] = B_PENDANT_POS.map(([x, y, z]) => ({
  p: [x, y, z] as [number, number, number],
  s: [1.1, 1.1, 1.1] as [number, number, number],
}))
const B_PENDANT_COLLAR: InstItem[] = B_PENDANT_POS.map(([x, y, z]) => ({
  p: [x, y + 0.36, z] as [number, number, number],
  s: [1.05, 1.05, 1.05] as [number, number, number],
}))
const B_PENDANT_LENS: InstItem[] = B_PENDANT_POS.map(([x, y, z]) => ({
  p: [x, y - 0.34, z] as [number, number, number],
  s: [0.9, 0.7, 0.9] as [number, number, number],
}))
const B_PENDANT_RING: InstItem[] = B_PENDANT_POS.map(([x, y, z]) => ({
  p: [x, y - 0.3, z] as [number, number, number],
  r: [Math.PI / 2, 0, 0] as [number, number, number],
  s: [0.6, 0.6, 9] as [number, number, number],
}))

function ZoneB() {
  return (
    <group>
      {/* decks — textured obsidian panel/grating floor */}
      {B_DECKS.map((d, i) => (
        <MassMesh key={i} spec={d} material={floorMaterial()} />
      ))}
      <Instanced geometry={BOX} material={umberMaterial()} items={B_DECK_UMBER} />
      <Instanced geometry={BOX} material={goldMaterial()} items={B_DECK_TRIM} />
      <Instanced geometry={BOX} material={goldEdgeMaterial()} items={B_DECK_TRIM_EDGE} />

      {/* west railing (B1) */}
      <Instanced geometry={BOX} material={goldMaterial()} items={B_RAIL_POSTS} />
      <Instanced geometry={PETAL} material={goldMaterial()} items={B_RAIL_PETALS} />
      <mesh geometry={BOX} material={goldMaterial()} position={[-6, 1.02, 25.5]} scale={[0.12, 0.1, 23]} />

      {/* west wall (B2–B4) */}
      <MassMesh
        spec={{ x0: -6.4, y0: 0, z0: 40, x1: -5.9, y1: 9, z1: 135 }}
        geometry={PANEL_BOX}
        material={ivoryContactMaterial()}
        castShadow
      />
      <Instanced geometry={BOX} material={recessMaterial()} items={B_PILASTER_FLANK} />
      <Instanced geometry={BOX} material={goldMaterial()} items={B_WEST_PILASTERS} />
      <Instanced geometry={BOX} material={recessMaterial()} items={B_WEST_SCREEN_BACK} />
      {B_WEST_SCREEN_V.map((items, i) => (
        <Instanced key={i} geometry={SCREEN_VARIANTS[i]} material={screenMaterial()} items={items} castShadow />
      ))}
      <Instanced geometry={BOX} material={recessMaterial()} items={B_WEST_VEIN_CHANNEL} />
      <Instanced geometry={BOX} material={veinGoldMaterial()} items={B_WEST_VEINS} />

      {/* east glass wall to space */}
      <Instanced geometry={BOX} material={ivoryMaterial()} items={B_MULLIONS} castShadow />
      <Instanced geometry={PLANE} material={glassMaterial()} items={B_PANES} />
      <mesh geometry={BOX} material={goldMaterial()} position={[6, 8.15, 74]} scale={[0.5, 0.4, 119]} />
      <mesh geometry={BOX} material={goldMaterial()} position={[6, 0.25, 74]} scale={[0.5, 0.5, 119]} />

      {/* canyon outer wall layers: 3 arch-bay variants, irregular rhythm,
          engraved panel lines, teal practical strips */}
      <Instanced geometry={BOX} material={recessMaterial()} items={B_WALL_NICHE} />
      <Instanced
        geometry={PANEL_BOX}
        material={ivoryContactMaterial()}
        items={B_WALL_PANELS}
        receiveShadow
        castShadow
      />
      <Instanced geometry={BOX} material={umberMaterial()} items={B_WALL_BASE_UMBER} receiveShadow />
      <Instanced geometry={WALL_ARCH_AO} material={ivoryContactMaterial()} items={B_WALL_ARCH_A} castShadow />
      <Instanced geometry={ARCH_TRIM_A} material={goldMaterial()} items={B_WALL_ARCH_A} />
      <Instanced geometry={WALL_ARCH_B_AO} material={ivoryContactMaterial()} items={B_WALL_ARCH_B} castShadow />
      <Instanced geometry={ARCH_TRIM_B} material={goldMaterial()} items={B_WALL_ARCH_B} />
      <Instanced geometry={WALL_ARCH_C_AO} material={ivoryContactMaterial()} items={B_WALL_ARCH_C} castShadow />
      <Instanced geometry={ARCH_TRIM_C} material={goldMaterial()} items={B_WALL_ARCH_C} />
      <Instanced geometry={BOX} material={goldPolishedMaterial()} items={B_WALL_KEYSTONE} />
      <Instanced geometry={BOX} material={goldMaterial()} items={B_WALL_MINIPIL} />
      <Instanced geometry={BOX} material={recessMaterial()} items={B_WALL_ENGRAVE} />
      <Instanced geometry={FRET_PANEL} material={fretTrimMaterial()} items={B_WALL_FRET} />
      <Instanced geometry={BOX} material={recessMaterial()} items={B_WALL_TEAL_CHANNEL} />
      {/* R2 colour script: the canyon's bay practicals are AUREATE. Teal is
          reserved for the hostile domain (gates, vein growth, glyph stains). */}
      <Instanced geometry={BOX} material={veinGoldMaterial()} items={B_WALL_TEAL} />
      <Instanced geometry={BOX} material={goldMaterial()} items={B_WALL_GOLD} />
      {/* pierced screens over the flat bay spans, backed by the arch niche */}
      <Instanced
        geometry={SCREEN_WIDE}
        material={screenMaterial()}
        items={B_WALL_SCREEN}
        castShadow
      />
      {/* corbel brackets under the cornice — upper-corner framing mass */}
      <Instanced geometry={RBOX} material={ivoryMaterial()} items={B_WALL_CORBEL} />
      {/* R3 — coffered ceiling slabs between the outer cornices, split by a
          6 m ridge slot. They do not cast: the key must still reach the deck. */}
      <Instanced geometry={SOFFIT_CEIL} material={ivoryContactMaterial()} items={B_CEIL_PANEL} />
      <Instanced geometry={PANEL_BOX} material={ivoryContactMaterial()} items={B_CEIL_BEAM} />
      <Instanced geometry={BOX} material={goldMaterial()} items={B_CEIL_KERB} />

      {/* R3 — overhead gantries: transverse arch, deep girder, coffered
          soffit, pendant lamps. The canyon finally has a top to its frame. */}
      <Instanced geometry={GANTRY_ARCH_AO} material={ivoryContactMaterial()} items={B_GANTRY_ARCH} castShadow />
      <Instanced geometry={GANTRY_ARCH_TRIM} material={goldMaterial()} items={B_GANTRY_ARCH} />
      <Instanced geometry={RBOX} material={ivoryMaterial()} items={B_GANTRY_SHOE} castShadow />
      <Instanced geometry={PANEL_BOX} material={ivoryContactMaterial()} items={B_GANTRY_GIRDER} castShadow />
      <Instanced geometry={SOFFIT_WIDE} material={ivoryContactMaterial()} items={B_GANTRY_SOFFIT} />
      <Instanced geometry={BOX} material={goldMaterial()} items={B_GANTRY_RAIL} />
      <Instanced geometry={BOX} material={goldMaterial()} items={B_GANTRY_CAP} />
      {/* corbel arms + their pendants */}
      <Instanced geometry={RBOX} material={ivoryMaterial()} items={B_CORBEL_ARM} castShadow />
      <Instanced geometry={BOX} material={goldMaterial()} items={B_CORBEL_PLATE} />
      <Instanced geometry={PENDANT_ROD} material={goldMaterial()} items={B_PENDANT_ROD} castShadow />
      <Instanced geometry={PENDANT_HOOD} material={goldCastMaterial()} items={B_PENDANT_HOOD} castShadow />
      <Instanced geometry={PENDANT_COLLAR} material={goldPolishedMaterial()} items={B_PENDANT_COLLAR} />
      <Instanced geometry={PENDANT_LENS} material={veinGoldMaterial()} items={B_PENDANT_LENS} />
      <Instanced geometry={RING_GEO} material={goldPolishedMaterial()} items={B_PENDANT_RING} />

      {/* cornice beams crowning the outer walls */}
      <mesh geometry={BOX} material={goldMaterial()} position={[-9.5, 17.2, 75]} scale={[0.7, 0.5, 115]} />
      <mesh geometry={BOX} material={goldMaterial()} position={[14.1, 19.2, 75]} scale={[0.7, 0.5, 115]} />

      {/* descending under-structure + teal under-glow (void = depth, not empty) */}
      <Instanced geometry={RBOX} material={ivoryMaterial()} items={B_BUTTRESSES} castShadow />
      <Instanced geometry={BOX} material={veinGoldMaterial()} items={B_UNDERGLOW} />

      {/* arch-rib colonnade — contact-AO baked feet, casts shadow */}
      <Instanced
        geometry={RIB_CANYON_AO}
        material={ivoryContactMaterial()}
        items={B_RIBS}
        receiveShadow
        castShadow
      />
      <Instanced geometry={ARCH_TRIM_CANYON} material={goldMaterial()} items={B_RIBS} />
      <Instanced geometry={ARCH_TRIM_CANYON_IN} material={goldPolishedMaterial()} items={B_RIBS} />

      {/* wall-run slabs + gold veins */}
      {WALLRUN_SLABS.map((s, i) => (
        <MassMesh key={i} spec={s} material={ivoryMaterial()} castShadow />
      ))}
      <Instanced geometry={BOX} material={recessMaterial()} items={B_SLAB_CHANNEL} />
      <Instanced geometry={BOX} material={veinGoldMaterial()} items={B_SLAB_VEINS} />

      {/* broken spire + crown */}
      <MassMesh spec={SPIRE} material={ivoryMaterial()} castShadow />
      <mesh geometry={BOX} material={goldMaterial()} position={[4, 8.06, 106]} scale={[5.2, 0.14, 6.2]} />
      <Instanced geometry={RBOX} material={ivoryMaterial()} items={B_SPIRE_CROWN} />

      {/* high ledge + descent steps */}
      {B_LEDGE_STEPS.map((s, i) => (
        <MassMesh key={i} spec={s} material={floorMaterial()} />
      ))}
      <Instanced geometry={BOX} material={goldMaterial()} items={B_STEP_NOSING} />
      <Instanced geometry={BOX} material={goldEdgeMaterial()} items={B_STEP_NOSING_EDGE} />

      {/* balcony gate frame at z135 */}
      <mesh geometry={BOX} material={ivoryMaterial()} position={[-4, 4, 134.7]} scale={[1.2, 8, 1]} castShadow />
      <mesh geometry={BOX} material={ivoryMaterial()} position={[4, 4, 134.7]} scale={[1.2, 8, 1]} castShadow />
      <mesh geometry={BOX} material={goldMaterial()} position={[0, 8.4, 134.7]} scale={[9.4, 0.8, 1]} />

      <PetalGate />
      <WindStreaks />
      <HoloMarker />
      <DebrisField />
    </group>
  )
}

// ---------------------------------------------------------------------------
// Petal gate (chamber south door) — iris opens on approach / phase ≥ OBJECTIVE
// ---------------------------------------------------------------------------
const GATE_PETAL_COUNT = 8
const _gateM = new THREE.Matrix4()
const _gateQ = new THREE.Quaternion()
const _gateQz = new THREE.Quaternion()
const _gateQy = new THREE.Quaternion()
const _gateV = new THREE.Vector3()
const _gateS = new THREE.Vector3(1, 1, 1)
const AXIS_Z = new THREE.Vector3(0, 0, 1)
const AXIS_Y = new THREE.Vector3(0, 1, 0)

function PetalGate() {
  const meshRef = useRef<THREE.InstancedMesh>(null!)
  const glowRef = useRef<THREE.MeshBasicMaterial>(null!)
  const openT = useRef(0)
  const colliderId = useRef<number | null>(null)

  useEffect(() => {
    const b = new THREE.Box3(
      new THREE.Vector3(PETAL_GATE.x0, PETAL_GATE.y0, PETAL_GATE.z0),
      new THREE.Vector3(PETAL_GATE.x1, PETAL_GATE.y1, PETAL_GATE.z1),
    )
    colliderId.current = registerCollider(b, ['wall'])
    return () => {
      if (colliderId.current !== null) unregisterCollider(colliderId.current)
      colliderId.current = null
    }
  }, [])

  useLayoutEffect(() => {
    updateGateMatrices(meshRef.current, 0)
  }, [])

  useFrame((state, dt) => {
    const s = useGameStore.getState()
    const phaseIdx = PHASE_ORDER.indexOf(s.phase)
    const wantOpen = phaseIdx >= 2 || state.camera.position.z > 126
    const prev = openT.current
    openT.current = THREE.MathUtils.clamp(openT.current + (wantOpen ? dt / 1.2 : -dt / 1.2), 0, 1)
    if (openT.current !== prev) {
      updateGateMatrices(meshRef.current, openT.current)
      // teal → gold flash while opening
      glowRef.current.color.lerpColors(TEAL_TMP, GOLD_TMP, openT.current)
      if (openT.current > 0.7 && colliderId.current !== null) {
        unregisterCollider(colliderId.current)
        colliderId.current = null
      }
    }
  })

  return (
    <group position={[0, 3.2, 134.72]}>
      <instancedMesh ref={meshRef} args={[PETAL, undefined, GATE_PETAL_COUNT]}>
        <meshStandardMaterial color={COLORS.shrineIvory} metalness={0.2} roughness={0.4} />
      </instancedMesh>
      <mesh geometry={CIRCLE} position={[0, 0, -0.15]} scale={[2.4, 2.4, 1]}>
        <meshBasicMaterial ref={glowRef} color={TEAL_TMP} toneMapped={false} transparent opacity={0.9} />
      </mesh>
    </group>
  )
}

// HDR-boosted scratch colors for the gate teal→gold flash (bloom range)
const TEAL_TMP = new THREE.Color(COLORS.cadenceTeal).multiplyScalar(1.8)
const GOLD_TMP = new THREE.Color(COLORS.aureate).multiplyScalar(1.8)
/** hot solar core for the chamber oculus disc */
const SOLAR_HOT = new THREE.Color(COLORS.solarWhite).multiplyScalar(2.2)

function updateGateMatrices(mesh: THREE.InstancedMesh, t: number) {
  const radius = 2.1 + t * 1.6
  for (let i = 0; i < GATE_PETAL_COUNT; i++) {
    const a = (i / GATE_PETAL_COUNT) * Math.PI * 2
    _gateV.set(Math.cos(a) * radius * 0.62, Math.sin(a) * radius * 0.62, 0)
    // long axis (local +Z) swung into the door plane, pointing radially,
    // then rotated around the door normal as the iris opens
    _gateQz.setFromAxisAngle(AXIS_Z, a + Math.PI / 2 + t * 1.5)
    _gateQy.setFromAxisAngle(AXIS_Y, Math.PI / 2)
    _gateQ.copy(_gateQz).multiply(_gateQy)
    _gateS.set(1.1, 1, 1.1)
    _gateM.compose(_gateV, _gateQ, _gateS)
    mesh.setMatrixAt(i, _gateM)
  }
  mesh.instanceMatrix.needsUpdate = true
  mesh.computeBoundingSphere()
}

// phase order helper (shared by gate + FX)
export const PHASE_ORDER = [
  'DROPSHIP',
  'INFILTRATE',
  'OBJECTIVE',
  'EXTERMINATE',
  'EXTRACT',
  'WIN',
  'LOSE',
] as const

// ---------------------------------------------------------------------------
// Canyon wind streaks (B3 airflow) — Points streaming +Z
// ---------------------------------------------------------------------------
const WIND_COUNT = 160

function WindStreaks() {
  const ref = useRef<THREE.Points>(null!)
  const geom = useMemo(() => {
    const g = new THREE.BufferGeometry()
    const pos = new Float32Array(WIND_COUNT * 3)
    for (let i = 0; i < WIND_COUNT; i++) {
      pos[i * 3] = -6 + Math.random() * 12
      pos[i * 3 + 1] = Math.random() * 10
      pos[i * 3 + 2] = 15 + Math.random() * 120
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    return g
  }, [])

  useFrame((_, dt) => {
    const pos = geom.attributes.position as THREE.BufferAttribute
    const arr = pos.array as Float32Array
    for (let i = 0; i < WIND_COUNT; i++) {
      arr[i * 3 + 2] += 16 * dt
      if (arr[i * 3 + 2] > 135) arr[i * 3 + 2] -= 120
    }
    pos.needsUpdate = true
  })

  return (
    <points ref={ref} geometry={geom} frustumCulled={false}>
      <pointsMaterial
        color={COLORS.paleHalo}
        size={0.06}
        sizeAttenuation
        transparent
        opacity={0.3}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </points>
  )
}

// ---------------------------------------------------------------------------
// Bullet-lunge holo marker (B3 prompt) — additive gold diamond + ring
// ---------------------------------------------------------------------------
function HoloMarker() {
  const g = useRef<THREE.Group>(null!)
  useFrame((state) => {
    const t = state.clock.elapsedTime
    g.current.rotation.y = t * 1.2
    g.current.position.y = 10 + Math.sin(t * 1.6) * 0.4
  })
  return (
    <group ref={g} position={[0, 10, 117]}>
      <mesh geometry={OCTA} scale={[0.7, 1, 0.7]}>
        <meshBasicMaterial
          color={COLORS.aureate}
          toneMapped={false}
          transparent
          opacity={0.85}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
      <mesh geometry={RING_GEO} rotation={[Math.PI / 2, 0, 0]} scale={[1.4, 1.4, 8]}>
        <meshBasicMaterial color={COLORS.aureate} toneMapped={false} transparent opacity={0.5} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
    </group>
  )
}

// ---------------------------------------------------------------------------
// Floating debris in the void (parallax depth) — instanced, slow bob/orbit
// ---------------------------------------------------------------------------
const DEBRIS_COUNT = 46
const _debM = new THREE.Matrix4()
const _debQ = new THREE.Quaternion()
const _debE = new THREE.Euler()
const _debV = new THREE.Vector3()
const _debS = new THREE.Vector3()

function DebrisField() {
  const ref = useRef<THREE.InstancedMesh>(null!)
  const seeds = useMemo(() => {
    const out: { p: THREE.Vector3; s: number; ph: number; rs: number }[] = []
    for (let i = 0; i < DEBRIS_COUNT; i++) {
      const east = i % 3 !== 0 // 2/3 east of canyon, 1/3 around the bridge void
      const p = east
        ? new THREE.Vector3(14 + Math.random() * 46, -13 + Math.random() * 16, 10 + Math.random() * 130)
        : new THREE.Vector3(-30 + Math.random() * 60, -14 + Math.random() * 10, 225 + Math.random() * 45)
      out.push({ p, s: 0.5 + Math.random() * 1.7, ph: Math.random() * Math.PI * 2, rs: 0.2 + Math.random() * 0.6 })
    }
    return out
  }, [])

  useFrame((state) => {
    const t = state.clock.elapsedTime
    const mesh = ref.current
    for (let i = 0; i < seeds.length; i++) {
      const d = seeds[i]
      _debV.set(d.p.x + Math.sin(t * 0.12 + d.ph) * 1.5, d.p.y + Math.sin(t * 0.3 + d.ph) * 0.8, d.p.z + Math.cos(t * 0.1 + d.ph) * 1.5)
      _debE.set(t * d.rs * 0.4, t * d.rs, d.ph)
      _debQ.setFromEuler(_debE)
      _debS.setScalar(d.s)
      _debM.compose(_debV, _debQ, _debS)
      mesh.setMatrixAt(i, _debM)
    }
    mesh.instanceMatrix.needsUpdate = true
  })

  return (
    <instancedMesh ref={ref} args={[ROCK, undefined, DEBRIS_COUNT]} frustumCulled={false}>
      <primitive object={rockMaterial()} attach="material" />
    </instancedMesh>
  )
}

// ---------------------------------------------------------------------------
// Zone C — Objective Chamber (z 135–165): domed rotunda + Null Reliquary
// ---------------------------------------------------------------------------
const C_RIBS: InstItem[] = []
for (let i = 0; i < 8; i++) C_RIBS.push({ p: [0, 0, 150], r: [0, (i / 8) * Math.PI, 0] })

const C_WALLS: BoxSpec[] = [
  { x0: -15, y0: 0, z0: 134, x1: -3, y1: 10, z1: 135 },
  { x0: 3, y0: 0, z0: 134, x1: 15, y1: 10, z1: 135 },
  { x0: -15, y0: 0, z0: 165, x1: -3, y1: 10, z1: 166 },
  { x0: 3, y0: 0, z0: 165, x1: 15, y1: 10, z1: 166 },
  { x0: 15, y0: 0, z0: 135, x1: 16, y1: 10, z1: 165 },
  { x0: -16, y0: 0, z0: 135, x1: -15, y1: 10, z1: 165 },
]
/**
 * R4 — the chamber wall field is set back into its own thickness for the same
 * reason the arena's is (see WALL_RECESS): the bays become real recesses that
 * the screens hang in front of, and the dado / attic bands that stay at the
 * face give the wall three registers instead of one 10 m plane. Outward only —
 * the chamber's collider boxes in layout.ts are untouched.
 */
const C_WALL_FIELD: BoxSpec[] = [
  { x0: -15, y0: 0, z0: 134, x1: -3, y1: 10, z1: 135 - 0.42 },
  { x0: 3, y0: 0, z0: 134, x1: 15, y1: 10, z1: 135 - 0.42 },
  { x0: -15, y0: 0, z0: 165 + 0.42, x1: -3, y1: 10, z1: 166 },
  { x0: 3, y0: 0, z0: 165 + 0.42, x1: 15, y1: 10, z1: 166 },
  { x0: 15 + 0.42, y0: 0, z0: 135, x1: 16, y1: 10, z1: 165 },
  { x0: -16, y0: 0, z0: 135, x1: -15 - 0.42, y1: 10, z1: 165 },
]
/** chamber dado / attic bands + piers, standing at the original wall face */
const C_WALL_DADO: InstItem[] = []
const C_WALL_ATTIC: InstItem[] = []
const C_WALL_PIER: InstItem[] = []
{
  const R = 0.42
  for (const sx of [1, -1]) {
    C_WALL_DADO.push({ p: [sx * (15 + R / 2), 1.1, 150], s: [R, 2.2, 30] })
    C_WALL_ATTIC.push({ p: [sx * (15 + R / 2), 9.3, 150], s: [R, 1.4, 30] })
    for (const z of [141, 147.5, 152.5, 159]) {
      C_WALL_PIER.push({ p: [sx * (15 + R / 2), 5.7, z], s: [R, 6.9, 2.5] })
    }
  }
  for (const [wz, face] of [[135, -1], [165, 1]] as [number, number][]) {
    for (const s of [1, -1]) {
      const x0 = s > 0 ? 3 : -15
      const x1 = s > 0 ? 15 : -3
      C_WALL_DADO.push({ p: [(x0 + x1) / 2, 1.1, wz + face * (R / 2)], s: [x1 - x0, 2.2, R] })
      C_WALL_ATTIC.push({ p: [(x0 + x1) / 2, 9.3, wz + face * (R / 2)], s: [x1 - x0, 1.4, R] })
    }
    for (const x of [-9, 9]) {
      C_WALL_PIER.push({ p: [x, 5.7, wz + face * (R / 2)], s: [2.5, 6.9, R] })
    }
  }
}

/** dark plinth course at the foot of every chamber/arena wall — the contact
 *  line that keeps 10 m walls from floating on the floor */
const C_BASE: InstItem[] = [
  { p: [0, 0.35, 135.2], s: [30, 0.7, 0.45] },
  { p: [0, 0.35, 164.8], s: [30, 0.7, 0.45] },
  { p: [14.8, 0.35, 150], s: [0.45, 0.7, 30] },
  { p: [-14.8, 0.35, 150], s: [0.45, 0.7, 30] },
]
const D_BASE: InstItem[] = [
  { p: [0, 0.4, 165.2], s: [60, 0.8, 0.5] },
  { p: [0, 0.4, 224.8], s: [60, 0.8, 0.5] },
  { p: [29.8, 0.4, 195], s: [0.5, 0.8, 60] },
  { p: [-29.8, 0.4, 195], s: [0.5, 0.8, 60] },
]
const C_CORNICE: InstItem[] = [
  { p: [-14.8, 9.5, 150], s: [1, 1, 29.6] },
  { p: [14.8, 9.5, 150], r: [0, Math.PI, 0], s: [1, 1, 29.6] },
]
const C_WALL_TRIM: InstItem[] = []
for (const w of C_WALLS) {
  const c = boxCenter(w)
  const s = boxSize(w)
  C_WALL_TRIM.push({ p: [c[0], 10.1, c[2]], s: [Math.max(s[0], 0.4), 0.2, Math.max(s[2], 0.4)] })
}

/** teal practical fixtures in the chamber (Lighting reads these) */
const C_TEAL_FIXTURES: [number, number, number][] = []

// chamber wall detail: gold pilasters, obsidian panel-line bands, teal insets
const C_WALL_PILASTERS: InstItem[] = []
const C_WALL_BANDS: InstItem[] = []
const C_WALL_INSETS: InstItem[] = []
for (const x of [-9, 0, 9]) {
  if (x !== 0) {
    C_WALL_PILASTERS.push({ p: [x, 5, 135.09], s: [0.5, 10, 0.16] }) // south face
    C_WALL_PILASTERS.push({ p: [x, 5, 164.91], s: [0.5, 10, 0.16] }) // north face
  }
}
for (const z of [141, 147.5, 152.5, 159]) {
  C_WALL_PILASTERS.push({ p: [14.91, 5, z], s: [0.16, 10, 0.5] }) // east face
  C_WALL_PILASTERS.push({ p: [-14.91, 5, z], s: [0.16, 10, 0.5] }) // west face
}
// horizontal panel lines at chair-rail and cornice height (split around the petal gate)
for (const y of [7.4, 2.2]) {
  for (const cx of [-9, 9]) {
    C_WALL_BANDS.push({ p: [cx, y, 135.06], s: [12, y > 5 ? 0.4 : 0.3, 0.1] })
    C_WALL_BANDS.push({ p: [cx, y, 164.94], s: [12, y > 5 ? 0.4 : 0.3, 0.1] })
  }
}
C_WALL_BANDS.push({ p: [14.94, 7.4, 150], s: [0.1, 0.4, 30] })
C_WALL_BANDS.push({ p: [-14.94, 7.4, 150], s: [0.1, 0.4, 30] })
// teal vein insets between pilasters — halved, each in a recessed channel
const C_WALL_CHANNEL: InstItem[] = []
const C_WALL_FRET: InstItem[] = []
const C_FLOOR_UMBER: InstItem[] = []
for (const z of [144.5]) {
  for (const sx of [1, -1]) {
    C_WALL_INSETS.push({ p: [sx * 14.93, 3.4, z + (sx > 0 ? 0 : 11)], s: [0.08, 4.6, 0.22] })
    C_WALL_CHANNEL.push({ p: [sx * 14.88, 3.4, z + (sx > 0 ? 0 : 11)], s: [0.1, 5.3, 0.6] })
    C_TEAL_FIXTURES.push([sx * 14.4, 3.4, z + (sx > 0 ? 0 : 11)])
  }
}
// R3 — engaged fluted colonnade on the chamber walls (see D_COLUMN)
const C_COLUMN: InstItem[] = []
const C_COLUMN_PLINTH: InstItem[] = []
const C_COLUMN_CAP: InstItem[] = []
const C_COLUMN_NECK: InstItem[] = []
for (const x of [-9, 9]) {
  for (const [zc, face] of [[135.55, 1], [164.45, -1]] as [number, number][]) {
    C_COLUMN.push({ p: [x, 5, zc], s: [0.58, 1.05, 0.58] })
    C_COLUMN_PLINTH.push({ p: [x, 0.42, zc - face * 0.15], s: [1.45, 0.84, 1.4] })
    C_COLUMN_CAP.push({ p: [x, 9.72, zc - face * 0.15], s: [1.5, 0.42, 1.4] })
    C_COLUMN_NECK.push({ p: [x, 8.62, zc - face * 0.05], s: [1.16, 0.16, 1.1] })
  }
}
for (const z of [141, 147.5, 152.5, 159]) {
  for (const sx of [1, -1]) {
    C_COLUMN.push({ p: [sx * 14.45, 5, z], s: [0.58, 1.05, 0.58] })
    C_COLUMN_PLINTH.push({ p: [sx * 14.6, 0.42, z], s: [1.4, 0.84, 1.45] })
    C_COLUMN_CAP.push({ p: [sx * 14.6, 9.72, z], s: [1.4, 0.42, 1.5] })
    C_COLUMN_NECK.push({ p: [sx * 14.5, 8.62, z], s: [1.1, 0.16, 1.16] })
  }
}

// R3 — shadow gaps flanking every chamber pilaster (see D_PILASTER_FLANK)
const C_PILASTER_FLANK: InstItem[] = []
for (const x of [-9, 9]) {
  for (const dx of [-0.36, 0.36]) {
    C_PILASTER_FLANK.push({ p: [x + dx, 5, 135.16], s: [0.12, 9.6, 0.14] })
    C_PILASTER_FLANK.push({ p: [x + dx, 5, 164.84], s: [0.12, 9.6, 0.14] })
  }
}
for (const z of [141, 147.5, 152.5, 159]) {
  for (const dz of [-0.36, 0.36]) {
    C_PILASTER_FLANK.push({ p: [14.84, 5, z + dz], s: [0.14, 9.6, 0.12] })
    C_PILASTER_FLANK.push({ p: [-14.84, 5, z + dz], s: [0.14, 9.6, 0.12] })
  }
}

// filigree course running the length of both long walls
for (const sx of [1, -1]) {
  C_WALL_FRET.push({ p: [sx * 14.86, 5.6, 150], r: [0, sx * Math.PI / 2, 0], s: [28, 0.55, 1] })
}
// umber floor course: a border frame around the Reliquary plaza, leaving the
// obsidian centre to read dark (a full field just turned the floor brown)
for (const dz of [-10.5, 10.5]) C_FLOOR_UMBER.push({ p: [0, 0.004, 150 + dz], s: [22, 0.008, 1.8] })
for (const dx of [-10.5, 10.5]) C_FLOOR_UMBER.push({ p: [dx, 0.004, 150], s: [1.8, 0.008, 22] })

// ---------------------------------------------------------------------------
// R2 chamber ornament: pierced screens on the long spans, a coffered upper
// register, a gold L-angle at every floor-to-wall joint, and corbel brackets
// under the cornice.
//
// The junction trim matters more than it sounds: before this, floors met walls
// on a bare 90° corner, which is a junction only a blockout has. A real
// building covers that joint with a machined angle, and the 2 cm highlight
// along it is what tells the eye the two surfaces are different materials.
// ---------------------------------------------------------------------------
const C_SCREENS: InstItem[] = []
const C_SCREEN_BACK: InstItem[] = []
const C_COFFERS: InstItem[] = []
const C_COFFER_BACK: InstItem[] = []
const C_CORBELS: InstItem[] = []
const C_PILASTER_NOSING: InstItem[] = []
const C_PILASTER_NOSING_LIP: InstItem[] = []
for (const sx of [1, -1]) {
  for (const z of [138.5, 145, 155, 161.5]) {
    // lower register: pierced screen over a black recess
    // The bay is built OUT, not cut in (the wall is a solid box), so the
    // whole composition has to stay inside the depth the pilasters already
    // establish — 0.17 — or the screens read as panels leaning on the wall.
    // Backing plate is flush to the wall face; screen sits 0.24 proud of it.
    C_SCREEN_BACK.push({ p: [sx * 14.9, 3.3, z], s: [0.22, 4.6, 5.2] })
    C_SCREENS.push({ p: [sx * 14.76, 3.3, z], r: [0, sx * Math.PI / 2, 0], s: [5.0, 4.4, 1] })
    // upper register: coffer panel, punched centre, over the same black
    C_COFFER_BACK.push({ p: [sx * 14.9, 7.9, z], s: [0.22, 2.6, 3.0] })
    C_COFFERS.push({ p: [sx * 14.76, 7.9, z], r: [0, sx * Math.PI / 2, 0], s: [2.8, 2.4, 1] })
  }
  for (const z of [141, 147.5, 152.5, 159]) {
    // modelled gold nosing down the face of every pilaster: a stepped shaft
    // plus a narrow proud lip, so the pilaster has an edge that catches the
    // key instead of being a flat gold rectangle painted on the wall
    C_PILASTER_NOSING.push({ p: [sx * 14.74, 5, z], s: [0.2, 9.6, 0.34] })
    C_PILASTER_NOSING_LIP.push({ p: [sx * 14.62, 5, z], s: [0.1, 9.6, 0.17] })
  }
  for (let z = 137; z <= 163; z += 3.25) {
    C_CORBELS.push({ p: [sx * 14.5, 8.85, z], s: [1.1, 0.6, 1.1] })
  }
}
/** R4 — per-instance jitter on the chamber's 18-block corbel course */
const C_CORBELS_J = jitterItems(C_CORBELS, { yaw: 0.08, scale: 0.08, lift: 0.055, salt: 11 })

/** gold L-angle around the chamber floor/wall joint: [pos, yaw, length] */
const C_LTRIM: InstItem[] = [
  { p: [-14.98, 0.005, 150], r: [0, 0, 0], s: [1, 1, 29.6] },
  { p: [14.98, 0.005, 150], r: [0, Math.PI, 0], s: [1, 1, 29.6] },
  { p: [0, 0.005, 135.02], r: [0, -Math.PI / 2, 0], s: [1, 1, 29.6] },
  { p: [0, 0.005, 164.98], r: [0, Math.PI / 2, 0], s: [1, 1, 29.6] },
]
/** plinth-height fret course, under the screens */
const C_FRET_PLINTH: InstItem[] = []
for (const sx of [1, -1]) {
  C_FRET_PLINTH.push({ p: [sx * 14.83, 1.15, 150], r: [0, sx * Math.PI / 2, 0], s: [28, 0.42, 1] })
}

// 6 floor sockets + vein cables to the Reliquary
const C_SOCKETS: InstItem[] = []
for (let i = 0; i < 6; i++) {
  const a = (i / 6) * Math.PI * 2
  C_SOCKETS.push({ p: [Math.cos(a) * 6, 0.12, 150 + Math.sin(a) * 6], s: [0.45, 0.25, 0.45] })
}

// teal vein clusters at the chamber wall base
const C_VEINS: InstItem[] = []
for (const [vx, vz] of [
  [-14.4, 142],
  [14.4, 158],
  [-14.4, 158],
  [14.4, 142],
] as [number, number][]) {
  for (let i = 0; i < 5; i++) {
    C_VEINS.push({
      p: [vx + (Math.random() - 0.5) * 1.2, 0.8 + i * 0.55, vz + (Math.random() - 0.5) * 1.6],
      r: [(Math.random() - 0.5) * 0.7, 0, (Math.random() - 0.5) * 0.7],
      s: [0.08, 1.4, 0.08],
    })
  }
}

function ReliquaryCables() {
  const geoms = useMemo(() => {
    const out: THREE.TubeGeometry[] = []
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2
      const sx = Math.cos(a) * 6
      const sz = 150 + Math.sin(a) * 6
      const curve = new THREE.QuadraticBezierCurve3(
        new THREE.Vector3(sx, 0.3, sz),
        new THREE.Vector3(sx * 0.45, 2.6, 150 + (sz - 150) * 0.45),
        new THREE.Vector3(0, 3.2, 150),
      )
      out.push(new THREE.TubeGeometry(curve, 16, 0.06, 6))
    }
    return out
  }, [])
  return (
    <group>
      {geoms.map((g, i) => (
        <mesh key={i} geometry={g} material={purifyVeinMaterial()} />
      ))}
    </group>
  )
}

/** The Null Reliquary — floating obsidian icosahedron in a petal cradle. */
function Reliquary() {
  const g = useRef<THREE.Group>(null!)
  useFrame((state) => {
    const t = state.clock.elapsedTime
    g.current.position.y = RELIQUARY_POSITION.y + Math.sin(t * 0.8) * 0.25
    g.current.rotation.y = t * 0.25
  })
  return (
    <group>
      <group ref={g} position={RELIQUARY_POSITION.toArray()}>
        <mesh geometry={ICOSA} material={obsidianMaterial()} castShadow />
        <mesh geometry={ICOSA_INNER} material={purifyVeinMaterial()} />
      </group>
      {/* petal rosette cradle */}
      <Instanced geometry={PETAL} material={goldMaterial()} items={C_CRADLE} />
      <Instanced geometry={PETAL} material={ivoryMaterial()} items={C_CRADLE_OUTER} />
    </group>
  )
}
const C_CRADLE = rosette(0, 1.5, 150, 1.6, 8, -0.5, [0.8, 1, 0.8])
const C_CRADLE_OUTER = rosette(0, 1.1, 150, 2.4, 8, -0.9, [1.1, 1.2, 1.1])

/**
 * R5 — the votive krater.
 *
 * What this replaced: `RBOX` scaled [2, 1, 2] in `ivoryMaterial`, i.e. a pale
 * chamfered cube with a gold slab on top. It is the "untextured white prop"
 * the R5 panel called out in 11_ability_dash, and it deserved the note — a
 * 2 m box at 1 m tall stands exactly at the near plane of a third-person
 * combat shot, so it is one of the few pieces of level dressing the camera
 * ever gets close enough to read, and there was nothing on it to read.
 *
 * Eight of these exist (four in the chamber, four in the arena) and they sit
 * on a 2 x 1.1 x 2 collider from `layout.ts` that must not move. So the fix is
 * entirely inside that footprint: a lathed krater section — square plinth,
 * cast-gold torus at the foot, a scotia, an ogee body swelling to r 0.88, a
 * necking bead and a flared lip — with two cast ears breaking the silhouette
 * and the planting sunk in a dark bowl rather than glowing off a flat disc.
 * Nothing here projects past |x - cx| = 0.93 or rises above y 1.06, both
 * inside the AABB, so collision is bit-identical to before.
 */
const KRATER_PROFILE: [number, number][] = [
  [0.26, 0.40],
  [0.315, 0.47],
  [0.355, 0.415],
  [0.40, 0.445],
  [0.45, 0.545],
  [0.55, 0.675],
  [0.66, 0.775],
  [0.75, 0.838],
  [0.82, 0.872],
  [0.875, 0.878],
  [0.905, 0.848],
  [0.925, 0.862],
  [0.965, 0.912],
  [1.015, 0.925],
  [1.045, 0.892],
]
const KRATER_BOWL = bakeContactAO(latheProfile(KRATER_PROFILE, 30), 0.26, 0.66, 0.40)
/** chunky bead torus, unit radius — scale sets both radius and tube */
const BEAD_RING = new THREE.TorusGeometry(1, 0.05, 8, 44)
/** the two cast ears, as local offsets from the krater axis */
const KRATER_EARS: { p: [number, number, number]; r: [number, number, number]; s: [number, number, number] }[] = [
  { p: [0.78, 0.66, 0], r: [0, 0, -0.22], s: [0.3, 0.46, 0.17] },
  { p: [-0.78, 0.66, 0], r: [0, 0, 0.22], s: [0.3, 0.46, 0.17] },
]

function Planter({ x, z, purify }: { x: number; z: number; purify?: boolean }) {
  const petals = useMemo(() => rosette(x, 1.1, z, 0.56, 8, -0.5, [0.42, 0.7, 0.42]), [x, z])
  const ears = useMemo(
    () => KRATER_EARS.map((e) => ({ p: [x + e.p[0], e.p[1], z + e.p[2]] as [number, number, number], r: e.r, s: e.s })),
    [x, z],
  )
  return (
    <group>
      {/* square plinth + gold foot-ring: the krater stands ON something */}
      <mesh geometry={PLINTH_BOX} material={umberMaterial()} position={[x, 0.13, z]} scale={[1.96, 0.26, 1.96]} receiveShadow castShadow />
      <mesh geometry={RBOX} material={goldCastMaterial()} position={[x, 0.295, z]} scale={[1.66, 0.1, 1.66]} receiveShadow castShadow />
      {/* the lathed body */}
      <mesh geometry={KRATER_BOWL} material={ivoryContactMaterial()} position={[x, 0, z]} receiveShadow castShadow />
      {/* necking bead + flared lip ring */}
      <mesh geometry={BEAD_RING} material={goldPolishedMaterial()} position={[x, 0.895, z]} rotation={[-Math.PI / 2, 0, 0]} scale={[0.855, 0.855, 0.7]} />
      <mesh geometry={BEAD_RING} material={goldCastMaterial()} position={[x, 1.028, z]} rotation={[-Math.PI / 2, 0, 0]} scale={[0.93, 0.93, 0.9]} receiveShadow castShadow />
      {/* cast ears — the silhouette breakers */}
      <Instanced geometry={RBOX} material={goldCastMaterial()} items={ears} castShadow />
      {/* the planting sits in a dark bowl, not on a lit lid */}
      <mesh geometry={CIRCLE} material={recessMaterial()} position={[x, 0.995, z]} rotation={[-Math.PI / 2, 0, 0]} scale={[0.87, 0.87, 1]} receiveShadow />
      <Instanced geometry={PETAL} material={goldMaterial()} items={petals} castShadow />
      <mesh
        geometry={CIRCLE}
        material={purify ? purifyVeinMaterial() : veinTealMaterial()}
        position={[x, 1.012, z]}
        rotation={[-Math.PI / 2, 0, 0]}
        scale={[0.5, 0.5, 1]}
      />
    </group>
  )
}

// ---------------------------------------------------------------------------
// R3 — the chamber dome is coffered.
//
// It was a bare 18 m BackSide hemisphere crossed by 8 smooth meridians: a
// single soft gradient over a third of the frame. The cage is now 16 ribs
// (8 heavy + 8 half-step slender) tied by four square-section ring bands with
// a cast gold boss at every crossing — the ornament grid that makes a dome
// read as built. Square section matters: it is the only one that self-shadows.
// ---------------------------------------------------------------------------
const C_RIBS_FINE: InstItem[] = []
for (let i = 0; i < 8; i++) C_RIBS_FINE.push({ p: [0, 0, 150], r: [0, ((i + 0.5) / 8) * Math.PI, 0] })
const C_DOME_BOSS: InstItem[][] = DOME_BAND_Y.map((y) => {
  const out: InstItem[] = []
  const r = domeBandRadius(y) - 0.12
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2
    out.push({
      p: [Math.cos(a) * r, y, 150 + Math.sin(a) * r],
      r: [0, Math.PI / 2 - a, 0],
      s: [0.3, 0.42, 0.22],
    })
  }
  return out
})
const C_DOME_BOSS_ALL: InstItem[] = C_DOME_BOSS.flat()
/** chamber pendants, hung off the rib cage at the four quarter points */
const C_PENDANT_POS: [number, number, number][] = [
  [-9.5, 7.2, 143],
  [9.5, 7.2, 143],
  [-9.5, 7.2, 157],
  [9.5, 7.2, 157],
]
const C_PENDANT_ROD: InstItem[] = C_PENDANT_POS.map(([x, y, z]) => {
  const top = Math.sqrt(Math.max(1, 14 * 14 - x * x - (z - 150) * (z - 150)))
  const len = Math.max(0.5, top - y)
  return { p: [x, y + len / 2, z] as [number, number, number], s: [1, len, 1] as [number, number, number] }
})
const C_PENDANT_HOOD: InstItem[] = C_PENDANT_POS.map(([x, y, z]) => ({
  p: [x, y, z] as [number, number, number],
  s: [1.25, 1.25, 1.25] as [number, number, number],
}))
const C_PENDANT_COLLAR: InstItem[] = C_PENDANT_POS.map(([x, y, z]) => ({
  p: [x, y + 0.4, z] as [number, number, number],
  s: [1.2, 1.2, 1.2] as [number, number, number],
}))
const C_PENDANT_LENS: InstItem[] = C_PENDANT_POS.map(([x, y, z]) => ({
  p: [x, y - 0.38, z] as [number, number, number],
  s: [1, 0.75, 1] as [number, number, number],
}))

function ZoneC() {
  // BackSide clone of the CONTACT ivory: the dome carries a baked springing
  // gradient (DOME_AO) so the vault has a dark ring where it meets the walls.
  // Cloning preserves onBeforeCompile/customProgramCacheKey, so it still gets
  // the world-space trim projection and the detail normal layer.
  const domeMat = useMemo(() => {
    const m = ivoryContactMaterial().clone()
    m.side = THREE.BackSide
    return m
  }, [])
  return (
    <group>
      {/* floor + gold edge trim (0.02 m proud insets + edge highlight, fix2) */}
      <MassMesh spec={{ x0: -15, y0: -1, z0: 135, x1: 15, y1: 0, z1: 165 }} material={floorMaterial()} />
      <mesh geometry={BOX} material={goldMaterial()} position={[0, 0.01, 135.22]} scale={[29.8, 0.02, 0.16]} />
      <mesh geometry={BOX} material={goldMaterial()} position={[0, 0.01, 164.78]} scale={[29.8, 0.02, 0.16]} />
      <mesh geometry={BOX} material={goldEdgeMaterial()} position={[0, 0.022, 135.33]} scale={[29.8, 0.006, 0.035]} />
      <mesh geometry={BOX} material={goldEdgeMaterial()} position={[0, 0.022, 164.67]} scale={[29.8, 0.006, 0.035]} />
      <Instanced geometry={BOX} material={umberMaterial()} items={C_FLOOR_UMBER} receiveShadow />
      <Instanced geometry={BOX} material={recessMaterial()} items={C_PAVING} />

      {/* dome + oculus */}
      <mesh geometry={DOME_AO} material={domeMat} position={[0, 0, 150]} receiveShadow />
      <mesh geometry={RING_GEO} material={goldMaterial()} position={[0, 17.6, 150]} rotation={[Math.PI / 2, 0, 0]} scale={[3.1, 3.1, 14]} />
      <mesh position={[0, 17.75, 150]} rotation={[Math.PI / 2, 0, 0]} geometry={CIRCLE} scale={[2.7, 2.7, 1]}>
        <meshBasicMaterial color={SOLAR_HOT} toneMapped={false} />
      </mesh>

      {/* radial arch-rib cage — gold moulding run along every rib */}
      <Instanced
        geometry={RIB_CHAMBER_AO}
        material={ivoryContactMaterial()}
        items={C_RIBS}
        receiveShadow
        castShadow
      />
      <Instanced geometry={ARCH_TRIM_CHAMBER} material={goldMaterial()} items={C_RIBS} />
      {/* R3 — half-step meridians + square-section ring bands + gold bosses:
          a 16-rib coffering grid over the whole vault */}
      <Instanced
        geometry={RIB_CHAMBER_FINE_AO}
        material={ivoryContactMaterial()}
        items={C_RIBS_FINE}
        castShadow
      />
      {DOME_BANDS.map((g, i) => (
        <mesh
          key={i}
          geometry={g}
          material={ivoryMaterial()}
          position={[0, DOME_BAND_Y[i], 150]}
          rotation={[-Math.PI / 2, 0, Math.PI / 4]}
          castShadow
          receiveShadow
        />
      ))}
      <Instanced geometry={OCTA} material={goldPolishedMaterial()} items={C_DOME_BOSS_ALL} />
      {/* pendant lamps off the rib cage */}
      <Instanced geometry={PENDANT_ROD} material={goldMaterial()} items={C_PENDANT_ROD} castShadow />
      <Instanced geometry={PENDANT_HOOD} material={goldCastMaterial()} items={C_PENDANT_HOOD} castShadow />
      <Instanced geometry={PENDANT_COLLAR} material={goldPolishedMaterial()} items={C_PENDANT_COLLAR} />
      <Instanced geometry={PENDANT_LENS} material={veinGoldMaterial()} items={C_PENDANT_LENS} />

      {/* perimeter walls + trim + panel detail. R2: the walls are drawn with
          the subdivided PANEL_BOX and the contact-AO ivory, so a 10 m wall has
          a grounded dark band at its foot even with the SSAO pass off — and
          they cast, so the colonnade finally throws shadows across the floor. */}
      {C_WALL_FIELD.map((w, i) => (
        <MassMesh
          key={i}
          spec={w}
          geometry={PANEL_BOX}
          material={ivoryContactMaterial()}
          castShadow
        />
      ))}
      {/* R4 — dado, piers and attic band at the original face, so the bays
          between them are real 0.42 m recesses rather than appliqué */}
      <Instanced geometry={PLINTH_BOX} material={ivoryContactMaterial()} items={C_WALL_DADO} castShadow />
      <Instanced geometry={PANEL_BOX} material={ivoryContactMaterial()} items={C_WALL_PIER} castShadow />
      <Instanced geometry={PANEL_BOX} material={ivoryContactMaterial()} items={C_WALL_ATTIC} castShadow />
      <Instanced geometry={RBOX} material={umberMaterial()} items={C_BASE} receiveShadow />
      <Instanced geometry={TRIM_RUN} material={goldMaterial()} items={C_CORNICE} />
      <Instanced geometry={BOX} material={goldMaterial()} items={C_WALL_TRIM} />
      <Instanced geometry={BOX} material={goldMaterial()} items={C_WALL_PILASTERS} />
      <Instanced geometry={BOX} material={goldMaterial()} items={C_PILASTER_NOSING} />
      <Instanced geometry={BOX} material={goldEdgeMaterial()} items={C_PILASTER_NOSING_LIP} />
      <Instanced geometry={BOX} material={recessMaterial()} items={C_WALL_BANDS} />
      <Instanced geometry={BOX} material={recessMaterial()} items={C_PILASTER_FLANK} />
      {/* engaged fluted colonnade */}
      <Instanced geometry={PLINTH_BOX} material={ivoryContactMaterial()} items={C_COLUMN_PLINTH} castShadow />
      <Instanced geometry={COLUMN_ENGAGED} material={ivoryMaterial()} items={C_COLUMN} castShadow />
      <Instanced geometry={TRIM_RUN_FINE} material={goldPolishedMaterial()} items={C_COLUMN_NECK} />
      <Instanced geometry={RBOX} material={goldCastMaterial()} items={C_COLUMN_CAP} castShadow />
      <Instanced geometry={FRET_PANEL} material={fretTrimMaterial()} items={C_WALL_FRET} />
      <Instanced geometry={FRET_PANEL} material={fretTrimMaterial()} items={C_FRET_PLINTH} />
      <Instanced geometry={BOX} material={recessMaterial()} items={C_WALL_CHANNEL} />
      <Instanced geometry={BOX} material={veinTealMaterial()} items={C_WALL_INSETS} />

      {/* R2 ornament: pierced screens (lower register) and coffers (upper),
          both on a recess-black backing so the holes read as true darks */}
      <Instanced geometry={BOX} material={recessMaterial()} items={C_SCREEN_BACK} />
      <Instanced geometry={SCREEN_WIDE} material={screenMaterial()} items={C_SCREENS} castShadow />
      <Instanced geometry={BOX} material={recessMaterial()} items={C_COFFER_BACK} />
      <Instanced geometry={COFFER_PANEL} material={cofferMaterial()} items={C_COFFERS} castShadow />
      {/* gold L-angle covering every floor-to-wall joint */}
      <Instanced geometry={L_TRIM_RUN} material={goldMaterial()} items={C_LTRIM} />
      {/* corbel brackets under the cornice — upper-corner framing mass */}
      <Instanced geometry={RBOX} material={ivoryMaterial()} items={C_CORBELS_J} castShadow />

      {/* teal vein clusters + corruption glyphs */}
      <Instanced geometry={BOX} material={veinTealMaterial()} items={C_VEINS} />
      <mesh geometry={PLANE} material={glyphDecalMaterial()} position={[-14.92, 2.4, 142]} rotation={[0, Math.PI / 2, 0]} scale={[2.4, 2.4, 1]} />
      <mesh geometry={PLANE} material={glyphDecalMaterial()} position={[14.92, 2.4, 158]} rotation={[0, -Math.PI / 2, 0]} scale={[2.4, 2.4, 1]} />

      {/* sockets + cables + Reliquary */}
      <Instanced geometry={CYL} material={goldMaterial()} items={C_SOCKETS} />
      <ReliquaryCables />
      <Reliquary />

      {/* cover planters */}
      {CHAMBER_PLANTERS.map(([px, pz]) => (
        <Planter key={`${px},${pz}`} x={px} z={pz} purify />
      ))}
    </group>
  )
}

// ---------------------------------------------------------------------------
// Zone D — Combat Arena (z 165–225): 60×60 grand hall, two levels
// ---------------------------------------------------------------------------
const D_RIBS: InstItem[] = []
for (let z = 170; z <= 220; z += 10) D_RIBS.push({ p: [0, 0, z] })

const D_WALLS: BoxSpec[] = [
  { x0: -30, y0: 0, z0: 164, x1: -3, y1: 10, z1: 165 },
  { x0: 3, y0: 0, z0: 164, x1: 30, y1: 10, z1: 165 },
  { x0: -30, y0: 0, z0: 225, x1: -4, y1: 10, z1: 226 },
  { x0: 4, y0: 0, z0: 225, x1: 30, y1: 10, z1: 226 },
  { x0: 30, y0: 0, z0: 165, x1: 31, y1: 10, z1: 225 },
  { x0: -31, y0: 0, z0: 165, x1: -30, y1: 10, z1: 225 },
  // lintels over the south/north gate openings
  { x0: -3, y0: 8, z0: 164, x1: 3, y1: 10, z1: 165 },
  { x0: -4, y0: 8, z0: 225, x1: 4, y1: 10, z1: 226 },
]
const D_WALL_TRIM: InstItem[] = []
for (const w of D_WALLS) {
  const c = boxCenter(w)
  const s = boxSize(w)
  D_WALL_TRIM.push({ p: [c[0], 10.1, c[2]], s: [Math.max(s[0], 0.4), 0.2, Math.max(s[2], 0.4)] })
}

// ---------------------------------------------------------------------------
// R4 — the arena wall gets a RHYTHM and three REGISTERS.
//
// Two separate faults produced "one panel stamped in a perfect 20×8 grid":
//
//  1. Every applied element sat on the same 6 m metronome, on all four walls,
//     mirrored left to right. A hall whose every bay is identical and whose
//     two long walls are reflections of each other cannot read as architecture
//     no matter how good the trim on any one bay is.
//  2. The wall FIELD was flush with the face, so the ornament was a layer of
//     appliqué on an unbroken 60 m plane with nothing behind it to shadow into.
//
// The fix for (1) is a coupled rhythm — columns in tight pairs, pair spacing
// irregular, with ONE deliberately wide bay off-centre — and a different run
// on each of the four walls, so no two walls in frame repeat each other.
//
// The fix for (2) is that the wall field is now pushed 0.5 m OUTWARD into the
// wall's own thickness. Nothing moves inward, so no surface the player can
// touch changes and `buildLevelColliders` is untouched: the bays simply become
// real 0.5 m recesses between piers that stay at the original face. That gives
// three registers — a solid dado to 2.3 m, the recessed bay order to 8.6 m,
// and a solid attic/clerestory band up to the cornice — which is what the work
// order asked for and what self-shadows under a low key.
// ---------------------------------------------------------------------------
const WALL_RECESS = ARENA_WALL_RECESS
const DADO_TOP = ARENA_DADO_TOP
const ATTIC_BOT = 8.6

/** pair centres — deliberately unequal, and different on all four walls.
 *  Authored in layout.ts beside the collider table it must stay clear of. */
const D_PAIR_W = ARENA_BAY_PAIRS.west as readonly number[] as number[]
const D_PAIR_E = ARENA_BAY_PAIRS.east as readonly number[] as number[]
const D_PAIR_S = ARENA_BAY_PAIRS.south as readonly number[] as number[]
const D_PAIR_N = ARENA_BAY_PAIRS.north as readonly number[] as number[]
const PAIR_GAP = ARENA_PAIR_GAP

const D_COL_Z_W = coupledRun(D_PAIR_W, PAIR_GAP)
const D_COL_Z_E = coupledRun(D_PAIR_E, PAIR_GAP)
const D_COL_X_S = coupledRun(D_PAIR_S, PAIR_GAP)
const D_COL_X_N = coupledRun(D_PAIR_N, PAIR_GAP)

/** bay centres: midpoints of adjacent PAIRS, only where the gap is worth a
 *  screen. The 13.8 m gap on the west wall yields the room's one wide bay. */
const D_BAY_Z_W = bayCentres(D_PAIR_W, 5)
const D_BAY_Z_E = bayCentres(D_PAIR_E, 5)
const D_BAY_X_S = bayCentres(D_PAIR_S, 5).filter((x) => Math.abs(x) > 5.5)
const D_BAY_X_N = bayCentres(D_PAIR_N, 5).filter((x) => Math.abs(x) > 5.5)

/** the recessed field: every wall box with its inner face pushed OUT by
 *  WALL_RECESS. Lintels over the gate openings stay at the face. */
const D_WALL_FIELD: BoxSpec[] = [
  { x0: -30, y0: 0, z0: 164, x1: -3, y1: 10, z1: 165 - WALL_RECESS },
  { x0: 3, y0: 0, z0: 164, x1: 30, y1: 10, z1: 165 - WALL_RECESS },
  { x0: -30, y0: 0, z0: 225 + WALL_RECESS, x1: -4, y1: 10, z1: 226 },
  { x0: 4, y0: 0, z0: 225 + WALL_RECESS, x1: 30, y1: 10, z1: 226 },
  { x0: 30 + WALL_RECESS, y0: 0, z0: 165, x1: 31, y1: 10, z1: 225 },
  { x0: -31, y0: 0, z0: 165, x1: -30 - WALL_RECESS, y1: 10, z1: 225 },
  { x0: -3, y0: 8, z0: 164, x1: 3, y1: 10, z1: 165 },
  { x0: -4, y0: 8, z0: 225, x1: 4, y1: 10, z1: 226 },
]

/** dado (0 → 2.3) and attic (8.6 → 10) bands standing at the ORIGINAL face,
 *  so the recess between them reads as a cut register and not as a set-back */
const D_WALL_DADO: InstItem[] = []
const D_WALL_ATTIC: InstItem[] = []
const D_WALL_PIER: InstItem[] = []
{
  const R = WALL_RECESS
  const dadoH = DADO_TOP
  const atticH = 10 - ATTIC_BOT
  // long walls: one continuous run each
  for (const sx of [1, -1]) {
    const cx = sx * (30 + R / 2)
    D_WALL_DADO.push({ p: [cx, dadoH / 2, 195], s: [R, dadoH, 60] })
    D_WALL_ATTIC.push({ p: [cx, ATTIC_BOT + atticH / 2, 195], s: [R, atticH, 60] })
  }
  // end walls: split around the gate openings
  for (const [wz, face, half] of [[165, -1, 3], [225, 1, 4]] as [number, number, number][]) {
    const cz = wz + face * (R / 2)
    for (const s of [1, -1]) {
      const x0 = s > 0 ? half : -30
      const x1 = s > 0 ? 30 : -half
      D_WALL_DADO.push({ p: [(x0 + x1) / 2, dadoH / 2, cz], s: [x1 - x0, dadoH, R] })
      D_WALL_ATTIC.push({ p: [(x0 + x1) / 2, ATTIC_BOT + atticH / 2, cz], s: [x1 - x0, atticH, R] })
    }
  }
  // piers: one per COUPLE, carrying the pair of engaged shafts in front of it
  const pierW = PAIR_GAP * 2 + 1.5
  const pierH = ATTIC_BOT - DADO_TOP
  const pierY = (ATTIC_BOT + DADO_TOP) / 2
  for (const z of D_PAIR_W) D_WALL_PIER.push({ p: [-(30 + R / 2), pierY, z], s: [R, pierH, pierW] })
  for (const z of D_PAIR_E) D_WALL_PIER.push({ p: [30 + R / 2, pierY, z], s: [R, pierH, pierW] })
  for (const x of D_PAIR_S) D_WALL_PIER.push({ p: [x, pierY, 165 - R / 2], s: [pierW, pierH, R] })
  for (const x of D_PAIR_N) D_WALL_PIER.push({ p: [x, pierY, 225 + R / 2], s: [pierW, pierH, R] })
}

/**
 * R5 — the arena wall gets a LIT FALLOFF, baked.
 *
 * The one note every round has repeated about this room is that its 60 m walls
 * "tile like wallpaper with no lit falloff": one flat value from plinth to
 * cornice, so no amount of trim on any single bay reads as architecture. The
 * obvious fix is lights, and the obvious fix is wrong here for two reasons —
 * the aperture rig in `Lighting.tsx` is another stream's file, and a spot or
 * rect-area light per bay is a per-fragment cost on a browser budget for
 * something that never changes, because nothing in this room moves.
 *
 * The ramp is therefore baked into the wall's own vertex colour, through the
 * `vertexColors` channel `ivoryContactMaterial` already carries. The curve is
 * the one a roofed hall actually has: dark at the base where nothing reaches,
 * brightest a little above eye line where the floor bounce and the ridge slots
 * land, and falling again into the cove under the projecting cornice.
 *
 * Local y is the unit box's, so the stops below map to world height as
 * `y * 10 + 5` for the 10 m field and `y * 6.3 + 5.45` for the pier register.
 * Only 2.3 m upward is ever visible on the field (the dado stands in front of
 * the rest), which is why the curve is authored across that band and not from
 * the floor.
 */
const WALL_FIELD_BOX = bakeGradient(PANEL_BOX, [
  [-0.5, 0.5],
  [-0.3, 0.57],
  [-0.16, 0.8],
  [0.02, 1.0],
  [0.22, 0.92],
  [0.36, 0.62],
  [0.5, 0.56],
])
const WALL_PIER_BOX = bakeGradient(PANEL_BOX, [
  [-0.5, 0.58],
  [-0.22, 0.86],
  [0.06, 1.0],
  [0.3, 0.92],
  [0.5, 0.62],
])

/**
 * R5 — the dado becomes a DARK register, panelled.
 *
 * Work order env-art #1 asked for the lower band to be darkened ~30 % "so
 * enemy bodies at play height sit against a dark field". It was ivory, the
 * same value as everything above it, which is why every combat frame in the
 * review set has troopers silhouetted against a wall the same brightness as
 * they are. It is now umber — the level's warm dark, already used for the base
 * course — with real sunk panels between the piers and a projecting gold cap
 * moulding at 2.3 m, so the register reads as joinery rather than as paint.
 *
 * Both are geometry INSIDE the wall's existing face: the panel backs are flush
 * with it and the cap projects 0.18 m, which is less than the pilaster nosings
 * already standing at 0.26 m. No collider is touched.
 */
const D_DADO_PANEL: InstItem[] = []
const D_DADO_STILE: InstItem[] = []
const D_DADO_CAP: InstItem[] = []
const D_DADO_PLINTH: InstItem[] = []
{
  /** panel field between two pier centres, trimmed for the pier width */
  const panelRun = (a: number, b: number) => {
    const w = b - a - (PAIR_GAP * 2 + 2.3)
    return w >= 1.4 ? [(a + b) / 2, w] : null
  }
  // long walls: panels between consecutive pair centres, plus the end returns
  for (const sx of [1, -1]) {
    const run = sx > 0 ? D_PAIR_E : D_PAIR_W
    const face = sx * 29.97
    const stile = sx * 29.9
    for (let i = 0; i + 1 < run.length; i++) {
      const r = panelRun(run[i], run[i + 1])
      if (!r) continue
      D_DADO_PANEL.push({ p: [face, 1.32, r[0]], s: [0.06, 1.5, r[1]] })
      for (const e of [-1, 1]) {
        D_DADO_STILE.push({ p: [stile, 1.32, r[0] + (e * r[1]) / 2], s: [0.12, 1.62, 0.13] })
      }
      D_DADO_STILE.push({ p: [stile, 0.53, r[0]], s: [0.12, 0.12, r[1] + 0.13] })
      D_DADO_STILE.push({ p: [stile, 2.11, r[0]], s: [0.12, 0.12, r[1] + 0.13] })
    }
    // the swept profile's back plane is local x = 0, so the run is seated ON
    // the dado face rather than 6 cm in front of it (which would show a slit)
    D_DADO_CAP.push({ p: [sx * 30.0, 2.33, 195], r: [0, sx > 0 ? Math.PI : 0, 0], s: [1.6, 1.25, 59.8] })
    D_DADO_PLINTH.push({ p: [sx * 29.93, 0.19, 195], s: [0.14, 0.38, 59.8] })
  }
  // end walls: the same course, split around the gate opening
  for (const sz of [1, -1]) {
    const wz = sz > 0 ? 225 : 165
    const face = sz > 0 ? -1 : 1
    const half = sz > 0 ? 4 : 3
    const run = sz > 0 ? D_PAIR_N : D_PAIR_S
    for (let i = 0; i + 1 < run.length; i++) {
      const r = panelRun(run[i], run[i + 1])
      if (!r || Math.abs(r[0]) < half + 1) continue
      D_DADO_PANEL.push({ p: [r[0], 1.32, wz + face * 0.03], s: [r[1], 1.5, 0.06] })
      for (const e of [-1, 1]) {
        D_DADO_STILE.push({ p: [r[0] + (e * r[1]) / 2, 1.32, wz + face * 0.1], s: [0.13, 1.62, 0.12] })
      }
      D_DADO_STILE.push({ p: [r[0], 0.53, wz + face * 0.1], s: [r[1] + 0.13, 0.12, 0.12] })
      D_DADO_STILE.push({ p: [r[0], 2.11, wz + face * 0.1], s: [r[1] + 0.13, 0.12, 0.12] })
    }
    for (const side of [-1, 1]) {
      const x0 = side > 0 ? half : -30
      const x1 = side > 0 ? 30 : -half
      D_DADO_CAP.push({
        p: [(x0 + x1) / 2, 2.33, wz],
        r: [0, face > 0 ? -Math.PI / 2 : Math.PI / 2, 0],
        s: [1.6, 1.25, x1 - x0],
      })
      D_DADO_PLINTH.push({ p: [(x0 + x1) / 2, 0.19, wz + face * 0.07], s: [x1 - x0, 0.38, 0.14] })
    }
  }
}

// arena wall detail: gold pilasters + obsidian panel lines + teal insets
const D_WALL_PILASTERS: InstItem[] = []
const D_WALL_BANDS: InstItem[] = []
const D_WALL_INSETS: InstItem[] = []
for (const z of D_COL_Z_E) D_WALL_PILASTERS.push({ p: [29.91, 5, z], s: [0.16, 10, 0.6] })
for (const z of D_COL_Z_W) D_WALL_PILASTERS.push({ p: [-29.91, 5, z], s: [0.16, 10, 0.6] })
for (const x of D_COL_X_S) D_WALL_PILASTERS.push({ p: [x, 5, 165.09], s: [0.6, 10, 0.16] })
for (const x of D_COL_X_N) D_WALL_PILASTERS.push({ p: [x, 5, 224.91], s: [0.6, 10, 0.16] })
// horizontal obsidian panel-line bands (chair-rail + cornice, split at gates)
D_WALL_BANDS.push({ p: [29.94, 7.4, 195], s: [0.1, 0.4, 60] })
D_WALL_BANDS.push({ p: [-29.94, 7.4, 195], s: [0.1, 0.4, 60] })
D_WALL_BANDS.push({ p: [-16.5, 7.4, 165.06], s: [27, 0.4, 0.1] })
D_WALL_BANDS.push({ p: [16.5, 7.4, 165.06], s: [27, 0.4, 0.1] })
D_WALL_BANDS.push({ p: [-17, 7.4, 224.94], s: [26, 0.4, 0.1] })
D_WALL_BANDS.push({ p: [17, 7.4, 224.94], s: [26, 0.4, 0.1] })
D_WALL_BANDS.push({ p: [29.94, 2.2, 195], s: [0.1, 0.3, 60] })
D_WALL_BANDS.push({ p: [-29.94, 2.2, 195], s: [0.1, 0.3, 60] })
// teal vein insets on the east/west walls — halved, each recessed into a
// dark channel (practical glow in the arena framing)
const D_WALL_CHANNEL: InstItem[] = []
const D_WALL_FRET: InstItem[] = []
const D_FLOOR_UMBER: InstItem[] = []
const D_TEAL_FIXTURES: [number, number, number][] = []
for (const z of [183, 207]) {
  for (const sx of [1, -1]) {
    D_WALL_INSETS.push({ p: [sx * 29.93, 3.2, z], s: [0.08, 4.8, 0.24] })
    D_WALL_CHANNEL.push({ p: [sx * 29.88, 3.2, z], s: [0.1, 5.5, 0.64] })
    D_TEAL_FIXTURES.push([sx * 29.4, 3.2, z])
  }
}
// filigree courses along both long walls
for (const sx of [1, -1]) {
  D_WALL_FRET.push({ p: [sx * 29.86, 5.7, 195], r: [0, sx * Math.PI / 2, 0], s: [58, 0.6, 1] })
}
// umber floor bands: an outer ring outside the medallion and two cross bands,
// so the arena floor has a warm mid-dark between obsidian and gold
D_FLOOR_UMBER.push({ p: [0, 0.004, 195], s: [56, 0.008, 3.2] })
D_FLOOR_UMBER.push({ p: [0, 0.004, 175], s: [56, 0.008, 1.4] })
D_FLOOR_UMBER.push({ p: [0, 0.004, 215], s: [56, 0.008, 1.4] })

// ---------------------------------------------------------------------------
// R2 — Zone D brought to shrine parity (work order env-art #7 and #9)
//
// The arena was the weakest room in the level: six flat 60 m walls with a
// pilaster every 6 m, a painted floor decal, and no light of its own. It is
// also where the player spends most of the mission. Everything the shrine got
// in R1 is applied here — contact-AO wall panels, pierced screens, a coffered
// upper register, fret courses at plinth and head height, modelled gold
// pilaster nosings, a junction angle, corbel framing — plus the two things the
// composition notes asked for: an inlaid (not painted) floor mandala, and
// perimeter practicals so the floor has pools and enemies separate from it.
// ---------------------------------------------------------------------------
const D_SCREENS: InstItem[] = []
const D_SCREEN_BACK: InstItem[] = []
const D_COFFERS: InstItem[] = []
const D_COFFER_BACK: InstItem[] = []
const D_CORBELS: InstItem[] = []
const D_PILASTER_NOSING: InstItem[] = []
const D_PILASTER_NOSING_LIP: InstItem[] = []
const D_FRET_PLINTH: InstItem[] = []
const D_FRET_HEAD: InstItem[] = []
const D_SCONCE_BRACKET: InstItem[] = []
const D_SCONCE_HOOD: InstItem[] = []
const D_SCONCE_LENS: InstItem[] = []
/** arena perimeter practicals — consumed by GOLD_FIXTURES / EnvironmentFX */
const D_SCONCE_FIXTURES: [number, number, number][] = []

/**
 * R7 — five bay MODULES instead of one, plus suppression.
 *
 * The work order's wording was exact: "no 200 px region is one repeated
 * element". R4 fixed the PITCH of the arena order and left the MODULE alone,
 * so the wall still presented the same screen-under-coffer kit in every bay,
 * just at irregular spacing — which the eye still resolves, because a repeat
 * is a repeat whatever its rhythm.
 *
 * `bayVariant` is a stable hash of the bay's own world coordinate, so it is
 * identical on every load and on every machine, and different for the same
 * index on different walls. It returns one of five modules: a tall screen, a
 * short wide screen, a tall screen with no coffer over it, a narrow screen,
 * and — for about one bay in four — a BLIND bay carrying nothing but a sunk
 * panel, which is the variation that actually breaks the read.
 */
const D_BLIND_BACK: InstItem[] = []
const D_BLIND_PANEL: InstItem[] = []
/** R7b — the suppressed bays, recorded so the wall machine clusters can be
 *  hung in them (and only in them): [wall 0 W / 1 E / 2 S / 3 N, along, w] */
const D_BLIND_BAYS: [number, number, number][] = []
function bayVariant(key: number, salt: number): { w: number; h: number; y: number; noCoffer: boolean; blind: boolean } {
  const r = h1(Math.round(key * 7.3), salt)
  if (r < 0.24) return { w: 4.6 + r * 2.2, h: 0, y: 0, noCoffer: true, blind: true }
  if (r < 0.42) return { w: 5.4, h: 5.3, y: 3.4, noCoffer: false, blind: false }
  if (r < 0.58) return { w: 5.8, h: 3.9, y: 2.9, noCoffer: false, blind: false }
  if (r < 0.74) return { w: 4.9, h: 5.6, y: 3.6, noCoffer: true, blind: false }
  if (r < 0.88) return { w: 3.6, h: 4.7, y: 3.2, noCoffer: false, blind: false }
  return { w: 5.1, h: 4.4, y: 3.05, noCoffer: false, blind: false }
}

// east / west long walls
for (const sx of [1, -1]) {
  const bays = sx > 0 ? D_BAY_Z_E : D_BAY_Z_W
  const cols = sx > 0 ? D_COL_Z_E : D_COL_Z_W
  // Screen + coffer bays now sit in the CENTRE of each recessed bay the
  // coupled colonnade leaves, so their spacing inherits the wall's irregular
  // rhythm instead of imposing a second, conflicting 6 m lattice on top of it.
  // Their backing boards are sunk into the 0.5 m recess, so a screen is a
  // pierced plate hung 0.6 m in front of a dark cavity rather than 7 cm in
  // front of a lit plane — that depth is what makes it self-shadow.
  for (let i = 0; i < bays.length; i++) {
    const z = bays[i]
    // The bay the hero buttress lands in carries NO screen: a corbel course
    // springing through a pierced plate is a junction no building has, and a
    // solid bay under a buttress is the correct answer as well as the one that
    // makes the buttress read as structure rather than applied ornament.
    if (sx < 0 && Math.abs(z - ARENA_BUTTRESS[1]) < 3.2) continue
    const v = bayVariant(z, sx > 0 ? 5 : 19)
    if (v.blind) {
      // R7 — a SUPPRESSED bay: no screen, no coffer, just a sunk blind panel.
      // Roughly one bay in four. A wall where every bay carries the same kit
      // is a wall the eye resolves into a grid however irregular the pitch is;
      // a missing bay is what stops it, and it is also how a real building
      // behaves, where a bay is whatever the plan behind it needed.
      D_BLIND_BACK.push({ p: [sx * 30.24, 4.4, z], s: [0.52, 6.6, v.w + 0.4] })
      D_BLIND_PANEL.push({ p: [sx * 29.98, 4.4, z], s: [0.1, 6.0, v.w * 0.72] })
      D_BLIND_BAYS.push([sx > 0 ? 1 : 0, z, v.w])
      continue
    }
    const w = v.w
    D_SCREEN_BACK.push({ p: [sx * 30.24, v.y, z], s: [0.52, v.h + 0.7, w + 0.6] })
    D_SCREENS.push({ p: [sx * 29.82, v.y, z], r: [0, sx * Math.PI / 2, 0], s: [w, v.h, 1] })
    if (!v.noCoffer) {
      D_COFFER_BACK.push({ p: [sx * 30.24, 8.1, z], s: [0.52, 2.8, w * 0.62 + 0.4] })
      D_COFFERS.push({ p: [sx * 29.82, 8.1, z], r: [0, sx * Math.PI / 2, 0], s: [w * 0.6, 2.6, 1] })
    }
  }
  for (const z of cols) {
    D_PILASTER_NOSING.push({ p: [sx * 29.74, 5, z], s: [0.2, 10, 0.42] })
    D_PILASTER_NOSING_LIP.push({ p: [sx * 29.62, 5, z], s: [0.1, 10, 0.2] })
  }
  for (let z = 167; z <= 223; z += 3.5) {
    D_CORBELS.push({ p: [sx * 29.45, 8.9, z], s: [1.2, 0.68, 1.2] })
  }
  D_FRET_PLINTH.push({ p: [sx * 29.83, 1.2, 195], r: [0, sx * Math.PI / 2, 0], s: [58, 0.45, 1] })
  D_FRET_HEAD.push({ p: [sx * 29.83, 2.62, 195], r: [0, sx * Math.PI / 2, 0], s: [58, 0.32, 1] })
  // perimeter sconces: a modelled gold bracket with a hood and a recessed
  // lens. These are the fixtures the pooled gold practicals ride, so every
  // pool of light on the arena floor has a visible source above it.
  for (const z of [174, 186, 198, 210]) {
    D_SCONCE_BRACKET.push({ p: [sx * 29.78, 6.2, z], s: [0.5, 0.34, 0.5] })
    D_SCONCE_HOOD.push({ p: [sx * 29.5, 6.72, z], s: [1.1, 0.16, 0.9] })
    D_SCONCE_LENS.push({ p: [sx * 29.45, 6.22, z], s: [0.1, 0.5, 0.62] })
    D_SCONCE_FIXTURES.push([sx * 28.7, 6.0, z])
  }
}
// south / north end walls
for (const sz of [1, -1]) {
  /** the wall's INTERIOR face; `face` points into the room from it */
  const wz = sz > 0 ? 225 : 165
  const face = sz > 0 ? -1 : 1
  const bays = sz > 0 ? D_BAY_X_N : D_BAY_X_S
  const cols = sz > 0 ? D_COL_X_N : D_COL_X_S
  for (let i = 0; i < bays.length; i++) {
    const x = bays[i]
    const v = bayVariant(x + 100, sz > 0 ? 31 : 47)
    if (v.blind) {
      D_BLIND_BACK.push({ p: [x, 4.4, wz - face * 0.24], s: [v.w + 0.4, 6.6, 0.52] })
      D_BLIND_PANEL.push({ p: [x, 4.4, wz + face * 0.02], s: [v.w * 0.72, 6.0, 0.1] })
      D_BLIND_BAYS.push([sz > 0 ? 3 : 2, x, v.w])
      continue
    }
    const w = v.w
    D_SCREEN_BACK.push({ p: [x, v.y, wz - face * 0.24], s: [w + 0.6, v.h + 0.7, 0.52] })
    D_SCREENS.push({ p: [x, v.y, wz + face * 0.18], r: [0, sz > 0 ? Math.PI : 0, 0], s: [w, v.h, 1] })
    if (!v.noCoffer) {
      D_COFFER_BACK.push({ p: [x, 8.1, wz - face * 0.24], s: [w * 0.62 + 0.4, 2.8, 0.52] })
      D_COFFERS.push({ p: [x, 8.1, wz + face * 0.18], r: [0, sz > 0 ? Math.PI : 0, 0], s: [w * 0.6, 2.6, 1] })
    }
  }
  for (const x of cols) {
    D_PILASTER_NOSING.push({ p: [x, 5, wz + face * 0.16], s: [0.42, 10, 0.2] })
    D_PILASTER_NOSING_LIP.push({ p: [x, 5, wz + face * 0.28], s: [0.2, 10, 0.1] })
  }
  for (let x = -28; x <= 28; x += 3.5) {
    D_CORBELS.push({ p: [x, 8.9, wz + face * 0.5], s: [1.2, 0.68, 1.2] })
  }
  for (const x of [-14, 14]) {
    D_SCONCE_BRACKET.push({ p: [x, 6.2, wz + face * 0.22], s: [0.5, 0.34, 0.5] })
    D_SCONCE_HOOD.push({ p: [x, 6.72, wz + face * 0.5], s: [0.9, 0.16, 1.1] })
    D_SCONCE_LENS.push({ p: [x, 6.22, wz + face * 0.55], s: [0.62, 0.5, 0.1] })
    D_SCONCE_FIXTURES.push([x, 6.0, wz + face * 1.3])
  }
}
/**
 * R5 — a projecting hood over every screen bay.
 *
 * The arena's recessed field is where the "tiles like wallpaper" read lives:
 * a 6 m band of one repeating tile with nothing crossing it. Trim applied FLAT
 * onto that band cannot fix it, because a flat stripe on a flat plane is more
 * of the same surface. What breaks a tiled field is something that stands off
 * it far enough to put a hard horizontal band of its own shade across it.
 *
 * So each screen bay gets a cornice hood on two consoles, projecting 0.62 m
 * from the face at 5.75 m — over the screen's head, under the coffer register,
 * clear of the 1.8 m capsule by nearly four metres. It is derived from
 * `D_SCREENS`, so it inherits the wall's irregular bay rhythm for free and
 * appears only where a bay actually exists (the buttress bay has no screen and
 * therefore gets no hood, which is the correct answer structurally as well).
 */
const D_BAY_HOOD: InstItem[] = []
const D_BAY_HOOD_LIP: InstItem[] = []
const D_BAY_CONSOLE: InstItem[] = []
for (const sc of D_SCREENS) {
  const [px, , pz] = sc.p
  const w = (sc.s ?? [1, 1, 1])[0]
  // long-wall screens sit at |x| = 29.82; an end-wall bay centre can reach
  // |x| = 21.1, so the test has to be 29 and not 20
  const onLongWall = Math.abs(px) > 29
  if (onLongWall) {
    const sx = px > 0 ? 1 : -1
    D_BAY_HOOD.push({ p: [sx * 29.62, 5.78, pz], s: [0.78, 0.26, w + 1.0] })
    D_BAY_HOOD_LIP.push({ p: [sx * 29.28, 5.62, pz], s: [0.12, 0.09, w + 1.04] })
    for (const e of [-1, 1]) {
      D_BAY_CONSOLE.push({ p: [sx * 29.78, 5.38, pz + (e * w) / 2], s: [0.5, 0.6, 0.42] })
    }
  } else {
    const face = pz > 195 ? -1 : 1
    const wz = pz > 195 ? 225 : 165
    D_BAY_HOOD.push({ p: [px, 5.78, wz + face * 0.42], s: [w + 1.0, 0.26, 0.78] })
    D_BAY_HOOD_LIP.push({ p: [px, 5.62, wz + face * 0.76], s: [w + 1.04, 0.09, 0.12] })
    for (const e of [-1, 1]) {
      D_BAY_CONSOLE.push({ p: [px + (e * w) / 2, 5.38, wz + face * 0.26], s: [0.42, 0.6, 0.5] })
    }
  }
}

/**
 * R4 — jittered copies of the two ornament runs that repeat most often in a
 * wide arena shot. The corbel course is 32 blocks at a dead 3.5 m pitch and
 * the vault bosses repeat per bay; a few percent of variation per instance is
 * what stops the eye resolving them into a lattice, and it is free (the
 * matrices are written once at mount either way).
 */
const D_CORBELS_J = jitterItems(D_CORBELS, { yaw: 0.085, scale: 0.085, lift: 0.06, salt: 3 })

/** R7c — the arena screens dealt across the four motif scales */
const D_SCREENS_V = dealScreens(D_SCREENS, 61)

/** R3 — engaged fluted colonnade on the arena's four walls. Column axis y 0.5
 *  to 9.5, so the capitals land under the cornice and the shafts carry the
 *  vault's springing corbels visually down to the deck. */
const D_COLUMN: InstItem[] = []
const D_COLUMN_PLINTH: InstItem[] = []
const D_COLUMN_CAP: InstItem[] = []
const D_COLUMN_NECK: InstItem[] = []
for (const sx of [1, -1]) {
  // R4 — coupled pairs on an irregular rhythm, different on each long wall.
  // Alternate shafts of a pair carry a slightly different diameter (±4 %) so
  // even a pair is not a mirror of itself at gameplay distance.
  const cols = sx > 0 ? D_COL_Z_E : D_COL_Z_W
  cols.forEach((z, i) => {
    const k = i % 2 === 0 ? 1.0 : 0.955
    D_COLUMN.push({ p: [sx * 29.45, 5, z], s: [0.62 * k, 1.05, 0.62 * k] })
    D_COLUMN_PLINTH.push({ p: [sx * 29.6, 0.42, z], s: [1.5, 0.84, 1.5 * k + 0.05] })
    D_COLUMN_CAP.push({ p: [sx * 29.6, 9.72, z], s: [1.5, 0.42, 1.55 * k + 0.05] })
    D_COLUMN_NECK.push({ p: [sx * 29.5, 8.62, z], s: [1.18, 0.16, 1.2 * k + 0.04] })
  })
}
for (const sz of [1, -1]) {
  const wz = sz > 0 ? 225 : 165
  const face = sz > 0 ? -1 : 1
  const cols = sz > 0 ? D_COL_X_N : D_COL_X_S
  cols.forEach((x, i) => {
    const k = i % 2 === 0 ? 1.0 : 0.955
    D_COLUMN.push({ p: [x, 5, wz + face * 0.55], s: [0.62 * k, 1.05, 0.62 * k] })
    D_COLUMN_PLINTH.push({ p: [x, 0.42, wz + face * 0.4], s: [1.5 * k + 0.05, 0.84, 1.5] })
    D_COLUMN_CAP.push({ p: [x, 9.72, wz + face * 0.4], s: [1.55 * k + 0.05, 0.42, 1.5] })
    D_COLUMN_NECK.push({ p: [x, 8.62, wz + face * 0.5], s: [1.2 * k + 0.04, 0.16, 1.18] })
  })
}

/**
 * R3 — every pilaster gets a shadow gap. A pilaster applied flat onto a flat
 * wall is a stripe; a pilaster standing between two 6 cm channels is a column,
 * because the two dark lines beside it are what the eye reads as depth. This
 * is the cheapest ornament in the level (two instanced boxes per pilaster) and
 * one of the most legible at gameplay distance.
 */
const D_PILASTER_FLANK: InstItem[] = []
for (const sx of [1, -1]) {
  for (const z of sx > 0 ? D_COL_Z_E : D_COL_Z_W) {
    for (const dz of [-0.36, 0.36]) {
      D_PILASTER_FLANK.push({ p: [sx * 29.82, 5, z + dz], s: [0.14, 9.6, 0.12] })
    }
  }
}
for (const sz of [1, -1]) {
  const wz = sz > 0 ? 225 : 165
  const face = sz > 0 ? -1 : 1
  for (const x of sz > 0 ? D_COL_X_N : D_COL_X_S) {
    for (const dx of [-0.36, 0.36]) {
      D_PILASTER_FLANK.push({ p: [x + dx, 5, wz + face * 0.24], s: [0.12, 9.6, 0.14] })
    }
  }
}

/**
 * R4 — the arena's asymmetric hero mass, and a clerestory on its own rhythm.
 *
 * The work order asked for "ONE off-centre asymmetric hero mass (canted
 * buttress or inset apse)". This is the canted buttress: a three-step corbel
 * course springing off the west wall in the room's one wide bay, carrying a
 * pier that leans ~7° out over the floor, banded in gold and crowned with a
 * projecting hood that crosses the top of frame from most of the arena. Its
 * counterweight on the east wall is deliberately NOT the same object — it is
 * a flat gold-framed aedicule sunk into the recess at a different z — so the
 * two long walls never read as a mirror pair.
 *
 * Everything that projects into the room starts at y 2.75, above the 1.8 m
 * player capsule, so nothing the player can walk into changes and no collider
 * in layout.ts is touched.
 */
const BUTTRESS = ARENA_BUTTRESS // west wall, the wide bay
const BUTT_LEAN = 0.12 // ≈7°
const D_BUTT_CORBEL: InstItem[] = []
const D_BUTT_SHAFT: InstItem[] = []
const D_BUTT_BAND: InstItem[] = []
const D_BUTT_HOOD: InstItem[] = []
const D_BUTT_FIN: InstItem[] = []
{
  const [bx, bz] = BUTTRESS
  // corbel course: three stones stepping out and up, each wider than the last
  const steps: [number, number, number][] = [
    [2.95, 0.7, 3.4],
    [3.85, 1.15, 3.9],
    [4.75, 1.65, 4.4],
  ]
  for (const [y, out, w] of steps) {
    D_BUTT_CORBEL.push({ p: [bx + out / 2, y, bz], s: [out + 0.5, 0.86, w] })
  }
  // canted pier: two stacked segments, each leaning a little further out
  D_BUTT_SHAFT.push({ p: [bx + 1.75, 7.4, bz], r: [0, 0, -BUTT_LEAN], s: [2.5, 5.6, 3.9] })
  D_BUTT_SHAFT.push({ p: [bx + 2.55, 11.6, bz], r: [0, 0, -BUTT_LEAN * 1.7], s: [2.1, 3.2, 3.3] })
  for (const [y, w, h] of [[5.9, 4.2, 0.34], [9.1, 4.0, 0.26], [13.1, 3.7, 0.5]] as [number, number, number][]) {
    const out = 1.55 + (y - 5.9) * 0.2
    D_BUTT_BAND.push({ p: [bx + out, y, bz], s: [2.8, h, w] })
  }
  // crowning hood — the piece that actually crosses the top of frame
  D_BUTT_HOOD.push({ p: [bx + 3.0, 13.9, bz], r: [0, 0, -0.06], s: [4.6, 1.15, 5.0] })
  D_BUTT_HOOD.push({ p: [bx + 3.2, 15.0, bz], r: [0, 0, -0.06], s: [3.2, 1.0, 3.4] })
  // vertical fins on the pier flanks, tapering as they rise
  for (let i = 0; i < 4; i++) {
    const t = i / 3
    const dz = (i < 2 ? -1 : 1) * (1.35 - (i % 2) * 0.62)
    D_BUTT_FIN.push({
      p: [bx + 1.5 + t * 0.55, 6.6 + t * 2.4, bz + dz],
      r: [0, 0, -BUTT_LEAN],
      s: [0.36, 4.4 - t * 1.1, 0.3],
    })
  }
}

/** east-wall aedicule: flat, framed, sunk in the recess — the asymmetric
 *  answer to the buttress rather than its mirror */
const AEDICULE_Z = ARENA_AEDICULE_Z
const D_AED_BACK: InstItem[] = [{ p: [30.48, 5.2, AEDICULE_Z], s: [0.44, 7.4, 6.2] }]
const D_AED_FRAME: InstItem[] = [
  { p: [30.02, 8.95, AEDICULE_Z], s: [0.5, 0.55, 6.6] }, // head
  { p: [30.02, 1.45, AEDICULE_Z], s: [0.5, 0.5, 6.6] }, // sill
  { p: [30.02, 5.2, AEDICULE_Z - 3.05], s: [0.5, 7.5, 0.5] }, // jambs
  { p: [30.02, 5.2, AEDICULE_Z + 3.05], s: [0.5, 7.5, 0.5] },
]
const D_AED_PLINTH: InstItem[] = [{ p: [29.9, 2.2, AEDICULE_Z], s: [0.9, 1.5, 2.4] }]
/**
 * R5 — the aedicule holds a VOTARY, not a mannequin.
 *
 * What stood here was two rounded boxes: a 4.8 m slab with a 1.2 m cube on
 * top, lit, framed in gold and placed at the focus of the arena's east wall —
 * a literal blockout mannequin in the one niche the room asks you to look at.
 * It is now a lathed votive idol: a flared hem, a robe tapering with one fold,
 * a shouldered mantle, a necking, a crested helm, a cast collar bead and a
 * halo ring behind the head. All surface of revolution, one shared geometry,
 * no boxes.
 *
 * The lathe is scaled 0.78 in x/z so its widest point sits at 0.61 m, which
 * keeps the whole figure inside the footprint the two boxes used to occupy.
 */
const VOTARY_PROFILE: [number, number][] = [
  [0.0, 0.72],
  [0.16, 0.78],
  [0.26, 0.7],
  [0.9, 0.62],
  [1.8, 0.55],
  [2.6, 0.5],
  [3.1, 0.52],
  [3.35, 0.46],
  [3.6, 0.56],
  [3.85, 0.62],
  [4.05, 0.58],
  [4.2, 0.4],
  [4.32, 0.3],
  [4.4, 0.26],
  [4.5, 0.34],
  [4.75, 0.4],
  [5.0, 0.36],
  [5.18, 0.22],
  [5.28, 0.08],
]
const VOTARY_GEO = bakeContactAO(latheProfile(VOTARY_PROFILE, 26), 0, 1.4, 0.42)
const D_AED_FIGURE: InstItem[] = [{ p: [30.02, 2.95, AEDICULE_Z], r: [0, 0.4, 0], s: [0.78, 1, 0.78] }]
const D_AED_COLLAR: InstItem[] = [
  { p: [30.02, 6.72, AEDICULE_Z], r: [-Math.PI / 2, 0, 0], s: [0.49, 0.49, 1.1] },
  { p: [30.02, 7.28, AEDICULE_Z], r: [-Math.PI / 2, 0, 0], s: [0.27, 0.27, 0.8] },
]
/** halo behind the helm, set into the aedicule back */
const D_AED_HALO: InstItem[] = [
  { p: [30.34, 7.58, AEDICULE_Z], r: [0, -Math.PI / 2, 0], s: [1.05, 1.05, 22] },
]

/**
 * Clerestory blind arcade. It runs at a 3.2 m pitch that is deliberately
 * coprime with the colonnade below, so the two registers never line up into
 * a single stamped grid — which is exactly what the panel saw.
 */
/** jittered copies of the repeated arena ornament (see `jitterItems`) */
const D_CLERE_ARCH: InstItem[] = []
const D_CLERE_RECESS: InstItem[] = []
for (const sx of [1, -1]) {
  for (let z = 167.6; z <= 222.4; z += 3.2) {
    D_CLERE_RECESS.push({ p: [sx * 30.18, 9.28, z], s: [0.36, 1.18, 2.2] })
    D_CLERE_ARCH.push({ p: [sx * 29.93, 9.28, z], r: [0, sx * Math.PI / 2, 0], s: [1.2, 1.15, 1] })
  }
}
for (const [wz, face] of [[165, 1], [225, -1]] as [number, number][]) {
  for (let x = -27.8; x <= 27.8; x += 3.2) {
    if (Math.abs(x) < 4.6) continue
    D_CLERE_RECESS.push({ p: [x, 9.28, wz - face * 0.18], s: [2.2, 1.18, 0.36] })
    D_CLERE_ARCH.push({ p: [x, 9.28, wz + face * 0.07], r: [0, face > 0 ? 0 : Math.PI, 0], s: [1.2, 1.15, 1] })
  }
}

/** gold L-angle around the whole arena floor/wall joint */
const D_LTRIM: InstItem[] = [
  { p: [-29.98, 0.005, 195], r: [0, 0, 0], s: [1, 1, 59.6] },
  { p: [29.98, 0.005, 195], r: [0, Math.PI, 0], s: [1, 1, 59.6] },
  { p: [0, 0.005, 165.02], r: [0, -Math.PI / 2, 0], s: [1, 1, 59.6] },
  { p: [0, 0.005, 224.98], r: [0, Math.PI / 2, 0], s: [1, 1, 59.6] },
]

// --- inlaid floor mandala (replaces the painted groove decal as the primary
//     read): recessed channels with gold inlay sunk into them, plus 24 radial
//     spokes. Everything sits within 2 cm of the deck, so nothing the player
//     collides with moves; only what they see does.
const MANDALA_RADII = [8, 13, 18, 22]
const D_MANDALA_CHANNEL: InstItem[] = MANDALA_RADII.map((r) => ({
  p: [0, 0.006, 195] as [number, number, number],
  r: [-Math.PI / 2, 0, 0] as [number, number, number],
  s: [r, r, 1] as [number, number, number],
}))
const D_MANDALA_INLAY: InstItem[] = MANDALA_RADII.map((r) => ({
  p: [0, 0.013, 195] as [number, number, number],
  r: [-Math.PI / 2, 0, 0] as [number, number, number],
  s: [r, r, 1] as [number, number, number],
}))
const D_MANDALA_SPOKE_CH: InstItem[] = []
const D_MANDALA_SPOKE_IN: InstItem[] = []
for (let i = 0; i < 24; i++) {
  const a = (i / 24) * Math.PI * 2
  const long = i % 3 === 0
  const len = long ? 15 : 9
  const mid = long ? 14.6 : 12.4
  const p: [number, number, number] = [Math.cos(a) * mid, 0.006, 195 + Math.sin(a) * mid]
  const rot: [number, number, number] = [0, Math.PI / 2 - a, 0]
  D_MANDALA_SPOKE_CH.push({ p, r: rot, s: [long ? 0.34 : 0.22, 0.01, len] })
  D_MANDALA_SPOKE_IN.push({
    p: [p[0], 0.011, p[2]],
    r: rot,
    s: [long ? 0.17 : 0.11, 0.008, len - 0.5],
  })
}

// --- the arena's one vertical landmark (work order #9).
//     Off-centre in BOTH axes, rising from the west cornice well above the
//     10 m wall line, so every wide shot of the arena has something to compose
//     against and a sense of scale. It sits above the wall top — outside the
//     play volume entirely — so no collider changes and nothing to walk into.
const LANDMARK: [number, number, number] = [-28.4, 0, 186]
const D_LANDMARK_PLINTH: InstItem[] = [
  { p: [LANDMARK[0], 10.5, LANDMARK[2]], s: [4.8, 1.2, 4.8] },
]
/** corbelled brackets carrying the plinth back into the wall, so the landmark
 *  reads as seated on the cornice rather than floating over the arena */
const D_LANDMARK_BRACE: InstItem[] = [
  { p: [LANDMARK[0] + 0.6, 9.2, LANDMARK[2] - 1.5], s: [3.2, 1.4, 1.0] },
  { p: [LANDMARK[0] + 0.6, 9.2, LANDMARK[2] + 1.5], s: [3.2, 1.4, 1.0] },
  { p: [LANDMARK[0] + 0.9, 8.1, LANDMARK[2]], s: [2.6, 1.2, 2.2] },
]
const D_LANDMARK_SHAFT: InstItem[] = [
  { p: [LANDMARK[0], 16.2, LANDMARK[2]], s: [2.7, 10.6, 2.7] },
  { p: [LANDMARK[0] + 2.1, 14.4, LANDMARK[2] - 0.6], r: [0, 0.5, 0.06], s: [1.0, 5.6, 1.0] },
]
const D_LANDMARK_BANDS: InstItem[] = [
  { p: [LANDMARK[0], 11.3, LANDMARK[2]], s: [3.3, 0.4, 3.3] },
  { p: [LANDMARK[0], 15.0, LANDMARK[2]], s: [3.0, 0.28, 3.0] },
  { p: [LANDMARK[0], 21.2, LANDMARK[2]], s: [3.6, 0.9, 3.6] },
]
const D_LANDMARK_FLUTE: InstItem[] = []
for (let i = 0; i < 4; i++) {
  const a = (i / 4) * Math.PI * 2 + Math.PI / 4
  D_LANDMARK_FLUTE.push({
    p: [LANDMARK[0] + Math.cos(a) * 1.4, 18.0, LANDMARK[2] + Math.sin(a) * 1.4],
    r: [0, Math.PI / 2 - a, 0],
    s: [0.22, 9.0, 0.5],
  })
}

// ---------------------------------------------------------------------------
// Floor medallion — R4: gilding sunk into the deck, not rope laid on it.
//
// These three rings used to be 6-sided torus tubes standing 0.15 m proud of
// the floor, and they cross the near field of every arena frame the panel
// judged; "matte rope" was the exact phrase. They are now a flush pair per
// ring — a 0.07 m wide dark channel cut 6 mm into the deck with a 0.045 m
// polished band sunk inside it — sitting 13 mm and 20 mm above the floor
// plane, low enough that they never break the deck's silhouette and thin
// enough that at grazing angle they read as a specular line rather than a
// cylinder. Same treatment for the twelve radial petals, which are now shaped
// lozenges in their own sunk channels instead of extruded blocks.
// ---------------------------------------------------------------------------
const MEDAL_RADII = [20, 16, 12]
const D_MEDAL_CHANNEL: InstItem[] = MEDAL_RADII.map((r) => ({
  p: [0, 0.013, 195] as [number, number, number],
  r: [-Math.PI / 2, 0, 0] as [number, number, number],
  s: [r, r, 1] as [number, number, number],
}))
const D_MEDAL_RINGS: InstItem[] = MEDAL_RADII.map((r) => ({
  p: [0, 0.02, 195] as [number, number, number],
  r: [-Math.PI / 2, 0, 0] as [number, number, number],
  s: [r, r, 1] as [number, number, number],
}))
const D_MEDAL_PETAL_CH: InstItem[] = []
const D_MEDAL_PETALS: InstItem[] = []
for (let i = 0; i < 12; i++) {
  const a = (i / 12) * Math.PI * 2
  const p: [number, number, number] = [Math.cos(a) * 17, 0.014, 195 + Math.sin(a) * 17]
  const rot: [number, number, number] = [0, Math.PI / 2 - a, 0]
  D_MEDAL_PETAL_CH.push({ p, r: rot, s: [0.92, 1, 1.72] })
  D_MEDAL_PETALS.push({ p: [p[0], 0.021, p[2]], r: rot, s: [0.74, 1, 1.5] })
}

/**
 * R4 — the deck is paved, not poured.
 *
 * The arena floor is the single largest surface the player looks at and it was
 * one unbroken 60×60 plane with a medallion painted on it. Real stone floors
 * are laid in slabs, and the 1–2 cm joint between slabs is what gives a big
 * floor its scale: it catches the key at grazing angle and goes dark under
 * anything standing on it. These are flush recessed joints on an IRREGULAR
 * pitch (a regular one would just be graph paper), skipping the medallion
 * plaza where the inlay already carries the read. Nothing stands proud of the
 * deck, so nothing about movement or collision changes.
 */
const D_PAVING: InstItem[] = []
{
  const zJoints = [168.5, 173.2, 176.4, 181.6, 186.1, 189.8, 200.2, 204.6, 208.1, 213.7, 217.4, 221.9]
  const xJoints = [-26.4, -22.1, -18.6, -13.2, -9.4, 9.4, 13.2, 18.6, 22.1, 26.4]
  for (const z of zJoints) D_PAVING.push({ p: [0, 0.005, z], s: [59.4, 0.01, h1(z) * 0.06 + 0.1] })
  for (const x of xJoints) D_PAVING.push({ p: [x, 0.005, 195], s: [h1(x, 5) * 0.06 + 0.1, 0.01, 59.4] })
  // short cross-joints inside the outer field so the slab courses break bond
  for (let i = 0; i < 18; i++) {
    const z = 167 + h1(i, 31) * 56
    const s = i % 2 === 0 ? -1 : 1
    const x = s * (24 + h1(i, 37) * 5)
    D_PAVING.push({ p: [x, 0.005, z], s: [10 + h1(i, 41) * 6, 0.01, 0.11] })
  }
}
/**
 * R5 — deck services: sump grates and bolted access hatches.
 *
 * The bottom third of every arena wide is bare floor with two thin gold rings
 * on it. Floor is the cheapest screen area in the level to dress and the most
 * expensive to leave empty, because it is what the near plane of a
 * third-person camera is pointed at. These are FLUSH — a sunk dark pan at
 * y 0.028 with a gold grille over it at y 0.046, and hatch plates with a ring
 * of studs — so nothing stands proud of the deck, no collider changes and the
 * player runs straight over them.
 *
 * They sit in the four quadrant corners of the field, clear of the mandala
 * radii (8/13/18/22 m) and the medallion rings (12/16/20 m) so the two systems
 * never resolve into one lattice.
 */
const D_GRATE_PAN: InstItem[] = []
const D_GRATE_BAR: InstItem[] = []
const D_GRATE_KERB: InstItem[] = []
const D_HATCH_PLATE: InstItem[] = []
const D_HATCH_RING: InstItem[] = []
const D_HATCH_STUD: InstItem[] = []
{
  for (const [gx, gz, turned] of ARENA_DECK_GRATES) {
    const w = turned ? 1.9 : 3.5
    const d = turned ? 3.5 : 1.9
    D_GRATE_PAN.push({ p: [gx, 0.028, gz], s: [w, 0.012, d] })
    // kerb is FOUR bars around the pan, not a plate over it
    D_GRATE_KERB.push({ p: [gx, 0.052, gz - d / 2 - 0.09], s: [w + 0.36, 0.024, 0.18] })
    D_GRATE_KERB.push({ p: [gx, 0.052, gz + d / 2 + 0.09], s: [w + 0.36, 0.024, 0.18] })
    D_GRATE_KERB.push({ p: [gx - w / 2 - 0.09, 0.052, gz], s: [0.18, 0.024, d] })
    D_GRATE_KERB.push({ p: [gx + w / 2 + 0.09, 0.052, gz], s: [0.18, 0.024, d] })
    const n = turned ? 9 : 9
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n - 0.5
      if (turned) D_GRATE_BAR.push({ p: [gx, 0.046, gz + t * d], s: [w - 0.1, 0.02, 0.1] })
      else D_GRATE_BAR.push({ p: [gx + t * w, 0.046, gz], s: [0.1, 0.02, d - 0.1] })
    }
  }
  for (const [hx, hz] of ARENA_DECK_HATCHES) {
    D_HATCH_PLATE.push({ p: [hx, 0.03, hz], r: [-Math.PI / 2, 0, 0], s: [1.5, 1.5, 1] })
    D_HATCH_RING.push({ p: [hx, 0.042, hz], r: [-Math.PI / 2, 0, 0], s: [1.42, 1.42, 3] })
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.2
      D_HATCH_STUD.push({
        p: [hx + Math.cos(a) * 1.24, 0.048, hz + Math.sin(a) * 1.24],
        s: [0.16, 0.05, 0.16],
      })
    }
  }
}

/** matching joint course on the chamber deck, at a tighter slab size */
const C_PAVING: InstItem[] = []
{
  for (const z of [138.4, 142.9, 146.2, 154.1, 157.8, 162.3]) {
    C_PAVING.push({ p: [0, 0.005, z], s: [29.4, 0.01, 0.1] })
  }
  for (const x of [-12.1, -8.4, 8.4, 12.1]) {
    C_PAVING.push({ p: [x, 0.005, 150], s: [0.1, 0.01, 29.4] })
  }
}

/**
 * R5 — the arena pylons become a standing ORDER.
 *
 * These six are the closest level geometry a combat camera ever gets to, so
 * they are read at full screen height in exactly the frames the panel judges
 * hardest — and they were a rounded box with a gold slab on it, which is why
 * 11_ability_dash and 17_katana have raw primitives in the near field. Their
 * collider is a 1.2 x 3 x 1.2 AABB in `layout.ts` that cannot move, so the
 * rebuild is authored to stay inside it: a tapered obsidian core in two
 * stages, a lathed base of torus-scotia-fillet, four engaged colonnettes with
 * beads at third points, a lathed necking and flared capital, and the teal
 * vein sunk in a real channel on all four faces instead of one strip floating
 * 3 cm off a flat side.
 *
 * Only the base and capital mouldings step past x/z ±0.6, by ≤0.12 m, and both
 * do it either below 0.2 m or above 2.5 m — clear of the 1.8 m player capsule.
 */
const PYLON_BASE_PROFILE: [number, number][] = [
  [0.0, 0.66],
  [0.06, 0.66],
  [0.09, 0.7],
  [0.16, 0.71],
  [0.22, 0.66],
  [0.26, 0.6],
  [0.3, 0.62],
  [0.34, 0.585],
]
const PYLON_CAP_PROFILE: [number, number][] = [
  [0.0, 0.54],
  [0.05, 0.545],
  [0.09, 0.5],
  [0.16, 0.525],
  [0.26, 0.6],
  [0.36, 0.68],
  [0.42, 0.72],
  [0.46, 0.7],
]
const COLONNETTE_PROFILE: [number, number][] = [
  [0.0, 0.1],
  [0.04, 0.105],
  [0.08, 0.085],
  [0.62, 0.082],
  [0.67, 0.102],
  [0.72, 0.082],
  [1.26, 0.082],
  [1.31, 0.102],
  [1.36, 0.082],
  [1.88, 0.085],
  [1.92, 0.105],
  [1.96, 0.095],
]
const PYLON_BASE_GEO = latheProfile(PYLON_BASE_PROFILE, 26)
const PYLON_CAP_GEO = latheProfile(PYLON_CAP_PROFILE, 26)
const COLONNETTE_GEO = latheProfile(COLONNETTE_PROFILE, 14)

// pylons: tapered obsidian core in two stages (the cover silhouette), lathed
// base and capital, four engaged colonnettes, sunk vein channels
const D_PYLON_ITEMS: InstItem[] = []
const D_PYLON_UPPER: InstItem[] = []
const D_PYLON_BASE: InstItem[] = []
const D_PYLON_CAPITAL: InstItem[] = []
const D_PYLON_COLONNETTE: InstItem[] = []
const D_PYLON_VEINS: InstItem[] = []
const D_PYLON_VEIN_CH: InstItem[] = []
const D_PYLON_CAPS: InstItem[] = []
const D_PYLON_MOULD: InstItem[] = []
for (const [x, z] of ARENA_PYLONS) {
  // two-stage tapered core. Deliberately narrower (1.03 / 0.90) than the 1.2 m
  // collider so the four corner colonnettes stand PROUD of its flat faces —
  // a rod buried inside the box it is meant to dress is the one mistake that
  // would make this change cost geometry and return nothing.
  D_PYLON_ITEMS.push({ p: [x, 1.02, z], s: [1.03, 1.36, 1.03] })
  D_PYLON_UPPER.push({ p: [x, 2.0, z], s: [0.9, 0.64, 0.9] })
  D_PYLON_BASE.push({ p: [x, 0, z] })
  D_PYLON_CAPITAL.push({ p: [x, 2.3, z] })
  for (const [cx, cz] of [
    [0.44, 0.44],
    [-0.44, 0.44],
    [0.44, -0.44],
    [-0.44, -0.44],
  ] as [number, number][]) {
    D_PYLON_COLONNETTE.push({ p: [x + cx, 0.34, z + cz] })
  }
  // vein on all four faces of the lower stage, sunk in a dark channel
  for (const [nx, nz] of [
    [0, 1],
    [0, -1],
    [1, 0],
    [-1, 0],
  ] as [number, number][]) {
    const w: [number, number, number] = nz !== 0 ? [0.3, 1.2, 0.07] : [0.07, 1.2, 0.3]
    const g: [number, number, number] = nz !== 0 ? [0.15, 1.0, 0.06] : [0.06, 1.0, 0.15]
    D_PYLON_VEIN_CH.push({ p: [x + nx * 0.53, 1.02, z + nz * 0.53], s: w })
    D_PYLON_VEINS.push({ p: [x + nx * 0.558, 1.02, z + nz * 0.558], s: g })
  }
  D_PYLON_CAPS.push({ p: [x, 3.06, z], s: [1.34, 0.2, 1.34] })
  D_PYLON_MOULD.push({ p: [x, 2.88, z], s: [1, 1, 1.22] })
}
const D_CORNICE: InstItem[] = [
  { p: [-29.8, 9.5, 195], s: [1, 1, 59.6] },
  { p: [29.8, 9.5, 195], r: [0, Math.PI, 0], s: [1, 1, 59.6] },
]

// low walls with gold wall-runnable tops
const D_LOW_WALLS: InstItem[] = ARENA_LOW_WALLS.map(([x, z]) => ({ p: [x, 0.6, z], s: [8, 1.2, 0.6] }))
const D_LOW_WALL_TOPS: InstItem[] = ARENA_LOW_WALLS.map(([x, z]) => ({ p: [x, 1.24, z], s: [8.1, 0.08, 0.7] }))

// gallery trim (0.02 m proud + edge highlight, fix2)
const D_GALLERY_TRIM: InstItem[] = ARENA_GALLERIES.map((g) => {
  const c = boxCenter(g)
  return { p: [c[0], g.y1 + 0.01, g.z1 - 0.15], s: [g.x1 - g.x0, 0.02, 0.16] }
})
const D_GALLERY_TRIM_EDGE: InstItem[] = ARENA_GALLERIES.map((g) => {
  const c = boxCenter(g)
  return { p: [c[0], g.y1 + 0.022, g.z1 - 0.24], s: [g.x1 - g.x0, 0.006, 0.035] }
})

// ---------------------------------------------------------------------------
// Arena elevation layers (fix2 composition): broken platforms + floating
// megaliths from layout.ARENA_MEGALITHS (colliders registered there), plus
// visual-only broken fragments drifting alongside.
// ---------------------------------------------------------------------------
const D_MEGA_BODY: InstItem[] = []
const D_MEGA_RIM: InstItem[] = []
const D_MEGA_UNDER: InstItem[] = []
const D_MEGA_GLOW: InstItem[] = []
for (const m of ARENA_MEGALITHS) {
  const c = boxCenter(m)
  const s = boxSize(m)
  D_MEGA_BODY.push({ p: c, s })
  // gold rim plate around the walkable top edge
  D_MEGA_RIM.push({ p: [c[0], m.y1 + 0.015, c[2]], s: [s[0] + 0.12, 0.03, s[2] + 0.12] })
  // tapered ivory under-hull
  D_MEGA_UNDER.push({ p: [c[0], m.y0 - 0.24, c[2]], s: [s[0] * 0.68, 0.5, s[2] * 0.68] })
  // hovering gold under-glow plate
  D_MEGA_GLOW.push({ p: [c[0], m.y0 - 0.52, c[2]], s: [s[0] * 0.44, 0.06, s[2] * 0.44] })
}
// broken-off fragments (visual only — no colliders)
const D_MEGA_FRAGS: InstItem[] = [
  { p: [-22.5, 0.9, 189.6], r: [0.4, 0.7, 0.3], s: [1.2, 0.5, 0.9] },
  { p: [23.8, 1.6, 202.9], r: [-0.3, 0.2, 0.5], s: [0.9, 0.4, 1.3] },
  { p: [-13.4, 4.2, 214.3], r: [0.5, 1.1, -0.2], s: [0.8, 0.35, 0.8] },
  { p: [9.9, 7.1, 194.9], r: [-0.4, 0.5, 0.35], s: [0.7, 0.3, 0.9] },
]

// arena wall-run slab veins
const D_SLAB_VEINS: InstItem[] = []
for (const s of ARENA_WALLRUN_SLABS) {
  const len = s.z1 - s.z0 - 2
  const zc = (s.z0 + s.z1) / 2
  const face = s.x0 < 0 ? s.x1 + 0.02 : s.x0 - 0.02 // face the arena interior
  for (const fy of [2.6, 5.4]) D_SLAB_VEINS.push({ p: [face, fy, zc], s: [0.05, 0.14, len] })
}

// corruption vein-growth crawling up 3 ribs + glyph decals
const D_CORRUPTION: InstItem[] = []
for (const [bx, bz] of [
  [-27, 180],
  [26, 200],
] as [number, number][]) {
  for (let i = 0; i < 7; i++) {
    D_CORRUPTION.push({
      p: [bx + (Math.random() - 0.5) * 3, 1 + i * 0.9, bz + (Math.random() - 0.5) * 3],
      r: [(Math.random() - 0.5) * 0.9, Math.random() * Math.PI, (Math.random() - 0.5) * 0.9],
      s: [0.09, 1.8, 0.09],
    })
  }
}

// enemy spawn gates (N, S, E, W): obsidian iris disc + gold frame + teal glow ring
const D_GATE_DISCS: InstItem[] = []
const D_GATE_FRAMES: InstItem[] = []
const D_GATE_GLOWS: InstItem[] = []
for (const [gx, gz, faceDeg] of SPAWN_GATES) {
  const yaw = THREE.MathUtils.degToRad(faceDeg)
  D_GATE_DISCS.push({ p: [gx, 2.2, gz], r: [0, yaw, 0], s: [2.2, 2.2, 1] })
  D_GATE_FRAMES.push({ p: [gx, 2.2, gz], r: [0, yaw, 0], s: [2.6, 2.6, 6] })
  D_GATE_GLOWS.push({ p: [gx, 2.2, gz], r: [0, yaw, 0], s: [2.9, 2.9, 4] })
}

// ---------------------------------------------------------------------------
// R3 — the arena gets a roof.
//
// Everything above the 10 m cornice was open sky: in a wide shot the upper
// HALF of the frame was flat skybox crossed by a few smooth ribs, which is
// what an unfinished blockout looks like and nothing else. The vault closes
// it with real coffered geometry — 18 wells around by 3 along per 10 m bay,
// each sunk 0.9 m with its own reveals and baked cavity AO — springing off a
// corbel course at the cornice, crossed by gold bosses where its soffit bands
// meet, and left open along the ridge over the middle of the room so light
// and sky still come down the axis through a framed oculus.
// ---------------------------------------------------------------------------
const D_VAULT_BAYS: InstItem[] = ARENA_VAULT_BAYS.filter(
  (z) => !ARENA_VAULT_OCULUS_BAYS.includes(z),
).map((z) => ({ p: [0, 0, z] as [number, number, number] }))
const D_VAULT_OPEN_BAYS: InstItem[] = ARENA_VAULT_OCULUS_BAYS.map((z) => ({
  p: [0, 0, z] as [number, number, number],
}))
/** gold bosses at the soffit-band crossings, repeated per bay */
const D_VAULT_BOSSES: InstItem[] = []
for (const bz of ARENA_VAULT_BAYS) {
  const open = ARENA_VAULT_OCULUS_BAYS.includes(bz)
  for (const b of VAULT_ARENA_BOSS) {
    if (open && Math.abs(Math.atan2(b.p[1], b.p[0]) - Math.PI / 2) < 0.24) continue
    D_VAULT_BOSSES.push({ p: [b.p[0], b.p[1], b.p[2] + bz], r: b.r, s: b.s })
  }
}
/** intermediate gold bands, offset half a bay from the structural ribs */
const D_VAULT_BAND: InstItem[] = [165, 175, 185, 195, 205, 215, 225].map((z) => ({
  p: [0, 0, z] as [number, number, number],
}))
/** springing course: a corbel block every 5 m carrying the vault off the wall */
const D_VAULT_CORBEL: InstItem[] = []
const D_VAULT_SPRINGER: InstItem[] = []
{
  const sx = 30 * Math.cos(ARENA_VAULT_A0)
  const sy = 30 * Math.sin(ARENA_VAULT_A0)
  for (let z = 167.5; z <= 222.5; z += 5) {
    D_VAULT_CORBEL.push({ p: [sx + 0.55, sy - 0.75, z], s: [1.9, 1.5, 1.7] })
    D_VAULT_CORBEL.push({ p: [-sx - 0.55, sy - 0.75, z], s: [1.9, 1.5, 1.7] })
  }
  D_VAULT_SPRINGER.push({ p: [sx - 0.1, sy, 195], r: [0, 0, ARENA_VAULT_A0], s: [1, 1, 60] })
  D_VAULT_SPRINGER.push({
    p: [-sx + 0.1, sy, 195],
    r: [0, 0, Math.PI - ARENA_VAULT_A0],
    s: [1, 1, 60],
  })
}
/**
 * Tympana and haunch — the two pieces a barrel vault cannot be built without.
 *
 * The vault springs at x ±27.9 / y 11 while the walls stop at y 10, so without
 * a haunch course there is a sliver of open sky running the whole length of
 * both long walls; and a barrel is open at BOTH ENDS, so without a tympanum
 * there is a 56 m wide, 19 m tall hole above each end wall. Both are sealed
 * here: a continuous haunch fillet on all four sides, and a gable wall at each
 * end carrying a recessed rose with a gold ring — the part of each rectangle
 * that falls outside the cylinder is simply hidden behind the vault.
 */
const D_VAULT_HAUNCH: InstItem[] = [
  { p: [28.85, 10.35, 195], s: [2.5, 1.9, 60] },
  { p: [-28.85, 10.35, 195], s: [2.5, 1.9, 60] },
  { p: [0, 10.35, 165.9], s: [60, 1.9, 2.5] },
  { p: [0, 10.35, 224.1], s: [60, 1.9, 2.5] },
]
const D_TYMPANUM: InstItem[] = [
  { p: [0, 20.4, 165.3], s: [60, 21, 0.7] },
  { p: [0, 20.4, 224.7], s: [60, 21, 0.7] },
]
/** the lunette's own vertical fall-off — see WALL_FIELD_BOX for why this is
 *  baked rather than lit. Local y maps to world `y * 21 + 20.4`. */
const TYMPANUM_BOX = bakeGradient(PANEL_BOX, [
  [-0.5, 0.78],
  [-0.3, 0.92],
  [-0.1, 1.0],
  [0.16, 0.8],
  [0.36, 0.54],
  [0.5, 0.44],
])
const D_TYMPANUM_ROSE: InstItem[] = []
const D_TYMPANUM_RING: InstItem[] = []
const D_TYMPANUM_SPOKE: InstItem[] = []
/**
 * R5 — the end lunettes stop being flat slabs.
 *
 * In 18_arena_wide the largest single shape in the upper frame is one 60 x 21 m
 * pale plate with a small wheel drawn on it: the one place in the arena where
 * the eye has nothing to resolve. It now carries a real wheel window — a
 * projecting gold archivolt with a course of 28 radiating voussoirs around it,
 * each block alternating ivory and gold-edged so the ring reads as masonry at
 * 40 m — and the plate itself is graded so it falls away toward the crown
 * instead of holding one value across a third of the frame.
 */
const D_TYMPANUM_ARCHIVOLT: InstItem[] = []
const D_TYMPANUM_VOUSSOIR: InstItem[] = []
const D_TYMPANUM_VOUSSOIR_B: InstItem[] = []
for (const [tz, face] of [[165.3, 1], [224.7, -1]] as [number, number][]) {
  D_TYMPANUM_ARCHIVOLT.push({
    p: [0, 18.5, tz + face * 0.6],
    r: [0, face > 0 ? 0 : Math.PI, 0],
    s: [9.6, 9.6, 16],
  })
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2 + Math.PI / 28
    const it: InstItem = {
      p: [Math.cos(a) * 10.35, 18.5 + Math.sin(a) * 10.35, tz + face * 0.46],
      r: [0, 0, a],
      s: [1.55, 0.98, 0.52],
    }
    ;(i % 2 === 0 ? D_TYMPANUM_VOUSSOIR : D_TYMPANUM_VOUSSOIR_B).push(it)
  }
}
for (const [tz, face] of [[165.3, 1], [224.7, -1]] as [number, number][]) {
  D_TYMPANUM_ROSE.push({
    p: [0, 18.5, tz + face * 0.38],
    r: [0, face > 0 ? 0 : Math.PI, 0],
    s: [11.5, 11.5, 1],
  })
  for (const r of [5.9, 4.2, 2.4]) {
    D_TYMPANUM_RING.push({
      p: [0, 18.5, tz + face * 0.52],
      r: [0, face > 0 ? 0 : Math.PI, 0],
      s: [r, r, 14],
    })
  }
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2
    D_TYMPANUM_SPOKE.push({
      p: [Math.cos(a) * 4.1, 18.5 + Math.sin(a) * 4.1, tz + face * 0.5],
      r: [0, 0, a],
      s: [3.6, 0.22, 0.16],
    })
  }
}

/** gold kerb framing the ridge oculus (z 185..205, x ±7.9) */
const D_OCULUS_FRAME: InstItem[] = [
  { p: [7.9, 28.75, 195], s: [0.5, 0.75, 20.6] },
  { p: [-7.9, 28.75, 195], s: [0.5, 0.75, 20.6] },
  { p: [0, 28.75, 185.1], s: [16.3, 0.75, 0.5] },
  { p: [0, 28.75, 204.9], s: [16.3, 0.75, 0.5] },
]

/**
 * R3 — the arena's silhouette landmark, suspended.
 *
 * The round-2 landmark was seated on the west cornice, which is outside the
 * new vault and therefore no longer in the room. The arena's read now comes
 * from a hanging reliquary armature: three stacked gold rings around an ivory
 * core, a long inverted spire and a lit socket, slung on four cables from the
 * ridge just off the oculus axis. It is the one object in the level that is
 * big, off-centre, lit from behind by the oculus and impossible to confuse
 * with anything else — which is the entire job of a landmark.
 */
const ARENA_HANG: [number, number, number] = [-7.2, 0, 193]
const D_HANG_CABLE: InstItem[] = []
for (let i = 0; i < 4; i++) {
  const a = (i / 4) * Math.PI * 2 + Math.PI / 4
  const ox = Math.cos(a) * 2.6
  const oz = Math.sin(a) * 2.6
  const topY = Math.sqrt(Math.max(1, 30 * 30 - (ARENA_HANG[0] + ox) * (ARENA_HANG[0] + ox)))
  const len = topY - 19.6
  D_HANG_CABLE.push({
    p: [ARENA_HANG[0] + ox, 19.6 + len / 2, ARENA_HANG[2] + oz],
    s: [0.55, len, 0.55],
  })
}
const D_HANG_RINGS: InstItem[] = [
  { p: [ARENA_HANG[0], 19.2, ARENA_HANG[2]], r: [Math.PI / 2, 0, 0], s: [5.2, 5.2, 28] },
  { p: [ARENA_HANG[0], 17.4, ARENA_HANG[2]], r: [Math.PI / 2, 0.45, 0.2], s: [4.1, 4.1, 24] },
  { p: [ARENA_HANG[0], 15.6, ARENA_HANG[2]], r: [Math.PI / 2, -0.3, -0.16], s: [2.9, 2.9, 20] },
]
const D_HANG_CORE: InstItem[] = [
  { p: [ARENA_HANG[0], 18.4, ARENA_HANG[2]], s: [3.0, 2.4, 3.0] },
  { p: [ARENA_HANG[0], 20.0, ARENA_HANG[2]], s: [3.9, 1.0, 3.9] },
]
const D_HANG_FIN: InstItem[] = []
for (let i = 0; i < 8; i++) {
  const a = (i / 8) * Math.PI * 2
  D_HANG_FIN.push({
    p: [ARENA_HANG[0] + Math.cos(a) * 1.9, 18.6, ARENA_HANG[2] + Math.sin(a) * 1.9],
    r: [0, Math.PI / 2 - a, 0],
    s: [0.24, 3.4, 1.1],
  })
}

/**
 * R3 — coffered soffits under both arena galleries. A 5 m deep overhang with a
 * flat underside is a shelf; with sunken coffers and a gold edge it is a
 * loggia, and the dark band it throws is the strongest horizontal in the room.
 */
const D_GALLERY_SOFFIT: InstItem[] = ARENA_GALLERIES.map((g) => {
  const c = boxCenter(g)
  return {
    p: [c[0], g.y0 - 0.02, c[2]] as [number, number, number],
    s: [g.x1 - g.x0 - 0.2, 1, g.z1 - g.z0 - 0.15] as [number, number, number],
  }
})
const D_GALLERY_FASCIA: InstItem[] = ARENA_GALLERIES.map((g) => {
  const c = boxCenter(g)
  const inner = g.z0 < 195 ? g.z1 + 0.06 : g.z0 - 0.06
  return {
    p: [c[0], g.y0 + 0.35, inner] as [number, number, number],
    s: [g.x1 - g.x0, 1.5, 0.28] as [number, number, number],
  }
})

/**
 * Pendant lamp assemblies hung from the vault on long rods. They are the one
 * piece of ornament that lives in the MIDDLE of the frame at eye-line depth,
 * so a wide arena shot has foreground, midground and a lit ceiling instead of
 * a floor and a wall. Each one is a source for a pooled gold practical.
 */
const D_PENDANT_POS: [number, number, number][] = []
for (const z of [178, 195, 212]) {
  for (const x of [-13, 13]) D_PENDANT_POS.push([x, 12.6, z])
}
D_PENDANT_POS.push([0, 14.5, 174], [0, 14.5, 216])
const D_PENDANT_ROD: InstItem[] = D_PENDANT_POS.map(([x, y, z]) => {
  // the rod reaches the vault soffit directly above, so nothing hangs from air
  const top = Math.sqrt(Math.max(1, 30 * 30 - x * x))
  const len = top - y
  return { p: [x, y + len / 2, z] as [number, number, number], s: [1, len, 1] as [number, number, number] }
})
const D_PENDANT_HOOD: InstItem[] = D_PENDANT_POS.map(([x, y, z]) => ({
  p: [x, y, z] as [number, number, number],
  s: [1.35, 1.35, 1.35] as [number, number, number],
}))
const D_PENDANT_COLLAR: InstItem[] = D_PENDANT_POS.map(([x, y, z]) => ({
  p: [x, y + 0.42, z] as [number, number, number],
  s: [1.3, 1.3, 1.3] as [number, number, number],
}))
const D_PENDANT_LENS: InstItem[] = D_PENDANT_POS.map(([x, y, z]) => ({
  p: [x, y - 0.42, z] as [number, number, number],
  s: [1.1, 0.8, 1.1] as [number, number, number],
}))
const D_PENDANT_RING: InstItem[] = D_PENDANT_POS.map(([x, y, z]) => ({
  p: [x, y - 0.34, z] as [number, number, number],
  r: [Math.PI / 2, 0, 0] as [number, number, number],
  s: [0.72, 0.72, 10] as [number, number, number],
}))

/**
 * Deep portal reveals. Every threshold in the level was a hole in a 1 m wall:
 * no jamb, no soffit, no archivolt — a doorway cut in cardboard. Each gets a
 * pair of stepped jambs, a coffered head reveal, a gold archivolt and a
 * keystone, all sitting inside the existing opening so no collider moves.
 */
const PORTAL_JAMB: InstItem[] = []
const PORTAL_JAMB_STEP: InstItem[] = []
const PORTAL_HEAD: InstItem[] = []
const PORTAL_SOFFIT: InstItem[] = []
const PORTAL_ARCHIVOLT: InstItem[] = []
const PORTAL_KEYSTONE: InstItem[] = []
for (const [pz, hw, hh, _dir] of PORTALS) {
  void _dir
  for (const sx of [1, -1]) {
    PORTAL_JAMB.push({ p: [sx * (hw + 0.62), hh / 2, pz], s: [1.24, hh + 1.5, 2.6] })
    PORTAL_JAMB_STEP.push({ p: [sx * (hw + 0.2), hh / 2 - 0.2, pz], s: [0.42, hh, 3.0] })
    PORTAL_ARCHIVOLT.push({
      p: [sx * (hw + 0.08), hh / 2, pz + 1.45],
      r: [Math.PI / 2, 0, 0],
      s: [1, 1, hh + 1.1],
    })
  }
  PORTAL_HEAD.push({ p: [0, hh + 1.0, pz], s: [2 * hw + 2.9, 1.5, 2.6] })
  PORTAL_SOFFIT.push({ p: [0, hh + 0.02, pz], s: [2 * hw - 0.1, 1, 2.4] })
  PORTAL_ARCHIVOLT.push({
    p: [0, hh + 0.12, pz + 1.45],
    r: [0, Math.PI / 2, 0],
    s: [1, 1, 2 * hw + 0.3],
  })
  PORTAL_KEYSTONE.push({ p: [0, hh + 0.75, pz + 1.4], s: [0.85, 1.25, 0.85] })
}

function PortalReveals() {
  return (
    <group>
      <Instanced geometry={PANEL_BOX} material={ivoryContactMaterial()} items={PORTAL_JAMB} castShadow />
      <Instanced geometry={RBOX} material={umberMaterial()} items={PORTAL_JAMB_STEP} castShadow />
      <Instanced geometry={PANEL_BOX} material={ivoryContactMaterial()} items={PORTAL_HEAD} castShadow />
      <Instanced geometry={SOFFIT_PORTAL} material={ivoryContactMaterial()} items={PORTAL_SOFFIT} />
      <Instanced geometry={TRIM_RUN} material={goldMaterial()} items={PORTAL_ARCHIVOLT} />
      <Instanced geometry={OCTA} material={goldPolishedMaterial()} items={PORTAL_KEYSTONE} castShadow />
    </group>
  )
}

function ZoneD() {
  return (
    <group>
      {/* floor + medallion */}
      <MassMesh spec={{ x0: -30, y0: -1, z0: 165, x1: 30, y1: 0, z1: 225 }} material={floorMaterial()} />
      <Instanced geometry={BOX} material={umberMaterial()} items={D_FLOOR_UMBER} receiveShadow />
      {/* R4 — flush slab joints: the 60x60 deck is paved on an irregular
          course instead of being one poured plane */}
      <Instanced geometry={BOX} material={recessMaterial()} items={D_PAVING} />
      {/* R5 — flush deck services: sunk sump pans under gold grilles, and
          bolted access hatches. Near-field floor detail for the third of the
          frame an arena wide spends on bare deck. */}
      <Instanced geometry={BOX} material={recessMaterial()} items={D_GRATE_PAN} receiveShadow />
      <Instanced geometry={BOX} material={umberMaterial()} items={D_GRATE_KERB} receiveShadow />
      <Instanced geometry={BOX} material={goldEdgeMaterial()} items={D_GRATE_BAR} receiveShadow castShadow />
      <Instanced geometry={CIRCLE} material={umberMaterial()} items={D_HATCH_PLATE} receiveShadow />
      <Instanced geometry={RING_GEO} material={goldPolishedMaterial()} items={D_HATCH_RING} receiveShadow />
      <Instanced geometry={BOX} material={goldCastMaterial()} items={D_HATCH_STUD} receiveShadow castShadow />
      {/* emissive radial-groove etching (fix2): concentric rings + rays from
          arena center, low-intensity gold so it never bloom-blows */}
      <mesh
        geometry={CIRCLE}
        material={arenaGrooveMaterial()}
        position={[0, 0.022, 195]}
        rotation={[-Math.PI / 2, 0, 0]}
        scale={[28.6, 28.6, 1]}
      />
      {/* R2 — the mandala is INLAID, not painted: recessed channels cut into
          the deck with gold sunk inside them, so it self-shadows and picks up
          a specular ramp instead of reading as a sticker. */}
      <Instanced geometry={MANDALA_CHANNEL} material={recessMaterial()} items={D_MANDALA_CHANNEL} />
      <Instanced geometry={MANDALA_INLAY} material={goldPolishedMaterial()} items={D_MANDALA_INLAY} />
      <Instanced geometry={BOX} material={recessMaterial()} items={D_MANDALA_SPOKE_CH} />
      <Instanced geometry={BOX} material={goldPolishedMaterial()} items={D_MANDALA_SPOKE_IN} />
      {/* the rings and petals are GILDED INLAY, not energy and not rope — a
          sunk channel with a polished band flush inside it, so the near field
          of every arena frame reads as gilding in stone. */}
      <Instanced geometry={MEDAL_CHANNEL} material={recessMaterial()} items={D_MEDAL_CHANNEL} />
      <Instanced geometry={MEDAL_INLAY} material={goldPolishedMaterial()} items={D_MEDAL_RINGS} />
      <Instanced geometry={MEDAL_PETAL} material={recessMaterial()} items={D_MEDAL_PETAL_CH} />
      <Instanced geometry={MEDAL_PETAL} material={goldPolishedMaterial()} items={D_MEDAL_PETALS} />
      <mesh geometry={CIRCLE} material={medallionMaterial()} position={[0, 0.04, 195]} rotation={[-Math.PI / 2, 0, 0]} scale={[2.2, 2.2, 1]} />

      {/* walls in three registers — R4. The FIELD is set 0.5 m back into the
          wall's own thickness; the dado, the piers and the attic band stand at
          the original face, so every bay is a real recess that self-shadows
          under a low key instead of a flat plane wearing appliqué. */}
      {D_WALL_FIELD.map((w, i) => (
        <MassMesh
          key={i}
          spec={w}
          geometry={w.y1 - w.y0 >= 8 ? WALL_FIELD_BOX : PANEL_BOX}
          material={ivoryContactMaterial()}
          receiveShadow
          castShadow
        />
      ))}
      {/* R5 — the dado is a DARK panelled register: umber ground, sunk panels
          framed by projecting gold-edged stiles and rails, an obsidian skirting
          at the contact line and a gold cap moulding at 2.3 m. Everything a
          trooper is seen against at play height is now a value darker than the
          trooper. */}
      <Instanced geometry={PLINTH_BOX} material={umberMaterial()} items={D_WALL_DADO} receiveShadow castShadow />
      <Instanced geometry={BOX} material={obsidianMaterial()} items={D_DADO_PLINTH} receiveShadow castShadow />
      <Instanced geometry={BOX} material={recessMaterial()} items={D_DADO_PANEL} receiveShadow />
      <Instanced geometry={BOX} material={goldEdgeMaterial()} items={D_DADO_STILE} receiveShadow castShadow />
      <Instanced geometry={TRIM_RUN} material={goldMaterial()} items={D_DADO_CAP} receiveShadow castShadow />
      <Instanced geometry={WALL_PIER_BOX} material={ivoryContactMaterial()} items={D_WALL_PIER} receiveShadow castShadow />
      <Instanced geometry={PANEL_BOX} material={ivoryContactMaterial()} items={D_WALL_ATTIC} receiveShadow castShadow />
      {/* clerestory blind arcade on a 3.2 m pitch — coprime with the order
          below, so the two registers never stack into one grid */}
      <Instanced geometry={BOX} material={recessMaterial()} items={D_CLERE_RECESS} />
      <Instanced geometry={COFFER_PANEL} material={cofferMaterial()} items={D_CLERE_ARCH} />
      <Instanced geometry={RBOX} material={umberMaterial()} items={D_BASE} receiveShadow />
      <Instanced geometry={TRIM_RUN} material={goldMaterial()} items={D_CORNICE} />
      <Instanced geometry={BOX} material={goldMaterial()} items={D_WALL_TRIM} />
      <Instanced geometry={BOX} material={goldMaterial()} items={D_WALL_PILASTERS} />
      <Instanced geometry={BOX} material={goldMaterial()} items={D_PILASTER_NOSING} />
      <Instanced geometry={BOX} material={goldEdgeMaterial()} items={D_PILASTER_NOSING_LIP} />
      <Instanced geometry={BOX} material={recessMaterial()} items={D_WALL_BANDS} />
      <Instanced geometry={BOX} material={recessMaterial()} items={D_PILASTER_FLANK} />
      {/* engaged fluted colonnade: lathed shafts, plinths, gold neckings and
          capitals — ornament bought with geometry, not painted stripes */}
      <Instanced geometry={PLINTH_BOX} material={ivoryContactMaterial()} items={D_COLUMN_PLINTH} castShadow />
      <Instanced geometry={COLUMN_ENGAGED} material={ivoryMaterial()} items={D_COLUMN} castShadow />
      <Instanced geometry={TRIM_RUN_FINE} material={goldPolishedMaterial()} items={D_COLUMN_NECK} />
      <Instanced geometry={RBOX} material={goldCastMaterial()} items={D_COLUMN_CAP} castShadow />
      <Instanced geometry={FRET_PANEL} material={fretTrimMaterial()} items={D_WALL_FRET} />
      <Instanced geometry={FRET_PANEL} material={fretTrimMaterial()} items={D_FRET_PLINTH} />
      <Instanced geometry={FRET_PANEL} material={fretTrimMaterial()} items={D_FRET_HEAD} />
      <Instanced geometry={BOX} material={recessMaterial()} items={D_WALL_CHANNEL} />
      <Instanced geometry={BOX} material={veinTealMaterial()} items={D_WALL_INSETS} />

      {/* R2 ornament parity with the shrine: pierced screens on the lower
          register, coffers above, a junction angle, corbel framing */}
      <Instanced geometry={BOX} material={recessMaterial()} items={D_SCREEN_BACK} />
      {D_SCREENS_V.map((items, i) => (
        <Instanced key={i} geometry={SCREEN_VARIANTS[i]} material={screenMaterial()} items={items} castShadow />
      ))}
      {/* R7 — the suppressed bays: a dark cavity with one sunk blind panel in
          it, so roughly a quarter of the wall's bays carry no kit at all */}
      <Instanced geometry={BOX} material={recessMaterial()} items={D_BLIND_BACK} receiveShadow />
      <Instanced geometry={PANEL_BOX} material={ivoryContactMaterial()} items={D_BLIND_PANEL} receiveShadow castShadow />
      {/* R5 — cornice hood on two consoles over every screen bay: the one
          thing that puts a hard horizontal band of shade across the tiled
          field, because it stands 0.62 m off it. */}
      <Instanced geometry={RBOX} material={ivoryContactMaterial()} items={D_BAY_CONSOLE} receiveShadow castShadow />
      <Instanced geometry={PANEL_BOX} material={ivoryContactMaterial()} items={D_BAY_HOOD} receiveShadow castShadow />
      <Instanced geometry={BOX} material={goldEdgeMaterial()} items={D_BAY_HOOD_LIP} receiveShadow castShadow />
      <Instanced geometry={BOX} material={recessMaterial()} items={D_COFFER_BACK} />
      <Instanced geometry={COFFER_PANEL} material={cofferMaterial()} items={D_COFFERS} castShadow />
      <Instanced geometry={L_TRIM_RUN} material={goldMaterial()} items={D_LTRIM} />
      {/* corbel course, jittered: ±8 % in size, ±6 cm in height, ±5° in yaw.
          A cornice of 32 identical blocks at a perfect pitch is the single
          most obvious stamp in a wide shot; this costs nothing at runtime. */}
      <Instanced
        geometry={RBOX}
        material={ivoryMaterial()}
        items={D_CORBELS_J}
        castShadow
      />

      {/* R4 — the arena's asymmetric hero mass: a canted buttress corbelled
          off the west wall in the wide bay, leaning out over the floor, and
          its non-matching answer on the east wall (a framed aedicule sunk in
          the recess with a figure on a plinth). */}
      <Instanced geometry={RBOX} material={ivoryContactMaterial()} items={D_BUTT_CORBEL} castShadow />
      <Instanced geometry={PANEL_BOX} material={ivoryContactMaterial()} items={D_BUTT_SHAFT} castShadow />
      <Instanced geometry={BOX} material={goldPolishedMaterial()} items={D_BUTT_BAND} />
      <Instanced geometry={RBOX} material={goldCastMaterial()} items={D_BUTT_HOOD} castShadow />
      <Instanced geometry={BOX} material={goldMaterial()} items={D_BUTT_FIN} castShadow />
      <Instanced geometry={BOX} material={recessMaterial()} items={D_AED_BACK} />
      <Instanced geometry={BOX} material={goldMaterial()} items={D_AED_FRAME} />
      <Instanced geometry={PLINTH_BOX} material={ivoryContactMaterial()} items={D_AED_PLINTH} castShadow />
      <Instanced geometry={VOTARY_GEO} material={ivoryContactMaterial()} items={D_AED_FIGURE} receiveShadow castShadow />
      <Instanced geometry={BEAD_RING} material={goldCastMaterial()} items={D_AED_COLLAR} receiveShadow castShadow />
      <Instanced geometry={RING_GEO} material={goldPolishedMaterial()} items={D_AED_HALO} receiveShadow />

      {/* perimeter practicals: a modelled bracket + hood + recessed lens at
          every fixture the pooled gold point lights ride, so each pool of
          light on the deck has a visible source above it */}
      <Instanced geometry={RBOX} material={goldMaterial()} items={D_SCONCE_BRACKET} />
      <Instanced geometry={RBOX} material={goldPolishedMaterial()} items={D_SCONCE_HOOD} />
      <Instanced geometry={BOX} material={veinGoldMaterial()} items={D_SCONCE_LENS} />

      {/* the arena's vertical landmark — off-centre, above the cornice line */}
      <Instanced geometry={RBOX} material={ivoryMaterial()} items={D_LANDMARK_BRACE} castShadow />
      <Instanced geometry={RBOX} material={umberMaterial()} items={D_LANDMARK_PLINTH} castShadow />
      <Instanced
        geometry={PANEL_BOX}
        material={ivoryContactMaterial()}
        items={D_LANDMARK_SHAFT}
        castShadow
      />
      <Instanced geometry={BOX} material={goldMaterial()} items={D_LANDMARK_FLUTE} />
      <Instanced geometry={BOX} material={goldPolishedMaterial()} items={D_LANDMARK_BANDS} />
      <mesh
        geometry={OCTA}
        material={goldPolishedMaterial()}
        position={[LANDMARK[0], 23.0, LANDMARK[2]]}
        scale={[1.5, 2.1, 1.5]}
        castShadow
      />
      <mesh
        geometry={CIRCLE}
        material={veinGoldMaterial()}
        position={[LANDMARK[0], 21.72, LANDMARK[2]]}
        rotation={[-Math.PI / 2, 0, 0]}
        scale={[1.5, 1.5, 1]}
      />

      {/* massive arch-ribs — swept gold moulding, contact-AO feet */}
      <Instanced
        geometry={RIB_ARENA_AO}
        material={ivoryContactMaterial()}
        items={D_RIBS}
        receiveShadow
        castShadow
      />
      <Instanced geometry={ARCH_TRIM_ARENA} material={goldMaterial()} items={D_RIBS} />
      <Instanced geometry={ARCH_TRIM_ARENA_IN} material={goldPolishedMaterial()} items={D_RIBS} />

      {/* R3 — the coffered vault. It receives (the ribs and the landmark throw
          across it) but deliberately does NOT cast: a closed 60 m shell in the
          shadow pass would put the whole arena floor in permanent shade and
          undo the round-2 shadow fix. */}
      <Instanced geometry={VAULT_ARENA} material={ivoryContactMaterial()} items={D_VAULT_BAYS} />
      <Instanced geometry={VAULT_ARENA_OPEN} material={ivoryContactMaterial()} items={D_VAULT_OPEN_BAYS} />
      <Instanced geometry={VAULT_ARENA_BAND} material={goldMaterial()} items={D_VAULT_BAND} />
      <Instanced geometry={OCTA} material={goldPolishedMaterial()} items={D_VAULT_BOSSES} />
      <Instanced geometry={RBOX} material={ivoryMaterial()} items={D_VAULT_CORBEL} castShadow />
      <Instanced geometry={TRIM_RUN} material={goldMaterial()} items={D_VAULT_SPRINGER} />
      <Instanced geometry={BOX} material={goldMaterial()} items={D_OCULUS_FRAME} />
      {/* haunch course + end tympana with a recessed gold rose */}
      <Instanced geometry={RBOX} material={ivoryMaterial()} items={D_VAULT_HAUNCH} castShadow />
      <Instanced geometry={TYMPANUM_BOX} material={ivoryContactMaterial()} items={D_TYMPANUM} receiveShadow />
      <Instanced geometry={CIRCLE} material={recessMaterial()} items={D_TYMPANUM_ROSE} receiveShadow />
      {/* radiating voussoir course + projecting archivolt around the wheel */}
      <Instanced geometry={RBOX} material={ivoryMaterial()} items={D_TYMPANUM_VOUSSOIR} receiveShadow castShadow />
      <Instanced geometry={RBOX} material={goldCastMaterial()} items={D_TYMPANUM_VOUSSOIR_B} receiveShadow castShadow />
      <Instanced geometry={RING_GEO} material={goldPolishedMaterial()} items={D_TYMPANUM_ARCHIVOLT} receiveShadow />
      <Instanced geometry={RING_GEO} material={goldPolishedMaterial()} items={D_TYMPANUM_RING} />
      <Instanced geometry={BOX} material={goldMaterial()} items={D_TYMPANUM_SPOKE} />

      {/* pendant lamps on long rods — midground ornament at eye line */}
      <Instanced geometry={PENDANT_ROD} material={goldMaterial()} items={D_PENDANT_ROD} castShadow />
      <Instanced geometry={PENDANT_HOOD} material={goldCastMaterial()} items={D_PENDANT_HOOD} castShadow />
      <Instanced geometry={PENDANT_COLLAR} material={goldPolishedMaterial()} items={D_PENDANT_COLLAR} />
      <Instanced geometry={PENDANT_LENS} material={veinGoldMaterial()} items={D_PENDANT_LENS} />
      <Instanced geometry={RING_GEO} material={goldPolishedMaterial()} items={D_PENDANT_RING} />

      {/* the suspended reliquary landmark under the ridge oculus */}
      <Instanced geometry={PENDANT_ROD} material={goldMaterial()} items={D_HANG_CABLE} castShadow />
      <Instanced geometry={RING_GEO} material={goldPolishedMaterial()} items={D_HANG_RINGS} castShadow />
      <Instanced geometry={ICOSA} material={ivoryMaterial()} items={D_HANG_CORE} castShadow />
      <Instanced geometry={BOX} material={goldCastMaterial()} items={D_HANG_FIN} castShadow />
      <mesh
        geometry={OCTA}
        material={goldCastMaterial()}
        position={[ARENA_HANG[0], 15.0, ARENA_HANG[2]]}
        scale={[1.5, 4.6, 1.5]}
        castShadow
      />
      <mesh
        geometry={PENDANT_LENS}
        material={veinGoldMaterial()}
        position={[ARENA_HANG[0], 17.4, ARENA_HANG[2]]}
        scale={[2.6, 2.6, 2.6]}
      />

      {/* coffered gallery soffits + fascia */}
      <Instanced geometry={SOFFIT_WIDE} material={ivoryContactMaterial()} items={D_GALLERY_SOFFIT} />
      <Instanced geometry={PANEL_BOX} material={ivoryContactMaterial()} items={D_GALLERY_FASCIA} castShadow />

      <PortalReveals />

      {/* upper galleries */}
      {ARENA_GALLERIES.map((g, i) => (
        <MassMesh key={i} spec={g} material={floorMaterial()} castShadow />
      ))}
      <Instanced geometry={BOX} material={goldMaterial()} items={D_GALLERY_TRIM} />
      <Instanced geometry={BOX} material={goldEdgeMaterial()} items={D_GALLERY_TRIM_EDGE} />

      {/* elevation layers around the portal ring (fix2): broken platforms +
          floating megaliths — landable, colliders in layout.ts */}
      <Instanced geometry={RBOX} material={floorMaterial()} items={D_MEGA_BODY} receiveShadow castShadow />
      <Instanced geometry={BOX} material={goldMaterial()} items={D_MEGA_RIM} />
      <Instanced geometry={RBOX} material={ivoryMaterial()} items={D_MEGA_UNDER} castShadow />
      <Instanced geometry={BOX} material={veinGoldMaterial()} items={D_MEGA_GLOW} />
      <Instanced geometry={ROCK} material={rockMaterial()} items={D_MEGA_FRAGS} />

      {/* wall-run slabs to the gallery */}
      {ARENA_WALLRUN_SLABS.map((s, i) => (
        <MassMesh key={i} spec={s} material={ivoryMaterial()} castShadow />
      ))}
      <Instanced geometry={BOX} material={veinGoldMaterial()} items={D_SLAB_VEINS} />

      {/* cover: pylons, low walls, planters */}
      {/* R5 — the pylons are a standing order, not a box: lathed base and
          capital, four engaged colonnettes, a two-stage tapered core and the
          vein sunk in a channel on every face. This is the near-field
          geometry in every combat frame. */}
      <Instanced geometry={PYLON_BASE_GEO} material={umberMaterial()} items={D_PYLON_BASE} receiveShadow castShadow />
      <Instanced geometry={RBOX} material={obsidianMaterial()} items={D_PYLON_ITEMS} receiveShadow castShadow />
      <Instanced geometry={RBOX} material={obsidianMaterial()} items={D_PYLON_UPPER} receiveShadow castShadow />
      <Instanced geometry={COLONNETTE_GEO} material={goldCastMaterial()} items={D_PYLON_COLONNETTE} receiveShadow castShadow />
      <Instanced geometry={PYLON_CAP_GEO} material={ivoryMaterial()} items={D_PYLON_CAPITAL} receiveShadow castShadow />
      <Instanced geometry={BOX} material={goldMaterial()} items={D_PYLON_CAPS} receiveShadow castShadow />
      <Instanced geometry={TRIM_RUN_FINE} material={goldPolishedMaterial()} items={D_PYLON_MOULD} receiveShadow />
      <Instanced geometry={BOX} material={recessMaterial()} items={D_PYLON_VEIN_CH} receiveShadow />
      <Instanced geometry={BOX} material={veinTealMaterial()} items={D_PYLON_VEINS} />
      <Instanced geometry={RBOX} material={obsidianMaterial()} items={D_LOW_WALLS} receiveShadow castShadow />
      <Instanced geometry={BOX} material={goldMaterial()} items={D_LOW_WALL_TOPS} />
      {ARENA_PLANTERS.map(([px, pz]) => (
        <Planter key={`${px},${pz}`} x={px} z={pz} />
      ))}

      {/* corruption set dressing */}
      <Instanced geometry={BOX} material={veinTealMaterial()} items={D_CORRUPTION} />
      {/* R5 — these two glyphs used to hang in mid-air 4-5 m off the arena
          walls, yawed 60-70 deg to them, which is map weakness E3 and reads in
          frame as a pale translucent rectangle floating in the room. A decal
          that is not ON a surface is not a decal. They are now corruption
          stains lying on the deck, above the inlay (y 0.022-0.05) and below
          nothing, so they cannot float and cannot z-fight. */}
      <mesh geometry={PLANE} material={glyphDecalMaterial()} position={[-23.6, 0.056, 181.5]} rotation={[-Math.PI / 2, 0, Math.PI / 3]} scale={[4.4, 4.4, 1]} receiveShadow />
      <mesh geometry={PLANE} material={glyphDecalMaterial()} position={[22.8, 0.056, 201.5]} rotation={[-Math.PI / 2, 0, -Math.PI / 2.5]} scale={[4, 4, 1]} receiveShadow />

      {/* enemy spawn gates */}
      <Instanced geometry={CIRCLE} material={obsidianMaterial()} items={D_GATE_DISCS} />
      <Instanced geometry={RING_GEO} material={goldMaterial()} items={D_GATE_FRAMES} />
      <Instanced geometry={RING_GEO} material={doorGlowMaterial()} items={D_GATE_GLOWS} />

      {/* bridge gate seal (dissolves at EXTRACT via EnvironmentFX → sealMaterial) */}
      <mesh geometry={RING_GEO} material={sealMaterial()} position={[0, 3, 224.85]} scale={[3, 3, 6]} />
      <mesh geometry={CIRCLE} material={sealMaterial()} position={[0, 3, 224.85]} scale={[2.9, 2.9, 1]} />
    </group>
  )
}

// ---------------------------------------------------------------------------
// Zone E — Extraction Bridge & Pad (z 225–265)
// ---------------------------------------------------------------------------
const E_RIBS: InstItem[] = []
for (const z of [229, 237, 245, 252]) E_RIBS.push({ p: [0, 0, z] })
const E_RAIL_POSTS: InstItem[] = []
for (let z = 226; z <= 252; z += 2) {
  E_RAIL_POSTS.push({ p: [-4.1, 0.5, z], s: [0.12, 1, 0.12] })
  E_RAIL_POSTS.push({ p: [4.1, 0.5, z], s: [0.12, 1, 0.12] })
}
// hanging keel fins + teal under-glow so the bridge void reads as depth
const E_FINS: InstItem[] = []
const E_UNDERGLOW: InstItem[] = []
for (let z = 227; z <= 251; z += 4) {
  E_FINS.push({ p: [0, -5.5, z], s: [0.5, 8, 1.6] })
  E_UNDERGLOW.push({ p: [-3.9, -1.06, z + 1], s: [0.12, 0.1, 3.4] })
  E_UNDERGLOW.push({ p: [3.9, -1.06, z + 1], s: [0.12, 0.1, 3.4] })
}
E_FINS.push({ p: [0, -8, 258], s: [4, 15, 4] }) // pad root pier
const E_LTRIM: InstItem[] = [
  { p: [-3.98, 0.005, 239], r: [0, 0, 0], s: [1, 1, 27.6] },
  { p: [3.98, 0.005, 239], r: [0, Math.PI, 0], s: [1, 1, 27.6] },
]

/**
 * Extraction beacon — ignites at phase EXTRACT: vertical gold light column,
 * rotating glyph rings, orbiting ember particles (environment.md §2 zone E).
 */
function Beacon() {
  const group = useRef<THREE.Group>(null!)
  const ringA = useRef<THREE.Mesh>(null!)
  const ringB = useRef<THREE.Mesh>(null!)
  const embers = useRef<THREE.Points>(null!)
  const colMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uOn: { value: 0 } },
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
        `,
        fragmentShader: /* glsl */ `
          varying vec2 vUv;
          uniform float uTime;
          uniform float uOn;
          void main() {
            float fade = pow(1.0 - vUv.y, 1.7);
            float breathe = 0.85 + 0.15 * sin(uTime * 2.0);
            vec3 col = mix(vec3(1.0, 0.72, 0.21), vec3(1.0, 0.95, 0.84), fade);
            gl_FragColor = vec4(col, fade * 0.55 * breathe * uOn);
          }
        `,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    [],
  )
  const emberGeom = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(60 * 3), 3))
    return g
  }, [])

  useFrame((state, dt) => {
    const s = useGameStore.getState()
    const on = s.phase === 'EXTRACT' || s.phase === 'WIN'
    const t = state.clock.elapsedTime
    colMat.uniforms.uOn.value = THREE.MathUtils.lerp(colMat.uniforms.uOn.value, on ? 1 : 0, 1 - Math.exp(-2.5 * dt))
    group.current.visible = on || colMat.uniforms.uOn.value > 0.01
    colMat.uniforms.uTime.value = t
    ringA.current.rotation.z = t * 0.6
    ringB.current.rotation.z = -t * 0.45
    const pos = emberGeom.attributes.position as THREE.BufferAttribute
    const arr = pos.array as Float32Array
    for (let i = 0; i < 60; i++) {
      const a = t * (0.4 + (i % 5) * 0.12) + i * 1.7
      const r = 1.8 + (i % 4) * 0.8
      arr[i * 3] = Math.cos(a) * r
      arr[i * 3 + 1] = ((t * 0.7 + i * 0.31) % 8) + 0.3
      arr[i * 3 + 2] = Math.sin(a) * r
    }
    pos.needsUpdate = true
  })

  return (
    <group ref={group} position={[EXTRACTION_PAD_POSITION.x, 0, EXTRACTION_PAD_POSITION.z]} visible={false}>
      <mesh material={colMat} position={[0, 20, 0]}>
        <cylinderGeometry args={[1.5, 1.5, 40, 20, 1, true]} />
      </mesh>
      <mesh ref={ringA} material={veinGoldMaterial()} geometry={RING_GEO} position={[0, 0.35, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[2.4, 2.4, 10]} />
      <mesh ref={ringB} material={veinGoldMaterial()} geometry={RING_GEO} position={[0, 0.8, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[3.2, 3.2, 8]} />
      <points ref={embers} geometry={emberGeom} frustumCulled={false}>
        <pointsMaterial color={COLORS.aureate} size={0.09} sizeAttenuation transparent opacity={0.9} blending={THREE.AdditiveBlending} depthWrite={false} />
      </points>
    </group>
  )
}

/**
 * R3 — extraction canopy. The final frame of the mission was a flat ivory
 * disc in a void with a light column on it. Four raking struts (planted off
 * the pad edge, where nothing walks, so no collider changes) carry a double
 * gold ring, a finial and four pendants over it: the pad now reads as a
 * consecrated berth rather than a placeholder cylinder.
 */
const E_CANOPY_STRUT: InstItem[] = [
  { p: [5.15, 4.2, 258], r: [0, 0, 0.35], s: [0.42, 10.4, 0.5] },
  { p: [-5.15, 4.2, 258], r: [0, 0, -0.35], s: [0.42, 10.4, 0.5] },
  { p: [0, 4.2, 263.15], r: [-0.35, 0, 0], s: [0.5, 10.4, 0.42] },
  { p: [0, 4.2, 252.85], r: [0.35, 0, 0], s: [0.5, 10.4, 0.42] },
]
const E_CANOPY_FOOT: InstItem[] = [
  { p: [6.6, -0.35, 258], s: [1.5, 1.1, 1.7] },
  { p: [-6.6, -0.35, 258], s: [1.5, 1.1, 1.7] },
  { p: [0, -0.35, 264.6], s: [1.7, 1.1, 1.5] },
  { p: [0, -0.35, 251.4], s: [1.7, 1.1, 1.5] },
]
const E_CANOPY_RING: InstItem[] = [
  { p: [0, 9.0, 258], r: [Math.PI / 2, 0, 0], s: [3.7, 3.7, 22] },
  { p: [0, 10.3, 258], r: [Math.PI / 2, 0, 0], s: [2.2, 2.2, 16] },
]
const E_CANOPY_PENDANT: [number, number, number][] = []
for (let i = 0; i < 4; i++) {
  const a = (i / 4) * Math.PI * 2 + Math.PI / 4
  E_CANOPY_PENDANT.push([Math.cos(a) * 2.9, 7.0, 258 + Math.sin(a) * 2.9])
}
const E_PENDANT_ROD: InstItem[] = E_CANOPY_PENDANT.map(([x, y, z]) => ({
  p: [x, (y + 9.0) / 2, z] as [number, number, number],
  s: [1, 9.0 - y, 1] as [number, number, number],
}))
const E_PENDANT_HOOD: InstItem[] = E_CANOPY_PENDANT.map(([x, y, z]) => ({
  p: [x, y, z] as [number, number, number],
  s: [1.1, 1.1, 1.1] as [number, number, number],
}))
const E_PENDANT_LENS: InstItem[] = E_CANOPY_PENDANT.map(([x, y, z]) => ({
  p: [x, y - 0.34, z] as [number, number, number],
  s: [0.9, 0.7, 0.9] as [number, number, number],
}))

/** R3 — the extraction bridge gets a ribbed tunnel vault with a continuous
 *  ridge slot, so the last 30 m of the mission is architecture rather than a
 *  plank over a void. Open along the crown, so the sky still reads. */
const E_VAULT: InstItem[] = BRIDGE_VAULT_BAYS.map((z) => ({ p: [0, 0, z] as [number, number, number] }))
const E_VAULT_KERB: InstItem[] = [
  { p: [1.78, 7.22, 239], s: [0.26, 0.4, 28] },
  { p: [-1.78, 7.22, 239], s: [0.26, 0.4, 28] },
]

function ZoneE() {
  return (
    <group>
      {/* bridge deck (textured) + under-keel */}
      <MassMesh spec={{ x0: -4, y0: -1, z0: 225, x1: 4, y1: 0, z1: 253 }} material={floorMaterial()} />
      <MassMesh spec={{ x0: -1.5, y0: -3.5, z0: 225, x1: 1.5, y1: -1, z1: 253 }} material={ivoryMaterial()} receiveShadow={false} />
      {/* descending keel fins + under-glow */}
      <Instanced geometry={RBOX} material={ivoryMaterial()} items={E_FINS} castShadow />
      <Instanced geometry={BOX} material={veinGoldMaterial()} items={E_UNDERGLOW} />
      {/* gold L-angle along both deck edges — the same junction trim the
          chamber and arena get, so the bridge reads as built, not extruded */}
      <Instanced geometry={L_TRIM_RUN} material={goldMaterial()} items={E_LTRIM} />
      {/* gold rails */}
      <Instanced geometry={BOX} material={goldMaterial()} items={E_RAIL_POSTS} />
      <mesh geometry={BOX} material={goldMaterial()} position={[-4.1, 1.02, 239]} scale={[0.14, 0.1, 27]} />
      <mesh geometry={BOX} material={goldMaterial()} position={[4.1, 1.02, 239]} scale={[0.14, 0.1, 27]} />
      {/* flanking arch-ribs */}
      <Instanced
        geometry={RIB_BRIDGE_AO}
        material={ivoryContactMaterial()}
        items={E_RIBS}
        receiveShadow
        castShadow
      />
      <Instanced geometry={ARCH_TRIM_BRIDGE} material={goldMaterial()} items={E_RIBS} />
      <Instanced geometry={VAULT_BRIDGE} material={ivoryContactMaterial()} items={E_VAULT} />
      {/* extraction canopy over the pad */}
      <Instanced geometry={RBOX} material={umberMaterial()} items={E_CANOPY_FOOT} castShadow />
      <Instanced geometry={RBOX} material={goldCastMaterial()} items={E_CANOPY_STRUT} castShadow />
      <Instanced geometry={RING_GEO} material={goldPolishedMaterial()} items={E_CANOPY_RING} castShadow />
      <mesh geometry={OCTA} material={goldPolishedMaterial()} position={[0, 11.3, 258]} scale={[0.9, 1.5, 0.9]} castShadow />
      <Instanced geometry={PENDANT_ROD} material={goldMaterial()} items={E_PENDANT_ROD} castShadow />
      <Instanced geometry={PENDANT_HOOD} material={goldCastMaterial()} items={E_PENDANT_HOOD} castShadow />
      <Instanced geometry={PENDANT_LENS} material={veinGoldMaterial()} items={E_PENDANT_LENS} />
      <Instanced geometry={BOX} material={goldMaterial()} items={E_VAULT_KERB} />
      {/* pad: ivory disc + gold ring + beacon socket */}
      <mesh geometry={CYL} material={ivoryMaterial()} position={[0, -0.5, 258]} scale={[6, 1, 6]} receiveShadow />
      <mesh geometry={RING_GEO} material={goldMaterial()} position={[0, 0.04, 258]} rotation={[Math.PI / 2, 0, 0]} scale={[5.4, 5.4, 10]} />
      <mesh geometry={CYL} material={goldMaterial()} position={[0, 0.15, 258]} scale={[1.8, 0.3, 1.8]} />
      <mesh geometry={CIRCLE} material={veinGoldMaterial()} position={[0, 0.32, 258]} rotation={[-Math.PI / 2, 0, 0]} scale={[1.5, 1.5, 1]} />
      <Beacon />
    </group>
  )
}

// ---------------------------------------------------------------------------
// Banners — chamber ×2 + arena ×4, cloth-sway shader (environment.md §5)
// ---------------------------------------------------------------------------
const BANNERS: InstItem[] = [
  { p: [-14.4, 5.5, 147], r: [0, Math.PI / 2, 0], s: [1.5, 6, 1] },
  { p: [14.4, 5.5, 153], r: [0, -Math.PI / 2, 0], s: [1.5, 6, 1] },
  { p: [-12, 6.5, 224.4], r: [0, Math.PI, 0], s: [1.5, 6, 1] },
  { p: [12, 6.5, 224.4], r: [0, Math.PI, 0], s: [1.5, 6, 1] },
  { p: [-12, 6.5, 165.6], r: [0, 0, 0], s: [1.5, 6, 1] },
  { p: [12, 6.5, 165.6], r: [0, 0, 0], s: [1.5, 6, 1] },
]

/**
 * R5 — the banners get hardware.
 *
 * Six of these hang in the chamber and the arena and every one of them is a
 * single `PlaneGeometry` in `bannerMaterial`, which is a `ShaderMaterial` with
 * no lighting term (map weakness E19). An unlit quad hanging in mid-air with
 * nothing holding it up is indistinguishable from an untextured white prop —
 * and it is one of the pale rectangles standing off the arena walls in the
 * review set. The cloth itself is another stream's material, so what is fixed
 * here is everything AROUND it: a cast rod on two wall brackets with turned
 * finials at the ends, a weighted hem bar at the bottom, and a dark lit plaque
 * seated on the wall behind, so the quad reads as cloth hung on ironwork in
 * front of a board rather than as a floating plane.
 *
 * Derived from BANNERS so the two can never drift; the plane's own yaw gives
 * the wall normal `(sin a, 0, cos a)`.
 */
const BANNER_ROD: InstItem[] = []
const BANNER_FINIAL: InstItem[] = []
const BANNER_BRACKET: InstItem[] = []
const BANNER_WEIGHT: InstItem[] = []
const BANNER_PLAQUE: InstItem[] = []
for (const b of BANNERS) {
  const a = (b.r ?? [0, 0, 0])[1]
  const [w, h] = b.s ?? [1, 1, 1]
  const nx = Math.sin(a)
  const nz = Math.cos(a)
  // the banner's width direction, perpendicular to the normal in the XZ plane
  const ux = Math.cos(a)
  const uz = -Math.sin(a)
  const topY = b.p[1] + h / 2 + 0.2
  const rodW = w + 0.55
  BANNER_ROD.push({
    p: [b.p[0] + nx * 0.1, topY, b.p[2] + nz * 0.1],
    r: [0, a, Math.PI / 2],
    s: [0.055, rodW, 0.055],
  })
  for (const e of [-1, 1]) {
    BANNER_FINIAL.push({
      p: [b.p[0] + nx * 0.1 + (ux * e * rodW) / 2, topY, b.p[2] + nz * 0.1 + (uz * e * rodW) / 2],
      r: [0, a, 0],
      s: [0.12, 0.2, 0.12],
    })
    BANNER_BRACKET.push({
      p: [b.p[0] - nx * 0.24 + ux * e * 0.62, topY - 0.06, b.p[2] - nz * 0.24 + uz * e * 0.62],
      r: [0, a, 0],
      s: [0.15, 0.17, 0.86],
    })
  }
  BANNER_WEIGHT.push({
    p: [b.p[0] + nx * 0.07, b.p[1] - h / 2 - 0.06, b.p[2] + nz * 0.07],
    r: [0, a, 0],
    s: [w + 0.16, 0.13, 0.13],
  })
  // A stiff dark board hung from the SAME rod, 12 cm behind the cloth, rather
  // than a plaque seated on the wall: the arena banners hang in front of the
  // pierced screen bays, and a wall-seated plate there would have fought the
  // screen's own backing board for the same 3 cm of depth.
  BANNER_PLAQUE.push({
    p: [b.p[0] - nx * 0.12, b.p[1], b.p[2] - nz * 0.12],
    r: [0, a, 0],
    s: [w + 0.34, h + 0.34, 0.09],
  })
}

// ---------------------------------------------------------------------------
// Distant monoliths (layout.MONOLITHS, visual-only) — beveled bodies with
// panel-line subdivision, gold trim insets, teal/gold emissive stripes and
// attached secondary masses so silhouettes never read as bare clay boxes.
// ---------------------------------------------------------------------------
const MONO_BODY: InstItem[] = []
const MONO_SECOND: InstItem[] = []
const MONO_PANELS: InstItem[] = []
const MONO_GOLD: InstItem[] = []
const MONO_TEAL: InstItem[] = []
const MONO_GOLDGLOW: InstItem[] = []

function rotYaw(lx: number, lz: number, yaw: number): [number, number] {
  const c = Math.cos(yaw)
  const s = Math.sin(yaw)
  return [lx * c + lz * s, -lx * s + lz * c]
}

MONOLITHS.forEach((m, idx) => {
  const [px, py, pz] = m.p
  const [sx, sy, sz] = m.s
  const hx = sx / 2
  const hy = sy / 2
  const hz = sz / 2
  const yaw = m.yaw
  const place = (lx: number, ly: number, lz: number): [number, number, number] => {
    const [rx, rz] = rotYaw(lx, lz, yaw)
    return [px + rx, py + ly, pz + rz]
  }
  // primary mass
  MONO_BODY.push({ p: [px, py, pz], r: [0, yaw, 0], s: [sx, sy, sz] })
  // attached secondary masses break the silhouette (alternating side)
  const side = idx % 2 === 0 ? 1 : -1
  MONO_SECOND.push({
    p: place(side * hx * 0.85, hy * 0.28, side * hz * 0.25),
    r: [0, yaw + side * 0.14, 0],
    s: [sx * 0.52, sy * 0.42, sz * 0.52],
  })
  MONO_SECOND.push({
    p: place(-side * hx * 0.3, hy * 1.08, -side * hz * 0.2),
    r: [0.06 * side, yaw - 0.2 * side, 0.08 * side],
    s: [sx * 0.34, sy * 0.2, sz * 0.34],
  })
  // panel-line subdivision: dark recessed-look horizontal bands
  for (const fy of [-0.22, 0.3]) {
    MONO_PANELS.push({ p: place(0, fy * hy, 0), r: [0, yaw, 0], s: [sx * 1.015, 0.4, sz * 1.015] })
  }
  // gold trim insets: crown cap + vertical insets on the ±x faces
  MONO_GOLD.push({ p: place(0, hy * 0.96, 0), r: [0, yaw, 0], s: [sx * 1.03, 0.6, sz * 1.03] })
  for (const fx of [-1, 1]) {
    MONO_GOLD.push({ p: place(fx * hx * 1.005, 0, 0), r: [0, yaw, 0], s: [0.22, sy * 0.62, sz * 0.3] })
  }
  // emissive stripes on the ±z faces — alternate teal / gold per monolith
  const stripes = idx % 2 === 0 ? MONO_TEAL : MONO_GOLDGLOW
  for (const fz of [-1, 1]) {
    for (const fx of [-0.45, 0.45]) {
      stripes.push({
        p: place(fx * hx, -hy * 0.05, fz * hz * 1.005),
        r: [0, yaw, 0],
        s: [sx * 0.07, sy * 0.55, 0.22],
      })
    }
  }
})

// ---------------------------------------------------------------------------
// Practical-light fixtures (R1)
//
// The teal/gold point lights used to be six hand-typed coordinates sitting
// 5–12 m from anything that glows (map E4). These tables are built from the
// SAME data that places the emissive strips, offset ~0.3–0.5 m along the
// surface normal, so every practical has a modelled fixture behind it.
// Lighting.tsx / EnvironmentFX.tsx light only the nearest few by camera
// distance, so the count here is free.
// ---------------------------------------------------------------------------
export const TEAL_FIXTURES: readonly [number, number, number][] = [
  // R2: the canyon's bay strips are gone from this list — they are aureate
  // now. What is left is the corruption inside the chamber and the arena,
  // which is exactly where a hostile colour belongs.
  ...C_TEAL_FIXTURES,
  ...D_TEAL_FIXTURES,
]

export const GOLD_FIXTURES: readonly [number, number, number][] = (() => {
  const out: [number, number, number][] = []
  // canyon bay fixtures, recoloured aureate by the R2 colour script
  for (const f of B_GOLD_FIXTURES) out.push(f)
  // arena perimeter sconces — the review asked for floor pools so enemies
  // separate from the deck instead of floating on a uniformly lit plane
  for (const f of D_SCONCE_FIXTURES) out.push(f)
  // wall-run slab gold veins (canyon) — one light per slab, off its inner face
  for (const sl of WALLRUN_SLABS) {
    const zc = (sl.z0 + sl.z1) / 2
    const inner = sl.x0 < 0 ? sl.x1 + 0.9 : sl.x0 - 0.9
    out.push([inner, sl.y0 + (sl.y1 - sl.y0) * 0.55, zc])
  }
  // floating megalith under-glow plates
  for (const m of ARENA_MEGALITHS) {
    const c = boxCenter(m)
    out.push([c[0], m.y0 - 0.9, c[2]])
  }
  // arena medallion + spawn pod
  out.push([0, 0.6, 195], [0, 0.9, 9])
  // R3 — pendant lamps. Every hood added this round is a modelled fixture with
  // a recessed lens, so each one publishes its position here and the pooled
  // gold practicals ride them: light in this level now always has a source in
  // frame above it, which is most of what separates a lit room from a blockout.
  for (const [x, y, z] of B_PENDANT_POS) out.push([x, y - 0.45, z])
  for (const [x, y, z] of C_PENDANT_POS) out.push([x, y - 0.5, z])
  for (const [x, y, z] of D_PENDANT_POS) out.push([x, y - 0.6, z])
  for (const [x, y, z] of E_CANOPY_PENDANT) out.push([x, y - 0.45, z])
  return out
})()

// ---------------------------------------------------------------------------
// R7 — SERVICE GREEBLE + THE SOFT MATERIAL FAMILY
//
// Held against the reference frame, the one thing this level has never had is
// anything that DISAGREES with its own architecture. Every round added more
// order: a better rhythm, a deeper recess, a finer moulding. The reference is
// the opposite — a perfectly ordinary industrial bay with conduit bent across
// it at whatever angle the run needed, flanges where two lengths meet, a vent
// punched through a panel, cable sagging between two things that were never
// designed together, crates left on the deck and weeds growing out of the
// joint. Count the distinct objects in a 200 px crop of that image and almost
// none of them are architecture.
//
// So this block adds four OFF-GRID families that cross the Orokin order:
//
//   1. conduit runs   — barrels with true circular sections, quarter-bend
//                       elbows, bolted flanges and wall saddles. Authored at
//                       z/x positions coprime with ARENA_BAY_PAIRS so a run
//                       never lines up with a pier and reads as more order.
//   2. vent louvres   — recessed boxes with a slat stack and a gold frame,
//                       punched through the wall field between bays.
//   3. the SOFT family — sagging catenary cable, alpha-tested growth at every
//                       floor/wall junction, and hanging cloth. These are the
//                       curves in a level otherwise made of straight lines,
//                       and the growth is the only saturated hue in frame.
//   4. scale props    — 1 m debris crates and handrail runs. A handrail is the
//                       most reliable scale cue there is, and the reference has
//                       one in the near field of nearly every frame.
//
// Budget: everything below is InstancedMesh over ~14 shared geometries. The
// whole block is roughly 20 draw calls and allocates nothing after mount.
//
// Clearance: every conduit, cable and cloth piece is above 2.55 m, i.e. clear
// of the 1.8 m player capsule; crates and rails stand on surfaces that are
// already floor colliders. No collider coordinate moved.
// ---------------------------------------------------------------------------

/** unit-radius pipe barrel, axis along +Z — instance with s = [r, r, length] */
const PIPE_SEG = new THREE.CylinderGeometry(1, 1, 1, 10, 1, true).rotateX(Math.PI / 2)
/**
 * Quarter-bend elbow. Bend radius 1, tube radius 0.29. Scaled UNIFORMLY by s
 * it joins a run entering at local (0, s, 0) travelling +X to one leaving at
 * (s, 0, 0) travelling −Y, and because the scale is uniform the section stays
 * a true circle through the bend (which is the whole reason this is not a
 * squashed torus).
 */
const PIPE_ELBOW = new THREE.TorusGeometry(1, 0.29, 7, 10, Math.PI / 2)
/** bolted flange plate + its studs, both on the +Z axis like PIPE_SEG */
const FLANGE_GEO = new THREE.CylinderGeometry(1, 1, 1, 16).rotateX(Math.PI / 2)
const STUD_GEO = new THREE.CylinderGeometry(1, 0.82, 1, 6).rotateX(Math.PI / 2)
/** wall saddle — the bracket that clamps a run to the masonry behind it */
const SADDLE_GEO = bakeContactAO(new THREE.BoxGeometry(1, 1, 1), -0.5, 0.15, 0.5)
/** junction box at the foot of a drop */
const JBOX_GEO = bakeContactAO(new RoundedBoxGeometry(1, 1, 1, 1, 0.06), -0.5, -0.1, 0.46)
/** handrail stock: unit tube along X, unit post along Y */
const RAIL_TUBE = new THREE.CylinderGeometry(1, 1, 1, 8).rotateZ(Math.PI / 2)
const RAIL_POST = new THREE.CylinderGeometry(1, 0.88, 1, 8)
/** 1 m debris crate, contact-darkened at its foot */
const CRATE_GEO = bakeContactAO(new RoundedBoxGeometry(1, 1, 1, 1, 0.035), -0.5, -0.16, 0.44)
/** louvre slat — a thin wedge box, stacked to make a vent */
const SLAT_GEO = new THREE.BoxGeometry(1, 1, 1)
/** vent cavity: dark at the bottom of the box so the recess reads as depth */
const VENT_CAVITY = bakeGradient(PANEL_BOX, [
  [-0.5, 0.2],
  [-0.1, 0.34],
  [0.5, 0.52],
])

/**
 * Growth card. The pivot is at the BASE of the card so a scale grows the frond
 * upward out of the joint it is planted in rather than sinking it into the
 * floor, and three horizontal divisions let the alpha cut-out read as separate
 * leaves against a bright wall instead of as one notched rectangle.
 */
const GROWTH_CARD = new THREE.PlaneGeometry(1, 1, 1, 3).translate(0, 0.5, 0)

/**
 * Hanging cloth sheet, pivot at the hung head. Three lengthwise folds that
 * deepen toward the hem, a slight narrowing under its own weight and a hem
 * that falls away from the wall — so the sheen material has facets to catch
 * and the thing reads as fabric rather than as a flat card.
 */
const CLOTH_DROP = (() => {
  const g = new THREE.PlaneGeometry(1, 1, 7, 10)
  const pos = g.attributes.position as THREE.BufferAttribute
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const y = pos.getY(i)
    const t = 0.5 - y // 0 at the head, 1 at the hem
    pos.setZ(i, Math.sin((x + 0.5) * Math.PI * 3.0) * 0.06 * (0.22 + t) + t * t * 0.09)
    pos.setX(i, x * (1 - t * 0.14))
  }
  pos.needsUpdate = true
  g.computeVertexNormals()
  return g.translate(0, -0.5, 0)
})()

/**
 * Catenary cable, bucketed by span.
 *
 * Authored with a UNIT sag and a 0.045 section, then instanced with
 * s = [len/bucket, sag, sag]: because y and z scale together the section stays
 * circular, and the heavier sag on a longer span correctly gives it a thicker
 * cable. Only x is scaled independently, and along the run direction a ±12 %
 * stretch on a 4 cm tube is not resolvable.
 */
function cableGeo(bucket: number): THREE.BufferGeometry {
  const pts: THREE.Vector3[] = []
  const N = 16
  const K = Math.cosh(1.7)
  for (let i = 0; i <= N; i++) {
    const t = i / N
    const u = (t - 0.5) * 3.4
    pts.push(new THREE.Vector3((t - 0.5) * bucket, -(K - Math.cosh(u)) / (K - 1), 0))
  }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), N, 0.045, 6, false)
}

const CABLE_RUNS: { len: number; items: InstItem[] }[] = (() => {
  const map = new Map<number, InstItem[]>()
  for (const [x0, y0, z0, x1, y1, z1, sag] of CABLE_SPANS) {
    const dx = x1 - x0
    const dy = y1 - y0
    const dz = z1 - z0
    const len = Math.hypot(dx, dz)
    const bucket = Math.max(3, Math.round(len / 3) * 3)
    let arr = map.get(bucket)
    if (!arr) map.set(bucket, (arr = []))
    arr.push({
      p: [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2],
      // Instanced composes YXZ, so the z term (pitch of the span) is applied
      // in the run's own frame before the yaw that aims it — which is what a
      // slope between two anchors of different height actually is.
      r: [0, Math.atan2(-dz, dx), Math.atan2(dy, len)],
      s: [len / bucket, sag, sag],
    })
  }
  return [...map.entries()].sort((a, b) => a[0] - b[0]).map(([len, items]) => ({ len, items }))
})()
const CABLE_GEOS: THREE.BufferGeometry[] = CABLE_RUNS.map((r) => cableGeo(r.len))

// --- conduit run assembly ---------------------------------------------------
const PIPE_BODY: InstItem[] = []
const PIPE_BEND: InstItem[] = []
const PIPE_FLANGE: InstItem[] = []
const PIPE_STUD: InstItem[] = []
const PIPE_SADDLE: InstItem[] = []
const PIPE_JBOX: InstItem[] = []

/**
 * Emit one dressed conduit run. `axis` is the direction it travels; `face` is
 * the wall's outward normal component the run stands off from, so the saddles
 * reach back to the masonry. `drop` puts a quarter bend and a vertical fall
 * terminating in a junction box at one end — the single most legible thing a
 * pipe can do, because a bend is the one shape the architecture never makes.
 */
function conduitRun(
  axis: 'x' | 'z',
  a0: number,
  a1: number,
  y: number,
  fixed: number,
  wallAt: number,
  r: number,
  drop: number,
  salt: number,
  /** false for a run that SPANS (the canyon crossings) rather than one that is
   *  clamped to a wall along its whole length — it gets two end shoes instead */
  saddled = true,
): void {
  const len = a1 - a0
  const mid = (a0 + a1) / 2
  const alongX = axis === 'x'
  const rot: [number, number, number] = alongX ? [0, Math.PI / 2, 0] : [0, 0, 0]
  const at = (a: number, yy = y): [number, number, number] =>
    alongX ? [a, yy, fixed] : [fixed, yy, a]
  PIPE_BODY.push({ p: at(mid), r: rot, s: [r, r, len] })

  // flanges + saddles on an irregular pitch, so the run does not become a
  // metronome of its own
  const n = Math.max(2, Math.round(len / 3.4))
  for (let i = 0; i <= n; i++) {
    const f = (i + (h1(i, salt) - 0.5) * 0.55) / n
    const a = a0 + THREE.MathUtils.clamp(f, 0.04, 0.96) * len
    PIPE_FLANGE.push({ p: at(a), r: rot, s: [r * 1.85, r * 1.85, 0.075] })
    if (r > 0.1) {
      for (let k = 0; k < 4; k++) {
        const ang = (k / 4) * Math.PI * 2 + 0.4
        const ox = Math.cos(ang) * r * 1.35
        const oy = Math.sin(ang) * r * 1.35
        const p = at(a, y + oy)
        PIPE_STUD.push({
          p: alongX ? [p[0], p[1], p[2] + ox] : [p[0] + ox, p[1], p[2]],
          r: rot,
          s: [r * 0.2, r * 0.2, 0.12],
        })
      }
    }
    if (saddled && i % 2 === 0) {
      const gap = Math.abs(wallAt - fixed) + r
      const sp = at(a, y)
      const cx = alongX ? sp[2] : sp[0]
      const bx = (cx + wallAt) / 2
      PIPE_SADDLE.push({
        p: alongX ? [sp[0], y, bx] : [bx, y, sp[2]],
        s: alongX ? [r * 2.1, r * 2.4, gap] : [gap, r * 2.4, r * 2.1],
      })
    }
  }
  if (!saddled) {
    // a spanning run is carried at its two ends only
    for (const e of [a0, a1]) {
      PIPE_SADDLE.push({ p: at(e, y), s: alongX ? [0.34, r * 3.2, r * 3.2] : [r * 3.2, r * 3.2, 0.34] })
    }
  }

  if (drop !== 0) {
    // bend radius: uniform scale s on PIPE_ELBOW gives tube radius 0.29·s
    const s = r / 0.29
    const end = drop > 0 ? a1 : a0
    const dir = drop > 0 ? 1 : -1
    // native elbow turns a +X run down; rotate it onto the run's own axis
    const yaw = alongX ? (dir > 0 ? 0 : Math.PI) : dir > 0 ? -Math.PI / 2 : Math.PI / 2
    const o = at(end, y - s)
    PIPE_BEND.push({ p: o, r: [0, yaw, 0], s: [s, s, s] })
    // vertical fall from the bend's exit to a junction box on the dado
    const exitA = end + dir * s
    const yTop = y - s
    const yBot = Math.max(2.72, yTop - 3.6)
    const h = yTop - yBot
    if (h > 0.4) {
      const p = at(exitA, (yTop + yBot) / 2)
      PIPE_BODY.push({ p, r: [Math.PI / 2, 0, 0], s: [r, r, h] })
      const pj = at(exitA, yBot - 0.22)
      PIPE_JBOX.push({
        p: pj,
        s: alongX ? [r * 5.4, 0.52, r * 4.2] : [r * 4.2, 0.52, r * 5.4],
      })
    }
  }
}

// arena long walls: the wall face is x = ±30, the run stands 0.36 m off it
for (const [side, y, z0, z1, r, drop] of ARENA_PIPE_LONG) {
  // the run stands 0.36 m off the ORIGINAL face (x = ±30) and its saddles
  // reach all the way back to the 0.5 m RECESSED field, so a bracket landing
  // in a bay has something behind it instead of floating in the cavity
  conduitRun('z', z0, z1, y, side * 29.64, side * 30.5, r, drop, Math.round(z0))
}
// arena end walls
for (const [side, y, x0, x1, r, drop] of ARENA_PIPE_END) {
  const wz = side > 0 ? 225 : 165
  conduitRun('x', x0, x1, y, wz - side * 0.36, wz + side * 0.5, r, drop, Math.round(x0 + 40))
}
// R7c — the same on the end walls UNDER the gallery soffits (y < 5), which is
// the wall behind the enemy at play height in the combat frame; the drops
// fall to a box on the dado cap exactly as the runs above the galleries do
for (const [side, x0, x1, y, r, drop] of ARENA_UNDERCROFT_PIPES) {
  const wz = side > 0 ? 225 : 165
  conduitRun('x', x0, x1, y, wz - side * 0.36, wz + side * 0.5, r, drop, Math.round(x0 * 3 + 90))
}

/**
 * Canyon cross-conduits — the FOREGROUND LAYER the composition has never had.
 *
 * The gantries added in R3 cross at y 16.4, which is scenery, not framing: by
 * the time the player is under one it has left the top of the frame. These
 * cross the ravine at 3.9–5.4 m, which is 1.8–3.3 m above the camera eye, so
 * each one sweeps down through the top of frame as the player runs beneath it
 * and then off — a near, dark, moving occluder over a lit background, which is
 * exactly the read the railing and machine mass give the reference frame.
 *
 * All of them clear the 1.8 m capsule by more than two metres, and the ravine
 * has no ceiling collider, so nothing here can be run into.
 */
const CANYON_CROSS: [number, number, number][] = [
  [22.4, 4.35, 0.115],
  [33.1, 5.05, 0.075],
  [41.8, 3.95, 0.145],
  [56.6, 4.8, 0.09],
  [70.9, 4.25, 0.13],
  [82.3, 5.35, 0.075],
  [93.4, 4.1, 0.115],
  [107.8, 4.95, 0.145],
  [118.6, 4.4, 0.09],
  [128.2, 5.15, 0.115],
]
for (const [z, y, r] of CANYON_CROSS) {
  conduitRun('x', -5.95, 5.95, y, z, z, r, 0, Math.round(z), false)
  // a second, thinner line running beside the first at a different height —
  // two pipes that were never designed together is the whole point
  const off = (h1(Math.round(z), 21) - 0.5) * 0.9
  conduitRun('x', -5.95, 5.95, y + 0.34 + Math.abs(off) * 0.5, z + off, z + off, r * 0.55, 0, Math.round(z) + 3, false)
}

// --- vent louvres -----------------------------------------------------------
const VENT_CAVITY_I: InstItem[] = []
const VENT_FRAME: InstItem[] = []
const VENT_SLAT: InstItem[] = []
for (const [wall, along, y, w, hh] of ARENA_VENTS) {
  const onLong = wall < 2
  const sx = wall === 0 ? -1 : 1
  const sz = wall === 2 ? -1 : 1
  /**
   * `d` is depth INTO the wall measured from the RECESSED field face — which
   * is at |x| = 30.5 on the long walls and z = 164.5 / 225.5 on the ends,
   * because R4 pushed the field 0.5 m outward into the wall's own thickness.
   * Positive d is deeper, so the cavity is genuinely a hole punched through
   * the field rather than a box parked in front of it.
   */
  const p = (d: number, yy: number, across = 0): [number, number, number] =>
    onLong
      ? [sx * (30.5 + d), yy, along + across]
      : [along + across, yy, sz > 0 ? 225.5 + d : 164.5 - d]
  const dim = (depth: number, ww: number, h2: number): [number, number, number] =>
    onLong ? [depth, h2, ww] : [ww, h2, depth]
  VENT_CAVITY_I.push({ p: p(0.25, y), s: dim(0.5, w, hh) })
  // gold frame: four sides, standing 6 cm proud of the field face
  VENT_FRAME.push({ p: p(-0.06, y + hh / 2 + 0.08), s: dim(0.16, w + 0.32, 0.16) })
  VENT_FRAME.push({ p: p(-0.06, y - hh / 2 - 0.08), s: dim(0.16, w + 0.32, 0.16) })
  for (const e of [-1, 1]) {
    VENT_FRAME.push({ p: p(-0.06, y, (e * (w + 0.16)) / 2), s: dim(0.16, 0.16, hh + 0.32) })
  }
  // slat stack sunk just behind the face, each slat throwing a hard line of
  // shade onto the one below — which is what makes a louvre read as a louvre
  const nSlat = Math.max(3, Math.round(hh / 0.26))
  for (let i = 0; i < nSlat; i++) {
    const sy = y - hh / 2 + ((i + 0.5) / nSlat) * hh
    VENT_SLAT.push({ p: p(0.12, sy), s: dim(0.19, w * 0.94, 0.1) })
  }
}

// --- the soft family: growth ------------------------------------------------
const GROWTH_ITEMS: InstItem[] = []
for (let c = 0; c < GROWTH_CLUMPS.length; c++) {
  const [x, y, z, sc, yaw] = GROWTH_CLUMPS[c]
  // three crossed cards per clump: a clump with volume reads as a plant, a
  // single card reads as a decal no matter how good the alpha is
  for (let k = 0; k < 3; k++) {
    const a = h1(c * 3 + k, 41)
    const b = h1(c * 3 + k, 67)
    const hgt = sc * (0.55 + a * 0.75)
    GROWTH_ITEMS.push({
      p: [x + (b - 0.5) * sc * 0.7, y - 0.04, z + (a - 0.5) * sc * 0.7],
      r: [(b - 0.5) * 0.28, yaw + k * 1.05 + (a - 0.5) * 0.5, (a - 0.5) * 0.3],
      s: [sc * (0.7 + b * 0.6), hgt, 1],
    })
  }
}

// --- the soft family: hanging cloth ----------------------------------------
/**
 * Cloth is hung where a sheet would actually be: over the aperture heads, off
 * the gallery fronts and under the canyon crossings. Each one is a vertical
 * soft edge in a frame otherwise made of horizontals, and it is the only thing
 * in the level whose silhouette is not a straight line or an arc.
 */
const CLOTH_ITEMS: InstItem[] = []
{
  const hang = (x: number, y: number, z: number, w: number, h: number, yaw: number, i: number) => {
    CLOTH_ITEMS.push({ p: [x, y, z], r: [0, yaw, (h1(i, 91) - 0.5) * 0.12], s: [w, h, 1] })
  }
  // arena gallery fronts
  hang(-14.6, 6.0, 169.82, 3.4, 2.6, 0, 1)
  hang(6.2, 6.0, 169.82, 2.6, 3.1, 0, 2)
  hang(12.8, 6.0, 220.18, 3.0, 2.2, Math.PI, 3)
  hang(-8.4, 6.0, 220.18, 3.8, 2.9, Math.PI, 4)
  // arena wall bays that carry no screen
  hang(-29.55, 7.4, 198.1, 3.2, 4.0, Math.PI / 2, 5)
  hang(29.55, 7.0, 192.6, 2.4, 3.4, -Math.PI / 2, 6)
  // chamber aperture heads
  hang(-2.3, 7.6, 135.3, 2.4, 3.6, 0, 7)
  hang(2.6, 7.2, 164.7, 2.0, 3.0, Math.PI, 8)
  // R7d — under the arena galleries, hung from the soffit line in front of
  // the service wall, hems at 2 m so the undercroft is still walkable
  hang(-12.2, 4.9, 166.15, 2.2, 2.9, 0, 12)
  hang(12.0, 4.9, 223.85, 1.8, 2.9, Math.PI, 13)
  // canyon — hung off the crossings, right in the near field
  hang(-3.6, 4.1, 41.8, 2.2, 1.5, 0.3, 9)
  hang(3.9, 4.55, 70.9, 1.8, 1.9, -0.4, 10)
  hang(-2.4, 4.7, 107.8, 2.6, 2.1, 0.15, 11)
}

// --- scale props: crates ----------------------------------------------------
const CRATE_BODY: InstItem[] = []
const CRATE_BAND: InstItem[] = []
for (let c = 0; c < CRATE_CLUSTERS.length; c++) {
  const [x, z, yaw, n] = CRATE_CLUSTERS[c]
  let stack = 0
  for (let i = 0; i < n; i++) {
    const a = h1(c * 5 + i, 53)
    const b = h1(c * 5 + i, 77)
    const w = 0.72 + a * 0.4
    const hh = 0.6 + b * 0.35
    // most sit on the deck; roughly one in three is stacked on the last
    const stacked = i > 0 && a > 0.62
    const base = stacked ? stack : 0
    const cx = x + (b - 0.5) * (stacked ? 0.18 : 1.9)
    const cz = z + (a - 0.5) * (stacked ? 0.18 : 1.9)
    const ry = yaw + (a - 0.5) * 1.4
    CRATE_BODY.push({ p: [cx, base + hh / 2, cz], r: [0, ry, 0], s: [w, hh, w * (0.82 + b * 0.3)] })
    for (const f of [-0.26, 0.26]) {
      CRATE_BAND.push({
        p: [cx, base + hh / 2 + f * hh, cz],
        r: [0, ry, 0],
        s: [w * 1.03, hh * 0.09, w * (0.82 + b * 0.3) * 1.03],
      })
    }
    stack = stacked ? stack + hh : hh
  }
}

// --- scale props: handrails -------------------------------------------------
const RAIL_TOP: InstItem[] = []
const RAIL_MID: InstItem[] = []
const RAIL_POSTS: InstItem[] = []
const RAIL_SHOE: InstItem[] = []
for (let ri = 0; ri < HANDRAIL_RUNS.length; ri++) {
  const [x0, y, z0, x1, z1] = HANDRAIL_RUNS[ri]
  const dx = x1 - x0
  const dz = z1 - z0
  const len = Math.hypot(dx, dz)
  const yaw = Math.atan2(-dz, dx)
  const cx = (x0 + x1) / 2
  const cz = (z0 + z1) / 2
  RAIL_TOP.push({ p: [cx, y + 1.02, cz], r: [0, yaw, 0], s: [len, 0.038, 0.038] })
  RAIL_MID.push({ p: [cx, y + 0.56, cz], r: [0, yaw, 0], s: [len, 0.022, 0.022] })
  const n = Math.max(2, Math.round(len / 2.1))
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const px = x0 + dx * t
    const pz = z0 + dz * t
    RAIL_POSTS.push({ p: [px, y + 0.52, pz], s: [0.036, 1.04, 0.036] })
    RAIL_SHOE.push({ p: [px, y + 0.035, pz], s: [0.14, 0.07, 0.14] })
  }
}

// ---------------------------------------------------------------------------
// R7b — WALL GREEBLE PASS + TRAVERSAL NEAR FIELD. VISUAL ONLY.
//
// The previous pass put the big off-grid families on the arena (conduit runs,
// vents, cables, growth, cloth) and the wall stopped being one stamped panel.
// What it still was not is DENSE: the reference has no 200 px square without
// five or six distinct small objects in it, and a bay of ours had a screen, a
// coffer, two shafts and — if a run happened to cross it — one pipe. This
// block is the small-object layer: vertical drops with clamps and gauges,
// bolted patches, bay cable trays, ladders, caged lamps, and tank clusters in
// the suppressed bays. Every family is one InstancedMesh over one shared
// geometry, the tables live in layout.ts, and everything sits either inside
// the projection envelope the wall already has (|x| ≥ 29.6) or above the
// capsule, so no collider is touched.
//
// The canyon gets the near field the reference frame has at its left edge:
// service pods cantilevered over the void OUTSIDE the B1 rail collider (the
// one place a full-height machine mass can stand where the player cannot walk
// into it), cabinets hung on the west wall above head height, and low
// crossings at 3.3–3.6 m with a box and a pendant hung beneath, so a dark
// occluder passes within two metres of the lens every ten metres of the run.
// ---------------------------------------------------------------------------

/** closed tank barrel, axis along +Z (instance s = [r, r, length]) */
const TANK_GEO = new THREE.CylinderGeometry(1, 1, 1, 18, 1, false).rotateX(Math.PI / 2)
/** dome end for a tank: hemisphere whose pole points +Z */
const TANK_CAP = new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2)
/** reinforcing hoop around a tank / a valve wheel: torus in the XY plane, axis Z */
const HOOP_GEO = new THREE.TorusGeometry(1, 0.06, 6, 22)
const WHEEL_GEO = new THREE.TorusGeometry(1, 0.11, 6, 12)
/** valve wheel spokes: a thin cross, axis Z */
const SPOKE_GEO = new THREE.BoxGeometry(2, 0.12, 0.12)

/**
 * Arena wall frame. `d` is the depth INTO THE ROOM measured from the wall's
 * original collider face (x ±30, z 165 / 225): positive stands proud, negative
 * sinks into the 0.5 m recess. `along` is z on the long walls and x on the
 * end walls. Everything below is authored in this frame so one table entry
 * serves all four walls.
 */
function wallAt(wall: number, along: number, y: number, d: number): [number, number, number] {
  if (wall === 0) return [-30 + d, y, along]
  if (wall === 1) return [30 - d, y, along]
  if (wall === 2) return [along, y, 165 + d]
  return [along, y, 225 - d]
}
/** a box size given as (depth normal to the wall, height, width along it) */
function wallDim(wall: number, depth: number, h: number, w: number): [number, number, number] {
  return wall < 2 ? [depth, h, w] : [w, h, depth]
}
/** yaw that turns a +Z-axis geometry to run ALONG the wall */
function alongRot(wall: number): [number, number, number] {
  return wall < 2 ? [0, 0, 0] : [0, Math.PI / 2, 0]
}
/** yaw that turns a +Z-axis geometry to point INTO THE ROOM off the wall */
function normalRot(wall: number): [number, number, number] {
  return wall < 2 ? [0, Math.PI / 2, 0] : [0, 0, 0]
}
/** yaw that turns a +X-axis tube (RAIL_TUBE) to run along the wall */
function railAlongRot(wall: number): [number, number, number] {
  return wall < 2 ? [0, Math.PI / 2, 0] : [0, 0, 0]
}
/**
 * Yaw for PIPE_ELBOW so its horizontal leg runs INTO the wall and its vertical
 * leg hangs below the origin. The native elbow's horizontal leg leaves toward
 * −X; the room is +X off the west wall, −X off the east, +Z off the south and
 * −Z off the north, and "into the wall" is the opposite of each.
 */
function elbowIntoWallRot(wall: number): [number, number, number] {
  if (wall === 0) return [0, 0, 0]
  if (wall === 1) return [0, Math.PI, 0]
  if (wall === 2) return [0, -Math.PI / 2, 0]
  return [0, Math.PI / 2, 0]
}
const VERT_ROT: [number, number, number] = [Math.PI / 2, 0, 0]

// --- vertical drops --------------------------------------------------------
const DROP_BODY: InstItem[] = []
const DROP_BEND: InstItem[] = []
const DROP_FLANGE: InstItem[] = []
const DROP_CLAMP: InstItem[] = []
const DROP_BOX: InstItem[] = []
const DROP_GAUGE: InstItem[] = []
const DROP_WHEEL: InstItem[] = []
const DROP_SPOKE: InstItem[] = []
const DROP_STUB: InstItem[] = []
/** depth the drop's axis stands off the original face: in front of a screen
 *  plate (|x| 29.82) and inside the nosing envelope (29.6) */
const DROP_D = 0.3
for (let i = 0; i < ARENA_WALL_DROPS.length; i++) {
  const [wall, along, yTop, yBot, r, fitting] = ARENA_WALL_DROPS[i]
  const h = yTop - yBot
  DROP_BODY.push({ p: wallAt(wall, along, (yTop + yBot) / 2, DROP_D), r: VERT_ROT, s: [r, r, h] })
  // clamps back to the wall on an irregular pitch
  const n = Math.max(1, Math.round(h / 1.7))
  for (let k = 0; k <= n; k++) {
    const y = yBot + 0.25 + (h - 0.5) * THREE.MathUtils.clamp((k + (h1(k, 5 + i) - 0.5) * 0.5) / n, 0, 1)
    DROP_CLAMP.push({ p: wallAt(wall, along, y, DROP_D * 0.62), s: wallDim(wall, DROP_D * 0.76 + r, r * 2.6, r * 2.4) })
    if (k > 0 && k < n) {
      DROP_FLANGE.push({ p: wallAt(wall, along, y + 0.34, DROP_D), r: VERT_ROT, s: [r * 1.8, r * 1.8, 0.07] })
    }
  }
  if (fitting === 2 || fitting === 3) {
    // elbow at the top turning into the wall
    const s = r / 0.29
    DROP_BEND.push({ p: wallAt(wall, along, yTop, DROP_D - s), r: elbowIntoWallRot(wall), s: [s, s, s] })
  } else {
    // a flange where the drop meets the corbel course
    DROP_FLANGE.push({ p: wallAt(wall, along, yTop - 0.05, DROP_D), r: VERT_ROT, s: [r * 1.9, r * 1.9, 0.08] })
  }
  if (yBot > 3) {
    // ends in the air: a junction box on the wall under it
    DROP_BOX.push({ p: wallAt(wall, along, yBot - 0.24, 0.17), s: wallDim(wall, 0.34, 0.48, r * 5 + 0.2) })
  } else {
    DROP_FLANGE.push({ p: wallAt(wall, along, yBot + 0.12, DROP_D), r: VERT_ROT, s: [r * 1.9, r * 1.9, 0.08] })
  }
  if (fitting === 1 || fitting === 3) {
    // a valve stub off the drop with a hand wheel, and a gauge beside it
    const y = yBot + 0.42 * h + (h1(i, 9) - 0.5) * 0.3 * h
    DROP_STUB.push({ p: wallAt(wall, along, y, DROP_D + 0.16), r: normalRot(wall), s: [r * 0.7, r * 0.7, 0.32] })
    DROP_WHEEL.push({ p: wallAt(wall, along, y, DROP_D + 0.34), r: normalRot(wall), s: [0.15, 0.15, 0.15] })
    DROP_SPOKE.push({ p: wallAt(wall, along, y, DROP_D + 0.34), r: normalRot(wall), s: [0.15, 0.15, 0.15] })
    DROP_SPOKE.push({ p: wallAt(wall, along, y, DROP_D + 0.34), r: [0, normalRot(wall)[1], Math.PI / 2], s: [0.15, 0.15, 0.15] })
    const side = h1(i, 17) > 0.5 ? 1 : -1
    DROP_STUB.push({ p: wallAt(wall, along + side * (r + 0.13), y + 0.36, DROP_D), r: alongRot(wall), s: [r * 0.55, r * 0.55, 0.26] })
    DROP_GAUGE.push({ p: wallAt(wall, along + side * (r + 0.26), y + 0.36, DROP_D + 0.02), r: normalRot(wall), s: [0.12, 0.12, 0.07] })
  }
}

// --- bolted patches --------------------------------------------------------
const PATCH_PLATE: InstItem[] = []
const PATCH_STUD: InstItem[] = []
function patch(wall: number, along: number, y: number, w: number, h: number, d: number, salt: number): void {
  PATCH_PLATE.push({ p: wallAt(wall, along, y, d), s: wallDim(wall, 0.05, h, w) })
  const inset = 0.08
  for (const [a, b] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ] as [number, number][]) {
    // a corner bolt is occasionally missing — a rule the eye reads as history
    if (h1(salt * 4 + a + b * 2, 23) < 0.12) continue
    PATCH_STUD.push({
      p: wallAt(wall, along + a * (w / 2 - inset), y + b * (h / 2 - inset), d + 0.045),
      r: normalRot(wall),
      s: [0.028, 0.028, 0.05],
    })
  }
}
{
  // dado register, between the pier plinths, on every wall
  const walls: [number, number, number, number[]][] = [
    [0, 166.5, 223.5, D_PAIR_W],
    [1, 166.5, 223.5, D_PAIR_E],
    [2, -28.5, 28.5, D_PAIR_S],
    [3, -28.5, 28.5, D_PAIR_N],
  ]
  let n = 0
  for (const [wall, a0, a1, pairs] of walls) {
    const count = wall < 2 ? 22 : 10
    for (let k = 0; k < count; k++) {
      const along = a0 + h1(k, 31 + wall * 7) * (a1 - a0)
      // clear of the plinths and the gate openings
      if (pairs.some((c) => Math.abs(c - along) < 2.4)) continue
      if (wall >= 2 && Math.abs(along) < 6.2) continue
      const w = 0.32 + h1(k, 37 + wall) * 0.5
      const hh = 0.28 + h1(k, 41 + wall) * 0.42
      const y = 0.6 + h1(k, 43 + wall) * 1.25
      patch(wall, along, y, w, hh, 0.09, n++)
    }
  }
  // one plate between the shafts of every coupled pair, high on the pier
  for (const [wall, pairs] of [
    [0, D_PAIR_W],
    [1, D_PAIR_E],
    [2, D_PAIR_S],
    [3, D_PAIR_N],
  ] as [number, number[]][]) {
    pairs.forEach((c, k) => {
      if (h1(k, 47 + wall) < 0.3) return
      if (ARENA_WALL_LADDERS.some((l) => l[0] === wall && Math.abs(l[1] - c) < 1)) return
      const y = 3.2 + h1(k, 53 + wall) * 4.2
      patch(wall, c, y, 0.42 + h1(k, 59 + wall) * 0.3, 0.5 + h1(k, 61 + wall) * 0.5, 0.05, n++)
    })
  }
}

// --- bay cable trays -------------------------------------------------------
const TRAY_BASE: InstItem[] = []
const TRAY_LIP: InstItem[] = []
const TRAY_ARM: InstItem[] = []
const TRAY_CABLE: InstItem[] = []
const TRAY_D = 0.3
for (let i = 0; i < ARENA_WALL_TRAYS.length; i++) {
  const [wall, a0, a1, y, riser] = ARENA_WALL_TRAYS[i]
  const len = a1 - a0
  const mid = (a0 + a1) / 2
  TRAY_BASE.push({ p: wallAt(wall, mid, y, TRAY_D), s: wallDim(wall, 0.3, 0.04, len) })
  TRAY_LIP.push({ p: wallAt(wall, mid, y + 0.05, TRAY_D + 0.14), s: wallDim(wall, 0.03, 0.12, len) })
  TRAY_LIP.push({ p: wallAt(wall, mid, y + 0.05, TRAY_D - 0.14), s: wallDim(wall, 0.03, 0.12, len) })
  const n = Math.max(2, Math.round(len / 1.9))
  for (let k = 0; k <= n; k++) {
    const a = a0 + 0.2 + (len - 0.4) * (k / n)
    TRAY_ARM.push({ p: wallAt(wall, a, y - 0.05, TRAY_D / 2), s: wallDim(wall, TRAY_D + 0.1, 0.06, 0.08) })
    TRAY_ARM.push({ p: wallAt(wall, a, y - 0.26, 0.03), s: wallDim(wall, 0.06, 0.42, 0.08) })
  }
  // two or three cables lying in the tray, not quite parallel
  const nc = 2 + (h1(i, 71) > 0.5 ? 1 : 0)
  for (let c = 0; c < nc; c++) {
    const off = (c - (nc - 1) / 2) * 0.075
    TRAY_CABLE.push({
      p: wallAt(wall, mid, y + 0.06, TRAY_D + off),
      r: [0, railAlongRot(wall)[1] + (h1(i * 3 + c, 73) - 0.5) * 0.02, 0],
      s: [len - 0.1, 0.03, 0.03],
    })
  }
  if (riser !== 0) {
    // the cables leave the tray up a vertical riser to the corbel course
    const a = riser > 0 ? a1 - 0.2 : a0 + 0.2
    const top = 8.45
    TRAY_LIP.push({ p: wallAt(wall, a, (y + top) / 2, TRAY_D + 0.14), s: wallDim(wall, 0.03, top - y, 0.3) })
    TRAY_BASE.push({ p: wallAt(wall, a, (y + top) / 2, TRAY_D), s: wallDim(wall, 0.3, top - y, 0.04) })
    for (let c = 0; c < nc; c++) {
      const off = (c - (nc - 1) / 2) * 0.075
      TRAY_CABLE.push({ p: wallAt(wall, a, (y + top) / 2 + 0.05, TRAY_D + off), r: [0, 0, Math.PI / 2], s: [top - y - 0.1, 0.015, 0.015] })
    }
  }
}

// --- ladders ---------------------------------------------------------------
const LADDER_STILE: InstItem[] = []
const LADDER_RUNG: InstItem[] = []
const LADDER_STANDOFF: InstItem[] = []
for (const [wall, along, y0, y1] of ARENA_WALL_LADDERS) {
  const h = y1 - y0
  const d = 0.28
  for (const e of [-1, 1]) {
    LADDER_STILE.push({ p: wallAt(wall, along + e * 0.24, (y0 + y1) / 2, d), s: wallDim(wall, 0.06, h, 0.06) })
  }
  const n = Math.floor(h / 0.3)
  for (let k = 0; k <= n; k++) {
    LADDER_RUNG.push({ p: wallAt(wall, along, y0 + 0.1 + k * 0.3, d), r: railAlongRot(wall), s: [0.48, 0.018, 0.018] })
  }
  for (let k = 0; k < 4; k++) {
    const y = y0 + 0.4 + ((h - 0.8) * k) / 3
    for (const e of [-1, 1]) {
      LADDER_STANDOFF.push({ p: wallAt(wall, along + e * 0.24, y, d / 2), s: wallDim(wall, d, 0.05, 0.05) })
    }
  }
  // a hooped cage on the upper half, the thing that says "ladder" at 30 m
  for (let k = 0; k < 4; k++) {
    const y = y0 + h * 0.5 + (h * 0.45 * k) / 3
    LADDER_STANDOFF.push({ p: wallAt(wall, along, y, d + 0.36), s: wallDim(wall, 0.04, 0.04, 0.74) })
    for (const e of [-1, 1]) {
      LADDER_STANDOFF.push({ p: wallAt(wall, along + e * 0.37, y, d + 0.18), s: wallDim(wall, 0.4, 0.04, 0.04) })
    }
  }
}

// --- caged lamps -----------------------------------------------------------
const LAMP_BOX: InstItem[] = []
const LAMP_HOOD: InstItem[] = []
const LAMP_SLIT: InstItem[] = []
const LAMP_BAR: InstItem[] = []
for (let i = 0; i < ARENA_WALL_LAMPS.length; i++) {
  const [wall, along, y] = ARENA_WALL_LAMPS[i]
  LAMP_BOX.push({ p: wallAt(wall, along, y, 0.14), s: wallDim(wall, 0.28, 0.5, 0.34) })
  LAMP_HOOD.push({ p: wallAt(wall, along, y + 0.31, 0.2), s: wallDim(wall, 0.44, 0.07, 0.46) })
  LAMP_SLIT.push({ p: wallAt(wall, along, y + 0.02, 0.285), s: wallDim(wall, 0.02, 0.3, 0.2) })
  for (const e of [-1, 1]) {
    LAMP_BAR.push({ p: wallAt(wall, along + e * 0.06, y + 0.02, 0.31), s: wallDim(wall, 0.02, 0.36, 0.02) })
  }
}

// --- tank clusters in the suppressed bays -----------------------------------
const TANK_BODY: InstItem[] = []
const TANK_END: InstItem[] = []
const TANK_HOOP: InstItem[] = []
const TANK_SADDLE: InstItem[] = []
const TANK_PIPE: InstItem[] = []
const TANK_CABINET: InstItem[] = []
{
  /** everything already standing on a wall that a tank must not be hung
   *  through: drops, ladders and lamps, by wall */
  const busy: number[][] = [[], [], [], []]
  for (const d of ARENA_WALL_DROPS) busy[d[0]].push(d[1])
  for (const l of ARENA_WALL_LADDERS) busy[l[0]].push(l[1])
  for (const l of ARENA_WALL_LAMPS) busy[l[0]].push(l[1])
  for (let i = 0; i < D_BLIND_BAYS.length; i++) {
    const [wall, along, w] = D_BLIND_BAYS[i]
    // on the end walls the galleries put a platform at y 5–6 for |x| < 20, so
    // a tank there would sit at waist height to someone standing on it
    if (wall >= 2 && Math.abs(along) < 20.8) continue
    // behind the arena wall-run slabs nothing is visible from the room
    if (wall === 0 && along > 169 && along < 191) continue
    if (wall === 1 && along > 199 && along < 221) continue
    const r = 0.36 + h1(i, 83) * 0.09
    const len = Math.min(w - 1.6, 1.5 + h1(i, 89) * 1.1)
    if (len < 1.1) continue
    // the tank sits in the one band the R7 conduit runs leave free on every
    // wall (they cross at 3.5–4.4 and 6.5–7.6)
    const y = 5.2 + h1(i, 97) * 0.4
    // manifold to one side, cabinet to the other: the cluster is asymmetric
    const dir = h1(i, 107) > 0.5 ? 1 : -1
    const span = len / 2 + 1.25
    let a = along
    let ok = false
    for (const sh of [0, 0.45, -0.45, 0.9, -0.9]) {
      a = along + sh
      if (Math.abs(sh) + span > w / 2 - 0.55) continue
      if (busy[wall].some((b) => Math.abs(b - a) < span + 0.12)) continue
      ok = true
      break
    }
    if (!ok) continue
    const d = -0.04 // axis just inside the original face; the barrel reaches 29.6
    TANK_BODY.push({ p: wallAt(wall, a, y, d), r: alongRot(wall), s: [r, r, len] })
    TANK_END.push({ p: wallAt(wall, a + len / 2, y, d), r: [0, alongRot(wall)[1], 0], s: [r, r, r * 0.55] })
    TANK_END.push({ p: wallAt(wall, a - len / 2, y, d), r: [0, alongRot(wall)[1] + Math.PI, 0], s: [r, r, r * 0.55] })
    for (const f of [-0.32, 0, 0.32]) {
      TANK_HOOP.push({ p: wallAt(wall, a + f * len, y, d), r: alongRot(wall), s: [r * 1.04, r * 1.04, r * 1.04] })
    }
    for (const f of [-0.28, 0.28]) {
      TANK_SADDLE.push({ p: wallAt(wall, a + f * len, y - r * 0.55, d - 0.2), s: wallDim(wall, r * 1.3, r * 0.5, 0.26) })
    }
    // a manifold at one end dropping to the dado, with a hand wheel on it,
    // and a gauge on the tank's face
    const ma = a + dir * (len / 2 + 0.36)
    TANK_PIPE.push({ p: wallAt(wall, ma, (y + 2.45) / 2, 0.24), r: VERT_ROT, s: [0.055, 0.055, y - 2.45] })
    TANK_PIPE.push({ p: wallAt(wall, ma - dir * 0.18, y, 0.24), r: alongRot(wall), s: [0.05, 0.05, 0.36] })
    DROP_FLANGE.push({ p: wallAt(wall, ma, 2.6, 0.24), r: VERT_ROT, s: [0.1, 0.1, 0.07] })
    DROP_WHEEL.push({ p: wallAt(wall, ma, y - r - 0.55, 0.42), r: normalRot(wall), s: [0.14, 0.14, 0.14] })
    DROP_SPOKE.push({ p: wallAt(wall, ma, y - r - 0.55, 0.42), r: normalRot(wall), s: [0.14, 0.14, 0.14] })
    DROP_STUB.push({ p: wallAt(wall, ma, y - r - 0.55, 0.32), r: normalRot(wall), s: [0.04, 0.04, 0.18] })
    DROP_GAUGE.push({ p: wallAt(wall, a + 0.1, y, d + r + 0.02), r: normalRot(wall), s: [0.11, 0.11, 0.06] })
    // and a cabinet on the wall on the other side
    const ca = a - dir * (len / 2 + 0.8)
    TANK_CABINET.push({ p: wallAt(wall, ca, y - 0.1, 0.17), s: wallDim(wall, 0.36, 1.25 + h1(i, 109) * 0.5, 0.82) })
  }
}

// --- canyon: low crossings with hung fittings --------------------------------
const XLOW_BAR: InstItem[] = []
const XLOW_PIPE: InstItem[] = []
const XLOW_BOX: InstItem[] = []
const XLOW_HANGER: InstItem[] = []
const XLOW_LAMP_ROD: InstItem[] = []
const XLOW_LAMP_HOOD: InstItem[] = []
const XLOW_LAMP_LENS: InstItem[] = []
for (let i = 0; i < CANYON_LOW_CROSSINGS.length; i++) {
  const [z, y, bx, lamp] = CANYON_LOW_CROSSINGS[i]
  // the bar spans from the west wall face (or, in B1, the outer wall at x −9.4)
  // to the east glass line; B1 has no west wall, so the bar reaches the outer
  // one across the void
  const x0 = z < 40 ? -9.3 : -5.95
  const x1 = 5.95
  const len = x1 - x0
  const cx = (x0 + x1) / 2
  XLOW_BAR.push({ p: [cx, y, z], s: [len, 0.22, 0.3] })
  // two pipes slung under it at different heights, one thicker than the other
  XLOW_PIPE.push({ p: [cx, y - 0.24, z - 0.09], r: [0, Math.PI / 2, 0], s: [0.085, 0.085, len] })
  XLOW_PIPE.push({ p: [cx, y - 0.19, z + 0.14], r: [0, Math.PI / 2, 0], s: [0.05, 0.05, len] })
  for (let k = 0; k < 3; k++) {
    const x = x0 + len * (0.18 + 0.32 * k + (h1(i * 3 + k, 113) - 0.5) * 0.12)
    XLOW_HANGER.push({ p: [x, y - 0.15, z], s: [0.06, 0.3, 0.42] })
  }
  if (bx !== 0) {
    XLOW_BOX.push({ p: [bx, y - 0.56, z], r: [0, (h1(i, 127) - 0.5) * 0.3, 0], s: [0.62, 0.46, 0.4] })
    XLOW_HANGER.push({ p: [bx, y - 0.3, z], s: [0.1, 0.24, 0.1] })
  }
  if (lamp) {
    const lx = -bx * 0.6 + (h1(i, 131) - 0.5) * 2
    XLOW_LAMP_ROD.push({ p: [lx, y - 0.42, z], s: [1, 0.5, 1] })
    XLOW_LAMP_HOOD.push({ p: [lx, y - 0.86, z], s: [0.62, 0.62, 0.62] })
    XLOW_LAMP_LENS.push({ p: [lx, y - 0.98, z], s: [0.5, 0.5, 0.5] })
  }
}

// --- canyon: service pods over the void -------------------------------------
const POD_DECK: InstItem[] = []
const POD_BRACKET: InstItem[] = []
const POD_TANK: InstItem[] = []
const POD_TANK_END: InstItem[] = []
const POD_HOOP: InstItem[] = []
const POD_CABINET: InstItem[] = []
const POD_PIPE: InstItem[] = []
const POD_RAIL: InstItem[] = []
const POD_POST: InstItem[] = []
for (let i = 0; i < CANYON_EDGE_PODS.length; i++) {
  const [z, yaw, tanks] = CANYON_EDGE_PODS[i]
  const cx = -7.55
  const w = 2.6
  const dpt = 2.4
  POD_DECK.push({ p: [cx, -0.16, z], r: [0, yaw, 0], s: [dpt, 0.32, w] })
  // two raking brackets down to the outer wall
  for (const e of [-0.9, 0.9]) {
    POD_BRACKET.push({ p: [cx - 0.9, -1.1, z + e], r: [0, yaw, -0.95], s: [0.22, 2.6, 0.26] })
  }
  const c = Math.cos(yaw)
  const s = Math.sin(yaw)
  const local = (lx: number, lz: number): [number, number] => [cx + lx * c + lz * s, z - lx * s + lz * c]
  for (let t = 0; t < tanks; t++) {
    const r = 0.36 + h1(i * 3 + t, 137) * 0.08
    const hh = 1.5 + h1(i * 3 + t, 139) * 0.7
    const [tx, tz] = local(-0.35 + (t % 2) * 0.55, -0.85 + t * 0.85)
    POD_TANK.push({ p: [tx, hh / 2, tz], r: [Math.PI / 2, 0, 0], s: [r, r, hh] })
    POD_TANK_END.push({ p: [tx, hh, tz], r: [-Math.PI / 2, 0, 0], s: [r, r, r * 0.5] })
    for (const f of [0.22, 0.5, 0.78]) {
      POD_HOOP.push({ p: [tx, hh * f, tz], r: [Math.PI / 2, 0, 0], s: [r * 1.04, r * 1.04, r * 1.04] })
    }
  }
  const [kx, kz] = local(0.55, 0.75)
  POD_CABINET.push({ p: [kx, 0.72, kz], r: [0, yaw + 0.2, 0], s: [0.72, 1.44, 0.9] })
  // a hose looping from the cabinet over the rail to the deck kerb
  const [px, pz] = local(1.05, 0)
  POD_PIPE.push({ p: [px, 1.32, pz], r: [0, yaw, 0], s: [0.07, 0.07, 1.9] })
  POD_PIPE.push({ p: [px + 0.9, 1.0, pz], r: [Math.PI / 2, 0, 0], s: [0.07, 0.07, 0.6] })
  // a rail round the void side
  const [rx, rz] = local(-1.15, 0)
  POD_RAIL.push({ p: [rx, 1.02, rz], r: [0, yaw + Math.PI / 2, 0], s: [w, 0.036, 0.036] })
  for (const e of [-1.2, 0, 1.2]) {
    const [qx, qz] = local(-1.15, e)
    POD_POST.push({ p: [qx, 0.52, qz], s: [0.036, 1.04, 0.036] })
  }
}

// --- canyon: wall cabinets --------------------------------------------------
const CAB_BODY: InstItem[] = []
const CAB_DOOR: InstItem[] = []
const CAB_HINGE: InstItem[] = []
const CAB_PIPE: InstItem[] = []
const CAB_BRACKET: InstItem[] = []
for (let i = 0; i < CANYON_WALL_CABINETS.length; i++) {
  const [z, y, w, hh, d] = CANYON_WALL_CABINETS[i]
  const face = -5.9
  CAB_BODY.push({ p: [face + d / 2, y + hh / 2, z], s: [d, hh, w] })
  CAB_DOOR.push({ p: [face + d + 0.012, y + hh / 2, z - w * 0.02], s: [0.02, hh * 0.86, w * 0.42] })
  CAB_DOOR.push({ p: [face + d + 0.012, y + hh / 2, z + w * 0.26], s: [0.02, hh * 0.86, w * 0.42] })
  for (const f of [-0.36, 0.36]) {
    CAB_HINGE.push({ p: [face + d + 0.03, y + hh / 2 + f * hh, z - w * 0.46], s: [0.05, 0.12, 0.05] })
  }
  for (const f of [-0.42, 0.42]) {
    CAB_BRACKET.push({ p: [face + d / 2, y - 0.08, z + f * w], s: [d - 0.1, 0.12, 0.14] })
  }
  // a conduit from the cabinet's underside to the deck, clamped to the wall
  const px = face + 0.18
  const pz = z + (h1(i, 149) > 0.5 ? 1 : -1) * (w / 2 - 0.16)
  CAB_PIPE.push({ p: [px, y / 2, pz], r: [Math.PI / 2, 0, 0], s: [0.06, 0.06, y] })
  CAB_BRACKET.push({ p: [face + 0.09, y * 0.35, pz], s: [0.18, 0.14, 0.16] })
  CAB_BRACKET.push({ p: [face + 0.09, y * 0.8, pz], s: [0.18, 0.14, 0.16] })
}

// --- arena: cable runs lying on the deck --------------------------------------
const DECK_CABLE: InstItem[] = []
const DECK_CLAMP: InstItem[] = []
const DECK_JBOX: InstItem[] = []
for (let i = 0; i < ARENA_DECK_CABLES.length; i++) {
  const [x0, z0, x1, z1] = ARENA_DECK_CABLES[i]
  const dx = x1 - x0
  const dz = z1 - z0
  const len = Math.hypot(dx, dz)
  const yaw = Math.atan2(dx, dz)
  const r = 0.03 + h1(i, 151) * 0.015
  DECK_CABLE.push({ p: [(x0 + x1) / 2, r + 0.005, (z0 + z1) / 2], r: [0, yaw, 0], s: [r, r, len] })
  const n = Math.max(2, Math.round(len / 2.6))
  for (let k = 0; k <= n; k++) {
    const t = THREE.MathUtils.clamp((k + (h1(k, 157 + i) - 0.5) * 0.5) / n, 0.03, 0.97)
    DECK_CLAMP.push({ p: [x0 + dx * t, 0.028, z0 + dz * t], r: [0, yaw, 0], s: [r * 4.2, 0.056, 0.16] })
  }
  // a low box at the wall end, and a second cable branching off it a short way
  DECK_JBOX.push({ p: [x0 + (dx / len) * 0.3, 0.16, z0 + (dz / len) * 0.3], r: [0, yaw + (h1(i, 163) - 0.5) * 0.4, 0], s: [0.5, 0.32, 0.36] })
  const bl = 1.6 + h1(i, 167) * 2.2
  const byaw = yaw + (h1(i, 173) > 0.5 ? 1 : -1) * (0.35 + h1(i, 179) * 0.4)
  DECK_CABLE.push({
    p: [x0 + (dx / len) * 0.5 + Math.sin(byaw) * bl * 0.5, r * 0.7 + 0.005, z0 + (dz / len) * 0.5 + Math.cos(byaw) * bl * 0.5],
    r: [0, byaw, 0],
    s: [r * 0.7, r * 0.7, bl],
  })
}

// ---------------------------------------------------------------------------
// R7c — gallery undercrofts, trunk risers and fascia dressing. VISUAL ONLY.
// Tables in layout.ts (ARENA_SOFFIT_CONDUITS, ARENA_TRUNK_RISERS,
// ARENA_FASCIA_FITTINGS); everything here pushes into the R7/R7b instance
// lists, so it costs no new draw calls.
// ---------------------------------------------------------------------------

// --- conduit hung under the gallery soffits, wall to fascia -------------------
{
  const SOFFIT_Y = 4.98
  for (let i = 0; i < ARENA_SOFFIT_CONDUITS.length; i++) {
    const [side, x, yTable] = ARENA_SOFFIT_CONDUITS[i]
    const wall = side > 0 ? 3 : 2
    const r = 0.045 + h1(i, 191) * 0.03
    // R7d — ride just under the soffit: the fat wall runs at 4.5 and the duct
    // line at 3.95 pass beneath these, so the table's y is only a phase
    const y = 4.8 + (yTable - 4.6) * 0.3
    // from the wall's recessed field to just short of the fascia's back
    const d0 = -0.5
    const d1 = 4.78
    const mid = (d0 + d1) / 2
    PIPE_BODY.push({ p: wallAt(wall, x, y, mid), r: normalRot(wall), s: [r, r, d1 - d0] })
    // straps up to the soffit on an irregular pitch
    const n = 2 + (h1(i, 193) > 0.5 ? 1 : 0)
    for (let k = 0; k <= n; k++) {
      const d = 0.4 + (d1 - 0.9) * THREE.MathUtils.clamp((k + (h1(k, 197 + i) - 0.5) * 0.5) / n, 0, 1)
      XLOW_HANGER.push({ p: wallAt(wall, x, (SOFFIT_Y + y) / 2, d), s: wallDim(wall, 0.06, SOFFIT_Y - y, r * 2.6) })
    }
    // a flange where it leaves the wall and a box where it meets the fascia
    PIPE_FLANGE.push({ p: wallAt(wall, x, y, 0.42), r: normalRot(wall), s: [r * 1.9, r * 1.9, 0.07] })
    PIPE_JBOX.push({
      p: wallAt(wall, x, y - 0.02, d1 - 0.24),
      r: [0, (h1(i, 199) - 0.5) * 0.2, 0],
      s: wallDim(wall, 0.44, 0.3 + h1(i, 211) * 0.16, 0.34),
    })
    // and, on about half of them, a second thinner line branching off the box
    // and running back along the soffit at an angle the coffers do not have
    if (h1(i, 223) > 0.45) {
      const dir = h1(i, 227) > 0.5 ? 1 : -1
      const bl = 1.4 + h1(i, 229) * 1.6
      // it must head BACK toward the wall, never out through the fascia: the
      // room is +z off the south wall and -z off the north one
      const yaw = (wall === 2 ? Math.PI : 0) + dir * (0.5 + h1(i, 233) * 0.4)
      const c = wallAt(wall, x, y + 0.12, d1 - 0.45)
      PIPE_BODY.push({
        p: [c[0] + Math.sin(yaw) * bl * 0.5, c[1], c[2] + Math.cos(yaw) * bl * 0.5],
        r: [0, yaw, 0],
        s: [r * 0.6, r * 0.6, bl],
      })
    }
  }
}

// --- three-barrel trunk risers on the piers ----------------------------------
{
  for (let i = 0; i < ARENA_TRUNK_RISERS.length; i++) {
    const [wall, along, yTop, r] = ARENA_TRUNK_RISERS[i]
    // R7d — barrels fattened to read at 30 m; the pitch keeps the outer pair
    // inside the 1.1 m the coupled shafts leave on the pier
    const PITCH = r >= 0.2 ? 0.44 : 0.4
    const yBot = 2.72
    const h = yTop - yBot
    const d = 0.28
    const s = r / 0.29
    for (let b = -1; b <= 1; b++) {
      const a = along + b * PITCH
      // each barrel a slightly different height, so the three elbows do not
      // sit on one line
      const top = yTop - Math.abs(b) * 0.22 - h1(i * 3 + b, 239) * 0.12
      DROP_BODY.push({ p: wallAt(wall, a, (top - s + yBot) / 2, d), r: VERT_ROT, s: [r, r, top - s - yBot] })
      DROP_BEND.push({ p: wallAt(wall, a, top - s, d - s), r: elbowIntoWallRot(wall), s: [s, s, s] })
      DROP_FLANGE.push({ p: wallAt(wall, a, yBot + 0.34 + h1(b + 2, 241 + i) * 0.5, d), r: VERT_ROT, s: [r * 1.75, r * 1.75, 0.08] })
      if (h > 3.5) {
        DROP_FLANGE.push({ p: wallAt(wall, a, yBot + h * (0.55 + b * 0.06), d), r: VERT_ROT, s: [r * 1.75, r * 1.75, 0.08] })
      }
    }
    // shared clamps spanning the three barrels, back to the wall
    const nClamp = Math.max(1, Math.round(h / 1.6))
    for (let k = 0; k <= nClamp; k++) {
      const y = yBot + 0.5 + (h - 1.1) * (k / nClamp) + (h1(k, 251 + i) - 0.5) * 0.2
      DROP_CLAMP.push({ p: wallAt(wall, along, y, d * 0.6), s: wallDim(wall, d * 0.72 + r, r * 2.2, 2 * PITCH + r * 2.6) })
    }
    // the manifold on the dado cap the three rise out of: a wide flanged box,
    // a hand wheel on its face and a gauge beside it
    DROP_BOX.push({ p: wallAt(wall, along, yBot - 0.3, 0.2), s: wallDim(wall, 0.42, 0.56, 2 * PITCH + r * 2 + 0.34) })
    DROP_WHEEL.push({ p: wallAt(wall, along + (h1(i, 257) - 0.5) * 0.5, yBot - 0.3, 0.5), r: normalRot(wall), s: [0.16, 0.16, 0.16] })
    DROP_SPOKE.push({ p: wallAt(wall, along + (h1(i, 257) - 0.5) * 0.5, yBot - 0.3, 0.5), r: normalRot(wall), s: [0.16, 0.16, 0.16] })
    DROP_SPOKE.push({ p: wallAt(wall, along + (h1(i, 257) - 0.5) * 0.5, yBot - 0.3, 0.5), r: [0, normalRot(wall)[1], Math.PI / 2], s: [0.16, 0.16, 0.16] })
    DROP_STUB.push({ p: wallAt(wall, along + (h1(i, 257) - 0.5) * 0.5, yBot - 0.3, 0.42), r: normalRot(wall), s: [0.04, 0.04, 0.16] })
    DROP_GAUGE.push({ p: wallAt(wall, along + (h1(i, 263) > 0.5 ? 1 : -1) * (PITCH + 0.16), yBot - 0.22, 0.43), r: normalRot(wall), s: [0.11, 0.11, 0.06] })
  }
}

// --- R7d: MASS at the scale the combat camera sees ----------------------------
// The 08 capture put the south wall 34 m from the lens (27 px/m), so every
// fitting under ~0.3 m is a few pixels and the 1 m ivory tile is what reads.
// The reference's wall crop is two-thirds machine; this block covers ours the
// same way with things that hold up at 30 m: ductwork with a plenum, hung
// cabinets, 2–3 m bolted plates over the field, and two more cloth sheets.
{
  // ducts under the gallery soffits, turning down to a plenum on the dado cap
  for (let i = 0; i < ARENA_UNDERCROFT_DUCTS.length; i++) {
    const [side, x0, x1, y, w, hh, drop] = ARENA_UNDERCROFT_DUCTS[i]
    const wall = side > 0 ? 3 : 2
    const dc = 0.31 + w / 2
    const len = x1 - x0
    XLOW_BAR.push({ p: wallAt(wall, (x0 + x1) / 2, y, dc), s: wallDim(wall, w, hh, len) })
    // flanged joints on an irregular pitch
    const n = Math.max(2, Math.round(len / 2.4))
    for (let k = 1; k < n; k++) {
      const a = x0 + len * THREE.MathUtils.clamp((k + (h1(k, 293 + i) - 0.5) * 0.5) / n, 0.06, 0.94)
      TRAY_LIP.push({ p: wallAt(wall, a, y, dc), s: wallDim(wall, w + 0.08, hh + 0.08, 0.06) })
    }
    // straps to the soffit
    for (let k = 0; k <= n; k++) {
      const a = x0 + 0.5 + (len - 1) * (k / n)
      XLOW_HANGER.push({ p: wallAt(wall, a, (y + hh / 2 + 4.98) / 2, dc), s: wallDim(wall, w + 0.06, 4.98 - y - hh / 2, 0.07) })
    }
    if (drop === 0) {
      // no room to drop in either bay: the duct ends in a grille box on the wall
      for (const ex of [x0 - 0.2, x1 + 0.2]) {
        TANK_CABINET.push({ p: wallAt(wall, ex, y, 0.02 + (w + 0.5) / 2), s: wallDim(wall, w + 0.5, hh + 0.5, 0.7) })
        for (let k = 0; k < 4; k++) {
          VENT_SLAT.push({ p: wallAt(wall, ex, y - 0.18 + k * 0.12, w + 0.54), s: wallDim(wall, 0.05, 0.04, 0.5) })
        }
      }
      continue
    }
    // the drop: a vertical duct section and the plenum it feeds
    const ex = drop > 0 ? x1 + w / 2 : x0 - w / 2
    const yv = (y - hh / 2 + 2.95) / 2
    XLOW_BAR.push({ p: wallAt(wall, ex, yv, dc), s: wallDim(wall, w, y - hh / 2 - 2.95 + 0.02, w * 0.9) })
    TRAY_LIP.push({ p: wallAt(wall, ex, 3.0, dc), s: wallDim(wall, w + 0.08, 0.06, w * 0.9 + 0.08) })
    TANK_CABINET.push({ p: wallAt(wall, ex, 2.62, 0.02 + (w + 0.4) / 2), s: wallDim(wall, w + 0.4, 0.64, w * 0.9 + 0.5) })
    // a louvre face on the plenum (slats), and a gauge
    for (let k = 0; k < 3; k++) {
      VENT_SLAT.push({ p: wallAt(wall, ex, 2.48 + k * 0.12, w + 0.44), s: wallDim(wall, 0.05, 0.04, w * 0.9 + 0.2) })
    }
    DROP_GAUGE.push({ p: wallAt(wall, ex + (drop > 0 ? -1 : 1) * (w * 0.45 + 0.4), 2.62, 0.3), r: normalRot(wall), s: [0.12, 0.12, 0.06] })
  }

  // hung machine cabinets under the galleries, below the duct line
  for (let i = 0; i < ARENA_UNDERCROFT_CABINETS.length; i++) {
    const [side, x, w, dpt] = ARENA_UNDERCROFT_CABINETS[i]
    const wall = side > 0 ? 3 : 2
    const hh = 1.3 + h1(i, 307) * 0.2
    const yc = 2.1 + hh / 2
    TANK_CABINET.push({ p: wallAt(wall, x, yc, dpt / 2), s: wallDim(wall, dpt, hh, w) })
    // a pair of doors with a shadow line between, hinges, a vent slot
    for (const e of [-1, 1]) {
      CAB_DOOR.push({ p: wallAt(wall, x + e * (w * 0.25 + 0.01), yc, dpt + 0.012), s: wallDim(wall, 0.02, hh * 0.84, w * 0.46) })
      CAB_HINGE.push({ p: wallAt(wall, x + e * (w / 2 - 0.05), yc + 0.3, dpt + 0.03), s: wallDim(wall, 0.05, 0.14, 0.05) })
      CAB_HINGE.push({ p: wallAt(wall, x + e * (w / 2 - 0.05), yc - 0.3, dpt + 0.03), s: wallDim(wall, 0.05, 0.14, 0.05) })
    }
    for (let k = 0; k < 4; k++) {
      VENT_SLAT.push({ p: wallAt(wall, x - w * 0.22, yc + hh * 0.3 - k * 0.07, dpt + 0.02), s: wallDim(wall, 0.03, 0.03, w * 0.3) })
    }
    // brackets to the wall above and below, and a conduit up to the duct line
    for (const f of [-0.42, 0.42]) {
      CAB_BRACKET.push({ p: wallAt(wall, x + f * w, yc + hh / 2 + 0.06, dpt * 0.45), s: wallDim(wall, dpt * 0.9, 0.1, 0.14) })
    }
    const px = x + (h1(i, 311) > 0.5 ? 1 : -1) * (w / 2 - 0.2)
    CAB_PIPE.push({ p: wallAt(wall, px, (yc + hh / 2 + 4.32) / 2, 0.3), r: VERT_ROT, s: [0.055, 0.055, 4.32 - yc - hh / 2] })
  }

  // wall cabinets on the long walls and the end walls outside the galleries
  for (let i = 0; i < ARENA_WALL_CABINETS.length; i++) {
    const [wall, along, w, hh, dpt, yBase] = ARENA_WALL_CABINETS[i]
    const yc = yBase + hh / 2
    TANK_CABINET.push({ p: wallAt(wall, along, yc, dpt / 2), s: wallDim(wall, dpt, hh, w) })
    CAB_DOOR.push({ p: wallAt(wall, along - w * 0.03, yc, dpt + 0.012), s: wallDim(wall, 0.02, hh * 0.86, w * 0.42) })
    CAB_DOOR.push({ p: wallAt(wall, along + w * 0.26, yc, dpt + 0.012), s: wallDim(wall, 0.02, hh * 0.86, w * 0.42) })
    for (const f of [-0.36, 0.36]) {
      CAB_HINGE.push({ p: wallAt(wall, along - w * 0.46, yc + f * hh, dpt + 0.03), s: wallDim(wall, 0.05, 0.12, 0.05) })
    }
    for (const f of [-0.42, 0.42]) {
      CAB_BRACKET.push({ p: wallAt(wall, along + f * w, yc - hh / 2 - 0.08, dpt * 0.45), s: wallDim(wall, dpt * 0.9, 0.12, 0.14) })
    }
    // a conduit from the cabinet's top up to the corbel course (long walls)
    // or the gallery soffit line, clamped twice
    const top = wall < 2 || Math.abs(along) > 20.8 ? 8.45 : 4.9
    const px = along + (h1(i, 317) > 0.5 ? 1 : -1) * (w / 2 - 0.16)
    const y0 = yc + hh / 2
    CAB_PIPE.push({ p: wallAt(wall, px, (y0 + top) / 2, 0.18), r: VERT_ROT, s: [0.06, 0.06, top - y0] })
    CAB_BRACKET.push({ p: wallAt(wall, px, y0 + (top - y0) * 0.35, 0.09), s: wallDim(wall, 0.18, 0.14, 0.16) })
    CAB_BRACKET.push({ p: wallAt(wall, px, y0 + (top - y0) * 0.8, 0.09), s: wallDim(wall, 0.18, 0.14, 0.16) })
  }

  // big bolted plates over the field, in front of a screen where there is one
  let n = 500
  for (let i = 0; i < ARENA_BIG_PLATES.length; i++) {
    const [wall, along, y, w, hh] = ARENA_BIG_PLATES[i]
    patch(wall, along, y, w, hh, 0.24, n++)
    // a second row of bolts down the middle of the wide ones, and a seam
    if (w > 2.2) {
      PATCH_PLATE.push({ p: wallAt(wall, along, y, 0.245), s: wallDim(wall, 0.06, hh + 0.02, 0.05) })
      for (const e of [-1, 1]) {
        PATCH_STUD.push({ p: wallAt(wall, along, y + e * (hh / 2 - 0.1), 0.29), r: normalRot(wall), s: [0.03, 0.03, 0.05] })
      }
    }
  }
}

// --- gallery fronts: bolted plates and caged lamps ---------------------------
{
  /** the fascia face stands 5.2 m into the room from the end wall's face */
  const FASCIA_D = 5.2
  let n = 400
  for (let i = 0; i < ARENA_FASCIA_FITTINGS.length; i++) {
    const [side, x, kind] = ARENA_FASCIA_FITTINGS[i]
    const wall = side > 0 ? 3 : 2
    if (kind === 0) {
      const w = 0.36 + h1(i, 269) * 0.5
      const hh = 0.3 + h1(i, 271) * 0.4
      patch(wall, x, 4.85 + h1(i, 277) * 0.85, w, hh, FASCIA_D + 0.03, n++)
    } else {
      const y = 4.72 + h1(i, 281) * 0.25
      LAMP_BOX.push({ p: wallAt(wall, x, y, FASCIA_D + 0.14), s: wallDim(wall, 0.28, 0.5, 0.34) })
      LAMP_HOOD.push({ p: wallAt(wall, x, y + 0.31, FASCIA_D + 0.2), s: wallDim(wall, 0.44, 0.07, 0.46) })
      LAMP_SLIT.push({ p: wallAt(wall, x, y + 0.02, FASCIA_D + 0.285), s: wallDim(wall, 0.02, 0.3, 0.2) })
      for (const e of [-1, 1]) {
        LAMP_BAR.push({ p: wallAt(wall, x + e * 0.06, y + 0.02, FASCIA_D + 0.31), s: wallDim(wall, 0.02, 0.36, 0.02) })
      }
      // its feed: a conduit up the fascia to the rail line
      DROP_BODY.push({ p: wallAt(wall, x + 0.28, 5.55, FASCIA_D + 0.06), r: VERT_ROT, s: [0.03, 0.03, 1.1] })
    }
  }
}

/** R7b — the small-object layer, one InstancedMesh per family. */
function WallGreeble() {
  return (
    <group>
      {/* arena: vertical drops with clamps, flanges, elbows, valve wheels and gauges */}
      <Instanced geometry={PIPE_SEG} material={obsidianMaterial()} items={DROP_BODY} receiveShadow castShadow />
      <Instanced geometry={PIPE_ELBOW} material={obsidianMaterial()} items={DROP_BEND} receiveShadow castShadow />
      <Instanced geometry={FLANGE_GEO} material={goldCastMaterial()} items={DROP_FLANGE} receiveShadow castShadow />
      <Instanced geometry={SADDLE_GEO} material={umberMaterial()} items={DROP_CLAMP} receiveShadow />
      <Instanced geometry={JBOX_GEO} material={umberMaterial()} items={DROP_BOX} receiveShadow castShadow />
      <Instanced geometry={PIPE_SEG} material={obsidianMaterial()} items={DROP_STUB} receiveShadow />
      <Instanced geometry={FLANGE_GEO} material={goldCastMaterial()} items={DROP_GAUGE} receiveShadow />
      <Instanced geometry={WHEEL_GEO} material={goldCastMaterial()} items={DROP_WHEEL} receiveShadow castShadow />
      <Instanced geometry={SPOKE_GEO} material={goldCastMaterial()} items={DROP_SPOKE} receiveShadow />
      {/* bolted patches */}
      <Instanced geometry={BOX} material={umberMaterial()} items={PATCH_PLATE} receiveShadow castShadow />
      <Instanced geometry={STUD_GEO} material={goldCastMaterial()} items={PATCH_STUD} receiveShadow />
      {/* bay cable trays */}
      <Instanced geometry={BOX} material={umberMaterial()} items={TRAY_BASE} receiveShadow castShadow />
      <Instanced geometry={BOX} material={goldCastMaterial()} items={TRAY_LIP} receiveShadow castShadow />
      <Instanced geometry={BOX} material={umberMaterial()} items={TRAY_ARM} receiveShadow />
      <Instanced geometry={RAIL_TUBE} material={cableMaterial()} items={TRAY_CABLE} receiveShadow />
      {/* ladders */}
      <Instanced geometry={BOX} material={goldCastMaterial()} items={LADDER_STILE} receiveShadow castShadow />
      <Instanced geometry={RAIL_TUBE} material={obsidianMaterial()} items={LADDER_RUNG} receiveShadow />
      <Instanced geometry={BOX} material={umberMaterial()} items={LADDER_STANDOFF} receiveShadow />
      {/* caged lamps */}
      <Instanced geometry={JBOX_GEO} material={umberMaterial()} items={LAMP_BOX} receiveShadow castShadow />
      <Instanced geometry={BOX} material={goldCastMaterial()} items={LAMP_HOOD} receiveShadow castShadow />
      <Instanced geometry={BOX} material={veinGoldMaterial()} items={LAMP_SLIT} />
      <Instanced geometry={BOX} material={obsidianMaterial()} items={LAMP_BAR} receiveShadow />
      {/* tank clusters in the suppressed bays */}
      <Instanced geometry={TANK_GEO} material={umberMaterial()} items={TANK_BODY} receiveShadow castShadow />
      <Instanced geometry={TANK_CAP} material={umberMaterial()} items={TANK_END} receiveShadow castShadow />
      <Instanced geometry={HOOP_GEO} material={goldCastMaterial()} items={TANK_HOOP} receiveShadow castShadow />
      <Instanced geometry={SADDLE_GEO} material={obsidianMaterial()} items={TANK_SADDLE} receiveShadow />
      <Instanced geometry={PIPE_SEG} material={obsidianMaterial()} items={TANK_PIPE} receiveShadow castShadow />
      <Instanced geometry={JBOX_GEO} material={umberMaterial()} items={TANK_CABINET} receiveShadow castShadow />
      {/* arena: cable runs lying on the deck */}
      <Instanced geometry={PIPE_SEG} material={cableMaterial()} items={DECK_CABLE} receiveShadow castShadow />
      <Instanced geometry={SADDLE_GEO} material={umberMaterial()} items={DECK_CLAMP} receiveShadow />
      <Instanced geometry={JBOX_GEO} material={umberMaterial()} items={DECK_JBOX} receiveShadow castShadow />
      {/* canyon: low crossings, hung boxes and pendants */}
      <Instanced geometry={BOX} material={umberMaterial()} items={XLOW_BAR} receiveShadow castShadow />
      <Instanced geometry={PIPE_SEG} material={obsidianMaterial()} items={XLOW_PIPE} receiveShadow castShadow />
      <Instanced geometry={BOX} material={obsidianMaterial()} items={XLOW_HANGER} receiveShadow />
      <Instanced geometry={JBOX_GEO} material={umberMaterial()} items={XLOW_BOX} receiveShadow castShadow />
      <Instanced geometry={PENDANT_ROD} material={goldMaterial()} items={XLOW_LAMP_ROD} castShadow />
      <Instanced geometry={PENDANT_HOOD} material={goldCastMaterial()} items={XLOW_LAMP_HOOD} castShadow />
      <Instanced geometry={PENDANT_LENS} material={veinGoldMaterial()} items={XLOW_LAMP_LENS} />
      {/* canyon: service pods over the void */}
      <Instanced geometry={PANEL_BOX} material={umberMaterial()} items={POD_DECK} receiveShadow castShadow />
      <Instanced geometry={BOX} material={umberMaterial()} items={POD_BRACKET} receiveShadow castShadow />
      <Instanced geometry={TANK_GEO} material={umberMaterial()} items={POD_TANK} receiveShadow castShadow />
      <Instanced geometry={TANK_CAP} material={umberMaterial()} items={POD_TANK_END} receiveShadow castShadow />
      <Instanced geometry={HOOP_GEO} material={goldCastMaterial()} items={POD_HOOP} receiveShadow castShadow />
      <Instanced geometry={JBOX_GEO} material={umberMaterial()} items={POD_CABINET} receiveShadow castShadow />
      <Instanced geometry={PIPE_SEG} material={obsidianMaterial()} items={POD_PIPE} receiveShadow castShadow />
      <Instanced geometry={RAIL_TUBE} material={goldCastMaterial()} items={POD_RAIL} receiveShadow castShadow />
      <Instanced geometry={RAIL_POST} material={obsidianMaterial()} items={POD_POST} receiveShadow castShadow />
      {/* canyon: wall cabinets */}
      <Instanced geometry={JBOX_GEO} material={umberMaterial()} items={CAB_BODY} receiveShadow castShadow />
      <Instanced geometry={BOX} material={recessMaterial()} items={CAB_DOOR} receiveShadow />
      <Instanced geometry={BOX} material={goldCastMaterial()} items={CAB_HINGE} receiveShadow />
      <Instanced geometry={PIPE_SEG} material={obsidianMaterial()} items={CAB_PIPE} receiveShadow castShadow />
      <Instanced geometry={SADDLE_GEO} material={umberMaterial()} items={CAB_BRACKET} receiveShadow />
    </group>
  )
}

/**
 * Everything above, as one component so the level tree stays readable. Every
 * list is an InstancedMesh; the whole block is ~20 draw calls and the matrices
 * are written once on mount.
 */
function ServiceGreeble() {
  return (
    <group>
      {/* conduit: barrels, quarter bends, bolted flanges, studs, saddles and
          the junction boxes the drops terminate in */}
      <Instanced geometry={PIPE_SEG} material={obsidianMaterial()} items={PIPE_BODY} receiveShadow castShadow />
      <Instanced geometry={PIPE_ELBOW} material={obsidianMaterial()} items={PIPE_BEND} receiveShadow castShadow />
      <Instanced geometry={FLANGE_GEO} material={goldCastMaterial()} items={PIPE_FLANGE} receiveShadow castShadow />
      <Instanced geometry={STUD_GEO} material={goldCastMaterial()} items={PIPE_STUD} receiveShadow />
      <Instanced geometry={SADDLE_GEO} material={umberMaterial()} items={PIPE_SADDLE} receiveShadow castShadow />
      <Instanced geometry={JBOX_GEO} material={umberMaterial()} items={PIPE_JBOX} receiveShadow castShadow />
      {/* vent louvres punched through the wall field */}
      <Instanced geometry={VENT_CAVITY} material={ivoryContactMaterial()} items={VENT_CAVITY_I} receiveShadow />
      <Instanced geometry={SLAT_GEO} material={obsidianMaterial()} items={VENT_SLAT} receiveShadow castShadow />
      <Instanced geometry={BOX} material={goldEdgeMaterial()} items={VENT_FRAME} receiveShadow castShadow />
      {/* the soft family — cable, growth, cloth */}
      {CABLE_RUNS.map((run, i) => (
        <Instanced key={run.len} geometry={CABLE_GEOS[i]} material={cableMaterial()} items={run.items} receiveShadow castShadow />
      ))}
      <Instanced geometry={GROWTH_CARD} material={growthMaterial()} items={GROWTH_ITEMS} receiveShadow castShadow />
      <Instanced geometry={CLOTH_DROP} material={clothMaterial()} items={CLOTH_ITEMS} receiveShadow castShadow />
      {/* scale props */}
      <Instanced geometry={CRATE_GEO} material={umberMaterial()} items={CRATE_BODY} receiveShadow castShadow />
      <Instanced geometry={BOX} material={goldCastMaterial()} items={CRATE_BAND} receiveShadow />
      <Instanced geometry={RAIL_TUBE} material={goldCastMaterial()} items={RAIL_TOP} receiveShadow castShadow />
      <Instanced geometry={RAIL_TUBE} material={obsidianMaterial()} items={RAIL_MID} receiveShadow castShadow />
      <Instanced geometry={RAIL_POST} material={obsidianMaterial()} items={RAIL_POSTS} receiveShadow castShadow />
      <Instanced geometry={BOX} material={umberMaterial()} items={RAIL_SHOE} receiveShadow />
    </group>
  )
}

// ---------------------------------------------------------------------------
// ShrineStation — the whole level
// ---------------------------------------------------------------------------
export default function ShrineStation() {
  const root = useRef<THREE.Group>(null!)

  // register all static colliders (dynamic gates register themselves)
  useEffect(() => {
    clearColliders()
    buildLevelColliders()
    return () => clearColliders()
  }, [])

  /**
   * R2 shadow sweep — the single highest-value change in this round.
   *
   * Setting `receiveShadow` on a few hundred JSX elements by hand is how the
   * R1 build ended up with 80 receivers out of 880 meshes: every new piece of
   * dressing silently opted out. Instead the level's whole subtree is swept
   * once on mount. Rules:
   *   - anything with a lit (standard) material RECEIVES; this is the fix.
   *   - unlit energy/decal materials are skipped — a MeshBasicMaterial ignores
   *     the flag anyway, and skipping keeps the shadow-receive material count
   *     honest if anyone measures it again.
   *   - CASTING is not set here. Cast cost scales with caster count and the
   *     diagnosis explicitly asks for large structural masses to cast while
   *     small trim stays receive-only, so casters remain per-call-site.
   * The level is static, so this runs exactly once.
   */
  useLayoutEffect(() => {
    const g = root.current
    if (!g) return
    let receivers = 0
    g.traverse((o) => {
      const m = o as THREE.Mesh
      if (!m.isMesh) return
      const mat = m.material as THREE.Material | THREE.Material[]
      const lit = Array.isArray(mat)
        ? mat.some((x) => (x as THREE.MeshStandardMaterial).isMeshStandardMaterial)
        : (mat as THREE.MeshStandardMaterial)?.isMeshStandardMaterial === true
      if (!lit) return
      m.receiveShadow = true
      receivers++
    })
    if (receivers === 0) console.warn('[ShrineStation] shadow sweep found no lit meshes')
  }, [])

  return (
    <group ref={root} name="level-root">
      <ZoneA />
      <ZoneB />
      <ZoneC />
      <ZoneD />
      <ZoneE />
      {/* R7 — the off-grid service families and the soft material family.
          Everything that disagrees with the Orokin order lives here. */}
      <ServiceGreeble />
      {/* R7b — the small-object layer on the arena walls and the traversal
          near field. See the block above WallGreeble. */}
      <WallGreeble />
      {/* R5 — banner hardware: plaque, rod, finials, brackets, hem bar. The
          cloth is unlit by construction, so it needs lit geometry around it or
          it reads as a floating white rectangle. */}
      <Instanced geometry={PANEL_BOX} material={umberMaterial()} items={BANNER_PLAQUE} receiveShadow castShadow />
      <Instanced geometry={PLANE} material={bannerMaterial()} items={BANNERS} />
      <Instanced geometry={CYL} material={goldCastMaterial()} items={BANNER_ROD} receiveShadow castShadow />
      <Instanced geometry={OCTA} material={goldPolishedMaterial()} items={BANNER_FINIAL} receiveShadow castShadow />
      <Instanced geometry={RBOX} material={goldMaterial()} items={BANNER_BRACKET} receiveShadow castShadow />
      <Instanced geometry={BOX} material={goldCastMaterial()} items={BANNER_WEIGHT} receiveShadow castShadow />
      {/* distant monoliths — beveled, trimmed, emissive-striped silhouettes */}
      <Instanced geometry={RBOX} material={ivoryMaterial()} items={MONO_BODY} castShadow />
      <Instanced geometry={RBOX} material={ivoryMaterial()} items={MONO_SECOND} castShadow />
      <Instanced geometry={BOX} material={recessMaterial()} items={MONO_PANELS} />
      <Instanced geometry={BOX} material={goldMaterial()} items={MONO_GOLD} />
      {/* distant monoliths: both stripe sets are aureate now — a teal
          silhouette on the horizon read as a second faction */}
      <Instanced geometry={BOX} material={veinGoldMaterial()} items={MONO_TEAL} />
      <Instanced geometry={BOX} material={veinGoldMaterial()} items={MONO_GOLDGLOW} />
    </group>
  )
}

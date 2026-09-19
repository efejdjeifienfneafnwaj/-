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
  type BoxSpec,
} from './layout'
import { clearColliders, registerCollider, unregisterCollider } from './Colliders'
import {
  ivoryMaterial,
  ivoryContactMaterial,
  goldMaterial,
  goldPolishedMaterial,
  goldEdgeMaterial,
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

/** Bake a UV repeat into a geometry so one shared trim material can serve
 *  runs of different lengths without cloning the texture. */
function repeatUv(g: THREE.BufferGeometry, ru: number, rv = 1): THREE.BufferGeometry {
  const uv = g.attributes.uv as THREE.BufferAttribute
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * ru, uv.getY(i) * rv)
  uv.needsUpdate = true
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
const SCREEN_TALL = repeatUv(new THREE.PlaneGeometry(1, 1), 2, 2)
/** single coffer (stepped frame, punched centre) for the upper wall register */
const COFFER_PANEL = new THREE.PlaneGeometry(1, 1)

/** flat annulus in the XZ plane (rotate −π/2 about X to lay it on a floor) */
function annulus(inner: number, outer: number, seg = 96): THREE.BufferGeometry {
  return new THREE.RingGeometry(inner, outer, seg)
}
const MANDALA_CHANNEL = annulus(0.955, 1.0)
const MANDALA_INLAY = annulus(0.966, 0.99)
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

function ZoneA() {
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
      <Instanced geometry={BOX} material={goldMaterial()} items={B_WEST_PILASTERS} />
      <Instanced geometry={BOX} material={recessMaterial()} items={B_WEST_SCREEN_BACK} />
      <Instanced
        geometry={SCREEN_TALL}
        material={screenMaterial()}
        items={B_WEST_SCREEN}
        castShadow
      />
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

function Planter({ x, z, purify }: { x: number; z: number; purify?: boolean }) {
  const petals = useMemo(() => rosette(x, 1.15, z, 0.8, 8, -0.55, [0.5, 0.8, 0.5]), [x, z])
  return (
    <group>
      <mesh geometry={RBOX} material={ivoryMaterial()} position={[x, 0.5, z]} scale={[2, 1, 2]} receiveShadow castShadow />
      <mesh geometry={BOX} material={goldMaterial()} position={[x, 1.02, z]} scale={[2.1, 0.08, 2.1]} />
      <Instanced geometry={PETAL} material={goldMaterial()} items={petals} />
      <mesh
        geometry={CIRCLE}
        material={purify ? purifyVeinMaterial() : veinTealMaterial()}
        position={[x, 1.1, z]}
        rotation={[-Math.PI / 2, 0, 0]}
        scale={[0.7, 0.7, 1]}
      />
    </group>
  )
}

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

      {/* perimeter walls + trim + panel detail. R2: the walls are drawn with
          the subdivided PANEL_BOX and the contact-AO ivory, so a 10 m wall has
          a grounded dark band at its foot even with the SSAO pass off — and
          they cast, so the colonnade finally throws shadows across the floor. */}
      {C_WALLS.map((w, i) => (
        <MassMesh
          key={i}
          spec={w}
          geometry={PANEL_BOX}
          material={ivoryContactMaterial()}
          castShadow
        />
      ))}
      <Instanced geometry={RBOX} material={umberMaterial()} items={C_BASE} receiveShadow />
      <Instanced geometry={TRIM_RUN} material={goldMaterial()} items={C_CORNICE} />
      <Instanced geometry={BOX} material={goldMaterial()} items={C_WALL_TRIM} />
      <Instanced geometry={BOX} material={goldMaterial()} items={C_WALL_PILASTERS} />
      <Instanced geometry={BOX} material={goldMaterial()} items={C_PILASTER_NOSING} />
      <Instanced geometry={BOX} material={goldEdgeMaterial()} items={C_PILASTER_NOSING_LIP} />
      <Instanced geometry={BOX} material={recessMaterial()} items={C_WALL_BANDS} />
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
      <Instanced geometry={RBOX} material={ivoryMaterial()} items={C_CORBELS} />

      {/* teal vein clusters + corruption glyphs */}
      <Instanced geometry={BOX} material={veinTealMaterial()} items={C_VEINS} />
      <mesh geometry={PLANE} material={glyphDecalMaterial()} position={[-14.35, 2.4, 142]} rotation={[0, Math.PI / 2, 0]} scale={[2.4, 2.4, 1]} />
      <mesh geometry={PLANE} material={glyphDecalMaterial()} position={[14.35, 2.4, 158]} rotation={[0, -Math.PI / 2, 0]} scale={[2.4, 2.4, 1]} />

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

// arena wall detail: gold pilasters + obsidian panel lines + teal insets
const D_WALL_PILASTERS: InstItem[] = []
const D_WALL_BANDS: InstItem[] = []
const D_WALL_INSETS: InstItem[] = []
for (let z = 171; z <= 219; z += 6) {
  D_WALL_PILASTERS.push({ p: [29.91, 5, z], s: [0.16, 10, 0.6] })
  D_WALL_PILASTERS.push({ p: [-29.91, 5, z], s: [0.16, 10, 0.6] })
}
for (let x = -24; x <= 24; x += 6) {
  if (Math.abs(x) < 5) continue // keep the gate openings clear
  D_WALL_PILASTERS.push({ p: [x, 5, 165.09], s: [0.6, 10, 0.16] })
  D_WALL_PILASTERS.push({ p: [x, 5, 224.91], s: [0.6, 10, 0.16] })
}
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

// east / west long walls
for (const sx of [1, -1]) {
  // screen + coffer bays, skipping the z where the corruption insets sit
  for (const z of [171.5, 177.5, 189, 195, 213, 219]) {
    D_SCREEN_BACK.push({ p: [sx * 29.9, 3.2, z], s: [0.22, 5.0, 5.4] })
    D_SCREENS.push({ p: [sx * 29.76, 3.2, z], r: [0, sx * Math.PI / 2, 0], s: [5.1, 4.7, 1] })
    D_COFFER_BACK.push({ p: [sx * 29.9, 8.1, z], s: [0.22, 2.8, 3.2] })
    D_COFFERS.push({ p: [sx * 29.76, 8.1, z], r: [0, sx * Math.PI / 2, 0], s: [3.0, 2.6, 1] })
  }
  for (let z = 171; z <= 219; z += 6) {
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
  for (const x of [-22, -16, -10, 10, 16, 22]) {
    D_SCREEN_BACK.push({ p: [x, 3.2, wz + face * 0.11], s: [5.4, 5.0, 0.22] })
    D_SCREENS.push({ p: [x, 3.2, wz + face * 0.25], r: [0, sz > 0 ? Math.PI : 0, 0], s: [5.1, 4.7, 1] })
    D_COFFER_BACK.push({ p: [x, 8.1, wz + face * 0.11], s: [3.2, 2.8, 0.22] })
    D_COFFERS.push({ p: [x, 8.1, wz + face * 0.25], r: [0, sz > 0 ? Math.PI : 0, 0], s: [3.0, 2.6, 1] })
  }
  for (const x of [-24, -18, -12, 12, 18, 24]) {
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

// floor medallion: concentric gold rings + radial petals (r 20)
const D_MEDAL_RINGS: InstItem[] = [20, 16, 12].map((r) => ({
  p: [0, 0.04, 195] as [number, number, number],
  r: [Math.PI / 2, 0, 0] as [number, number, number],
  s: [r, r, 12] as [number, number, number],
}))
const D_MEDAL_PETALS: InstItem[] = []
for (let i = 0; i < 12; i++) {
  const a = (i / 12) * Math.PI * 2
  D_MEDAL_PETALS.push({
    p: [Math.cos(a) * 17, 0.05, 195 + Math.sin(a) * 17],
    r: [0, Math.PI / 2 - a, 0],
    s: [1.4, 0.35, 1.6],
  })
}

// pylons + teal vein strips
const D_PYLON_ITEMS: InstItem[] = ARENA_PYLONS.map(([x, z]) => ({ p: [x, 1.5, z], s: [1.2, 3, 1.2] }))
const D_PYLON_CAPS: InstItem[] = ARENA_PYLONS.map(([x, z]) => ({ p: [x, 3.1, z], s: [1.5, 0.25, 1.5] }))
const D_PYLON_VEINS: InstItem[] = ARENA_PYLONS.map(([x, z]) => ({ p: [x, 1.6, z + 0.63], s: [0.2, 2.6, 0.06] }))

// stepped moulding capping every pylon
const D_PYLON_MOULD: InstItem[] = ARENA_PYLONS.map(([x, z]) => ({
  p: [x, 2.95, z] as [number, number, number],
  s: [1, 1, 1.35] as [number, number, number],
}))
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

function ZoneD() {
  return (
    <group>
      {/* floor + medallion */}
      <MassMesh spec={{ x0: -30, y0: -1, z0: 165, x1: 30, y1: 0, z1: 225 }} material={floorMaterial()} />
      <Instanced geometry={BOX} material={umberMaterial()} items={D_FLOOR_UMBER} receiveShadow />
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
      {/* the rings and petals are GILDED INLAY, not energy — lit metal, so the
          arena floor stops reading as a flat orange decal. Only the small
          centre disc stays emissive, and EnvironmentFX still pulses it. */}
      <Instanced geometry={RING_GEO} material={goldPolishedMaterial()} items={D_MEDAL_RINGS} />
      <Instanced geometry={PETAL} material={goldMaterial()} items={D_MEDAL_PETALS} />
      <mesh geometry={CIRCLE} material={medallionMaterial()} position={[0, 0.04, 195]} rotation={[-Math.PI / 2, 0, 0]} scale={[2.2, 2.2, 1]} />

      {/* walls + trim + panel detail — R2: contact-AO panel walls that cast */}
      {D_WALLS.map((w, i) => (
        <MassMesh
          key={i}
          spec={w}
          geometry={PANEL_BOX}
          material={ivoryContactMaterial()}
          castShadow
        />
      ))}
      <Instanced geometry={RBOX} material={umberMaterial()} items={D_BASE} receiveShadow />
      <Instanced geometry={TRIM_RUN} material={goldMaterial()} items={D_CORNICE} />
      <Instanced geometry={BOX} material={goldMaterial()} items={D_WALL_TRIM} />
      <Instanced geometry={BOX} material={goldMaterial()} items={D_WALL_PILASTERS} />
      <Instanced geometry={BOX} material={goldMaterial()} items={D_PILASTER_NOSING} />
      <Instanced geometry={BOX} material={goldEdgeMaterial()} items={D_PILASTER_NOSING_LIP} />
      <Instanced geometry={BOX} material={recessMaterial()} items={D_WALL_BANDS} />
      <Instanced geometry={FRET_PANEL} material={fretTrimMaterial()} items={D_WALL_FRET} />
      <Instanced geometry={FRET_PANEL} material={fretTrimMaterial()} items={D_FRET_PLINTH} />
      <Instanced geometry={FRET_PANEL} material={fretTrimMaterial()} items={D_FRET_HEAD} />
      <Instanced geometry={BOX} material={recessMaterial()} items={D_WALL_CHANNEL} />
      <Instanced geometry={BOX} material={veinTealMaterial()} items={D_WALL_INSETS} />

      {/* R2 ornament parity with the shrine: pierced screens on the lower
          register, coffers above, a junction angle, corbel framing */}
      <Instanced geometry={BOX} material={recessMaterial()} items={D_SCREEN_BACK} />
      <Instanced geometry={SCREEN_WIDE} material={screenMaterial()} items={D_SCREENS} castShadow />
      <Instanced geometry={BOX} material={recessMaterial()} items={D_COFFER_BACK} />
      <Instanced geometry={COFFER_PANEL} material={cofferMaterial()} items={D_COFFERS} castShadow />
      <Instanced geometry={L_TRIM_RUN} material={goldMaterial()} items={D_LTRIM} />
      <Instanced geometry={RBOX} material={ivoryMaterial()} items={D_CORBELS} />

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
      <Instanced geometry={RBOX} material={obsidianMaterial()} items={D_PYLON_ITEMS} receiveShadow castShadow />
      <Instanced geometry={BOX} material={goldMaterial()} items={D_PYLON_CAPS} />
      <Instanced geometry={TRIM_RUN_FINE} material={goldPolishedMaterial()} items={D_PYLON_MOULD} />
      <Instanced geometry={BOX} material={veinTealMaterial()} items={D_PYLON_VEINS} />
      <Instanced geometry={RBOX} material={obsidianMaterial()} items={D_LOW_WALLS} receiveShadow castShadow />
      <Instanced geometry={BOX} material={goldMaterial()} items={D_LOW_WALL_TOPS} />
      {ARENA_PLANTERS.map(([px, pz]) => (
        <Planter key={`${px},${pz}`} x={px} z={pz} />
      ))}

      {/* corruption set dressing */}
      <Instanced geometry={BOX} material={veinTealMaterial()} items={D_CORRUPTION} />
      <mesh geometry={PLANE} material={glyphDecalMaterial()} position={[-26, 3, 181.5]} rotation={[0, Math.PI / 3, 0]} scale={[3, 3, 1]} />
      <mesh geometry={PLANE} material={glyphDecalMaterial()} position={[25, 2.5, 201]} rotation={[0, -Math.PI / 2.5, 0]} scale={[3, 3, 1]} />

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
  return out
})()

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
    <group ref={root}>
      <ZoneA />
      <ZoneB />
      <ZoneC />
      <ZoneD />
      <ZoneE />
      <Instanced geometry={PLANE} material={bannerMaterial()} items={BANNERS} />
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

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
  goldMaterial,
  goldEdgeMaterial,
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
const PILLAR_GEO = new THREE.CylinderGeometry(0.6, 0.72, 9, 12)
const PETAL = new THREE.BoxGeometry(1, 0.12, 2.2)
const OCTA = new THREE.OctahedronGeometry(1, 0)
const RIB_CANYON = new THREE.TorusGeometry(7, 0.5, 8, 24, Math.PI)
const RIB_CANYON_TRIM = new THREE.TorusGeometry(6.25, 0.16, 6, 24, Math.PI)
const RIB_ARENA = new THREE.TorusGeometry(30, 0.9, 8, 40, Math.PI)
const RIB_ARENA_TRIM = new THREE.TorusGeometry(28.7, 0.24, 6, 40, Math.PI)
const RIB_CHAMBER = new THREE.TorusGeometry(14, 0.45, 8, 28, Math.PI)
const RIB_BRIDGE = new THREE.TorusGeometry(5.5, 0.35, 8, 20, Math.PI)
const RIB_BRIDGE_TRIM = new THREE.TorusGeometry(4.9, 0.13, 6, 20, Math.PI)
const WALL_ARCH = new THREE.TorusGeometry(2.2, 0.3, 8, 20, Math.PI)
const WALL_ARCH_TRIM = new THREE.TorusGeometry(1.82, 0.12, 6, 20, Math.PI)
// arch-bay variants (fix2): B = narrow + heavy, C = wide + slender
const WALL_ARCH_B = new THREE.TorusGeometry(1.55, 0.36, 8, 18, Math.PI)
const WALL_ARCH_B_TRIM = new THREE.TorusGeometry(1.2, 0.13, 6, 18, Math.PI)
const WALL_ARCH_C = new THREE.TorusGeometry(2.9, 0.24, 8, 24, Math.PI)
const WALL_ARCH_C_TRIM = new THREE.TorusGeometry(2.55, 0.1, 6, 24, Math.PI)
// pillar engraving rings + gold bands (open cylinder shells, radius matches
// the tapered PILLAR_GEO surface at each local height)
const PILLAR_ENG1 = new THREE.CylinderGeometry(0.708, 0.708, 0.07, 20, 1, true)
const PILLAR_ENG2 = new THREE.CylinderGeometry(0.671, 0.671, 0.07, 20, 1, true)
const PILLAR_ENG3 = new THREE.CylinderGeometry(0.634, 0.634, 0.07, 20, 1, true)
const PILLAR_BAND_LO = new THREE.CylinderGeometry(0.72, 0.72, 0.2, 20, 1, true)
const PILLAR_BAND_HI = new THREE.CylinderGeometry(0.616, 0.616, 0.16, 20, 1, true)
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

function Instanced({
  geometry,
  material,
  items,
  receiveShadow = false,
}: {
  geometry: THREE.BufferGeometry
  material: THREE.Material
  items: InstItem[]
  receiveShadow?: boolean
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
    />
  )
}

/** Beveled major-mass mesh from a layout BoxSpec — chamfered edges. */
function MassMesh({
  spec,
  material,
  receiveShadow = true,
}: {
  spec: BoxSpec
  material: THREE.Material
  receiveShadow?: boolean
}) {
  const c = boxCenter(spec)
  const s = boxSize(spec)
  return (
    <mesh geometry={RBOX} material={material} position={c} scale={s} receiveShadow={receiveShadow} />
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
// pillar dressing: engraved segment rings, gold base/capital bands, plinths
const A_PILLAR_ENG1: InstItem[] = []
const A_PILLAR_ENG2: InstItem[] = []
const A_PILLAR_ENG3: InstItem[] = []
const A_PILLAR_BAND_LO: InstItem[] = []
const A_PILLAR_BAND_HI: InstItem[] = []
const A_PILLAR_PLINTHS: InstItem[] = []
for (const it of A_PILLARS) {
  const [x, y, z] = it.p
  A_PILLAR_ENG1.push({ p: [x, y - 3.4, z] })
  A_PILLAR_ENG2.push({ p: [x, y - 0.6, z] })
  A_PILLAR_ENG3.push({ p: [x, y + 2.2, z] })
  A_PILLAR_BAND_LO.push({ p: [x, y - 4.15, z] })
  A_PILLAR_BAND_HI.push({ p: [x, y + 3.9, z] })
  A_PILLAR_PLINTHS.push({ p: [x, 0.16, z], s: [1.16, 0.3, 1.16] })
}
const A_POD_PETALS = rosette(0, 0.55, 9, 1.15, 8, -1.0, [0.7, 1, 0.7])
const A_POD_PETALS_GOLD = rosette(0, 0.35, 9, 0.75, 8, -0.6, [0.45, 0.8, 0.45])

function ZoneA() {
  return (
    <group>
      {/* textured obsidian dais + ivory under-skirt */}
      <MassMesh spec={{ x0: -6, y0: -1, z0: 1.5, x1: 6, y1: 0, z1: 13.5 }} material={floorMaterial()} />
      <MassMesh
        spec={{ x0: -7, y0: -1.9, z0: 0.5, x1: 7, y1: -1, z1: 14.5 }}
        material={ivoryMaterial()}
        receiveShadow={false}
      />
      <Instanced geometry={BOX} material={goldMaterial()} items={A_DAIS_TRIM} />
      <Instanced geometry={BOX} material={goldEdgeMaterial()} items={A_DAIS_TRIM_EDGE} />
      {/* pillar ring: engraving rings + gold bands/plinths + gold capitals */}
      <Instanced geometry={PILLAR_GEO} material={ivoryMaterial()} items={A_PILLARS} />
      <Instanced geometry={PILLAR_ENG1} material={obsidianMaterial()} items={A_PILLAR_ENG1} />
      <Instanced geometry={PILLAR_ENG2} material={obsidianMaterial()} items={A_PILLAR_ENG2} />
      <Instanced geometry={PILLAR_ENG3} material={obsidianMaterial()} items={A_PILLAR_ENG3} />
      <Instanced geometry={PILLAR_BAND_LO} material={goldMaterial()} items={A_PILLAR_BAND_LO} />
      <Instanced geometry={PILLAR_BAND_HI} material={goldMaterial()} items={A_PILLAR_BAND_HI} />
      <Instanced geometry={RBOX} material={goldMaterial()} items={A_PILLAR_PLINTHS} />
      <Instanced geometry={BOX} material={goldMaterial()} items={A_CAPITALS} />
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
for (const d of B_DECKS) {
  const len = d.z1 - d.z0 - 0.2
  const zc = (d.z0 + d.z1) / 2
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

// west wall (B2–B4) with gold pilaster strips + teal vein insets
const B_WEST_PILASTERS: InstItem[] = []
const B_WEST_VEINS: InstItem[] = []
for (let z = 44; z <= 132; z += 8) {
  B_WEST_PILASTERS.push({ p: [-5.85, 4.5, z], s: [0.25, 9, 0.6] })
  B_WEST_VEINS.push({ p: [-5.68, 3, z + 4], s: [0.06, 4.5, 0.3] })
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
const B_WALL_GOLD: InstItem[] = []
const B_WALL_ENGRAVE: InstItem[] = []
const B_WALL_KEYSTONE: InstItem[] = []
const B_WALL_MINIPIL: InstItem[] = []

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
      B_WALL_PANELS.push({ p: [px, py, zc], s: [1.2, ph, w * 0.94] })
      const archItem: InstItem = { p: [ax, ay, zc], r: [0, Math.PI / 2, 0], s: archScale }
      if (variant === 0) B_WALL_ARCH_A.push(archItem)
      else if (variant === 1) B_WALL_ARCH_B.push(archItem)
      else B_WALL_ARCH_C.push(archItem)
      // teal practical strips flanking the arch
      B_WALL_TEAL.push({ p: [tx, west ? 2.4 : 2.8, zc - w * 0.34], s: [0.1, west ? 3.6 : 4.4, 0.24] })
      B_WALL_TEAL.push({ p: [tx, west ? 2.4 : 2.8, zc + w * 0.34], s: [0.1, west ? 3.6 : 4.4, 0.24] })
      // gold vertical seam trim (variants A/B) or flanking mini-pilasters (C)
      if (variant === 2) {
        B_WALL_MINIPIL.push({ p: [gx, 5, zc - w * 0.42], s: [0.16, 7, 0.4] })
        B_WALL_MINIPIL.push({ p: [gx, 5, zc + w * 0.42], s: [0.16, 7, 0.4] })
      } else {
        B_WALL_GOLD.push({ p: [gx, west ? 9.5 : 10.5, zc - dir * (w / 2 - 0.2)], s: [0.14, west ? 13 : 14, 0.3] })
      }
      // engraved segment lines across the panel face
      for (const ey of [3.8, 7.6]) {
        B_WALL_ENGRAVE.push({ p: [ex, ey, zc], s: [0.05, 0.09, w * 0.7] })
      }
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
  B_UNDERGLOW.push({ p: [-5.5, -1.06, zc], s: [0.14, 0.12, len] })
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
for (const s of WALLRUN_SLABS) {
  const len = s.z1 - s.z0 - 2
  const zc = (s.z0 + s.z1) / 2
  for (const fy of [s.y0 + (s.y1 - s.y0) * 0.35, s.y0 + (s.y1 - s.y0) * 0.65]) {
    B_SLAB_VEINS.push({ p: [s.x0 - 0.02, fy, zc], s: [0.06, 0.16, len] })
    B_SLAB_VEINS.push({ p: [s.x1 + 0.02, fy, zc], s: [0.06, 0.16, len] })
  }
  // top edge highlight
  B_SLAB_VEINS.push({ p: [(s.x0 + s.x1) / 2, s.y1 + 0.02, zc], s: [s.x1 - s.x0 - 0.4, 0.08, len] })
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
      <Instanced geometry={BOX} material={goldMaterial()} items={B_DECK_TRIM} />
      <Instanced geometry={BOX} material={goldEdgeMaterial()} items={B_DECK_TRIM_EDGE} />

      {/* west railing (B1) */}
      <Instanced geometry={BOX} material={goldMaterial()} items={B_RAIL_POSTS} />
      <Instanced geometry={PETAL} material={goldMaterial()} items={B_RAIL_PETALS} />
      <mesh geometry={BOX} material={goldMaterial()} position={[-6, 1.02, 25.5]} scale={[0.12, 0.1, 23]} />

      {/* west wall (B2–B4) */}
      <MassMesh
        spec={{ x0: -6.4, y0: 0, z0: 40, x1: -5.9, y1: 9, z1: 135 }}
        material={ivoryMaterial()}
      />
      <Instanced geometry={BOX} material={goldMaterial()} items={B_WEST_PILASTERS} />
      <Instanced geometry={BOX} material={veinTealMaterial()} items={B_WEST_VEINS} />

      {/* east glass wall to space */}
      <Instanced geometry={BOX} material={ivoryMaterial()} items={B_MULLIONS} />
      <Instanced geometry={PLANE} material={glassMaterial()} items={B_PANES} />
      <mesh geometry={BOX} material={goldMaterial()} position={[6, 8.15, 74]} scale={[0.5, 0.4, 119]} />
      <mesh geometry={BOX} material={goldMaterial()} position={[6, 0.25, 74]} scale={[0.5, 0.5, 119]} />

      {/* canyon outer wall layers: 3 arch-bay variants, irregular rhythm,
          engraved panel lines, teal practical strips */}
      <Instanced geometry={RBOX} material={ivoryMaterial()} items={B_WALL_PANELS} receiveShadow />
      <Instanced geometry={WALL_ARCH} material={ivoryMaterial()} items={B_WALL_ARCH_A} />
      <Instanced geometry={WALL_ARCH_TRIM} material={goldMaterial()} items={B_WALL_ARCH_A} />
      <Instanced geometry={WALL_ARCH_B} material={ivoryMaterial()} items={B_WALL_ARCH_B} />
      <Instanced geometry={WALL_ARCH_B_TRIM} material={goldMaterial()} items={B_WALL_ARCH_B} />
      <Instanced geometry={WALL_ARCH_C} material={ivoryMaterial()} items={B_WALL_ARCH_C} />
      <Instanced geometry={WALL_ARCH_C_TRIM} material={goldMaterial()} items={B_WALL_ARCH_C} />
      <Instanced geometry={BOX} material={goldMaterial()} items={B_WALL_KEYSTONE} />
      <Instanced geometry={BOX} material={goldMaterial()} items={B_WALL_MINIPIL} />
      <Instanced geometry={BOX} material={obsidianMaterial()} items={B_WALL_ENGRAVE} />
      <Instanced geometry={BOX} material={veinTealMaterial()} items={B_WALL_TEAL} />
      <Instanced geometry={BOX} material={goldMaterial()} items={B_WALL_GOLD} />
      {/* cornice beams crowning the outer walls */}
      <mesh geometry={BOX} material={goldMaterial()} position={[-9.5, 17.2, 75]} scale={[0.7, 0.5, 115]} />
      <mesh geometry={BOX} material={goldMaterial()} position={[14.1, 19.2, 75]} scale={[0.7, 0.5, 115]} />

      {/* descending under-structure + teal under-glow (void = depth, not empty) */}
      <Instanced geometry={RBOX} material={ivoryMaterial()} items={B_BUTTRESSES} />
      <Instanced geometry={BOX} material={veinTealMaterial()} items={B_UNDERGLOW} />

      {/* arch-rib colonnade */}
      <Instanced geometry={RIB_CANYON} material={ivoryMaterial()} items={B_RIBS} receiveShadow />
      <Instanced geometry={RIB_CANYON_TRIM} material={goldMaterial()} items={B_RIBS} />

      {/* wall-run slabs + gold veins */}
      {WALLRUN_SLABS.map((s, i) => (
        <MassMesh key={i} spec={s} material={ivoryMaterial()} />
      ))}
      <Instanced geometry={BOX} material={veinGoldMaterial()} items={B_SLAB_VEINS} />

      {/* broken spire + crown */}
      <MassMesh spec={SPIRE} material={ivoryMaterial()} />
      <mesh geometry={BOX} material={goldMaterial()} position={[4, 8.06, 106]} scale={[5.2, 0.14, 6.2]} />
      <Instanced geometry={RBOX} material={ivoryMaterial()} items={B_SPIRE_CROWN} />

      {/* high ledge + descent steps */}
      {B_LEDGE_STEPS.map((s, i) => (
        <MassMesh key={i} spec={s} material={floorMaterial()} />
      ))}
      <Instanced geometry={BOX} material={goldMaterial()} items={B_STEP_NOSING} />
      <Instanced geometry={BOX} material={goldEdgeMaterial()} items={B_STEP_NOSING_EDGE} />

      {/* balcony gate frame at z135 */}
      <mesh geometry={BOX} material={ivoryMaterial()} position={[-4, 4, 134.7]} scale={[1.2, 8, 1]} />
      <mesh geometry={BOX} material={ivoryMaterial()} position={[4, 4, 134.7]} scale={[1.2, 8, 1]} />
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
const C_WALL_TRIM: InstItem[] = []
for (const w of C_WALLS) {
  const c = boxCenter(w)
  const s = boxSize(w)
  C_WALL_TRIM.push({ p: [c[0], 10.1, c[2]], s: [Math.max(s[0], 0.4), 0.2, Math.max(s[2], 0.4)] })
}

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
// teal vein insets between pilasters
for (const z of [144.5, 155.5]) {
  C_WALL_INSETS.push({ p: [14.93, 3.4, z], s: [0.08, 4.6, 0.22] })
  C_WALL_INSETS.push({ p: [-14.93, 3.4, z], s: [0.08, 4.6, 0.22] })
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
        <mesh geometry={ICOSA} material={obsidianMaterial()} />
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
      <mesh geometry={RBOX} material={ivoryMaterial()} position={[x, 0.5, z]} scale={[2, 1, 2]} receiveShadow />
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
  const domeMat = useMemo(() => {
    const m = ivoryMaterial().clone()
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

      {/* dome + oculus */}
      <mesh geometry={DOME_GEO} material={domeMat} position={[0, 0, 150]} />
      <mesh geometry={RING_GEO} material={goldMaterial()} position={[0, 17.6, 150]} rotation={[Math.PI / 2, 0, 0]} scale={[3.1, 3.1, 14]} />
      <mesh position={[0, 17.75, 150]} rotation={[Math.PI / 2, 0, 0]} geometry={CIRCLE} scale={[2.7, 2.7, 1]}>
        <meshBasicMaterial color={SOLAR_HOT} toneMapped={false} />
      </mesh>

      {/* radial arch-rib cage */}
      <Instanced geometry={RIB_CHAMBER} material={ivoryMaterial()} items={C_RIBS} receiveShadow />

      {/* perimeter walls + trim + panel detail */}
      {C_WALLS.map((w, i) => (
        <MassMesh key={i} spec={w} material={ivoryMaterial()} />
      ))}
      <Instanced geometry={BOX} material={goldMaterial()} items={C_WALL_TRIM} />
      <Instanced geometry={BOX} material={goldMaterial()} items={C_WALL_PILASTERS} />
      <Instanced geometry={BOX} material={obsidianMaterial()} items={C_WALL_BANDS} />
      <Instanced geometry={BOX} material={veinTealMaterial()} items={C_WALL_INSETS} />

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
// teal vein insets on the east/west walls (practical glow in arena framing)
for (const z of [177, 189, 201, 213]) {
  D_WALL_INSETS.push({ p: [29.93, 3.2, z], s: [0.08, 4.8, 0.24] })
  D_WALL_INSETS.push({ p: [-29.93, 3.2, z], s: [0.08, 4.8, 0.24] })
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
  for (const fy of [2, 4, 6]) D_SLAB_VEINS.push({ p: [face, fy, zc], s: [0.06, 0.16, len] })
}

// corruption vein-growth crawling up 3 ribs + glyph decals
const D_CORRUPTION: InstItem[] = []
for (const [bx, bz] of [
  [-27, 180],
  [26, 200],
  [-24, 220],
] as [number, number][]) {
  for (let i = 0; i < 9; i++) {
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
      {/* emissive radial-groove etching (fix2): concentric rings + rays from
          arena center, low-intensity gold so it never bloom-blows */}
      <mesh
        geometry={CIRCLE}
        material={arenaGrooveMaterial()}
        position={[0, 0.012, 195]}
        rotation={[-Math.PI / 2, 0, 0]}
        scale={[28.6, 28.6, 1]}
      />
      <Instanced geometry={RING_GEO} material={medallionMaterial()} items={D_MEDAL_RINGS} />
      <Instanced geometry={PETAL} material={medallionMaterial()} items={D_MEDAL_PETALS} />
      <mesh geometry={CIRCLE} material={medallionMaterial()} position={[0, 0.04, 195]} rotation={[-Math.PI / 2, 0, 0]} scale={[2.2, 2.2, 1]} />

      {/* walls + trim + panel detail */}
      {D_WALLS.map((w, i) => (
        <MassMesh key={i} spec={w} material={ivoryMaterial()} />
      ))}
      <Instanced geometry={BOX} material={goldMaterial()} items={D_WALL_TRIM} />
      <Instanced geometry={BOX} material={goldMaterial()} items={D_WALL_PILASTERS} />
      <Instanced geometry={BOX} material={obsidianMaterial()} items={D_WALL_BANDS} />
      <Instanced geometry={BOX} material={veinTealMaterial()} items={D_WALL_INSETS} />

      {/* massive arch-ribs */}
      <Instanced geometry={RIB_ARENA} material={ivoryMaterial()} items={D_RIBS} receiveShadow />
      <Instanced geometry={RIB_ARENA_TRIM} material={goldMaterial()} items={D_RIBS} />

      {/* upper galleries */}
      {ARENA_GALLERIES.map((g, i) => (
        <MassMesh key={i} spec={g} material={floorMaterial()} />
      ))}
      <Instanced geometry={BOX} material={goldMaterial()} items={D_GALLERY_TRIM} />
      <Instanced geometry={BOX} material={goldEdgeMaterial()} items={D_GALLERY_TRIM_EDGE} />

      {/* elevation layers around the portal ring (fix2): broken platforms +
          floating megaliths — landable, colliders in layout.ts */}
      <Instanced geometry={RBOX} material={floorMaterial()} items={D_MEGA_BODY} receiveShadow />
      <Instanced geometry={BOX} material={goldMaterial()} items={D_MEGA_RIM} />
      <Instanced geometry={RBOX} material={ivoryMaterial()} items={D_MEGA_UNDER} />
      <Instanced geometry={BOX} material={veinGoldMaterial()} items={D_MEGA_GLOW} />
      <Instanced geometry={ROCK} material={rockMaterial()} items={D_MEGA_FRAGS} />

      {/* wall-run slabs to the gallery */}
      {ARENA_WALLRUN_SLABS.map((s, i) => (
        <MassMesh key={i} spec={s} material={ivoryMaterial()} />
      ))}
      <Instanced geometry={BOX} material={veinGoldMaterial()} items={D_SLAB_VEINS} />

      {/* cover: pylons, low walls, planters */}
      <Instanced geometry={RBOX} material={obsidianMaterial()} items={D_PYLON_ITEMS} receiveShadow />
      <Instanced geometry={BOX} material={goldMaterial()} items={D_PYLON_CAPS} />
      <Instanced geometry={BOX} material={veinTealMaterial()} items={D_PYLON_VEINS} />
      <Instanced geometry={RBOX} material={obsidianMaterial()} items={D_LOW_WALLS} receiveShadow />
      <Instanced geometry={BOX} material={goldMaterial()} items={D_LOW_WALL_TOPS} />
      {ARENA_PLANTERS.map(([px, pz]) => (
        <Planter key={`${px},${pz}`} x={px} z={pz} />
      ))}

      {/* corruption set dressing */}
      <Instanced geometry={BOX} material={veinTealMaterial()} items={D_CORRUPTION} />
      <mesh geometry={PLANE} material={glyphDecalMaterial()} position={[-26, 3, 181.5]} rotation={[0, Math.PI / 3, 0]} scale={[3, 3, 1]} />
      <mesh geometry={PLANE} material={glyphDecalMaterial()} position={[25, 2.5, 201]} rotation={[0, -Math.PI / 2.5, 0]} scale={[3, 3, 1]} />
      <mesh geometry={PLANE} material={glyphDecalMaterial()} position={[-10, 0.06, 208]} rotation={[-Math.PI / 2, 0, 0.4]} scale={[4, 4, 1]} />

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
      <Instanced geometry={RBOX} material={ivoryMaterial()} items={E_FINS} />
      <Instanced geometry={BOX} material={veinTealMaterial()} items={E_UNDERGLOW} />
      {/* gold rails */}
      <Instanced geometry={BOX} material={goldMaterial()} items={E_RAIL_POSTS} />
      <mesh geometry={BOX} material={goldMaterial()} position={[-4.1, 1.02, 239]} scale={[0.14, 0.1, 27]} />
      <mesh geometry={BOX} material={goldMaterial()} position={[4.1, 1.02, 239]} scale={[0.14, 0.1, 27]} />
      {/* flanking arch-ribs */}
      <Instanced geometry={RIB_BRIDGE} material={ivoryMaterial()} items={E_RIBS} receiveShadow />
      <Instanced geometry={RIB_BRIDGE_TRIM} material={goldMaterial()} items={E_RIBS} />
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
// ShrineStation — the whole level
// ---------------------------------------------------------------------------
export default function ShrineStation() {
  // register all static colliders (dynamic gates register themselves)
  useEffect(() => {
    clearColliders()
    buildLevelColliders()
    return () => clearColliders()
  }, [])

  return (
    <group>
      <ZoneA />
      <ZoneB />
      <ZoneC />
      <ZoneD />
      <ZoneE />
      <Instanced geometry={PLANE} material={bannerMaterial()} items={BANNERS} />
      {/* distant monoliths — beveled, trimmed, emissive-striped silhouettes */}
      <Instanced geometry={RBOX} material={ivoryMaterial()} items={MONO_BODY} />
      <Instanced geometry={RBOX} material={ivoryMaterial()} items={MONO_SECOND} />
      <Instanced geometry={BOX} material={obsidianMaterial()} items={MONO_PANELS} />
      <Instanced geometry={BOX} material={goldMaterial()} items={MONO_GOLD} />
      <Instanced geometry={BOX} material={veinTealMaterial()} items={MONO_TEAL} />
      <Instanced geometry={BOX} material={veinGoldMaterial()} items={MONO_GOLDGLOW} />
    </group>
  )
}

/* eslint-disable react-refresh/only-export-components */
/**
 * AURIC VOW — player/PlayerRig.tsx
 * Procedural character mesh (design.md §1.3) + procedural animation
 * (movement.md §10). No external models — Three.js primitives only.
 *
 * r1 armour pass — reads as a PLATED WARFRAME, not a mannequin:
 * - Proportions re-based on the 1.8 m capsule: head ≈0.24 m at y 1.69,
 *   shoulder pivots ±0.315 (pauldron span ~0.72), hips ±0.18.
 * - Every load-bearing volume is a SHELL, not a stick: layered pauldron lames,
 *   tapered chest with a raised central crest, thigh/knee/greave shells at
 *   ~35% over limb diameter, gauntlets with a wrist pivot and a wrapped fist,
 *   ankle pivots with wedge boots, an armoured gorget filling the neck void.
 *   The 8–16 mm tori and constant-width ridge boxes are gone — edge trim is
 *   now machined bevel bands (20-gon cones) at 2–4 cm.
 * - The BACK is authored at parity with the front (it is the gameplay read):
 *   mirrored shell plates at z ≈ −0.06, an extruded gold spine keel, scapular
 *   pauldron backs and a 5-lame rear waist skirt.
 * - Panel breakup + edge wear from baked-once canvas textures (no fetches).
 * - Emissive channels are placed where they DESCRIBE the form: visor slit,
 *   chest crest channel, spine keel, pauldron leading edges, forearm bands,
 *   thigh channels, ankle rings, lumbar reactor node.
 * - Pose: pelvis-pivoted body (was pivoting about the feet), 2π-correct gait,
 *   asymmetric idle with weight shift + 0.4 Hz breath, ascend/fall air blend
 *   (the stuck cruciform apex branch is deleted), landing absorb driven from
 *   impact speed, wall-run that actually reads PlayerRef.wallNormal, and an
 *   additive look layer where the head leads the torso by ~80 ms.
 * - Two verlet scarf ribbons, non-mirrored, lit cloth + emissive tip group.
 * - Lunge afterimages are pooled CLONES of the real rig subtree posed from a
 *   full-pose history buffer, not capsules and spheres.
 * - Camera-proximity fade (getPlayerFade) dissolves the frame instead of
 *   letting plates clip the near plane.
 *
 * r2 pass — what the round-2 review failed the frame on:
 * - MATERIAL RESPONSE. One baked height field now drives an albedo (cavity
 *   multiplied in), a Sobel normal map and a roughness map, with split
 *   responses per material (plate 0.35/0, gold 0.22/1, under-suit 0.8) and
 *   raised envMapIntensity. Hero plates carry a modelled ~8 mm edge lip.
 * - SHADOWS. The runtime diagnosis measured 80 receiveShadow flags across 880
 *   meshes; every lit mesh under the rig is now flagged cast+receive on mount.
 * - The character rim pair is cut 9.0/7.0 → 2.4/1.6 so the key can model.
 * - SILHOUETTE. Projecting shoulder cowls (~1.45× upper-arm width), a helmet
 *   scaled 1.18× and seated into the gorget with a recessed visor and
 *   asymmetric vents, real gauntlets (palm + four finger plates + thumb)
 *   instead of 0.055 m fist spheres, joint cowls and under-suit tubes that
 *   close every elbow/knee gap, and a six-lame hip skirt on springs.
 * - EMISSIVE. One continuous route (nape → spine → sacrum, forking to cowls,
 *   forearms and shins) authored in three layers — a core ABOVE white (the
 *   bloom knee is 1.0), a saturated mid and a wide additive falloff.
 * - POSE. Three authored air poses (launch tuck / apex spread / fall trail)
 *   sequenced on time-since-ground with minimum holds; a real slide; a landing
 *   weight transfer over an alternating lead leg; contact VFX.
 * - The syandana solver is fixed-step, hard-clamped and collapses end-on (see
 *   the Ribbon class) — it used to render as metre-wide planks.
 */
import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useGameStore } from '../store'
import { COLORS, LIGHTING } from '../config'
import { Input } from '../Input'
import { PlayerRef, PlayerAnim } from './PlayerRef'
import { getCamRoll, getPlayerFade, CamRef } from './CameraRig'
import { ANIM, MOVE, PLAYER_ENERGY } from './movementConfig'
import { CombatState } from '../combat/state'
import { VFX } from '../vfx/VFXBus'

// ---------------------------------------------------------------------------
// skeleton constants — everything below is authored in FEET space (y=0 = feet)
// ---------------------------------------------------------------------------
/** pelvis height: the body group pivots here, not at the feet (weakness P2) */
const PELVIS_Y = 0.95
/** shoulder pivot half-span (work order: ±0.27 → ±0.33) */
const SHOULDER_X = 0.285
/** hip pivot half-span (work order: ±0.13 → ±0.18) */
const HIP_X = 0.18

// ---------------------------------------------------------------------------
// sprint pose exaggeration — local to the rig, movement config untouched
// ---------------------------------------------------------------------------
const SPRINT_POSE = {
  leanMax: 18 * (Math.PI / 180), // ~18° forward lean at full sprint
  legBoost: 0.3, // extra leg swing at full sprint
  armBoost: 0.8, // arm pump amplitude multiplier at full sprint
  armTuck: 0.12, // shoulders pulled in toward torso
  kneeBoost: 0.35, // higher knee lift
  bobBoost: 0.6, // stronger torso bob
} as const

// ---------------------------------------------------------------------------
// pose springs — critically damped by construction (damping = 2√k)
// ---------------------------------------------------------------------------
class Spring {
  x = 0
  v = 0
  private k: number
  private d: number
  constructor(stiffness: number = ANIM.springStiffness, damping?: number) {
    this.k = stiffness
    this.d = damping ?? 2 * Math.sqrt(stiffness)
  }
  update(target: number, dt: number): number {
    const f = -this.k * (this.x - target) - this.d * this.v
    this.v += f * dt
    this.x += this.v * dt
    return this.x
  }
}

// ---------------------------------------------------------------------------
// baked-once procedural textures (canvas, no external assets)
// ---------------------------------------------------------------------------
function makeCanvas(size: number): { c: HTMLCanvasElement; x: CanvasRenderingContext2D } | null {
  if (typeof document === 'undefined') return null
  const c = document.createElement('canvas')
  c.width = c.height = size
  const x = c.getContext('2d')
  if (!x) return null
  return { c, x }
}

let _panelTex: THREE.Texture | null = null
/** armour panel-line breakup: mid grey field cut by recessed seams + fasteners */
function panelTexture(): THREE.Texture | null {
  if (_panelTex) return _panelTex
  const cv = makeCanvas(256)
  if (!cv) return null
  const { c, x } = cv
  x.fillStyle = '#ededed'
  x.fillRect(0, 0, 256, 256)
  // fine surface noise so flat plates are never mathematically flat
  const img = x.getImageData(0, 0, 256, 256)
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 16
    img.data[i] += n
    img.data[i + 1] += n
    img.data[i + 2] += n
  }
  x.putImageData(img, 0, 0)
  // irregular panel seams (dark recess + light chamfer highlight)
  const seamsV = [30, 74, 96, 150, 196, 232]
  const seamsH = [44, 88, 132, 138, 190, 226]
  x.lineWidth = 3
  for (const v of seamsV) {
    x.strokeStyle = '#4c4c4c'
    x.beginPath()
    x.moveTo(v, 0)
    x.lineTo(v, 256)
    x.stroke()
    x.strokeStyle = '#efefef'
    x.lineWidth = 1
    x.beginPath()
    x.moveTo(v + 2, 0)
    x.lineTo(v + 2, 256)
    x.stroke()
    x.lineWidth = 3
  }
  for (const h of seamsH) {
    x.strokeStyle = '#4c4c4c'
    x.beginPath()
    x.moveTo(0, h)
    x.lineTo(256, h)
    x.stroke()
    x.strokeStyle = '#efefef'
    x.lineWidth = 1
    x.beginPath()
    x.moveTo(0, h + 2)
    x.lineTo(256, h + 2)
    x.stroke()
    x.lineWidth = 3
  }
  // short stub seams — breaks the grid into plates of different sizes
  x.strokeStyle = '#4c4c4c'
  x.lineWidth = 2
  const stubs: [number, number, number, number][] = [
    [30, 20, 96, 20],
    [150, 60, 232, 60],
    [96, 108, 196, 108],
    [74, 160, 150, 160],
    [196, 200, 256, 200],
    [0, 66, 30, 66],
  ]
  for (const [x0, y0, x1, y1] of stubs) {
    x.beginPath()
    x.moveTo(x0, y0)
    x.lineTo(x1, y1)
    x.stroke()
  }
  // fasteners
  x.fillStyle = '#5a5a5a'
  for (const v of seamsV) {
    for (let y = 16; y < 256; y += 48) {
      x.beginPath()
      x.arc(v, y, 2.2, 0, Math.PI * 2)
      x.fill()
    }
  }
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.anisotropy = 4
  _panelTex = t
  return t
}

let _wearTex: THREE.Texture | null = null
/** anisotropic brushed streaks + curvature edge wear for the gold trim */
function wearTexture(): THREE.Texture | null {
  if (_wearTex) return _wearTex
  const cv = makeCanvas(256)
  if (!cv) return null
  const { c, x } = cv
  x.fillStyle = '#7a7a7a'
  x.fillRect(0, 0, 256, 256)
  for (let i = 0; i < 900; i++) {
    const y = Math.random() * 256
    const len = 20 + Math.random() * 180
    const x0 = Math.random() * 256
    const g = Math.random() * 90 + 40
    x.strokeStyle = `rgba(${g},${g},${g},0.32)`
    x.lineWidth = Math.random() < 0.75 ? 1 : 2
    x.beginPath()
    x.moveTo(x0, y)
    x.lineTo(x0 + len, y + (Math.random() - 0.5) * 2)
    x.stroke()
  }
  // polished (dark = smooth) bands where an edge would be rubbed bright
  for (let i = 0; i < 26; i++) {
    const y = Math.random() * 256
    x.fillStyle = 'rgba(28,28,28,0.5)'
    x.fillRect(0, y, 256, 2 + Math.random() * 4)
  }
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.anisotropy = 4
  _wearTex = t
  return t
}

// ---------------------------------------------------------------------------
// [player-frame R2] armour surface maps — ONE baked height field, three
// derived maps. The r2 critique was that the frame has no material response:
// flat albedo, no normal, no roughness break-up, so every plate reads as
// untextured plastic. Everything below is baked once, at module scope, from
// drawn RECTILINEAR primitives (panel insets, seams, fasteners) — value noise
// alone produces no straight edges, which is the tell.
// ---------------------------------------------------------------------------

interface ArmourMaps {
  albedo: THREE.Texture
  normal: THREE.Texture
  rough: THREE.Texture
}
let _armour: ArmourMaps | null = null

/** draws the machined height field: 1 = plate crown, 0 = seam floor */
function bakeHeightField(size: number): Float32Array | null {
  const cv = makeCanvas(size)
  if (!cv) return null
  const { x } = cv
  x.fillStyle = '#b4b4b4'
  x.fillRect(0, 0, size, size)
  const S = size / 256
  // raised plate fields — rectilinear insets with a 2-texel chamfer
  const plates: [number, number, number, number][] = [
    [8, 8, 76, 96],
    [92, 8, 100, 52],
    [200, 8, 48, 140],
    [8, 112, 76, 60],
    [92, 68, 100, 104],
    [8, 184, 118, 64],
    [134, 184, 114, 64],
    [200, 156, 48, 20],
  ]
  for (const [px, py, pw, ph] of plates) {
    x.fillStyle = '#d2d2d2'
    x.fillRect(px * S, py * S, pw * S, ph * S)
    // chamfer: bright top/left, dark bottom/right
    x.fillStyle = '#eaeaea'
    x.fillRect(px * S, py * S, pw * S, 2 * S)
    x.fillRect(px * S, py * S, 2 * S, ph * S)
    x.fillStyle = '#8e8e8e'
    x.fillRect(px * S, (py + ph - 2) * S, pw * S, 2 * S)
    x.fillRect((px + pw - 2) * S, py * S, 2 * S, ph * S)
  }
  // recessed seam floor between the plates
  x.strokeStyle = '#3a3a3a'
  x.lineWidth = 3 * S
  for (const [px, py, pw, ph] of plates) x.strokeRect(px * S, py * S, pw * S, ph * S)
  // fret run — a straight ornamental course, the Orokin read
  x.fillStyle = '#e4e4e4'
  for (let i = 0; i < 8; i++) {
    const fx = (10 + i * 30) * S
    x.fillRect(fx, 176 * S, 18 * S, 3 * S)
    x.fillRect(fx, 176 * S, 3 * S, 8 * S)
    x.fillRect(fx + 15 * S, 170 * S, 3 * S, 9 * S)
  }
  // fasteners — raised bolt punches along the seams
  for (const [px, py, pw, ph] of plates) {
    for (let t = 0; t <= 1.001; t += 0.5) {
      for (const [bx, by] of [
        [px + 6 + t * (pw - 12), py + 6],
        [px + 6 + t * (pw - 12), py + ph - 6],
      ]) {
        x.fillStyle = '#f2f2f2'
        x.beginPath()
        x.arc(bx * S, by * S, 2.4 * S, 0, Math.PI * 2)
        x.fill()
        x.fillStyle = '#7c7c7c'
        x.beginPath()
        x.arc(bx * S, (by + 0.9) * S, 1.1 * S, 0, Math.PI * 2)
        x.fill()
      }
    }
  }
  // micro surface noise so a plate crown is never mathematically flat
  const img = x.getImageData(0, 0, size, size)
  const out = new Float32Array(size * size)
  for (let i = 0, p = 0; i < img.data.length; i += 4, p++) {
    out[p] = THREE.MathUtils.clamp((img.data[i] + (Math.random() - 0.5) * 9) / 255, 0, 1)
  }
  return out
}

/** cheap separable box blur — used for the cavity (contact-AO) term */
function blurField(src: Float32Array, size: number, r: number): Float32Array {
  const tmp = new Float32Array(size * size)
  const dst = new Float32Array(size * size)
  const inv = 1 / (r * 2 + 1)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let a = 0
      for (let k = -r; k <= r; k++) a += src[y * size + ((x + k + size) % size)]
      tmp[y * size + x] = a * inv
    }
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let a = 0
      for (let k = -r; k <= r; k++) a += tmp[((y + k + size) % size) * size + x]
      dst[y * size + x] = a * inv
    }
  }
  return dst
}

function fieldToTexture(
  size: number,
  write: (i: number, data: Uint8ClampedArray, o: number) => void,
  srgb: boolean,
): THREE.Texture | null {
  const cv = makeCanvas(size)
  if (!cv) return null
  const { c, x } = cv
  const img = x.createImageData(size, size)
  for (let i = 0; i < size * size; i++) {
    write(i, img.data, i * 4)
    img.data[i * 4 + 3] = 255
  }
  x.putImageData(img, 0, 0)
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.anisotropy = 4
  if (srgb) t.colorSpace = THREE.SRGBColorSpace
  return t
}

/** albedo (cavity-multiplied) + normal (Sobel) + roughness, from one height field */
function armourMaps(): ArmourMaps | null {
  if (_armour) return _armour
  const size = 256
  const h = bakeHeightField(size)
  if (!h) return null
  const cav = blurField(h, size, 3)
  const at = (x: number, y: number) => h[((y + size) % size) * size + ((x + size) % size)]

  // --- normal: Sobel of the height field ---
  const strength = 2.6
  const normal = fieldToTexture(
    size,
    (i, d, o) => {
      const px = i % size
      const py = (i / size) | 0
      const dx =
        at(px - 1, py - 1) + 2 * at(px - 1, py) + at(px - 1, py + 1) -
        (at(px + 1, py - 1) + 2 * at(px + 1, py) + at(px + 1, py + 1))
      const dy =
        at(px - 1, py - 1) + 2 * at(px, py - 1) + at(px + 1, py - 1) -
        (at(px - 1, py + 1) + 2 * at(px, py + 1) + at(px + 1, py + 1))
      let nx = dx * strength
      // canvas rows run top-down while UV v runs bottom-up (flipY), so the
      // vertical gradient is negated — otherwise every bump reads as a dent
      let ny = -dy * strength
      const nz = 1
      const l = Math.hypot(nx, ny, nz) || 1
      nx /= l
      ny /= l
      d[o] = (nx * 0.5 + 0.5) * 255
      d[o + 1] = (ny * 0.5 + 0.5) * 255
      d[o + 2] = (nz / l) * 255
    },
    false,
  )

  // --- roughness: polished plate crowns, rough recessed seams ---
  const rough = fieldToTexture(
    size,
    (i, d, o) => {
      const v = THREE.MathUtils.smoothstep(h[i], 0.3, 0.82)
      const r = THREE.MathUtils.lerp(0.68, 0.17, v)
      d[o] = d[o + 1] = d[o + 2] = r * 255
    },
    false,
  )

  // --- albedo: white base darkened by the cavity term, seams near-black ---
  const albedo = fieldToTexture(
    size,
    (i, d, o) => {
      const ao = THREE.MathUtils.clamp((cav[i] - 0.16) / 0.72, 0, 1)
      const seam = THREE.MathUtils.smoothstep(h[i], 0.12, 0.42)
      const v = (0.4 + 0.6 * ao) * (0.34 + 0.66 * seam)
      d[o] = d[o + 1] = d[o + 2] = THREE.MathUtils.clamp(v, 0, 1) * 255
    },
    true,
  )

  if (!normal || !rough || !albedo) return null
  _armour = { albedo, normal, rough }
  return _armour
}

function tex(src: THREE.Texture | null, rx: number, ry: number): THREE.Texture | null {
  if (!src) return null
  const t = src.clone()
  t.needsUpdate = true
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.repeat.set(rx, ry)
  return t
}

// ---------------------------------------------------------------------------
// sculpted geometry helpers
// ---------------------------------------------------------------------------

/** Helmet: lathed dome elongated along Z, face sheared down → swept visor wedge. */
function makeHelmetGeometry(): THREE.BufferGeometry {
  const pts = [
    new THREE.Vector2(0.02, -0.13),
    new THREE.Vector2(0.1, -0.11),
    new THREE.Vector2(0.135, -0.05),
    new THREE.Vector2(0.15, 0.02),
    new THREE.Vector2(0.142, 0.09),
    new THREE.Vector2(0.112, 0.15),
    new THREE.Vector2(0.06, 0.19),
    new THREE.Vector2(0.001, 0.2),
  ]
  const geo = new THREE.LatheGeometry(pts, 24)
  const pos = geo.attributes.position as THREE.BufferAttribute
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) * 0.92
    let y = pos.getY(i)
    const z = pos.getZ(i) * 1.28 // elongated swept-back skull
    if (z > 0) y -= z * 0.32 // shear the face down-forward → visor wedge
    pos.setXYZ(i, x, y, z)
  }
  geo.computeVertexNormals()
  return geo
}

/** Crest fin: swept-back blade extruded thin, gold. */
function makeCrestGeometry(): THREE.BufferGeometry {
  const s = new THREE.Shape()
  s.moveTo(0.06, 0.0)
  s.lineTo(-0.24, 0.05)
  s.lineTo(-0.34, 0.14) // tail tip, swept up and back
  s.lineTo(-0.1, 0.13)
  s.lineTo(0.08, 0.04)
  s.closePath()
  const geo = new THREE.ExtrudeGeometry(s, { depth: 0.022, bevelEnabled: false })
  geo.rotateY(-Math.PI / 2) // shape +x → world +z (forward), thickness → x
  geo.translate(0.011, 0, 0)
  return geo
}

/**
 * [character-art R3] Dome shell WITH THICKNESS.
 *
 * Every chest, back and pauldron plate used to be an open `SphereGeometry`
 * cap: a zero-thickness sheet whose rim is a mathematical edge. That is the
 * single loudest blockout tell on a character, because a real armour plate
 * rolls over its rim and the roll is what catches the key. This lathes the
 * outer dome, rolls it over the rim, and returns up an inner wall, so the
 * plate has a visible ~10% lip everywhere the silhouette crosses it.
 */
function makeDomeShell(r: number, thetaLen: number, thick: number, seg = 26): THREE.BufferGeometry {
  const N = 14
  const pts: THREE.Vector2[] = []
  const ax = (v: number) => Math.max(0.0009, v)
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * thetaLen
    pts.push(new THREE.Vector2(ax(r * Math.sin(a)), r * Math.cos(a)))
  }
  // the rim roll — two short steps over the edge and back under
  const sT = Math.sin(thetaLen)
  const cT = Math.cos(thetaLen)
  pts.push(new THREE.Vector2(ax(r * sT * 1.014), r * cT - thick * 0.42))
  pts.push(new THREE.Vector2(ax(r * sT - thick * 0.34), r * cT - thick * 0.6))
  // inner wall, back up to the pole
  const ri = r - thick
  for (let i = N; i >= 0; i--) {
    const a = (i / N) * thetaLen
    pts.push(new THREE.Vector2(ax(ri * Math.sin(a)), ri * Math.cos(a) - thick * 0.08))
  }
  const geo = new THREE.LatheGeometry(pts, seg)
  geo.computeVertexNormals()
  return geo
}

/** Chest / back shell plate: flattened dome, bulge toward +Z, opening downward. */
function makeShellPlate(r: number, flat = 0.5): THREE.BufferGeometry {
  const geo = makeDomeShell(r, Math.PI * 0.56, r * 0.1)
  geo.rotateX(Math.PI / 2)
  geo.scale(1.08, 0.92, flat)
  return geo
}

/** Pauldron lame: wide flattened dome segment (stacks into a layered pauldron). */
function makeLame(r: number, flat = 0.62): THREE.BufferGeometry {
  const geo = makeDomeShell(r, Math.PI * 0.52, r * 0.13, 24)
  geo.scale(1.18, flat, 1.12)
  return geo
}

/**
 * [player-frame R2] Shoulder COWL — the big projecting pauldron shell that
 * carries the silhouette. A half-dome squashed along Y and stretched outward,
 * with the lower rim flared so it hangs over the deltoid instead of capping it.
 */
function makeCowlGeometry(): THREE.BufferGeometry {
  // [character-art R3] lathed with a rolled rim so the cowl has thickness
  const geo = makeDomeShell(0.175, Math.PI * 0.62, 0.021, 24)
  const pos = geo.attributes.position as THREE.BufferAttribute
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const y = pos.getY(i)
    const z = pos.getZ(i)
    // flare the rim outward and sweep the whole shell back along -Z
    const rim = THREE.MathUtils.clamp((0.14 - y) / 0.3, 0, 1)
    pos.setXYZ(i, x * (1.06 + rim * 0.34), y * 0.94 - rim * 0.045, z * (1.12 + rim * 0.1) - 0.018)
  }
  geo.computeVertexNormals()
  return geo
}

/**
 * [player-frame R2] Gauntlet — replaces the 0.055 m fist sphere. A tapered
 * palm block; the four fused finger plates and the opposed thumb are separate
 * small meshes in the JSX so they can be posed as one grip.
 */
function makeGauntletGeometry(): THREE.BufferGeometry {
  const s = new THREE.Shape()
  s.moveTo(-0.045, 0.05)
  s.lineTo(0.045, 0.05)
  s.lineTo(0.052, -0.02)
  s.lineTo(0.036, -0.075)
  s.lineTo(-0.036, -0.075)
  s.lineTo(-0.052, -0.02)
  s.closePath()
  const geo = new THREE.ExtrudeGeometry(s, {
    depth: 0.072,
    bevelEnabled: true,
    bevelSize: 0.009,
    bevelThickness: 0.009,
    bevelSegments: 2,
  })
  geo.translate(0, 0, -0.036)
  return geo
}

/** [player-frame R2] one fused finger plate (four per hand, stacked) */
function makeFingerGeometry(): THREE.BufferGeometry {
  const geo = new THREE.BoxGeometry(0.02, 0.058, 0.03)
  const pos = geo.attributes.position as THREE.BufferAttribute
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i)
    const k = y < 0 ? 0.72 : 1
    pos.setXYZ(i, pos.getX(i) * k, y, pos.getZ(i) * k)
  }
  geo.computeVertexNormals()
  return geo
}

/**
 * [player-frame R2] Joint cowl — the two-piece shell that closes the elbow and
 * knee gaps. Replaces the bare 0.07 sphere cap: a wider outer shell that
 * overlaps BOTH limb segments, so there is no daylight through the joint.
 */
function makeJointCowl(r: number): THREE.BufferGeometry {
  const geo = new THREE.SphereGeometry(r, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.72)
  geo.scale(0.94, 1.0, 1.1)
  geo.rotateX(Math.PI * 0.08)
  return geo
}

/**
 * Machined bevel band — replaces the 6-gon 8 mm tori. A short 20-gon cone
 * frustum reads as a chamfered armour edge instead of a hexagonal hoop.
 */
function makeBevelBand(r: number, chamfer: number, h: number): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(r, r - chamfer, h, 20, 1, false)
}

/** Wedge boot: side profile extruded across, bevelled. */
function makeBootGeometry(): THREE.BufferGeometry {
  const s = new THREE.Shape()
  s.moveTo(-0.085, 0.0)
  s.lineTo(0.15, 0.0)
  s.lineTo(0.175, 0.05)
  s.lineTo(0.08, 0.1)
  s.lineTo(-0.045, 0.125)
  s.lineTo(-0.1, 0.085)
  s.closePath()
  const d = 0.115
  const geo = new THREE.ExtrudeGeometry(s, {
    depth: d,
    bevelEnabled: true,
    bevelSize: 0.012,
    bevelThickness: 0.012,
    bevelSegments: 2,
  })
  geo.rotateY(-Math.PI / 2) // shape x → world +z (forward); depth → world −x
  geo.translate(d / 2 + 0.006, 0, 0)
  return geo
}

/** Skirt / waist lame: tapered plate hanging from the belt. */
function makeSkirtLame(wTop: number, wBot: number, h: number, thick = 0.028): THREE.BufferGeometry {
  const s = new THREE.Shape()
  s.moveTo(-wTop / 2, 0)
  s.lineTo(wTop / 2, 0)
  s.lineTo(wBot / 2, -h * 0.72)
  s.lineTo(wBot / 2 - 0.012, -h)
  s.lineTo(-wBot / 2 + 0.012, -h)
  s.lineTo(-wBot / 2, -h * 0.72)
  s.closePath()
  const geo = new THREE.ExtrudeGeometry(s, {
    depth: thick,
    bevelEnabled: true,
    bevelSize: 0.006,
    bevelThickness: 0.006,
    bevelSegments: 1,
  })
  geo.translate(0, 0, -thick / 2)
  return geo
}

/** Extruded gold spine keel — the back's hero line. */
function makeKeelGeometry(): THREE.BufferGeometry {
  const s = new THREE.Shape()
  s.moveTo(-0.042, 0.0)
  s.lineTo(0.042, 0.0)
  s.lineTo(0.052, -0.11)
  s.lineTo(0.03, -0.2)
  s.lineTo(0.055, -0.25)
  s.lineTo(0.026, -0.34)
  s.lineTo(0.0, -0.42)
  s.lineTo(-0.026, -0.34)
  s.lineTo(-0.055, -0.25)
  s.lineTo(-0.03, -0.2)
  s.lineTo(-0.052, -0.11)
  s.closePath()
  const geo = new THREE.ExtrudeGeometry(s, {
    depth: 0.05,
    bevelEnabled: true,
    bevelSize: 0.008,
    bevelThickness: 0.008,
    bevelSegments: 1,
  })
  return geo
}

/** Raised chest crest ridge — the tapered centreline of the chest plate. */
function makeCrestRidge(): THREE.BufferGeometry {
  const s = new THREE.Shape()
  s.moveTo(-0.048, 0.0)
  s.lineTo(0.048, 0.0)
  s.lineTo(0.03, -0.1)
  s.lineTo(0.042, -0.14)
  s.lineTo(0.0, -0.25)
  s.lineTo(-0.042, -0.14)
  s.lineTo(-0.03, -0.1)
  s.closePath()
  const geo = new THREE.ExtrudeGeometry(s, {
    depth: 0.042,
    bevelEnabled: true,
    bevelSize: 0.007,
    bevelThickness: 0.007,
    bevelSegments: 1,
  })
  return geo
}

/** Armoured gorget/collar — fills the head-to-shoulder void. */
function makeGorgetGeometry(): THREE.BufferGeometry {
  const pts = [
    new THREE.Vector2(0.095, 0.0),
    new THREE.Vector2(0.14, 0.022),
    new THREE.Vector2(0.168, 0.062),
    new THREE.Vector2(0.164, 0.092),
    new THREE.Vector2(0.122, 0.1),
    new THREE.Vector2(0.112, 0.064),
    new THREE.Vector2(0.086, 0.018),
  ]
  const geo = new THREE.LatheGeometry(pts, 22)
  geo.scale(1.0, 1.0, 0.92)
  return geo
}

// ---------------------------------------------------------------------------
// [character-art R3] SCULPTED SHELLS, HARD POINTS AND SWEPT ENERGY ROUTES
//
// The round-2 panel failed the frame as "a stack of separate primitives".
// The cause was that every load-bearing volume under the plates was still a
// CYLINDER FRUSTUM: a straight taper, a circular section, a hard square rim.
// A shipped frame's armour is a LOFTED SHELL — a non-circular section with a
// machined lateral keel, a rim that flares out and then folds back under
// itself (so the plate has visible thickness), and hard points that break the
// outline. Everything below builds that, procedurally, once at boot.
// ---------------------------------------------------------------------------

/**
 * Lofted limb shell — the drop-in replacement for `makeLimbPlate`.
 *
 *  - section is a flattened superellipse with a lateral KEEL ridge, so the
 *    outline of a limb is a machined edge catching the key rather than a tube;
 *  - the profile FLARES at both rims, so the shell closes over the joint it
 *    covers instead of ending in mid-air;
 *  - each rim folds back under itself by `lip`, giving the plate real,
 *    silhouette-visible THICKNESS (the work order's "0.008 m edge lip");
 *  - eight shallow flutes keep a flat span from ever being featureless.
 */
function makeLimbShell(
  rTop: number,
  rBot: number,
  h: number,
  o: {
    keel?: number
    flare?: number
    flat?: number
    prow?: number
    lip?: number
    rings?: number
    seg?: number
  } = {},
): THREE.BufferGeometry {
  const seg = o.seg ?? 26
  const rings = o.rings ?? 13
  const keel = o.keel ?? 0.15
  const flare = o.flare ?? 0.18
  const flat = o.flat ?? 0.9
  const prow = o.prow ?? 0
  const lip = o.lip ?? 0.016
  const ringVerts = seg + 1
  const pos: number[] = []
  const uvs: number[] = []
  const idx: number[] = []

  // ring plan: folded lip, the lofted body, folded lip
  const plan: { t: number; dy: number; k: number }[] = [{ t: 0, dy: -lip, k: 0.78 }]
  for (let r = 0; r < rings; r++) plan.push({ t: r / (rings - 1), dy: 0, k: 1 })
  plan.push({ t: 1, dy: lip, k: 0.78 })

  for (const p of plan) {
    const t = p.t
    const y = h * (0.5 - t) + p.dy
    const base = THREE.MathUtils.lerp(rTop, rBot, t)
    // cuff flare — both rims roll outward over the joint they cover
    const endT = Math.min(t, 1 - t)
    const cuff = 1 + flare * Math.pow(Math.max(0, 1 - endT / 0.2), 1.7)
    // a shallow waist so the segment tapers like a limb, not a pipe
    const waist = 1 - 0.05 * Math.sin(Math.PI * t)
    const rad = base * cuff * waist * p.k
    for (let s = 0; s <= seg; s++) {
      const a = (s / seg) * Math.PI * 2
      const ca = Math.cos(a)
      const sa = Math.sin(a)
      const ridge = 1 + keel * Math.pow(Math.abs(ca), 6) // lateral machined keel
      const flute = 1 - 0.016 * Math.cos(a * 8)
      const rr = rad * ridge * flute
      let z = rr * sa * flat
      z += prow * Math.max(0, sa) * (1 - t) * base // greave prow carries forward
      pos.push(rr * ca, y, z)
      uvs.push(s / seg, 1 - t)
    }
  }
  for (let r = 0; r < plan.length - 1; r++) {
    for (let s = 0; s < seg; s++) {
      const a0 = r * ringVerts + s
      const b0 = a0 + ringVerts
      idx.push(a0, a0 + 1, b0, a0 + 1, b0 + 1, b0)
    }
  }
  // close both ends so the shell is watertight from every angle
  const capTop = pos.length / 3
  pos.push(0, h * 0.5 - lip * 1.2, 0)
  uvs.push(0.5, 1)
  const capBot = pos.length / 3
  pos.push(0, -h * 0.5 + lip * 1.2, 0)
  uvs.push(0.5, 0)
  const lastRing = (plan.length - 1) * ringVerts
  for (let s = 0; s < seg; s++) {
    idx.push(capTop, s + 1, s)
    idx.push(capBot, lastRing + s, lastRing + s + 1)
  }

  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

/**
 * Hard point — the tapering swept blade that breaks a silhouette. Knee spurs,
 * heel spurs, calf fins, elbow spurs, pauldron wings and hip blades are all
 * this one loft at different scales. Extruded from a swept side profile, then
 * THINNED toward the tip so it is a blade and not a slab.
 *
 * Local axes: +X is the length (root at 0), Y the width, Z the thickness.
 */
function makeBlade(
  L: number,
  wRoot: number,
  wTip: number,
  thick: number,
  curve: number,
): THREE.BufferGeometry {
  const s = new THREE.Shape()
  s.moveTo(0, -wRoot * 0.5)
  s.lineTo(L * 0.42, -wTip * 0.62 - curve * 0.45)
  s.lineTo(L * 0.86, -wTip * 0.5 - curve * 0.92)
  s.lineTo(L, -wTip * 0.06 - curve)
  s.lineTo(L * 0.8, wTip * 0.52 - curve * 0.92)
  s.lineTo(L * 0.4, wRoot * 0.34 - curve * 0.4)
  s.lineTo(0, wRoot * 0.5)
  s.closePath()
  const g = new THREE.ExtrudeGeometry(s, {
    depth: thick,
    bevelEnabled: true,
    bevelSize: thick * 0.3,
    bevelThickness: thick * 0.3,
    bevelSegments: 2,
  })
  g.translate(0, 0, -thick * 0.5)
  const p = g.attributes.position as THREE.BufferAttribute
  for (let i = 0; i < p.count; i++) {
    const k = THREE.MathUtils.clamp(1 - p.getX(i) / L, 0, 1)
    p.setZ(i, p.getZ(i) * (0.3 + 0.7 * k * k))
  }
  g.computeVertexNormals()
  return g
}

/**
 * Overlapping cuff lame — a short flared band that sits OVER the rim of the
 * segment below it. Stacking these is what makes plating read as lamellar
 * armour with dark under-suit in the gaps rather than one extruded tube.
 */
function makeCuffLame(r: number, h: number, flare = 0.3): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r, r * (1 + flare), h, 24, 1, true)
  const p = g.attributes.position as THREE.BufferAttribute
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i)
    const z = p.getZ(i)
    const a = Math.atan2(z, x)
    const k = 1 + 0.1 * Math.pow(Math.abs(Math.cos(a)), 6)
    p.setXYZ(i, x * k, p.getY(i), z * k * 0.9)
  }
  g.computeVertexNormals()
  return g
}

/**
 * Swept energy route. The panel's note was that the emissive reads as isolated
 * glowing pips; a shipped frame runs ONE continuous line that describes the
 * form. This lofts a tube along a Catmull-Rom spine so the route curves with
 * the back instead of being a stack of boxes.
 */
function makeRoute(pts: readonly [number, number, number][], r: number, seg = 40): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(p[0], p[1], p[2])))
  return new THREE.TubeGeometry(curve, seg, r, 7, false)
}

/** Wrapped fist volume (replaces the hand box). */
function makeFistGeometry(): THREE.BufferGeometry {
  const geo = new THREE.SphereGeometry(0.055, 14, 10)
  geo.scale(0.98, 1.25, 0.86)
  return geo
}

/**
 * [character-art R3] GRAZING-ANGLE EDGE SHEEN.
 *
 * MeshStandardMaterial on its own gives a plate a single Lambert value band,
 * which is the loudest "untextured blockout" tell there is: a shipped frame's
 * plate edges pick up the sky at glancing angles and separate from whatever is
 * behind them. This injects a Fresnel term AFTER the lighting loop (so it is
 * not eaten by a shadow) and is the cheapest AAA-grade read on the whole rig.
 *
 * `customProgramCacheKey` is required — without it three reuses one compiled
 * program across every material that shares this class.
 */
function addEdgeSheen(
  mat: THREE.MeshStandardMaterial,
  color: string,
  power: number,
  amount: number,
  key: string,
): void {
  const col = new THREE.Color(color)
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uSheenCol = { value: col }
    shader.uniforms.uSheenPow = { value: power }
    shader.uniforms.uSheenAmt = { value: amount }
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform vec3 uSheenCol;\nuniform float uSheenPow;\nuniform float uSheenAmt;',
      )
      .replace(
        '#include <opaque_fragment>',
        [
          '{',
          '  float fres = pow( 1.0 - saturate( dot( geometryNormal, geometryViewDir ) ), uSheenPow );',
          '  outgoingLight += uSheenCol * fres * uSheenAmt;',
          '}',
          '#include <opaque_fragment>',
        ].join('\n'),
      )
  }
  mat.customProgramCacheKey = () => key
}

// ---------------------------------------------------------------------------
// verlet scarf ribbon — lit cloth body + emissive tip group (work order #9)
// ---------------------------------------------------------------------------
const SEGS = ANIM.scarf.segments
/** vertices per rib: left edge, hot centre, right edge (edge-alpha falloff) */
const RIB_VERTS = 3
/** triangles per segment (two quads) → 12 indices */
const SEG_IDX = 12

interface RibbonOpts {
  segLen: number
  gravity: number
  drag: number
  widthMult: number
  zOffset: number
  /** wind phase offset so the two ribbons never move as one plank */
  windPhase: number
}

/**
 * Verlet syandana ribbon.
 *
 * [player-frame R2] The r2 capture rendered this as a metre-wide flat plank
 * sweeping the whole frame. Three separate faults, all fixed here:
 *
 *  1. The inertia term `p += (p - pp) * drag` was applied ONCE PER FRAME with
 *     a frame-dependent dt, so the effective damping and the effective
 *     velocity both scaled with frame time. The solver now runs on a FIXED
 *     1/60 substep (`ANIM.scarf.fixedStep`), with the anchor interpolated
 *     across substeps, so the chain integrates identically at any frame rate.
 *  2. Two constraint iterations could not propagate a 0.18 m/frame sprint
 *     anchor move down the chain, so every link sat stretched. Iterations are
 *     up at `constraintIters`, and a HARD per-link clamp at `maxStretch`×
 *     rest length runs after them — the chain can no longer exceed 1.5× its
 *     authored length under any input, and a >2 m anchor jump re-seeds it.
 *  3. The camera-facing half-width was constant, so a segment pointing AT the
 *     camera billboarded into a full-width slab. Width is now scaled by
 *     |sin(tangent, view)|: end-on segments collapse to a line.
 *
 * The strip also carries three verts per rib (edge / hot centre / edge) with
 * vertex ALPHA, so the cloth has feathered edges and a near-plane fade instead
 * of a hard-edged paper rectangle.
 */
class Ribbon {
  points: THREE.Vector3[] = []
  prev: THREE.Vector3[] = []
  mesh: THREE.Mesh
  readonly opts: RibbonOpts
  private posAttr: THREE.BufferAttribute
  private normAttr: THREE.BufferAttribute
  private colAttr: THREE.BufferAttribute
  /** authored per-vertex alpha (edge falloff × length taper) */
  private baseAlpha: Float32Array
  private acc = 0
  private seeded = false
  private prevAnchor = new THREE.Vector3()
  private _t = new THREE.Vector3()
  private _side = new THREE.Vector3()
  private _up = new THREE.Vector3()
  private _view = new THREE.Vector3()
  private _closest = new THREE.Vector3()
  private _d = new THREE.Vector3()
  private _a = new THREE.Vector3()

  constructor(opts: RibbonOpts, cloth: THREE.Material, glow: THREE.Material) {
    this.opts = opts
    for (let i = 0; i <= SEGS; i++) {
      this.points.push(new THREE.Vector3(0, 1.5 - i * opts.segLen, 0))
      this.prev.push(this.points[i].clone())
    }
    const n = (SEGS + 1) * RIB_VERTS
    const geo = new THREE.BufferGeometry()
    const positions = new Float32Array(n * 3)
    const normals = new Float32Array(n * 3)
    // itemSize 4: the fourth channel is real vertex alpha
    const colors = new Float32Array(n * 4)
    const uvs = new Float32Array(n * 2)
    this.baseAlpha = new Float32Array(n)
    // cloth root is a dark charcoal so the emissive tip has somewhere to sit
    const root = new THREE.Color('#141318')
    // [character-art R3] the r2 mid was regalGold x 0.5, which rendered the
    // syandana as two tan hoses looping across the frame. A shipped syandana is
    // DARK cloth whose emissive lives only in the last third; the body has to
    // sit under the armour in value or it competes with the frame it hangs on.
    const mid = new THREE.Color(COLORS.regalGold).multiplyScalar(0.14)
    const tip = new THREE.Color(PLAYER_ENERGY.mid).multiplyScalar(ANIM.energy.midBoost * 1.6)
    const c = new THREE.Color()
    const emiStart = Math.max(1, SEGS - ANIM.scarf.emissiveSegments)
    for (let i = 0; i <= SEGS; i++) {
      const f = i / SEGS
      if (i <= emiStart) c.lerpColors(root, mid, i / Math.max(1, emiStart))
      else c.lerpColors(mid, tip, (i - emiStart) / Math.max(1, SEGS - emiStart))
      for (let s = 0; s < RIB_VERTS; s++) {
        const vi = i * RIB_VERTS + s
        const o4 = vi * 4
        colors[o4] = c.r
        colors[o4 + 1] = c.g
        colors[o4 + 2] = c.b
        // edges feather out, the centre stays hot; the very tip fades to nothing
        const edge = s === 1 ? 1 : ANIM.scarf.edgeAlpha
        colors[o4 + 3] = edge
        this.baseAlpha[vi] = edge * (1 - 0.55 * f * f)
        const o3 = vi * 3
        normals[o3] = 0
        normals[o3 + 1] = 0
        normals[o3 + 2] = 1
        uvs[vi * 2] = s * 0.5
        uvs[vi * 2 + 1] = f
      }
    }
    const idx: number[] = []
    for (let i = 0; i < SEGS; i++) {
      const a = i * RIB_VERTS
      const d = a + RIB_VERTS
      idx.push(a, a + 1, d, a + 1, d + 1, d)
      idx.push(a + 1, a + 2, d + 1, a + 2, d + 2, d + 1)
    }
    geo.setIndex(idx)
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 4))
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
    // two draw groups: lit cloth body, then the emissive last N segments
    geo.addGroup(0, emiStart * SEG_IDX, 0)
    geo.addGroup(emiStart * SEG_IDX, (SEGS - emiStart) * SEG_IDX, 1)
    this.posAttr = geo.getAttribute('position') as THREE.BufferAttribute
    this.normAttr = geo.getAttribute('normal') as THREE.BufferAttribute
    this.colAttr = geo.getAttribute('color') as THREE.BufferAttribute
    this.mesh = new THREE.Mesh(geo, [cloth, glow])
    this.mesh.frustumCulled = false
    this.mesh.castShadow = false
    this.mesh.renderOrder = 2
  }

  reset(anchor: THREE.Vector3) {
    for (let i = 0; i <= SEGS; i++) {
      this.points[i].copy(anchor)
      this.points[i].y -= i * this.opts.segLen
      this.prev[i].copy(this.points[i])
    }
    this.prevAnchor.copy(anchor)
    this.acc = 0
  }

  /**
   * HARD per-link clamp, root outward: no link may exceed maxStretch × rest.
   * This is what actually stops the metre-long planks — relaxation alone can
   * always be outrun by a fast anchor.
   */
  private clampChain() {
    const maxLen = this.opts.segLen * ANIM.scarf.maxStretch
    for (let i = 0; i < SEGS; i++) {
      const a = this.points[i]
      const b = this.points[i + 1]
      this._d.copy(b).sub(a)
      const len = this._d.length()
      if (len > maxLen && len > 1e-6) b.copy(a).addScaledVector(this._d, maxLen / len)
    }
  }

  /** one FIXED-dt verlet step — the only place the chain is integrated */
  private step(
    h: number,
    anchor: THREE.Vector3,
    playerPos: THREE.Vector3,
    capsuleRadius: number,
    capsuleHeight: number,
    time: number,
  ) {
    const o = this.opts
    const S = ANIM.scarf
    const h2 = h * h
    const drag = o.drag
    // wind: one shared low-frequency cross-gust, phase-shifted per ribbon, so
    // the two never sweep as a single plank
    const wPhase = time * S.windHz * Math.PI * 2 + o.windPhase
    const wx = Math.sin(wPhase) * S.windAmp
    const wz = Math.cos(wPhase * 0.77 + 1.3) * S.windAmp * 0.7
    for (let i = 1; i <= SEGS; i++) {
      const p = this.points[i]
      const pp = this.prev[i]
      const px = p.x
      const py = p.y
      const pz = p.z
      // per-segment gust weight: the tip whips, the root barely moves
      const wgt = (i / SEGS) * (i / SEGS) * h2
      p.x += (px - pp.x) * drag + wx * wgt
      p.y += (py - pp.y) * drag - o.gravity * h2
      p.z += (pz - pp.z) * drag + wz * wgt
      pp.set(px, py, pz)
    }
    // pin root
    this.points[0].copy(anchor)
    this.prev[0].copy(anchor)
    // distance constraints
    for (let iter = 0; iter < S.constraintIters; iter++) {
      for (let i = 0; i < SEGS; i++) {
        const a = this.points[i]
        const b = this.points[i + 1]
        this._d.copy(b).sub(a)
        const len = this._d.length() || 1e-6
        const diff = (len - o.segLen) / len
        if (i === 0) b.addScaledVector(this._d, -diff)
        else {
          a.addScaledVector(this._d, diff * 0.5)
          b.addScaledVector(this._d, -diff * 0.5)
        }
      }
    }
    // collide against the body (NOT the 0.45 m physics capsule — see
    // ANIM.scarf.bodyRadiusMult) along its vertical spine segment
    const r = capsuleRadius * S.bodyRadiusMult + 0.02
    const y0 = playerPos.y + capsuleRadius
    const y1 = playerPos.y + capsuleHeight - capsuleRadius
    for (let i = S.collideSkip; i <= SEGS; i++) {
      const p = this.points[i]
      this._closest.set(playerPos.x, THREE.MathUtils.clamp(p.y, y0, y1), playerPos.z)
      this._d.copy(p).sub(this._closest)
      const d = this._d.length()
      if (d < r && d > 1e-6) p.addScaledVector(this._d, (r - d) / d)
    }
    // NOTE: no aegis-shell collision. The A3 shell is ~2.45 m in radius and the
    // whole scarf is 1.26 m, so it can never reach the shell from the inside —
    // pushing points OUT to that radius (as the work order's wording implies)
    // would pin every point 2.45 m from a root anchored at the nape and produce
    // exactly the planks this pass exists to remove.
    // the clamp runs LAST: a collision push must not be allowed to leave a
    // stretched link behind it
    this.clampChain()
  }

  update(
    dt: number,
    anchor: THREE.Vector3,
    playerPos: THREE.Vector3,
    capsuleRadius: number,
    capsuleHeight: number,
    camPos: THREE.Vector3,
    time: number,
    fade: number,
  ) {
    const o = this.opts
    const S = ANIM.scarf
    if (!this.seeded) {
      this.reset(anchor)
      this.seeded = true
    } else if (anchor.distanceToSquared(this.prevAnchor) > S.reseedDist * S.reseedDist) {
      // teleport / respawn / dash blink — re-seed instead of stretching a rope
      this.reset(anchor)
    }
    // ---- fixed-step integration (dt-normalised by construction) ----
    this.acc += dt
    let steps = Math.floor(this.acc / S.fixedStep)
    if (steps > S.maxSubsteps) {
      steps = S.maxSubsteps
      this.acc = 0
    } else {
      this.acc -= steps * S.fixedStep
    }
    for (let s = 1; s <= steps; s++) {
      // interpolate the anchor across the substeps so a fast frame does not
      // teleport the root and snap the whole chain taut
      this._a.lerpVectors(this.prevAnchor, anchor, s / steps)
      this.step(S.fixedStep, this._a, playerPos, capsuleRadius, capsuleHeight, time)
    }
    this.prevAnchor.copy(anchor)
    // pin + clamp every frame, even when no substep ran (high frame rates):
    // the root must never visibly detach from the nape
    this.points[0].copy(anchor)
    this.prev[0].copy(anchor)
    this.clampChain()

    // ---- rebuild the strip (every frame: the billboard tracks the camera) ----
    const invStep = 1 / S.fixedStep
    const pos = this.posAttr
    const nAttr = this.normAttr
    const col = this.colAttr
    const nearSpan = Math.max(1e-3, S.nearFadeStart - S.nearFadeEnd)
    for (let i = 0; i <= SEGS; i++) {
      const p = this.points[i]
      const pn = this.points[Math.min(i + 1, SEGS)]
      const pp = this.points[Math.max(i - 1, 0)]
      this._t.copy(pn).sub(pp)
      const tl = this._t.length() || 1e-6
      this._t.divideScalar(tl)
      this._view.copy(camPos).sub(p)
      const vd = this._view.length() || 1e-6
      this._view.divideScalar(vd)
      // camera-facing side vector; when the segment points at the camera this
      // degenerates, so fall back to a stable perpendicular
      this._side.crossVectors(this._t, this._view)
      const sl = this._side.length()
      if (sl > 1e-4) this._side.divideScalar(sl)
      else this._side.set(this._t.z, 0, -this._t.x).normalize()
      // velocity-driven twist: fast segments roll the ribbon about its tangent
      const segSpeed = this.prev[i].distanceTo(p) * invStep
      const twist = THREE.MathUtils.clamp(
        segSpeed * S.twistPerSpeed * (0.35 + (i / SEGS) * 0.65),
        -S.twistMax,
        S.twistMax,
      )
      if (Math.abs(twist) > 1e-3) this._side.applyAxisAngle(this._t, twist)
      this._up.crossVectors(this._side, this._t)
      // END-ON COLLAPSE: |sin(tangent, view)|. A segment aimed at the camera
      // has no readable width — widening it is what produced the planks.
      const dotTV = Math.abs(this._t.dot(this._view))
      const sinT = Math.sqrt(Math.max(0, 1 - dotTV * dotTV))
      const wScale = Math.max(S.endOnFloor, sinT)
      const taper = Math.pow(1 - i / SEGS, S.taperPow)
      const w = (S.tipWidth + (S.width - S.tipWidth) * taper) * 0.5 * o.widthMult * wScale
      // near-plane fade so the cloth never smears across the lens
      const near = THREE.MathUtils.clamp((vd - S.nearFadeEnd) / nearSpan, 0, 1)
      const a = near * fade
      const base = i * RIB_VERTS
      pos.setXYZ(base, p.x - this._side.x * w, p.y - this._side.y * w, p.z - this._side.z * w)
      pos.setXYZ(base + 1, p.x, p.y, p.z)
      pos.setXYZ(base + 2, p.x + this._side.x * w, p.y + this._side.y * w, p.z + this._side.z * w)
      for (let s = 0; s < RIB_VERTS; s++) {
        const vi = base + s
        nAttr.setXYZ(vi, this._up.x, this._up.y, this._up.z)
        col.setW(vi, this.baseAlpha[vi] * a)
      }
    }
    nAttr.needsUpdate = true
    pos.needsUpdate = true
    col.needsUpdate = true
  }
}

// ---------------------------------------------------------------------------
// component
// ---------------------------------------------------------------------------

/**
 * [player-frame R2] the three authored air poses. Values are joint targets in
 * the same space as the locomotion pose; `yaw`/`roll` are fractions of
 * ANIM.air.yawOff / rollOff applied to the BODY so the frame is read three
 * quarter in the air instead of square to the camera.
 */
interface AirPose {
  legL: number
  legR: number
  kneeL: number
  kneeR: number
  shLx: number
  shRx: number
  shLz: number
  shRz: number
  elbL: number
  elbR: number
  torso: number
  yaw: number
  roll: number
}
const AIR_POSES: readonly AirPose[] = [
  // 0 — LAUNCH TUCK: knees driven to the chest, arms swept down and behind
  {
    legL: -1.02,
    legR: -1.22,
    kneeL: 1.55,
    kneeR: 1.38,
    shLx: 0.98,
    shRx: 0.82,
    shLz: -0.12,
    shRz: 0.14,
    elbL: 1.3,
    elbR: 1.08,
    torso: -0.12,
    yaw: 0.15,
    roll: 0.1,
  },
  // 1 — APEX SPREAD: the readable beat. Limbs open, chest up, arms wide.
  {
    legL: -0.3,
    legR: 0.42,
    kneeL: 0.6,
    kneeR: 0.28,
    shLx: -0.42,
    shRx: -0.28,
    shLz: -0.98,
    shRz: 0.88,
    elbL: 0.48,
    elbR: 0.58,
    torso: -0.2,
    yaw: -0.45,
    roll: -0.55,
  },
  // 2 — FALL TRAIL: legs trail, lead arm forward, body angled off axis
  {
    legL: 0.46,
    legR: 0.12,
    kneeL: 0.32,
    kneeR: 0.66,
    shLx: -0.18,
    shRx: 0.58,
    shLz: -0.72,
    shRz: 0.36,
    elbL: 0.62,
    elbR: 0.98,
    torso: 0.22,
    yaw: 0.95,
    roll: 0.6,
  },
]

/**
 * Weapon attachment sockets, published for the third-person view model.
 * The rig is procedural (no skeleton), so these are plain groups parented into
 * the arm / hip hierarchy; combat/ViewModel.tsx anchors weapons to them.
 * DO NOT remove these — combat/ViewModel.tsx depends on them.
 */
export const PlayerSockets: {
  rightHand: THREE.Object3D | null
  leftHand: THREE.Object3D | null
  hip: THREE.Object3D | null
} = { rightHand: null, leftHand: null, hip: null }

/** full-pose snapshot for the afterimage ghosts (work order #10) */
interface PoseSnap {
  pos: THREE.Vector3
  yaw: number
  bodyY: number
  bodyPitch: number
  bodyRoll: number
  bodyYaw: number
  torsoX: number
  torsoY: number
  torsoZ: number
  headX: number
  headY: number
  shLx: number
  shLz: number
  shRx: number
  shRz: number
  elL: number
  elR: number
  legLx: number
  legLz: number
  legRx: number
  legRz: number
  knL: number
  knR: number
}
const POSE_HISTORY_LEN = 24
const poseHistory: PoseSnap[] = []
let poseIdx = 0
function makeSnap(): PoseSnap {
  return {
    pos: new THREE.Vector3(),
    yaw: 0,
    bodyY: 0,
    bodyPitch: 0,
    bodyRoll: 0,
    bodyYaw: 0,
    torsoX: 0,
    torsoY: 0,
    torsoZ: 0,
    headX: 0,
    headY: 0,
    shLx: 0,
    shLz: 0,
    shRx: 0,
    shRz: 0,
    elL: 0,
    elR: 0,
    legLx: 0,
    legLz: 0,
    legRx: 0,
    legRz: 0,
    knL: 0,
    knR: 0,
  }
}

/** joint names used to re-pose the cloned ghost subtrees */
const JOINTS = [
  'j_torso',
  'j_head',
  'j_shL',
  'j_shR',
  'j_elL',
  'j_elR',
  'j_legL',
  'j_legR',
  'j_knL',
  'j_knR',
] as const

interface Ghost {
  root: THREE.Group
  body: THREE.Group
  j: Record<string, THREE.Object3D | undefined>
}

/** [R2] pre-parsed energy colours — never re-parse a CSS string in useFrame */
const _energyCore = new THREE.Color(PLAYER_ENERGY.core)
const _energyUlt = new THREE.Color(PLAYER_ENERGY.ult)
const _energyMid = new THREE.Color(PLAYER_ENERGY.mid)
const _energyHalo = new THREE.Color(PLAYER_ENERGY.halo)

const _fxPos = new THREE.Vector3()
const _fwd = new THREE.Vector3()
const _rgt = new THREE.Vector3()
const _anchor = new THREE.Vector3()

/** shortest-arc signed angle from a to b */
function angleDelta(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2)
  if (d > Math.PI) d -= Math.PI * 2
  if (d < -Math.PI) d += Math.PI * 2
  return d
}

export default function PlayerRig() {
  const root = useRef<THREE.Group>(null)
  const body = useRef<THREE.Group>(null)
  const rig = useRef<THREE.Group>(null)
  const torso = useRef<THREE.Group>(null)
  const head = useRef<THREE.Group>(null)
  const shoulderL = useRef<THREE.Group>(null)
  const shoulderR = useRef<THREE.Group>(null)
  const elbowL = useRef<THREE.Group>(null)
  const elbowR = useRef<THREE.Group>(null)
  const wristL = useRef<THREE.Group>(null)
  const wristR = useRef<THREE.Group>(null)
  const legL = useRef<THREE.Group>(null)
  const legR = useRef<THREE.Group>(null)
  const kneeL = useRef<THREE.Group>(null)
  const kneeR = useRef<THREE.Group>(null)
  const ankleL = useRef<THREE.Group>(null)
  const ankleR = useRef<THREE.Group>(null)
  const handSocketR = useRef<THREE.Group>(null)
  const handSocketL = useRef<THREE.Group>(null)
  const hipSocket = useRef<THREE.Group>(null)
  /** [R2] six skirt-lame pivot groups, driven by per-lame springs */
  const skirtRefs = [
    useRef<THREE.Group>(null),
    useRef<THREE.Group>(null),
    useRef<THREE.Group>(null),
    useRef<THREE.Group>(null),
    useRef<THREE.Group>(null),
    useRef<THREE.Group>(null),
  ]
  /** [R2] syandana anchors — parented into the torso so the scarf follows it */
  const scarfAnchorL = useRef<THREE.Group>(null)
  const scarfAnchorR = useRef<THREE.Group>(null)

  const springs = useRef({
    torsoPitch: new Spring(ANIM.look.torsoStiffness),
    torsoRoll: new Spring(ANIM.look.torsoStiffness),
    torsoYaw: new Spring(ANIM.look.torsoStiffness),
    headYaw: new Spring(ANIM.look.headStiffness),
    headPitch: new Spring(ANIM.look.headStiffness),
    bodyPitch: new Spring(),
    bodyRoll: new Spring(),
    bodyYaw: new Spring(),
    bodyY: new Spring(),
    /** [R2] per-lame skirt springs (x then z), staggered stiffness */
    skirt: Array.from({ length: 6 }, (_, i) => ({
      x: new Spring(70 + i * 9, 13 + i),
      z: new Spring(84 + i * 7, 15 + i),
    })),
  })

  /** rig-local timers that must not leak into the shared PlayerAnim contract */
  const local = useRef({
    t: 0,
    absorb: 0, // 0..1 landing absorb envelope
    absorbAmp: 0,
    wasGrounded: true,
    prevVy: 0,
    idleSeed: Math.random() * 10,
    /** [R2] seconds since the frame left the ground (drives the air sequencer) */
    airT: 0,
    /** [R2] current authored air pose: 0 launch, 1 apex, 2 fall */
    airPose: 0,
    /** [R2] seconds the current air pose has been held */
    airHold: 0,
    /** [R2] 0..1 crossfade into airPose from the previous one */
    airMix: 1,
    airPrev: 0,
    /** [R2] which foot led the last landing (alternates the weight pose) */
    landLead: 1,
    /** [R2] smoothed emissive pulse multiplier */
    energy: 1,
    /** [R2] rate limiter for contact VFX (slide sparks, wall-run dust) */
    nextFx: 0,
  })

  // publish weapon sockets for the third-person view model
  useEffect(() => {
    PlayerSockets.rightHand = handSocketR.current
    PlayerSockets.leftHand = handSocketL.current
    PlayerSockets.hip = hipSocket.current
    return () => {
      PlayerSockets.rightHand = null
      PlayerSockets.leftHand = null
      PlayerSockets.hip = null
    }
  }, [])

  // sculpted armour geometry — built once
  const geos = useMemo(
    () => ({
      helmet: makeHelmetGeometry(),
      crest: makeCrestGeometry(),
      crestRidge: makeCrestRidge(),
      gorget: makeGorgetGeometry(),
      keel: makeKeelGeometry(),
      boot: makeBootGeometry(),
      fist: makeFistGeometry(),
      plateUpper: makeShellPlate(0.215),
      plateMid: makeShellPlate(0.185),
      plateLow: makeShellPlate(0.152),
      backUpper: makeShellPlate(0.205, 0.44),
      backMid: makeShellPlate(0.178, 0.44),
      lameA: makeLame(0.155),
      lameB: makeLame(0.132),
      lameC: makeLame(0.104),
      capA: makeLame(0.138),
      capB: makeLame(0.108),
      skirtBack: makeSkirtLame(0.13, 0.1, 0.27),
      skirtSide: makeSkirtLame(0.115, 0.085, 0.22),
      skirtFront: makeSkirtLame(0.12, 0.09, 0.2),
      // [character-art R3] lofted sculpted shells replace the cylinder
      // frustums: keeled section, flared rims, folded thickness lip.
      thighPlate: makeLimbShell(0.118, 0.1, 0.3, { keel: 0.17, flare: 0.2, flat: 0.93 }),
      shinPlate: makeLimbShell(0.102, 0.078, 0.3, {
        keel: 0.18,
        flare: 0.21,
        flat: 0.9,
        prow: 0.2,
      }),
      upperArmPlate: makeLimbShell(0.082, 0.068, 0.22, { keel: 0.15, flare: 0.18, flat: 0.9, lip: 0.012 }),
      foreArmPlate: makeLimbShell(0.07, 0.058, 0.2, {
        keel: 0.16,
        flare: 0.19,
        flat: 0.9,
        prow: 0.12,
        lip: 0.012,
      }),
      // [character-art R3] hard points — the outline breakers. A flat-black
      // render of the r2 rig read as a person-shaped blob because nothing
      // projected past the limb tubes.
      kneeSpur: makeBlade(0.16, 0.092, 0.03, 0.052, 0.035),
      calfFin: makeBlade(0.175, 0.1, 0.028, 0.04, 0.055),
      heelSpur: makeBlade(0.125, 0.082, 0.024, 0.05, 0.022),
      elbowSpur: makeBlade(0.135, 0.076, 0.024, 0.042, 0.038),
      wingL: makeBlade(0.3, 0.145, 0.042, 0.058, 0.075),
      wingR: makeBlade(0.25, 0.125, 0.036, 0.05, 0.065),
      hipBlade: makeBlade(0.205, 0.105, 0.03, 0.046, 0.05),
      toeClaw: makeBlade(0.085, 0.05, 0.016, 0.03, 0.012),
      // stacked lamellar cuffs — overlap the joint below, dark suit in the gap
      cuffArm: makeCuffLame(0.072, 0.052, 0.34),
      cuffLeg: makeCuffLame(0.104, 0.062, 0.32),
      // [character-art R3] ONE continuous emissive route, lofted as a tube so
      // it curves with the back instead of being a stack of boxes:
      // nape -> thoracic -> lumbar -> sacrum.
      spineRoute: makeRoute(
        [
          [0, 0.628, -0.153],
          [0, 0.552, -0.192],
          [0, 0.45, -0.213],
          [0, 0.33, -0.215],
          [0, 0.21, -0.198],
          [0, 0.09, -0.163],
        ],
        0.0135,
      ),
      spineRouteCore: makeRoute(
        [
          [0, 0.628, -0.157],
          [0, 0.552, -0.196],
          [0, 0.45, -0.217],
          [0, 0.33, -0.219],
          [0, 0.21, -0.202],
          [0, 0.09, -0.167],
        ],
        0.0062,
      ),
      // the two forks off the thoracic node, out to the pauldron cowls
      forkL: makeRoute(
        [
          [-0.012, 0.552, -0.192],
          [-0.12, 0.588, -0.148],
          [-0.235, 0.578, -0.055],
          [-0.312, 0.558, 0.032],
        ],
        0.0082,
        26,
      ),
      forkR: makeRoute(
        [
          [0.012, 0.552, -0.192],
          [0.115, 0.578, -0.148],
          [0.222, 0.566, -0.055],
          [0.295, 0.548, 0.03],
        ],
        0.0072,
        26,
      ),
      // forearm and shin forks, swept along the limb rather than stuck on it
      routeForeArm: makeRoute(
        [
          [0, 0.01, -0.062],
          [0, -0.09, -0.078],
          [0, -0.18, -0.07],
          [0, -0.245, -0.034],
        ],
        0.0072,
        20,
      ),
      routeForeArmCore: makeRoute(
        [
          [0, 0.01, -0.0655],
          [0, -0.09, -0.0815],
          [0, -0.18, -0.0735],
          [0, -0.245, -0.0375],
        ],
        0.0032,
        20,
      ),
      routeShin: makeRoute(
        [
          [0, -0.05, -0.084],
          [0, -0.17, -0.101],
          [0, -0.29, -0.086],
          [0, -0.37, -0.05],
        ],
        0.0085,
        20,
      ),
      kneeCap: (() => {
        const g = new THREE.SphereGeometry(0.098, 16, 10)
        g.scale(0.92, 0.9, 1.0)
        return g
      })(),
      elbowCap: (() => {
        const g = new THREE.SphereGeometry(0.07, 14, 8)
        g.scale(0.9, 0.9, 1.0)
        return g
      })(),
      bevelShoulder: makeBevelBand(0.088, 0.02, 0.036),
      bevelHip: makeBevelBand(0.124, 0.026, 0.044),
      bevelKnee: makeBevelBand(0.106, 0.024, 0.038),
      bevelAnkle: makeBevelBand(0.084, 0.02, 0.032),
      bevelWrist: makeBevelBand(0.064, 0.016, 0.028),
      // [R2] silhouette + joint-closure geometry
      cowl: makeCowlGeometry(),
      gauntlet: makeGauntletGeometry(),
      finger: makeFingerGeometry(),
      elbowCowl: makeJointCowl(0.088),
      kneeCowl: makeJointCowl(0.118),
      /** dark under-suit tube at 0.72× plate radius — fills every joint void */
      jointTubeArm: new THREE.CylinderGeometry(0.052, 0.052, 0.14, 12),
      jointTubeLeg: new THREE.CylinderGeometry(0.076, 0.076, 0.17, 12),
      /** recessed piston band that sits in the joint cowl's shadow */
      pistonBand: new THREE.CylinderGeometry(0.058, 0.058, 0.026, 14),
    }),
    [],
  )

  const mats = useMemo(() => {
    const panel = panelTexture()
    const wear = wearTexture()
    const maps = armourMaps()
    /** attach the baked albedo/normal/roughness set at a given texel density */
    const dress = (
      mat: THREE.MeshStandardMaterial,
      rx: number,
      ry: number,
      nScale: number,
      useAlbedo = true,
    ) => {
      if (!maps) return
      const a = tex(maps.albedo, rx, ry)
      const n = tex(maps.normal, rx, ry)
      const r = tex(maps.rough, rx, ry)
      if (a && useAlbedo) mat.map = a
      if (n) {
        mat.normalMap = n
        mat.normalScale = new THREE.Vector2(nScale, nScale)
      }
      if (r) mat.roughnessMap = r
      // the cavity map doubles as an AO map — it needs uv2 in three, and the
      // rig's geometry only carries uv, so the cavity is multiplied into the
      // albedo at bake time instead (see armourMaps).
    }
    // ------------------------------------------------------------------
    // [character-art R3] MATERIAL RESPONSE.
    // r2 shipped three MeshStandardMaterials with different roughness, which
    // is not a material split — it is one shader with three numbers. Warframe
    // reads as (a) a LACQUERED ceramic plate: a clearcoat layer over a diffuse
    // body, so the specular is a separate, tighter, whiter lobe than the
    // diffuse; (b) BRUSHED gold: an anisotropic highlight stretched along the
    // machining direction; (c) a technical FABRIC under-suit: a sheen lobe, no
    // specular crown. three r185 has all three natively via MeshPhysical, plus
    // a Fresnel edge term injected after lighting.
    // ------------------------------------------------------------------
    const plateLight = new THREE.MeshPhysicalMaterial({
      color: COLORS.shrineIvory,
      roughness: 0.4,
      metalness: 0.0,
      envMapIntensity: 1.2,
      // lacquer coat — a second, tighter specular lobe over the ceramic body.
      // Kept well under 1: at clearcoat 0.9 / roughness 0.14 the tiled normal
      // map turned every plate into a circuit board of hot specular lines,
      // which is noise, not craft.
      clearcoat: 0.5,
      clearcoatRoughness: 0.3,
    })
    // texel density is authored so ONE panel-line cell spans ~15 cm of plate.
    // At the r2 2.4x tiling the cell was ~6 cm and the frame read as fabric
    // print rather than machined armour.
    dress(plateLight, 1.15, 1.15, 0.8)
    // the exponent has to be HIGH: at pow 3.6 the term lit a broad band on
    // every small convex plate and the frame read as a wireframe. A real edge
    // highlight is the last few degrees before the silhouette.
    addEdgeSheen(plateLight, COLORS.paleHalo, 7.0, 0.4, 'av-plate-light')
    const plateDark = new THREE.MeshPhysicalMaterial({
      color: '#232A34',
      roughness: 0.38,
      metalness: 0.55,
      envMapIntensity: 1.35,
      clearcoat: 0.38,
      clearcoatRoughness: 0.34,
    })
    dress(plateDark, 1.05, 1.05, 0.75)
    addEdgeSheen(plateDark, COLORS.paleHalo, 6.0, 0.55, 'av-plate-dark')
    // the under-suit is CLOTH, not plastic: a sheen lobe and no specular crown,
    // so every gap the plates leave reads as a different substance
    const suit = new THREE.MeshPhysicalMaterial({
      color: '#0E1116',
      roughness: 0.88,
      metalness: 0.0,
      envMapIntensity: 0.45,
      sheen: 0.7,
      sheenRoughness: 0.75,
      sheenColor: new THREE.Color('#5C7690'),
    })
    const ps = tex(panel, 2.6, 2.6)
    if (ps) suit.roughnessMap = ps
    if (maps) {
      const sn = tex(maps.normal, 2.6, 2.6)
      if (sn) {
        suit.normalMap = sn
        suit.normalScale = new THREE.Vector2(0.3, 0.3)
      }
    }
    addEdgeSheen(suit, '#8FB6D8', 6.5, 0.12, 'av-suit')
    // brushed gold — circumferential machining, so the highlight stretches
    // around the band instead of sitting as one round hot dot
    const trim = new THREE.MeshPhysicalMaterial({
      color: '#A67C2E',
      metalness: 1.0,
      roughness: 0.32,
      envMapIntensity: 1.5,
      anisotropy: 0.75,
      anisotropyRotation: Math.PI / 2,
    })
    const tw = tex(wear, 2, 2)
    if (tw) trim.roughnessMap = tw
    if (maps) {
      const tn = tex(maps.normal, 3.2, 3.2)
      if (tn) {
        trim.normalMap = tn
        trim.normalScale = new THREE.Vector2(0.35, 0.35)
      }
    }
    addEdgeSheen(trim, COLORS.aureate, 5.5, 0.35, 'av-trim')
    const trimDark = new THREE.MeshPhysicalMaterial({
      color: '#5A4520',
      metalness: 0.95,
      roughness: 0.55,
      envMapIntensity: 1.3,
      anisotropy: 0.6,
      anisotropyRotation: Math.PI / 2,
    })
    // ---- three-layer emissive route (bloom knee is 1.0: the core must be
    // authored ABOVE white or nothing on the frame blooms at all) ----
    const glowCore = new THREE.MeshBasicMaterial({
      color: new THREE.Color(PLAYER_ENERGY.core).multiplyScalar(ANIM.energy.coreBoost),
      toneMapped: false,
    })
    const glow = new THREE.MeshBasicMaterial({
      color: new THREE.Color(PLAYER_ENERGY.mid).multiplyScalar(ANIM.energy.midBoost),
      toneMapped: false,
    })
    const glowSoft = new THREE.MeshBasicMaterial({
      color: new THREE.Color(PLAYER_ENERGY.halo).multiplyScalar(ANIM.energy.falloffBoost),
      toneMapped: false,
      transparent: true,
      opacity: ANIM.energy.falloffOpacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
    const cloth = new THREE.MeshStandardMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
      roughness: 0.82,
      metalness: 0.04,
      transparent: true,
      opacity: 1,
      depthWrite: false,
    })
    const scarfGlow = new THREE.MeshBasicMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    })
    return {
      plateLight,
      plateDark,
      suit,
      trim,
      trimDark,
      glow,
      glowCore,
      glowSoft,
      cloth,
      scarfGlow,
    }
  }, [])

  /** every rig material that participates in the camera-proximity fade */
  const fadeMats = useMemo(
    () => [
      mats.plateLight,
      mats.plateDark,
      mats.suit,
      mats.trim,
      mats.trimDark,
      mats.glow,
      mats.glowCore,
    ],
    [mats],
  )

  /**
   * [player-frame R2] SHADOW FLAGS — the measured round-2 diagnosis was that
   * only 80 of 880 meshes in the scene had `receiveShadow` set, so the shadow
   * pass ran and was thrown away. Rather than hand-flagging ~90 JSX meshes (and
   * missing some every time the rig changes), every lit mesh under the rig is
   * flagged here once on mount. Emissive/additive meshes are deliberately
   * excluded: they are unlit, and casting from them would punch holes in the
   * armour they sit in.
   */
  useEffect(() => {
    const r = root.current
    if (!r) return
    const unlit = new Set<THREE.Material>([mats.glow, mats.glowCore, mats.glowSoft])
    r.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (!(mesh as THREE.Mesh & { isMesh?: boolean }).isMesh) return
      const mat = mesh.material
      const isUnlit = Array.isArray(mat) ? mat.every((mm) => unlit.has(mm)) : unlit.has(mat)
      if (isUnlit) {
        mesh.castShadow = false
        mesh.receiveShadow = false
        return
      }
      // the shadow pass costs per CASTER, so small trim is receive-only — the
      // diagnosis asks for structural masses as casters and trim as receivers
      const g = mesh.geometry
      if (g && !g.boundingSphere) g.computeBoundingSphere()
      const rad = g?.boundingSphere?.radius ?? 1
      mesh.castShadow = rad >= 0.05
      mesh.receiveShadow = true
    })
  }, [mats])

  const ribbons = useMemo(() => {
    const s = ANIM.scarf
    return [
      new Ribbon(
        {
          segLen: s.segmentLength,
          gravity: s.gravity,
          drag: s.drag,
          widthMult: 1,
          zOffset: 0,
          windPhase: 0,
        },
        mats.cloth,
        mats.scarfGlow,
      ),
      new Ribbon(
        {
          segLen: s.segmentLength * s.asymSegLen,
          gravity: s.gravity * s.asymGravity,
          drag: s.asymDrag,
          widthMult: 0.78,
          zOffset: -0.06,
          windPhase: 2.1,
        },
        mats.cloth,
        mats.scarfGlow,
      ),
    ]
  }, [mats])
  const ribbonsInit = useRef(false)

  // ---- lunge afterimage ghosts: pooled clones of the REAL rig subtree ----
  const ghostGroup = useRef<THREE.Group>(null)
  const ghosts = useRef<Ghost[]>([])
  /** one material per ghost so the trail staggers instead of stacking flat */
  const ghostMats = useMemo(
    () =>
      Array.from(
        { length: ANIM.ghosts.count },
        () =>
          new THREE.MeshBasicMaterial({
            color: new THREE.Color(COLORS.aureate).multiplyScalar(0.7),
            transparent: true,
            opacity: 0,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            toneMapped: false,
          }),
      ),
    [],
  )

  useEffect(() => {
    const src = rig.current
    const host = ghostGroup.current
    if (!src || !host || ghosts.current.length) return
    const built: Ghost[] = []
    for (let i = 0; i < ANIM.ghosts.count; i++) {
      const clone = src.clone(true)
      const strip: THREE.Object3D[] = []
      clone.traverse((o) => {
        const anyO = o as THREE.Mesh & { isMesh?: boolean; isLight?: boolean }
        if (anyO.isLight) {
          strip.push(o)
          return
        }
        if (!anyO.isMesh) return
        // ghosts only need the silhouette — drop trim/emissive detail so three
        // posed clones don't triple the rig's draw-call cost during a lunge
        const g = anyO.geometry
        if (g) {
          if (!g.boundingSphere) g.computeBoundingSphere()
          if ((g.boundingSphere?.radius ?? 1) < 0.055) {
            strip.push(o)
            return
          }
        }
        anyO.material = ghostMats[i]
        anyO.castShadow = false
        anyO.receiveShadow = false
      })
      for (const o of strip) o.parent?.remove(o)
      const gBody = new THREE.Group()
      gBody.position.y = PELVIS_Y
      gBody.add(clone)
      const gRoot = new THREE.Group()
      gRoot.add(gBody)
      gRoot.visible = false
      gRoot.frustumCulled = false
      host.add(gRoot)
      const j: Record<string, THREE.Object3D | undefined> = {}
      for (const n of JOINTS) j[n] = clone.getObjectByName(n)
      built.push({ root: gRoot, body: gBody, j })
    }
    ghosts.current = built
    return () => {
      // NOTE: clones SHARE geometry with the live rig — never dispose that.
      // The ghost materials are ours alone, so they do get released.
      for (const g of built) g.root.parent?.remove(g.root)
      for (const mt of ghostMats) mt.dispose()
      ghosts.current = []
    }
  }, [ghostMats])

  useFrame(({ camera }, delta) => {
    const m = springs.current
    const L = local.current
    const st = useGameStore.getState()
    // dt clamp matched to the controller (0.1) so pose can't lag below 30 fps
    const dt = Math.min(delta, 0.1) * st.timeScale
    if (dt <= 0) return
    L.t += dt

    const P = PlayerRef
    const A = PlayerAnim
    const state = P.state
    const v = P.velocity
    const R = root.current
    const B = body.current
    const T = torso.current
    if (!R || !B || !T) return

    // -- root transform ---------------------------------------------------------
    R.position.copy(P.position)
    R.rotation.y = A.moveYaw
    const yaw = A.moveYaw
    _fwd.set(Math.sin(yaw), 0, Math.cos(yaw))
    _rgt.set(Math.cos(yaw), 0, -Math.sin(yaw))

    const wallrunning = state === 'wallrunL' || state === 'wallrunR'
    const wallValid = wallrunning && P.wallNormal.lengthSq() > 0.1
    // wall-run: shift the body toward the wall so the feet actually plant on it
    if (wallValid) R.position.addScaledVector(P.wallNormal, -0.13)

    // -- gait cycle (2π-correct: one cycle == one stride) ------------------------
    const speedNorm = THREE.MathUtils.clamp(A.speed / MOVE.sprintSpeed, 0, 1.3)
    const stride = THREE.MathUtils.lerp(
      ANIM.strideLength,
      ANIM.strideLengthSprint,
      THREE.MathUtils.clamp(speedNorm, 0, 1),
    )
    if ((P.isGrounded || wallrunning) && A.speed > 0.2) {
      A.gaitPhase += ((A.speed / stride) * Math.PI * 2) * dt
      if (A.gaitPhase > Math.PI * 2000) A.gaitPhase -= Math.PI * 2000
    }
    const phase = A.gaitPhase
    const gaitAmp = Math.min(speedNorm, 1.15)

    // sprint intensity 0..1 (walk → sprint speed), grounded locomotion only
    const sprintT =
      P.isGrounded && (state === 'run' || state === 'sprint')
        ? THREE.MathUtils.clamp((A.speed - MOVE.walkSpeed) / (MOVE.sprintSpeed - MOVE.walkSpeed), 0, 1)
        : 0

    const swing = Math.sin(phase) * ANIM.legSwing * gaitAmp * (1 + SPRINT_POSE.legBoost * sprintT)

    // -- landing absorb (weakness P4: landImpact was written and never read) -----
    if (P.isGrounded && !L.wasGrounded) {
      const impact = Math.max(0, -L.prevVy, A.landImpact)
      if (impact > ANIM.landing.minImpact) {
        L.absorbAmp = THREE.MathUtils.clamp(
          (impact - ANIM.landing.minImpact) /
            (ANIM.landing.fullImpact - ANIM.landing.minImpact),
          0,
          1,
        )
        L.absorb = 1
        L.landLead = -L.landLead
        // [R2] contact event: a dust ring at the feet so a landing touches the
        // world instead of happening in mid-air
        VFX.ring({
          position: P.position,
          color: COLORS.shrineIvory,
          maxRadius: 0.8 + L.absorbAmp * 1.5,
          life: 0.34,
          width: 0.05,
        })
        if (L.absorbAmp > 0.35) {
          VFX.burst({
            position: P.position,
            color: COLORS.shrineIvory,
            count: 6 + Math.round(L.absorbAmp * 8),
            speed: 2.4 + L.absorbAmp * 3,
            life: 0.4,
            size: 0.06,
            gravity: 3,
            shape: 'smoke',
          })
        }
      }
    }
    L.wasGrounded = P.isGrounded
    L.prevVy = v.y
    if (L.absorb > 0) {
      L.absorb = Math.max(0, L.absorb - dt / ANIM.landing.absorbTime)
    }
    // ease-out envelope: snap down, recover on the springs
    const absorb = L.absorb * L.absorb * L.absorbAmp

    // -- spine lean from local accel (movement.md §10) -----------------------------
    const localAccelZ = A.accel.dot(_fwd)
    const localAccelX = A.accel.dot(_rgt)
    let torsoPitchT = THREE.MathUtils.clamp(
      localAccelZ * ANIM.leanPitchPerAccel,
      -ANIM.leanPitchMax,
      ANIM.leanPitchMax,
    )
    let torsoRollT =
      -localAccelX * ANIM.leanRollPerStrafeAccel + getCamRoll() * ANIM.cameraRollInfluence
    torsoPitchT += SPRINT_POSE.leanMax * sprintT
    torsoPitchT += ANIM.landing.torsoPitch * absorb

    // -- pose targets per state -------------------------------------------------------
    let bodyPitchT = 0
    let bodyRollT = 0
    let bodyYawT = 0
    let bodyYT = -ANIM.landing.bodyDrop * absorb
    let legLx = -swing
    let legRx = swing
    let legLz = 0
    let legRz = 0
    let kneeLx =
      Math.max(0, -Math.sin(phase)) * 0.9 * gaitAmp * (1 + SPRINT_POSE.kneeBoost * sprintT) +
      ANIM.landing.kneeBend * absorb
    let kneeRx =
      Math.max(0, Math.sin(phase)) * 0.9 * gaitAmp * (1 + SPRINT_POSE.kneeBoost * sprintT) +
      ANIM.landing.kneeBend * absorb
    const armAmp = ANIM.armSwingMult * (1 + SPRINT_POSE.armBoost * sprintT)
    let shLx = swing * armAmp
    let shRx = -swing * armAmp
    let shLz = -0.1 - SPRINT_POSE.armTuck * sprintT
    let shRz = 0.1 + SPRINT_POSE.armTuck * sprintT
    let elbL = 0.35 + sprintT * (0.45 + 0.35 * Math.max(0, Math.sin(phase)))
    let elbR = 0.35 + sprintT * (0.45 + 0.35 * Math.max(0, -Math.sin(phase)))

    if (P.isGrounded && (state === 'run' || state === 'sprint')) {
      bodyYT += Math.abs(Math.sin(phase)) * ANIM.bobAmp * (1 + SPRINT_POSE.bobBoost * sprintT) * gaitAmp
    }

    // -- asymmetric idle: weight on the right leg, 0.4 Hz breath, slow sway ------
    const crouch = A.crouch
    const idleW =
      P.isGrounded && (state === 'run' || state === 'sprint') && crouch < 0.2
        ? 1 - THREE.MathUtils.clamp(A.speed / ANIM.idle.blendSpeed, 0, 1)
        : 0
    if (idleW > 0.001) {
      const br = Math.sin(L.t * Math.PI * 2 * ANIM.idle.breathHz + L.idleSeed)
      const sway = Math.sin(L.t * Math.PI * 2 * ANIM.idle.swayHz + L.idleSeed * 1.7)
      const iBodyY = br * ANIM.idle.breathAmp
      const iTorsoZ = ANIM.idle.weightRoll + sway * 0.02
      const iTorsoX = 0.03 + br * 0.018
      bodyYT = THREE.MathUtils.lerp(bodyYT, bodyYT + iBodyY, idleW)
      torsoRollT += iTorsoZ * idleW
      torsoPitchT += iTorsoX * idleW
      bodyRollT += -ANIM.idle.weightRoll * 0.55 * idleW
      // hips counter-rotate over the loaded leg; free leg relaxes forward
      legLx = THREE.MathUtils.lerp(legLx, 0.09 + sway * 0.02, idleW)
      legRx = THREE.MathUtils.lerp(legRx, -0.1, idleW)
      legLz = THREE.MathUtils.lerp(legLz, 0.06, idleW)
      legRz = THREE.MathUtils.lerp(legRz, 0.03, idleW)
      kneeLx = THREE.MathUtils.lerp(kneeLx, 0.2, idleW)
      kneeRx = THREE.MathUtils.lerp(kneeRx, 0.05, idleW)
      shLx = THREE.MathUtils.lerp(shLx, -0.06 + br * 0.02, idleW)
      shRx = THREE.MathUtils.lerp(shRx, 0.05 - br * 0.02, idleW)
      shLz = THREE.MathUtils.lerp(shLz, -0.17, idleW)
      shRz = THREE.MathUtils.lerp(shRz, 0.12, idleW)
      elbL = THREE.MathUtils.lerp(elbL, 0.42, idleW)
      elbR = THREE.MathUtils.lerp(elbR, 0.24, idleW)
    }

    // -- slide: a real slide, not a standing figure -------------------------------
    // [player-frame R2] the whole rig drops (pelvis → ~0.42 m), the body rotates
    // back so the lead shin is floor-parallel, the trailing leg tucks under and
    // the trailing hand is planted on the deck.
    if (crouch > 0.001) {
      const S = ANIM.slide
      bodyYT -= (PELVIS_Y - S.rootDrop) * crouch
      bodyPitchT = bodyPitchT * (1 - crouch) + -S.bodyPitch * 0.55 * crouch
      torsoPitchT += -S.torsoLeanBack * crouch
      legLx = legLx * (1 - crouch) + S.leadHip * crouch
      kneeLx = kneeLx * (1 - crouch) + S.leadKnee * crouch
      legRx = legRx * (1 - crouch) + S.trailHip * crouch
      kneeRx = kneeRx * (1 - crouch) + S.trailKnee * crouch
      legLz = legLz * (1 - crouch) + -0.12 * crouch
      legRz = legRz * (1 - crouch) + 0.2 * crouch
      // trailing hand planted behind, lead arm across the body for balance
      shRx = shRx * (1 - crouch) + S.handHip * crouch
      shRz = shRz * (1 - crouch) + S.handSpread * crouch
      elbR = elbR * (1 - crouch) + S.handElbow * crouch
      shLx = shLx * (1 - crouch) + -0.55 * crouch
      shLz = shLz * (1 - crouch) + -0.42 * crouch
      elbL = elbL * (1 - crouch) + 1.15 * crouch
    }

    // -- air: three AUTHORED poses sequenced on time-since-ground -----------------
    // [player-frame R2] the linear ±5.5 m/s v.y blend spent most of a jump on
    // one averaged mid-pose. launch tuck → apex spread → fall trail now hold for
    // a minimum time each and crossfade on a smoothstep, and the body is yawed /
    // rolled off the camera axis so the air silhouette is never a flat plank.
    const airborne = state === 'air' && crouch < 0.1
    if (airborne) {
      L.airT += dt
      L.airHold += dt
      const A_ = ANIM.air
      let want = L.airPose
      if (v.y > A_.apexVy) want = 0
      else if (v.y < -A_.apexVy) want = 2
      else want = 1
      // a pose may only be replaced once it has been held long enough to read
      if (want !== L.airPose && L.airHold >= A_.minHold) {
        L.airPrev = L.airPose
        L.airPose = want
        L.airMix = 0
        L.airHold = 0
      }
      L.airMix = Math.min(1, L.airMix + dt / A_.crossfade)
      const mix = L.airMix * L.airMix * (3 - 2 * L.airMix) // smoothstep
      const a = AIR_POSES[L.airPrev]
      const b = AIR_POSES[L.airPose]
      const bl = (k: keyof AirPose) => a[k] + (b[k] - a[k]) * mix
      legLx = bl('legL')
      legRx = bl('legR')
      kneeLx = bl('kneeL')
      kneeRx = bl('kneeR')
      shLx = bl('shLx')
      shRx = bl('shRx')
      shLz = bl('shLz')
      shRz = bl('shRz')
      elbL = bl('elbL')
      elbR = bl('elbR')
      torsoPitchT += bl('torso')
      bodyYawT += bl('yaw') * A_.yawOff
      bodyRollT += bl('roll') * A_.rollOff
    } else {
      L.airT = 0
      L.airHold = 0
      L.airPose = 0
      L.airPrev = 0
      L.airMix = 1
    }

    // -- landing weight transfer --------------------------------------------------
    // [player-frame R2] the absorb envelope used to be a symmetric squat. A
    // landing now has WEIGHT: the hips shift over a lead leg (alternating per 
    // landing), the shoulders open, the trailing arm counterweights and the
    // lead hand drops toward the deck.
    if (absorb > 0.001) {
      const LD = ANIM.landing
      const lead = L.landLead
      const a = absorb
      bodyYawT += lead * LD.shoulderYaw * a
      legLz += lead * LD.hipShift * a
      legRz += lead * LD.hipShift * a
      kneeLx += (lead > 0 ? 0.5 : 0.12) * a
      kneeRx += (lead > 0 ? 0.12 : 0.5) * a
      legLx += (lead > 0 ? -0.28 : 0.22) * a
      legRx += (lead > 0 ? 0.22 : -0.28) * a
      shLz += -LD.armSpread * a
      shRz += LD.armSpread * a
      if (lead > 0) {
        shRx += LD.handDrop * a
        elbR += 0.55 * a
      } else {
        shLx += LD.handDrop * a
        elbL += 0.55 * a
      }
      torsoPitchT += 0.12 * a
    }

    // -- wall-run: feet planted on the wall, outside hand trailing ---------------
    if (wallrunning) {
      const side = A.wallSide || (state === 'wallrunL' ? -1 : 1)
      bodyRollT = -side * MOVE.wallrun.torsoTilt // torso tilted toward wall
      // [player-frame R2] the frame also yaws INTO the wall so the run reads as
      // a three-quarter sprint along it rather than a figure pasted flat on it
      bodyYawT += side * 0.28
      torsoPitchT += 0.22 // driving forward
      const wswing = Math.sin(phase * 1.15) * 0.85
      legLx = -wswing
      legRx = wswing
      kneeLx = Math.max(0, -Math.sin(phase * 1.15)) * 1.1
      kneeRx = Math.max(0, Math.sin(phase * 1.15)) * 1.1
      // both legs swing out toward the wall so the soles meet the surface
      legLz = side * 0.34
      legRz = side * 0.34
      if (side > 0) {
        // wall on the right: right hand reaches to it, left arm trails behind
        shRz = 1.15
        shRx = 0.12
        elbR = 0.2
        shLz = -0.28
        shLx = 0.62
        elbL = 1.0
      } else {
        shLz = -1.15
        shLx = 0.12
        elbL = 0.2
        shRz = 0.28
        shRx = 0.62
        elbR = 1.0
      }
    }

    if (state === 'glide') {
      // superman-lite: torso pitched 70°, arms swept back, legs trailing
      bodyPitchT = ANIM.glideTorsoPitch
      shLx = shRx = 0.95
      shLz = -0.35
      shRz = 0.35
      elbL = elbR = 0.15
      legLx = legRx = 0.3
      kneeLx = kneeRx = 0.15
      bodyYT += 0.15
    }

    if (state === 'lunge') {
      // tight tuck — the 360° roll is applied directly below (no spring)
      legLx = legRx = -1.1
      kneeLx = kneeRx = 1.5
      shLx = shRx = 0.6
      shLz = -0.1
      shRz = 0.1
      elbL = elbR = 1.2
    }

    if (state === 'dead') {
      bodyPitchT = 0.9
      bodyYT = -0.8
      shLz = -0.4
      shRz = 0.4
      legLx = 0.3
      legRx = 0.15
    }

    // aiming while running: blade stance — right arm pinned back, left countering
    const aiming = Input.held('aim')
    if ((state === 'run' || state === 'sprint') && crouch < 0.3 && aiming) {
      shRx = 0.85
      shRz = 0.22
      elbR = 0.55
      shLx = -0.5 - swing * 0.25 * gaitAmp
      shLz = -0.2
      elbL = 0.95
    }

    // -- contact VFX: slide sparks and wall-run dust ------------------------------
    // [player-frame R2] rate-limited so the particle budget can't be eaten by a
    // long slide; both emit at the actual contact point, not the pelvis.
    if (L.t >= L.nextFx) {
      if (crouch > 0.45 && P.isGrounded && A.speed > 4) {
        _fxPos.copy(P.position).addScaledVector(_fwd, 0.34)
        _fxPos.y += 0.06
        VFX.burst({
          position: _fxPos,
          color: COLORS.aureate,
          count: 5,
          speed: 3.4,
          life: 0.22,
          size: 0.03,
          gravity: 7,
          shape: 'spark',
        })
        L.nextFx = L.t + 0.055
      } else if (wallValid && A.speed > 4) {
        _fxPos.copy(P.position).addScaledVector(P.wallNormal, 0.1)
        _fxPos.y += 0.35
        VFX.burst({
          position: _fxPos,
          color: COLORS.shrineIvory,
          count: 4,
          speed: 2.2,
          life: 0.3,
          size: 0.045,
          gravity: 2.5,
          shape: 'ember',
        })
        L.nextFx = L.t + 0.07
      }
    }

    // -- additive look layer: head leads the torso (~80 ms) ----------------------
    // camera look yaw expressed in body space; the rig faces +Z of its own root
    const camBodyYaw = angleDelta(yaw, CamRef.yaw + Math.PI)
    const headYawT = THREE.MathUtils.clamp(camBodyYaw, -ANIM.look.headYawMax, ANIM.look.headYawMax)
    const headPitchT = THREE.MathUtils.clamp(
      -CamRef.pitch,
      -ANIM.look.headPitchMax,
      ANIM.look.headPitchMax,
    )
    const chestTwistT = THREE.MathUtils.clamp(
      camBodyYaw * 0.45,
      -ANIM.look.chestTwistMax,
      ANIM.look.chestTwistMax,
    )

    // -- spring-blend core scalars ---------------------------------------------------
    const torsoX = m.torsoPitch.update(torsoPitchT, dt)
    const torsoZ = m.torsoRoll.update(torsoRollT, dt)
    const torsoY = m.torsoYaw.update(chestTwistT, dt)
    T.rotation.set(torsoX, torsoY, torsoZ)
    const bodyPitch = m.bodyPitch.update(bodyPitchT, dt)
    const bodyRoll = state === 'lunge' ? A.lungeT * Math.PI * 2 : m.bodyRoll.update(bodyRollT, dt)
    const bodyYaw = m.bodyYaw.update(bodyYawT, dt)
    const bodyY = m.bodyY.update(bodyYT, dt)
    B.rotation.x = bodyPitch
    B.rotation.y = bodyYaw
    B.rotation.z = bodyRoll
    B.position.y = PELVIS_Y + bodyY

    // -- write joints (exp-damped toward target) ----------------------------------------
    const k = 1 - Math.exp(-18 * dt)
    const damp = (g: THREE.Group | null, axis: 'x' | 'y' | 'z', target: number) => {
      if (!g) return
      g.rotation[axis] += (target - g.rotation[axis]) * k
    }
    damp(legL.current, 'x', legLx)
    damp(legR.current, 'x', legRx)
    damp(legL.current, 'z', legLz)
    damp(legR.current, 'z', legRz)
    damp(kneeL.current, 'x', -kneeLx) // knees bend backward
    damp(kneeR.current, 'x', -kneeRx)
    damp(shoulderL.current, 'x', shLx)
    damp(shoulderR.current, 'x', shRx)
    damp(shoulderL.current, 'z', shLz)
    damp(shoulderR.current, 'z', shRz)
    damp(elbowL.current, 'x', -elbL)
    damp(elbowR.current, 'x', -elbR)
    // wrists counter part of the elbow so the grip stays level
    damp(wristL.current, 'x', elbL * 0.42)
    damp(wristR.current, 'x', elbR * 0.42)
    // ankles keep the sole roughly parallel to the ground
    damp(ankleL.current, 'x', THREE.MathUtils.clamp(-(legLx - kneeLx) * 0.55, -0.7, 0.7))
    damp(ankleR.current, 'x', THREE.MathUtils.clamp(-(legRx - kneeRx) * 0.55, -0.7, 0.7))

    // -- skirt lames: 2-stage spring seeded from pelvis velocity -----------------
    // [player-frame R2] the hip skirt was welded to the belt. Each lame now
    // trails the pelvis (clamped to ±22°) and settles on its own spring, which
    // is what sells mass on a sprint stop or a landing.
    {
      const LIM = 0.384 // 22°
      const vz = v.x * _fwd.x + v.z * _fwd.z
      const vx = v.x * _rgt.x + v.z * _rgt.z
      const sp = MOVE.sprintSpeed
      const tX = THREE.MathUtils.clamp((vz / sp) * 0.55 + absorb * 0.22, -LIM, LIM)
      const tZ = THREE.MathUtils.clamp((-vx / sp) * 0.5, -LIM, LIM)
      for (let i = 0; i < 6; i++) {
        const g = skirtRefs[i].current
        if (!g) continue
        // per-lame phase offset so the ring never moves as one rigid hoop
        const ph = Math.sin(phase + i * 1.05) * 0.035 * gaitAmp
        const sx = m.skirt[i].x.update(tX + ph, dt)
        const sz = m.skirt[i].z.update(tZ + ph * 0.4, dt)
        g.rotation.x = THREE.MathUtils.clamp(sx, -LIM, LIM)
        g.rotation.z = THREE.MathUtils.clamp(sz, -LIM, LIM)
      }
    }

    // head: fast spring on top of the torso counter-lean → leads the turn
    const headY = m.headYaw.update(headYawT - torsoY, dt)
    const headX = m.headPitch.update(headPitchT - torsoX * 0.6, dt)
    if (head.current) head.current.rotation.set(headX, headY, -torsoZ * 0.35)

    // -- camera-proximity fade (rig dissolves instead of clipping the near plane) --
    const fade = getPlayerFade()
    const transparent = fade < 0.995
    for (const mat of fadeMats) {
      if (mat.transparent !== transparent) {
        mat.transparent = transparent
        mat.needsUpdate = true
      }
      mat.opacity = fade
      mat.depthWrite = !transparent
    }
    mats.cloth.opacity = fade
    mats.scarfGlow.opacity = 0.9 * fade

    // -- emissive route: core / mid / falloff, driven by combat state --------------
    // [player-frame R2] one route, three layers. The bloom knee is 1.0, so the
    // core is authored ABOVE white; mid and falloff sit under it. Ultimate and
    // dash push the whole route, they do not add a separate colour.
    const E = ANIM.energy
    let energyT = 1 + Math.sin(L.t * Math.PI * 2 * E.pulseHz) * E.pulseAmp
    if (CombatState.requiemPhase !== 0) energyT *= E.ultBoost
    else if (CombatState.dashing) energyT *= E.dashBoost
    L.energy += (energyT - L.energy) * (1 - Math.exp(-9 * dt))
    const eMul = L.energy * fade
    mats.glowCore.color
      .copy(CombatState.requiemPhase !== 0 ? _energyUlt : _energyCore)
      .multiplyScalar(E.coreBoost * eMul)
    mats.glow.color.copy(_energyMid).multiplyScalar(E.midBoost * eMul)
    mats.glowSoft.color.copy(_energyHalo).multiplyScalar(E.falloffBoost * L.energy)
    mats.glowSoft.opacity = E.falloffOpacity * fade

    // -- scarf ribbons ------------------------------------------------------------
    // [player-frame R2] the anchors are real bones now: two empty groups parented
    // into the torso, so the scarf inherits every body transform (weakness P7)
    // instead of hanging off feet + 1.48 m in world space.
    for (let i = 0; i < 2; i++) {
      const src = i === 0 ? scarfAnchorL.current : scarfAnchorR.current
      if (src) src.getWorldPosition(_anchor)
      else _anchor.set(R.position.x, R.position.y + 1.46 + bodyY, R.position.z)
      if (!ribbonsInit.current) ribbons[i].reset(_anchor)
      ribbons[i].update(
        dt,
        _anchor,
        P.position,
        P.radius,
        P.height,
        camera.position,
        L.t,
        fade,
      )
    }
    ribbonsInit.current = true

    // -- full-pose history (drives the ghost clones) -----------------------------------
    while (poseHistory.length < POSE_HISTORY_LEN) poseHistory.push(makeSnap())
    const snap = poseHistory[poseIdx % POSE_HISTORY_LEN]
    snap.pos.copy(R.position)
    snap.yaw = yaw
    snap.bodyY = bodyY
    snap.bodyPitch = bodyPitch
    snap.bodyRoll = bodyRoll
    snap.bodyYaw = bodyYaw
    snap.torsoX = torsoX
    snap.torsoY = torsoY
    snap.torsoZ = torsoZ
    snap.headX = headX
    snap.headY = headY
    snap.shLx = shoulderL.current?.rotation.x ?? 0
    snap.shLz = shoulderL.current?.rotation.z ?? 0
    snap.shRx = shoulderR.current?.rotation.x ?? 0
    snap.shRz = shoulderR.current?.rotation.z ?? 0
    snap.elL = elbowL.current?.rotation.x ?? 0
    snap.elR = elbowR.current?.rotation.x ?? 0
    snap.legLx = legL.current?.rotation.x ?? 0
    snap.legLz = legL.current?.rotation.z ?? 0
    snap.legRx = legR.current?.rotation.x ?? 0
    snap.legRz = legR.current?.rotation.z ?? 0
    snap.knL = kneeL.current?.rotation.x ?? 0
    snap.knR = kneeR.current?.rotation.x ?? 0
    poseIdx++

    // -- afterimage ghosts: posed clones of the real subtree ----------------------------
    const gl = ghosts.current
    if (gl.length) {
      const fadeT = THREE.MathUtils.clamp(A.afterimageT / 0.4, 0, 1)
      const alive = fadeT > 0 && poseIdx > POSE_HISTORY_LEN
      for (let gi = 0; gi < gl.length; gi++) {
        const g = gl[gi]
        // clamped, staggered — the additive stack must never clip to white
        ghostMats[gi].opacity = alive
          ? fadeT * ANIM.ghosts.maxOpacity * (1 - gi / (gl.length + 1))
          : 0
        if (!alive) {
          if (g.root.visible) g.root.visible = false
          continue
        }
        const back = Math.min(POSE_HISTORY_LEN - 1, (gi + 1) * ANIM.ghosts.frameGap)
        const s = poseHistory[(poseIdx - 1 - back + POSE_HISTORY_LEN * 4) % POSE_HISTORY_LEN]
        g.root.visible = true
        g.root.position.copy(s.pos)
        g.root.rotation.set(0, s.yaw, 0)
        g.body.position.y = PELVIS_Y + s.bodyY
        g.body.rotation.set(s.bodyPitch, s.bodyYaw, s.bodyRoll)
        g.j.j_torso?.rotation.set(s.torsoX, s.torsoY, s.torsoZ)
        g.j.j_head?.rotation.set(s.headX, s.headY, 0)
        g.j.j_shL?.rotation.set(s.shLx, 0, s.shLz)
        g.j.j_shR?.rotation.set(s.shRx, 0, s.shRz)
        if (g.j.j_elL) g.j.j_elL.rotation.x = s.elL
        if (g.j.j_elR) g.j.j_elR.rotation.x = s.elR
        g.j.j_legL?.rotation.set(s.legLx, 0, s.legLz)
        g.j.j_legR?.rotation.set(s.legRx, 0, s.legRz)
        if (g.j.j_knL) g.j.j_knL.rotation.x = s.knL
        if (g.j.j_knR) g.j.j_knR.rotation.x = s.knR
      }
    }
  }, -9)

  return (
    <>
      <group ref={root}>
        {/* body pivots at the PELVIS, not at the feet (weakness P2) */}
        <group ref={body} position={[0, PELVIS_Y, 0]}>
          <group ref={rig} position={[0, -PELVIS_Y, 0]}>
            {/* ================= hips ================= */}
            <group position={[0, PELVIS_Y, 0]}>
              {/* pelvis undersuit */}
              <mesh material={mats.suit} scale={[1, 1, 0.86]} castShadow>
                <capsuleGeometry args={[0.145, 0.1, 4, 12]} />
              </mesh>
              {/* armoured belt — chamfered band, not a wire torus */}
              <mesh
                geometry={geos.bevelHip}
                material={mats.plateDark}
                position={[0, 0.045, 0]}
                scale={[1.32, 1.5, 1.14]}
                castShadow
                receiveShadow
              />
              <mesh
                geometry={geos.bevelHip}
                material={mats.trim}
                position={[0, 0.082, 0]}
                scale={[1.28, 0.55, 1.1]}
                castShadow
              />
              {/* lumbar reactor node — the back's energy origin */}
              <mesh material={mats.trimDark} position={[0, 0.04, -0.15]} castShadow>
                <sphereGeometry args={[0.055, 14, 10]} />
              </mesh>
              <mesh material={mats.glowCore} position={[0, 0.04, -0.185]}>
                <sphereGeometry args={[0.032, 12, 8]} />
              </mesh>

              {/* ---- segmented waist skirt: rear at parity with the front ----
                   [R2] each lame now hangs from its own pivot group at the belt
                   line and is driven by a per-lame spring seeded from the
                   pelvis velocity (clamped to ±22°), so the skirt trails a
                   sprint and settles on landing instead of being welded on. */}
              <group ref={skirtRefs[0]} position={[0, 0.01, -0.15]}>
                <mesh
                  geometry={geos.skirtBack}
                  material={mats.plateLight}
                  position={[0, -0.03, 0]}
                  rotation={[-0.22, 0, 0]}
                  castShadow
                  receiveShadow
                />
                {/* gold keel edge down the rear skirt */}
                <mesh material={mats.trim} position={[0, -0.15, -0.025]} rotation={[-0.22, 0, 0]}>
                  <boxGeometry args={[0.028, 0.24, 0.016]} />
                </mesh>
                <mesh material={mats.glow} position={[0, -0.15, -0.034]} rotation={[-0.22, 0, 0]}>
                  <boxGeometry args={[0.012, 0.19, 0.008]} />
                </mesh>
              </group>
              <group ref={skirtRefs[1]} position={[-0.12, 0.01, -0.13]}>
                <mesh
                  geometry={geos.skirtSide}
                  material={mats.plateLight}
                  position={[0, -0.03, 0]}
                  rotation={[-0.16, 0.55, 0.1]}
                  castShadow
                  receiveShadow
                />
              </group>
              <group ref={skirtRefs[2]} position={[0.12, 0.01, -0.13]}>
                <mesh
                  geometry={geos.skirtSide}
                  material={mats.plateLight}
                  position={[0, -0.03, 0]}
                  rotation={[-0.16, -0.55, -0.1]}
                  castShadow
                  receiveShadow
                />
              </group>
              <group ref={skirtRefs[3]} position={[-0.185, 0.0, 0.0]}>
                <mesh
                  geometry={geos.skirtSide}
                  material={mats.plateDark}
                  position={[0, -0.03, 0]}
                  rotation={[0, 1.35, 0.16]}
                  castShadow
                  receiveShadow
                />
              </group>
              <group ref={skirtRefs[4]} position={[0.185, 0.0, 0.0]}>
                <mesh
                  geometry={geos.skirtSide}
                  material={mats.plateDark}
                  position={[0, -0.03, 0]}
                  rotation={[0, -1.35, -0.16]}
                  castShadow
                  receiveShadow
                />
              </group>
              <group ref={skirtRefs[5]} position={[0, 0.01, 0.145]}>
                <mesh
                  geometry={geos.skirtFront}
                  material={mats.plateDark}
                  position={[0, -0.03, 0]}
                  rotation={[0.2, 0, 0]}
                  castShadow
                  receiveShadow
                />
              </group>

              {/* [character-art R3] hip blades — carry the waist outward so the
                  pelvis is not the narrowest point of the outline */}
              <mesh
                geometry={geos.hipBlade}
                material={mats.plateLight}
                position={[-0.198, 0.045, -0.03]}
                rotation={[0, 2.35, -0.52]}
                castShadow
                receiveShadow
              />
              <mesh
                geometry={geos.hipBlade}
                material={mats.plateLight}
                position={[0.198, 0.045, -0.03]}
                rotation={[0, 0.79, -0.52]}
                castShadow
                receiveShadow
              />
              {/* scabbard socket — read by combat/ViewModel.tsx (DO NOT REMOVE) */}
              <group ref={hipSocket} position={[-0.21, -0.03, -0.05]} rotation={[0, 0, 0.3]} />

              {/* ================= torso (spine pivot) ================= */}
              <group ref={torso} name="j_torso">
                {/* tapered undersuit core: narrow waist → broad chest */}
                <mesh material={mats.suit} position={[0, 0.14, 0]} scale={[1, 1, 0.74]} castShadow>
                  <cylinderGeometry args={[0.125, 0.1, 0.26, 14]} />
                </mesh>
                <mesh material={mats.suit} position={[0, 0.36, 0]} scale={[1.08, 1, 0.74]} castShadow>
                  <capsuleGeometry args={[0.16, 0.28, 4, 14]} />
                </mesh>

                {/* ---- FRONT: three overlapping shell plates ---- */}
                {/* [R2] every hero plate now carries an ~8 mm EDGE LIP: a
                    slightly larger dark shell behind it, so the plate boundary
                    is a modelled step that catches the key instead of a texture
                    line that vanishes at 10 m */}
                <mesh
                  geometry={geos.plateUpper}
                  material={mats.trimDark}
                  position={[0, 0.474, 0.047]}
                  rotation-x={0.2}
                  scale={1.055}
                  castShadow
                  receiveShadow
                />
                <mesh
                  geometry={geos.plateUpper}
                  material={mats.plateLight}
                  position={[0, 0.475, 0.055]}
                  rotation-x={0.2}
                  castShadow
                  receiveShadow
                />
                <mesh
                  geometry={geos.plateMid}
                  material={mats.trimDark}
                  position={[0, 0.349, 0.054]}
                  rotation-x={0.32}
                  scale={1.06}
                  castShadow
                  receiveShadow
                />
                <mesh
                  geometry={geos.plateMid}
                  material={mats.plateLight}
                  position={[0, 0.35, 0.062]}
                  rotation-x={0.32}
                  castShadow
                  receiveShadow
                />
                <mesh
                  geometry={geos.plateLow}
                  material={mats.plateDark}
                  position={[0, 0.225, 0.052]}
                  rotation-x={0.46}
                  castShadow
                  receiveShadow
                />
                {/* raised central crest — the chest's hero line */}
                <mesh
                  geometry={geos.crestRidge}
                  material={mats.trim}
                  position={[0, 0.52, 0.135]}
                  rotation-x={0.16}
                  castShadow
                />
                {/* crest energy channel, recessed inside the ridge */}
                <mesh material={mats.glowCore} position={[0, 0.4, 0.162]} rotation-x={0.16}>
                  <boxGeometry args={[0.022, 0.2, 0.012]} />
                </mesh>
                <mesh material={mats.glow} position={[0, 0.4, 0.158]} rotation-x={0.16}>
                  <boxGeometry args={[0.05, 0.22, 0.01]} />
                </mesh>
                {/* gold chevron seams between plates */}
                <mesh material={mats.trim} position={[0, 0.418, 0.148]} rotation-x={-0.14}>
                  <boxGeometry args={[0.2, 0.026, 0.018]} />
                </mesh>
                <mesh material={mats.trim} position={[0, 0.295, 0.14]} rotation-x={-0.06}>
                  <boxGeometry args={[0.15, 0.022, 0.018]} />
                </mesh>

                {/* ---- BACK: authored at parity with the front ---- */}
                <mesh
                  geometry={geos.backUpper}
                  material={mats.trimDark}
                  position={[0, 0.469, -0.054]}
                  rotation={[-0.16, Math.PI, 0]}
                  scale={1.055}
                  castShadow
                  receiveShadow
                />
                <mesh
                  geometry={geos.backUpper}
                  material={mats.plateLight}
                  position={[0, 0.47, -0.062]}
                  rotation={[-0.16, Math.PI, 0]}
                  castShadow
                  receiveShadow
                />
                <mesh
                  geometry={geos.backMid}
                  material={mats.plateDark}
                  position={[0, 0.315, -0.058]}
                  rotation={[-0.3, Math.PI, 0]}
                  castShadow
                  receiveShadow
                />
                {/* extruded gold spine keel */}
                <mesh
                  geometry={geos.keel}
                  material={mats.trim}
                  position={[0, 0.56, -0.145]}
                  rotation={[0.1, Math.PI, 0]}
                  castShadow
                />
                {/* [character-art R3] ONE continuous emissive route, lofted as
                    a tube down the thoracic/lumbar curve and FORKING to both
                    pauldron cowls, so the light describes the back's form
                    instead of being two stacked boxes in a recess. */}
                <mesh geometry={geos.spineRoute} material={mats.glow} />
                <mesh geometry={geos.spineRouteCore} material={mats.glowCore} />
                <mesh geometry={geos.forkL} material={mats.glow} />
                <mesh geometry={geos.forkR} material={mats.glow} />
                {/* scapular pauldron backs */}
                <mesh
                  geometry={geos.lameB}
                  material={mats.plateDark}
                  position={[-0.185, 0.5, -0.09]}
                  rotation={[-0.5, 0, 0.22]}
                  scale={[0.86, 0.9, 0.8]}
                  castShadow
                />
                <mesh
                  geometry={geos.lameB}
                  material={mats.plateDark}
                  position={[0.185, 0.5, -0.09]}
                  rotation={[-0.5, 0, -0.22]}
                  scale={[0.86, 0.9, 0.8]}
                  castShadow
                />
                {/* rear trim ribs — panel breakup the camera actually sees */}
                <mesh material={mats.trim} position={[-0.1, 0.24, -0.135]} rotation-z={0.35}>
                  <boxGeometry args={[0.13, 0.02, 0.014]} />
                </mesh>
                <mesh material={mats.trim} position={[0.1, 0.24, -0.135]} rotation-z={-0.35}>
                  <boxGeometry args={[0.13, 0.02, 0.014]} />
                </mesh>
                {/* [R2] NAPE NODE — the origin of the one continuous emissive
                    route (nape → spine → sacrum, forking to cowls/forearms/shins) */}
                <mesh material={mats.trimDark} position={[0, 0.6, -0.105]} castShadow>
                  <sphereGeometry args={[0.042, 14, 10]} />
                </mesh>
                <mesh material={mats.glowCore} position={[0, 0.6, -0.128]}>
                  <sphereGeometry args={[0.022, 12, 8]} />
                </mesh>
                {/* [R2] wide soft falloff card behind the spine keel — the third
                    emissive layer, so the channel has a halo and not just a line */}
                <mesh material={mats.glowSoft} position={[0, 0.4, -0.222]}>
                  <planeGeometry args={[0.2, 0.68]} />
                </mesh>
                {/* [R2] scarf anchors, parented into the torso (weakness P7) */}
                <group ref={scarfAnchorL} position={[-0.105, 0.565, -0.115]} />
                <group ref={scarfAnchorR} position={[0.085, 0.575, -0.135]} />

                {/* ---- armoured gorget filling the head-to-shoulder void ---- */}
                <mesh
                  geometry={geos.gorget}
                  material={mats.plateDark}
                  position={[0, 0.552, 0.005]}
                  castShadow
                  receiveShadow
                />
                <mesh
                  geometry={geos.gorget}
                  material={mats.trim}
                  position={[0, 0.6, 0.005]}
                  scale={[0.84, 0.4, 0.84]}
                  castShadow
                />
                {/* short armoured neck */}
                <mesh material={mats.suit} position={[0, 0.655, -0.005]} castShadow>
                  <cylinderGeometry args={[0.062, 0.072, 0.12, 12]} />
                </mesh>

                {/* ---- LEFT pauldron: heavy 4-lame stack under a projecting
                        cowl. [R2] The r2 silhouette read as a mannequin because
                        the shoulders sat inside the torso width; the cowl now
                        projects ~1.45× the upper-arm width past the deltoid and
                        hangs over it, which is the Warframe read at distance. ---- */}
                <mesh
                  geometry={geos.cowl}
                  material={mats.trim}
                  position={[-0.235, 0.552, -0.005]}
                  rotation={[0.06, 0, 0.3]}
                  castShadow
                  receiveShadow
                />
                <mesh
                  geometry={geos.lameA}
                  material={mats.plateLight}
                  position={[-0.205, 0.525, 0.008]}
                  rotation-z={0.24}
                  scale={[1.12, 1.05, 1.08]}
                  castShadow
                  receiveShadow
                />
                <mesh
                  geometry={geos.lameB}
                  material={mats.plateDark}
                  position={[-0.243, 0.468, 0.006]}
                  rotation-z={0.42}
                  scale={[1.12, 1.05, 1.06]}
                  castShadow
                  receiveShadow
                />
                <mesh
                  geometry={geos.lameC}
                  material={mats.plateDark}
                  position={[-0.272, 0.408, 0.006]}
                  rotation-z={0.56}
                  scale={[1.1, 1.0, 1.04]}
                  castShadow
                  receiveShadow
                />
                {/* cowl edge trim + leading-edge energy fork of the spine route */}
                {/* [character-art R3] rear-swept pauldron WING — the single
                    biggest outline breaker on the frame; the r2 shoulders ended
                    at the cowl and the silhouette closed back into the torso */}
                <mesh
                  geometry={geos.wingL}
                  material={mats.plateLight}
                  position={[-0.252, 0.578, -0.028]}
                  rotation={[0, 2.5, 0.26]}
                  castShadow
                  receiveShadow
                />
                <mesh
                  geometry={geos.wingL}
                  material={mats.trim}
                  position={[-0.252, 0.578, -0.028]}
                  rotation={[0, 2.5, 0.26]}
                  scale={[1.0, 0.42, 0.7]}
                  castShadow
                  receiveShadow
                />
                <mesh material={mats.trim} position={[-0.318, 0.548, 0.0]} rotation={[0, 0, 0.32]} castShadow>
                  <boxGeometry args={[0.034, 0.06, 0.2]} />
                </mesh>
                <mesh material={mats.glow} position={[-0.322, 0.556, 0.052]} rotation={[0, 0.16, 0.32]}>
                  <boxGeometry args={[0.02, 0.024, 0.13]} />
                </mesh>
                <mesh material={mats.glowCore} position={[-0.325, 0.558, 0.052]} rotation={[0, 0.16, 0.32]}>
                  <boxGeometry args={[0.012, 0.012, 0.1]} />
                </mesh>
                <mesh
                  material={mats.glowSoft}
                  position={[-0.33, 0.556, 0.052]}
                  rotation={[0, Math.PI / 2, 0.32]}
                >
                  <planeGeometry args={[0.2, 0.09]} />
                </mesh>

                {/* ---- RIGHT pauldron: lighter cowl, fewer lames (asymmetry) ---- */}
                <mesh
                  geometry={geos.cowl}
                  material={mats.plateLight}
                  position={[0.232, 0.548, -0.005]}
                  rotation={[0.06, 0, -0.28]}
                  scale={[0.94, 0.92, 0.96]}
                  castShadow
                  receiveShadow
                />
                <mesh
                  geometry={geos.capA}
                  material={mats.plateLight}
                  position={[0.208, 0.518, 0.008]}
                  rotation-z={-0.22}
                  scale={[1.1, 1.05, 1.06]}
                  castShadow
                  receiveShadow
                />
                <mesh
                  geometry={geos.capB}
                  material={mats.plateDark}
                  position={[0.244, 0.462, 0.006]}
                  rotation-z={-0.38}
                  scale={[1.1, 1.0, 1.04]}
                  castShadow
                  receiveShadow
                />
                <mesh
                  geometry={geos.wingR}
                  material={mats.plateDark}
                  position={[0.244, 0.568, -0.028]}
                  rotation={[0, 0.64, 0.24]}
                  castShadow
                  receiveShadow
                />
                <mesh material={mats.trim} position={[0.296, 0.522, 0.02]} rotation-z={-0.34} castShadow>
                  <boxGeometry args={[0.026, 0.11, 0.16]} />
                </mesh>
                <mesh material={mats.glow} position={[0.3, 0.548, 0.048]} rotation={[0, -0.16, -0.3]}>
                  <boxGeometry args={[0.018, 0.02, 0.11]} />
                </mesh>

                {/* ================= head ================= */}
                {/* [R2] helmet scaled ~1.18× and SEATED INTO the gorget so the
                    neck void is closed; the head now has a front (recessed visor
                    slot, asymmetric vents) rather than reading as a smooth egg */}
                <group ref={head} name="j_head" position={[0, 0.715, 0]}>
                  <group scale={0.873}>
                    <mesh
                      geometry={geos.helmet}
                      material={mats.plateDark}
                      position={[0, 0.02, 0.01]}
                      castShadow
                      receiveShadow
                    />
                    {/* narrow gold eye-slit, two angled segments on the wedge face */}
                    <mesh
                      material={mats.glow}
                      position={[-0.052, -0.012, 0.152]}
                      rotation={[0.06, 0.38, -0.07]}
                    >
                      <boxGeometry args={[0.095, 0.018, 0.012]} />
                    </mesh>
                    <mesh
                      material={mats.glow}
                      position={[0.052, -0.012, 0.152]}
                      rotation={[0.06, -0.38, 0.07]}
                    >
                      <boxGeometry args={[0.095, 0.018, 0.012]} />
                    </mesh>
                    <mesh material={mats.glowCore} position={[0, -0.014, 0.158]}>
                      <boxGeometry args={[0.03, 0.01, 0.01]} />
                    </mesh>
                    {/* crest fin sweeping back */}
                    <mesh
                      geometry={geos.crest}
                      material={mats.trim}
                      position={[0, 0.14, 0.02]}
                      castShadow
                    />
                    {/* cheek / jaw armour */}
                    <mesh
                      material={mats.trim}
                      position={[-0.1, -0.06, 0.06]}
                      rotation={[0.1, 0.3, 0.2]}
                      castShadow
                      receiveShadow
                    >
                      <boxGeometry args={[0.03, 0.12, 0.1]} />
                    </mesh>
                    <mesh
                      material={mats.trim}
                      position={[0.1, -0.06, 0.06]}
                      rotation={[0.1, -0.3, -0.2]}
                      castShadow
                      receiveShadow
                    >
                      <boxGeometry args={[0.03, 0.12, 0.1]} />
                    </mesh>
                    {/* [R2] recessed visor brow — a dark lintel over the slit so
                        the eye line is a SLOT in the form, not a decal on it */}
                    <mesh
                      material={mats.suit}
                      position={[0, 0.026, 0.138]}
                      rotation-x={-0.22}
                      castShadow
                      receiveShadow
                    >
                      <boxGeometry args={[0.2, 0.05, 0.05]} />
                    </mesh>
                    {/* soft falloff behind the slit (third emissive layer) */}
                    <mesh material={mats.glowSoft} position={[0, -0.012, 0.164]}>
                      <planeGeometry args={[0.26, 0.09]} />
                    </mesh>
                    {/* [R2] ASYMMETRIC vents — the head reads left from right */}
                    <mesh
                      material={mats.trimDark}
                      position={[-0.104, 0.055, -0.03]}
                      rotation={[0.1, 0.5, 0.32]}
                      castShadow
                      receiveShadow
                    >
                      <boxGeometry args={[0.018, 0.028, 0.12]} />
                    </mesh>
                    <mesh
                      material={mats.trimDark}
                      position={[-0.104, 0.012, -0.05]}
                      rotation={[0.1, 0.5, 0.32]}
                      castShadow
                      receiveShadow
                    >
                      <boxGeometry args={[0.018, 0.022, 0.09]} />
                    </mesh>
                    <mesh
                      material={mats.trim}
                      position={[0.108, 0.038, -0.04]}
                      rotation={[0.1, -0.44, -0.26]}
                      castShadow
                      receiveShadow
                    >
                      <boxGeometry args={[0.02, 0.09, 0.13]} />
                    </mesh>
                    <mesh material={mats.glow} position={[0.118, 0.038, -0.04]} rotation={[0.1, -0.44, -0.26]}>
                      <boxGeometry args={[0.008, 0.05, 0.08]} />
                    </mesh>
                  </group>
                </group>

                {/* ================= arms ================= */}
                <group ref={shoulderL} name="j_shL" position={[-SHOULDER_X, 0.5, 0]}>
                  <mesh
                    geometry={geos.bevelShoulder}
                    material={mats.trim}
                    position={[0, -0.012, 0]}
                    castShadow
                  />
                  {/* undersuit upper arm */}
                  <mesh material={mats.suit} position={[0, -0.15, 0]} scale={[1, 1, 0.86]} castShadow>
                    <capsuleGeometry args={[0.056, 0.2, 4, 10]} />
                  </mesh>
                  {/* upper-arm armour shell */}
                  {/* [R2] the shell runs 15% PAST the elbow pivot so the joint
                      never opens a gap, and a dark under-suit tube at 0.72× the
                      plate radius fills what is left */}
                  <mesh
                    geometry={geos.upperArmPlate}
                    material={mats.plateDark}
                    position={[0, -0.175, 0]}
                    scale={[1.04, 1.55, 0.94]}
                    castShadow
                    receiveShadow
                  />
                  <mesh
                    geometry={geos.jointTubeArm}
                    material={mats.suit}
                    position={[0, -0.3, 0]}
                    castShadow
                    receiveShadow
                  />
                  <mesh material={mats.trim} position={[-0.075, -0.15, 0]} rotation-z={0.03}>
                    <boxGeometry args={[0.028, 0.2, 0.06]} />
                  </mesh>
                  <group ref={elbowL} name="j_elL" position={[0, -0.3, 0]}>
                    {/* [R2] two-piece joint cowl + recessed piston band */}
                    <mesh
                      geometry={geos.elbowCowl}
                      material={mats.plateDark}
                      position={[0, 0.012, 0.006]}
                      castShadow
                      receiveShadow
                    />
                    <mesh
                      geometry={geos.elbowCap}
                      material={mats.trim}
                      position={[0, -0.028, 0.026]}
                      scale={[0.86, 0.72, 0.9]}
                      castShadow
                      receiveShadow
                    />
                    {/* [character-art R3] elbow spur — reads on every arm swing */}
                    <mesh
                      geometry={geos.elbowSpur}
                      material={mats.plateLight}
                      position={[0, -0.006, -0.05]}
                      rotation={[0, Math.PI / 2, -0.42]}
                      castShadow
                      receiveShadow
                    />
                    {/* lamellar cuff over the forearm rim */}
                    <mesh
                      geometry={geos.cuffArm}
                      material={mats.plateLight}
                      position={[0, -0.042, 0]}
                      castShadow
                      receiveShadow
                    />
                    <mesh
                      geometry={geos.pistonBand}
                      material={mats.trimDark}
                      position={[0, -0.006, 0]}
                      scale={[0.86, 1, 0.86]}
                      castShadow
                      receiveShadow
                    />
                    <mesh material={mats.suit} position={[0, -0.13, 0]} scale={[1, 1, 0.82]} castShadow>
                      <capsuleGeometry args={[0.05, 0.18, 4, 10]} />
                    </mesh>
                    <mesh
                      geometry={geos.foreArmPlate}
                      material={mats.plateDark}
                      position={[0, -0.15, 0]}
                      scale={[1.04, 1.35, 0.94]}
                      castShadow
                      receiveShadow
                    />
                    {/* gauntlet blade fin */}
                    <mesh material={mats.trim} position={[-0.062, -0.13, -0.012]} castShadow>
                      <boxGeometry args={[0.024, 0.17, 0.07]} />
                    </mesh>
                    {/* [character-art R3] the forearm FORK of the continuous
                        emissive route, lofted along the limb — the isolated
                        0.07 m pip it replaces read as a sticker */}
                    <mesh geometry={geos.routeForeArm} material={mats.glow} />
                    <mesh geometry={geos.routeForeArmCore} material={mats.glowCore} />
                    {/* ---- wrist pivot + wrapped fist ---- */}
                    <group ref={wristL} position={[0, -0.27, 0]}>
                      {/* [R2] ~0.09 m GAUNTLET — the 0.055 m fist sphere read as
                          a stump at any distance. Palm block, four fused finger
                          plates and an opposed thumb, so the frame has a hand. */}
                      <mesh geometry={geos.bevelWrist} material={mats.trim} castShadow receiveShadow />
                      <mesh
                        geometry={geos.gauntlet}
                        material={mats.plateDark}
                        position={[0, -0.072, 0.004]}
                        castShadow
                        receiveShadow
                      />
                      {[-0.033, -0.011, 0.011, 0.033].map((fx, fi) => (
                        <mesh
                          key={fi}
                          geometry={geos.finger}
                          material={mats.plateLight}
                          position={[fx, -0.128, 0.012 + Math.abs(fx) * -0.12]}
                          rotation={[0.55 - Math.abs(fx) * 1.2, 0, fx * 1.1]}
                          castShadow
                          receiveShadow
                        />
                      ))}
                      <mesh
                        geometry={geos.finger}
                        material={mats.plateLight}
                        position={[0.046, -0.082, 0.038]}
                        rotation={[1.15, 0.2, -0.85]}
                        scale={[1, 0.86, 1]}
                        castShadow
                        receiveShadow
                      />
                      {/* knuckle guard + a fork of the emissive route */}
                      <mesh material={mats.trim} position={[0, -0.108, 0.036]} rotation-x={0.22} castShadow receiveShadow>
                        <boxGeometry args={[0.092, 0.03, 0.026]} />
                      </mesh>
                      <mesh material={mats.glow} position={[0, -0.108, 0.05]} rotation-x={0.22}>
                        <boxGeometry args={[0.062, 0.01, 0.008]} />
                      </mesh>
                      <group ref={handSocketL} position={[0, -0.075, 0.03]} />
                    </group>
                  </group>
                </group>

                <group ref={shoulderR} name="j_shR" position={[SHOULDER_X, 0.5, 0]}>
                  <mesh
                    geometry={geos.bevelShoulder}
                    material={mats.trim}
                    position={[0, -0.012, 0]}
                    castShadow
                  />
                  <mesh material={mats.suit} position={[0, -0.15, 0]} scale={[1, 1, 0.86]} castShadow>
                    <capsuleGeometry args={[0.056, 0.2, 4, 10]} />
                  </mesh>
                  {/* [R2] the shell runs 15% PAST the elbow pivot so the joint
                      never opens a gap, and a dark under-suit tube at 0.72× the
                      plate radius fills what is left */}
                  <mesh
                    geometry={geos.upperArmPlate}
                    material={mats.plateDark}
                    position={[0, -0.175, 0]}
                    scale={[1.04, 1.55, 0.94]}
                    castShadow
                    receiveShadow
                  />
                  <mesh
                    geometry={geos.jointTubeArm}
                    material={mats.suit}
                    position={[0, -0.3, 0]}
                    castShadow
                    receiveShadow
                  />
                  <mesh material={mats.trim} position={[0.075, -0.15, 0]} rotation-z={-0.03}>
                    <boxGeometry args={[0.028, 0.2, 0.06]} />
                  </mesh>
                  <group ref={elbowR} name="j_elR" position={[0, -0.3, 0]}>
                    {/* [R2] two-piece joint cowl + recessed piston band */}
                    <mesh
                      geometry={geos.elbowCowl}
                      material={mats.plateDark}
                      position={[0, 0.012, 0.006]}
                      castShadow
                      receiveShadow
                    />
                    <mesh
                      geometry={geos.elbowCap}
                      material={mats.trim}
                      position={[0, -0.028, 0.026]}
                      scale={[0.86, 0.72, 0.9]}
                      castShadow
                      receiveShadow
                    />
                    {/* [character-art R3] elbow spur — reads on every arm swing */}
                    <mesh
                      geometry={geos.elbowSpur}
                      material={mats.plateLight}
                      position={[0, -0.006, -0.05]}
                      rotation={[0, Math.PI / 2, -0.42]}
                      castShadow
                      receiveShadow
                    />
                    {/* lamellar cuff over the forearm rim */}
                    <mesh
                      geometry={geos.cuffArm}
                      material={mats.plateLight}
                      position={[0, -0.042, 0]}
                      castShadow
                      receiveShadow
                    />
                    <mesh
                      geometry={geos.pistonBand}
                      material={mats.trimDark}
                      position={[0, -0.006, 0]}
                      scale={[0.86, 1, 0.86]}
                      castShadow
                      receiveShadow
                    />
                    <mesh material={mats.suit} position={[0, -0.13, 0]} scale={[1, 1, 0.82]} castShadow>
                      <capsuleGeometry args={[0.05, 0.18, 4, 10]} />
                    </mesh>
                    <mesh
                      geometry={geos.foreArmPlate}
                      material={mats.plateDark}
                      position={[0, -0.15, 0]}
                      scale={[1.04, 1.35, 0.94]}
                      castShadow
                      receiveShadow
                    />
                    <mesh material={mats.trim} position={[0.062, -0.13, -0.012]} castShadow>
                      <boxGeometry args={[0.024, 0.17, 0.07]} />
                    </mesh>
                    <mesh geometry={geos.routeForeArm} material={mats.glow} />
                    <mesh geometry={geos.routeForeArmCore} material={mats.glowCore} />
                    <group ref={wristR} position={[0, -0.27, 0]}>
                      {/* [R2] ~0.09 m GAUNTLET — the 0.055 m fist sphere read as
                          a stump at any distance. Palm block, four fused finger
                          plates and an opposed thumb, so the frame has a hand. */}
                      <mesh geometry={geos.bevelWrist} material={mats.trim} castShadow receiveShadow />
                      <mesh
                        geometry={geos.gauntlet}
                        material={mats.plateDark}
                        position={[0, -0.072, 0.004]}
                        castShadow
                        receiveShadow
                      />
                      {[-0.033, -0.011, 0.011, 0.033].map((fx, fi) => (
                        <mesh
                          key={fi}
                          geometry={geos.finger}
                          material={mats.plateLight}
                          position={[fx, -0.128, 0.012 + Math.abs(fx) * -0.12]}
                          rotation={[0.55 - Math.abs(fx) * 1.2, 0, fx * 1.1]}
                          castShadow
                          receiveShadow
                        />
                      ))}
                      <mesh
                        geometry={geos.finger}
                        material={mats.plateLight}
                        position={[0.046, -0.082, 0.038]}
                        rotation={[1.15, 0.2, -0.85]}
                        scale={[1, 0.86, 1]}
                        castShadow
                        receiveShadow
                      />
                      {/* knuckle guard + a fork of the emissive route */}
                      <mesh material={mats.trim} position={[0, -0.108, 0.036]} rotation-x={0.22} castShadow receiveShadow>
                        <boxGeometry args={[0.092, 0.03, 0.026]} />
                      </mesh>
                      <mesh material={mats.glow} position={[0, -0.108, 0.05]} rotation-x={0.22}>
                        <boxGeometry args={[0.062, 0.01, 0.008]} />
                      </mesh>
                      {/* weapon grip socket — read by combat/ViewModel.tsx (DO NOT REMOVE) */}
                      <group ref={handSocketR} position={[0, -0.075, 0.03]} />
                    </group>
                  </group>
                </group>
              </group>
            </group>

            {/* ================= legs ================= */}
            <group ref={legL} name="j_legL" position={[-HIP_X, PELVIS_Y, 0]}>
              <mesh geometry={geos.bevelHip} material={mats.trim} position={[0, -0.03, 0]} scale={[0.72, 0.8, 0.72]} castShadow />
              <mesh material={mats.suit} position={[0, -0.2, 0]} scale={[1, 1, 0.86]} castShadow>
                <capsuleGeometry args={[0.085, 0.26, 4, 10]} />
              </mesh>
              {/* thigh armour shell (~40% over limb diameter) */}
              <mesh
                geometry={geos.thighPlate}
                material={mats.plateDark}
                position={[0, -0.245, 0]}
                scale={[1.04, 1.42, 0.92]}
                castShadow
                receiveShadow
              />
              <mesh
                geometry={geos.jointTubeLeg}
                material={mats.suit}
                position={[0, -0.45, 0]}
                castShadow
                receiveShadow
              />
              <mesh material={mats.trim} position={[-0.105, -0.2, 0.01]} castShadow>
                <boxGeometry args={[0.03, 0.24, 0.08]} />
              </mesh>
              <mesh material={mats.glow} position={[-0.108, -0.2, -0.05]}>
                <boxGeometry args={[0.014, 0.18, 0.016]} />
              </mesh>
              <group ref={kneeL} name="j_knL" position={[0, -0.45, 0]}>
                <mesh
                  geometry={geos.kneeCowl}
                  material={mats.plateDark}
                  position={[0, 0.016, 0.004]}
                  castShadow
                  receiveShadow
                />
                <mesh geometry={geos.bevelKnee} material={mats.trimDark} position={[0, -0.02, 0]} castShadow receiveShadow />
                <mesh
                  geometry={geos.kneeCap}
                  material={mats.trim}
                  position={[0, -0.032, 0.056]}
                  scale={[0.84, 0.74, 0.7]}
                  castShadow
                  receiveShadow
                />
                {/* [character-art R3] knee spur + calf fin — the outline
                    breakers. Without these the leg is a tube and the flat-black
                    silhouette test returns a person-shaped blob. */}
                <mesh
                  geometry={geos.kneeSpur}
                  material={mats.plateLight}
                  position={[0, -0.012, 0.062]}
                  rotation={[0, -Math.PI / 2, -0.52]}
                  castShadow
                  receiveShadow
                />
                <mesh
                  geometry={geos.calfFin}
                  material={mats.plateDark}
                  position={[0, -0.16, -0.062]}
                  rotation={[0, Math.PI / 2, -0.62]}
                  castShadow
                  receiveShadow
                />
                {/* stacked lamellar cuff: overlaps the greave rim, dark suit
                    visible in the gap instead of a butt joint */}
                <mesh
                  geometry={geos.cuffLeg}
                  material={mats.plateDark}
                  position={[0, -0.062, 0]}
                  castShadow
                  receiveShadow
                />
                <mesh material={mats.suit} position={[0, -0.2, 0]} scale={[1, 1, 0.84]} castShadow>
                  <capsuleGeometry args={[0.07, 0.24, 4, 10]} />
                </mesh>
                {/* greave shell */}
                <mesh
                  geometry={geos.shinPlate}
                  material={mats.plateLight}
                  position={[0, -0.235, 0]}
                  scale={[1.04, 1.35, 0.92]}
                  castShadow
                  receiveShadow
                />
                <mesh material={mats.trim} position={[-0.09, -0.21, 0]} castShadow receiveShadow>
                  <boxGeometry args={[0.03, 0.3, 0.075]} />
                </mesh>
                {/* [R2] outer-shin fork of the emissive route (thigh → shin) */}
                <mesh material={mats.glow} position={[-0.101, -0.21, -0.022]}>
                  <boxGeometry args={[0.012, 0.22, 0.014]} />
                </mesh>
                {/* [character-art R3] rear shin fork of the continuous route */}
                <mesh geometry={geos.routeShin} material={mats.glow} />
                <mesh material={mats.glowCore} position={[-0.105, -0.21, -0.022]}>
                  <boxGeometry args={[0.006, 0.17, 0.008]} />
                </mesh>
                <group ref={ankleL} position={[0, -0.4, 0]}>
                  <mesh geometry={geos.bevelAnkle} material={mats.trimDark} castShadow />
                  <mesh material={mats.glow} position={[0, 0.012, 0]}>
                    <cylinderGeometry args={[0.079, 0.079, 0.016, 16]} />
                  </mesh>
                  <mesh
                    geometry={geos.boot}
                    material={mats.plateLight}
                    position={[0, -0.1, -0.03]}
                    castShadow
                    receiveShadow
                  />
                  {/* [character-art R3] heel spur + toe claw */}
                  <mesh
                    geometry={geos.heelSpur}
                    material={mats.plateDark}
                    position={[0, -0.072, -0.082]}
                    rotation={[0, Math.PI / 2, -0.28]}
                    castShadow
                    receiveShadow
                  />
                  <mesh
                    geometry={geos.toeClaw}
                    material={mats.trim}
                    position={[0, -0.148, 0.115]}
                    rotation={[0, -Math.PI / 2, -0.22]}
                    castShadow
                    receiveShadow
                  />
                  <mesh material={mats.trim} position={[0, -0.055, 0.06]} rotation-x={0.3} castShadow>
                    <boxGeometry args={[0.1, 0.03, 0.09]} />
                  </mesh>
                </group>
              </group>
            </group>

            <group ref={legR} name="j_legR" position={[HIP_X, PELVIS_Y, 0]}>
              <mesh geometry={geos.bevelHip} material={mats.trim} position={[0, -0.03, 0]} scale={[0.72, 0.8, 0.72]} castShadow />
              <mesh material={mats.suit} position={[0, -0.2, 0]} scale={[1, 1, 0.86]} castShadow>
                <capsuleGeometry args={[0.085, 0.26, 4, 10]} />
              </mesh>
              <mesh
                geometry={geos.thighPlate}
                material={mats.plateDark}
                position={[0, -0.245, 0]}
                scale={[1.04, 1.42, 0.92]}
                castShadow
                receiveShadow
              />
              <mesh
                geometry={geos.jointTubeLeg}
                material={mats.suit}
                position={[0, -0.45, 0]}
                castShadow
                receiveShadow
              />
              <mesh material={mats.trim} position={[0.105, -0.2, 0.01]} castShadow>
                <boxGeometry args={[0.03, 0.24, 0.08]} />
              </mesh>
              <mesh material={mats.glow} position={[0.108, -0.2, -0.05]}>
                <boxGeometry args={[0.014, 0.18, 0.016]} />
              </mesh>
              <group ref={kneeR} name="j_knR" position={[0, -0.45, 0]}>
                <mesh
                  geometry={geos.kneeCowl}
                  material={mats.plateDark}
                  position={[0, 0.016, 0.004]}
                  castShadow
                  receiveShadow
                />
                <mesh geometry={geos.bevelKnee} material={mats.trimDark} position={[0, -0.02, 0]} castShadow receiveShadow />
                <mesh
                  geometry={geos.kneeCap}
                  material={mats.trim}
                  position={[0, -0.032, 0.056]}
                  scale={[0.84, 0.74, 0.7]}
                  castShadow
                  receiveShadow
                />
                {/* [character-art R3] knee spur + calf fin — the outline
                    breakers. Without these the leg is a tube and the flat-black
                    silhouette test returns a person-shaped blob. */}
                <mesh
                  geometry={geos.kneeSpur}
                  material={mats.plateLight}
                  position={[0, -0.012, 0.062]}
                  rotation={[0, -Math.PI / 2, -0.52]}
                  castShadow
                  receiveShadow
                />
                <mesh
                  geometry={geos.calfFin}
                  material={mats.plateDark}
                  position={[0, -0.16, -0.062]}
                  rotation={[0, Math.PI / 2, -0.62]}
                  castShadow
                  receiveShadow
                />
                {/* stacked lamellar cuff: overlaps the greave rim, dark suit
                    visible in the gap instead of a butt joint */}
                <mesh
                  geometry={geos.cuffLeg}
                  material={mats.plateDark}
                  position={[0, -0.062, 0]}
                  castShadow
                  receiveShadow
                />
                <mesh material={mats.suit} position={[0, -0.2, 0]} scale={[1, 1, 0.84]} castShadow>
                  <capsuleGeometry args={[0.07, 0.24, 4, 10]} />
                </mesh>
                <mesh
                  geometry={geos.shinPlate}
                  material={mats.plateLight}
                  position={[0, -0.235, 0]}
                  scale={[1.04, 1.35, 0.92]}
                  castShadow
                  receiveShadow
                />
                <mesh material={mats.trim} position={[0.09, -0.21, 0]} castShadow receiveShadow>
                  <boxGeometry args={[0.03, 0.3, 0.075]} />
                </mesh>
                <mesh material={mats.glow} position={[0.101, -0.21, -0.022]}>
                  <boxGeometry args={[0.012, 0.22, 0.014]} />
                </mesh>
                <mesh geometry={geos.routeShin} material={mats.glow} />
                <mesh material={mats.glowCore} position={[0.105, -0.21, -0.022]}>
                  <boxGeometry args={[0.006, 0.17, 0.008]} />
                </mesh>
                <group ref={ankleR} position={[0, -0.4, 0]}>
                  <mesh geometry={geos.bevelAnkle} material={mats.trimDark} castShadow />
                  <mesh material={mats.glow} position={[0, 0.012, 0]}>
                    <cylinderGeometry args={[0.079, 0.079, 0.016, 16]} />
                  </mesh>
                  <mesh
                    geometry={geos.boot}
                    material={mats.plateLight}
                    position={[0, -0.1, -0.03]}
                    castShadow
                    receiveShadow
                  />
                  {/* [character-art R3] heel spur + toe claw */}
                  <mesh
                    geometry={geos.heelSpur}
                    material={mats.plateDark}
                    position={[0, -0.072, -0.082]}
                    rotation={[0, Math.PI / 2, -0.28]}
                    castShadow
                    receiveShadow
                  />
                  <mesh
                    geometry={geos.toeClaw}
                    material={mats.trim}
                    position={[0, -0.148, 0.115]}
                    rotation={[0, -Math.PI / 2, -0.22]}
                    castShadow
                    receiveShadow
                  />
                  <mesh material={mats.trim} position={[0, -0.055, 0.06]} rotation-x={0.3} castShadow>
                    <boxGeometry args={[0.1, 0.03, 0.09]} />
                  </mesh>
                </group>
              </group>
            </group>
          </group>

          {/*
            Character light pair (work order #7). Kept OUTSIDE the `rig` group so
            the afterimage clones carry no lights. Short range + decay 2 keeps
            them essentially local to the frame.
          */}
          {/* [player-frame R2] 9.0 / 7.0 → 2.4 / 1.6. The runtime diagnosis
              measured this pair as a large part of the fill that was beating a
              1.58 key, so the frame's own shaded side never went a stop down.
              They are separation now, not illumination. */}
          <pointLight
            position={[-0.5, 0.85, -1.2]}
            color={COLORS.paleHalo}
            intensity={2.4}
            distance={3.4}
            decay={2}
          />
          <pointLight
            position={[0.55, 0.5, 0.95]}
            color={LIGHTING.playerRim.color}
            intensity={1.6}
            distance={3.0}
            decay={2}
          />
        </group>
      </group>

      {/* verlet scarf ribbons (world space) */}
      <primitive object={ribbons[0].mesh} />
      <primitive object={ribbons[1].mesh} />

      {/* lunge afterimage ghosts (posed clones of the rig subtree) */}
      <group ref={ghostGroup} />
    </>
  )
}

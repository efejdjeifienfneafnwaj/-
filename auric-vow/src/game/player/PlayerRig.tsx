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
 */
import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useGameStore } from '../store'
import { COLORS, LIGHTING } from '../config'
import { Input } from '../Input'
import { PlayerRef, PlayerAnim } from './PlayerRef'
import { getCamRoll, getPlayerFade, CamRef } from './CameraRig'
import { ANIM, MOVE } from './movementConfig'

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

/** Chest / back shell plate: flattened dome, bulge toward +Z, opening downward. */
function makeShellPlate(r: number, flat = 0.5): THREE.BufferGeometry {
  const geo = new THREE.SphereGeometry(r, 22, 12, 0, Math.PI * 2, 0, Math.PI * 0.56)
  geo.rotateX(Math.PI / 2)
  geo.scale(1.08, 0.92, flat)
  return geo
}

/** Pauldron lame: wide flattened dome segment (stacks into a layered pauldron). */
function makeLame(r: number, flat = 0.62): THREE.BufferGeometry {
  const geo = new THREE.SphereGeometry(r, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.52)
  geo.scale(1.18, flat, 1.12)
  return geo
}

/** Tapered limb shell — the armour plate that sits OVER an undersuit segment. */
function makeLimbPlate(rTop: number, rBot: number, h: number, seg = 14): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(rTop, rBot, h, seg, 1, false)
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

/** Wrapped fist volume (replaces the hand box). */
function makeFistGeometry(): THREE.BufferGeometry {
  const geo = new THREE.SphereGeometry(0.055, 14, 10)
  geo.scale(0.98, 1.25, 0.86)
  return geo
}

// ---------------------------------------------------------------------------
// verlet scarf ribbon — lit cloth body + emissive tip group (work order #9)
// ---------------------------------------------------------------------------
const SEGS = ANIM.scarf.segments

interface RibbonOpts {
  segLen: number
  gravity: number
  drag: number
  widthMult: number
  zOffset: number
}

class Ribbon {
  points: THREE.Vector3[] = []
  prev: THREE.Vector3[] = []
  mesh: THREE.Mesh
  readonly opts: RibbonOpts
  private posAttr: THREE.BufferAttribute
  private normAttr: THREE.BufferAttribute
  private _t = new THREE.Vector3()
  private _side = new THREE.Vector3()
  private _up = new THREE.Vector3()
  private _view = new THREE.Vector3()
  private _closest = new THREE.Vector3()
  private _d = new THREE.Vector3()

  constructor(opts: RibbonOpts, cloth: THREE.Material, glow: THREE.Material) {
    this.opts = opts
    for (let i = 0; i <= SEGS; i++) {
      this.points.push(new THREE.Vector3(0, 1.5 - i * opts.segLen, 0))
      this.prev.push(this.points[i].clone())
    }
    const geo = new THREE.BufferGeometry()
    const positions = new Float32Array((SEGS + 1) * 2 * 3)
    const normals = new Float32Array((SEGS + 1) * 2 * 3)
    const colors = new Float32Array((SEGS + 1) * 2 * 3)
    const uvs = new Float32Array((SEGS + 1) * 2 * 2)
    // cloth root is a dark charcoal so the emissive tip has somewhere to sit
    const root = new THREE.Color('#1A1A1E')
    const mid = new THREE.Color(COLORS.regalGold).multiplyScalar(0.7)
    const tip = new THREE.Color(COLORS.aureate).multiplyScalar(3.0)
    const c = new THREE.Color()
    const emiStart = SEGS - ANIM.scarf.emissiveSegments
    for (let i = 0; i <= SEGS; i++) {
      const f = i / SEGS
      if (i <= emiStart) c.lerpColors(root, mid, i / Math.max(1, emiStart))
      else c.lerpColors(mid, tip, (i - emiStart) / ANIM.scarf.emissiveSegments)
      for (let s = 0; s < 2; s++) {
        const o = (i * 2 + s) * 3
        colors[o] = c.r
        colors[o + 1] = c.g
        colors[o + 2] = c.b
        normals[o] = 0
        normals[o + 1] = 0
        normals[o + 2] = 1
        uvs[(i * 2 + s) * 2] = s
        uvs[(i * 2 + s) * 2 + 1] = f
      }
    }
    const idx: number[] = []
    for (let i = 0; i < SEGS; i++) {
      const a = i * 2
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
    }
    geo.setIndex(idx)
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
    // two draw groups: lit cloth body, then the emissive last N segments
    geo.addGroup(0, emiStart * 6, 0)
    geo.addGroup(emiStart * 6, (SEGS - emiStart) * 6, 1)
    this.posAttr = geo.getAttribute('position') as THREE.BufferAttribute
    this.normAttr = geo.getAttribute('normal') as THREE.BufferAttribute
    this.mesh = new THREE.Mesh(geo, [cloth, glow])
    this.mesh.frustumCulled = false
    this.mesh.castShadow = false
  }

  reset(anchor: THREE.Vector3) {
    for (let i = 0; i <= SEGS; i++) {
      this.points[i].copy(anchor)
      this.points[i].y -= i * this.opts.segLen
      this.prev[i].copy(this.points[i])
    }
  }

  update(
    dt: number,
    anchor: THREE.Vector3,
    playerPos: THREE.Vector3,
    capsuleRadius: number,
    capsuleHeight: number,
    camPos: THREE.Vector3,
  ) {
    const o = this.opts
    const g = o.gravity
    const drag = o.drag
    const dt2 = dt * dt
    // verlet integrate
    for (let i = 1; i <= SEGS; i++) {
      const p = this.points[i]
      const pp = this.prev[i]
      this._t.copy(p)
      p.x += (p.x - pp.x) * drag
      p.y += (p.y - pp.y) * drag - g * dt2
      p.z += (p.z - pp.z) * drag
      pp.copy(this._t)
    }
    // pin root
    this.points[0].copy(anchor)
    this.prev[0].copy(anchor)
    // distance constraints
    for (let iter = 0; iter < ANIM.scarf.constraintIters; iter++) {
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
    // collide against the player capsule (vertical spine segment)
    const r = capsuleRadius + 0.03
    const y0 = playerPos.y + capsuleRadius
    const y1 = playerPos.y + capsuleHeight - capsuleRadius
    for (let i = 1; i <= SEGS; i++) {
      const p = this.points[i]
      this._closest.set(playerPos.x, THREE.MathUtils.clamp(p.y, y0, y1), playerPos.z)
      this._d.copy(p).sub(this._closest)
      const d = this._d.length()
      if (d < r && d > 1e-6) p.addScaledVector(this._d, (r - d) / d)
    }
    // write ribbon strip: camera-facing width, twisted by local segment speed
    const invDt = dt > 1e-5 ? 1 / dt : 0
    const nAttr = this.normAttr
    for (let i = 0; i <= SEGS; i++) {
      const p = this.points[i]
      const pn = this.points[Math.min(i + 1, SEGS)]
      const pp = this.points[Math.max(i - 1, 0)]
      this._t.copy(pn).sub(pp)
      const tl = this._t.length() || 1e-6
      this._t.divideScalar(tl)
      this._view.copy(camPos).sub(p)
      this._side.crossVectors(this._t, this._view).normalize()
      // velocity-driven twist: fast segments roll the ribbon about its tangent
      const segSpeed = this.prev[i].distanceTo(p) * invDt
      const twist = THREE.MathUtils.clamp(
        segSpeed * ANIM.scarf.twistPerSpeed * (0.35 + (i / SEGS) * 0.65),
        -ANIM.scarf.twistMax,
        ANIM.scarf.twistMax,
      )
      if (Math.abs(twist) > 1e-3) this._side.applyAxisAngle(this._t, twist)
      this._up.crossVectors(this._side, this._t)
      const w =
        THREE.MathUtils.lerp(ANIM.scarf.width, ANIM.scarf.tipWidth, i / SEGS) * 0.5 * o.widthMult
      this.posAttr.setXYZ(i * 2, p.x + this._side.x * w, p.y + this._side.y * w, p.z + this._side.z * w)
      this.posAttr.setXYZ(
        i * 2 + 1,
        p.x - this._side.x * w,
        p.y - this._side.y * w,
        p.z - this._side.z * w,
      )
      // cheap shared normal per pair so the cloth half actually catches light
      nAttr.setXYZ(i * 2, this._up.x, this._up.y, this._up.z)
      nAttr.setXYZ(i * 2 + 1, this._up.x, this._up.y, this._up.z)
    }
    nAttr.needsUpdate = true
    this.posAttr.needsUpdate = true
  }
}

// ---------------------------------------------------------------------------
// component
// ---------------------------------------------------------------------------

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

  const springs = useRef({
    torsoPitch: new Spring(ANIM.look.torsoStiffness),
    torsoRoll: new Spring(ANIM.look.torsoStiffness),
    torsoYaw: new Spring(ANIM.look.torsoStiffness),
    headYaw: new Spring(ANIM.look.headStiffness),
    headPitch: new Spring(ANIM.look.headStiffness),
    bodyPitch: new Spring(),
    bodyRoll: new Spring(),
    bodyY: new Spring(),
  })

  /** rig-local timers that must not leak into the shared PlayerAnim contract */
  const local = useRef({
    t: 0,
    absorb: 0, // 0..1 landing absorb envelope
    absorbAmp: 0,
    wasGrounded: true,
    prevVy: 0,
    idleSeed: Math.random() * 10,
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
      thighPlate: makeLimbPlate(0.118, 0.1, 0.3),
      shinPlate: makeLimbPlate(0.102, 0.078, 0.3),
      upperArmPlate: makeLimbPlate(0.082, 0.068, 0.22),
      foreArmPlate: makeLimbPlate(0.07, 0.058, 0.2),
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
    }),
    [],
  )

  const mats = useMemo(() => {
    const panel = panelTexture()
    const wear = wearTexture()
    const plateLight = new THREE.MeshStandardMaterial({
      color: COLORS.shrineIvory,
      roughness: 0.3,
      metalness: 0.08,
    })
    const pl = tex(panel, 3, 3)
    if (pl) {
      plateLight.map = pl
      plateLight.roughnessMap = pl
    }
    const plateDark = new THREE.MeshStandardMaterial({
      color: '#24282F', // work order #7: obsidian albedo raised from #12141A
      roughness: 0.3,
      metalness: 0.62,
    })
    const pd = tex(panel, 2.2, 2.2)
    if (pd) {
      plateDark.map = pd
      plateDark.roughnessMap = pd
    }
    const suit = new THREE.MeshStandardMaterial({
      color: '#1A1E25',
      roughness: 0.55,
      metalness: 0.28,
    })
    const trim = new THREE.MeshStandardMaterial({
      color: COLORS.regalGold,
      metalness: 0.95,
      roughness: 0.12,
    })
    const tw = tex(wear, 2, 2)
    if (tw) trim.roughnessMap = tw
    const trimDark = new THREE.MeshStandardMaterial({
      color: '#6E5628',
      metalness: 0.88,
      roughness: 0.45,
    })
    const glow = new THREE.MeshBasicMaterial({ color: COLORS.aureate, toneMapped: false })
    const glowCore = new THREE.MeshBasicMaterial({ color: COLORS.solarWhite, toneMapped: false })
    const cloth = new THREE.MeshStandardMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
      roughness: 0.78,
      metalness: 0.05,
      transparent: true,
      opacity: 0.98,
    })
    const scarfGlow = new THREE.MeshBasicMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    })
    return { plateLight, plateDark, suit, trim, trimDark, glow, glowCore, cloth, scarfGlow }
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

  const ribbons = useMemo(() => {
    const s = ANIM.scarf
    return [
      new Ribbon(
        { segLen: s.segmentLength, gravity: s.gravity, drag: s.drag, widthMult: 1, zOffset: 0 },
        mats.cloth,
        mats.scarfGlow,
      ),
      new Ribbon(
        {
          segLen: s.segmentLength * s.asymSegLen,
          gravity: s.gravity * s.asymGravity,
          drag: s.asymDrag,
          widthMult: 0.82,
          zOffset: -0.06,
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

    // slide crouch pose
    if (crouch > 0.001) {
      bodyYT -= 0.5 * crouch
      torsoPitchT += -ANIM.slideTorsoLeanBack * crouch // leaned back 25°
      legLx = legLx * (1 - crouch) + -1.05 * crouch // one leg extended forward
      legRx = legRx * (1 - crouch) + 0.55 * crouch // one tucked
      kneeRx = kneeRx * (1 - crouch) + 1.1 * crouch
      shRx = shRx * (1 - crouch) + 1.15 * crouch // trailing arm to ground
      shRz = shRz * (1 - crouch) + 0.5 * crouch
    }

    // -- air: ascend ↔ fall blended by v.y. No apex cruciform branch. ------------
    if (state === 'air' && crouch < 0.1) {
      // 0 = full fall, 1 = full ascend
      const w = THREE.MathUtils.clamp(v.y / ANIM.airBlendVy, -1, 1) * 0.5 + 0.5
      const inv = 1 - w
      // ascend: knees tucked, arms swept back and in
      const aLeg = -ANIM.jumpTuckHip
      const aKnee = 1.0
      const aShX = 0.75
      const aShZ = 0.15
      const aElb = 0.9
      // fall: legs trail and split, arms out low, chest opens
      const fLegL = 0.2
      const fLegR = 0.34
      const fKnee = 0.38
      const fShX = -0.22
      const fShZ = 0.78
      const fElb = 0.45
      legLx = aLeg * w + fLegL * inv
      legRx = aLeg * w + fLegR * inv
      kneeLx = aKnee * w + fKnee * inv
      kneeRx = aKnee * w + (fKnee + 0.14) * inv
      shLx = aShX * w + fShX * inv
      shRx = aShX * w + (fShX - 0.1) * inv
      shLz = -(aShZ * w + fShZ * inv)
      shRz = aShZ * w + (fShZ * 0.88) * inv
      elbL = aElb * w + fElb * inv
      elbR = aElb * w + (fElb + 0.18) * inv
      torsoPitchT += 0.16 * inv - 0.06 * w
    }

    // -- wall-run: feet planted on the wall, outside hand trailing ---------------
    if (wallrunning) {
      const side = A.wallSide || (state === 'wallrunL' ? -1 : 1)
      bodyRollT = -side * MOVE.wallrun.torsoTilt // torso tilted toward wall
      torsoPitchT += 0.16 // driving forward
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
    const bodyY = m.bodyY.update(bodyYT, dt)
    B.rotation.x = bodyPitch
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
    mats.cloth.opacity = 0.98 * fade
    mats.scarfGlow.opacity = 0.95 * fade

    // -- scarf ribbons ----------------------------------------------------------------------
    const sy = Math.sin(yaw)
    const cy = Math.cos(yaw)
    for (let i = 0; i < 2; i++) {
      const lx = i === 0 ? -0.13 : 0.11
      const lz = -0.17 + ribbons[i].opts.zOffset
      _anchor.set(
        R.position.x + lx * cy + lz * sy,
        R.position.y + 1.46 + bodyY,
        R.position.z + -lx * sy + lz * cy,
      )
      if (!ribbonsInit.current) ribbons[i].reset(_anchor)
      ribbons[i].update(dt, _anchor, P.position, P.radius, P.height, camera.position)
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
        g.body.rotation.set(s.bodyPitch, 0, s.bodyRoll)
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

              {/* ---- segmented waist skirt: rear at parity with the front ---- */}
              <mesh
                geometry={geos.skirtBack}
                material={mats.plateLight}
                position={[0, -0.02, -0.15]}
                rotation={[-0.22, 0, 0]}
                castShadow
                receiveShadow
              />
              <mesh
                geometry={geos.skirtSide}
                material={mats.plateLight}
                position={[-0.12, -0.02, -0.13]}
                rotation={[-0.16, 0.55, 0.1]}
                castShadow
              />
              <mesh
                geometry={geos.skirtSide}
                material={mats.plateLight}
                position={[0.12, -0.02, -0.13]}
                rotation={[-0.16, -0.55, -0.1]}
                castShadow
              />
              <mesh
                geometry={geos.skirtSide}
                material={mats.plateDark}
                position={[-0.185, -0.03, 0.0]}
                rotation={[0, 1.35, 0.16]}
                castShadow
              />
              <mesh
                geometry={geos.skirtSide}
                material={mats.plateDark}
                position={[0.185, -0.03, 0.0]}
                rotation={[0, -1.35, -0.16]}
                castShadow
              />
              <mesh
                geometry={geos.skirtFront}
                material={mats.plateDark}
                position={[0, -0.02, 0.145]}
                rotation={[0.2, 0, 0]}
                castShadow
              />
              {/* gold keel edge down the rear skirt */}
              <mesh material={mats.trim} position={[0, -0.14, -0.175]} rotation={[-0.22, 0, 0]}>
                <boxGeometry args={[0.028, 0.24, 0.016]} />
              </mesh>

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
                {/* spine energy channel inside the keel recess */}
                <mesh material={mats.glow} position={[0, 0.36, -0.165]}>
                  <boxGeometry args={[0.03, 0.34, 0.014]} />
                </mesh>
                <mesh material={mats.glowCore} position={[0, 0.36, -0.171]}>
                  <boxGeometry args={[0.014, 0.3, 0.01]} />
                </mesh>
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

                {/* ---- LEFT pauldron: heavy 3-lame gold stack ---- */}
                <mesh
                  geometry={geos.lameA}
                  material={mats.trim}
                  position={[-0.19, 0.545, 0]}
                  rotation-z={0.18}
                  castShadow
                  receiveShadow
                />
                <mesh
                  geometry={geos.lameB}
                  material={mats.plateDark}
                  position={[-0.215, 0.495, 0.004]}
                  rotation-z={0.3}
                  castShadow
                />
                <mesh
                  geometry={geos.lameC}
                  material={mats.plateDark}
                  position={[-0.238, 0.442, 0.006]}
                  rotation-z={0.44}
                  castShadow
                />
                {/* pauldron leading-edge energy strip */}
                <mesh material={mats.glow} position={[-0.29, 0.53, 0.07]} rotation={[0, 0.2, 0.2]}>
                  <boxGeometry args={[0.02, 0.022, 0.15]} />
                </mesh>

                {/* ---- RIGHT pauldron: lighter 2-lame ivory cap (asymmetry) ---- */}
                <mesh
                  geometry={geos.capA}
                  material={mats.plateLight}
                  position={[0.195, 0.535, 0]}
                  rotation-z={-0.16}
                  castShadow
                  receiveShadow
                />
                <mesh
                  geometry={geos.capB}
                  material={mats.plateDark}
                  position={[0.222, 0.487, 0.004]}
                  rotation-z={-0.3}
                  castShadow
                />
                <mesh material={mats.trim} position={[0.245, 0.52, 0.03]} rotation-z={-0.3}>
                  <boxGeometry args={[0.018, 0.09, 0.13]} />
                </mesh>

                {/* ================= head ================= */}
                <group ref={head} name="j_head" position={[0, 0.73, 0]}>
                  <group scale={0.74}>
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
                    >
                      <boxGeometry args={[0.03, 0.12, 0.1]} />
                    </mesh>
                    <mesh
                      material={mats.trim}
                      position={[0.1, -0.06, 0.06]}
                      rotation={[0.1, -0.3, -0.2]}
                      castShadow
                    >
                      <boxGeometry args={[0.03, 0.12, 0.1]} />
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
                  <mesh
                    geometry={geos.upperArmPlate}
                    material={mats.plateDark}
                    position={[0, -0.15, 0]}
                    scale={[1, 1, 0.9]}
                    castShadow
                    receiveShadow
                  />
                  <mesh material={mats.trim} position={[-0.075, -0.15, 0]} rotation-z={0.03}>
                    <boxGeometry args={[0.028, 0.2, 0.06]} />
                  </mesh>
                  <group ref={elbowL} name="j_elL" position={[0, -0.3, 0]}>
                    <mesh
                      geometry={geos.elbowCap}
                      material={mats.trim}
                      position={[0, 0, 0.01]}
                      castShadow
                    />
                    <mesh material={mats.suit} position={[0, -0.13, 0]} scale={[1, 1, 0.82]} castShadow>
                      <capsuleGeometry args={[0.05, 0.18, 4, 10]} />
                    </mesh>
                    <mesh
                      geometry={geos.foreArmPlate}
                      material={mats.plateDark}
                      position={[0, -0.13, 0]}
                      scale={[1, 1, 0.9]}
                      castShadow
                      receiveShadow
                    />
                    {/* gauntlet blade fin */}
                    <mesh material={mats.trim} position={[-0.062, -0.13, -0.012]} castShadow>
                      <boxGeometry args={[0.024, 0.17, 0.07]} />
                    </mesh>
                    {/* forearm energy band */}
                    <mesh material={mats.glow} position={[0, -0.2, 0.06]} rotation-x={0.08}>
                      <boxGeometry args={[0.07, 0.02, 0.014]} />
                    </mesh>
                    {/* ---- wrist pivot + wrapped fist ---- */}
                    <group ref={wristL} position={[0, -0.27, 0]}>
                      <mesh geometry={geos.bevelWrist} material={mats.trim} castShadow />
                      <mesh geometry={geos.fist} material={mats.plateDark} position={[0, -0.07, 0.006]} castShadow />
                      <mesh material={mats.trim} position={[0, -0.075, 0.05]} rotation-x={0.12} castShadow>
                        <boxGeometry args={[0.08, 0.07, 0.022]} />
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
                  <mesh
                    geometry={geos.upperArmPlate}
                    material={mats.plateDark}
                    position={[0, -0.15, 0]}
                    scale={[1, 1, 0.9]}
                    castShadow
                    receiveShadow
                  />
                  <mesh material={mats.trim} position={[0.075, -0.15, 0]} rotation-z={-0.03}>
                    <boxGeometry args={[0.028, 0.2, 0.06]} />
                  </mesh>
                  <group ref={elbowR} name="j_elR" position={[0, -0.3, 0]}>
                    <mesh
                      geometry={geos.elbowCap}
                      material={mats.trim}
                      position={[0, 0, 0.01]}
                      castShadow
                    />
                    <mesh material={mats.suit} position={[0, -0.13, 0]} scale={[1, 1, 0.82]} castShadow>
                      <capsuleGeometry args={[0.05, 0.18, 4, 10]} />
                    </mesh>
                    <mesh
                      geometry={geos.foreArmPlate}
                      material={mats.plateDark}
                      position={[0, -0.13, 0]}
                      scale={[1, 1, 0.9]}
                      castShadow
                      receiveShadow
                    />
                    <mesh material={mats.trim} position={[0.062, -0.13, -0.012]} castShadow>
                      <boxGeometry args={[0.024, 0.17, 0.07]} />
                    </mesh>
                    <mesh material={mats.glow} position={[0, -0.2, 0.06]} rotation-x={0.08}>
                      <boxGeometry args={[0.07, 0.02, 0.014]} />
                    </mesh>
                    <group ref={wristR} position={[0, -0.27, 0]}>
                      <mesh geometry={geos.bevelWrist} material={mats.trim} castShadow />
                      <mesh geometry={geos.fist} material={mats.plateDark} position={[0, -0.07, 0.006]} castShadow />
                      <mesh material={mats.trim} position={[0, -0.075, 0.05]} rotation-x={0.12} castShadow>
                        <boxGeometry args={[0.08, 0.07, 0.022]} />
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
                position={[0, -0.2, 0]}
                scale={[1, 1, 0.88]}
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
                <mesh geometry={geos.bevelKnee} material={mats.trimDark} castShadow />
                <mesh
                  geometry={geos.kneeCap}
                  material={mats.trim}
                  position={[0, -0.01, 0.04]}
                  scale={[0.86, 0.78, 0.72]}
                  castShadow
                />
                <mesh material={mats.suit} position={[0, -0.2, 0]} scale={[1, 1, 0.84]} castShadow>
                  <capsuleGeometry args={[0.07, 0.24, 4, 10]} />
                </mesh>
                {/* greave shell */}
                <mesh
                  geometry={geos.shinPlate}
                  material={mats.plateLight}
                  position={[0, -0.2, 0]}
                  scale={[1, 1, 0.88]}
                  castShadow
                  receiveShadow
                />
                <mesh material={mats.trim} position={[-0.09, -0.19, 0]} castShadow>
                  <boxGeometry args={[0.026, 0.24, 0.07]} />
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
                position={[0, -0.2, 0]}
                scale={[1, 1, 0.88]}
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
                <mesh geometry={geos.bevelKnee} material={mats.trimDark} castShadow />
                <mesh
                  geometry={geos.kneeCap}
                  material={mats.trim}
                  position={[0, -0.01, 0.04]}
                  scale={[0.86, 0.78, 0.72]}
                  castShadow
                />
                <mesh material={mats.suit} position={[0, -0.2, 0]} scale={[1, 1, 0.84]} castShadow>
                  <capsuleGeometry args={[0.07, 0.24, 4, 10]} />
                </mesh>
                <mesh
                  geometry={geos.shinPlate}
                  material={mats.plateLight}
                  position={[0, -0.2, 0]}
                  scale={[1, 1, 0.88]}
                  castShadow
                  receiveShadow
                />
                <mesh material={mats.trim} position={[0.09, -0.19, 0]} castShadow>
                  <boxGeometry args={[0.026, 0.24, 0.07]} />
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
          <pointLight
            position={[-0.5, 0.75, -1.1]}
            color={COLORS.paleHalo}
            intensity={9}
            distance={4.5}
            decay={2}
          />
          <pointLight
            position={[0.55, 0.5, 0.95]}
            color={LIGHTING.playerRim.color}
            intensity={7}
            distance={4.5}
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

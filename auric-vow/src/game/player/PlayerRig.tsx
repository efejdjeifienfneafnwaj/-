/**
 * AURIC VOW — player/PlayerRig.tsx
 * Procedural character mesh (design.md §1.3) + procedural animation
 * (movement.md §10). No external models — Three.js primitives only.
 *
 * fix2 sculpt — sleek armored-ninja silhouette:
 * - Helmet: lathed + sheared visor wedge, narrow gold eye-slit, swept crest fin
 * - Torso: 3 overlapping shell plates (flattened domes) over a slim waist,
 *   asymmetric gold pauldron (L) vs ivory shoulder cap (R)
 * - Limbs: tapered/flattened segments with gold outer armor ridges; joint
 *   rings are now slanted edge-trim tori HUGGING the limb surface
 * - Two verlet scarf ribbons (12 segments, gravity 2, drag 0.85, capsule collide)
 * - Pose computed per-frame from PlayerRef.state: sine gait, accel lean,
 *   sprint lean (~18° at full sprint) + arm pumping + aim stance, slide
 *   crouch, wall-run tilt, glide superman pose, lunge tuck-spin
 * - Player rim point light (§2.3) + lunge afterimage ghosts
 */
import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useGameStore } from '../store'
import { COLORS, LIGHTING } from '../config'
import { Input } from '../Input'
import { PlayerRef, PlayerAnim } from './PlayerRef'
import { getCamRoll } from './CameraRig'
import { ANIM, MOVE } from './movementConfig'

// ---------------------------------------------------------------------------
// sprint pose exaggeration (fix2) — local to the rig, movement config untouched
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
// pose springs — critically-damped (stiffness 120, damping 18) per movement.md §10
// ---------------------------------------------------------------------------
class Spring {
  x = 0
  v = 0
  update(target: number, dt: number): number {
    const f = -ANIM.springStiffness * (this.x - target) - ANIM.springDamping * this.v
    this.v += f * dt
    this.x += this.v * dt
    return this.x
  }
}

// ---------------------------------------------------------------------------
// sculpted geometry helpers (fix2)
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
  const geo = new THREE.ExtrudeGeometry(s, { depth: 0.018, bevelEnabled: false })
  geo.rotateY(-Math.PI / 2) // shape +x → world +z (forward), thickness → x
  geo.translate(0.009, 0, 0)
  return geo
}

/** Chest shell plate: flattened dome, bulge toward +Z, opening downward. */
function makeShellPlate(r: number): THREE.BufferGeometry {
  const geo = new THREE.SphereGeometry(r, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.55)
  geo.rotateX(Math.PI / 2)
  geo.scale(1.05, 0.9, 0.5)
  return geo
}

/** Shoulder dome (pauldron / cap): upright half-dome. */
function makeShoulderDome(r: number): THREE.BufferGeometry {
  return new THREE.SphereGeometry(r, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.55)
}

// ---------------------------------------------------------------------------
// verlet scarf ribbon (movement.md §10: 12 segments, gravity 2, drag 0.85)
// ---------------------------------------------------------------------------
const SEGS = ANIM.scarf.segments

class Ribbon {
  points: THREE.Vector3[] = []
  prev: THREE.Vector3[] = []
  mesh: THREE.Mesh
  private posAttr: THREE.BufferAttribute
  private _t = new THREE.Vector3()
  private _side = new THREE.Vector3()
  private _view = new THREE.Vector3()
  private _closest = new THREE.Vector3()
  private _d = new THREE.Vector3()

  constructor() {
    for (let i = 0; i <= SEGS; i++) {
      this.points.push(new THREE.Vector3(0, 1.5 - i * ANIM.scarf.segmentLength, 0))
      this.prev.push(this.points[i].clone())
    }
    const geo = new THREE.BufferGeometry()
    const positions = new Float32Array((SEGS + 1) * 2 * 3)
    const colors = new Float32Array((SEGS + 1) * 2 * 3)
    const root = new THREE.Color(COLORS.solarWhite).multiplyScalar(0.55)
    const tip = new THREE.Color(COLORS.aureate).multiplyScalar(3.0) // hot emissive tip (fix1: 2.2 → 3.0)
    const c = new THREE.Color()
    for (let i = 0; i <= SEGS; i++) {
      c.lerpColors(root, tip, i / SEGS)
      for (let s = 0; s < 2; s++) {
        colors[(i * 2 + s) * 3 + 0] = c.r
        colors[(i * 2 + s) * 3 + 1] = c.g
        colors[(i * 2 + s) * 3 + 2] = c.b
      }
    }
    const idx: number[] = []
    for (let i = 0; i < SEGS; i++) {
      const a = i * 2
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
    }
    geo.setIndex(idx)
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    this.posAttr = geo.getAttribute('position') as THREE.BufferAttribute
    const mat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.95, // fix1: 0.85 → 0.95 so the scarf reads at range
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
      toneMapped: false,
    })
    this.mesh = new THREE.Mesh(geo, mat)
    this.mesh.frustumCulled = false
  }

  reset(anchor: THREE.Vector3) {
    for (let i = 0; i <= SEGS; i++) {
      this.points[i].copy(anchor)
      this.points[i].y -= i * ANIM.scarf.segmentLength
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
    const g = ANIM.scarf.gravity
    const drag = ANIM.scarf.drag
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
        const diff = (len - ANIM.scarf.segmentLength) / len
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
    // write ribbon strip (camera-facing width)
    for (let i = 0; i <= SEGS; i++) {
      const p = this.points[i]
      const pn = this.points[Math.min(i + 1, SEGS)]
      const pp = this.points[Math.max(i - 1, 0)]
      this._t.copy(pn).sub(pp)
      this._view.copy(camPos).sub(p)
      this._side.crossVectors(this._t, this._view).normalize()
      const w = THREE.MathUtils.lerp(ANIM.scarf.width, ANIM.scarf.tipWidth, i / SEGS) * 0.5
      this.posAttr.setXYZ(i * 2, p.x + this._side.x * w, p.y + this._side.y * w, p.z + this._side.z * w)
      this.posAttr.setXYZ(i * 2 + 1, p.x - this._side.x * w, p.y - this._side.y * w, p.z - this._side.z * w)
    }
    this.posAttr.needsUpdate = true
  }
}

// ---------------------------------------------------------------------------
// component
// ---------------------------------------------------------------------------

/**
 * Weapon attachment sockets, published for the third-person view model.
 * The rig is procedural (no skeleton), so these are plain groups parented into
 * the arm / hip hierarchy; combat/ViewModel.tsx reads their world matrices
 * each frame instead of gluing weapons to the camera.
 */
export const PlayerSockets: {
  rightHand: THREE.Object3D | null
  leftHand: THREE.Object3D | null
  hip: THREE.Object3D | null
} = { rightHand: null, leftHand: null, hip: null }

const _fwd = new THREE.Vector3()
const _rgt = new THREE.Vector3()
const _anchor = new THREE.Vector3()

export default function PlayerRig() {
  const root = useRef<THREE.Group>(null)
  const body = useRef<THREE.Group>(null)
  const torso = useRef<THREE.Group>(null)
  const head = useRef<THREE.Group>(null)
  const shoulderL = useRef<THREE.Group>(null)
  const shoulderR = useRef<THREE.Group>(null)
  const elbowL = useRef<THREE.Group>(null)
  const elbowR = useRef<THREE.Group>(null)
  const legL = useRef<THREE.Group>(null)
  const legR = useRef<THREE.Group>(null)
  const kneeL = useRef<THREE.Group>(null)
  const kneeR = useRef<THREE.Group>(null)
  const handSocketR = useRef<THREE.Group>(null)
  const handSocketL = useRef<THREE.Group>(null)
  const hipSocket = useRef<THREE.Group>(null)

  const springs = useRef({
    torsoPitch: new Spring(),
    torsoRoll: new Spring(),
    bodyPitch: new Spring(),
    bodyRoll: new Spring(),
    bodyY: new Spring(),
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

  const ribbons = useMemo(() => [new Ribbon(), new Ribbon()], [])
  const ribbonsInit = useRef(false)

  // sculpted armor geometry (fix2) — built once
  const geos = useMemo(
    () => ({
      helmet: makeHelmetGeometry(),
      crest: makeCrestGeometry(),
      plateUpper: makeShellPlate(0.185),
      plateMid: makeShellPlate(0.155),
      plateLow: makeShellPlate(0.125),
      pauldron: makeShoulderDome(0.145),
      shoulderCap: makeShoulderDome(0.105),
    }),
    [],
  )

  // lunge afterimage ghosts (3 samples at 0.05s intervals, additive gold)
  const ghosts = useMemo(
    () =>
      [0, 1, 2].map(() => {
        const mat = new THREE.MeshBasicMaterial({
          color: COLORS.aureate,
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          toneMapped: false,
        })
        const g = new THREE.Group()
        const bod = new THREE.Mesh(new THREE.CapsuleGeometry(0.15, 1.0, 4, 8), mat)
        bod.position.y = 0.9
        bod.scale.set(1, 1, 0.75)
        const hed = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), mat)
        hed.position.y = 1.63
        hed.scale.set(0.92, 0.9, 1.25) // matches the visor-wedge silhouette
        g.add(bod, hed)
        g.visible = false
        return { group: g, mat }
      }),
    [],
  )

  const mats = useMemo(
    () => ({
      obsidian: new THREE.MeshStandardMaterial({
        color: COLORS.deepRelic,
        metalness: 0.6,
        roughness: 0.15,
      }),
      ivory: new THREE.MeshStandardMaterial({
        color: COLORS.shrineIvory,
        roughness: 0.35,
        metalness: 0.05,
      }),
      gold: new THREE.MeshStandardMaterial({
        color: COLORS.regalGold,
        metalness: 0.9,
        roughness: 0.25,
      }),
      glow: new THREE.MeshBasicMaterial({ color: COLORS.aureate, toneMapped: false }),
    }),
    [],
  )

  useFrame(({ camera }, delta) => {
    const m = springs.current
    const st = useGameStore.getState()
    const dt = Math.min(delta, 1 / 30) * st.timeScale
    if (dt <= 0) return

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

    // -- gait cycle -------------------------------------------------------------
    const speedNorm = THREE.MathUtils.clamp(A.speed / MOVE.sprintSpeed, 0, 1.3)
    if (P.isGrounded && A.speed > 0.2) {
      A.gaitPhase += (A.speed / ANIM.strideLength) * dt
    }
    const phase = A.gaitPhase
    // gait amplitude scales continuously with speed (incl. sprint overspeed) — fix2
    const gaitAmp = Math.min(speedNorm, 1.15)

    // sprint intensity 0..1 (walk → sprint speed), grounded locomotion only
    const sprintT =
      P.isGrounded && (state === 'run' || state === 'sprint')
        ? THREE.MathUtils.clamp((A.speed - MOVE.walkSpeed) / (MOVE.sprintSpeed - MOVE.walkSpeed), 0, 1)
        : 0

    const swing = Math.sin(phase) * ANIM.legSwing * gaitAmp * (1 + SPRINT_POSE.legBoost * sprintT)

    // -- spine lean from local accel (movement.md §10) -----------------------------
    const localAccelZ = A.accel.dot(_fwd)
    const localAccelX = A.accel.dot(_rgt)
    let torsoPitchT =
      THREE.MathUtils.clamp(localAccelZ * ANIM.leanPitchPerAccel, -ANIM.leanPitchMax, ANIM.leanPitchMax)
    const torsoRollT =
      -localAccelX * ANIM.leanRollPerStrafeAccel + getCamRoll() * ANIM.cameraRollInfluence
    // sprint: aggressive forward lean up to ~18° at full sprint (fix2)
    torsoPitchT += SPRINT_POSE.leanMax * sprintT

    // -- pose targets per state -------------------------------------------------------
    let bodyPitchT = 0
    let bodyRollT = 0
    let bodyYT = 0
    let legLx = -swing
    let legRx = swing
    let kneeLx = Math.max(0, -Math.sin(phase)) * 0.9 * gaitAmp * (1 + SPRINT_POSE.kneeBoost * sprintT)
    let kneeRx = Math.max(0, Math.sin(phase)) * 0.9 * gaitAmp * (1 + SPRINT_POSE.kneeBoost * sprintT)
    // arms pump harder + tuck in as sprint builds (fix2)
    const armAmp = ANIM.armSwingMult * (1 + SPRINT_POSE.armBoost * sprintT)
    let shLx = swing * armAmp
    let shRx = -swing * armAmp
    let shLz = -0.08 - SPRINT_POSE.armTuck * sprintT
    let shRz = 0.08 + SPRINT_POSE.armTuck * sprintT
    // sprint elbows: bent, pumping in counter-phase with the gait
    let elbL = 0.35 + sprintT * (0.45 + 0.35 * Math.max(0, Math.sin(phase)))
    let elbR = 0.35 + sprintT * (0.45 + 0.35 * Math.max(0, -Math.sin(phase)))

    if (P.isGrounded && (state === 'run' || state === 'sprint')) {
      bodyYT += Math.abs(Math.sin(phase)) * ANIM.bobAmp * (1 + SPRINT_POSE.bobBoost * sprintT) * gaitAmp
    }

    // slide crouch pose
    const crouch = A.crouch
    if (crouch > 0.001) {
      bodyYT -= 0.5 * crouch
      torsoPitchT += -ANIM.slideTorsoLeanBack * crouch // leaned back 25°
      legLx = legLx * (1 - crouch) + -1.05 * crouch // one leg extended forward
      legRx = legRx * (1 - crouch) + 0.55 * crouch // one tucked
      kneeRx = kneeRx * (1 - crouch) + 1.1 * crouch
      shRx = shRx * (1 - crouch) + 1.15 * crouch // trailing arm to ground
      shRz = shRz * (1 - crouch) + 0.5 * crouch
    }

    if (state === 'air') {
      if (v.y > 0.5) {
        // ascending — knees tucked, arms swept back
        legLx = legRx = -ANIM.jumpTuckHip
        kneeLx = kneeRx = 1.0
        shLx = shRx = 0.75
        shLz = -0.15
        shRz = 0.15
      } else if (v.y < -0.5) {
        // falling — arms out, legs trail
        shLz = -0.95
        shRz = 0.95
        shLx = shRx = -0.25
        legLx = 0.18
        legRx = 0.28
        kneeLx = kneeRx = 0.35
        torsoPitchT += 0.12
      } else {
        // apex — brief cruciform
        shLz = -1.3
        shRz = 1.3
        legLx = legRx = -0.2
      }
    }

    if (state === 'wallrunL' || state === 'wallrunR') {
      const side = A.wallSide
      bodyRollT = -side * MOVE.wallrun.torsoTilt // torso tilted toward wall 20°
      // exaggerated run cycle (amplitude 0.5-scale, freq ∝ speed)
      const wswing = Math.sin(phase * 1.15) * 0.7
      legLx = -wswing
      legRx = wswing
      kneeLx = Math.max(0, -Math.sin(phase * 1.15)) * 1.0
      kneeRx = Math.max(0, Math.sin(phase * 1.15)) * 1.0
      // near-side arm reaches to the wall
      if (side > 0) shRz = 1.1
      else shLz = -1.1
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

    // aiming while running: blade stance — right arm pinned back, left countering (fix2)
    if ((state === 'run' || state === 'sprint') && crouch < 0.3 && Input.held('aim')) {
      shRx = 0.85 // right arm swept back
      shRz = 0.22
      elbR = 0.55
      shLx = -0.5 - swing * 0.25 * gaitAmp // left counter-forward, still pumping
      shLz = -0.2
      elbL = 0.95
    }

    // -- spring-blend core scalars ---------------------------------------------------
    T.rotation.x = m.torsoPitch.update(torsoPitchT, dt)
    T.rotation.z = m.torsoRoll.update(torsoRollT, dt)
    B.rotation.x = m.bodyPitch.update(bodyPitchT, dt)
    B.rotation.z =
      state === 'lunge' ? A.lungeT * Math.PI * 2 : m.bodyRoll.update(bodyRollT, dt)
    B.position.y = m.bodyY.update(bodyYT, dt)

    // -- write joints (exp-damped toward target) ----------------------------------------
    const k = 1 - Math.exp(-18 * dt)
    const damp = (g: THREE.Group | null, axis: 'x' | 'z', target: number) => {
      if (!g) return
      g.rotation[axis] += (target - g.rotation[axis]) * k
    }
    damp(legL.current, 'x', legLx)
    damp(legR.current, 'x', legRx)
    damp(kneeL.current, 'x', -kneeLx) // knees bend backward
    damp(kneeR.current, 'x', -kneeRx)
    damp(shoulderL.current, 'x', shLx)
    damp(shoulderR.current, 'x', shRx)
    damp(shoulderL.current, 'z', shLz)
    damp(shoulderR.current, 'z', shRz)
    damp(elbowL.current, 'x', -elbL)
    damp(elbowR.current, 'x', -elbR)

    // head steadies against torso lean (aim readability)
    if (head.current) head.current.rotation.x = -T.rotation.x * 0.6

    // -- scarf ribbons ----------------------------------------------------------------------
    const sy = Math.sin(yaw)
    const cy = Math.cos(yaw)
    for (let i = 0; i < 2; i++) {
      const lx = i === 0 ? -0.12 : 0.12
      // local (lx, 1.48, -0.16) rotated by yaw around root
      _anchor.set(
        P.position.x + lx * cy + -0.16 * sy,
        P.position.y + 1.48,
        P.position.z + -lx * sy + -0.16 * cy,
      )
      if (!ribbonsInit.current) ribbons[i].reset(_anchor)
      ribbons[i].update(dt, _anchor, P.position, P.radius, P.height, camera.position)
    }
    ribbonsInit.current = true

    // -- afterimage ghosts ---------------------------------------------------------------------
    const hist = A.history
    ghosts.forEach((g, gi) => {
      const fade = THREE.MathUtils.clamp(A.afterimageT / 0.4, 0, 1)
      if (fade <= 0 || hist.length === 0) {
        g.group.visible = false
        return
      }
      const back = Math.min(hist.length - 1, (gi + 1) * 3) // ~0.05s intervals @60fps
      const slot = hist[(A.historyIdx - 1 - back + hist.length * 4) % hist.length]
      g.group.visible = true
      g.group.position.copy(slot.pos)
      g.group.rotation.set(0, slot.yaw, slot.roll)
      g.mat.opacity = fade * (0.5 - gi * 0.13)
    })
  }, -9)

  return (
    <>
      <group ref={root}>
        <group ref={body}>
          {/* hips */}
          <group position={[0, 0.95, 0]}>
            {/* pelvis — slim armored hips */}
            <mesh material={mats.obsidian} castShadow>
              <capsuleGeometry args={[0.13, 0.1, 4, 10]} />
            </mesh>
            {/* gold hip edge trim — hugs the pelvis, slanted like an armor rim */}
            <mesh material={mats.gold} position={[0, 0.05, 0]} rotation={[Math.PI / 2 + 0.1, 0, 0]}>
              <torusGeometry args={[0.135, 0.008, 6, 20]} />
            </mesh>

            {/* scabbard socket — read by combat/ViewModel.tsx */}
            <group ref={hipSocket} position={[-0.17, -0.02, -0.04]} rotation={[0, 0, 0.3]} />

            {/* torso (spine lean pivot) */}
            <group ref={torso}>
              {/* slim waist — tapered obsidian underlayer */}
              <mesh material={mats.obsidian} position={[0, 0.14, 0]} scale={[1, 1, 0.72]} castShadow>
                <cylinderGeometry args={[0.105, 0.09, 0.26, 12]} />
              </mesh>
              {/* under-suit chest core */}
              <mesh material={mats.obsidian} position={[0, 0.35, 0]} scale={[1, 1, 0.7]} castShadow>
                <capsuleGeometry args={[0.14, 0.28, 4, 12]} />
              </mesh>

              {/* layered shell chest armor — 3 overlapping curved plates (fix2) */}
              <mesh geometry={geos.plateUpper} material={mats.ivory} position={[0, 0.47, 0.05]} rotation-x={0.22} castShadow />
              <mesh geometry={geos.plateMid} material={mats.ivory} position={[0, 0.345, 0.055]} rotation-x={0.34} castShadow />
              <mesh geometry={geos.plateLow} material={mats.obsidian} position={[0, 0.225, 0.05]} rotation-x={0.46} castShadow />
              {/* gold chevron seams between plates */}
              <mesh material={mats.gold} position={[0, 0.4, 0.128]} rotation-x={-0.18}>
                <boxGeometry args={[0.15, 0.016, 0.012]} />
              </mesh>
              <mesh material={mats.gold} position={[0, 0.285, 0.118]} rotation-x={-0.1}>
                <boxGeometry args={[0.11, 0.014, 0.012]} />
              </mesh>

              {/* gold collar trim */}
              <mesh material={mats.gold} position={[0, 0.53, 0]} rotation-x={Math.PI / 2}>
                <torusGeometry args={[0.115, 0.015, 8, 20]} />
              </mesh>
              {/* emissive aureate spine strip — hero silhouette reads from behind/overhead (fix1) */}
              <mesh material={mats.glow} position={[0, 0.32, -0.15]}>
                <boxGeometry args={[0.05, 0.44, 0.02]} />
              </mesh>
              {/* chest core ember line */}
              <mesh material={mats.glow} position={[0, 0.34, 0.148]} rotation-x={-0.1}>
                <boxGeometry args={[0.03, 0.28, 0.015]} />
              </mesh>

              {/* asymmetric shoulders: gold pauldron (L) / ivory cap (R) — fix2 */}
              <mesh geometry={geos.pauldron} material={mats.gold} position={[-0.3, 0.55, 0]} rotation-z={0.12} scale={[1.15, 0.75, 1.25]} castShadow />
              {/* pauldron rim edge trim */}
              <mesh material={mats.obsidian} position={[-0.3, 0.545, 0]} rotation-x={Math.PI / 2} rotation-z={0.12} scale={[1.15, 1.25, 1]}>
                <torusGeometry args={[0.128, 0.009, 6, 24]} />
              </mesh>
              {/* pauldron emissive leading edge (keeps fix1 accent language) */}
              <mesh material={mats.glow} position={[-0.335, 0.52, 0.05]} rotation-z={0.12}>
                <boxGeometry args={[0.02, 0.02, 0.16]} />
              </mesh>
              <mesh geometry={geos.shoulderCap} material={mats.ivory} position={[0.29, 0.535, 0]} rotation-z={-0.1} scale={[1.05, 0.62, 1.1]} castShadow />

              {/* head — swept visor-wedge helmet, gold eye-slit, crest fin (fix2) */}
              <group ref={head} position={[0, 0.68, 0]}>
                <mesh geometry={geos.helmet} material={mats.obsidian} position={[0, 0.02, 0.01]} castShadow />
                {/* narrow horizontal gold eye-slit — two angled segments hugging the wedge face */}
                <mesh material={mats.glow} position={[-0.052, -0.012, 0.152]} rotation={[0.06, 0.38, -0.07]}>
                  <boxGeometry args={[0.095, 0.016, 0.012]} />
                </mesh>
                <mesh material={mats.glow} position={[0.052, -0.012, 0.152]} rotation={[0.06, -0.38, 0.07]}>
                  <boxGeometry args={[0.095, 0.016, 0.012]} />
                </mesh>
                {/* crest fin sweeping back */}
                <mesh geometry={geos.crest} material={mats.gold} position={[0, 0.14, 0.02]} castShadow />
                {/* jaw/chin guard edge */}
                <mesh material={mats.gold} position={[0, -0.128, 0.06]} rotation-x={Math.PI / 2}>
                  <torusGeometry args={[0.085, 0.007, 6, 20, Math.PI]} />
                </mesh>
              </group>

              {/* arms */}
              <group ref={shoulderL} position={[-0.27, 0.48, 0]}>
                {/* slanted armor edge trim hugging the shoulder (was a floating hoop) */}
                <mesh material={mats.gold} position={[0, -0.02, 0]} rotation={[Math.PI / 2 + 0.14, 0, -0.12]}>
                  <torusGeometry args={[0.058, 0.008, 6, 18]} />
                </mesh>
                {/* emissive shoulder edge strip (fix1) */}
                <mesh material={mats.glow} position={[-0.055, 0.05, 0]}>
                  <boxGeometry args={[0.045, 0.025, 0.22]} />
                </mesh>
                {/* tapered + flattened upper arm */}
                <mesh material={mats.obsidian} position={[0, -0.15, 0]} scale={[1, 1, 0.8]} castShadow>
                  <capsuleGeometry args={[0.052, 0.2, 4, 8]} />
                </mesh>
                {/* armor ridge along the outer line */}
                <mesh material={mats.gold} position={[-0.055, -0.15, 0]}>
                  <boxGeometry args={[0.016, 0.2, 0.028]} />
                </mesh>
                <group ref={elbowL} position={[0, -0.31, 0]}>
                  {/* elbow edge trim — slanted, hugging the limb */}
                  <mesh material={mats.gold} rotation={[Math.PI / 2 + 0.12, 0, -0.1]}>
                    <torusGeometry args={[0.048, 0.009, 6, 18]} />
                  </mesh>
                  {/* emissive forearm ring (fix1) — tucked onto the limb surface */}
                  <mesh material={mats.glow} position={[0, -0.19, 0]} rotation={[Math.PI / 2 - 0.1, 0, 0.08]}>
                    <torusGeometry args={[0.049, 0.008, 6, 18]} />
                  </mesh>
                  {/* tapered forearm */}
                  <mesh material={mats.obsidian} position={[0, -0.13, 0]} scale={[1, 1, 0.75]} castShadow>
                    <capsuleGeometry args={[0.047, 0.18, 4, 8]} />
                  </mesh>
                  {/* gauntlet blade ridge (outer line) */}
                  <mesh material={mats.gold} position={[-0.05, -0.13, -0.008]}>
                    <boxGeometry args={[0.014, 0.16, 0.05]} />
                  </mesh>
                  {/* hand */}
                  <mesh material={mats.gold} position={[0, -0.28, 0]}>
                    <boxGeometry args={[0.075, 0.1, 0.08]} />
                  </mesh>
                  <group ref={handSocketL} position={[0, -0.3, 0.02]} />
                </group>
              </group>
              <group ref={shoulderR} position={[0.27, 0.48, 0]}>
                <mesh material={mats.gold} position={[0, -0.02, 0]} rotation={[Math.PI / 2 + 0.14, 0, 0.12]}>
                  <torusGeometry args={[0.058, 0.008, 6, 18]} />
                </mesh>
                {/* emissive shoulder edge strip (fix1) */}
                <mesh material={mats.glow} position={[0.055, 0.05, 0]}>
                  <boxGeometry args={[0.045, 0.025, 0.22]} />
                </mesh>
                <mesh material={mats.obsidian} position={[0, -0.15, 0]} scale={[1, 1, 0.8]} castShadow>
                  <capsuleGeometry args={[0.052, 0.2, 4, 8]} />
                </mesh>
                <mesh material={mats.gold} position={[0.055, -0.15, 0]}>
                  <boxGeometry args={[0.016, 0.2, 0.028]} />
                </mesh>
                <group ref={elbowR} position={[0, -0.31, 0]}>
                  <mesh material={mats.gold} rotation={[Math.PI / 2 + 0.12, 0, 0.1]}>
                    <torusGeometry args={[0.048, 0.009, 6, 18]} />
                  </mesh>
                  <mesh material={mats.glow} position={[0, -0.19, 0]} rotation={[Math.PI / 2 - 0.1, 0, -0.08]}>
                    <torusGeometry args={[0.049, 0.008, 6, 18]} />
                  </mesh>
                  <mesh material={mats.obsidian} position={[0, -0.13, 0]} scale={[1, 1, 0.75]} castShadow>
                    <capsuleGeometry args={[0.047, 0.18, 4, 8]} />
                  </mesh>
                  <mesh material={mats.gold} position={[0.05, -0.13, -0.008]}>
                    <boxGeometry args={[0.014, 0.16, 0.05]} />
                  </mesh>
                  <mesh material={mats.gold} position={[0, -0.28, 0]}>
                    <boxGeometry args={[0.075, 0.1, 0.08]} />
                  </mesh>
                  {/* weapon grip socket — read by combat/ViewModel.tsx */}
                  <group ref={handSocketR} position={[0, -0.3, 0.02]} />
                </group>
              </group>
            </group>
          </group>

          {/* legs (hip pivots) */}
          <group ref={legL} position={[-0.13, 0.95, 0]}>
            {/* hip edge trim — hugging, slanted */}
            <mesh material={mats.gold} position={[0, -0.02, 0]} rotation={[Math.PI / 2 + 0.12, 0, -0.1]}>
              <torusGeometry args={[0.075, 0.008, 6, 18]} />
            </mesh>
            {/* tapered + flattened thigh */}
            <mesh material={mats.obsidian} position={[0, -0.2, 0]} scale={[1, 1, 0.8]} castShadow>
              <capsuleGeometry args={[0.068, 0.26, 4, 8]} />
            </mesh>
            {/* thigh armor ridge (outer line) */}
            <mesh material={mats.gold} position={[-0.065, -0.2, 0]}>
              <boxGeometry args={[0.016, 0.24, 0.03]} />
            </mesh>
            <group ref={kneeL} position={[0, -0.45, 0]}>
              {/* knee edge trim + pad */}
              <mesh material={mats.gold} rotation={[Math.PI / 2 + 0.12, 0, -0.08]}>
                <torusGeometry args={[0.056, 0.009, 6, 18]} />
              </mesh>
              <mesh material={mats.gold} position={[0, -0.03, 0.055]} scale={[0.75, 0.6, 0.5]} castShadow>
                <sphereGeometry args={[0.075, 12, 8]} />
              </mesh>
              {/* tapered shin */}
              <mesh material={mats.obsidian} position={[0, -0.21, 0]} scale={[1, 1, 0.78]} castShadow>
                <capsuleGeometry args={[0.055, 0.26, 4, 8]} />
              </mesh>
              {/* shin blade ridge (outer line) */}
              <mesh material={mats.gold} position={[-0.052, -0.2, -0.005]}>
                <boxGeometry args={[0.014, 0.24, 0.04]} />
              </mesh>
              {/* emissive ankle ring (fix1) — hugging the limb */}
              <mesh material={mats.glow} position={[0, -0.36, 0]} rotation={[Math.PI / 2 - 0.08, 0, 0]}>
                <torusGeometry args={[0.05, 0.007, 6, 18]} />
              </mesh>
              {/* sleek foot */}
              <mesh material={mats.ivory} position={[0, -0.44, 0.06]} castShadow>
                <boxGeometry args={[0.09, 0.06, 0.24]} />
              </mesh>
            </group>
          </group>
          <group ref={legR} position={[0.13, 0.95, 0]}>
            <mesh material={mats.gold} position={[0, -0.02, 0]} rotation={[Math.PI / 2 + 0.12, 0, 0.1]}>
              <torusGeometry args={[0.075, 0.008, 6, 18]} />
            </mesh>
            <mesh material={mats.obsidian} position={[0, -0.2, 0]} scale={[1, 1, 0.8]} castShadow>
              <capsuleGeometry args={[0.068, 0.26, 4, 8]} />
            </mesh>
            <mesh material={mats.gold} position={[0.065, -0.2, 0]}>
              <boxGeometry args={[0.016, 0.24, 0.03]} />
            </mesh>
            <group ref={kneeR} position={[0, -0.45, 0]}>
              <mesh material={mats.gold} rotation={[Math.PI / 2 + 0.12, 0, 0.08]}>
                <torusGeometry args={[0.056, 0.009, 6, 18]} />
              </mesh>
              <mesh material={mats.gold} position={[0, -0.03, 0.055]} scale={[0.75, 0.6, 0.5]} castShadow>
                <sphereGeometry args={[0.075, 12, 8]} />
              </mesh>
              <mesh material={mats.obsidian} position={[0, -0.21, 0]} scale={[1, 1, 0.78]} castShadow>
                <capsuleGeometry args={[0.055, 0.26, 4, 8]} />
              </mesh>
              <mesh material={mats.gold} position={[0.052, -0.2, -0.005]}>
                <boxGeometry args={[0.014, 0.24, 0.04]} />
              </mesh>
              <mesh material={mats.glow} position={[0, -0.36, 0]} rotation={[Math.PI / 2 - 0.08, 0, 0]}>
                <torusGeometry args={[0.05, 0.007, 6, 18]} />
              </mesh>
              <mesh material={mats.ivory} position={[0, -0.44, 0.06]} castShadow>
                <boxGeometry args={[0.09, 0.06, 0.24]} />
              </mesh>
            </group>
          </group>

          {/* player rim light (design.md §2.3) — boosted 3 → 4.5 (fix1 readability) */}
          <pointLight
            position={[0, 1.3, 0]}
            color={LIGHTING.playerRim.color}
            intensity={LIGHTING.playerRim.intensity * 1.5}
            distance={LIGHTING.playerRim.distance}
            decay={2}
          />
          {/* subtle cool fill from front-top so obsidian parts don't vanish
              against dark floors (fix1); body-space +Z = facing direction */}
          <pointLight
            position={[0, 2.3, 1.7]}
            color={COLORS.paleHalo}
            intensity={2.4}
            distance={7}
            decay={2}
          />
        </group>
      </group>

      {/* verlet scarf ribbons (world space) */}
      <primitive object={ribbons[0].mesh} />
      <primitive object={ribbons[1].mesh} />

      {/* lunge afterimage ghosts */}
      {ghosts.map((g, i) => (
        <primitive key={i} object={g.group} />
      ))}
    </>
  )
}

/* eslint-disable react-refresh/only-export-components */
/**
 * AURIC VOW — player/CameraRig.tsx
 * Third-person over-shoulder orbit camera. movement.md §8.
 *
 * - Pointer-lock look via Input.consumeLook (yaw/pitch live in CamRef so the
 *   PlayerController can steer camera-relative movement).
 * - Collision-aware boom, swept as a SPHERE (axis ray + 4 rim rays) so thin
 *   geometry — wall-run slabs, rails, pylons — can no longer cut the near
 *   plane and bury the camera inside a wall (weakness P8).
 * - Boom floor raised to 1.25 m (above the 0.54 m shoulder span) and paired
 *   with a proximity fade the rig reads via getPlayerFade(), so when the boom
 *   still has to come in close the frame dissolves instead of clipping.
 * - Wall-run: the shoulder offset swings to the free side and the boom is
 *   pushed out along the wall normal.
 * - Ultimate (auric requiem): its own camera state — boom to ~6 m, drop ~1 m,
 *   so the frame silhouettes against the nova.
 * - FOV kick table (sprint/slide/wallrun/glide/lunge/ult + event pulses) and
 *   aim FOV 70→55.
 * - Camera roll: ±14° wall-run (ease 8/s, snap-out on wall-jump), −3° slide,
 *   ±2° strafe lean.
 * - Trauma shake: addTrauma(n) — rotational noise + a positional component;
 *   addCamKick(dir, n) adds a directional positional punch (landing, impacts).
 */
import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { Input } from '../Input'
import { useGameStore } from '../store'
import { MISSION } from '../config'
import { raycastLevel } from '../world/Colliders'
import { CombatState } from '../combat/state'
import { PlayerRef, PlayerAnim } from './PlayerRef'
import { MOVE } from './movementConfig'

/** shared orbit state — read by PlayerController for camera-relative movement */
export const CamRef = { yaw: 0, pitch: -0.08 }

// ---------------------------------------------------------------------------
// Trauma shake API (module-level so combat/abilities can call without react)
// ---------------------------------------------------------------------------
let trauma = 0
let camRollCurrent = 0
let playerFade = 1
const _kick = new THREE.Vector3()

/** add screen-shake trauma (0..1). shake amplitude = trauma² */
export function addTrauma(n: number) {
  trauma = Math.min(1, trauma + Math.max(0, n))
}
export function getTrauma() {
  return trauma
}
/** current smoothed camera roll (rad) — PlayerRig spine blends 30% of it */
export function getCamRoll() {
  return camRollCurrent
}
/**
 * 0..1 opacity the player rig should render at. Drops as the collision boom
 * pulls the camera into the frame so plates dissolve instead of clipping
 * through the near plane. Read by PlayerRig each frame.
 */
export function getPlayerFade() {
  return playerFade
}
/**
 * Directional positional camera punch (world space). `dir` need not be
 * normalised; `n` is metres of kick at full strength. Decays at cam.kickDecay.
 */
export function addCamKick(dir: THREE.Vector3, n: number) {
  const l = dir.length()
  if (l < 1e-5 || n <= 0) return
  _kick.addScaledVector(dir, n / l)
  const k = _kick.length()
  if (k > 0.6) _kick.multiplyScalar(0.6 / k)
}

/** cheap smooth 1D noise (layered incommensurate sines) in [-1,1] */
function noise1(t: number, seed: number): number {
  return (
    Math.sin(t * 1.9 + seed) * 0.5 +
    Math.sin(t * 4.7 + seed * 1.3) * 0.3 +
    Math.sin(t * 9.3 + seed * 2.1) * 0.2
  )
}

const _head = new THREE.Vector3()
const _look = new THREE.Vector3()
const _right = new THREE.Vector3()
const _desired = new THREE.Vector3()
const _boomDir = new THREE.Vector3()
const _boomUp = new THREE.Vector3()
const _boomRight = new THREE.Vector3()
const _probe = new THREE.Vector3()
const _off = new THREE.Vector3()
const _introFrom = new THREE.Vector3()

/** rim probe offsets in (right, up) boom-plane units — a 4-point sphere sweep */
const RIM: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
]

/**
 * Sphere-swept boom length: cast the axis ray plus 4 rim rays offset by
 * `radius` in the plane perpendicular to the boom, and keep the shortest
 * clearance. A single ray happily threads a 0.4 m gap and leaves the camera
 * inside a wall slab; this does not.
 */
function sweptBoom(head: THREE.Vector3, dir: THREE.Vector3, dist: number, radius: number): number {
  let allowed = dist
  const hit = raycastLevel(head, dir, dist)
  if (hit) allowed = hit.distance - MOVE.cam.boomMargin
  // build a stable basis perpendicular to the boom
  _boomRight.set(dir.z, 0, -dir.x)
  if (_boomRight.lengthSq() < 1e-6) _boomRight.set(1, 0, 0)
  _boomRight.normalize()
  _boomUp.crossVectors(dir, _boomRight).normalize()
  for (const [rx, ry] of RIM) {
    _probe
      .copy(head)
      .addScaledVector(_boomRight, rx * radius)
      .addScaledVector(_boomUp, ry * radius)
    const h = raycastLevel(_probe, dir, dist)
    if (h) {
      const a = h.distance - MOVE.cam.boomMargin
      if (a < allowed) allowed = a
    }
  }
  return Math.max(allowed, MOVE.cam.boomMin)
}

/** intro pitch: from the high fly-in start it looks down onto the dais */
const INTRO_PITCH = -0.71

export default function CameraRig() {
  const s = useRef({
    pos: new THREE.Vector3(0, 3, 8),
    aimT: 0,
    crouchDrop: 0,
    roll: 0,
    kick: 0,
    fov: MOVE.cam.baseFov as number,
    time: 0,
    glideBobPhase: 0,
    dip: 0,
    /** 0..1 ultimate camera-state blend */
    ultT: 0,
    /** 0..1 wall-run shoulder-swap blend */
    wallT: 0,
    /** previous grounded flag, for the landing punch */
    wasGrounded: true,
    prevVy: 0,
    landFov: 0,
    /** seconds elapsed in the DROPSHIP fly-in (0 while in any other phase) */
    introT: 0,
  })

  useFrame(({ camera }, delta) => {
    const c = s.current
    // integration clamp relaxed to 0.1; timers that must track wall-clock
    // (intro below) use the raw unclamped delta instead.
    const dt = Math.min(delta, 0.1)
    c.time += dt

    const st = useGameStore.getState()
    const playing = st.phase !== 'WIN' && st.phase !== 'LOSE' && st.hp > 0
    // DROPSHIP cinematic: scripted fly-in, player look is ignored
    const intro = st.phase === 'DROPSHIP'
    // intro skipped mid-flight (Space/click/Esc → INFILTRATE): snap the boom
    // straight to the gameplay position instead of easing from the fly-in
    const introSkipped = !intro && c.introT > 0 && c.introT < MISSION.dropshipDurationSec
    let introEase = 1
    if (intro) {
      // REAL unclamped time — the 3s sweep must not dilate at low fps
      c.introT += delta
      const t = THREE.MathUtils.clamp(c.introT / MISSION.dropshipDurationSec, 0, 1)
      introEase = t * t * (3 - 2 * t) // smoothstep
    } else {
      c.introT = 0
    }

    // -- look ----------------------------------------------------------------
    const lookDelta = Input.consumeLook()
    if (playing && !intro) {
      CamRef.yaw -= lookDelta.dx * MOVE.cam.lookSensitivity
      CamRef.pitch = THREE.MathUtils.clamp(
        CamRef.pitch - lookDelta.dy * MOVE.cam.lookSensitivity,
        -MOVE.cam.pitchLimit,
        MOVE.cam.pitchLimit,
      )
    }

    const yaw = CamRef.yaw
    const pitch = CamRef.pitch
    const cosP = Math.cos(pitch)
    _look.set(-Math.sin(yaw) * cosP, Math.sin(pitch), -Math.cos(yaw) * cosP)
    _right.set(Math.cos(yaw), 0, -Math.sin(yaw)) // flat right

    // -- aim blend -----------------------------------------------------------
    const aiming = playing && !intro && Input.held('aim')
    c.aimT += ((aiming ? 1 : 0) - c.aimT) * (1 - Math.exp(-MOVE.cam.aimLerpRate * dt))

    // -- state-derived offsets -------------------------------------------------
    const state = PlayerRef.state
    const gliding = state === 'glide'
    const sliding = state === 'slide'
    const wallrunning = state === 'wallrunL' || state === 'wallrunR'

    // ultimate camera state — requiemPhase 1 = charging (rooted), 2 = afterglow
    const ulting = CombatState.requiemPhase !== 0
    c.ultT += ((ulting ? 1 : 0) - c.ultT) * (1 - Math.exp(-MOVE.cam.ult.rate * dt))
    // wall-run shoulder swap
    c.wallT += ((wallrunning ? 1 : 0) - c.wallT) * (1 - Math.exp(-7 * dt))

    // crouch camera drop (0.5 m over ~0.08s)
    c.crouchDrop +=
      ((sliding ? MOVE.slide.camDrop : 0) - c.crouchDrop) *
      (1 - Math.exp(-MOVE.slide.camDropRate * dt))

    // landing dip + one-shot FOV punch on touchdown
    const grounded = PlayerRef.isGrounded
    if (grounded && !c.wasGrounded) {
      const impact = Math.max(0, -c.prevVy)
      if (impact > MOVE.landing.hardFallSpeed * 0.5) {
        const n = THREE.MathUtils.clamp(impact / MOVE.terminalFall, 0, 1)
        c.landFov = MOVE.cam.landFovPunch * n
        _kick.y -= 0.18 * n
        addTrauma(0.12 * n)
      }
    }
    c.wasGrounded = grounded
    c.prevVy = PlayerRef.velocity.y
    c.landFov *= Math.exp(-9 * dt)
    if (c.landFov < 0.02) c.landFov = 0

    const dipTarget =
      PlayerAnim.landTimer > 0
        ? THREE.MathUtils.mapLinear(PlayerAnim.landImpact, MOVE.landing.hardFallSpeed, MOVE.terminalFall, 0.06, MOVE.cam.landingDipMax)
        : 0
    c.dip += (dipTarget - c.dip) * (1 - Math.exp(-18 * dt))

    // glide bob (sin 0.6 Hz, ±0.05 m) + a small periodic settle from the gait
    if (gliding) c.glideBobPhase += dt * Math.PI * 2 * MOVE.glide.bobHz
    const bob = gliding ? Math.sin(c.glideBobPhase) * MOVE.glide.bobAmp : 0
    const gaitSettle =
      grounded && PlayerAnim.speed > 1
        ? Math.sin(PlayerAnim.gaitPhase * 2) *
          0.012 *
          THREE.MathUtils.clamp(PlayerAnim.speed / MOVE.sprintSpeed, 0, 1)
        : 0

    // boom offsets, lerped between normal / aim, then through the ult state
    const no = MOVE.cam.offsetNormal
    const ao = MOVE.cam.offsetAim
    let rightOff = THREE.MathUtils.lerp(no.right, ao.right, c.aimT)
    let upOff = THREE.MathUtils.lerp(no.up, ao.up, c.aimT)
    let backOff =
      THREE.MathUtils.lerp(no.back, ao.back, c.aimT) + (gliding ? MOVE.glide.camPullback : 0)

    // wall-run: put the shoulder offset on the side AWAY from the wall so the
    // boom stops sweeping into the slab the player is running along
    if (c.wallT > 0.001) {
      const side = PlayerAnim.wallSide || (state === 'wallrunL' ? -1 : 1)
      const freeSide = -side * Math.abs(rightOff) * MOVE.cam.wallrunSideBias
      rightOff = THREE.MathUtils.lerp(rightOff, freeSide, c.wallT)
    }

    if (c.ultT > 0.001) {
      backOff = THREE.MathUtils.lerp(backOff, MOVE.cam.ult.back, c.ultT)
      upOff = THREE.MathUtils.lerp(upOff, -MOVE.cam.ult.drop, c.ultT)
      rightOff = THREE.MathUtils.lerp(rightOff, MOVE.cam.ult.right, c.ultT)
    }

    _head.copy(PlayerRef.position)
    _head.y += MOVE.cam.headHeight - c.crouchDrop - c.dip + bob + gaitSettle

    _desired.copy(_head).addScaledVector(_look, -backOff).addScaledVector(_right, rightOff)
    _desired.y += upOff
    // push the whole boom off the wall during a wall-run
    if (c.wallT > 0.001 && PlayerRef.wallNormal.lengthSq() > 0.1) {
      _desired.addScaledVector(PlayerRef.wallNormal, MOVE.cam.wallrunNormalPush * c.wallT)
    }

    // -- collision-aware boom (sphere sweep) ---------------------------------------
    _boomDir.copy(_desired).sub(_head)
    const fullDist = _boomDir.length()
    let allowed = fullDist
    if (fullDist > 1e-4) {
      _boomDir.divideScalar(fullDist)
      allowed = Math.min(fullDist, sweptBoom(_head, _boomDir, fullDist, MOVE.cam.boomRadius))
    }
    _desired.copy(_head).addScaledVector(_boomDir, allowed)

    if (intro) {
      // dropship sweep: glide from high above/behind the dais into the boom
      _introFrom.set(_head.x, _head.y + 22, _head.z - 26)
      c.pos.lerpVectors(_introFrom, _desired, introEase)
    } else if (introSkipped) {
      c.pos.copy(_desired) // snap to the gameplay boom position
    } else {
      // damped follow; never lag *into* geometry (snap inward, ease outward)
      const k = 1 - Math.exp(-MOVE.cam.followRate * dt)
      c.pos.lerp(_desired, k)
      _off.copy(c.pos).sub(_head)
      const curDist = _off.length()
      if (curDist > allowed && curDist > 1e-4) {
        c.pos.copy(_head).addScaledVector(_off.divideScalar(curDist), allowed)
      }
    }

    // -- rig proximity fade ----------------------------------------------------------
    // the real distance from the head, not the requested one
    _off.copy(c.pos).sub(_head)
    const realDist = _off.length()
    const fadeT = THREE.MathUtils.clamp(
      (realDist - MOVE.cam.fadeEnd) / Math.max(1e-3, MOVE.cam.fadeStart - MOVE.cam.fadeEnd),
      0,
      1,
    )
    const fadeTarget = intro ? 1 : THREE.MathUtils.lerp(MOVE.cam.fadeMin, 1, fadeT)
    playerFade += (fadeTarget - playerFade) * (1 - Math.exp(-16 * dt))

    // -- trauma shake --------------------------------------------------------------
    trauma = Math.max(0, trauma - MOVE.cam.traumaDecay * dt)
    const amp = trauma * trauma * MOVE.cam.shakeAmp
    const shX = noise1(c.time * 6.1, 0.0) * amp
    const shY = noise1(c.time * 6.1, 3.7) * amp
    const shZ = noise1(c.time * 6.1, 7.3) * amp * 0.7
    // positional component — rotation-only shake reads as a wobbly tripod
    const pAmp = trauma * trauma * MOVE.cam.shakePosAmp
    const shPx = noise1(c.time * 8.3, 1.7) * pAmp
    const shPy = noise1(c.time * 8.3, 5.1) * pAmp

    // directional positional kick (landing, impacts), exponential recovery
    const kd = Math.exp(-MOVE.cam.kickDecay * dt)
    _kick.multiplyScalar(kd)
    if (_kick.lengthSq() < 1e-8) _kick.set(0, 0, 0)

    const shMul = intro ? introEase : 1
    camera.position.copy(c.pos)
    camera.position.addScaledVector(_right, shPx * shMul)
    camera.position.y += shPy * shMul
    camera.position.addScaledVector(_kick, shMul)

    // -- roll --------------------------------------------------------------------
    let rollTarget = 0
    if (wallrunning) rollTarget = -PlayerAnim.wallSide * MOVE.wallrun.camRoll // tilt toward wall
    else if (sliding) rollTarget = MOVE.cam.slideRoll
    else {
      const strafe = THREE.MathUtils.clamp(
        PlayerRef.velocity.dot(_right) / MOVE.sprintSpeed,
        -1,
        1,
      )
      rollTarget = -strafe * MOVE.cam.strafeLean
    }
    const rollRate = PlayerAnim.rollSnapT > 0 ? 30 : MOVE.wallrun.rollLerp
    c.roll += (rollTarget - c.roll) * (1 - Math.exp(-rollRate * dt))
    camRollCurrent = c.roll

    // during the fly-in, pitch sweeps down→orbit and roll/shake fade in
    const pitchOut = intro ? THREE.MathUtils.lerp(INTRO_PITCH, pitch, introEase) : pitch
    const rollOut = intro ? c.roll * introEase : c.roll
    camera.rotation.order = 'YXZ'
    camera.rotation.set(pitchOut + shX * shMul, yaw + shY * shMul, rollOut + shZ * shMul)

    // -- FOV -----------------------------------------------------------------------
    const baseFov = THREE.MathUtils.lerp(MOVE.cam.baseFov, MOVE.cam.aimFov, c.aimT)
    let kickTarget = 0
    if (state === 'sprint') kickTarget = MOVE.cam.fovKicks.sprint
    else if (sliding) kickTarget = MOVE.cam.fovKicks.slide
    else if (wallrunning) kickTarget = MOVE.cam.fovKicks.wallrun
    else if (gliding) kickTarget = MOVE.cam.fovKicks.glide
    else if (state === 'lunge') kickTarget = MOVE.cam.fovKicks.lunge
    kickTarget += MOVE.cam.ult.fov * c.ultT
    const kickRate = kickTarget > c.kick ? 14 : MOVE.cam.fovKickDecay
    c.kick += (kickTarget - c.kick) * (1 - Math.exp(-kickRate * dt))
    // event pulses (double jump / wall jump) decay exp(-6*dt)
    PlayerAnim.fovPulse *= Math.exp(-MOVE.cam.fovKickDecay * dt)
    if (PlayerAnim.fovPulse < 0.01) PlayerAnim.fovPulse = 0

    const fov = baseFov + c.kick + PlayerAnim.fovPulse - c.landFov
    if (Math.abs(fov - c.fov) > 0.01) {
      c.fov = fov
      const pc = camera as THREE.PerspectiveCamera
      pc.fov = fov
      pc.updateProjectionMatrix()
    }
  }, -8)

  return null
}

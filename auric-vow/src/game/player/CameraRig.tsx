/* eslint-disable react-refresh/only-export-components */
/**
 * AURIC VOW — player/CameraRig.tsx
 * Third-person over-shoulder orbit camera. movement.md §8.
 *
 * - Pointer-lock look via Input.consumeLook (yaw/pitch live in CamRef so the
 *   PlayerController can steer camera-relative movement).
 * - Collision-aware boom (raycastLevel pullback, snap-in / ease-out).
 * - FOV kick table (sprint/slide/wallrun/glide/lunge + event pulses) and
 *   aim FOV 70→55.
 * - Camera roll: ±14° wall-run (ease 8/s, snap-out on wall-jump), −3° slide,
 *   ±2° strafe lean.
 * - Trauma shake: addTrauma(n) — amplitude = trauma², decay 1.2/s,
 *   rotational perlin-ish noise. Exported for combat/abilities.
 */
import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { Input } from '../Input'
import { useGameStore } from '../store'
import { MISSION } from '../config'
import { raycastLevel } from '../world/Colliders'
import { PlayerRef, PlayerAnim } from './PlayerRef'
import { MOVE } from './movementConfig'

/** shared orbit state — read by PlayerController for camera-relative movement */
export const CamRef = { yaw: 0, pitch: -0.08 }

// ---------------------------------------------------------------------------
// Trauma shake API (module-level so combat/abilities can call without react)
// ---------------------------------------------------------------------------
let trauma = 0
let camRollCurrent = 0

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
const _off = new THREE.Vector3()
const _introFrom = new THREE.Vector3()

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

    // crouch camera drop (0.5 m over ~0.08s)
    c.crouchDrop +=
      ((sliding ? MOVE.slide.camDrop : 0) - c.crouchDrop) *
      (1 - Math.exp(-MOVE.slide.camDropRate * dt))

    // landing dip
    const dipTarget =
      PlayerAnim.landTimer > 0
        ? THREE.MathUtils.mapLinear(PlayerAnim.landImpact, MOVE.landing.hardFallSpeed, MOVE.terminalFall, 0.06, MOVE.cam.landingDipMax)
        : 0
    c.dip += (dipTarget - c.dip) * (1 - Math.exp(-18 * dt))

    // glide bob (sin 0.6 Hz, ±0.05 m)
    if (gliding) c.glideBobPhase += dt * Math.PI * 2 * MOVE.glide.bobHz
    const bob = gliding ? Math.sin(c.glideBobPhase) * MOVE.glide.bobAmp : 0

    // boom offsets, lerped between normal / aim
    const no = MOVE.cam.offsetNormal
    const ao = MOVE.cam.offsetAim
    const rightOff = THREE.MathUtils.lerp(no.right, ao.right, c.aimT)
    const upOff = THREE.MathUtils.lerp(no.up, ao.up, c.aimT)
    const backOff =
      THREE.MathUtils.lerp(no.back, ao.back, c.aimT) + (gliding ? MOVE.glide.camPullback : 0)

    _head.copy(PlayerRef.position)
    _head.y += MOVE.cam.headHeight - c.crouchDrop - c.dip + bob

    _desired.copy(_head).addScaledVector(_look, -backOff).addScaledVector(_right, rightOff)
    _desired.y += upOff

    // -- collision-aware boom ---------------------------------------------------
    _boomDir.copy(_desired).sub(_head)
    const fullDist = _boomDir.length()
    let allowed = fullDist
    if (fullDist > 1e-4) {
      _boomDir.divideScalar(fullDist)
      const hit = raycastLevel(_head, _boomDir, fullDist)
      if (hit) allowed = Math.max(hit.distance - MOVE.cam.boomMargin, MOVE.cam.boomMin)
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
    camera.position.copy(c.pos)

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

    // -- trauma shake --------------------------------------------------------------
    trauma = Math.max(0, trauma - MOVE.cam.traumaDecay * dt)
    const amp = trauma * trauma * MOVE.cam.shakeAmp
    const shX = noise1(c.time * 6.1, 0.0) * amp
    const shY = noise1(c.time * 6.1, 3.7) * amp
    const shZ = noise1(c.time * 6.1, 7.3) * amp * 0.7

    // during the fly-in, pitch sweeps down→orbit and roll/shake fade in
    const pitchOut = intro ? THREE.MathUtils.lerp(INTRO_PITCH, pitch, introEase) : pitch
    const rollOut = intro ? c.roll * introEase : c.roll
    const shMul = intro ? introEase : 1
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
    const kickRate = kickTarget > c.kick ? 14 : MOVE.cam.fovKickDecay
    c.kick += (kickTarget - c.kick) * (1 - Math.exp(-kickRate * dt))
    // event pulses (double jump / wall jump) decay exp(-6*dt)
    PlayerAnim.fovPulse *= Math.exp(-MOVE.cam.fovKickDecay * dt)
    if (PlayerAnim.fovPulse < 0.01) PlayerAnim.fovPulse = 0

    const fov = baseFov + c.kick + PlayerAnim.fovPulse
    if (Math.abs(fov - c.fov) > 0.01) {
      c.fov = fov
      const pc = camera as THREE.PerspectiveCamera
      pc.fov = fov
      pc.updateProjectionMatrix()
    }
  }, -8)

  return null
}

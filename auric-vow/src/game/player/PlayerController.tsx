/* eslint-disable react-hooks/immutability, react-refresh/only-export-components */
/**
 * AURIC VOW — player/PlayerController.tsx
 * Kinematic capsule controller + full parkour state machine (movement.md §1–§9).
 *
 * States (PlayerRef.state): run | sprint | slide | wallrunL | wallrunR | air |
 * glide | lunge | dead. Transition priority: LUNGE > WALLRUN > GLIDE > SLIDE >
 * AIR > GROUND.
 *
 * Mutates PlayerRef / PlayerAnim live. Enemies & combat read PlayerRef.
 * Respects store.timeScale (scaled dt) and disables input on WIN/LOSE/death.
 */
import { useEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { Input } from '../Input'
import { useGameStore } from '../store'
import { AudioBus } from '../AudioBus'
import { raycastLevel, collideCapsule } from '../world/Colliders'
import { PlayerRef, PlayerAnim } from './PlayerRef'
import { CamRef } from './CameraRig'
import { MOVE } from './movementConfig'

const UP = new THREE.Vector3(0, 1, 0)
const DOWN = new THREE.Vector3(0, -1, 0)
const WALKABLE_NY = Math.cos((MOVE.walkableSlopeDeg * Math.PI) / 180)

// scratch (no per-frame allocation)
const _center = new THREE.Vector3()
const _fwd = new THREE.Vector3()
const _right = new THREE.Vector3()
const _wish = new THREE.Vector3()
const _hvel = new THREE.Vector3()
const _velDir = new THREE.Vector3()
const _desired = new THREE.Vector3()
const _tangent = new THREE.Vector3()
const _rayDir = new THREE.Vector3()
const _prevVel = new THREE.Vector3()
const _lookDir = new THREE.Vector3()
const _downhill = new THREE.Vector3()

interface Sim {
  grounded: boolean
  coyote: number
  jumpBuf: number
  jumpsLeft: number
  jumpHeld: boolean
  groundNormal: THREE.Vector3
  wallrunTimer: number
  wallrunSpeed: number
  wallMissT: number
  restickTimer: number
  lastWallNormal: THREE.Vector3
  slideTimer: number
  slideDir: THREE.Vector3
  slideSpeed: number
  lungeTimer: number
  lungeCd: number
  lastSlideHopAt: number
  airCap: number
  curHeight: number
  clock: number // scaled-time accumulator
}

/** approach horizontal velocity `cur` toward `target` by at most `maxDelta` */
function approachVec(cur: THREE.Vector3, target: THREE.Vector3, maxDelta: number) {
  const dx = target.x - cur.x
  const dz = target.z - cur.z
  const d = Math.hypot(dx, dz)
  if (d <= maxDelta || d < 1e-6) {
    cur.x = target.x
    cur.z = target.z
  } else {
    const s = maxDelta / d
    cur.x += dx * s
    cur.z += dz * s
  }
}

/** shortest-arc signed angle from a to b */
function angleDelta(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2)
  if (d > Math.PI) d -= Math.PI * 2
  if (d < -Math.PI) d += Math.PI * 2
  return d
}

/** camera look direction with pitch clamped to ±lunge.maxPitch from horizontal */
function lungeLookDir(out: THREE.Vector3): THREE.Vector3 {
  const p = THREE.MathUtils.clamp(CamRef.pitch, -MOVE.lunge.maxPitch, MOVE.lunge.maxPitch)
  const cosP = Math.cos(p)
  return out.set(-Math.sin(CamRef.yaw) * cosP, Math.sin(p), -Math.cos(CamRef.yaw) * cosP)
}

/** module handle to the mounted sim so resetPlayer() can reach it */
let activeSim: Sim | null = null

/**
 * Reset the player (mission retry / respawn). Restores state machine,
 * animation data and optionally teleports to `position` (default: origin drop).
 */
export function resetPlayer(position?: THREE.Vector3 | [number, number, number]) {
  const P = PlayerRef
  if (position) {
    if (Array.isArray(position)) P.position.set(position[0], position[1], position[2])
    else P.position.copy(position)
  } else {
    P.position.set(0, 2, 0)
  }
  P.velocity.set(0, 0, 0)
  P.isGrounded = false
  P.state = 'air'
  P.wallNormal.set(0, 0, 0)
  P.height = MOVE.standHeight

  const A = PlayerAnim
  A.speed = 0
  A.accel.set(0, 0, 0)
  A.gaitPhase = 0
  A.crouch = 0
  A.landImpact = 0
  A.landTimer = 0
  A.fovPulse = 0
  A.lungeT = 0
  A.afterimageT = 0
  A.rollSnapT = 0
  A.wallSide = 0
  A.historyIdx = 0

  if (activeSim) {
    activeSim.grounded = false
    activeSim.coyote = 0
    activeSim.jumpBuf = 0
    activeSim.jumpsLeft = 1
    activeSim.jumpHeld = false
    activeSim.groundNormal.set(0, 1, 0)
    activeSim.wallrunTimer = 0
    activeSim.wallrunSpeed = 0
    activeSim.wallMissT = 1
    activeSim.restickTimer = 0
    activeSim.lastWallNormal.set(0, 0, 0)
    activeSim.slideTimer = 0
    activeSim.slideSpeed = 0
    activeSim.lungeTimer = 0
    activeSim.lungeCd = 0
    activeSim.lastSlideHopAt = -10
    activeSim.airCap = MOVE.walkSpeed + MOVE.airSpeedCapBonus
    activeSim.curHeight = MOVE.standHeight
  }
}

export default function PlayerController() {
  const sim = useRef<Sim>({
    grounded: false,
    coyote: 0,
    jumpBuf: 0,
    jumpsLeft: 1,
    jumpHeld: false,
    groundNormal: new THREE.Vector3(0, 1, 0),
    wallrunTimer: 0,
    wallrunSpeed: 0,
    wallMissT: 1,
    restickTimer: 0,
    lastWallNormal: new THREE.Vector3(),
    slideTimer: 0,
    slideDir: new THREE.Vector3(0, 0, 1),
    slideSpeed: 0,
    lungeTimer: 0,
    lungeCd: 0,
    lastSlideHopAt: -10,
    airCap: MOVE.walkSpeed + MOVE.airSpeedCapBonus,
    curHeight: MOVE.standHeight,
    clock: 0,
  })

  useEffect(() => {
    activeSim = sim.current
    return () => {
      activeSim = null
    }
  }, [])

  // -- per-state step functions -------------------------------------------------

  const stepGround = (dt: number, wishLen: number, sprintHeld: boolean, aiming: boolean) => {
    const P = PlayerRef
    const v = P.velocity
    const sprinting = sprintHeld && wishLen > 0
    let target = sprinting ? MOVE.sprintSpeed : MOVE.walkSpeed
    if (aiming) target *= MOVE.aimMoveMult
    _desired.copy(_wish).multiplyScalar(target * wishLen)
    let rate = wishLen > 0 ? MOVE.groundAccel : MOVE.groundDecel
    if (PlayerAnim.landTimer > 0) rate *= MOVE.landing.recoveryAccelMult
    _hvel.set(v.x, 0, v.z)
    approachVec(_hvel, _desired, rate * dt)
    v.x = _hvel.x
    v.z = _hvel.z
    if (v.y < 0) v.y = -1 // stick to ground
    P.state = sprinting ? 'sprint' : 'run'
  }

  const stepSlide = (dt: number, wishLen: number, attackCancel: boolean) => {
    const P = PlayerRef
    const v = P.velocity
    const m = sim.current
    m.slideTimer += dt
    // flat friction
    m.slideSpeed -= MOVE.slide.friction * dt
    // downhill assist: a = g·sinθ·0.5 along slide dir (ground normal from probe)
    const n = m.groundNormal
    const horiz = Math.hypot(n.x, n.z)
    if (horiz > 1e-4 && n.y < 0.999) {
      const sinT = horiz // sin(θ) of the slope
      _downhill.set(n.x / horiz, 0, n.z / horiz)
      const along = Math.max(0, _downhill.dot(m.slideDir))
      m.slideSpeed += MOVE.gravity * sinT * MOVE.slide.slopeAccelFactor * along * dt
    }
    // gentle steer toward input (±20°/s)
    if (wishLen > 0) {
      const cur = Math.atan2(m.slideDir.z, m.slideDir.x)
      const tgt = Math.atan2(_wish.z, _wish.x)
      const d = THREE.MathUtils.clamp(
        angleDelta(cur, tgt),
        -MOVE.slide.steerRate * dt,
        MOVE.slide.steerRate * dt,
      )
      const na = cur + d
      m.slideDir.set(Math.cos(na), 0, Math.sin(na))
    }
    v.x = m.slideDir.x * m.slideSpeed
    v.z = m.slideDir.z * m.slideSpeed
    if (v.y < 0) v.y = -1
    if (attackCancel) {
      // fire/slash cancel: stand instantly, keep 70% speed
      endSlide(MOVE.slide.cancelKeepSpeed)
    } else if (m.slideSpeed < MOVE.slide.minSpeed || m.slideTimer >= MOVE.slide.maxDuration) {
      endSlide(1)
    }
  }

  const endSlide = (keepMult: number) => {
    const m = sim.current
    const P = PlayerRef
    const sp = m.slideSpeed * keepMult
    P.velocity.x = m.slideDir.x * sp
    P.velocity.z = m.slideDir.z * sp
    P.state = sp > MOVE.walkSpeed ? 'sprint' : 'run'
  }

  const stepAir = (dt: number, wishLen: number) => {
    const v = PlayerRef.velocity
    const m = sim.current
    if (wishLen > 0) {
      _hvel.set(v.x, 0, v.z)
      const prevLen = _hvel.length()
      _hvel.addScaledVector(_wish, MOVE.airAccel * MOVE.airControl * dt)
      const len = _hvel.length()
      if (len > m.airCap && len > prevLen) _hvel.multiplyScalar(Math.max(prevLen, m.airCap) / len)
      v.x = _hvel.x
      v.z = _hvel.z
    }
    v.y = Math.max(v.y - MOVE.gravity * dt, -MOVE.terminalFall)
  }

  const stepGlide = (dt: number, wishLen: number, jumpHeld: boolean) => {
    const P = PlayerRef
    const v = P.velocity
    const m = sim.current
    if (!jumpHeld) {
      P.state = 'air'
      m.airCap = Math.max(Math.hypot(v.x, v.z), MOVE.walkSpeed) + MOVE.airSpeedCapBonus
      return
    }
    const diving = CamRef.pitch < -MOVE.glide.divePitch
    const fallTarget = diving ? -MOVE.glide.diveFall : -MOVE.glide.fallClamp
    v.y += (fallTarget - v.y) * (1 - Math.exp(-MOVE.glide.fallLerp * dt))
    // passive forward push in look-flat direction (+dive boost) and ×1.2 steering
    _hvel.set(v.x, 0, v.z)
    _hvel.addScaledVector(_fwd, (MOVE.glide.forwardPush + (diving ? MOVE.glide.diveBoost : 0)) * dt)
    if (wishLen > 0) {
      _hvel.addScaledVector(_wish, MOVE.airAccel * MOVE.airControl * MOVE.glide.steerMult * dt)
    }
    const len = _hvel.length()
    const cap = 14
    if (len > cap) _hvel.multiplyScalar(cap / len)
    v.x = _hvel.x
    v.z = _hvel.z
  }

  const stepWallrun = (dt: number) => {
    const P = PlayerRef
    const v = P.velocity
    const m = sim.current
    const side = P.state === 'wallrunL' ? -1 : 1
    m.wallrunTimer -= dt

    // re-probe the wall along its inward normal (stable under camera orbit)
    _center.copy(P.position)
    _center.y += m.curHeight * 0.5
    _rayDir.copy(P.wallNormal).multiplyScalar(-1)
    const hit = raycastLevel(_center, _rayDir, MOVE.wallrun.rayDist + 0.15, ['wallrun'])
    let valid = !!hit && Math.abs(hit.normal.y) <= MOVE.wallrun.maxNormalY
    if (valid && hit) {
      P.wallNormal.copy(hit.normal)
      m.wallMissT = 0
    } else {
      m.wallMissT += dt
      // alley zig-zag: opposite wall within the switch window
      _rayDir.copy(P.wallNormal) // away from current wall = toward the far wall
      const opp = raycastLevel(_center, _rayDir, MOVE.wallrun.rayDist, ['wallrun'])
      if (opp && Math.abs(opp.normal.y) <= MOVE.wallrun.maxNormalY && m.wallMissT <= MOVE.wallrun.switchWindow) {
        P.wallNormal.copy(opp.normal)
        PlayerAnim.wallSide = -side
        P.state = side < 0 ? 'wallrunR' : 'wallrunL'
        valid = true
      }
    }

    // run along the wall tangent (in the direction of travel)
    _velDir.set(v.x, 0, v.z)
    _tangent.crossVectors(UP, P.wallNormal).normalize()
    if (_tangent.dot(_velDir) < 0) _tangent.negate()

    m.wallrunSpeed = Math.min(m.wallrunSpeed + MOVE.wallrun.accel * dt, MOVE.wallrun.maxSpeed)
    v.copy(_tangent).multiplyScalar(m.wallrunSpeed)
    v.addScaledVector(P.wallNormal, -MOVE.wallrun.stickAccel * dt) // auto-stick hug
    v.y -= MOVE.gravity * MOVE.wallrun.gravityMult * dt // 15% gravity sink
    v.y = Math.max(v.y, -6)

    if (
      m.wallrunTimer <= 0 ||
      (!valid && m.wallMissT > MOVE.wallrun.switchWindow) ||
      m.wallrunSpeed < MOVE.wallrun.endMinSpeed
    ) {
      m.restickTimer = MOVE.wallrun.restickCooldown
      m.lastWallNormal.copy(P.wallNormal)
      P.wallNormal.set(0, 0, 0)
      PlayerAnim.wallSide = 0
      m.airCap = Math.max(m.wallrunSpeed, MOVE.walkSpeed) + MOVE.airSpeedCapBonus
      P.state = 'air'
    }
  }

  const stepLunge = (dt: number) => {
    const P = PlayerRef
    const m = sim.current
    m.lungeTimer -= dt
    PlayerAnim.lungeT = 1 - Math.max(0, m.lungeTimer) / MOVE.lunge.duration
    P.velocity.y -= MOVE.gravity * MOVE.lunge.gravityMult * dt // 25% gravity, no air control
    if (m.lungeTimer <= 0) {
      m.jumpsLeft = 1 // double jump restored after lunge
      const hs = Math.hypot(P.velocity.x, P.velocity.z)
      m.airCap = Math.max(hs, MOVE.walkSpeed) + MOVE.airSpeedCapBonus
      P.state = 'air'
    }
  }

  const stepDead = (dt: number) => {
    const v = PlayerRef.velocity
    v.x *= Math.exp(-6 * dt)
    v.z *= Math.exp(-6 * dt)
    v.y = Math.max(v.y - MOVE.gravity * dt, -MOVE.terminalFall)
  }

  // -- main frame -----------------------------------------------------------------

  useFrame((_, delta) => {
    const m = sim.current
    const st = useGameStore.getState()
    // integration clamp relaxed to 0.1 so low fps doesn't dilate movement
    const dt = Math.min(delta, 0.1) * st.timeScale
    if (dt <= 0) return
    m.clock += dt

    const P = PlayerRef
    const A = PlayerAnim
    const v = P.velocity

    // -- input gating -------------------------------------------------------------
    const alive = st.hp > 0 && P.state !== 'dead'
    if (!alive && P.state !== 'dead') P.state = 'dead'
    const inputEnabled =
      alive && st.phase !== 'WIN' && st.phase !== 'LOSE' && st.phase !== 'DROPSHIP'

    const jumpPressed = inputEnabled && Input.pressed('jump')
    const crouchPressed = inputEnabled && Input.pressed('crouch')
    // non-consuming peeks: combat owns fire/slash edges
    const attackCancel = inputEnabled && (Input.peekPressed('fire') || Input.peekPressed('slash'))
    const jumpHeld = inputEnabled && Input.held('jump')
    const sprintHeld = inputEnabled && Input.held('sprint')
    const aiming = inputEnabled && Input.held('aim')

    // camera-relative wish direction
    const ax = inputEnabled ? Input.moveAxis() : { x: 0, z: 0 }
    _fwd.set(-Math.sin(CamRef.yaw), 0, -Math.cos(CamRef.yaw))
    _right.set(Math.cos(CamRef.yaw), 0, -Math.sin(CamRef.yaw))
    _wish.set(0, 0, 0).addScaledVector(_fwd, ax.z).addScaledVector(_right, ax.x)
    const wishLen = Math.min(1, _wish.length())
    if (wishLen > 1e-4) _wish.divideScalar(_wish.length())

    // -- timers ---------------------------------------------------------------------
    m.coyote = Math.max(0, m.coyote - dt)
    m.jumpBuf = Math.max(0, m.jumpBuf - dt)
    m.restickTimer = Math.max(0, m.restickTimer - dt)
    m.lungeCd = Math.max(0, m.lungeCd - dt)
    A.landTimer = Math.max(0, A.landTimer - dt)
    A.rollSnapT = Math.max(0, A.rollSnapT - dt)
    A.afterimageT = Math.max(0, A.afterimageT - dt)
    A.landImpact = Math.max(0, A.landImpact - dt * 60)

    // -- capsule height (slide squash / stand with headroom check) --------------------
    const wantCrouch = P.state === 'slide'
    if (!wantCrouch && m.curHeight < MOVE.standHeight - 0.01) {
      const blocked = collideCapsule(P.position, P.radius, MOVE.standHeight).length > 0
      if (!blocked) m.curHeight = Math.min(MOVE.standHeight, m.curHeight + dt * 8)
    } else {
      m.curHeight += ((wantCrouch ? MOVE.crouchHeight : MOVE.standHeight) - m.curHeight) * (1 - Math.exp(-20 * dt))
    }
    P.height = m.curHeight

    // -- grounding probe (raycast down from capsule center) ----------------------------
    _center.copy(P.position)
    _center.y += m.curHeight * 0.5
    const groundHit = raycastLevel(_center, DOWN, m.curHeight * 0.5 + MOVE.groundSnap)
    const rayGrounded = !!groundHit && groundHit.normal.y >= WALKABLE_NY && v.y <= 0.01
    m.grounded = rayGrounded
    if (rayGrounded && groundHit) m.groundNormal.copy(groundHit.normal)
    if (m.grounded) {
      m.coyote = MOVE.coyoteTime
      m.jumpsLeft = 1
      if (P.state === 'air' || P.state === 'glide') onLand(v.y)
    }

    // -- kill-z -------------------------------------------------------------------------
    if (P.position.y < MOVE.killZ) {
      useGameStore.setState({ hp: 0, shield: 0 })
      P.state = 'dead'
    }

    // ==========================================================================
    // TRANSITIONS (priority: LUNGE > WALLRUN > GLIDE > SLIDE > AIR > GROUND)
    // ==========================================================================

    // --- Bullet Lunge triggers ---------------------------------------------------
    if (P.state !== 'dead' && P.state !== 'lunge' && m.lungeCd <= 0) {
      const inAir = !m.grounded && P.state !== 'wallrunL' && P.state !== 'wallrunR'
      const slideHopChain = inAir && m.clock - m.lastSlideHopAt <= MOVE.lunge.slideHopWindow
      if ((jumpPressed && inAir && sprintHeld) || (jumpPressed && slideHopChain) || (crouchPressed && inAir)) {
        startLunge()
      }
    }

    // --- jump / crouch presses not consumed by lunge -------------------------------
    if (P.state !== 'lunge' && P.state !== 'dead') {
      if (jumpPressed) {
        if (P.state === 'slide') {
          slideHop()
        } else if (P.state === 'wallrunL' || P.state === 'wallrunR') {
          wallJump()
        } else if (m.grounded || m.coyote > 0) {
          v.y = MOVE.jumpVel
          m.grounded = false
          m.coyote = 0
          AudioBus.playWhoosh()
          P.state = 'air'
        } else if (m.jumpsLeft > 0 && P.state === 'air') {
          m.jumpsLeft--
          v.y = MOVE.doubleJumpVel
          A.fovPulse = Math.max(A.fovPulse, MOVE.cam.fovKicks.doubleJump)
          AudioBus.playWhoosh()
        } else {
          m.jumpBuf = MOVE.jumpBuffer
        }
      }
      if (
        crouchPressed &&
        m.grounded &&
        P.state !== 'slide' &&
        Math.hypot(v.x, v.z) >= MOVE.slide.triggerMinSpeed
      ) {
        // slide entry: boost current speed ×1.25 clamped [10, 14]
        const sp = Math.hypot(v.x, v.z)
        if (sp > 0.5) m.slideDir.set(v.x / sp, 0, v.z / sp)
        else m.slideDir.copy(_fwd)
        m.slideSpeed = THREE.MathUtils.clamp(sp * MOVE.slide.boostMult, MOVE.slide.boostMin, MOVE.slide.boostMax)
        m.slideTimer = 0
        P.state = 'slide'
      }
    }

    // --- wall-run entry ---------------------------------------------------------------
    if (P.state === 'air' && Math.hypot(v.x, v.z) >= MOVE.wallrun.minSpeed) {
      _velDir.set(v.x, 0, v.z).normalize()
      const moveDir = wishLen > 0 ? _wish : _velDir
      for (const side of [-1, 1] as const) {
        _rayDir.copy(_right).multiplyScalar(side)
        const hit = raycastLevel(_center, _rayDir, MOVE.wallrun.rayDist, ['wallrun'])
        if (!hit) continue
        const n = hit.normal
        if (Math.abs(n.y) > MOVE.wallrun.maxNormalY) continue
        if (m.restickTimer > 0 && n.dot(m.lastWallNormal) > MOVE.wallrun.restickDot) continue
        _tangent.crossVectors(UP, n).normalize()
        if (_tangent.dot(_velDir) < 0) _tangent.negate()
        if (moveDir.dot(_tangent) < MOVE.wallrun.tangentDot) continue
        // enter wall-run: locked speed min 8, resets jump + wallrun resources
        P.wallNormal.copy(n)
        A.wallSide = side
        m.wallrunSpeed = Math.max(Math.hypot(v.x, v.z), MOVE.wallrun.entryMinSpeed)
        m.wallrunTimer = MOVE.wallrun.duration
        m.wallMissT = 0
        m.jumpsLeft = 1
        v.y = Math.min(v.y, 0)
        P.state = side < 0 ? 'wallrunL' : 'wallrunR'
        break
      }
    }

    // --- glide entry ---------------------------------------------------------------------
    if (P.state === 'air' && jumpHeld && v.y < 0 && m.lungeTimer <= 0) {
      P.state = 'glide'
    }

    // ==========================================================================
    // PER-STATE PHYSICS
    // ==========================================================================
    switch (P.state) {
      case 'run':
      case 'sprint':
        stepGround(dt, wishLen, sprintHeld, aiming)
        break
      case 'slide':
        stepSlide(dt, wishLen, attackCancel)
        break
      case 'air':
        stepAir(dt, wishLen)
        break
      case 'glide':
        stepGlide(dt, wishLen, jumpHeld)
        break
      case 'wallrunL':
      case 'wallrunR':
        stepWallrun(dt)
        break
      case 'lunge':
        stepLunge(dt)
        break
      case 'dead':
        stepDead(dt)
        break
    }

    // jump cut: releasing Space early while rising halves upward velocity
    if (m.jumpHeld && !jumpHeld && v.y > 0 && P.state === 'air') {
      v.y *= MOVE.jumpCutMult
    }
    m.jumpHeld = jumpHeld

    // -- integrate + collide ------------------------------------------------------------
    _prevVel.copy(v)
    P.position.addScaledVector(v, dt)

    let pushedUp = false
    let pushLandVy = 0
    const hits = collideCapsule(P.position, P.radius, m.curHeight)
    hits.sort((a, b) => b.mtv.lengthSq() - a.mtv.lengthSq())
    for (const h of hits) {
      P.position.add(h.mtv)
      if (h.mtv.y > 1e-4) {
        pushedUp = true
        if (v.y < 0) {
          pushLandVy = v.y
          v.y = 0
        }
      } else if (h.mtv.y < -1e-4) {
        if (v.y > 0) v.y = 0
      } else {
        const len = h.mtv.length()
        if (len > 1e-6) {
          _rayDir.copy(h.mtv).divideScalar(len)
          const into = v.dot(_rayDir)
          if (into < 0) v.addScaledVector(_rayDir, -into)
        }
      }
    }
    if (pushedUp && !m.grounded) {
      m.grounded = true
      m.coyote = MOVE.coyoteTime
      m.jumpsLeft = 1
      if (P.state === 'air' || P.state === 'glide') onLand(pushLandVy)
    }
    P.isGrounded = m.grounded

    // grounded-state resolution
    if (m.grounded && (P.state === 'air' || P.state === 'glide')) {
      P.state = sprintHeld && wishLen > 0 ? 'sprint' : 'run'
    }
    if (m.grounded && (P.state === 'wallrunL' || P.state === 'wallrunR')) {
      // ran the wall down to the floor — detach
      m.restickTimer = MOVE.wallrun.restickCooldown
      m.lastWallNormal.copy(P.wallNormal)
      P.wallNormal.set(0, 0, 0)
      A.wallSide = 0
      P.state = sprintHeld && wishLen > 0 ? 'sprint' : 'run'
    }
    if (!m.grounded && P.state === 'slide' && m.coyote <= 0) {
      // slid off a ledge — carry slide momentum into the air
      const hs = Math.hypot(v.x, v.z)
      m.airCap = Math.max(hs, MOVE.walkSpeed) + MOVE.airSpeedCapBonus
      P.state = 'air'
    }
    if (!m.grounded && (P.state === 'run' || P.state === 'sprint') && m.coyote <= 0) {
      const hs = Math.hypot(v.x, v.z)
      m.airCap = Math.max(hs, MOVE.walkSpeed) + MOVE.airSpeedCapBonus
      P.state = 'air'
    }

    // -- animation / feel data -------------------------------------------------------------
    const hsp = Math.hypot(v.x, v.z)
    A.speed = hsp
    A.accel.set((v.x - _prevVel.x) / dt, 0, (v.z - _prevVel.z) / dt)
    // facing: aim mode faces camera; otherwise face velocity
    let yawTarget = A.moveYaw
    if (aiming) yawTarget = CamRef.yaw + Math.PI
    else if (hsp > 0.5) yawTarget = Math.atan2(v.x, v.z)
    A.moveYaw += angleDelta(A.moveYaw, yawTarget) * (1 - Math.exp(-12 * dt))
    A.crouch += ((wantCrouch ? 1 : 0) - A.crouch) * (1 - Math.exp(-14 * dt))
    if (P.state !== 'wallrunL' && P.state !== 'wallrunR') A.wallSide = 0

    // transform history ring buffer (afterimage ghosts)
    const hist = A.history
    if (hist.length < 24) hist.push({ pos: new THREE.Vector3(), yaw: 0, roll: 0 })
    const slot = hist[A.historyIdx % 24]
    slot.pos.copy(P.position)
    slot.yaw = A.moveYaw
    slot.roll = P.state === 'lunge' ? A.lungeT * Math.PI * 2 : 0
    A.historyIdx++

    // =========================================================================
    // frame-local helpers (closures over this frame's input/state)
    // =========================================================================

    function onLand(fallVy: number) {
      const fallSpeed = Math.max(0, -fallVy)
      if (fallSpeed > MOVE.landing.hardFallSpeed) {
        A.landTimer = MOVE.landing.recoveryTime
        A.landImpact = fallSpeed
      }
      m.jumpsLeft = 1
      m.wallrunTimer = MOVE.wallrun.duration
      m.restickTimer = 0
      // buffered jump fires on landing
      if (m.jumpBuf > 0 && inputEnabled) {
        m.jumpBuf = 0
        v.y = MOVE.jumpVel
        m.grounded = false
        AudioBus.playWhoosh()
        P.state = 'air'
      }
    }

    function slideHop() {
      m.slideSpeed = m.slideSpeed * MOVE.slide.hopSpeedMult + MOVE.slide.hopSpeedBonus
      v.x = m.slideDir.x * m.slideSpeed
      v.z = m.slideDir.z * m.slideSpeed
      v.y = MOVE.jumpVel
      m.grounded = false
      m.jumpsLeft = 1
      m.lastSlideHopAt = m.clock
      m.airCap = Math.max(m.slideSpeed, MOVE.walkSpeed) + MOVE.airSpeedCapBonus
      AudioBus.playWhoosh()
      P.state = 'air'
    }

    function startLunge() {
      lungeLookDir(_lookDir)
      v.copy(_lookDir).multiplyScalar(MOVE.lunge.speed)
      m.lungeTimer = MOVE.lunge.duration
      m.lungeCd = MOVE.lunge.cooldown
      A.lungeT = 0
      A.afterimageT = 0.4
      m.grounded = false
      AudioBus.playWhoosh()
      P.state = 'lunge'
    }

    function wallJump() {
      const n = P.wallNormal
      _velDir.set(v.x, 0, v.z)
      _tangent.crossVectors(UP, n).normalize()
      if (_tangent.dot(_velDir) < 0) _tangent.negate()
      v.copy(n).multiplyScalar(MOVE.wallrun.jumpNormal)
      v.y = MOVE.wallrun.jumpUp
      v.addScaledVector(_tangent, MOVE.wallrun.jumpTangent)
      m.jumpsLeft = 1 // wall-jump restores double jump
      m.grounded = false
      A.fovPulse = Math.max(A.fovPulse, MOVE.cam.fovKicks.wallJump)
      A.rollSnapT = 0.2 // roll snaps to 0 over 0.2s
      AudioBus.playWhoosh()
      P.state = 'air'
      m.airCap = Math.max(Math.hypot(v.x, v.z), MOVE.walkSpeed) + MOVE.airSpeedCapBonus
    }
  }, -10)

  return null
}

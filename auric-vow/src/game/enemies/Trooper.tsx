/**
 * AURIC VOW — enemies/Trooper.tsx
 * "VOTARY" Trooper — core infantry (enemies-mission.md §2).
 *
 * R1 art pass: the trooper used to be an ivory box stack wearing the same
 * palette as the architecture, with one sine per limb. It is now a DARK
 * carapace with crimson energy, a broad angular pauldron deck (~0.92 m span)
 * and a crested helmet, so its silhouette reads as "infantry" at 40 m and
 * never as level dressing. Locomotion has thigh/shin/foot chains, a counter-
 * rotating spine, a blended in/out locomotion weight and an additive aim
 * layer. Every attack telegraphs: burst fire flares the visor 0.35 s early,
 * melee has a 0.42 s raised-blade windup before it can damage anything.
 *
 * AI: GUARD → ALERT (0.5 s weapon raise) → ATTACK (8–18 m band strafe, LOS
 * burst-fire with eye-flare telegraph, wound-up melee < 2 m) / RUSH variant
 * (a fixed minority of the squad, not "everyone whenever 3 are alive")
 * → STAGGER (kneel 1.2 s) → dissolve death.
 */
import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { PlayerRef } from '@/game/player/PlayerRef'
import { useGameStore } from '@/game/store'
import { AudioBus } from '@/game/AudioBus'
import { VFX } from '@/game/vfx/VFXBus'
import { ENEMY_LOOK, ENEMY_SPAWN, PLAYER } from '@/game/config'
import { broadcastAlert, type EnemyEntity } from './EnemyRegistry'
import {
  canSeePlayer,
  hasLineOfSight,
  integrateGround,
  markThreat,
  clearThreat,
  separationForce,
  turnToward,
  whiskerSteer,
  PERCEPTION_INTERVAL,
} from './ai'
import { patchDissolve, makeOutlineMaterial } from './dissolve'
import { fireEnemyBolt } from './EnemyProjectiles'

const SPEED_PATROL = 2
const SPEED_COMBAT = 4.5
const SPEED_RUSH = 6
const DETECT_RANGE = 22
const DETECT_FOV = 110
const BAND_MIN = 8
const BAND_MAX = 18
const FALLBACK_DIST = 5
const BURST_INTERVAL = 1.8
const BURST_TELEGRAPH = 0.35
const BURST_SHOTS = 3
const BURST_GAP = 0.1
const BOLT_SPEED = 30
const BOLT_DAMAGE = 5
const MELEE_RANGE = 2.0
const MELEE_WINDUP = 0.42
const MELEE_STRIKE = 0.12
const MELEE_DAMAGE = 10
const MELEE_COOLDOWN = 1.4
const LOS_GRACE = 2.5
const STRIDE_HZ = 1.05 // strides per metre travelled → ~1.9 m steps

const _v = new THREE.Vector3()
const _desired = new THREE.Vector3()
const _sep = new THREE.Vector3()
const _aimAt = new THREE.Vector3()
const _fx = new THREE.Vector3()
const _tmp = new THREE.Vector3()
const EYE_DIM = new THREE.Color(ENEMY_LOOK.accent).multiplyScalar(0.45)
const EYE_FULL = new THREE.Color(ENEMY_LOOK.accent)
const EYE_HOT = new THREE.Color(ENEMY_LOOK.accentHot)

export function Trooper({ entity }: { entity: EnemyEntity }) {
  const group = useRef<THREE.Group>(null)
  const bodyGroup = useRef<THREE.Group>(null) // hunch + kneel + death fall
  const spine = useRef<THREE.Group>(null) // counter-rotation + aim layer
  const hipL = useRef<THREE.Group>(null)
  const hipR = useRef<THREE.Group>(null)
  const kneeL = useRef<THREE.Group>(null)
  const kneeR = useRef<THREE.Group>(null)
  const armL = useRef<THREE.Group>(null)
  const armR = useRef<THREE.Group>(null)
  const elbowR = useRef<THREE.Group>(null)
  const gun = useRef<THREE.Group>(null)

  const facing = useRef(new THREE.Vector3(0, 0, 1))
  const walkPhase = useRef(Math.random() * Math.PI * 2)
  const strafeDir = useRef(Math.random() < 0.5 ? 1 : -1)
  const locoW = useRef(0) // 0..1 locomotion blend weight (kills the snap)
  const idleClock = useRef(entity.id * 0.73) // always-running clock for the breath (per-unit phase)
  const flinch = useRef(0)
  const flinchYaw = useRef(0)
  const prevFlash = useRef(0)
  const shadowsOff = useRef(false)
  /** fixed per-soldier trait — a minority rush, the rest hold the fire band */
  const isRusher = useRef(Math.random() < ENEMY_SPAWN.rushShare)

  const mats = useMemo(() => {
    const plate = new THREE.MeshStandardMaterial({
      color: ENEMY_LOOK.shellLit,
      metalness: 0.45,
      roughness: 0.52,
    })
    const shell = new THREE.MeshStandardMaterial({
      color: ENEMY_LOOK.shell,
      metalness: 0.35,
      roughness: 0.62,
    })
    const gunmetal = new THREE.MeshStandardMaterial({
      color: ENEMY_LOOK.joint,
      metalness: 0.9,
      roughness: 0.34,
    })
    const eye = new THREE.MeshBasicMaterial({ color: ENEMY_LOOK.accent, toneMapped: false })
    const core = new THREE.MeshBasicMaterial({
      color: ENEMY_LOOK.accent,
      toneMapped: false,
      transparent: true,
    })
    const barrel = new THREE.MeshBasicMaterial({ color: ENEMY_LOOK.accentHot, toneMapped: false })
    const dPlate = patchDissolve(plate)
    const dShell = patchDissolve(shell)
    const dGun = patchDissolve(gunmetal, { rimStrength: ENEMY_LOOK.rimStrength * 0.5 })
    const outline = makeOutlineMaterial()
    return { plate, shell, gunmetal, eye, core, barrel, dPlate, dShell, dGun, outline }
  }, [])

  useEffect(() => {
    return () => {
      mats.plate.dispose()
      mats.shell.dispose()
      mats.gunmetal.dispose()
      mats.eye.dispose()
      mats.core.dispose()
      mats.barrel.dispose()
      mats.outline.dispose()
    }
  }, [mats])

  useFrame((_, delta) => {
    const s = useGameStore.getState()
    if (s.phase === 'WIN' || s.phase === 'LOSE') return
    const dt = Math.min(delta, 0.05) * s.timeScale
    const g = group.current
    if (!g) return

    const e = entity
    // new-hit edge detect → flinch impulse + directional spark (N5)
    if (e.hitFlash > prevFlash.current + 0.001 && e.alive) {
      flinch.current = 1
      _v.subVectors(PlayerRef.position, e.position).setY(0)
      flinchYaw.current = Math.atan2(_v.x, _v.z)
      _fx.copy(e.position).setY(e.position.y + 1.2).addScaledVector(_v.normalize(), 0.3)
      VFX.burst({
        position: _fx,
        color: ENEMY_LOOK.accentHot,
        count: 4,
        speed: 4,
        life: 0.22,
        size: 0.04,
        gravity: -3,
      })
    }
    prevFlash.current = e.hitFlash
    e.hitFlash = Math.max(0, e.hitFlash - dt)
    flinch.current = Math.max(0, flinch.current - dt * 5)

    if (!e.alive) {
      // corpses must not cast a solid shadow while their shell erodes (N4)
      if (!shadowsOff.current) {
        shadowsOff.current = true
        clearThreat(e.id)
        g.traverse((o) => {
          const m = o as THREE.Mesh
          if (m.isMesh) m.castShadow = false
        })
      }
      const t = Math.min(1, e.deathTimer / e.dissolveSec)
      mats.dPlate.uniform.value = t
      mats.dShell.uniform.value = t
      mats.dGun.uniform.value = t
      mats.outline.setOpacity(ENEMY_LOOK.outline.opacity * Math.max(0, 1 - t * 2.2))
      mats.core.opacity = Math.max(0, 1 - t * 4)
      mats.eye.color.copy(EYE_FULL).multiplyScalar(Math.max(0, 1 - t * 3))
      g.position.copy(e.position)
      // ragdoll-ish collapse: fold at the hips, buckle the knees, fall away
      const fall = Math.min(1, e.deathTimer / 0.45)
      const ease = fall * fall * (3 - 2 * fall)
      g.rotation.x = ease * 1.25
      if (bodyGroup.current) {
        bodyGroup.current.position.y = -0.34 * ease
        bodyGroup.current.rotation.x = 0.55 * ease
        bodyGroup.current.rotation.z = flinchYaw.current * 0.1
      }
      if (kneeL.current) kneeL.current.rotation.x = 1.5 * ease
      if (kneeR.current) kneeR.current.rotation.x = 1.1 * ease
      if (hipL.current) hipL.current.rotation.x = -0.6 * ease
      if (hipR.current) hipR.current.rotation.x = -0.35 * ease
      if (armL.current) armL.current.rotation.x = -0.9 * ease
      if (armR.current) armR.current.rotation.x = 0.7 * ease
      return
    }

    const playerDist = e.position.distanceTo(PlayerRef.position)

    // --- stagger: kneel, visor flickers ---
    if (e.staggerTimer > 0) {
      e.staggerTimer -= dt
      e.velocity.x = 0
      e.velocity.z = 0
      integrateGround(e, dt)
      g.position.copy(e.position)
      const kneel = Math.min(1, 8 * dt)
      if (bodyGroup.current) {
        bodyGroup.current.position.y = THREE.MathUtils.lerp(bodyGroup.current.position.y, -0.42, kneel)
        bodyGroup.current.rotation.x = THREE.MathUtils.lerp(bodyGroup.current.rotation.x, 0.5, kneel)
      }
      if (kneeL.current) kneeL.current.rotation.x = THREE.MathUtils.lerp(kneeL.current.rotation.x, 1.35, kneel)
      if (hipR.current) hipR.current.rotation.x = THREE.MathUtils.lerp(hipR.current.rotation.x, -0.5, kneel)
      if (armR.current) armR.current.rotation.x = THREE.MathUtils.lerp(armR.current.rotation.x, 0.2, kneel)
      mats.eye.color.copy(EYE_HOT).multiplyScalar(Math.random() > 0.4 ? 1 : 0.15)
      if (e.staggerTimer <= 0) e.state = 'attack'
      e.headPosition.copy(e.position).setY(e.position.y + 1.5)
      return
    }
    if (bodyGroup.current) {
      bodyGroup.current.position.y = THREE.MathUtils.lerp(bodyGroup.current.position.y, 0, Math.min(1, 8 * dt))
    }

    // --- perception tick ---
    e.ai.percept = (e.ai.percept ?? 0) - dt
    if (e.ai.percept <= 0) {
      e.ai.percept = PERCEPTION_INTERVAL
      if (!e.alerted && canSeePlayer(e, DETECT_RANGE, DETECT_FOV, facing.current)) {
        e.alerted = true
        e.state = 'alert'
        e.ai.stateT = 0
        AudioBus.playEnemyChirp()
        broadcastAlert(e.position, 15)
      }
    }

    e.ai.stateT = (e.ai.stateT ?? 0) + dt
    e.ai.meleeT = Math.max(0, (e.ai.meleeT ?? 0) - dt)

    // RUSH is a per-soldier trait; desperation only turns the squad's
    // riflemen aggressive once the player is nearly down.
    const rush = e.alerted && (isRusher.current || s.hp < PLAYER.maxHealth * 0.25)

    let moveSpeed = 0
    _desired.set(0, 0, 0)

    switch (e.state) {
      case 'patrol': {
        if (e.waypoints.length > 0) {
          const idx = (e.ai.wpIdx ?? 0) % e.waypoints.length
          const wp = e.waypoints[idx]
          _v.subVectors(wp, e.position).setY(0)
          if (_v.length() < 0.8) e.ai.wpIdx = (idx + 1) % e.waypoints.length
          else {
            _desired.copy(_v).normalize()
            moveSpeed = SPEED_PATROL
          }
        }
        break
      }

      case 'guard': {
        // stand; slow scan yaw handled in visuals
        if (e.alerted) {
          e.state = 'alert'
          e.ai.stateT = 0
          AudioBus.playEnemyChirp()
        }
        break
      }

      case 'alert': {
        // 0.5s weapon raise, face player
        _v.subVectors(PlayerRef.position, e.position)
        turnToward(facing.current, _v, 4 * dt)
        if (e.ai.stateT >= 0.5) {
          e.state = 'attack'
          e.ai.stateT = 0
          e.ai.burstT = BURST_INTERVAL * 0.5
        }
        break
      }

      // ---- wound-up melee (N2): raise → strike → recover ------------------
      case 'meleeWindup': {
        e.velocity.x = 0
        e.velocity.z = 0
        _v.subVectors(PlayerRef.position, e.position).setY(0).normalize()
        turnToward(facing.current, _v, 6 * dt)
        markThreat(e, 'melee', 0.2)
        if (e.ai.stateT >= MELEE_WINDUP) {
          e.state = 'meleeStrike'
          e.ai.stateT = 0
          e.ai.struck = 0
          AudioBus.playEnemyChirp()
        }
        break
      }

      case 'meleeStrike': {
        e.velocity.x = 0
        e.velocity.z = 0
        if (e.ai.struck !== 1 && e.ai.stateT >= MELEE_STRIKE * 0.5) {
          e.ai.struck = 1
          _v.subVectors(PlayerRef.position, e.position).setY(0)
          const facingDot = facing.current.dot(_tmp.copy(_v).normalize())
          if (playerDist < MELEE_RANGE + PlayerRef.radius && facingDot > 0.25) {
            s.damagePlayer(MELEE_DAMAGE)
            s.pushDamageEvent({ position: PlayerRef.position.clone(), amount: MELEE_DAMAGE, kind: 'player' })
            AudioBus.playHurt()
          }
          _fx.copy(e.position).setY(e.position.y + 1.25).addScaledVector(facing.current, 0.75)
          VFX.burst({
            position: _fx,
            color: ENEMY_LOOK.accentHot,
            count: 6,
            speed: 5,
            life: 0.22,
            size: 0.05,
            gravity: -4,
          })
        }
        if (e.ai.stateT >= MELEE_STRIKE + 0.24) {
          e.state = 'attack'
          e.ai.stateT = 0
          e.ai.meleeT = MELEE_COOLDOWN
        }
        break
      }

      case 'attack': {
        _v.subVectors(PlayerRef.position, e.position).setY(0)
        const dist = _v.length()
        _v.normalize()
        turnToward(facing.current, _v, 5 * dt)

        if (rush) {
          // beeline to melee
          _desired.copy(_v)
          moveSpeed = SPEED_RUSH
        } else {
          // LOS bookkeeping — reposition if broken too long
          _aimAt.copy(PlayerRef.position).setY(PlayerRef.position.y + PlayerRef.height * 0.5)
          const los = hasLineOfSight(e.headPosition, _aimAt)
          e.ai.losLost = los ? 0 : (e.ai.losLost ?? 0) + dt

          if (dist < FALLBACK_DIST) {
            // fall back while firing
            _desired.copy(_v).multiplyScalar(-1)
            moveSpeed = SPEED_COMBAT
          } else if (dist > BAND_MAX || e.ai.losLost > LOS_GRACE) {
            _desired.copy(_v) // close in
            moveSpeed = SPEED_COMBAT
          } else if (dist < BAND_MIN) {
            _desired.copy(_v).multiplyScalar(-1)
            moveSpeed = SPEED_COMBAT
          } else {
            // in band: strafe perpendicular, swap sides periodically
            e.ai.strafeT = (e.ai.strafeT ?? 0) + dt
            if (e.ai.strafeT > 2.2) {
              e.ai.strafeT = 0
              strafeDir.current *= -1
            }
            _desired.set(-_v.z * strafeDir.current, 0, _v.x * strafeDir.current)
            moveSpeed = SPEED_COMBAT * 0.6
          }

          // burst fire — only with LOS
          e.ai.burstT = (e.ai.burstT ?? BURST_INTERVAL) - dt
          const telegraphing = e.ai.burstT <= BURST_TELEGRAPH && e.ai.burstT > 0
          if (telegraphing) {
            markThreat(e, 'fire', 0.3)
            if (e.ai.glinted !== 1) {
              e.ai.glinted = 1
              AudioBus.playEnemyChirp()
            }
          }
          if (e.ai.burstT <= 0 && (e.ai.shotsLeft ?? 0) <= 0 && los) {
            e.ai.shotsLeft = BURST_SHOTS
            e.ai.shotT = 0
            e.ai.burstT = BURST_INTERVAL
            e.ai.glinted = 0
          }
        }

        // melee: commit to a wind-up instead of damaging on contact
        if (playerDist < MELEE_RANGE && e.ai.meleeT <= 0) {
          e.state = 'meleeWindup'
          e.ai.stateT = 0
          e.ai.shotsLeft = 0
          AudioBus.playEnemyChirp()
        }
        break
      }

      default: {
        e.state = e.alerted ? 'alert' : e.waypoints.length ? 'patrol' : 'guard'
        e.ai.stateT = 0
        break
      }
    }

    // burst shot release (runs across states so a started burst finishes)
    if ((e.ai.shotsLeft ?? 0) > 0) {
      e.ai.shotT = (e.ai.shotT ?? 0) - dt
      if (e.ai.shotT <= 0) {
        e.ai.shotT = BURST_GAP
        e.ai.shotsLeft -= 1
        markThreat(e, 'fire', 0.5)
        _aimAt.copy(PlayerRef.position).setY(PlayerRef.position.y + PlayerRef.height * 0.45)
        _v.subVectors(_aimAt, e.headPosition)
        if (hasLineOfSight(e.headPosition, _aimAt)) {
          fireEnemyBolt(e.headPosition, _v, BOLT_SPEED, BOLT_DAMAGE)
          e.ai.muzzle = 0.06
        }
      }
    }
    e.ai.muzzle = Math.max(0, (e.ai.muzzle ?? 0) - dt)

    // --- movement ---
    if (moveSpeed > 0) {
      whiskerSteer(e, _desired)
      separationForce(e, _sep)
      _desired.addScaledVector(_sep, 1.5).normalize()
      e.velocity.x = _desired.x * moveSpeed
      e.velocity.z = _desired.z * moveSpeed
      if (e.state === 'patrol') turnToward(facing.current, _desired, 3 * dt)
    } else {
      e.velocity.x = 0
      e.velocity.z = 0
    }
    integrateGround(e, dt)
    e.headPosition.copy(e.position).setY(e.position.y + 1.62)

    // --- visuals ---
    g.position.copy(e.position)
    g.rotation.y = Math.atan2(facing.current.x, facing.current.z)

    // locomotion: distance-locked stride, blended in and out (N8)
    const groundSpeed = Math.hypot(e.velocity.x, e.velocity.z)
    const moving = groundSpeed > 0.35
    locoW.current += ((moving ? 1 : 0) - locoW.current) * Math.min(1, dt * 7)
    walkPhase.current += dt * groundSpeed * STRIDE_HZ * Math.PI
    const w = locoW.current
    const ph = walkPhase.current
    idleClock.current += dt
    const swing = Math.sin(ph) * 0.62 * w
    const lift = Math.max(0, Math.sin(ph)) // 0..1 per leg, offset below
    const liftOpp = Math.max(0, Math.sin(ph + Math.PI))
    // 0.4 Hz breath on its own clock — the stride phase freezes when idle
    const idleBob = Math.sin(idleClock.current * Math.PI * 0.8) * 0.014 * (1 - w)

    if (hipL.current) hipL.current.rotation.x = swing
    if (hipR.current) hipR.current.rotation.x = -swing
    // knees only bend on the recovery half of each stride
    if (kneeL.current) kneeL.current.rotation.x = (0.12 + liftOpp * 1.15) * w
    if (kneeR.current) kneeR.current.rotation.x = (0.12 + lift * 1.15) * w
    // pelvis rise/fall with the stride + idle breath
    if (bodyGroup.current && e.staggerTimer <= 0) {
      const bounce = Math.abs(Math.sin(ph)) * 0.045 * w
      bodyGroup.current.position.y = bounce + idleBob
    }

    // arms: counter-swing when idle-walking, carbine up when alerted
    const meleeing = e.state === 'meleeWindup' || e.state === 'meleeStrike'
    const meleeK = meleeing
      ? e.state === 'meleeWindup'
        ? Math.min(1, (e.ai.stateT ?? 0) / MELEE_WINDUP)
        : 1 - Math.min(1, (e.ai.stateT ?? 0) / (MELEE_STRIKE + 0.24))
      : 0
    const lerpK = Math.min(1, 10 * dt)
    if (armL.current) {
      const target = meleeing ? -0.5 - meleeK * 0.6 : e.alerted ? -1.15 : -swing * 0.75
      armL.current.rotation.x = THREE.MathUtils.lerp(armL.current.rotation.x, target, lerpK)
    }
    if (armR.current) {
      const raise = meleeing ? -2.5 * meleeK + 0.9 * (1 - meleeK) : e.alerted ? -1.25 : swing * 0.75
      armR.current.rotation.x = THREE.MathUtils.lerp(armR.current.rotation.x, raise, lerpK)
      armR.current.rotation.z = THREE.MathUtils.lerp(armR.current.rotation.z, e.alerted && !meleeing ? -0.32 : 0, lerpK)
    }
    if (elbowR.current) {
      elbowR.current.rotation.x = THREE.MathUtils.lerp(
        elbowR.current.rotation.x,
        meleeing ? -0.2 : e.alerted ? -0.85 : -0.15,
        lerpK,
      )
    }

    // spine: forward hunch, counter-rotation against the stride, flinch recoil
    if (spine.current) {
      const hunch = THREE.MathUtils.degToRad(9) + (rush && e.state === 'attack' ? 0.16 : 0)
      const fl = flinch.current * flinch.current
      spine.current.rotation.x =
        hunch + Math.sin(ph * 2) * 0.03 * w + Math.sin(idleClock.current * Math.PI * 0.8) * 0.02 * (1 - w) - fl * 0.28
      spine.current.rotation.y = -Math.sin(ph) * 0.14 * w
      spine.current.rotation.z = Math.sin(ph + 1.2) * 0.05 * w + fl * 0.12
    }
    if (gun.current) gun.current.visible = true

    // visor / core: dim idle, lit in combat, white-hot on telegraph & hits
    const telegraphing =
      (e.state === 'attack' && (e.ai.burstT ?? 1) <= BURST_TELEGRAPH && (e.ai.shotsLeft ?? 0) <= 0) ||
      e.state === 'meleeWindup'
    if (e.hitFlash > 0) {
      mats.eye.color.set('#FFFFFF')
      mats.plate.emissive.setScalar(0.85)
      mats.shell.emissive.setScalar(0.7)
    } else {
      mats.plate.emissive.setScalar(0)
      mats.shell.emissive.setScalar(0)
      if (telegraphing) mats.eye.color.copy(EYE_HOT).multiplyScalar(2.4)
      else mats.eye.color.lerpColors(EYE_DIM, EYE_FULL, e.alerted ? 1 : 0.35)
    }
    mats.core.color.copy(EYE_FULL).multiplyScalar(e.alerted ? 1.25 : 0.6)
    mats.barrel.color
      .copy(EYE_HOT)
      .multiplyScalar((e.ai.muzzle ?? 0) > 0 ? 6 : telegraphing ? 2.2 : 0.7)
  })

  const o = mats.outline.material

  return (
    <group ref={group} position={entity.position.toArray()}>
      <group ref={bodyGroup}>
        {/* ---- pelvis ---- */}
        <mesh material={mats.shell} position={[0, 0.94, 0]} castShadow>
          <boxGeometry args={[0.36, 0.24, 0.26]} />
        </mesh>
        <mesh material={o} position={[0, 0.94, 0]}>
          <boxGeometry args={[0.36, 0.24, 0.26]} />
        </mesh>

        <group ref={spine} position={[0, 1.04, 0]}>
          {/* ---- torso: tapered chest, raised crest, back reactor ---- */}
          <mesh material={mats.shell} position={[0, 0.22, 0]} castShadow>
            <boxGeometry args={[0.46, 0.44, 0.3]} />
          </mesh>
          <mesh material={o} position={[0, 0.22, 0]}>
            <boxGeometry args={[0.46, 0.44, 0.3]} />
          </mesh>
          {/* chest deck plate — catches the key, reads as armour not a box */}
          <mesh material={mats.plate} position={[0, 0.3, 0.155]} rotation-x={-0.22} castShadow>
            <boxGeometry args={[0.38, 0.3, 0.07]} />
          </mesh>
          <mesh material={mats.plate} position={[0, 0.06, 0.13]} rotation-x={0.3} castShadow>
            <boxGeometry args={[0.3, 0.2, 0.06]} />
          </mesh>
          {/* crimson chest core (weakpoint) in a recessed collar */}
          <mesh material={mats.gunmetal} position={[0, 0.2, 0.17]}>
            <cylinderGeometry args={[0.075, 0.09, 0.06, 10]} />
          </mesh>
          <mesh material={mats.core} position={[0, 0.2, 0.2]}>
            <sphereGeometry args={[0.055, 10, 8]} />
          </mesh>
          {/* back pack / power cell */}
          <mesh material={mats.gunmetal} position={[0, 0.2, -0.2]} castShadow>
            <boxGeometry args={[0.3, 0.38, 0.14]} />
          </mesh>
          <mesh material={mats.core} position={[0, 0.06, -0.28]}>
            <boxGeometry args={[0.18, 0.04, 0.02]} />
          </mesh>

          {/* ---- pauldron deck: broad, layered, asymmetric (~0.92 m span) ---- */}
          {[-1, 1].map((side) => (
            <group key={side} position={[side * 0.3, 0.4, 0]}>
              <mesh
                material={mats.plate}
                position={[side * 0.08, 0.02, 0]}
                rotation-z={side * 0.34}
                castShadow
              >
                <boxGeometry args={[0.3, 0.16, 0.34]} />
              </mesh>
              <mesh
                material={mats.shell}
                position={[side * 0.15, -0.08, 0]}
                rotation-z={side * 0.5}
                castShadow
              >
                <boxGeometry args={[0.22, 0.13, 0.3]} />
              </mesh>
              {/* outer spur — the wide read at distance */}
              <mesh
                material={mats.plate}
                position={[side * (side < 0 ? 0.2 : 0.17), 0.08, -0.02]}
                rotation-z={side * 0.18}
                castShadow
              >
                <boxGeometry args={[0.13, 0.1, 0.24]} />
              </mesh>
              <mesh material={o} position={[side * 0.08, 0.02, 0]} rotation-z={side * 0.34}>
                <boxGeometry args={[0.3, 0.16, 0.34]} />
              </mesh>
            </group>
          ))}

          {/* ---- armoured collar + crested helmet ---- */}
          <mesh material={mats.gunmetal} position={[0, 0.46, 0]} castShadow>
            <cylinderGeometry args={[0.1, 0.14, 0.1, 8]} />
          </mesh>
          <mesh material={mats.shell} position={[0, 0.58, -0.01]} castShadow>
            <boxGeometry args={[0.23, 0.24, 0.26]} />
          </mesh>
          <mesh material={o} position={[0, 0.58, -0.01]}>
            <boxGeometry args={[0.23, 0.24, 0.26]} />
          </mesh>
          {/* muzzle-shaped faceplate wedge */}
          <mesh material={mats.plate} position={[0, 0.55, 0.13]} rotation-x={0.22} castShadow>
            <boxGeometry args={[0.19, 0.16, 0.08]} />
          </mesh>
          {/* crest fin — silhouette signature of the VOTARY */}
          <mesh material={mats.plate} position={[0, 0.72, -0.02]} castShadow>
            <boxGeometry args={[0.035, 0.14, 0.26]} />
          </mesh>
          <mesh material={mats.plate} position={[0, 0.66, -0.15]} rotation-x={0.5} castShadow>
            <boxGeometry args={[0.035, 0.12, 0.16]} />
          </mesh>
          {/* horizontal visor slit */}
          <mesh material={mats.eye} position={[0, 0.58, 0.165]}>
            <boxGeometry args={[0.16, 0.032, 0.03]} />
          </mesh>

          {/* ---- arms ---- */}
          <group ref={armL} position={[-0.3, 0.32, 0]}>
            <mesh material={mats.plate} position={[0, -0.06, 0]} castShadow>
              <boxGeometry args={[0.14, 0.14, 0.16]} />
            </mesh>
            <mesh material={mats.gunmetal} position={[0, -0.28, 0]} castShadow>
              <capsuleGeometry args={[0.062, 0.34, 4, 8]} />
            </mesh>
            <mesh material={mats.shell} position={[0, -0.52, 0.04]} castShadow>
              <boxGeometry args={[0.12, 0.26, 0.13]} />
            </mesh>
          </group>
          <group ref={armR} position={[0.3, 0.32, 0]}>
            <mesh material={mats.plate} position={[0, -0.06, 0]} castShadow>
              <boxGeometry args={[0.14, 0.14, 0.16]} />
            </mesh>
            <mesh material={mats.gunmetal} position={[0, -0.26, 0]} castShadow>
              <capsuleGeometry args={[0.062, 0.3, 4, 8]} />
            </mesh>
            <group ref={elbowR} position={[0, -0.42, 0]}>
              <mesh material={mats.shell} position={[0, -0.12, 0.03]} castShadow>
                <boxGeometry args={[0.12, 0.26, 0.13]} />
              </mesh>
              {/* pulse carbine: dark receiver, crimson heat sink */}
              <group ref={gun} position={[-0.14, -0.2, 0.2]} rotation-y={0.18}>
                <mesh material={mats.gunmetal} castShadow>
                  <boxGeometry args={[0.075, 0.1, 0.5]} />
                </mesh>
                <mesh material={mats.shell} position={[0, 0.08, -0.08]} castShadow>
                  <boxGeometry args={[0.06, 0.07, 0.22]} />
                </mesh>
                <mesh material={mats.gunmetal} position={[0, -0.09, -0.12]} rotation-x={-0.28} castShadow>
                  <boxGeometry args={[0.05, 0.16, 0.06]} />
                </mesh>
                <mesh material={mats.barrel} position={[0, 0.0, 0.29]}>
                  <boxGeometry args={[0.022, 0.022, 0.16]} />
                </mesh>
                <mesh material={mats.core} position={[0, 0.045, 0.08]}>
                  <boxGeometry args={[0.03, 0.012, 0.16]} />
                </mesh>
              </group>
            </group>
          </group>
        </group>

        {/* ---- legs: thigh → shin → wedge boot ---- */}
        <group ref={hipL} position={[-0.14, 0.9, 0]}>
          <mesh material={mats.shell} position={[0, -0.2, 0]} castShadow>
            <capsuleGeometry args={[0.085, 0.26, 4, 8]} />
          </mesh>
          <mesh material={mats.plate} position={[-0.03, -0.18, 0.02]} rotation-z={0.12} castShadow>
            <boxGeometry args={[0.1, 0.24, 0.16]} />
          </mesh>
          <group ref={kneeL} position={[0, -0.4, 0]}>
            <mesh material={mats.gunmetal} position={[0, -0.18, 0]} castShadow>
              <capsuleGeometry args={[0.065, 0.28, 4, 8]} />
            </mesh>
            <mesh material={mats.plate} position={[0, -0.14, 0.05]} castShadow>
              <boxGeometry args={[0.1, 0.2, 0.08]} />
            </mesh>
            <mesh material={mats.shell} position={[0, -0.445, 0.045]} castShadow>
              <boxGeometry args={[0.12, 0.09, 0.24]} />
            </mesh>
          </group>
        </group>
        <group ref={hipR} position={[0.14, 0.9, 0]}>
          <mesh material={mats.shell} position={[0, -0.2, 0]} castShadow>
            <capsuleGeometry args={[0.085, 0.26, 4, 8]} />
          </mesh>
          <mesh material={mats.plate} position={[0.03, -0.18, 0.02]} rotation-z={-0.12} castShadow>
            <boxGeometry args={[0.1, 0.24, 0.16]} />
          </mesh>
          <group ref={kneeR} position={[0, -0.4, 0]}>
            <mesh material={mats.gunmetal} position={[0, -0.18, 0]} castShadow>
              <capsuleGeometry args={[0.065, 0.28, 4, 8]} />
            </mesh>
            <mesh material={mats.plate} position={[0, -0.14, 0.05]} castShadow>
              <boxGeometry args={[0.1, 0.2, 0.08]} />
            </mesh>
            <mesh material={mats.shell} position={[0, -0.445, 0.045]} castShadow>
              <boxGeometry args={[0.12, 0.09, 0.24]} />
            </mesh>
          </group>
        </group>
      </group>
    </group>
  )
}

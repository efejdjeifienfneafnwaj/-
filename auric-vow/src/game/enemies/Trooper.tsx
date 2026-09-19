/**
 * AURIC VOW — enemies/Trooper.tsx
 * "VOTARY" Trooper — core infantry (enemies-mission.md §2).
 * Procedural build: angular white plate torso stack, wedge head with vertical
 * teal eye-slit (crit), gunmetal capsule limbs, teal chest-core (crit ×2),
 * obsidian pulse carbine. Stiff procedural walk cycle, 12° torso hunch.
 * AI: GUARD → ALERT (0.5s weapon raise) → ATTACK (8–18 m band strafe, LOS
 * burst-fire with 0.35s eye-flare telegraph, melee shove < 1.5 m) / RUSH
 * variant → STAGGER (kneel 1.2s) → dissolve death.
 */
import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { PlayerRef } from '@/game/player/PlayerRef'
import { useGameStore } from '@/game/store'
import { AudioBus } from '@/game/AudioBus'
import { COLORS, PLAYER } from '@/game/config'
import { broadcastAlert, EnemyRegistry, type EnemyEntity } from './EnemyRegistry'
import {
  canSeePlayer,
  hasLineOfSight,
  integrateGround,
  separationForce,
  turnToward,
  whiskerSteer,
  PERCEPTION_INTERVAL,
} from './ai'
import { patchDissolve } from './dissolve'
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
const MELEE_RANGE = 1.5
const MELEE_DAMAGE = 10
const MELEE_COOLDOWN = 1.0
const LOS_GRACE = 2.5

const _v = new THREE.Vector3()
const _desired = new THREE.Vector3()
const _sep = new THREE.Vector3()
const _aimAt = new THREE.Vector3()
const EYE_DIM = new THREE.Color('#0B5A55')
const EYE_FULL = new THREE.Color(COLORS.cadenceTeal)

export function Trooper({ entity }: { entity: EnemyEntity }) {
  const group = useRef<THREE.Group>(null)
  const bodyGroup = useRef<THREE.Group>(null) // hunch + kneel
  const legL = useRef<THREE.Group>(null)
  const legR = useRef<THREE.Group>(null)
  const armL = useRef<THREE.Group>(null)
  const armR = useRef<THREE.Group>(null)
  const gun = useRef<THREE.Group>(null)

  const facing = useRef(new THREE.Vector3(0, 0, 1))
  const walkPhase = useRef(Math.random() * Math.PI * 2)
  const strafeDir = useRef(Math.random() < 0.5 ? 1 : -1)

  const mats = useMemo(() => {
    const plate = new THREE.MeshStandardMaterial({ color: '#DDD6C4', metalness: 0.5, roughness: 0.4 })
    const gunmetal = new THREE.MeshStandardMaterial({ color: '#3A3F4A', metalness: 0.85, roughness: 0.3 })
    const obsidian = new THREE.MeshStandardMaterial({ color: COLORS.deepRelic, metalness: 0.6, roughness: 0.15 })
    const eye = new THREE.MeshBasicMaterial({ color: COLORS.cadenceTeal, toneMapped: false })
    const core = new THREE.MeshBasicMaterial({ color: COLORS.cadenceTeal, toneMapped: false, transparent: true })
    const barrel = new THREE.MeshBasicMaterial({ color: COLORS.viridianFlare, toneMapped: false })
    const dPlate = patchDissolve(plate)
    const dGun = patchDissolve(gunmetal)
    const dObs = patchDissolve(obsidian)
    return { plate, gunmetal, obsidian, eye, core, barrel, dPlate, dGun, dObs }
  }, [])

  useEffect(() => {
    return () => {
      mats.plate.dispose()
      mats.gunmetal.dispose()
      mats.obsidian.dispose()
      mats.eye.dispose()
      mats.core.dispose()
      mats.barrel.dispose()
    }
  }, [mats])

  useFrame((_, delta) => {
    const s = useGameStore.getState()
    if (s.phase === 'WIN' || s.phase === 'LOSE') return
    const dt = Math.min(delta, 0.05) * s.timeScale
    const g = group.current
    if (!g) return

    const e = entity
    e.hitFlash = Math.max(0, e.hitFlash - dt)

    if (!e.alive) {
      const t = Math.min(1, e.deathTimer / e.dissolveSec)
      mats.dPlate.uniform.value = t
      mats.dGun.uniform.value = t
      mats.dObs.uniform.value = t
      mats.core.opacity = Math.max(0, 1 - t * 4)
      mats.eye.color.copy(EYE_FULL).multiplyScalar(Math.max(0, 1 - t * 3))
      g.position.copy(e.position)
      // crumple forward as the shell dissolves
      g.rotation.x = Math.min(0.9, g.rotation.x + dt * 1.2)
      return
    }

    const playerDist = e.position.distanceTo(PlayerRef.position)

    // --- stagger: kneel, eye flickers ---
    if (e.staggerTimer > 0) {
      e.staggerTimer -= dt
      e.velocity.x = 0
      e.velocity.z = 0
      integrateGround(e, dt)
      g.position.copy(e.position)
      if (bodyGroup.current) {
        bodyGroup.current.position.y = THREE.MathUtils.lerp(bodyGroup.current.position.y, -0.4, Math.min(1, 8 * dt))
        bodyGroup.current.rotation.x = 0.5
      }
      mats.eye.color.copy(EYE_FULL).multiplyScalar(Math.random() > 0.4 ? 1 : 0.15)
      if (e.staggerTimer <= 0) e.state = 'attack'
      e.headPosition.copy(e.position).setY(e.position.y + 1.45)
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

    // RUSH variant: player weak or we outnumber them 3:1
    const rush = e.alerted && (s.hp < PLAYER.maxHealth * 0.4 || EnemyRegistry.aliveCount() >= 3)

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
          if (telegraphing && e.ai.glinted !== 1) {
            e.ai.glinted = 1
            AudioBus.playEnemyChirp()
          }
          if (e.ai.burstT <= 0 && (e.ai.shotsLeft ?? 0) <= 0 && los) {
            e.ai.shotsLeft = BURST_SHOTS
            e.ai.shotT = 0
            e.ai.burstT = BURST_INTERVAL
            e.ai.glinted = 0
          }
        }

        // melee shove
        if (playerDist < MELEE_RANGE && e.ai.meleeT <= 0) {
          e.ai.meleeT = MELEE_COOLDOWN
          s.damagePlayer(MELEE_DAMAGE)
          s.pushDamageEvent({ position: PlayerRef.position.clone(), amount: MELEE_DAMAGE, kind: 'player' })
          AudioBus.playHurt()
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
        _aimAt.copy(PlayerRef.position).setY(PlayerRef.position.y + PlayerRef.height * 0.45)
        _v.subVectors(_aimAt, e.headPosition)
        if (hasLineOfSight(e.headPosition, _aimAt)) {
          fireEnemyBolt(e.headPosition, _v, BOLT_SPEED, BOLT_DAMAGE)
        }
      }
    }

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

    const moving = moveSpeed > 0.1
    walkPhase.current += dt * (moving ? moveSpeed * 2.4 : 0)
    const swing = Math.sin(walkPhase.current) * 0.55 * 0.7 // stiff: amplitude ×0.7
    if (legL.current) legL.current.rotation.x = moving ? swing : 0
    if (legR.current) legR.current.rotation.x = moving ? -swing : 0
    if (armL.current) armL.current.rotation.x = moving ? -swing * 0.8 : 0
    // right arm holds the carbine up when alerted
    if (armR.current) {
      const raise = e.alerted ? -1.1 : moving ? swing * 0.8 : 0
      armR.current.rotation.x = THREE.MathUtils.lerp(armR.current.rotation.x, raise, Math.min(1, 8 * dt))
    }
    if (gun.current) gun.current.visible = true

    // torso hunch 12° (more when rushing)
    if (bodyGroup.current && e.staggerTimer <= 0) {
      bodyGroup.current.rotation.x = THREE.MathUtils.degToRad(12) + (rush && e.state === 'attack' ? 0.15 : 0)
    }

    // eye: dim normally, flared in combat, hot during telegraph
    const telegraphing = e.state === 'attack' && (e.ai.burstT ?? 1) <= BURST_TELEGRAPH && (e.ai.shotsLeft ?? 0) <= 0
    if (e.hitFlash > 0) {
      mats.eye.color.set('#FFFFFF')
      mats.plate.emissive.setScalar(0.9)
    } else {
      mats.plate.emissive.setScalar(0)
      if (telegraphing) mats.eye.color.copy(EYE_FULL).multiplyScalar(2.2)
      else mats.eye.color.lerpColors(EYE_DIM, EYE_FULL, e.alerted ? 1 : 0.4)
    }
  })

  return (
    <group ref={group} position={entity.position.toArray()}>
      <group ref={bodyGroup}>
        {/* torso — angular white plate stack */}
        <mesh material={mats.plate} position={[0, 1.15, 0]} castShadow>
          <boxGeometry args={[0.52, 0.5, 0.3]} />
        </mesh>
        <mesh material={mats.plate} position={[0, 0.88, 0]} castShadow>
          <boxGeometry args={[0.4, 0.22, 0.26]} />
        </mesh>
        {/* shoulder plates — slight Cadence asymmetry */}
        <mesh material={mats.plate} position={[-0.34, 1.36, 0]} rotation-z={0.25} castShadow>
          <boxGeometry args={[0.22, 0.14, 0.3]} />
        </mesh>
        <mesh material={mats.plate} position={[0.36, 1.33, 0]} rotation-z={-0.15} castShadow>
          <boxGeometry args={[0.16, 0.12, 0.26]} />
        </mesh>
        {/* teal chest core (weakpoint) */}
        <mesh material={mats.core} position={[0, 1.18, 0.17]}>
          <sphereGeometry args={[0.07, 10, 8]} />
        </mesh>
        {/* wedge head with vertical teal eye-slit */}
        <mesh material={mats.plate} position={[0, 1.56, 0]} rotation-y={Math.PI / 4} castShadow>
          <boxGeometry args={[0.22, 0.26, 0.22]} />
        </mesh>
        <mesh material={mats.eye} position={[0, 1.58, 0.14]}>
          <boxGeometry args={[0.03, 0.16, 0.04]} />
        </mesh>
        {/* arms — gunmetal capsules */}
        <group ref={armL} position={[-0.34, 1.32, 0]}>
          <mesh material={mats.gunmetal} position={[0, -0.3, 0]} castShadow>
            <capsuleGeometry args={[0.07, 0.5, 4, 8]} />
          </mesh>
        </group>
        <group ref={armR} position={[0.34, 1.32, 0]}>
          <mesh material={mats.gunmetal} position={[0, -0.3, 0]} castShadow>
            <capsuleGeometry args={[0.07, 0.5, 4, 8]} />
          </mesh>
          {/* pulse carbine: obsidian box + teal barrel glow */}
          <group ref={gun} position={[0, -0.55, 0.18]}>
            <mesh material={mats.obsidian} castShadow>
              <boxGeometry args={[0.09, 0.12, 0.55]} />
            </mesh>
            <mesh material={mats.barrel} position={[0, 0, 0.3]}>
              <boxGeometry args={[0.03, 0.03, 0.12]} />
            </mesh>
          </group>
        </group>
      </group>
      {/* legs */}
      <group ref={legL} position={[-0.15, 0.82, 0]}>
        <mesh material={mats.gunmetal} position={[0, -0.4, 0]} castShadow>
          <capsuleGeometry args={[0.09, 0.66, 4, 8]} />
        </mesh>
      </group>
      <group ref={legR} position={[0.15, 0.82, 0]}>
        <mesh material={mats.gunmetal} position={[0, -0.4, 0]} castShadow>
          <capsuleGeometry args={[0.09, 0.66, 4, 8]} />
        </mesh>
      </group>
    </group>
  )
}

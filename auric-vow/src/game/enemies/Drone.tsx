/**
 * AURIC VOW — enemies/Drone.tsx
 * "CHIRP" Drone — flying harasser / patrol scout (enemies-mission.md §1).
 *
 * R1 art pass: the old flattened octahedron + 3 sticks read as debris. The
 * drone is now a wide, flat, forward-swept delta — a dark hull with two
 * forward sensor prongs, a counter-rotating gimbal ring and ONE crimson eye
 * on the nose. Nothing else in the game is horizontal-and-hovering, so the
 * type reads instantly against troopers (vertical) and heavies (massive).
 *
 * AI: PATROL → ALERT (0.6 s screech, rise, broadcast) → ATTACK (strafe-orbit
 * with real obstacle avoidance, telegraphed crimson bolts, dart-away) →
 * STAGGER (spin-out) → dissolve death.
 */
import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { PlayerRef } from '@/game/player/PlayerRef'
import { useGameStore } from '@/game/store'
import { AudioBus } from '@/game/AudioBus'
import { VFX } from '@/game/vfx/VFXBus'
import { ENEMY_LOOK } from '@/game/config'
import { broadcastAlert, type EnemyEntity } from './EnemyRegistry'
import {
  avoidFlying,
  canSeePlayer,
  clearThreat,
  hasLineOfSight,
  integrateFlying,
  markThreat,
  separationForce,
  PERCEPTION_INTERVAL,
} from './ai'
import { patchDissolve, makeOutlineMaterial } from './dissolve'
import { fireEnemyBolt } from './EnemyProjectiles'

const SPEED_PATROL = 3
const SPEED_ATTACK = 6
const DETECT_RANGE = 25
const DETECT_FOV = 100
const ORBIT_RADIUS_MIN = 8
const ORBIT_RADIUS_MAX = 12
const FIRE_INTERVAL = 1.6
const FIRE_TELEGRAPH = 0.28
const BOLT_SPEED = 25
const BOLT_DAMAGE = 8
const DART_RANGE = 3
const DART_SPEED = 12
const DART_TIME = 0.4

const _v = new THREE.Vector3()
const _desired = new THREE.Vector3()
const _sep = new THREE.Vector3()
const _aimAt = new THREE.Vector3()
const _fx = new THREE.Vector3()
const CORE_DIM = new THREE.Color(ENEMY_LOOK.accent).multiplyScalar(0.4)
const CORE_FULL = new THREE.Color(ENEMY_LOOK.accent)
const CORE_HOT = new THREE.Color(ENEMY_LOOK.accentHot)

export function Drone({ entity }: { entity: EnemyEntity }) {
  const group = useRef<THREE.Group>(null)
  const bobGroup = useRef<THREE.Group>(null)
  const finGroup = useRef<THREE.Group>(null)
  const ringGroup = useRef<THREE.Group>(null)
  const coreMesh = useRef<THREE.Mesh>(null)

  const facing = useRef(new THREE.Vector3(0, 0, 1))
  const orbitDir = useRef(Math.random() < 0.5 ? 1 : -1)
  const orbitRadius = useRef(THREE.MathUtils.lerp(ORBIT_RADIUS_MIN, ORBIT_RADIUS_MAX, Math.random()))
  const bobPhase = useRef(Math.random() * Math.PI * 2)
  const prevFlash = useRef(0)
  const shadowsOff = useRef(false)
  const rollTarget = useRef(0)

  const mats = useMemo(() => {
    const shell = new THREE.MeshStandardMaterial({
      color: ENEMY_LOOK.shell,
      metalness: 0.55,
      roughness: 0.5,
    })
    const fin = new THREE.MeshStandardMaterial({
      color: ENEMY_LOOK.shellLit,
      metalness: 0.75,
      roughness: 0.38,
    })
    const joint = new THREE.MeshStandardMaterial({
      color: ENEMY_LOOK.joint,
      metalness: 0.92,
      roughness: 0.3,
    })
    const core = new THREE.MeshBasicMaterial({
      color: ENEMY_LOOK.accent,
      toneMapped: false,
      transparent: true,
    })
    const dShell = patchDissolve(shell)
    const dFin = patchDissolve(fin)
    const dJoint = patchDissolve(joint, { rimStrength: ENEMY_LOOK.rimStrength * 0.5 })
    const outline = makeOutlineMaterial(ENEMY_LOOK.outline.pixels * 0.85)
    return { shell, fin, joint, core, dShell, dFin, dJoint, outline }
  }, [])

  useEffect(() => {
    return () => {
      mats.shell.dispose()
      mats.fin.dispose()
      mats.joint.dispose()
      mats.core.dispose()
      mats.outline.dispose()
    }
  }, [mats])

  useFrame((state, delta) => {
    const s = useGameStore.getState()
    if (s.phase === 'WIN' || s.phase === 'LOSE') return
    const dt = Math.min(delta, 0.05) * s.timeScale
    const g = group.current
    if (!g) return

    const e = entity
    if (e.hitFlash > prevFlash.current + 0.001 && e.alive) {
      _v.subVectors(PlayerRef.position, e.position).normalize()
      _fx.copy(e.position).addScaledVector(_v, 0.22)
      VFX.burst({
        position: _fx,
        color: ENEMY_LOOK.accentHot,
        count: 4,
        speed: 4,
        life: 0.2,
        size: 0.035,
        gravity: -2,
      })
    }
    prevFlash.current = e.hitFlash
    e.hitFlash = Math.max(0, e.hitFlash - dt)

    if (!e.alive) {
      if (!shadowsOff.current) {
        shadowsOff.current = true
        clearThreat(e.id)
        g.traverse((o) => {
          const m = o as THREE.Mesh
          if (m.isMesh) m.castShadow = false
        })
      }
      // dissolve is driven by manager-incremented deathTimer
      const t = Math.min(1, e.deathTimer / e.dissolveSec)
      mats.dShell.uniform.value = t
      mats.dFin.uniform.value = t
      mats.dJoint.uniform.value = t
      mats.outline.setOpacity(ENEMY_LOOK.outline.opacity * Math.max(0, 1 - t * 2.2))
      if (coreMesh.current) {
        const cs = Math.max(0, 1 - t * 4)
        coreMesh.current.scale.setScalar(cs)
      }
      // tumble out of the sky rather than spinning in place
      e.position.y -= dt * (1.2 + e.deathTimer * 6)
      g.position.copy(e.position)
      g.rotation.y += dt * 7
      g.rotation.z += dt * 4.5
      g.rotation.x += dt * 2.5
      return
    }

    const playerDist = e.position.distanceTo(PlayerRef.position)

    // --- stagger overrides everything ---
    if (e.staggerTimer > 0) {
      e.staggerTimer -= dt
      e.velocity.set(0, 0, 0)
      e.position.y -= (1 / 1.2) * dt // drop 1 m over the spin-out
      integrateFlying(e, dt)
      g.position.copy(e.position)
      g.rotation.y += dt * 14
      g.rotation.z = Math.sin(e.staggerTimer * 24) * 0.5
      if (e.staggerTimer <= 0) {
        e.state = e.alerted ? 'attack' : 'patrol'
        g.rotation.z = 0
      }
      syncHead(e)
      return
    }

    // --- perception tick ---
    e.ai.percept = (e.ai.percept ?? 0) - dt
    if (e.ai.percept <= 0) {
      e.ai.percept = PERCEPTION_INTERVAL
      if (!e.alerted && canSeePlayer(e, DETECT_RANGE, DETECT_FOV, facing.current)) {
        e.alerted = true
        e.state = 'alert'
        e.ai.stateT = 0
        e.ai.alertBaseY = e.position.y
        AudioBus.playEnemyChirp() // rising screech
        broadcastAlert(e.position, 15)
      }
    }

    // --- idle chirps while patrolling ---
    if (e.state === 'patrol') {
      e.ai.chirp = (e.ai.chirp ?? 2 + Math.random() * 6) - dt
      if (e.ai.chirp <= 0) {
        e.ai.chirp = 4 + Math.random() * 5
        AudioBus.playEnemyChirp()
      }
    }

    e.ai.stateT = (e.ai.stateT ?? 0) + dt

    switch (e.state) {
      case 'patrol': {
        if (e.waypoints.length > 0) {
          const idx = (e.ai.wpIdx ?? 0) % e.waypoints.length
          const wp = e.waypoints[idx]
          _v.subVectors(wp, e.position)
          if (_v.length() < 1) {
            e.ai.wpIdx = (idx + 1) % e.waypoints.length
          } else {
            _v.normalize().multiplyScalar(SPEED_PATROL)
            avoidFlying(e, _v, 5)
            e.velocity.lerp(_v, Math.min(1, 4 * dt))
            _desired.copy(_v).normalize()
            facing.current.lerp(_desired, Math.min(1, 3 * dt)).normalize()
          }
        } else {
          e.velocity.multiplyScalar(Math.max(0, 1 - 2 * dt))
        }
        break
      }

      case 'alert': {
        // 0.6s: rise 2 m, core flares, hold position
        const k = Math.min(1, e.ai.stateT / 0.6)
        e.velocity.set(0, 0, 0)
        e.position.y = e.ai.alertBaseY + k * 2
        if (e.ai.stateT >= 0.6) {
          e.state = 'attack'
          e.ai.stateT = 0
          e.ai.orbitT = 0
          e.ai.fireT = FIRE_INTERVAL * 0.5 // first shot comes a bit early
        }
        break
      }

      case 'attack': {
        // re-roll orbit every 4s
        e.ai.orbitT = (e.ai.orbitT ?? 0) + dt
        if (e.ai.orbitT >= 4) {
          e.ai.orbitT = 0
          orbitDir.current = Math.random() < 0.5 ? 1 : -1
          orbitRadius.current = THREE.MathUtils.lerp(ORBIT_RADIUS_MIN, ORBIT_RADIUS_MAX, Math.random())
        }

        // dart away if the player gets inside 3 m
        if (playerDist < DART_RANGE && (e.ai.dartT ?? 0) <= 0) {
          e.ai.dartT = DART_TIME
          _v.subVectors(e.position, PlayerRef.position).normalize()
          e.velocity.copy(_v).multiplyScalar(DART_SPEED)
          rollTarget.current = orbitDir.current * 0.7
          AudioBus.playEnemyChirp()
        }
        if ((e.ai.dartT ?? 0) > 0) {
          e.ai.dartT -= dt
        } else {
          // strafe-orbit the player, hold 2–4 m above them
          const ang = Math.atan2(e.position.x - PlayerRef.position.x, e.position.z - PlayerRef.position.z)
          const next = ang + orbitDir.current * (SPEED_ATTACK / orbitRadius.current) * dt * 2
          _desired.set(
            PlayerRef.position.x + Math.sin(next) * orbitRadius.current,
            PlayerRef.position.y + 3,
            PlayerRef.position.z + Math.cos(next) * orbitRadius.current,
          )
          _v.subVectors(_desired, e.position)
          const d = _v.length()
          if (d > 0.01) {
            _v.normalize().multiplyScalar(Math.min(SPEED_ATTACK, d * 3))
            separationForce(e, _sep)
            _v.addScaledVector(_sep, 4)
            avoidFlying(e, _v, 4.5) // N13: path around pillars instead of stalling
            e.velocity.lerp(_v, Math.min(1, 5 * dt))
          }
          rollTarget.current = -orbitDir.current * 0.32
        }

        // face the player
        _v.subVectors(PlayerRef.position, e.position).setY(0)
        if (_v.lengthSq() > 0.01) facing.current.lerp(_v.normalize(), Math.min(1, 6 * dt)).normalize()

        // fire cycle: telegraph glint then bolt, only with LOS
        e.ai.fireT = (e.ai.fireT ?? FIRE_INTERVAL) - dt
        if (e.ai.fireT <= FIRE_TELEGRAPH && e.ai.fireT > 0) {
          markThreat(e, 'fire', 0.3)
          if (e.ai.glinted !== 1) {
            e.ai.glinted = 1
            AudioBus.playEnemyChirp()
          }
        }
        if (e.ai.fireT <= 0) {
          e.ai.fireT = FIRE_INTERVAL
          e.ai.glinted = 0
          _aimAt.copy(PlayerRef.position).setY(PlayerRef.position.y + PlayerRef.height * 0.5)
          // light lead on the strafing player
          _aimAt.addScaledVector(PlayerRef.velocity, 0.15)
          if (hasLineOfSight(e.headPosition, _aimAt)) {
            _v.subVectors(_aimAt, e.headPosition)
            fireEnemyBolt(e.headPosition, _v, BOLT_SPEED, BOLT_DAMAGE)
            markThreat(e, 'fire', 0.5)
            e.ai.muzzle = 0.07
          }
        }
        break
      }

      default: {
        // guard (spawned alerted but no waypoints) → go straight to attack
        e.state = e.alerted ? 'attack' : 'patrol'
        break
      }
    }
    e.ai.muzzle = Math.max(0, (e.ai.muzzle ?? 0) - dt)

    integrateFlying(e, dt)
    syncHead(e)

    // --- visuals ---
    g.position.copy(e.position)
    // yaw toward facing
    g.rotation.y = Math.atan2(facing.current.x, facing.current.z)
    // pitch/bank into movement (nose down when pushing, bank into the orbit)
    const tiltX = THREE.MathUtils.clamp(e.velocity.length() / SPEED_ATTACK, 0, 1) * THREE.MathUtils.degToRad(22)
    g.rotation.x = THREE.MathUtils.lerp(g.rotation.x, tiltX, Math.min(1, 6 * dt))
    g.rotation.z = THREE.MathUtils.lerp(g.rotation.z, e.alerted ? rollTarget.current : 0, Math.min(1, 4 * dt))

    if (bobGroup.current) {
      bobGroup.current.position.y = Math.sin(state.clock.elapsedTime * Math.PI * 2 * 1.2 + bobPhase.current) * 0.12
    }
    if (finGroup.current) finGroup.current.rotation.z += dt * (e.alerted ? 5.2 : 2.2)
    if (ringGroup.current) ringGroup.current.rotation.z -= dt * (e.alerted ? 3.4 : 1.4)

    if (coreMesh.current) {
      const mat = mats.core
      const inCombat = e.state === 'attack' || e.state === 'alert'
      const glinting = e.state === 'attack' && (e.ai.fireT ?? 1) <= FIRE_TELEGRAPH
      if (e.hitFlash > 0) mat.color.set('#FFFFFF')
      else if (glinting || (e.ai.muzzle ?? 0) > 0) mat.color.copy(CORE_HOT).multiplyScalar(2.6)
      else mat.color.lerpColors(CORE_DIM, CORE_FULL, inCombat ? 1 : 0.35)
      coreMesh.current.scale.setScalar(glinting ? 1.5 : 1)
    }
    // hit flash — shell override
    mats.shell.emissive.setScalar(e.hitFlash > 0 ? 0.85 : 0)
    mats.fin.emissive.setScalar(e.hitFlash > 0 ? 0.85 : 0)
  })

  function syncHead(e: EnemyEntity) {
    e.headPosition.copy(e.position) // core is body-center on the drone
  }

  const o = mats.outline.material

  return (
    <group ref={group} position={entity.position.toArray()}>
      <group ref={bobGroup}>
        {/* ---- flat swept hull ---- */}
        <mesh material={mats.shell} position={[0, 0, -0.02]} scale={[1, 0.34, 1.25]} castShadow>
          <octahedronGeometry args={[0.3, 0]} />
        </mesh>
        <mesh material={o} position={[0, 0, -0.02]} scale={[1, 0.34, 1.25]}>
          <octahedronGeometry args={[0.3, 0]} />
        </mesh>
        {/* dorsal spine plate */}
        <mesh material={mats.fin} position={[0, 0.07, -0.08]} rotation-x={-0.12} castShadow>
          <boxGeometry args={[0.16, 0.04, 0.42]} />
        </mesh>
        {/* ---- swept wings ---- */}
        {[-1, 1].map((side) => (
          <group key={side} position={[side * 0.2, 0, -0.03]} rotation-y={side * -0.5}>
            <mesh material={mats.fin} position={[side * 0.16, 0, 0]} rotation-z={side * 0.22} castShadow>
              <boxGeometry args={[0.36, 0.035, 0.2]} />
            </mesh>
            {/* wingtip prong */}
            <mesh material={mats.joint} position={[side * 0.34, 0.01, 0.07]} castShadow>
              <boxGeometry args={[0.06, 0.05, 0.16]} />
            </mesh>
          </group>
        ))}
        {/* ---- forward sensor prongs framing the eye ---- */}
        {[-1, 1].map((side) => (
          <mesh key={side} material={mats.joint} position={[side * 0.1, 0.01, 0.26]} rotation-y={side * 0.18} castShadow>
            <boxGeometry args={[0.04, 0.045, 0.24]} />
          </mesh>
        ))}
        {/* ---- crimson eye on the nose (weakpoint) ---- */}
        <mesh material={mats.joint} position={[0, 0, 0.2]} rotation-x={Math.PI / 2}>
          <cylinderGeometry args={[0.1, 0.12, 0.08, 10]} />
        </mesh>
        <mesh ref={coreMesh} material={mats.core} position={[0, 0, 0.24]}>
          <sphereGeometry args={[0.075, 12, 10]} />
        </mesh>
        {/* ---- counter-rotating gimbal ring + blades ---- */}
        <group ref={ringGroup} rotation-x={Math.PI / 2}>
          <mesh material={mats.joint} position={[0, 0, 0]}>
            <torusGeometry args={[0.26, 0.018, 6, 20]} />
          </mesh>
        </group>
        <group ref={finGroup} rotation-x={Math.PI / 2}>
          {[0, 1, 2].map((i) => (
            <mesh
              key={i}
              material={mats.fin}
              position={[Math.cos((i * Math.PI * 2) / 3) * 0.2, Math.sin((i * Math.PI * 2) / 3) * 0.2, 0.02]}
              rotation-z={(i * Math.PI * 2) / 3}
              castShadow
            >
              <boxGeometry args={[0.16, 0.022, 0.04]} />
            </mesh>
          ))}
        </group>
      </group>
    </group>
  )
}

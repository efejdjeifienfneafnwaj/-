/**
 * AURIC VOW — enemies/Drone.tsx
 * "CHIRP" Drone — flying harasser / patrol scout (enemies-mission.md §1).
 * Procedural build: flattened octahedron shell, teal core (weakpoint ×2),
 * 3 spinning blade fins, hover bob, tilt-into-movement.
 * AI: PATROL → ALERT (0.6s screech, rise, broadcast) → ATTACK (strafe-orbit,
 * telegraphed teal bolts, dart-away) → STAGGER (spin-out) → dissolve death.
 */
import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { PlayerRef } from '@/game/player/PlayerRef'
import { useGameStore } from '@/game/store'
import { AudioBus } from '@/game/AudioBus'
import { COLORS } from '@/game/config'
import { broadcastAlert, type EnemyEntity } from './EnemyRegistry'
import { canSeePlayer, hasLineOfSight, integrateFlying, separationForce, PERCEPTION_INTERVAL } from './ai'
import { patchDissolve } from './dissolve'
import { fireEnemyBolt } from './EnemyProjectiles'

const SPEED_PATROL = 3
const SPEED_ATTACK = 6
const DETECT_RANGE = 25
const DETECT_FOV = 100
const ORBIT_RADIUS_MIN = 8
const ORBIT_RADIUS_MAX = 12
const FIRE_INTERVAL = 1.6
const FIRE_TELEGRAPH = 0.2
const BOLT_SPEED = 25
const BOLT_DAMAGE = 8
const DART_RANGE = 3
const DART_SPEED = 12
const DART_TIME = 0.4

const _v = new THREE.Vector3()
const _desired = new THREE.Vector3()
const _sep = new THREE.Vector3()
const _aimAt = new THREE.Vector3()
const CORE_DIM = new THREE.Color('#0B5A55')
const CORE_FULL = new THREE.Color(COLORS.cadenceTeal)

export function Drone({ entity }: { entity: EnemyEntity }) {
  const group = useRef<THREE.Group>(null)
  const bobGroup = useRef<THREE.Group>(null)
  const finGroup = useRef<THREE.Group>(null)
  const coreMesh = useRef<THREE.Mesh>(null)

  const facing = useRef(new THREE.Vector3(0, 0, 1))
  const orbitDir = useRef(Math.random() < 0.5 ? 1 : -1)
  const orbitRadius = useRef(THREE.MathUtils.lerp(ORBIT_RADIUS_MIN, ORBIT_RADIUS_MAX, Math.random()))
  const bobPhase = useRef(Math.random() * Math.PI * 2)

  const mats = useMemo(() => {
    const shell = new THREE.MeshStandardMaterial({ color: '#DDD6C4', metalness: 0.7, roughness: 0.35 })
    const fin = new THREE.MeshStandardMaterial({ color: '#C9C2B0', metalness: 0.8, roughness: 0.3 })
    const core = new THREE.MeshBasicMaterial({ color: COLORS.cadenceTeal, toneMapped: false, transparent: true })
    const dShell = patchDissolve(shell)
    const dFin = patchDissolve(fin)
    return { shell, fin, core, dShell, dFin }
  }, [])

  useEffect(() => {
    return () => {
      mats.shell.dispose()
      mats.fin.dispose()
      mats.core.dispose()
    }
  }, [mats])

  useFrame((state, delta) => {
    const s = useGameStore.getState()
    if (s.phase === 'WIN' || s.phase === 'LOSE') return
    const dt = Math.min(delta, 0.05) * s.timeScale
    const g = group.current
    if (!g) return

    const e = entity
    e.hitFlash = Math.max(0, e.hitFlash - dt)

    if (!e.alive) {
      // dissolve is driven by manager-incremented deathTimer
      const t = Math.min(1, e.deathTimer / e.dissolveSec)
      mats.dShell.uniform.value = t
      mats.dFin.uniform.value = t
      if (coreMesh.current) {
        const cs = Math.max(0, 1 - t * 4)
        coreMesh.current.scale.setScalar(cs)
      }
      g.position.copy(e.position)
      g.rotation.y += dt * 6 // death spin
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
      if (e.staggerTimer <= 0) e.state = e.alerted ? 'attack' : 'patrol'
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
            _v.normalize()
            e.velocity.lerp(_v.multiplyScalar(SPEED_PATROL), Math.min(1, 4 * dt))
            facing.current.lerp(_v.normalize(), Math.min(1, 3 * dt)).normalize()
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
            e.velocity.lerp(_v, Math.min(1, 5 * dt))
          }
        }

        // face the player
        _v.subVectors(PlayerRef.position, e.position).setY(0)
        if (_v.lengthSq() > 0.01) facing.current.lerp(_v.normalize(), Math.min(1, 6 * dt)).normalize()

        // fire cycle: telegraph glint then bolt, only with LOS
        e.ai.fireT = (e.ai.fireT ?? FIRE_INTERVAL) - dt
        if (e.ai.fireT <= FIRE_TELEGRAPH && e.ai.fireT > 0) {
          // glint — core scale pulse handled in visuals via fireT
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

    integrateFlying(e, dt)
    syncHead(e)

    // --- visuals ---
    g.position.copy(e.position)
    // yaw toward facing
    g.rotation.y = Math.atan2(facing.current.x, facing.current.z)
    // tilt into movement (up to 25°)
    const tiltX = THREE.MathUtils.clamp(e.velocity.length() / SPEED_ATTACK, 0, 1) * THREE.MathUtils.degToRad(25)
    g.rotation.x = THREE.MathUtils.lerp(g.rotation.x, tiltX, Math.min(1, 6 * dt))

    if (bobGroup.current) {
      bobGroup.current.position.y = Math.sin(state.clock.elapsedTime * Math.PI * 2 * 1.2 + bobPhase.current) * 0.15
    }
    if (finGroup.current) finGroup.current.rotation.y += dt * 2.2

    if (coreMesh.current) {
      const mat = mats.core
      const inCombat = e.state === 'attack' || e.state === 'alert'
      mat.color.lerpColors(CORE_DIM, CORE_FULL, inCombat ? 1 : 0.6 * 0.5)
      // telegraph glint: flare scale in the last 0.2s before firing
      const glinting = e.state === 'attack' && (e.ai.fireT ?? 1) <= FIRE_TELEGRAPH
      coreMesh.current.scale.setScalar(glinting ? 1.6 : 1)
    }
    // hit flash — white shell override
    mats.shell.emissive.setScalar(e.hitFlash > 0 ? 0.9 : 0)
  })

  function syncHead(e: EnemyEntity) {
    e.headPosition.copy(e.position) // core is body-center on the drone
  }

  return (
    <group ref={group} position={entity.position.toArray()}>
      <group ref={bobGroup}>
        {/* flattened octahedron shell, 0.5 m wide */}
        <mesh material={mats.shell} scale={[1, 0.55, 1]} castShadow>
          <octahedronGeometry args={[0.25, 0]} />
        </mesh>
        {/* glowing teal core in the center cage (weakpoint) */}
        <mesh ref={coreMesh} material={mats.core}>
          <sphereGeometry args={[0.12, 12, 10]} />
        </mesh>
        {/* 3 blade fins at 120°, slow spin */}
        <group ref={finGroup}>
          {[0, 1, 2].map((i) => (
            <mesh
              key={i}
              material={mats.fin}
              position={[Math.sin((i * Math.PI * 2) / 3) * 0.28, 0, Math.cos((i * Math.PI * 2) / 3) * 0.28]}
              rotation-y={(i * Math.PI * 2) / 3}
            >
              <boxGeometry args={[0.02, 0.06, 0.3]} />
            </mesh>
          ))}
        </group>
      </group>
    </group>
  )
}

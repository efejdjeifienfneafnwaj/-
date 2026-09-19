/**
 * AURIC VOW — enemies/Heavy.tsx
 * "CANTOR" Heavy — miniboss bruiser (enemies-mission.md §3).
 * 2.6 m inverted-teardrop torso, recessed head in pauldron petal-rosettes,
 * piston fists, columnar legs, teal BACK reactor (weakpoint ×2 — flanking
 * counter-play vs. its slow 60°/s turn). Chest slit flares red as telegraph.
 * AI loop: < 3 m → Slam/Sweep (alternate) · 6–20 m LOS → Charge (wall impact
 * = 1.5s self-stagger punish window) · else stalk. ENRAGE at hp < 30%.
 */
import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { PlayerRef } from '@/game/player/PlayerRef'
import { useGameStore } from '@/game/store'
import { AudioBus } from '@/game/AudioBus'
import { COLORS } from '@/game/config'
import { VFX } from '@/game/vfx/VFXBus'
import { type EnemyEntity } from './EnemyRegistry'
import { hasLineOfSight, integrateGround, separationForce, turnToward, whiskerSteer } from './ai'
import { patchDissolve } from './dissolve'

const SPEED_WALK = 3
const SPEED_CHARGE = 12
const TURN_RATE = Math.PI / 3 // 60°/s
const SLAM_RANGE = 3
const SLAM_DAMAGE = 40
const SLAM_AOE = 2.5
const SLAM_WINDUP = 0.6
const SWEEP_DAMAGE = 20
const SWEEP_RANGE = 3.4
const CHARGE_MIN = 6
const CHARGE_MAX = 20
const CHARGE_TELEGRAPH = 0.5
const CHARGE_LENGTH = 15
const CHARGE_DAMAGE = 25
const CHARGE_COOLDOWN = 6
const ATTACK_COOLDOWN = 1.2
const ENRAGE_HP = 0.3

const _v = new THREE.Vector3()
const _sep = new THREE.Vector3()
const _aimAt = new THREE.Vector3()
const SLIT_IDLE = new THREE.Color(COLORS.cadenceTeal)
const SLIT_RED = new THREE.Color(COLORS.emberRed)

export function Heavy({ entity }: { entity: EnemyEntity }) {
  const group = useRef<THREE.Group>(null)
  const bodyGroup = useRef<THREE.Group>(null)
  const armL = useRef<THREE.Group>(null)
  const armR = useRef<THREE.Group>(null)
  const legL = useRef<THREE.Group>(null)
  const legR = useRef<THREE.Group>(null)

  const facing = useRef(new THREE.Vector3(0, 0, 1))
  const chargeDir = useRef(new THREE.Vector3(0, 0, 1))
  const walkPhase = useRef(0)

  const mats = useMemo(() => {
    const plate = new THREE.MeshStandardMaterial({ color: '#D5CDBB', metalness: 0.6, roughness: 0.4 })
    const gunmetal = new THREE.MeshStandardMaterial({ color: '#343945', metalness: 0.85, roughness: 0.3 })
    const reactor = new THREE.MeshBasicMaterial({ color: COLORS.cadenceTeal, toneMapped: false, transparent: true })
    const slit = new THREE.MeshBasicMaterial({ color: COLORS.cadenceTeal, toneMapped: false })
    const dPlate = patchDissolve(plate)
    const dGun = patchDissolve(gunmetal)
    return { plate, gunmetal, reactor, slit, dPlate, dGun }
  }, [])

  useEffect(() => {
    return () => {
      mats.plate.dispose()
      mats.gunmetal.dispose()
      mats.reactor.dispose()
      mats.slit.dispose()
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
    e.impactCooldown = Math.max(0, e.impactCooldown - dt)
    const enraged = e.hp / e.maxHp < ENRAGE_HP
    const speedMult = enraged ? 1.3 : 1
    const cdMult = enraged ? 0.75 : 1

    if (!e.alive) {
      // kneel-collapse (0.4s) then dissolve (enemies-mission.md §6 step 5)
      const t = e.deathTimer
      if (bodyGroup.current) {
        bodyGroup.current.position.y = THREE.MathUtils.lerp(bodyGroup.current.position.y, -0.7, Math.min(1, t / 0.4))
        bodyGroup.current.rotation.x = Math.min(0.5, t * 1.2)
      }
      const d = THREE.MathUtils.clamp((t - 0.4) / 0.6, 0, 1)
      mats.dPlate.uniform.value = d
      mats.dGun.uniform.value = d
      mats.reactor.opacity = Math.max(0, 1 - d * 3)
      g.position.copy(e.position)
      return
    }

    _v.subVectors(PlayerRef.position, e.position).setY(0)
    const playerDist = _v.length()
    const toPlayer = _v.normalize()

    // --- stagger (Requiem 0.6s via registry, or wall-charge impact 1.5s) ---
    if (e.staggerTimer > 0) {
      e.staggerTimer -= dt
      e.velocity.x = 0
      e.velocity.z = 0
      integrateGround(e, dt)
      g.position.copy(e.position)
      if (bodyGroup.current) bodyGroup.current.rotation.z = Math.sin(e.staggerTimer * 20) * 0.06
      mats.slit.color.copy(SLIT_RED).multiplyScalar(0.6 + Math.random() * 0.4)
      if (e.staggerTimer <= 0) {
        e.state = 'attack'
        if (bodyGroup.current) bodyGroup.current.rotation.z = 0
      }
      syncReactor(e)
      return
    }

    e.ai.attackCd = Math.max(0, (e.ai.attackCd ?? 0) - dt)
    e.ai.chargeCd = Math.max(0, (e.ai.chargeCd ?? 2) - dt) // first charge available early
    e.ai.stateT = (e.ai.stateT ?? 0) + dt

    let moving = false
    let integrated = false

    switch (e.state) {
      case 'slamWindup': {
        e.velocity.x = 0
        e.velocity.z = 0
        // fists rise; red flare handled in visuals
        const k = Math.min(1, e.ai.stateT / SLAM_WINDUP)
        if (armL.current) armL.current.rotation.x = -2.2 * k
        if (armR.current) armR.current.rotation.x = -2.2 * k
        turnToward(facing.current, toPlayer, TURN_RATE * 0.5 * dt)
        if (e.ai.stateT >= SLAM_WINDUP) {
          // SLAM lands — 2.5 m AoE
          if (armL.current) armL.current.rotation.x = 0.5
          if (armR.current) armR.current.rotation.x = 0.5
          VFX.ring({ position: e.position, color: COLORS.emberRed, maxRadius: SLAM_AOE + 0.6, life: 0.4, width: 0.25 })
          VFX.burst({ position: e.position, color: COLORS.emberRed, count: 12, speed: 5, life: 0.4, size: 0.07, gravity: -6 })
          AudioBus.playEnemyChirp()
          if (playerDist < SLAM_AOE + PlayerRef.radius) {
            s.damagePlayer(SLAM_DAMAGE)
            s.pushDamageEvent({ position: PlayerRef.position.clone(), amount: SLAM_DAMAGE, kind: 'player' })
            AudioBus.playHurt()
          }
          e.state = 'attack'
          e.ai.stateT = 0
          e.ai.attackCd = ATTACK_COOLDOWN * cdMult
        }
        break
      }

      case 'sweep': {
        e.velocity.x = 0
        e.velocity.z = 0
        // 180° arm sweep over 0.4s
        const k = Math.min(1, e.ai.stateT / 0.4)
        if (armR.current) armR.current.rotation.y = THREE.MathUtils.lerp(-1.6, 1.6, k)
        if (e.ai.stateT >= 0.2 && e.ai.swept !== 1) {
          e.ai.swept = 1
          const facingDot = facing.current.dot(toPlayer)
          if (playerDist < SWEEP_RANGE + PlayerRef.radius && facingDot > 0) {
            s.damagePlayer(SWEEP_DAMAGE)
            s.pushDamageEvent({ position: PlayerRef.position.clone(), amount: SWEEP_DAMAGE, kind: 'player' })
            AudioBus.playHurt()
          }
        }
        if (e.ai.stateT >= 0.4) {
          if (armR.current) armR.current.rotation.y = 0
          e.state = 'attack'
          e.ai.stateT = 0
          e.ai.attackCd = ATTACK_COOLDOWN * cdMult
        }
        break
      }

      case 'chargeTelegraph': {
        e.velocity.x = 0
        e.velocity.z = 0
        // 0.5s crouch telegraph, lock aim at the end
        const k = Math.min(1, e.ai.stateT / CHARGE_TELEGRAPH)
        if (bodyGroup.current) bodyGroup.current.scale.y = 1 - 0.15 * k
        turnToward(facing.current, toPlayer, TURN_RATE * 1.5 * dt)
        if (e.ai.stateT >= CHARGE_TELEGRAPH) {
          chargeDir.current.copy(facing.current).normalize()
          e.state = 'charge'
          e.ai.stateT = 0
          e.ai.charged = 0
          AudioBus.playEnemyChirp()
          VFX.flash({ position: e.headPosition, color: COLORS.emberRed, intensity: 8, distance: 8, life: 0.2 })
        }
        break
      }

      case 'charge': {
        const step = SPEED_CHARGE * dt
        e.velocity.x = chargeDir.current.x * SPEED_CHARGE
        e.velocity.z = chargeDir.current.z * SPEED_CHARGE
        const before = e.position.x * chargeDir.current.x + e.position.z * chargeDir.current.z
        integrateGround(e, dt)
        integrated = true
        const after = e.position.x * chargeDir.current.x + e.position.z * chargeDir.current.z
        e.ai.charged = (e.ai.charged ?? 0) + step
        moving = true

        // wall impact → self-stagger punish window (1.5s)
        const blocked = after - before < step * 0.4
        if (blocked && e.impactCooldown <= 0) {
          e.impactCooldown = 1
          e.staggerTimer = 1.5
          e.state = 'stagger'
          e.velocity.set(0, 0, 0)
          VFX.ring({ position: e.position, color: COLORS.cadenceTeal, maxRadius: 3, life: 0.5, width: 0.3 })
          VFX.burst({ position: e.position, color: COLORS.cadenceTeal, count: 14, speed: 6, life: 0.5, size: 0.08 })
          AudioBus.playEnemyChirp()
          break
        }

        // player contact → 25 dmg + knockdown impulse (player controller owns physics)
        if (playerDist < e.radius + PlayerRef.radius + 0.3 && e.ai.hitPlayer !== 1) {
          e.ai.hitPlayer = 1
          s.damagePlayer(CHARGE_DAMAGE)
          s.pushDamageEvent({ position: PlayerRef.position.clone(), amount: CHARGE_DAMAGE, kind: 'player' })
          AudioBus.playHurt()
          VFX.burst({ position: PlayerRef.position, color: COLORS.emberRed, count: 10, speed: 6, life: 0.4, size: 0.07 })
        }

        if ((e.ai.charged ?? 0) >= CHARGE_LENGTH) {
          e.state = 'attack'
          e.ai.stateT = 0
          e.ai.chargeCd = CHARGE_COOLDOWN * cdMult
          e.ai.hitPlayer = 0
          e.velocity.x = 0
          e.velocity.z = 0
        }
        break
      }

      case 'attack':
      default: {
        if (bodyGroup.current) bodyGroup.current.scale.y = THREE.MathUtils.lerp(bodyGroup.current.scale.y, 1, Math.min(1, 6 * dt))
        _aimAt.copy(PlayerRef.position).setY(PlayerRef.position.y + PlayerRef.height * 0.5)
        const los = hasLineOfSight(e.headPosition, _aimAt)

        if (playerDist < SLAM_RANGE && e.ai.attackCd <= 0) {
          // alternate Slam / Sweep
          e.ai.nextAlt = (e.ai.nextAlt ?? 0) === 0 ? 1 : 0
          e.state = e.ai.nextAlt === 1 ? 'slamWindup' : 'sweep'
          e.ai.stateT = 0
          e.ai.swept = 0
          AudioBus.playEnemyChirp()
        } else if (playerDist >= CHARGE_MIN && playerDist <= CHARGE_MAX && los && e.ai.chargeCd <= 0) {
          e.state = 'chargeTelegraph'
          e.ai.stateT = 0
          AudioBus.playEnemyChirp()
        } else {
          // stalk the player — slow turn is the counter-play window
          turnToward(facing.current, toPlayer, TURN_RATE * dt)
          _v.copy(facing.current)
          whiskerSteer(e, _v)
          separationForce(e, _sep)
          _v.addScaledVector(_sep, 1.2).normalize()
          e.velocity.x = _v.x * SPEED_WALK * speedMult
          e.velocity.z = _v.z * SPEED_WALK * speedMult
          moving = true
        }
        break
      }
    }

    if (!integrated) integrateGround(e, dt)
    syncReactor(e)

    // --- visuals ---
    g.position.copy(e.position)
    g.rotation.y = Math.atan2(facing.current.x, facing.current.z)

    // heavy stomp: slow sine, big bob ±0.08, dust puff per step
    if (moving) {
      const prev = Math.sin(walkPhase.current)
      walkPhase.current += dt * 3.2 * speedMult
      const cur = Math.sin(walkPhase.current)
      if (prev > 0 && cur <= 0 && e.grounded) {
        VFX.burst({ position: e.position, color: '#8A8FA3', count: 3, speed: 1.5, life: 0.5, size: 0.1, gravity: -1 })
      }
      const legSwing = Math.sin(walkPhase.current) * 0.35
      if (legL.current) legL.current.rotation.x = legSwing
      if (legR.current) legR.current.rotation.x = -legSwing
    }
    if (bodyGroup.current && e.state !== 'chargeTelegraph' && e.state !== 'slamWindup' && e.alive) {
      bodyGroup.current.position.y = Math.abs(Math.sin(walkPhase.current)) * 0.08
    }

    // chest slit: dim teal → red telegraph / constant red enrage
    const telegraphing = e.state === 'slamWindup' || e.state === 'chargeTelegraph' || e.state === 'charge'
    if (e.hitFlash > 0) {
      mats.plate.emissive.setScalar(0.9)
      mats.slit.color.set('#FFFFFF')
    } else {
      mats.plate.emissive.setScalar(0)
      if (enraged) mats.slit.color.copy(SLIT_RED)
      else if (telegraphing) mats.slit.color.copy(SLIT_RED).multiplyScalar(1.6)
      else mats.slit.color.copy(SLIT_IDLE).multiplyScalar(0.5)
    }
    // reactor pulse — brighter when enraged
    mats.reactor.color.set(COLORS.cadenceTeal).multiplyScalar(enraged ? 2 : 1.2)
  })

  /** back-reactor weakpoint rides behind the torso, opposite the facing */
  function syncReactor(e: EnemyEntity) {
    e.headPosition
      .copy(e.position)
      .addScaledVector(facing.current, -0.55)
      .setY(e.position.y + 1.75)
  }

  return (
    <group ref={group} position={entity.position.toArray()}>
      {/* legs — short columnar */}
      <group ref={legL} position={[-0.35, 0.75, 0]}>
        <mesh material={mats.gunmetal} position={[0, -0.35, 0]} castShadow>
          <cylinderGeometry args={[0.16, 0.2, 0.75, 8]} />
        </mesh>
      </group>
      <group ref={legR} position={[0.35, 0.75, 0]}>
        <mesh material={mats.gunmetal} position={[0, -0.35, 0]} castShadow>
          <cylinderGeometry args={[0.16, 0.2, 0.75, 8]} />
        </mesh>
      </group>

      <group ref={bodyGroup}>
        {/* inverted-teardrop torso: wide-shouldered scaled capsule */}
        <mesh material={mats.plate} position={[0, 1.55, 0]} scale={[1.15, 1, 0.85]} castShadow>
          <capsuleGeometry args={[0.62, 0.7, 6, 12]} />
        </mesh>
        {/* plate shells */}
        <mesh material={mats.plate} position={[0, 1.7, 0.35]} rotation-x={0.2} castShadow>
          <boxGeometry args={[0.9, 0.7, 0.18]} />
        </mesh>
        {/* chest slit — telegraph flare */}
        <mesh material={mats.slit} position={[0, 1.62, 0.53]}>
          <boxGeometry args={[0.08, 0.4, 0.05]} />
        </mesh>
        {/* back reactor — teal weakpoint */}
        <mesh material={mats.reactor} position={[0, 1.75, -0.55]}>
          <sphereGeometry args={[0.18, 12, 10]} />
        </mesh>
        <mesh material={mats.gunmetal} position={[0, 1.75, -0.48]}>
          <torusGeometry args={[0.22, 0.05, 8, 16]} />
        </mesh>
        {/* shoulder pauldrons — petal rosettes */}
        {[-1, 1].map((side) => (
          <group key={side} position={[side * 0.78, 2.05, 0]}>
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <mesh
                key={i}
                material={mats.plate}
                position={[Math.sin((i * Math.PI) / 3) * 0.16, Math.cos((i * Math.PI) / 3) * 0.16, 0]}
                rotation-z={(i * Math.PI) / 3}
                castShadow
              >
                <boxGeometry args={[0.1, 0.24, 0.3]} />
              </mesh>
            ))}
          </group>
        ))}
        {/* tiny recessed head between pauldrons */}
        <mesh material={mats.gunmetal} position={[0, 2.02, 0.1]} castShadow>
          <boxGeometry args={[0.2, 0.16, 0.2]} />
        </mesh>
        {/* arms ending in piston fists */}
        <group ref={armL} position={[-0.85, 1.9, 0]}>
          <mesh material={mats.gunmetal} position={[0, -0.45, 0]} castShadow>
            <capsuleGeometry args={[0.14, 0.6, 4, 8]} />
          </mesh>
          <mesh material={mats.plate} position={[0, -0.95, 0]} castShadow>
            <boxGeometry args={[0.34, 0.4, 0.34]} />
          </mesh>
        </group>
        <group ref={armR} position={[0.85, 1.9, 0]}>
          <mesh material={mats.gunmetal} position={[0, -0.45, 0]} castShadow>
            <capsuleGeometry args={[0.14, 0.6, 4, 8]} />
          </mesh>
          <mesh material={mats.plate} position={[0, -0.95, 0]} castShadow>
            <boxGeometry args={[0.34, 0.4, 0.34]} />
          </mesh>
        </group>
      </group>
    </group>
  )
}

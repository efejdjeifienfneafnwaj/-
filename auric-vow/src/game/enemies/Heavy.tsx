/**
 * AURIC VOW — enemies/Heavy.tsx
 * "CANTOR" Heavy — miniboss bruiser (enemies-mission.md §3).
 *
 * R1 art pass: the primitive stack (six-box "petal" pauldrons, ivory plates
 * shared with the architecture) is replaced by a hunched, top-heavy dark
 * carapace — a forward-leaning slab chest, two layered asymmetric pauldron
 * decks ~2.1 m across, a sunken armoured collar instead of a head void, and
 * columnar legs with real knee joints. Crimson is the only accent, and the
 * back reactor is the one big crimson mass on the model so the flanking
 * weakpoint reads from behind at 30 m.
 *
 * AI loop: < 3 m → Slam/Sweep (alternate) · 6–20 m LOS → Charge (wall impact
 * = 1.5 s self-stagger punish window) · else stalk. ENRAGE at hp < 30% now
 * has a real entrance: roar pose, shockwave, reactor glow build, charge dust.
 */
import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { PlayerRef } from '@/game/player/PlayerRef'
import { addTrauma } from '@/game/player/CameraRig'
import { useGameStore } from '@/game/store'
import { AudioBus } from '@/game/AudioBus'
import { ENEMY_LOOK } from '@/game/config'
import { VFX } from '@/game/vfx/VFXBus'
import { type EnemyEntity } from './EnemyRegistry'
import {
  clearThreat,
  hasLineOfSight,
  integrateGround,
  markThreat,
  separationForce,
  turnToward,
  whiskerSteer,
} from './ai'
import { patchDissolve, makeOutlineMaterial } from './dissolve'

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
const _fx = new THREE.Vector3()
const SLIT_IDLE = new THREE.Color(ENEMY_LOOK.accent).multiplyScalar(0.5)
const SLIT_HOT = new THREE.Color(ENEMY_LOOK.accentHot)
const DUST = '#6E5A52'

export function Heavy({ entity }: { entity: EnemyEntity }) {
  const group = useRef<THREE.Group>(null)
  const bodyGroup = useRef<THREE.Group>(null)
  const chest = useRef<THREE.Group>(null)
  const armL = useRef<THREE.Group>(null)
  const armR = useRef<THREE.Group>(null)
  const hipL = useRef<THREE.Group>(null)
  const hipR = useRef<THREE.Group>(null)
  const kneeL = useRef<THREE.Group>(null)
  const kneeR = useRef<THREE.Group>(null)

  const facing = useRef(new THREE.Vector3(0, 0, 1))
  const chargeDir = useRef(new THREE.Vector3(0, 0, 1))
  const walkPhase = useRef(0)
  const locoW = useRef(0)
  const flinch = useRef(0)
  const prevFlash = useRef(0)
  const wasEnraged = useRef(false)
  const shadowsOff = useRef(false)

  const mats = useMemo(() => {
    const plate = new THREE.MeshStandardMaterial({
      color: ENEMY_LOOK.shellLit,
      metalness: 0.5,
      roughness: 0.5,
    })
    const shell = new THREE.MeshStandardMaterial({
      color: ENEMY_LOOK.shell,
      metalness: 0.4,
      roughness: 0.6,
    })
    const gunmetal = new THREE.MeshStandardMaterial({
      color: ENEMY_LOOK.joint,
      metalness: 0.92,
      roughness: 0.32,
    })
    const reactor = new THREE.MeshBasicMaterial({
      color: ENEMY_LOOK.accent,
      toneMapped: false,
      transparent: true,
    })
    const slit = new THREE.MeshBasicMaterial({ color: ENEMY_LOOK.accent, toneMapped: false })
    const dPlate = patchDissolve(plate)
    const dShell = patchDissolve(shell)
    const dGun = patchDissolve(gunmetal, { rimStrength: ENEMY_LOOK.rimStrength * 0.5 })
    const outline = makeOutlineMaterial(ENEMY_LOOK.outline.pixels * 1.2)
    return { plate, shell, gunmetal, reactor, slit, dPlate, dShell, dGun, outline }
  }, [])

  useEffect(() => {
    return () => {
      mats.plate.dispose()
      mats.shell.dispose()
      mats.gunmetal.dispose()
      mats.reactor.dispose()
      mats.slit.dispose()
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
    if (e.hitFlash > prevFlash.current + 0.001 && e.alive) {
      flinch.current = 1
      _v.subVectors(PlayerRef.position, e.position).setY(0).normalize()
      _fx.copy(e.position).setY(e.position.y + 1.7).addScaledVector(_v, 0.6)
      VFX.burst({
        position: _fx,
        color: ENEMY_LOOK.accentHot,
        count: 5,
        speed: 5,
        life: 0.24,
        size: 0.05,
        gravity: -3,
      })
    }
    prevFlash.current = e.hitFlash
    e.hitFlash = Math.max(0, e.hitFlash - dt)
    e.impactCooldown = Math.max(0, e.impactCooldown - dt)
    flinch.current = Math.max(0, flinch.current - dt * 4)
    const enraged = e.hp / e.maxHp < ENRAGE_HP
    const speedMult = enraged ? 1.3 : 1
    const cdMult = enraged ? 0.75 : 1

    if (!e.alive) {
      // kneel-collapse (0.45 s) then dissolve — the legs fold WITH the torso
      // instead of the torso lerping 0.7 m down through them (N3)
      if (!shadowsOff.current) {
        shadowsOff.current = true
        clearThreat(e.id)
        g.traverse((o) => {
          const m = o as THREE.Mesh
          if (m.isMesh) m.castShadow = false
        })
      }
      const t = e.deathTimer
      const k = Math.min(1, t / 0.45)
      const ease = k * k * (3 - 2 * k)
      if (hipL.current) hipL.current.rotation.x = -1.35 * ease
      if (hipR.current) hipR.current.rotation.x = -1.1 * ease
      if (kneeL.current) kneeL.current.rotation.x = 2.0 * ease
      if (kneeR.current) kneeR.current.rotation.x = 1.7 * ease
      if (bodyGroup.current) {
        bodyGroup.current.position.y = -0.62 * ease
        bodyGroup.current.rotation.x = 0.62 * ease
      }
      if (armL.current) armL.current.rotation.x = 0.9 * ease
      if (armR.current) armR.current.rotation.x = 0.7 * ease
      const d = THREE.MathUtils.clamp((t - 0.45) / 0.6, 0, 1)
      mats.dPlate.uniform.value = d
      mats.dShell.uniform.value = d
      mats.dGun.uniform.value = d
      mats.outline.setOpacity(ENEMY_LOOK.outline.opacity * Math.max(0, 1 - d * 2.2))
      mats.reactor.opacity = Math.max(0, 1 - d * 3)
      g.position.copy(e.position)
      return
    }

    _v.subVectors(PlayerRef.position, e.position).setY(0)
    const playerDist = _v.length()
    const toPlayer = _v.normalize()

    // --- ENRAGE entrance: roar, shockwave, reactor glow build (N10) -------
    if (enraged && !wasEnraged.current) {
      wasEnraged.current = true
      _fx.copy(e.position).setY(e.position.y + 1.6)
      VFX.ring({ position: e.position, color: ENEMY_LOOK.accentHot, maxRadius: 5, life: 0.55, width: 0.35 })
      VFX.flash({ position: _fx, color: ENEMY_LOOK.accentHot, intensity: 14, distance: 14, life: 0.35 })
      VFX.burst({
        position: _fx,
        color: ENEMY_LOOK.accentHot,
        count: 20,
        speed: 7,
        life: 0.55,
        size: 0.08,
        gravity: -4,
      })
      AudioBus.playEnemyChirp()
      if (playerDist < 30) addTrauma(0.3)
    }

    // --- stagger (Requiem 0.6s via registry, or wall-charge impact 1.5s) ---
    if (e.staggerTimer > 0) {
      e.staggerTimer -= dt
      e.velocity.x = 0
      e.velocity.z = 0
      integrateGround(e, dt)
      g.position.copy(e.position)
      const k = Math.min(1, 6 * dt)
      if (bodyGroup.current) {
        bodyGroup.current.rotation.z = Math.sin(e.staggerTimer * 20) * 0.06
        bodyGroup.current.rotation.x = THREE.MathUtils.lerp(bodyGroup.current.rotation.x, 0.35, k)
        bodyGroup.current.position.y = THREE.MathUtils.lerp(bodyGroup.current.position.y, -0.24, k)
      }
      if (kneeL.current) kneeL.current.rotation.x = THREE.MathUtils.lerp(kneeL.current.rotation.x, 0.9, k)
      if (hipL.current) hipL.current.rotation.x = THREE.MathUtils.lerp(hipL.current.rotation.x, -0.55, k)
      if (armL.current) armL.current.rotation.x = THREE.MathUtils.lerp(armL.current.rotation.x, 0.4, k)
      if (armR.current) armR.current.rotation.x = THREE.MathUtils.lerp(armR.current.rotation.x, 0.4, k)
      mats.slit.color.copy(SLIT_HOT).multiplyScalar(0.6 + Math.random() * 0.4)
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
    /** 0..1 how much the pose is being driven by an attack this frame */
    let posed = 0

    switch (e.state) {
      case 'slamWindup': {
        e.velocity.x = 0
        e.velocity.z = 0
        posed = 1
        markThreat(e, 'melee', 0.25)
        // fists rise; red flare handled in visuals
        const k = Math.min(1, e.ai.stateT / SLAM_WINDUP)
        if (armL.current) armL.current.rotation.x = -2.2 * k
        if (armR.current) armR.current.rotation.x = -2.2 * k
        if (chest.current) chest.current.rotation.x = -0.18 * k
        turnToward(facing.current, toPlayer, TURN_RATE * 0.5 * dt)
        if (e.ai.stateT >= SLAM_WINDUP) {
          // SLAM lands — 2.5 m AoE
          if (armL.current) armL.current.rotation.x = 0.5
          if (armR.current) armR.current.rotation.x = 0.5
          if (chest.current) chest.current.rotation.x = 0.25
          VFX.ring({ position: e.position, color: ENEMY_LOOK.accentHot, maxRadius: SLAM_AOE + 0.6, life: 0.4, width: 0.25 })
          VFX.burst({ position: e.position, color: DUST, count: 14, speed: 5, life: 0.5, size: 0.09, gravity: -6 })
          VFX.burst({ position: e.position, color: ENEMY_LOOK.accentHot, count: 10, speed: 6, life: 0.35, size: 0.06, gravity: -8 })
          AudioBus.playEnemyChirp()
          if (playerDist < 18) addTrauma(0.22)
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
        posed = 1
        markThreat(e, 'melee', 0.25)
        // 180° arm sweep over 0.4s
        const k = Math.min(1, e.ai.stateT / 0.4)
        if (armR.current) {
          armR.current.rotation.y = THREE.MathUtils.lerp(-1.6, 1.6, k)
          armR.current.rotation.x = -0.5 + Math.sin(k * Math.PI) * 0.35
        }
        if (chest.current) chest.current.rotation.y = THREE.MathUtils.lerp(0.3, -0.3, k)
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
          if (chest.current) chest.current.rotation.y = 0
          e.state = 'attack'
          e.ai.stateT = 0
          e.ai.attackCd = ATTACK_COOLDOWN * cdMult
        }
        break
      }

      case 'chargeTelegraph': {
        e.velocity.x = 0
        e.velocity.z = 0
        posed = 1
        markThreat(e, 'charge', 0.3)
        // 0.5s crouch telegraph, lock aim at the end
        const k = Math.min(1, e.ai.stateT / CHARGE_TELEGRAPH)
        if (bodyGroup.current) bodyGroup.current.scale.y = 1 - 0.15 * k
        if (chest.current) chest.current.rotation.x = 0.26 * k
        if (hipL.current) hipL.current.rotation.x = -0.32 * k
        if (hipR.current) hipR.current.rotation.x = 0.28 * k
        if (armL.current) armL.current.rotation.x = -0.5 * k
        if (armR.current) armR.current.rotation.x = -0.5 * k
        turnToward(facing.current, toPlayer, TURN_RATE * 1.5 * dt)
        if (e.ai.stateT >= CHARGE_TELEGRAPH) {
          chargeDir.current.copy(facing.current).normalize()
          e.state = 'charge'
          e.ai.stateT = 0
          e.ai.charged = 0
          e.ai.dustT = 0
          AudioBus.playEnemyChirp()
          _fx.copy(e.headPosition)
          VFX.flash({ position: _fx, color: ENEMY_LOOK.accentHot, intensity: 10, distance: 10, life: 0.2 })
        }
        break
      }

      case 'charge': {
        posed = 1
        markThreat(e, 'charge', 0.2)
        const step = SPEED_CHARGE * dt
        e.velocity.x = chargeDir.current.x * SPEED_CHARGE
        e.velocity.z = chargeDir.current.z * SPEED_CHARGE
        const before = e.position.x * chargeDir.current.x + e.position.z * chargeDir.current.z
        integrateGround(e, dt)
        integrated = true
        const after = e.position.x * chargeDir.current.x + e.position.z * chargeDir.current.z
        e.ai.charged = (e.ai.charged ?? 0) + step
        moving = true

        // charge scar: dust kicked out of the floor along the run (N10)
        e.ai.dustT = (e.ai.dustT ?? 0) - dt
        if (e.ai.dustT <= 0) {
          e.ai.dustT = 0.07
          _fx.copy(e.position).addScaledVector(chargeDir.current, -0.7)
          VFX.burst({ position: _fx, color: DUST, count: 3, speed: 2.6, life: 0.45, size: 0.11, gravity: -3 })
        }
        // low forward lean + pumping arms while charging
        if (chest.current) chest.current.rotation.x = 0.3
        if (armL.current) armL.current.rotation.x = Math.sin(e.ai.charged * 2.2) * 0.7 - 0.3
        if (armR.current) armR.current.rotation.x = -Math.sin(e.ai.charged * 2.2) * 0.7 - 0.3

        // wall impact → self-stagger punish window (1.5s)
        const blocked = after - before < step * 0.4
        if (blocked && e.impactCooldown <= 0) {
          e.impactCooldown = 1
          e.staggerTimer = 1.5
          e.state = 'stagger'
          e.velocity.set(0, 0, 0)
          VFX.ring({ position: e.position, color: ENEMY_LOOK.accentHot, maxRadius: 3, life: 0.5, width: 0.3 })
          VFX.burst({ position: e.position, color: DUST, count: 18, speed: 6, life: 0.6, size: 0.1, gravity: -5 })
          AudioBus.playEnemyChirp()
          if (playerDist < 24) addTrauma(0.35)
          break
        }

        // player contact → 25 dmg + knockdown impulse (player controller owns physics)
        if (playerDist < e.radius + PlayerRef.radius + 0.3 && e.ai.hitPlayer !== 1) {
          e.ai.hitPlayer = 1
          s.damagePlayer(CHARGE_DAMAGE)
          s.pushDamageEvent({ position: PlayerRef.position.clone(), amount: CHARGE_DAMAGE, kind: 'player' })
          AudioBus.playHurt()
          addTrauma(0.4)
          VFX.burst({ position: PlayerRef.position, color: ENEMY_LOOK.accentHot, count: 12, speed: 6, life: 0.4, size: 0.07 })
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

    // heavy stomp: slow sine, big bob, dust puff per planted foot
    const groundSpeed = Math.hypot(e.velocity.x, e.velocity.z)
    locoW.current += ((moving && groundSpeed > 0.4 ? 1 : 0) - locoW.current) * Math.min(1, dt * 6)
    const w = locoW.current
    if (moving) {
      const prev = Math.sin(walkPhase.current)
      walkPhase.current += dt * 3.2 * speedMult
      const cur = Math.sin(walkPhase.current)
      if (prev > 0 && cur <= 0 && e.grounded) {
        VFX.burst({ position: e.position, color: DUST, count: 4, speed: 1.8, life: 0.55, size: 0.12, gravity: -2 })
        if (playerDist < 14) addTrauma(0.035)
      }
    }
    const ph = walkPhase.current
    const legSwing = Math.sin(ph) * 0.4 * w
    if (hipL.current && posed < 1) hipL.current.rotation.x = legSwing
    if (hipR.current && posed < 1) hipR.current.rotation.x = -legSwing
    if (kneeL.current && posed < 1) kneeL.current.rotation.x = (0.1 + Math.max(0, Math.sin(ph + Math.PI)) * 0.75) * w
    if (kneeR.current && posed < 1) kneeR.current.rotation.x = (0.1 + Math.max(0, Math.sin(ph)) * 0.75) * w
    if (bodyGroup.current && posed < 1 && e.alive) {
      bodyGroup.current.position.y = Math.abs(Math.sin(ph)) * 0.08 * w
      bodyGroup.current.rotation.x = THREE.MathUtils.lerp(bodyGroup.current.rotation.x, 0, Math.min(1, 5 * dt))
    }

    // N9: arms and chest RETURN to idle instead of staying cocked at 0.5 rad
    if (posed < 1) {
      const k = Math.min(1, 5 * dt)
      const idleL = Math.sin(ph + Math.PI) * 0.22 * w - 0.1 - flinch.current * 0.3
      const idleR = Math.sin(ph) * 0.22 * w - 0.1 - flinch.current * 0.3
      if (armL.current) {
        armL.current.rotation.x = THREE.MathUtils.lerp(armL.current.rotation.x, idleL, k)
        armL.current.rotation.z = THREE.MathUtils.lerp(armL.current.rotation.z, -0.12, k)
      }
      if (armR.current) {
        armR.current.rotation.x = THREE.MathUtils.lerp(armR.current.rotation.x, idleR, k)
        armR.current.rotation.y = THREE.MathUtils.lerp(armR.current.rotation.y, 0, k)
        armR.current.rotation.z = THREE.MathUtils.lerp(armR.current.rotation.z, 0.12, k)
      }
      if (chest.current) {
        chest.current.rotation.x = THREE.MathUtils.lerp(
          chest.current.rotation.x,
          0.12 + Math.sin(ph * 2) * 0.02 * w - flinch.current * 0.2,
          k,
        )
        chest.current.rotation.y = THREE.MathUtils.lerp(chest.current.rotation.y, -Math.sin(ph) * 0.1 * w, k)
        // idle sway on a wall clock — the stride phase freezes when standing
        chest.current.rotation.z = THREE.MathUtils.lerp(
          chest.current.rotation.z,
          Math.sin(performance.now() * 0.0009) * 0.025 * (1 - w),
          k,
        )
      }
    }

    // chest slit: dim idle → hot telegraph / constant hot enrage
    const telegraphing = e.state === 'slamWindup' || e.state === 'chargeTelegraph' || e.state === 'charge'
    if (e.hitFlash > 0) {
      mats.plate.emissive.setScalar(0.85)
      mats.shell.emissive.setScalar(0.7)
      mats.slit.color.set('#FFFFFF')
    } else {
      mats.plate.emissive.setScalar(0)
      mats.shell.emissive.setScalar(0)
      if (enraged) mats.slit.color.copy(SLIT_HOT).multiplyScalar(1.4 + Math.sin(performance.now() * 0.008) * 0.3)
      else if (telegraphing) mats.slit.color.copy(SLIT_HOT).multiplyScalar(1.8)
      else mats.slit.color.copy(SLIT_IDLE)
    }
    // reactor pulse — brighter when enraged
    mats.reactor.color
      .copy(SLIT_HOT)
      .multiplyScalar(enraged ? 2.2 + Math.sin(performance.now() * 0.01) * 0.5 : 1.1)
  })

  /** back-reactor weakpoint rides behind the torso, opposite the facing */
  function syncReactor(e: EnemyEntity) {
    e.headPosition
      .copy(e.position)
      .addScaledVector(facing.current, -0.55)
      .setY(e.position.y + 1.75)
  }

  const o = mats.outline.material

  return (
    <group ref={group} position={entity.position.toArray()}>
      {/* ---- legs: columnar thigh → knee → splayed foot ---- */}
      {[-1, 1].map((side) => {
        const hip = side < 0 ? hipL : hipR
        const knee = side < 0 ? kneeL : kneeR
        return (
          <group key={side} ref={hip} position={[side * 0.34, 0.92, 0]}>
            <mesh material={mats.gunmetal} position={[0, -0.16, 0]} castShadow>
              <cylinderGeometry args={[0.19, 0.17, 0.4, 10]} />
            </mesh>
            <mesh material={mats.shell} position={[side * 0.06, -0.14, 0]} rotation-z={side * 0.1} castShadow>
              <boxGeometry args={[0.2, 0.36, 0.3]} />
            </mesh>
            <group ref={knee} position={[0, -0.38, 0]}>
              <mesh material={mats.gunmetal} position={[0, -0.22, 0]} castShadow>
                <cylinderGeometry args={[0.15, 0.17, 0.44, 10]} />
              </mesh>
              <mesh material={mats.plate} position={[0, -0.16, 0.1]} castShadow>
                <boxGeometry args={[0.2, 0.28, 0.12]} />
              </mesh>
              {/* splayed foot — the wide base the mass needs */}
              <mesh material={mats.shell} position={[0, -0.46, 0.08]} castShadow>
                <boxGeometry args={[0.3, 0.16, 0.46]} />
              </mesh>
              <mesh material={o} position={[0, -0.46, 0.08]}>
                <boxGeometry args={[0.3, 0.16, 0.46]} />
              </mesh>
            </group>
          </group>
        )
      })}

      <group ref={bodyGroup}>
        {/* ---- hips ---- */}
        <mesh material={mats.shell} position={[0, 1.12, 0]} castShadow>
          <boxGeometry args={[0.86, 0.34, 0.62]} />
        </mesh>
        <mesh material={o} position={[0, 1.12, 0]}>
          <boxGeometry args={[0.86, 0.34, 0.62]} />
        </mesh>
        {/* waist skirt plates */}
        {[-1, 1].map((side) => (
          <mesh
            key={side}
            material={mats.plate}
            position={[side * 0.4, 1.0, 0.04]}
            rotation-z={side * 0.22}
            castShadow
          >
            <boxGeometry args={[0.18, 0.34, 0.5]} />
          </mesh>
        ))}

        <group ref={chest} position={[0, 1.34, 0]}>
          {/* ---- hunched slab torso: wide at the deck, narrow at the waist ---- */}
          <mesh material={mats.shell} position={[0, 0.34, -0.02]} castShadow>
            <boxGeometry args={[1.0, 0.78, 0.66]} />
          </mesh>
          <mesh material={o} position={[0, 0.34, -0.02]}>
            <boxGeometry args={[1.0, 0.78, 0.66]} />
          </mesh>
          {/* forward-raked chest plate */}
          <mesh material={mats.plate} position={[0, 0.36, 0.33]} rotation-x={0.22} castShadow>
            <boxGeometry args={[0.84, 0.66, 0.14]} />
          </mesh>
          <mesh material={mats.plate} position={[0, 0.66, 0.16]} rotation-x={-0.4} castShadow>
            <boxGeometry args={[0.7, 0.24, 0.16]} />
          </mesh>
          {/* chest slit — telegraph flare, in a dark recess */}
          <mesh material={mats.gunmetal} position={[0, 0.34, 0.4]} castShadow>
            <boxGeometry args={[0.18, 0.5, 0.06]} />
          </mesh>
          <mesh material={mats.slit} position={[0, 0.34, 0.44]}>
            <boxGeometry args={[0.07, 0.42, 0.03]} />
          </mesh>

          {/* ---- back reactor — the crimson weakpoint mass ---- */}
          <mesh material={mats.gunmetal} position={[0, 0.41, -0.38]} castShadow>
            <boxGeometry args={[0.56, 0.5, 0.2]} />
          </mesh>
          <mesh material={mats.reactor} position={[0, 0.41, -0.5]}>
            <sphereGeometry args={[0.2, 14, 10]} />
          </mesh>
          <mesh material={mats.gunmetal} position={[0, 0.41, -0.44]} rotation-x={Math.PI / 2}>
            <torusGeometry args={[0.25, 0.055, 8, 18]} />
          </mesh>
          {/* exhaust stacks flanking the reactor */}
          {[-1, 1].map((side) => (
            <mesh key={side} material={mats.gunmetal} position={[side * 0.34, 0.72, -0.3]} castShadow>
              <cylinderGeometry args={[0.07, 0.09, 0.34, 8]} />
            </mesh>
          ))}

          {/* ---- pauldron decks: two layered asymmetric slabs per side ---- */}
          {[-1, 1].map((side) => (
            <group key={side} position={[side * 0.62, 0.62, 0]}>
              <mesh material={mats.plate} position={[0, 0.06, 0]} rotation-z={side * 0.3} castShadow>
                <boxGeometry args={[0.5, 0.24, 0.66]} />
              </mesh>
              <mesh material={mats.shell} position={[side * 0.17, -0.12, 0]} rotation-z={side * 0.48} castShadow>
                <boxGeometry args={[0.36, 0.2, 0.56]} />
              </mesh>
              <mesh
                material={mats.plate}
                position={[side * (side < 0 ? 0.3 : 0.24), 0.18, -0.04]}
                rotation-z={side * 0.16}
                castShadow
              >
                <boxGeometry args={[0.22, 0.16, 0.42]} />
              </mesh>
              <mesh material={o} position={[0, 0.06, 0]} rotation-z={side * 0.3}>
                <boxGeometry args={[0.5, 0.24, 0.66]} />
              </mesh>
            </group>
          ))}

          {/* ---- sunken armoured collar (no head void) ---- */}
          <mesh material={mats.gunmetal} position={[0, 0.74, 0.02]} castShadow>
            <boxGeometry args={[0.44, 0.2, 0.42]} />
          </mesh>
          <mesh material={mats.shell} position={[0, 0.84, 0.05]} rotation-x={0.16} castShadow>
            <boxGeometry args={[0.34, 0.22, 0.34]} />
          </mesh>
          <mesh material={mats.slit} position={[0, 0.84, 0.23]}>
            <boxGeometry args={[0.2, 0.035, 0.03]} />
          </mesh>

          {/* ---- arms ending in piston fists ---- */}
          {[-1, 1].map((side) => {
            const arm = side < 0 ? armL : armR
            return (
              <group key={side} ref={arm} position={[side * 0.76, 0.5, 0]}>
                <mesh material={mats.gunmetal} position={[0, -0.3, 0]} castShadow>
                  <capsuleGeometry args={[0.15, 0.4, 4, 8]} />
                </mesh>
                <mesh material={mats.shell} position={[side * 0.05, -0.28, 0]} rotation-z={side * 0.1} castShadow>
                  <boxGeometry args={[0.2, 0.42, 0.28]} />
                </mesh>
                {/* piston sleeve */}
                <mesh material={mats.gunmetal} position={[0, -0.64, 0]} castShadow>
                  <cylinderGeometry args={[0.12, 0.15, 0.24, 8]} />
                </mesh>
                <mesh material={mats.shell} position={[0, -0.9, 0.02]} castShadow>
                  <boxGeometry args={[0.38, 0.4, 0.42]} />
                </mesh>
                <mesh material={mats.plate} position={[0, -0.9, 0.24]} castShadow>
                  <boxGeometry args={[0.3, 0.3, 0.1]} />
                </mesh>
                <mesh material={o} position={[0, -0.9, 0.02]}>
                  <boxGeometry args={[0.38, 0.4, 0.42]} />
                </mesh>
              </group>
            )
          })}
        </group>
      </group>
    </group>
  )
}

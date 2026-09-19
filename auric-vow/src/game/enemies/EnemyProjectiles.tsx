/**
 * AURIC VOW — enemies/EnemyProjectiles.tsx
 * Pooled enemy bolts (drone bolts + trooper burst rounds). Fixed-size pool,
 * one instanced mesh, viridian/teal emissive. Bolts raycast the level and
 * test the player capsule; hits call store.damagePlayer + a 'player'
 * damage event (directional vignette arcs are the HUD layer's job).
 */
import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { raycastLevel } from '@/game/world/Colliders'
import { PlayerRef } from '@/game/player/PlayerRef'
import { useGameStore } from '@/game/store'
import { AudioBus } from '@/game/AudioBus'
import { COLORS } from '@/game/config'
import { VFX } from '@/game/vfx/VFXBus'

const MAX_BOLTS = 64
const BOLT_RADIUS = 0.14

interface Bolt {
  active: boolean
  position: THREE.Vector3
  velocity: THREE.Vector3
  damage: number
  life: number
}

const pool: Bolt[] = Array.from({ length: MAX_BOLTS }, () => ({
  active: false,
  position: new THREE.Vector3(),
  velocity: new THREE.Vector3(),
  damage: 0,
  life: 0,
}))

/** fire an enemy bolt — called by enemy AI components */
export function fireEnemyBolt(origin: THREE.Vector3, dir: THREE.Vector3, speed: number, damage: number) {
  const b = pool.find((x) => !x.active)
  if (!b) return
  b.active = true
  b.position.copy(origin)
  b.velocity.copy(dir).normalize().multiplyScalar(speed)
  b.damage = damage
  b.life = 5
  VFX.flash({ position: origin, color: COLORS.viridianFlare, intensity: 3, distance: 4, life: 0.12 })
}

const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _s = new THREE.Vector3(1, 1, 2.6) // slight stretch along travel dir
const _step = new THREE.Vector3()
const _seg = new THREE.Vector3()
const _toP = new THREE.Vector3()
const _closest = new THREE.Vector3()
const _up = new THREE.Vector3(0, 1, 0)
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0)

export function EnemyBoltPool() {
  const meshRef = useRef<THREE.InstancedMesh>(null)

  const geom = useMemo(() => new THREE.SphereGeometry(BOLT_RADIUS, 8, 6), [])
  const mat = useMemo(
    () => new THREE.MeshBasicMaterial({ color: COLORS.viridianFlare, toneMapped: false }),
    [],
  )

  useFrame((_, delta) => {
    const mesh = meshRef.current
    if (!mesh) return
    const s = useGameStore.getState()
    const paused = s.phase === 'WIN' || s.phase === 'LOSE'
    const clearing = s.phase === 'DROPSHIP' // run restart: no stray bolts
    const dt = Math.min(delta, 0.05) * s.timeScale

    for (let i = 0; i < MAX_BOLTS; i++) {
      const b = pool[i]
      if (!b.active) {
        mesh.setMatrixAt(i, HIDDEN)
        continue
      }
      if (clearing) {
        b.active = false
        mesh.setMatrixAt(i, HIDDEN)
        continue
      }
      if (!paused) {
        b.life -= dt
        _step.copy(b.velocity).multiplyScalar(dt)
        const stepLen = _step.length()

        // wall hit?
        const hit = stepLen > 0 ? raycastLevel(b.position, _step.clone().normalize(), stepLen + BOLT_RADIUS) : null
        if (hit) {
          b.active = false
          VFX.burst({ position: hit.point, color: COLORS.viridianFlare, count: 5, speed: 3, life: 0.3, size: 0.04 })
          mesh.setMatrixAt(i, HIDDEN)
          continue
        }
        b.position.add(_step)

        // player capsule hit? (segment feet→head, radius = player radius + bolt)
        const pR = PlayerRef.radius + BOLT_RADIUS
        _seg.set(0, PlayerRef.height, 0)
        _toP.subVectors(b.position, PlayerRef.position)
        const t = THREE.MathUtils.clamp(_toP.dot(_seg) / _seg.lengthSq(), 0, 1)
        _closest.copy(PlayerRef.position).addScaledVector(_seg, t)
        if (_closest.distanceToSquared(b.position) < pR * pR) {
          b.active = false
          s.damagePlayer(b.damage)
          s.pushDamageEvent({ position: b.position.clone(), amount: b.damage, kind: 'player' })
          AudioBus.playHurt()
          VFX.burst({ position: b.position, color: COLORS.viridianFlare, count: 6, speed: 4, life: 0.3, size: 0.05 })
          mesh.setMatrixAt(i, HIDDEN)
          continue
        }
        if (b.life <= 0) {
          b.active = false
          mesh.setMatrixAt(i, HIDDEN)
          continue
        }
      }

      _q.setFromUnitVectors(_up, _step.lengthSq() > 0 ? _step.clone().normalize() : _up)
      _m.compose(b.position, _q, _s)
      mesh.setMatrixAt(i, _m)
    }
    mesh.instanceMatrix.needsUpdate = true
  })

  return <instancedMesh ref={meshRef} args={[geom, mat, MAX_BOLTS]} frustumCulled={false} />
}

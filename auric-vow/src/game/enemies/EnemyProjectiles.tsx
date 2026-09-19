/**
 * AURIC VOW — enemies/EnemyProjectiles.tsx
 * Pooled enemy bolts (drone bolts + trooper burst rounds). Fixed-size pool,
 * two instanced meshes, crimson emissive. Bolts raycast the level and test
 * the player capsule; hits call store.damagePlayer + a 'player' damage event
 * (directional vignette arcs are the HUD layer's job).
 *
 * [R2] Three fixes the review asked for:
 *  · colour. The bolts were viridian green — a hue the R2 colour script no
 *    longer assigns to hostiles at all, so incoming fire read as friendly
 *    pickup VFX. They are now the ENEMY_LOOK crimson the bodies are built
 *    from, authored above the 1.0 bloom knee so a bolt actually glows.
 *  · shape. A single flat-lit sphere is the clearest primitive tell in the
 *    game. Each bolt is now a hot stretched core under a camera-facing
 *    falloff card off the shared hostile glow texture.
 *  · allocation. The old update ran `_step.clone().normalize()` twice per
 *    bolt per frame — up to 128 Vector3 a frame at pool capacity, inside
 *    useFrame. Nothing in the loop allocates now.
 */
import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { raycastLevel } from '@/game/world/Colliders'
import { PlayerRef } from '@/game/player/PlayerRef'
import { useGameStore } from '@/game/store'
import { AudioBus } from '@/game/AudioBus'
import { ENEMY_FX, ENEMY_LOOK } from '@/game/config'
import { VFX } from '@/game/vfx/VFXBus'
import { getEnemyGlowTexture } from './dissolve'

const MAX_BOLTS = 64
const BOLT_RADIUS = 0.14
/** halo card edge length in metres */
const GLOW_SIZE = 1.15

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
  VFX.flash({ position: origin, color: ENEMY_LOOK.accentHot, intensity: 3, distance: 4, life: 0.12 })
}

const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _s = new THREE.Vector3(1, 1, 2.6) // stretch along travel dir
const _sGlow = new THREE.Vector3(GLOW_SIZE, GLOW_SIZE, GLOW_SIZE)
const _step = new THREE.Vector3()
const _dir = new THREE.Vector3()
const _seg = new THREE.Vector3()
const _toP = new THREE.Vector3()
const _closest = new THREE.Vector3()
const _up = new THREE.Vector3(0, 1, 0)
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0)

export function EnemyBoltPool() {
  const coreRef = useRef<THREE.InstancedMesh>(null)
  const glowRef = useRef<THREE.InstancedMesh>(null)

  const geom = useMemo(() => new THREE.SphereGeometry(BOLT_RADIUS, 8, 6), [])
  const glowGeom = useMemo(() => new THREE.PlaneGeometry(1, 1), [])
  const mat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        // authored above the bloom knee: a bolt is a light source, not a pebble
        color: new THREE.Color(ENEMY_LOOK.accentHot).multiplyScalar(ENEMY_FX.accentTelegraph),
        toneMapped: false,
        fog: false,
      }),
    [],
  )
  const glowMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        map: getEnemyGlowTexture(),
        color: new THREE.Color(ENEMY_LOOK.accent).multiplyScalar(1.6),
        transparent: true,
        opacity: 0.7,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
        fog: false,
      }),
    [],
  )

  useFrame((state, delta) => {
    const core = coreRef.current
    const glow = glowRef.current
    if (!core || !glow) return
    const s = useGameStore.getState()
    const paused = s.phase === 'WIN' || s.phase === 'LOSE'
    const clearing = s.phase === 'DROPSHIP' // run restart: no stray bolts
    const dt = Math.min(delta, 0.05) * s.timeScale
    // one billboard orientation for every halo card this frame
    const camQ = state.camera.quaternion

    for (let i = 0; i < MAX_BOLTS; i++) {
      const b = pool[i]
      if (!b.active) {
        core.setMatrixAt(i, HIDDEN)
        glow.setMatrixAt(i, HIDDEN)
        continue
      }
      if (clearing) {
        b.active = false
        core.setMatrixAt(i, HIDDEN)
        glow.setMatrixAt(i, HIDDEN)
        continue
      }
      if (!paused) {
        b.life -= dt
        _step.copy(b.velocity).multiplyScalar(dt)
        const stepLen = _step.length()
        if (stepLen > 0) _dir.copy(_step).divideScalar(stepLen)
        else _dir.copy(_up)

        // wall hit?
        const hit = stepLen > 0 ? raycastLevel(b.position, _dir, stepLen + BOLT_RADIUS) : null
        if (hit) {
          b.active = false
          VFX.burst({ position: hit.point, color: ENEMY_LOOK.accentHot, count: 5, speed: 3, life: 0.3, size: 0.04 })
          core.setMatrixAt(i, HIDDEN)
          glow.setMatrixAt(i, HIDDEN)
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
          VFX.burst({ position: b.position, color: ENEMY_LOOK.accentHot, count: 6, speed: 4, life: 0.3, size: 0.05 })
          core.setMatrixAt(i, HIDDEN)
          glow.setMatrixAt(i, HIDDEN)
          continue
        }
        if (b.life <= 0) {
          b.active = false
          core.setMatrixAt(i, HIDDEN)
          glow.setMatrixAt(i, HIDDEN)
          continue
        }
      } else {
        _dir.copy(_up)
      }

      _q.setFromUnitVectors(_up, _dir)
      _m.compose(b.position, _q, _s)
      core.setMatrixAt(i, _m)
      _m.compose(b.position, camQ, _sGlow)
      glow.setMatrixAt(i, _m)
    }
    core.instanceMatrix.needsUpdate = true
    glow.instanceMatrix.needsUpdate = true
  })

  return (
    <group>
      <instancedMesh ref={coreRef} args={[geom, mat, MAX_BOLTS]} frustumCulled={false} renderOrder={19} />
      <instancedMesh
        ref={glowRef}
        args={[glowGeom, glowMat, MAX_BOLTS]}
        frustumCulled={false}
        renderOrder={20}
      />
    </group>
  )
}

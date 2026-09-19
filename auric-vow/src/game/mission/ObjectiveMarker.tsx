/**
 * AURIC VOW — mission/ObjectiveMarker.tsx
 * World-space objective marker (design.md §5): gold diamond + pulsing ring,
 * floats and rotates above the target, visible through walls (depthTest off).
 * Position comes from store.objectivePosition, falling back to the current
 * phase's zone target (mission/zones.ts). Hidden when both are null
 * (EXTERMINATE — the arena medallion takes over as the focus).
 */
import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useGameStore } from '@/game/store'
import { COLORS } from '@/game/config'
import { zoneTargetForPhase } from './zones'

const _fallback = new THREE.Vector3()

export function ObjectiveMarker() {
  const group = useRef<THREE.Group>(null)
  const ring = useRef<THREE.Mesh>(null)
  const diamond = useRef<THREE.Mesh>(null)
  const clock = useRef(0)

  const mats = useMemo(
    () => ({
      diamond: new THREE.MeshBasicMaterial({
        color: COLORS.aureate,
        toneMapped: false,
        transparent: true,
        opacity: 0.95,
        depthTest: false,
      }),
      ring: new THREE.MeshBasicMaterial({
        color: COLORS.solarWhite,
        toneMapped: false,
        transparent: true,
        opacity: 0.7,
        depthTest: false,
        side: THREE.DoubleSide,
      }),
    }),
    [],
  )

  useFrame((_, delta) => {
    const g = group.current
    if (!g) return
    const s = useGameStore.getState()
    const dt = Math.min(delta, 0.05) * s.timeScale
    clock.current += dt

    // store position wins; fall back to the phase's zone target
    let target = s.objectivePosition
    if (!target) {
      const fb = zoneTargetForPhase(s.phase)
      target = fb ? _fallback.copy(fb) : null
    }
    g.visible = target !== null && s.phase !== 'WIN' && s.phase !== 'LOSE'
    if (!target) return

    // float above the anchor + slow spin + breathing pulse
    g.position.set(target.x, target.y + 2.2 + Math.sin(clock.current * 2) * 0.25, target.z)
    if (diamond.current) diamond.current.rotation.y += dt * 1.8
    const pulse = 1 + Math.sin(clock.current * 3.2) * 0.18
    if (ring.current) {
      ring.current.scale.setScalar(pulse)
      ring.current.rotation.x = Math.PI / 2
      mats.ring.opacity = 0.45 + 0.3 * (0.5 + 0.5 * Math.sin(clock.current * 3.2))
    }
  })

  return (
    <group ref={group} renderOrder={999}>
      {/* gold diamond */}
      <mesh ref={diamond} material={mats.diamond} renderOrder={999}>
        <octahedronGeometry args={[0.35, 0]} />
      </mesh>
      {/* pulsing ground ring under the diamond */}
      <mesh ref={ring} material={mats.ring} position={[0, -1.9, 0]} renderOrder={998}>
        <ringGeometry args={[0.7, 0.85, 40]} />
      </mesh>
    </group>
  )
}

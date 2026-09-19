/**
 * AURIC VOW — world/Lighting.tsx
 * Light rig per design.md §2.3 + environment.md §4:
 * key directional (only shadow caster, 2048), hemisphere fill, 6 teal
 * practicals, oculus spot, 4 breathing god-ray cones, drifting dust field,
 * and a low-res procedural PMREM environment (drei Lightformers, no fetch)
 * so gold/obsidian reflect.
 *
 * Fix-round additions: a weak warm camera-side fill (follows the camera so
 * shadow sides never read as pitch-black paper) and a static cool indigo
 * rim from the far +Z end to separate silhouettes against the void.
 *
 * Phase-driven lights (chamber/pad gold points) live in EnvironmentFX.
 * The player-follow rim light (design §2.3 #12) is owned by the player rig.
 */
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { Environment, Lightformer } from '@react-three/drei'
import { LIGHTING, MATERIALS, COLORS } from '../config'

// teal practical positions: 2 canyon, 2 chamber, 2 arena (env.md §4 #3–8)
const TEAL_POINTS: [number, number, number][] = [
  [4, 3, 60],
  [-4, 3, 105],
  [-9, 3.5, 142],
  [9, 3.5, 158],
  [-18, 4, 180],
  [18, 4, 210],
]

// god-ray cones: [position, topR, bottomR, height, tiltZ, baseOpacity]
const GOD_RAYS: {
  p: [number, number, number]
  r: [number, number, number]
  top: number
  bottom: number
  h: number
  opacity: number
}[] = [
  { p: [0, 9, 7.5], r: [0, 0, 0], top: 1.6, bottom: 5, h: 18, opacity: 0.09 }, // spawn oculus
  { p: [0, 8.5, 150], r: [0, 0, 0], top: 6, bottom: 14, h: 17, opacity: 0.07 }, // chamber oculus (biggest)
  { p: [3.4, 5.5, 60], r: [0, 0, -0.55], top: 1.6, bottom: 4.4, h: 12, opacity: 0.06 }, // canyon glass
  { p: [3.4, 5.5, 100], r: [0, 0, -0.55], top: 1.6, bottom: 4.4, h: 12, opacity: 0.06 }, // canyon glass
]

function GodRays() {
  const mats = useMemo(
    () =>
      GOD_RAYS.map(
        (g) =>
          new THREE.MeshBasicMaterial({
            color: LIGHTING.key.color,
            transparent: true,
            opacity: g.opacity,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide,
          }),
      ),
    [],
  )
  const geoms = useMemo(
    () => GOD_RAYS.map((g) => new THREE.CylinderGeometry(g.top, g.bottom, g.h, 16, 1, true)),
    [],
  )
  useFrame((state) => {
    // slow opacity breathing, ±20%, 6 s period
    const t = state.clock.elapsedTime
    for (let i = 0; i < mats.length; i++) {
      mats[i].opacity = GOD_RAYS[i].opacity * (1 + 0.2 * Math.sin((t * Math.PI * 2) / 6 + i * 1.7))
    }
  })
  return (
    <group>
      {GOD_RAYS.map((g, i) => (
        <mesh key={i} geometry={geoms[i]} material={mats[i]} position={g.p} rotation={g.r} />
      ))}
    </group>
  )
}

// ---------------------------------------------------------------------------
// Dust motes — 600 additive points following the camera in a 40 m wrap box
// ---------------------------------------------------------------------------
const DUST_COUNT = LIGHTING.dustCount
const DUST_BOX = 40

function DustField() {
  const group = useRef<THREE.Group>(null!)
  const geom = useMemo(() => {
    const g = new THREE.BufferGeometry()
    const pos = new Float32Array(DUST_COUNT * 3)
    for (let i = 0; i < DUST_COUNT * 3; i++) pos[i] = (Math.random() - 0.5) * DUST_BOX
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    return g
  }, [])

  useFrame((state, dt) => {
    group.current.position.copy(state.camera.position)
    const pos = geom.attributes.position as THREE.BufferAttribute
    const arr = pos.array as Float32Array
    const half = DUST_BOX / 2
    for (let i = 0; i < DUST_COUNT; i++) {
      arr[i * 3 + 1] += dt * 0.25 // slow upward drift
      if (arr[i * 3 + 1] > half) arr[i * 3 + 1] -= DUST_BOX
    }
    pos.needsUpdate = true
  })

  return (
    <group ref={group}>
      <points geometry={geom} frustumCulled={false}>
        <pointsMaterial
          color={LIGHTING.key.color}
          size={0.035}
          sizeAttenuation
          transparent
          opacity={0.2}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </points>
    </group>
  )
}

// ---------------------------------------------------------------------------
// Camera-side fill — weak warm directional that rides behind/above the camera
// so faces pointing at the player never crush to black. No shadows.
// ---------------------------------------------------------------------------
const _fillFwd = new THREE.Vector3()
const _fillPos = new THREE.Vector3()
const _fillTgt = new THREE.Vector3()

function CameraFill() {
  const light = useRef<THREE.DirectionalLight>(null!)
  useFrame(({ camera }) => {
    const l = light.current
    if (!l) return
    camera.getWorldDirection(_fillFwd)
    _fillPos.copy(camera.position).addScaledVector(_fillFwd, -18)
    _fillPos.y += 10
    l.position.copy(_fillPos)
    _fillTgt.copy(camera.position).addScaledVector(_fillFwd, 24)
    l.target.position.copy(_fillTgt)
    l.target.updateMatrixWorld()
  })
  return (
    <directionalLight
      ref={light}
      color={LIGHTING.cameraFill.color}
      intensity={LIGHTING.cameraFill.intensity}
      onUpdate={(l: THREE.DirectionalLight) => {
        if (!l.target.parent) l.parent?.add(l.target)
      }}
    />
  )
}

export default function Lighting() {
  const keyRef = useRef<THREE.DirectionalLight>(null!)
  const spotRef = useRef<THREE.SpotLight>(null!)

  return (
    <group>
      {/* low-res procedural PMREM env — gold/obsidian reflections (design §2.4) */}
      <Environment resolution={MATERIALS.envMapResolution} frames={1} background={false}>
        <color attach="background" args={[COLORS.cosmicIndigo]} />
        <Lightformer intensity={2.2} color={LIGHTING.key.color} position={[0, 8, 0]} rotation-x={-Math.PI / 2} scale={[14, 14, 1]} />
        <Lightformer intensity={1.0} color={LIGHTING.hemisphere.skyColor} position={[0, -6, 0]} rotation-x={Math.PI / 2} scale={[20, 20, 1]} />
        <Lightformer intensity={0.9} color={COLORS.cadenceTeal} position={[9, 2, 0]} rotation-y={-Math.PI / 2} scale={[7, 3, 1]} />
        <Lightformer intensity={0.9} color={COLORS.regalGold} position={[-9, 2, 0]} rotation-y={Math.PI / 2} scale={[7, 3, 1]} />
      </Environment>

      {/* 1 — key directional "sun through the oculus" (only shadow caster) */}
      <directionalLight
        ref={keyRef}
        position={[-40, 60, -20]}
        color={LIGHTING.key.color}
        intensity={LIGHTING.key.intensity}
        castShadow
        shadow-mapSize-width={LIGHTING.key.shadowMapSize}
        shadow-mapSize-height={LIGHTING.key.shadowMapSize}
        shadow-camera-near={1}
        shadow-camera-far={420}
        shadow-camera-left={-55}
        shadow-camera-right={55}
        shadow-camera-top={55}
        shadow-camera-bottom={-55}
        shadow-bias={-0.0004}
        onUpdate={(l: THREE.DirectionalLight) => {
          // aim at arena center; target must live in the scene graph
          l.target.position.set(0, 0, 195)
          l.target.updateMatrixWorld()
          if (!l.target.parent) l.parent?.add(l.target)
        }}
      />

      {/* 2 — cool indigo hemisphere fill */}
      <hemisphereLight
        args={[LIGHTING.hemisphere.skyColor, LIGHTING.hemisphere.groundColor, LIGHTING.hemisphere.intensity]}
      />

      {/* camera-side warm fill + cool rim from the far +Z end (no shadows) */}
      <CameraFill />
      <directionalLight
        position={[24, 46, 300]}
        color={LIGHTING.coolRim.color}
        intensity={LIGHTING.coolRim.intensity}
        onUpdate={(l: THREE.DirectionalLight) => {
          l.target.position.set(0, 2, 120)
          l.target.updateMatrixWorld()
          if (!l.target.parent) l.parent?.add(l.target)
        }}
      />

      {/* 3–8 — teal practicals at vein clusters */}
      {TEAL_POINTS.map((p, i) => (
        <pointLight
          key={i}
          position={p}
          color={LIGHTING.tealPractical.color}
          intensity={LIGHTING.tealPractical.intensity}
          distance={LIGHTING.tealPractical.distance}
          decay={LIGHTING.tealPractical.decay}
        />
      ))}

      {/* 11 — oculus spot (punch for the chamber god-ray) */}
      <spotLight
        ref={spotRef}
        position={[0, 24, 150]}
        color="#FFE9C4"
        intensity={6}
        angle={0.3}
        penumbra={0.5}
        distance={60}
        decay={1.5}
        onUpdate={(l: THREE.SpotLight) => {
          l.target.position.set(0, 0, 150)
          l.target.updateMatrixWorld()
          if (!l.target.parent) l.parent?.add(l.target)
        }}
      />

      <GodRays />
      <DustField />
    </group>
  )
}

/**
 * AURIC VOW — world/Lighting.tsx
 * Light rig per design.md §2.3 + environment.md §4.
 *
 * R1 rebuild (art review):
 * - the single 110×110 ortho key is replaced by a TWO-CASCADE rig: a sharp
 *   ±32 m ortho recentred on the camera (texel-snapped so shadows don't crawl)
 *   carries contact and mid shadows, and a static wide ±130 m cascade catches
 *   distant blockers. Both share one direction, so shading never changes as
 *   the player moves; the key's energy is split between them.
 * - ambient is cut hard (hemisphere 0.7→0.32, camera fill 0.55→0.25, cool rim
 *   halved) so the 2.2 key does the modelling and recesses keep true darks.
 * - practicals are no longer six hardcoded coordinates: positions come from
 *   ShrineStation.TEAL_FIXTURES (the actual emissive strips, offset along the
 *   surface normal) and only the nearest 4 are lit, with intensity locked to
 *   the same pulse curve EnvironmentFX drives the strips with.
 * - the PMREM environment gains the pieces gold needs to read as metal: a
 *   narrow intensity-6 white strip above/behind, a near-black ground, a warm
 *   horizon band, and two wide sky panels matching FOG.skyHorizon/skyZenith so
 *   upward faces pick up the backdrop.
 *
 * Phase-driven lights (chamber/pad gold points) live in EnvironmentFX.
 * The player-follow rim light (design §2.3 #12) is owned by the player rig.
 */
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { Environment, Lightformer } from '@react-three/drei'
import { LIGHTING, MATERIALS, COLORS, FOG } from '../config'
import { TEAL_FIXTURES } from './ShrineStation'

/** constant key direction (light → target); everything else follows it */
const KEY_OFFSET = new THREE.Vector3(-40, 60, -20).normalize().multiplyScalar(120)
/** unit vector pointing from the scene TOWARD the key (used by the skybox) */
export const KEY_DIR = KEY_OFFSET.clone().normalize()

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
          opacity={0.16}
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

// ---------------------------------------------------------------------------
// Near shadow cascade — a tight ortho that follows the camera, texel-snapped
// ---------------------------------------------------------------------------
const _focus = new THREE.Vector3()
const _camFwd = new THREE.Vector3()

function KeyCascade() {
  const light = useRef<THREE.DirectionalLight>(null!)
  const near = LIGHTING.shadowNear

  useFrame(({ camera }) => {
    const l = light.current
    if (!l) return
    camera.getWorldDirection(_camFwd)
    // bias the shadow box slightly ahead of the camera — that is where the
    // player and the geometry they are about to run into live
    _focus.copy(camera.position).addScaledVector(_camFwd, near.extent * 0.35)
    _focus.y = Math.max(_focus.y, 0)
    // snap to the shadow-map texel grid so edges stop crawling as we move
    const texel = (near.extent * 2) / near.mapSize
    _focus.x = Math.round(_focus.x / texel) * texel
    _focus.y = Math.round(_focus.y / texel) * texel
    _focus.z = Math.round(_focus.z / texel) * texel
    l.position.copy(_focus).add(KEY_OFFSET)
    l.target.position.copy(_focus)
    l.target.updateMatrixWorld()
  })

  return (
    <directionalLight
      ref={light}
      color={LIGHTING.key.color}
      intensity={LIGHTING.key.intensity * LIGHTING.cascadeSplit}
      castShadow
      shadow-mapSize-width={near.mapSize}
      shadow-mapSize-height={near.mapSize}
      shadow-camera-near={1}
      shadow-camera-far={300}
      shadow-camera-left={-near.extent}
      shadow-camera-right={near.extent}
      shadow-camera-top={near.extent}
      shadow-camera-bottom={-near.extent}
      shadow-bias={near.bias}
      shadow-normalBias={near.normalBias}
      onUpdate={(l: THREE.DirectionalLight) => {
        if (!l.target.parent) l.parent?.add(l.target)
      }}
    />
  )
}

// ---------------------------------------------------------------------------
// Teal practicals — nearest 4 modelled vein fixtures, pulse-locked to the
// strips they belong to (EnvironmentFX drives the same 2.4 rad/s curve).
// ---------------------------------------------------------------------------
const PRACTICAL_COUNT = 4

function TealPracticals() {
  const lights = useRef<(THREE.PointLight | null)[]>([])
  // preallocated selection buffers — nothing allocates in the frame loop
  const bestIdx = useMemo(() => new Int32Array(PRACTICAL_COUNT), [])
  const bestDist = useMemo(() => new Float32Array(PRACTICAL_COUNT), [])

  useFrame((state, dt) => {
    const cam = state.camera.position
    for (let i = 0; i < PRACTICAL_COUNT; i++) {
      bestIdx[i] = -1
      bestDist[i] = Infinity
    }
    for (let f = 0; f < TEAL_FIXTURES.length; f++) {
      const p = TEAL_FIXTURES[f]
      const dx = p[0] - cam.x
      const dy = p[1] - cam.y
      const dz = p[2] - cam.z
      const d2 = dx * dx + dy * dy + dz * dz
      if (d2 > 900) continue // 30 m cull
      for (let i = 0; i < PRACTICAL_COUNT; i++) {
        if (d2 < bestDist[i]) {
          for (let j = PRACTICAL_COUNT - 1; j > i; j--) {
            bestDist[j] = bestDist[j - 1]
            bestIdx[j] = bestIdx[j - 1]
          }
          bestDist[i] = d2
          bestIdx[i] = f
          break
        }
      }
    }
    // exactly the curve EnvironmentFX drives the strips with, so fixture and
    // light breathe together instead of drifting apart
    const pulse = 0.82 + 0.18 * Math.sin(state.clock.elapsedTime * 2.4)
    const k = 1 - Math.exp(-8 * dt)
    for (let i = 0; i < PRACTICAL_COUNT; i++) {
      const l = lights.current[i]
      if (!l) continue
      const f = bestIdx[i]
      if (f < 0) {
        l.intensity = THREE.MathUtils.lerp(l.intensity, 0, k)
        continue
      }
      const p = TEAL_FIXTURES[f]
      l.position.set(p[0], p[1], p[2])
      l.intensity = LIGHTING.tealPractical.intensity * pulse
    }
  })

  return (
    <group>
      {Array.from({ length: PRACTICAL_COUNT }).map((_, i) => (
        <pointLight
          key={i}
          ref={(r) => {
            lights.current[i] = r
          }}
          color={LIGHTING.tealPractical.color}
          intensity={0}
          distance={LIGHTING.tealPractical.distance}
          decay={LIGHTING.tealPractical.decay}
        />
      ))}
    </group>
  )
}

export default function Lighting() {
  const far = LIGHTING.shadowFar

  return (
    <group>
      {/* procedural PMREM env (design §2.4) — this is what makes gold metal:
          one narrow hot strip for the specular ramp, a near-black floor so the
          lower half of every bevel stays dark, a warm horizon band, and two
          wide sky panels so upward faces pick up the backdrop. */}
      <Environment resolution={MATERIALS.envMapResolution} frames={1} background={false}>
        <color attach="background" args={['#04060C']} />
        {/* narrow intensity-6 white strip, above and slightly behind */}
        <Lightformer
          form="rect"
          intensity={6}
          color="#FFFFFF"
          position={[0, 9, -5]}
          rotation-x={-Math.PI / 2}
          scale={[1.1, 14, 1]}
        />
        <Lightformer
          form="rect"
          intensity={3.2}
          color={LIGHTING.key.color}
          position={[-6, 6, -9]}
          rotation-y={0.6}
          scale={[0.8, 9, 1]}
        />
        {/* near-black ground — nothing bounces up off a void station */}
        <Lightformer
          form="rect"
          intensity={0.12}
          color="#07080E"
          position={[0, -8, 0]}
          rotation-x={Math.PI / 2}
          scale={[26, 26, 1]}
        />
        {/* warm horizon band so gold picks up a low amber roll-off */}
        <Lightformer
          form="rect"
          intensity={0.85}
          color="#FFB77A"
          position={[0, 0.4, -12]}
          scale={[24, 1.4, 1]}
        />
        {/* sky contribution: horizon on −Z, zenith overhead (work order #10) */}
        <Lightformer
          form="rect"
          intensity={0.5}
          color={FOG.skyHorizon}
          position={[0, 3, -16]}
          scale={[30, 8, 1]}
        />
        <Lightformer
          form="rect"
          intensity={0.35}
          color={FOG.skyZenith}
          position={[0, 14, 0]}
          rotation-x={-Math.PI / 2}
          scale={[26, 26, 1]}
        />
        {/* level-colour bounce: teal corruption east, gold shrine west */}
        <Lightformer intensity={0.55} color={COLORS.cadenceTeal} position={[11, 2, 0]} rotation-y={-Math.PI / 2} scale={[7, 3, 1]} />
        <Lightformer intensity={0.6} color={COLORS.regalGold} position={[-11, 2, 0]} rotation-y={Math.PI / 2} scale={[7, 3, 1]} />
      </Environment>

      {/* 1a — near shadow cascade (follows the camera, texel-snapped) */}
      <KeyCascade />

      {/* 1b — far cascade: same direction, whole-level ortho for distant
          blockers (domes, megaliths, monoliths) */}
      <directionalLight
        position={[KEY_OFFSET.x, KEY_OFFSET.y + 20, KEY_OFFSET.z + 130]}
        color={LIGHTING.key.color}
        intensity={LIGHTING.key.intensity * (1 - LIGHTING.cascadeSplit)}
        castShadow
        shadow-mapSize-width={far.mapSize}
        shadow-mapSize-height={far.mapSize}
        shadow-camera-near={1}
        shadow-camera-far={520}
        shadow-camera-left={-far.extent}
        shadow-camera-right={far.extent}
        shadow-camera-top={far.extent}
        shadow-camera-bottom={-far.extent}
        shadow-bias={far.bias}
        shadow-normalBias={far.normalBias}
        onUpdate={(l: THREE.DirectionalLight) => {
          l.target.position.set(0, 0, 130)
          l.target.updateMatrixWorld()
          if (!l.target.parent) l.parent?.add(l.target)
        }}
      />

      {/* 2 — cool indigo hemisphere fill (cut to 0.32: fill no longer models) */}
      <hemisphereLight
        args={[LIGHTING.hemisphere.skyColor, LIGHTING.hemisphere.groundColor, LIGHTING.hemisphere.intensity]}
      />

      {/* camera-side warm fill + halved cool rim, re-aimed across the axis so
          it separates silhouettes instead of back-lighting the whole level */}
      <CameraFill />
      <directionalLight
        position={[70, 34, 210]}
        color={LIGHTING.coolRim.color}
        intensity={LIGHTING.coolRim.intensity}
        onUpdate={(l: THREE.DirectionalLight) => {
          l.target.position.set(-10, 2, 140)
          l.target.updateMatrixWorld()
          if (!l.target.parent) l.parent?.add(l.target)
        }}
      />

      {/* 3–8 — teal practicals, nearest 4 modelled vein fixtures */}
      <TealPracticals />

      {/* 11 — oculus spot (punch for the chamber god-ray) */}
      <spotLight
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

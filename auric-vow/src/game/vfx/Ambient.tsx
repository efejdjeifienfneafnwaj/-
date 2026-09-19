/**
 * AURIC VOW — Ambient.tsx
 * Level-ambience hooks tied to mission state (vfx-hud.md §1.2):
 *  - Extraction beacon (phase EXTRACT): 40 m gold pillar of light with a
 *    vertical alpha-gradient shader, 3 rotating glyph rings at the base,
 *    a continuous ember emitter and a 1 Hz pulsing gold point light.
 *  - Objective channel glow (phase OBJECTIVE): additive gold glow at the
 *    objective position whose scale/intensity track store.channelProgress.
 *
 * Beacon position: store.objectivePosition; if null during EXTRACT, the last
 * known objective position is kept (per task contract).
 */
import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { COLORS } from '../config'
import { useGameStore } from '../store'
import { getGlyphSpriteTexture } from '../textures'
import { VFX } from './VFXBus'

const BEACON_HEIGHT = 40
const BEACON_RADIUS = 2.0 // fix1: 1.5 → 2.0 wider beam
const BEACON_CORE_RADIUS = 0.55 // bright inner core (fix1)
const RING_RADII = [2, 3, 4]
const RING_SPEEDS = [0.3, -0.2, 0.5] // rev/s

const PILLAR_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vNormalW;
varying vec3 vViewW;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vViewW = cameraPosition - wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`
const PILLAR_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uPulse;
uniform float uStrength;
varying vec2 vUv;
varying vec3 vNormalW;
varying vec3 vViewW;
void main() {
  float h = 1.0 - vUv.y;             // bright at base, fading with height
  float a = pow(h, 1.6) * uStrength * uPulse;
  // subtle vertical striations
  a *= 0.85 + 0.15 * sin(vUv.x * 40.0 + vUv.y * 6.0);
  // soft radial gradient: fade toward silhouette edges so the beam reads
  // volumetric instead of a hard thin sheet (fix1)
  float ndv = abs(dot(normalize(vNormalW), normalize(vViewW)));
  a *= pow(ndv, 0.75);
  if (a < 0.004) discard;
  gl_FragColor = vec4(uColor, a);
}
`

/** World-space ambience driven by mission phase. */
export default function Ambient() {
  const phase = useGameStore((s) => s.phase)
  const objectivePosition = useGameStore((s) => s.objectivePosition)

  const groupRef = useRef<THREE.Group>(null)
  const glowRef = useRef<THREE.Mesh>(null)
  const glowMatRef = useRef<THREE.MeshBasicMaterial>(null)
  const beaconLightRef = useRef<THREE.PointLight>(null)
  const channelLightRef = useRef<THREE.PointLight>(null)
  const ringRefs = useRef<(THREE.Group | null)[]>([])
  const pillarMatRef = useRef<THREE.ShaderMaterial>(null)

  /** last known objective position — survives objectivePosition → null */
  const lastKnown = useRef(new THREE.Vector3(0, 0, 0))
  const hasKnown = useRef(false)
  if (objectivePosition) {
    lastKnown.current.copy(objectivePosition)
    hasKnown.current = true
  }

  const emberClock = useRef(0)

  const glyphTex = useMemo(() => getGlyphSpriteTexture(), [])
  const pillarGeo = useMemo(
    () => new THREE.CylinderGeometry(BEACON_RADIUS, BEACON_RADIUS, BEACON_HEIGHT, 32, 1, true),
    [],
  )
  const coreGeo = useMemo(
    () =>
      new THREE.CylinderGeometry(BEACON_CORE_RADIUS, BEACON_CORE_RADIUS, BEACON_HEIGHT, 24, 1, true),
    [],
  )
  const ringGeo = useMemo(() => new THREE.RingGeometry(0.9, 1, 64), [])
  const glowGeo = useMemo(() => new THREE.PlaneGeometry(1, 1), [])

  const beaconVisible = phase === 'EXTRACT' && hasKnown.current
  const glowVisible = phase === 'OBJECTIVE' && hasKnown.current

  useFrame(({ camera }, delta) => {
    const s = useGameStore.getState()
    const dt = Math.min(delta, 0.1) * s.timeScale
    const t = s.gameTime

    const g = groupRef.current
    if (!g) return
    g.position.copy(lastKnown.current)

    // -- extraction beacon ---------------------------------------------------
    if (beaconVisible) {
      if (pillarMatRef.current) {
        pillarMatRef.current.uniforms.uPulse!.value = 0.9 + 0.1 * Math.sin(t * Math.PI * 2)
      }
      for (let i = 0; i < RING_RADII.length; i++) {
        const r = ringRefs.current[i]
        if (r) r.rotation.y += RING_SPEEDS[i]! * Math.PI * 2 * dt
      }
      if (beaconLightRef.current) {
        beaconLightRef.current.intensity = 12 + 2 * Math.sin(t * Math.PI * 2) // 1 Hz, i10→14
      }
      // continuous ember emitter: 4/s rising 3 m over 2 s
      emberClock.current += dt
      if (emberClock.current >= 0.25) {
        emberClock.current -= 0.25
        VFX.burst({
          position: lastKnown.current,
          color: COLORS.aureate,
          count: 1,
          speed: 0.4,
          life: 2,
          size: 0.04,
          gravity: -1.5, // negative gravity = rise
        })
      }
    }

    // -- objective channel glow ----------------------------------------------
    if (glowVisible) {
      const p = s.channelProgress
      const glow = glowRef.current
      if (glow) {
        glow.quaternion.copy(camera.quaternion)
        const sc = 0.6 + p * 2.2
        glow.scale.set(sc, sc, sc)
        glow.position.set(0, 1.2, 0)
      }
      if (glowMatRef.current) glowMatRef.current.opacity = 0.25 + p * 0.65
      if (channelLightRef.current) channelLightRef.current.intensity = 2 + p * 10
    }
  })

  return (
    <group ref={groupRef} name="vfx-ambient">
      {/* extraction beacon */}
      <group visible={beaconVisible}>
        <mesh geometry={pillarGeo} position={[0, BEACON_HEIGHT / 2, 0]} renderOrder={18}>
          <shaderMaterial
            ref={pillarMatRef}
            vertexShader={PILLAR_VERT}
            fragmentShader={PILLAR_FRAG}
            uniforms={{
              uColor: { value: new THREE.Color(COLORS.aureate) },
              uPulse: { value: 1 },
              uStrength: { value: 0.7 },
            }}
            transparent
            depthWrite={false}
            side={THREE.DoubleSide}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
        {/* bright inner core so the beacon never reads as "thin beam" (fix1) */}
        <mesh geometry={coreGeo} position={[0, BEACON_HEIGHT / 2, 0]} renderOrder={18}>
          <shaderMaterial
            vertexShader={PILLAR_VERT}
            fragmentShader={PILLAR_FRAG}
            uniforms={{
              uColor: { value: new THREE.Color(COLORS.solarWhite) },
              uPulse: { value: 1 },
              uStrength: { value: 1.1 },
            }}
            transparent
            depthWrite={false}
            side={THREE.DoubleSide}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
        {RING_RADII.map((r, i) => (
          <group
            key={i}
            ref={(el) => {
              ringRefs.current[i] = el
            }}
            position={[0, 0.08 + i * 0.02, 0]}
          >
            <mesh geometry={ringGeo} rotation-x={-Math.PI / 2} scale={[r, r, r]} renderOrder={18}>
              <meshBasicMaterial
                map={glyphTex}
                color={COLORS.aureate}
                transparent
                opacity={0.8}
                depthWrite={false}
                side={THREE.DoubleSide}
                blending={THREE.AdditiveBlending}
                toneMapped={false}
              />
            </mesh>
          </group>
        ))}
        <pointLight
          ref={beaconLightRef}
          position={[0, 2, 0]}
          color={COLORS.aureate}
          intensity={12}
          distance={22}
          decay={2}
        />
      </group>

      {/* objective channel glow */}
      <group visible={glowVisible}>
        <mesh ref={glowRef} geometry={glowGeo} renderOrder={18}>
          <meshBasicMaterial
            ref={glowMatRef}
            map={glyphTex}
            color={COLORS.aureate}
            transparent
            opacity={0.25}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            toneMapped={false}
            side={THREE.DoubleSide}
          />
        </mesh>
        <pointLight
          ref={channelLightRef}
          position={[0, 1.4, 0]}
          color={COLORS.aureate}
          intensity={2}
          distance={14}
          decay={2}
        />
      </group>
    </group>
  )
}

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
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { COLORS, LIGHTING, POSTFX } from '../config'
import { useGameStore, selectQualityTier } from '../store'
import { getGlyphSpriteTexture } from '../textures'
import { VFX } from './VFXBus'
import { getShellGlyphTexture, getStreakTexture, getSoftGlowTexture } from './vfxTextures'

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

/**
 * [vfx R1] Beacon glyph rings (V6). `RingGeometry` UVs map to the bounding
 * SQUARE, so a 0.9–1.0 annulus sampled the erased outer margin of the glyph
 * sheet and the rings came out nearly blank. These sample a seamless fret
 * band in POLAR space instead: u wraps around the ring, v runs across its
 * width, so the runes are crisp, complete and counter-rotate legibly.
 */
const RING_VERT = /* glsl */ `
varying vec2 vLocal;
void main() {
  vLocal = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const RING_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uCore;
uniform float uOpacity;
uniform float uRepeat;
uniform float uSpin;
uniform float uInner;
uniform sampler2D uBand;
varying vec2 vLocal;
void main() {
  float r = length(vLocal);
  float a = atan(vLocal.y, vLocal.x);
  float v = clamp((r - uInner) / max(1e-4, 1.0 - uInner), 0.0, 1.0);
  float u = a / 6.2831853 * uRepeat + uSpin;
  float g = texture2D(uBand, vec2(u, v)).r;
  // feather both edges of the band so the annulus has no hard rim
  float edge = smoothstep(0.0, 0.22, v) * smoothstep(1.0, 0.78, v);
  float al = (0.16 + g * 0.95) * edge * uOpacity;
  if (al < 0.004) discard;
  vec3 col = mix(uColor, uCore, g * 0.55);
  gl_FragColor = vec4(col * (0.9 + g * 1.4), al);
}
`


// ---------------------------------------------------------------------------
// [vfx R1] Screen-space sun flare
//
// The key light had no presence in frame at all — the sun existed only as a
// shading direction. This projects the key's world direction to screen space
// and lays an anamorphic streak on it plus three ghosts marching back through
// the optical centre, which is what tells the eye there is a real source up
// there. Gated off at qualityTier 2 alongside Bloom/SMAA.
//
// The flare lives on a camera-locked plane 1.2 m ahead of the near plane, so
// everything is a two-triangle draw with no depth interaction.
// ---------------------------------------------------------------------------

const FLARE_DIST = 1.2
const GHOST_OFFSETS = [-0.35, -0.72, -1.15]
const GHOST_SCALES = [0.16, 0.26, 0.11]
const GHOST_TINTS = ['#FFD79A', '#9FD2FF', '#FFB835']

const _sunDir = new THREE.Vector3()
const _fwd = new THREE.Vector3()
const _proj = new THREE.Vector3()

/** fallback sun direction from the config key angle, if no light is found */
function configSunDir(out: THREE.Vector3): THREE.Vector3 {
  const a = (LIGHTING.key.angleFromBehindLeftDeg * Math.PI) / 180
  return out.set(-Math.sin(a), 0.72, -Math.cos(a)).normalize()
}

function SunFlare() {
  const qualityTier = useGameStore(selectQualityTier)
  const scene = useThree((s) => s.scene)
  const groupRef = useRef<THREE.Group>(null)
  const streakRef = useRef<THREE.Mesh>(null)
  const coreRef = useRef<THREE.Mesh>(null)
  const ghostRefs = useRef<(THREE.Mesh | null)[]>([])
  const sunRef = useRef<THREE.DirectionalLight | null>(null)
  const rescan = useRef(0)

  const mats = useMemo(() => {
    const streak = new THREE.MeshBasicMaterial({
      map: getStreakTexture(),
      color: new THREE.Color('#FFE4BC'),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    })
    const core = new THREE.MeshBasicMaterial({
      map: getSoftGlowTexture(),
      color: new THREE.Color('#FFF3D6').multiplyScalar(1.8),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    })
    const ghosts = GHOST_TINTS.map(
      (c) =>
        new THREE.MeshBasicMaterial({
          map: getSoftGlowTexture(),
          color: new THREE.Color(c),
          transparent: true,
          opacity: 0,
          depthWrite: false,
          depthTest: false,
          blending: THREE.AdditiveBlending,
          toneMapped: false,
        }),
    )
    return { streak, core, ghosts }
  }, [])

  const planeGeo = useMemo(() => new THREE.PlaneGeometry(1, 1), [])

  useFrame(({ camera }, delta) => {
    const g = groupRef.current
    if (!g) return

    // find the key light once, then re-check occasionally (environment-art
    // may rebuild the rig; never traverse every frame)
    rescan.current -= delta
    if (!sunRef.current || rescan.current <= 0) {
      rescan.current = 2
      let found: THREE.DirectionalLight | null = null
      scene.traverse((o) => {
        const l = o as THREE.DirectionalLight
        if (!found && l.isDirectionalLight && l.intensity > 0.8) found = l
      })
      sunRef.current = found
    }

    const sun = sunRef.current
    if (sun) _sunDir.copy(sun.position).sub(sun.target.position).normalize()
    else configSunDir(_sunDir)

    camera.getWorldDirection(_fwd)
    const facing = _fwd.dot(_sunDir)
    if (facing <= 0.02) {
      g.visible = false
      return
    }

    // project a point far along the sun direction into NDC
    _proj.copy(camera.position).addScaledVector(_sunDir, 800)
    _proj.project(camera)
    if (_proj.z > 1) {
      g.visible = false
      return
    }

    const persp = camera as THREE.PerspectiveCamera
    const halfH = FLARE_DIST * Math.tan(THREE.MathUtils.degToRad(persp.fov ?? 70) / 2)
    const halfW = halfH * (persp.aspect ?? 1.777)
    const sx = _proj.x * halfW
    const sy = _proj.y * halfH

    g.visible = true
    g.position.copy(camera.position).addScaledVector(_fwd, FLARE_DIST)
    g.quaternion.copy(camera.quaternion)

    // fade in as the sun comes into frame, fade out toward the edges
    const edge = Math.max(Math.abs(_proj.x), Math.abs(_proj.y))
    const vis =
      POSTFX.lensFlare.opacity *
      THREE.MathUtils.smoothstep(facing, 0.05, 0.55) *
      (1 - THREE.MathUtils.smoothstep(edge, 0.9, 1.8))
    if (vis <= 0.002) {
      g.visible = false
      return
    }

    const streak = streakRef.current
    if (streak) {
      streak.position.set(sx, sy, 0)
      streak.scale.set(halfW * 2.4 * POSTFX.lensFlare.streakWidth, halfH * 0.11, 1)
      mats.streak.opacity = vis
    }
    const core = coreRef.current
    if (core) {
      core.position.set(sx, sy, 0)
      const cs = halfH * 0.22
      core.scale.set(cs, cs, 1)
      mats.core.opacity = vis * 0.85
    }
    for (let i = 0; i < GHOST_OFFSETS.length; i++) {
      const m = ghostRefs.current[i]
      if (!m) continue
      const k = GHOST_OFFSETS[i]!
      m.position.set(sx * k, sy * k, 0)
      const gs = halfH * GHOST_SCALES[i]!
      m.scale.set(gs, gs, 1)
      mats.ghosts[i]!.opacity = vis * 0.42
    }
  })

  if (qualityTier >= 2) return null

  return (
    <group ref={groupRef} name="vfx-sun-flare" visible={false} frustumCulled={false}>
      {mats.ghosts.map((m, i) => (
        <mesh
          key={`ghost-${i}`}
          ref={(el) => {
            ghostRefs.current[i] = el
          }}
          geometry={planeGeo}
          material={m}
          renderOrder={34}
          frustumCulled={false}
        />
      ))}
      <mesh
        ref={coreRef}
        geometry={planeGeo}
        material={mats.core}
        renderOrder={35}
        frustumCulled={false}
      />
      <mesh
        ref={streakRef}
        geometry={planeGeo}
        material={mats.streak}
        renderOrder={36}
        frustumCulled={false}
      />
    </group>
  )
}

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
  const ringGeo = useMemo(() => new THREE.RingGeometry(0.9, 1, 96), [])
  /** one polar-mapped glyph-band material per ring (V6) */
  const ringMats = useMemo(
    () =>
      RING_RADII.map(
        (_, i) =>
          new THREE.ShaderMaterial({
            vertexShader: RING_VERT,
            fragmentShader: RING_FRAG,
            uniforms: {
              uColor: { value: new THREE.Color(COLORS.aureate) },
              uCore: { value: new THREE.Color(COLORS.solarWhite) },
              uOpacity: { value: 0.85 },
              uRepeat: { value: 6 + i * 2 },
              uSpin: { value: 0 },
              uInner: { value: 0.9 },
              uBand: { value: getShellGlyphTexture() },
            },
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
            toneMapped: false,
          }),
      ),
    [],
  )
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
        // the glyph band also scrolls against the ring's own spin, so the
        // runes counter-rotate instead of riding along as one rigid decal
        const m = ringMats[i]
        if (m) m.uniforms.uSpin!.value -= RING_SPEEDS[i]! * dt * 0.45
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
    <>
      <SunFlare />
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
              <mesh
                geometry={ringGeo}
                rotation-x={-Math.PI / 2}
                scale={[r, r, r]}
                renderOrder={18}
                material={ringMats[i]}
              />
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
    </>
  )
}

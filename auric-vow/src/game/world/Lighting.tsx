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
 *
 * R2 (art review round 2), in order of how much each one changed the frame:
 * - KEY_OFFSET reweighted so the −Z component (the axis the camera looks
 *   down) carries 0.58 of the key instead of 0.27, at a lower 41° elevation.
 * - key 2.2 → 4.4 and every fill term cut to roughly a third, so a shadow is
 *   a ~3.5-stop event rather than a quarter-stop one (see config LIGHTING).
 * - the PMREM probe is re-weighted by SOLID ANGLE: the narrow specular bar
 *   goes 6 → 12 while every broad panel drops 3–4×, which buys gold its
 *   reflection without the probe acting as ambient fill.
 * - ContactBlobs: an unconditional projected contact shadow under the player
 *   and every enemy, so grounding survives the tier where casting is off.
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
import { LIGHTING, MATERIALS, COLORS, SKY } from '../config'
import { TEAL_FIXTURES } from './ShrineStation'
import { PlayerRef } from '../player/PlayerRef'
import { EnemyRegistry } from '../enemies/EnemyRegistry'
import { raycastLevel } from './Colliders'
import { getContactBlobTexture } from '../textures'

/**
 * Constant key direction (light → target); everything else follows it.
 *
 * R2 — this moved, and it is one of the most consequential numbers in the rig.
 * The old vector (-40, 60, -20) had the right hemisphere but almost no weight
 * along the axis the player actually looks down: the −Z term was 0.27 of a
 * unit vector, so the faces the camera sees took barely a quarter of the key
 * and the frame read flat no matter how bright the key got.
 *
 * Sign discipline, because it is easy to get backwards and a capture proved
 * it: KEY_OFFSET is the light's POSITION relative to its target, so light
 * TRAVELS along −KEY_OFFSET. A surface is lit when its normal points back
 * along +KEY_OFFSET. The camera looks down +Z and therefore sees −Z-facing
 * surfaces, so the key must sit at NEGATIVE z for the visible faces to be the
 * lit ones. (Moving it to +z was tried and flattened every frame into
 * backlight — worth stating here so nobody repeats it.)
 *
 * What actually changed in R2 is the WEIGHTING, not the hemisphere: the −Z
 * component goes from 0.27 to 0.58 of the vector, so the faces the player
 * walks toward take more than double the key they used to, and the elevation
 * drops 53° → 41° so shadows are long enough to read as events. At that
 * elevation the 17 m canyon outer wall throws its edge to about x = 2.5,
 * which leaves the east third of the deck in full key and the rest in shadow
 * — a raking, half-lit deck rather than a uniformly lit one.
 */
const KEY_OFFSET = new THREE.Vector3(-46, 66, -58).normalize().multiplyScalar(120)
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
// Unconditional contact shadows (work order env-art #2)
//
// The cascade shadows are back (the R2 diagnosis found the maps were fine and
// almost nothing was flagged `receiveShadow`), but a character still needs a
// hard contact AO patch directly under it: a cascade's softest PCF tap is
// wider than the gap between a boot and the deck, and on quality tier 1 the
// key stops casting entirely. So every ground entity also gets a projected
// blob, drawn as one InstancedMesh of horizontal quads with a per-instance
// strength attribute.
//
// Cost: one draw call, one throttled raycast per frame (round-robin over the
// slots), zero allocation in the frame loop.
// ---------------------------------------------------------------------------
const BLOB_SLOTS = 10
const _blobM = new THREE.Matrix4()
const _blobQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0))
const _blobP = new THREE.Vector3()
const _blobS = new THREE.Vector3()
const _blobOrigin = new THREE.Vector3()
const _blobDown = new THREE.Vector3(0, -1, 0)
/** how far below an entity we look for a floor before giving up */
const BLOB_PROBE = 7
/** per-slot scratch, module scope so the frame loop allocates nothing */
const _blobX = new Float32Array(BLOB_SLOTS)
const _blobY = new Float32Array(BLOB_SLOTS)
const _blobZ = new Float32Array(BLOB_SLOTS)
const _blobR = new Float32Array(BLOB_SLOTS)
const _blobA = new Float32Array(BLOB_SLOTS)

function ContactBlobs() {
  const mesh = useRef<THREE.InstancedMesh>(null!)
  /** last known ground height per slot; probed round-robin */
  const groundY = useMemo(() => new Float32Array(BLOB_SLOTS).fill(-999), [])
  const probeCursor = useRef(0)

  const geom = useMemo(() => {
    const g = new THREE.PlaneGeometry(1, 1)
    g.setAttribute(
      'aStrength',
      new THREE.InstancedBufferAttribute(new Float32Array(BLOB_SLOTS), 1),
    )
    return g
  }, [])

  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uMap: { value: getContactBlobTexture() } },
        vertexShader: /* glsl */ `
          attribute float aStrength;
          varying vec2 vUv;
          varying float vS;
          void main() {
            vUv = uv;
            vS = aStrength;
            gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform sampler2D uMap;
          varying vec2 vUv;
          varying float vS;
          void main() {
            float a = texture2D(uMap, vUv).a * vS;
            if (a <= 0.004) discard;
            gl_FragColor = vec4(0.0, 0.0, 0.0, a);
          }
        `,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
        toneMapped: false,
      }),
    [],
  )

  useFrame(() => {
    const m = mesh.current
    if (!m) return
    const strength = geom.getAttribute('aStrength') as THREE.InstancedBufferAttribute
    const arr = strength.array as Float32Array

    // --- gather: slot 0 is always the player, 1..n the live enemies.
    //     Written into preallocated scratch arrays; no closure, no object and
    //     no array is created per frame.
    let slot = 0
    _blobX[slot] = PlayerRef.position.x
    _blobY[slot] = PlayerRef.position.y
    _blobZ[slot] = PlayerRef.position.z
    _blobR[slot] = PlayerRef.radius
    _blobA[slot] = 0.82
    slot++
    const enemies = EnemyRegistry.list()
    for (let i = 0; i < enemies.length && slot < BLOB_SLOTS; i++) {
      const e = enemies[i]
      if (!e.alive) continue
      _blobX[slot] = e.position.x
      // ground units report feet, drones report body centre — the airborne
      // fade below handles the difference without a per-type branch
      _blobY[slot] = e.position.y
      _blobZ[slot] = e.position.z
      _blobR[slot] = e.radius
      _blobA[slot] = 0.7
      slot++
    }

    // --- resolve: one floor probe per frame, round-robin over the slots, so
    //     the level raycast cost is fixed no matter how many enemies are alive
    const probe = probeCursor.current % BLOB_SLOTS
    for (let i = 0; i < slot; i++) {
      const feetY = _blobY[i]
      if (i === probe || groundY[i] < -900) {
        _blobOrigin.set(_blobX[i], feetY + 0.6, _blobZ[i])
        const hit = raycastLevel(_blobOrigin, _blobDown, BLOB_PROBE, ['floor'])
        groundY[i] = hit ? hit.point.y : feetY
      }
      const gy = groundY[i]
      const air = Math.max(0, feetY - gy)
      // a shadow spreads and fades as its caster leaves the ground
      const fade = 1 - THREE.MathUtils.smoothstep(air, 0.05, 3.2)
      const spread = 1 + Math.min(air, 3.2) * 0.42
      const size = _blobR[i] * 4.6 * spread
      _blobP.set(_blobX[i], gy + 0.025, _blobZ[i])
      _blobS.set(size, size, 1)
      _blobM.compose(_blobP, _blobQ, _blobS)
      m.setMatrixAt(i, _blobM)
      arr[i] = _blobA[i] * fade
    }
    // park unused slots
    for (let i = slot; i < BLOB_SLOTS; i++) arr[i] = 0

    probeCursor.current++
    strength.needsUpdate = true
    m.instanceMatrix.needsUpdate = true
  })

  return (
    <instancedMesh
      ref={mesh}
      args={[geom, mat, BLOB_SLOTS]}
      frustumCulled={false}
      renderOrder={2}
    />
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
        <color attach="background" args={['#02030A']} />
        {/*
          R2 — the two reviews asked for opposite things here: env-art wanted a
          much hotter bar so gold reads as metal, vfx-postfx wanted the whole
          Environment cut so it stops acting as ambient fill. Both are right
          about different parts of it, and the resolution is SOLID ANGLE.

          A narrow bar contributes almost nothing to total irradiance no matter
          how bright it is — it is a sharp reflection, not a light. The broad
          panels are what were flattening the scene: they cover most of the
          hemisphere, so their intensity goes straight into every surface as
          uniform fill and cancels the key.

          So: the narrow bar goes UP (6 → 12), every broad panel comes DOWN by
          roughly 3–4×, and a black occluder is added opposite the bar so a
          curved gold surface has somewhere dark to reflect. The result is a
          hard specular ramp across every bevel with no lift in the ambient.
        */}
        {/* 1 — the key reflection: narrow, intensity 12, above and behind */}
        <Lightformer
          form="rect"
          intensity={12}
          color="#FFFFFF"
          position={[0, 9, -5]}
          rotation-x={-Math.PI / 2}
          scale={[0.85, 14, 1]}
        />
        {/* 2 — a dimmer warm bar ~90° off, so gold has a second, cooler ramp */}
        <Lightformer
          form="rect"
          intensity={7}
          color={LIGHTING.key.color}
          position={[-9, 5, 0]}
          rotation-y={Math.PI / 2}
          scale={[0.6, 8, 1]}
        />
        {/* 3 — black occluder opposite the key bar: the dark half of every
            specular ramp. Without a black in the probe, gold reflects a grey
            room from every angle and reads as painted plastic. */}
        <Lightformer
          form="rect"
          intensity={0}
          color="#000000"
          position={[7, 4, 6]}
          rotation-y={-Math.PI / 2.4}
          scale={[14, 14, 1]}
        />
        {/* 4 — near-black ground; nothing bounces up off a void station */}
        <Lightformer
          form="rect"
          intensity={0.04}
          color="#07080E"
          position={[0, -8, 0]}
          rotation-x={Math.PI / 2}
          scale={[26, 26, 1]}
        />
        {/* 5 — warm horizon band so gold picks up a low amber roll-off */}
        <Lightformer
          form="rect"
          intensity={0.55}
          color="#FFB77A"
          position={[0, 0.4, -12]}
          scale={[24, 1.1, 1]}
        />
        {/* 6/7 — sky contribution, now authored from the R2 sky palette and cut
            hard: the backdrop sits two stops under the architecture, so it must
            not light the architecture either */}
        <Lightformer
          form="rect"
          intensity={0.14}
          color={SKY.horizon}
          position={[0, 3, -16]}
          scale={[30, 8, 1]}
        />
        <Lightformer
          form="rect"
          intensity={0.1}
          color={SKY.zenith}
          position={[0, 14, 0]}
          rotation-x={-Math.PI / 2}
          scale={[26, 26, 1]}
        />
        {/* 8/9 — level-colour bounce: gold shrine west, a trace of corruption
            east. Teal is down hardest: the colour script reserves it for the
            hostile domain, and an env-wide teal tint put it on every surface. */}
        <Lightformer intensity={0.12} color={COLORS.cadenceTeal} position={[11, 2, 0]} rotation-y={-Math.PI / 2} scale={[7, 3, 1]} />
        <Lightformer intensity={0.22} color={COLORS.regalGold} position={[-11, 2, 0]} rotation-y={Math.PI / 2} scale={[7, 3, 1]} />
      </Environment>

      {/* 1a — near shadow cascade (follows the camera, texel-snapped) */}
      <KeyCascade />

      {/* 1b — far cascade: same direction, whole-level ortho for distant
          blockers (domes, megaliths, monoliths) */}
      <directionalLight
        /* exactly parallel to the near cascade — the old `+20` on Y tilted
           this one a few degrees off, which was invisible while nothing
           received shadows and would now show as a kink at the cascade
           boundary where the two shadow directions disagree */
        position={[KEY_OFFSET.x * 1.6, KEY_OFFSET.y * 1.6, KEY_OFFSET.z * 1.6 + 130]}
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

      {/* 11 — oculus spot (punch for the chamber god-ray). R2: 6 → 4 and the
          cone tightened; at 0.3 rad / intensity 6 it was a second key inside
          the chamber and the Reliquary lost its shape. */}
      <spotLight
        position={[0, 24, 150]}
        color="#FFE9C4"
        intensity={4}
        angle={0.22}
        penumbra={0.42}
        distance={60}
        decay={1.5}
        onUpdate={(l: THREE.SpotLight) => {
          l.target.position.set(0, 0, 150)
          l.target.updateMatrixWorld()
          if (!l.target.parent) l.parent?.add(l.target)
        }}
      />

      {/* unconditional contact shadows under the player and every enemy —
          survives the quality tier where key shadow casting is switched off */}
      <ContactBlobs />

      <GodRays />
      <DustField />
    </group>
  )
}

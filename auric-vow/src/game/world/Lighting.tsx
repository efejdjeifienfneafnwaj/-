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
 * R3 (light transport). The premise of this round is that R1 and R2 tuned a
 * rig that was structurally unable to produce the picture, so the structure
 * changed rather than the numbers:
 * - the two-cascade ENERGY SPLIT is gone. A directional light returns fully
 *   lit outside its shadow ortho, so the 0.74 near cascade was leaking three
 *   quarters of the key past every blocker beyond 26 m. One dominant cascade
 *   now carries 0.86 over a ±24 m box at 2048² (2.3 cm/texel); the remaining
 *   0.14 is re-tinted toward the sky and demoted to aligned sky bounce.
 * - the drei <Environment>/<Lightformer> room is replaced by a hand-authored
 *   float equirect with a real 3° SUN DISC at KEY_DIR (radiance 39, contrast
 *   ratio ~2.3e5 against the crushed anti-key hemisphere, but only ~0.05–0.10
 *   of diffuse ambient). Gold now has something to be a mirror of.
 * - the god rays are RAYMARCHED against the key's own shadow map, so a shaft
 *   is cut by the rib it passes behind instead of drawing through it.
 * - GOLD_FIXTURES, exported since R2 and never read by any light, now drives
 *   five architectural practicals, and the chamber oculus spot CASTS.
 * - the contact blobs are ellipses stretched and slid along the key's ground
 *   azimuth, so they agree with the cast shadows instead of contradicting them.
 * The shadow FILTER itself (PCSS) and the fog INTEGRAL (world-space height fog
 * + inscattering) are patched into the stock shader chunks — see GameCanvas.tsx
 * and Fog.tsx respectively, both of which document why at length.
 *
 * Phase-driven lights (chamber/pad gold points) live in EnvironmentFX.
 * The player-follow rim light (design §2.3 #12) is owned by the player rig.
 */
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { LIGHTING, MATERIALS, COLORS, SKY } from '../config'
import { TEAL_FIXTURES, GOLD_FIXTURES } from './ShrineStation'
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

// ---------------------------------------------------------------------------
// R3 — cascade geometry, and why the energy split collapsed to one light
//
// R2 split the key 0.74 / 0.26 between a ±26 m near cascade and a ±130 m far
// one. That split has a flaw that no amount of tuning fixes: a directional
// light returns FULLY LIT for any fragment outside its shadow ortho. So a
// character standing 40 m away, correctly shadowed by the far cascade, still
// received 74 % of the key from the near one — the shadow was a 0.6-stop
// event out there no matter what the config said. The near cascade's whole
// job was contact detail, and it was leaking three quarters of the key past
// every blocker beyond 26 m.
//
// Fix: ONE dominant cascade carrying 0.86 of the key over a ±24 m box at
// 2048² (2.3 cm/texel — a boot sole is four texels wide), texel-snapped and
// pushed ahead of the camera. Inside that box, which is the whole of the near
// field a third-person camera ever shows, a shadow removes 86 % of the key,
// which at hemisphere 0.12 + cameraFill 0.08 + coolRim 0.18 is a genuine
// 3.5-stop event with true black in the recesses.
//
// The far light keeps 0.14, gets a 2048² map over the same ±130 m, and is
// re-tinted toward the sky so its leak past 24 m reads as directional sky
// bounce rather than as a second, shadowless sun.
// ---------------------------------------------------------------------------
const CASCADE = {
  primary: {
    // ±24 m at 2048 is 2.34 cm/texel — finer than R2's ±26 map and at the same
    // memory, because the interesting question turned out to be "how much of
    // the key does a blocker actually remove", not "how many texels". A 68 m
    // box at 3072 was tried and is 2.25× the depth-pass fill for a 6 % coarser
    // texel; the far cascade already owns everything past 24 m and fog has
    // eaten most of the contrast out there anyway.
    extent: 24,
    mapSize: 2048,
    bias: -0.00013,
    normalBias: 0.02,
    /** PCSS penumbra scale, in units of 7 texels at maximum opening */
    radius: 1.15,
    share: 0.86,
  },
  far: {
    extent: 130,
    mapSize: 2048,
    bias: -0.0004,
    normalBias: 0.05,
    radius: 1.0,
    share: 0.14,
  },
} as const

/** far cascade tint — the key colour pulled most of the way to the sky */
const FAR_TINT = new THREE.Color(LIGHTING.key.color).lerp(
  new THREE.Color(LIGHTING.hemisphere.skyColor),
  0.55,
)

/**
 * The primary cascade's depth map and world→shadow matrix, published once a
 * frame so the volumetric shafts can march through the SAME occlusion the
 * surfaces are shaded with. This is what makes a god ray a light-transport
 * event instead of a decal: the shaft is broken by the rib it passes behind.
 */
const PrimaryShadow: { map: THREE.Texture | null; matrix: THREE.Matrix4 } = {
  map: null,
  matrix: new THREE.Matrix4(),
}

// ---------------------------------------------------------------------------
// Volumetric shafts (R3) — raymarched against the key's own shadow map
//
// The R2 shafts were 16-gon additive cylinders at a flat opacity: a hard cut
// at the floor, a hard silhouette at the cone wall, and — the tell that made
// them read as geometry rather than light — they passed straight THROUGH the
// ribs and galleries they should have been chopped by. E7 in the weakness
// register, "noise-modulated soft volumetrics", is the AAA behaviour.
//
// This is that. Each shaft renders its BACK faces, reconstructs the view ray
// in object space, analytically clips it to the cone, and marches 20 samples.
// At every sample it projects into the primary cascade's shadow map and tests
// occlusion — the exact same depth buffer that shades the walls. So the shaft
// carries the shadow of whatever is between it and the sun: a dome rib cuts a
// dark band across it, an arch crops it, a passing enemy breaks it. On top of
// that: a radial falloff so the cone has no silhouette edge, a vertical ramp
// so it dies out before the floor instead of being sliced by it, and a
// drifting 3-octave sine noise so the air has structure.
//
// Cost: 20 taps per fragment on four small, mostly off-screen cones, back
// faces only, depth-tested against the opaque scene. Nothing allocates.
// ---------------------------------------------------------------------------
const GOD_RAYS: {
  p: [number, number, number]
  r: [number, number, number]
  top: number
  bottom: number
  h: number
  /** additive radiance per metre of fully dense, fully lit shaft (see the
   *  knee at the end of the fragment shader — a 13 m axial path at 0.032
   *  lands near 0.25, which is a visible shaft that never pins the frame) */
  power: number
}[] = [
  { p: [0, 9, 7.5], r: [0, 0, 0], top: 1.6, bottom: 5, h: 18, power: 0.032 }, // spawn oculus
  { p: [0, 8.5, 150], r: [0, 0, 0], top: 6, bottom: 14, h: 17, power: 0.026 }, // chamber oculus
  { p: [3.4, 5.5, 60], r: [0, 0, -0.55], top: 1.6, bottom: 4.4, h: 12, power: 0.022 }, // canyon glass
  { p: [3.4, 5.5, 100], r: [0, 0, -0.55], top: 1.6, bottom: 4.4, h: 12, power: 0.022 }, // canyon glass
]

/**
 * 14 steps, not 20. When the camera stands inside one of the canyon shafts the
 * cone covers most of the screen, and every step is a dependent shadow-map
 * fetch — measured on the software renderer this view is the most expensive
 * frame in the game by a wide margin. The per-pixel march offset is dithered,
 * so 14 jittered samples band no more visibly than 20 aligned ones.
 */
const SHAFT_STEPS = 14

const SHAFT_VERT = /* glsl */ `
  varying vec3 vObj;
  void main() {
    vObj = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
  }
`

const SHAFT_FRAG = /* glsl */ `
  uniform sampler2D uShadow;
  /** shadow-projection matrix PREMULTIPLIED by this mesh's matrixWorld, so the
   *  march never needs modelMatrix (which three does not expose to fragment
   *  shaders) and the CPU pays for the concatenation once per frame */
  uniform mat4 uShadowFromObj;
  uniform float uHasShadow;
  uniform vec3 uCamObj;
  uniform vec3 uColor;
  uniform float uPower;
  uniform float uTopR;
  uniform float uBotR;
  uniform float uHalfH;
  uniform float uTime;
  varying vec3 vObj;

  void main() {
    vec3 ro = uCamObj;
    vec3 seg = vObj - ro;
    float segLen = length( seg );
    if ( segLen < 1e-4 ) discard;
    vec3 rd = seg / segLen;

    // clip the ray to the shaft: widest cylinder radius, then the height slab
    float R = max( uTopR, uBotR );
    float t0 = 0.0;
    float t1 = segLen;
    float a = rd.x * rd.x + rd.z * rd.z;
    float b = 2.0 * ( ro.x * rd.x + ro.z * rd.z );
    float c = ro.x * ro.x + ro.z * ro.z - R * R;
    if ( a > 1e-6 ) {
      float disc = b * b - 4.0 * a * c;
      if ( disc <= 0.0 ) discard;
      float sq = sqrt( disc );
      t0 = max( t0, ( -b - sq ) / ( 2.0 * a ) );
      t1 = min( t1, ( -b + sq ) / ( 2.0 * a ) );
    } else if ( c > 0.0 ) {
      discard;
    }
    if ( abs( rd.y ) > 1e-5 ) {
      float ta = ( -uHalfH - ro.y ) / rd.y;
      float tb = ( uHalfH - ro.y ) / rd.y;
      t0 = max( t0, min( ta, tb ) );
      t1 = min( t1, max( ta, tb ) );
    } else if ( abs( ro.y ) > uHalfH ) {
      discard;
    }
    if ( t1 <= t0 ) discard;

    float dt = ( t1 - t0 ) / float( ${SHAFT_STEPS} );
    // dither the march start so 20 steps do not band across the shaft
    float jitter = fract( sin( dot( gl_FragCoord.xy, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
    float t = t0 + dt * jitter;
    float acc = 0.0;

    for ( int i = 0; i < ${SHAFT_STEPS}; i ++ ) {
      vec3 p = ro + rd * t;
      t += dt;

      // radial soft edge — the cone has no silhouette, it just runs out
      float hN = clamp( ( p.y + uHalfH ) / ( 2.0 * uHalfH ), 0.0, 1.0 );
      float rAt = mix( uBotR, uTopR, hN );
      float rr = length( p.xz ) / max( rAt, 1e-3 );
      float radial = 1.0 - smoothstep( 0.18, 1.0, rr );
      if ( radial <= 0.001 ) continue;

      // vertical ramp: brightest where it enters, dying out before the deck,
      // so there is no hard floor cut
      float vert = smoothstep( 0.0, 0.34, hN ) * mix( 1.0, 0.35, 1.0 - hN );

      // drifting air structure. Two transcendentals, not three: this loop is
      // the hottest code in the renderer when a shaft fills the screen.
      float n = 0.62 + 0.38 * sin( p.x * 1.6 + p.y * 0.7 + uTime * 0.31 )
                            * sin( p.z * 1.9 - p.y * 0.5 - uTime * 0.24 );

      // occlusion from the KEY's own cascade — the shaft is cut by whatever
      // casts a shadow on the floor under it
      float vis = 1.0;
      if ( uHasShadow > 0.5 ) {
        vec4 sc = uShadowFromObj * vec4( p, 1.0 );
        sc.xyz /= sc.w;
        if ( sc.x > 0.0 && sc.x < 1.0 && sc.y > 0.0 && sc.y < 1.0 && sc.z < 1.0 ) {
          float d = texture2D( uShadow, sc.xy ).r;
          vis = step( sc.z - 0.0022, d );
        }
      }

      acc += radial * vert * n * vis;
    }

    // acc is now a path integral in metres of "dense, lit shaft". uPower is
    // brightness per such metre; the reciprocal knee keeps a ray fired straight
    // down the axis of the chamber shaft from blowing out while a glancing ray
    // stays linear, so the shaft has a core without having a hard edge.
    acc *= dt * uPower;
    acc = acc / ( 1.0 + acc * 1.6 );
    if ( acc <= 0.0008 ) discard;
    gl_FragColor = vec4( uColor * acc, 1.0 );
  }
`

const _shaftCam = new THREE.Vector3()
const WHITE_1X1 = (() => {
  const t = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1)
  t.needsUpdate = true
  return t
})()

function GodRays() {
  const group = useRef<THREE.Group>(null!)

  const geoms = useMemo(
    () =>
      GOD_RAYS.map((g) => new THREE.CylinderGeometry(g.top, g.bottom, g.h, 20, 1, false)),
    [],
  )

  const mats = useMemo(
    () =>
      GOD_RAYS.map(
        (g) =>
          new THREE.ShaderMaterial({
            uniforms: {
              uShadow: { value: WHITE_1X1 },
              uShadowFromObj: { value: new THREE.Matrix4() },
              uHasShadow: { value: 0 },
              uCamObj: { value: new THREE.Vector3() },
              uColor: { value: new THREE.Color(LIGHTING.key.color) },
              uPower: { value: g.power },
              uTopR: { value: g.top },
              uBotR: { value: g.bottom },
              uHalfH: { value: g.h * 0.5 },
              uTime: { value: 0 },
            },
            vertexShader: SHAFT_VERT,
            fragmentShader: SHAFT_FRAG,
            side: THREE.BackSide,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            toneMapped: false,
          }),
      ),
    [],
  )

  useFrame((state) => {
    const g = group.current
    if (!g) return
    const t = state.clock.elapsedTime
    for (let i = 0; i < mats.length; i++) {
      const mesh = g.children[i] as THREE.Mesh
      if (!mesh) continue
      const u = mats[i].uniforms
      _shaftCam.copy(state.camera.position)
      mesh.worldToLocal(_shaftCam)
      ;(u.uCamObj.value as THREE.Vector3).copy(_shaftCam)
      u.uTime.value = t
      // --- camera-inside fade.
      // Back-face rendering means that when the camera walks into a shaft the
      // cone covers the whole screen, and every pixel then runs the full
      // march: measured on the software renderer, standing inside the z=100
      // canyon shaft made that the most expensive frame in the game by an
      // order of magnitude. It is also wrong to look at — you do not see a
      // beam you are standing inside, you see the light on your own armour.
      // So the shaft fades out as the camera enters its radius. Free on the
      // GPU (one uniform), and it removes the worst case entirely.
      const gr = GOD_RAYS[i]
      const rMax = Math.max(gr.top, gr.bottom)
      const inSlab = Math.abs(_shaftCam.y) < gr.h * 0.5 + 1
      const radial = Math.hypot(_shaftCam.x, _shaftCam.z) / rMax
      const insideFade = inSlab ? THREE.MathUtils.smoothstep(radial, 0.5, 1.3) : 1
      if (PrimaryShadow.map) {
        u.uShadow.value = PrimaryShadow.map
        ;(u.uShadowFromObj.value as THREE.Matrix4).multiplyMatrices(
          PrimaryShadow.matrix,
          mesh.matrixWorld,
        )
        u.uHasShadow.value = 1
      } else {
        u.uShadow.value = WHITE_1X1
        u.uHasShadow.value = 0
      }
      // slow breathing, ±14 %, 6 s period, offset per shaft
      u.uPower.value =
        gr.power * (1 + 0.14 * Math.sin((t * Math.PI * 2) / 6 + i * 1.7)) * insideFade
      // a fully faded shaft is not drawn at all
      mesh.visible = insideFade > 0.004
    }
  })

  return (
    <group ref={group}>
      {GOD_RAYS.map((g, i) => (
        <mesh
          key={i}
          geometry={geoms[i]}
          material={mats[i]}
          position={g.p}
          rotation={g.r}
          renderOrder={8}
        />
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
/**
 * R3 — the blob is no longer a circle centred under the caster. The key sits
 * at 41° elevation, so a real contact shadow is an ellipse stretched 1/sin(41°)
 * ≈ 1.5× along the key's ground azimuth, and it slides AWAY from the caster as
 * the caster leaves the ground. A circle pinned under the feet is the tell that
 * says "blob shadow"; these three lines are what make it read as the same light
 * everything else is lit by.
 *
 * Rotation: Euler('XYZ') composes Rx·Ry·Rz, so Euler(-90°, 0, roll) rolls the
 * quad in its own plane first and then lays it flat. Under Rx(-90) local +X
 * maps to world +X and local +Y to world −Z, hence roll = −atan2(dz, dx).
 */
const KEY_GROUND = new THREE.Vector2(-KEY_DIR.x, -KEY_DIR.z).normalize()
/** horizontal distance a shadow travels per metre of altitude, at the key's elevation */
const KEY_SLIDE = Math.sqrt(1 - KEY_DIR.y * KEY_DIR.y) / Math.max(KEY_DIR.y, 1e-3)
/** long/short axis ratio of a sphere's shadow at the key's elevation */
const KEY_STRETCH = 1 / Math.max(KEY_DIR.y, 0.25)
const _blobQ = new THREE.Quaternion().setFromEuler(
  new THREE.Euler(-Math.PI / 2, 0, -Math.atan2(KEY_GROUND.y, KEY_GROUND.x)),
)
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
      // the shadow slides down-key as the caster rises, exactly as the cast
      // shadow from the key does, so the two agree where both are present
      const slide = Math.min(air, 3.2) * KEY_SLIDE
      _blobP.set(_blobX[i] + KEY_GROUND.x * slide, gy + 0.025, _blobZ[i] + KEY_GROUND.y * slide)
      _blobS.set(size * KEY_STRETCH, size, 1)
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
  const near = CASCADE.primary

  useFrame(({ camera }) => {
    const l = light.current
    if (!l) return
    camera.getWorldDirection(_camFwd)
    // bias the shadow box ahead of the camera — that is where the player and
    // the geometry they are about to run into live
    _focus.copy(camera.position).addScaledVector(_camFwd, near.extent * 0.4)
    _focus.y = Math.max(_focus.y, 0)
    // snap to the shadow-map texel grid so edges stop crawling as we move
    const texel = (near.extent * 2) / near.mapSize
    _focus.x = Math.round(_focus.x / texel) * texel
    _focus.y = Math.round(_focus.y / texel) * texel
    _focus.z = Math.round(_focus.z / texel) * texel
    l.position.copy(_focus).add(KEY_OFFSET)
    l.target.position.copy(_focus)
    l.target.updateMatrixWorld()
    // publish the depth map the volumetric shafts march through. `shadow.map`
    // exists only after the first shadow pass, and `shadow.matrix` is the
    // world→[0,1] projection three itself shades with, so the shafts and the
    // surfaces cannot disagree about what is occluded.
    PrimaryShadow.map = l.castShadow ? (l.shadow.map?.depthTexture ?? null) : null
    PrimaryShadow.matrix.copy(l.shadow.matrix)
  })

  return (
    <directionalLight
      ref={light}
      color={LIGHTING.key.color}
      intensity={LIGHTING.key.intensity * near.share}
      castShadow
      shadow-mapSize-width={near.mapSize}
      shadow-mapSize-height={near.mapSize}
      shadow-radius={near.radius}
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
        l.userData.auricRole = 'key'
        // the last caster to be switched off: everything the player can see
        // is shadowed by this one light
        l.userData.auricShadowTier = 2
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

// ---------------------------------------------------------------------------
// Procedural HDR probe (R3)
//
// R2 built the probe out of nine drei <Lightformer> rects. That gets you a
// room made of grey panels: the brightest thing in it was intensity 12 spread
// over a 0.85 × 14 rect, which after PMREM is a smear, not a highlight. Metal
// reflects a highlight. Specifically it reflects a SMALL, VERY BRIGHT thing
// and a LOT OF NEAR-BLACK, and the ratio between them is what the eye reads as
// "polished". A 12:0.14 probe is a ratio of 85; a real sun against a night sky
// is a ratio in the tens of thousands.
//
// So the probe is authored directly as a float equirect and PMREM'd once at
// boot. What is in it:
//   - a 3°-wide SUN DISC at radiance 46, placed exactly at KEY_DIR, so the
//     specular hot spot on every gold bevel sits on the same side as the
//     shadow the key throws. Nothing else in the frame makes gold read as
//     metal this cheaply: it is ~0.002 sr, so it adds ~0.03 to irradiance —
//     it is a highlight, not a fill. This is the solid-angle argument R2 made
//     for the narrow bar, taken to its conclusion.
//   - a narrow cool bar ~100° off, for the second ramp across a curve.
//   - an ANTI-KEY CRUSH: the hemisphere away from the sun is multiplied down
//     to 0.16, so a curved gold surface always has somewhere black to reflect.
//     Without a black in the probe, gold is painted plastic from every angle.
//   - a warm horizon band biased to the sun azimuth, a near-black ground, and
//     the SKY palette gradient so upward faces pick up the actual backdrop.
//   - a trace of gold bounce west / corruption teal east, at the level of a
//     tint rather than a light.
// ---------------------------------------------------------------------------
/** MATERIALS.envMapResolution still sizes the probe — it is now the width of
 *  the authored equirect rather than a drei cube render target. At 1024 a
 *  texel is 0.35°, so the 3° sun disc survives as a disc through PMREM's
 *  mip 0 instead of being pre-blurred into a smear. */
const ENV_W = MATERIALS.envMapResolution
const ENV_H = MATERIALS.envMapResolution / 2
/** overall probe gain; the ambient this contributes is deliberately under the key */
const ENV_INTENSITY = 0.82

function smoothstep01(e0: number, e1: number, x: number) {
  const t = THREE.MathUtils.clamp((x - e0) / (e1 - e0), 0, 1)
  return t * t * (3 - 2 * t)
}

function buildEnvEquirect(): THREE.DataTexture {
  const data = new Float32Array(ENV_W * ENV_H * 4)
  // THREE.Color parses sRGB hex into the linear working space, which is the
  // space PMREM wants, so these components go straight into the buffer.
  const zenith = new THREE.Color(SKY.zenith)
  const horizon = new THREE.Color(SKY.horizon)
  const voidC = new THREE.Color(SKY.voidTint)
  const warm = new THREE.Color(LIGHTING.key.color)
  const cool = new THREE.Color(LIGHTING.coolRim.color)
  const gold = new THREE.Color(COLORS.regalGold)
  const teal = new THREE.Color(COLORS.cadenceTeal)

  // second specular bar: roughly 100° off the key, low and to the east
  const bar = new THREE.Vector3(0.93, 0.26, 0.26).normalize()
  const discInner = Math.cos(0.026) // ~1.5° half-angle, full radiance
  const discOuter = Math.cos(0.052) // ~3.0° half-angle, limb

  for (let y = 0; y < ENV_H; y++) {
    const v = (y + 0.5) / ENV_H
    const theta = (v - 0.5) * Math.PI
    const dy = Math.sin(theta)
    const rxz = Math.cos(theta)
    for (let x = 0; x < ENV_W; x++) {
      const u = (x + 0.5) / ENV_W
      const phi = (u - 0.5) * Math.PI * 2
      const dx = rxz * Math.cos(phi)
      const dz = rxz * Math.sin(phi)

      let r: number
      let g: number
      let b: number
      if (dy >= 0) {
        // sky: horizon → zenith, biased so most of the dome is the darker value
        const t = Math.pow(dy, 0.55)
        r = horizon.r * (1 - t) + zenith.r * t
        g = horizon.g * (1 - t) + zenith.g * t
        b = horizon.b * (1 - t) + zenith.b * t
      } else {
        // ground: the station is a void platform, nothing bounces up
        const t = Math.min(1, -dy / 0.35)
        r = horizon.r * 0.14 * (1 - t) + voidC.r * t
        g = horizon.g * 0.14 * (1 - t) + voidC.g * t
        b = horizon.b * 0.14 * (1 - t) + voidC.b * t
      }

      const sd = dx * KEY_DIR.x + dy * KEY_DIR.y + dz * KEY_DIR.z

      // crush the anti-key hemisphere so every specular ramp has a dark end
      const occl = 0.16 + 0.84 * smoothstep01(-0.55, 0.4, sd)
      r *= occl
      g *= occl
      b *= occl

      // warm horizon band, strongest toward the sun azimuth
      const band = Math.exp(-((dy / 0.085) ** 2)) * Math.max(0, sd) * 0.8
      r += warm.r * band
      g += warm.g * band
      b += warm.b * band

      // the sun disc + its glow — narrow solid angle, enormous radiance
      const disc = smoothstep01(discOuter, discInner, sd) * 46
      const glow = Math.pow(Math.max(sd, 0), 240) * 3.4
      const sun = disc + glow
      r += warm.r * sun
      g += warm.g * sun
      b += warm.b * sun

      // second, cooler specular bar for the far side of a curve
      const bd = dx * bar.x + dy * bar.y + dz * bar.z
      const bar2 = Math.pow(Math.max(bd, 0), 700) * 6.5
      r += cool.r * bar2
      g += cool.g * bar2
      b += cool.b * bar2

      // level-colour bounce: gold shrine west, a trace of corruption east
      const gw = Math.pow(Math.max(-dx, 0), 3) * Math.max(0, 1 - Math.abs(dy) * 2) * 0.09
      const te = Math.pow(Math.max(dx, 0), 3) * Math.max(0, 1 - Math.abs(dy) * 2) * 0.04
      r += gold.r * gw + teal.r * te
      g += gold.g * gw + teal.g * te
      b += gold.b * gw + teal.b * te

      const i = (y * ENV_W + x) * 4
      data[i] = r
      data[i + 1] = g
      data[i + 2] = b
      data[i + 3] = 1
    }
  }

  const tex = new THREE.DataTexture(data, ENV_W, ENV_H, THREE.RGBAFormat, THREE.FloatType)
  tex.mapping = THREE.EquirectangularReflectionMapping
  tex.minFilter = THREE.LinearFilter
  tex.magFilter = THREE.LinearFilter
  tex.colorSpace = THREE.LinearSRGBColorSpace
  tex.needsUpdate = true
  return tex
}

function ProceduralEnvironment() {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl)
    pmrem.compileEquirectangularShader()
    const src = buildEnvEquirect()
    const rt = pmrem.fromEquirectangular(src)
    scene.environment = rt.texture
    scene.environmentIntensity = ENV_INTENSITY
    src.dispose()
    pmrem.dispose()
    return () => {
      if (scene.environment === rt.texture) scene.environment = null
      rt.dispose()
    }
  }, [gl, scene])
  return null
}

// ---------------------------------------------------------------------------
// Gold practicals — the architectural fixtures the R2 colour script created
// and nobody lit (LIGHTING.goldPractical existed, GOLD_FIXTURES was exported,
// and no light ever read it). Canyon bays, wall-run slab veins, arena
// perimeter sconces, megalith under-glow and the arena medallion all have
// modelled emissive fixtures; these put a light AT each one so the fixture
// throws a pool instead of being a glowing sticker on a flatly lit wall.
//
// Nearest 5 by camera distance, 34 m cull, one shared irregular flicker so
// the pools breathe out of phase with the teal corruption.
// ---------------------------------------------------------------------------
const GOLD_COUNT = 5

function GoldPracticals() {
  const lights = useRef<(THREE.PointLight | null)[]>([])
  const bestIdx = useMemo(() => new Int32Array(GOLD_COUNT), [])
  const bestDist = useMemo(() => new Float32Array(GOLD_COUNT), [])

  useFrame((state, dt) => {
    const cam = state.camera.position
    for (let i = 0; i < GOLD_COUNT; i++) {
      bestIdx[i] = -1
      bestDist[i] = Infinity
    }
    for (let f = 0; f < GOLD_FIXTURES.length; f++) {
      const p = GOLD_FIXTURES[f]
      const dx = p[0] - cam.x
      const dy = p[1] - cam.y
      const dz = p[2] - cam.z
      const d2 = dx * dx + dy * dy + dz * dz
      if (d2 > 1156) continue // 34 m cull
      for (let i = 0; i < GOLD_COUNT; i++) {
        if (d2 < bestDist[i]) {
          for (let j = GOLD_COUNT - 1; j > i; j--) {
            bestDist[j] = bestDist[j - 1]
            bestIdx[j] = bestIdx[j - 1]
          }
          bestDist[i] = d2
          bestIdx[i] = f
          break
        }
      }
    }
    const t = state.clock.elapsedTime
    const k = 1 - Math.exp(-9 * dt)
    for (let i = 0; i < GOLD_COUNT; i++) {
      const l = lights.current[i]
      if (!l) continue
      const f = bestIdx[i]
      if (f < 0) {
        l.intensity = THREE.MathUtils.lerp(l.intensity, 0, k)
        continue
      }
      const p = GOLD_FIXTURES[f]
      l.position.set(p[0], p[1], p[2])
      // two detuned sines: a fixture flame, not a pulse generator
      const flicker = 0.9 + 0.07 * Math.sin(t * 1.7 + f * 2.1) + 0.03 * Math.sin(t * 4.3 + f)
      l.intensity = THREE.MathUtils.lerp(
        l.intensity,
        LIGHTING.goldPractical.intensity * flicker,
        k,
      )
    }
  })

  return (
    <group>
      {Array.from({ length: GOLD_COUNT }).map((_, i) => (
        <pointLight
          key={i}
          ref={(r) => {
            lights.current[i] = r
          }}
          color={LIGHTING.goldPractical.color}
          intensity={0}
          distance={LIGHTING.goldPractical.distance}
          decay={LIGHTING.goldPractical.decay}
        />
      ))}
    </group>
  )
}

export default function Lighting() {
  const far = CASCADE.far

  return (
    <group>
      {/* procedural HDR probe (design §2.4) — a real sun disc at KEY_DIR over
          a crushed anti-key hemisphere. See buildEnvEquirect above for why the
          nine-lightformer room it replaces could not make gold read as metal. */}
      <ProceduralEnvironment />

      {/* 1a — the key. One dominant cascade, 0.86 of the light in the scene,
          following the camera and texel-snapped. */}
      <KeyCascade />

      {/* 1b — aligned sky bounce: same direction, whole-level ortho, 0.14 of
          the key and tinted toward the sky so the fraction it leaks past the
          primary cascade's box reads as directional ambient rather than as a
          second sun. Its shadow still catches domes, megaliths and monoliths
          at long range. */}
      <directionalLight
        /* exactly parallel to the primary cascade — the old `+20` on Y tilted
           this one a few degrees off, which was invisible while nothing
           received shadows and would now show as a kink at the cascade
           boundary where the two shadow directions disagree */
        position={[KEY_OFFSET.x * 1.6, KEY_OFFSET.y * 1.6, KEY_OFFSET.z * 1.6 + 130]}
        color={FAR_TINT}
        intensity={LIGHTING.key.intensity * far.share}
        castShadow
        shadow-mapSize-width={far.mapSize}
        shadow-mapSize-height={far.mapSize}
        shadow-radius={far.radius}
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
          l.userData.auricRole = 'key'
          // first thing to stop casting when the fps window misses
          l.userData.auricShadowTier = 1
        }}
      />

      {/* 2 — cool indigo hemisphere fill. At 0.12 against a 3.78 key this is
          not a light, it is the colour the shadow side is allowed to be. */}
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

      {/* 3–8 — teal practicals, nearest 4 modelled vein fixtures (corruption) */}
      <TealPracticals />

      {/* 3b — gold architectural practicals, nearest 5 modelled fixtures.
          GOLD_FIXTURES has been exported since the R2 colour script and no
          light ever read it, so every aureate bay, sconce, slab vein and
          megalith under-plate was a glowing sticker throwing no pool. */}
      <GoldPracticals />

      {/* 11 — oculus spot (punch for the chamber shaft). R3: this now CASTS.
          A second shadowing source is the difference between a lit room and a
          room with a light in it: the Reliquary throws its own shadow across
          the chamber floor, at a different angle from the key's, and the
          planters and pylons under the oculus get a second, harder edge. Its
          cone is 0.22 rad, so the caster set is small and the pass is cheap. */}
      <spotLight
        position={[0, 24, 150]}
        color="#FFE9C4"
        intensity={4}
        angle={0.22}
        penumbra={0.42}
        distance={60}
        decay={1.5}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-radius={1.6}
        shadow-camera-near={2}
        shadow-camera-far={48}
        shadow-bias={-0.0006}
        shadow-normalBias={0.03}
        onUpdate={(l: THREE.SpotLight) => {
          l.target.position.set(0, 0, 150)
          l.target.updateMatrixWorld()
          if (!l.target.parent) l.parent?.add(l.target)
          l.userData.auricShadowTier = 1
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

/**
 * AURIC VOW — world/Skybox.tsx
 * design.md §2.6 + environment.md §3: gradient dome shader, star field, a
 * giant ringed-planet silhouette low over the east void, and the indigo
 * void-glow plane far below.
 *
 * R1 rebuild (art review item 9/10):
 * - the planet's terminator is derived from the LEVEL's key direction
 *   (Lighting.KEY_DIR), so the sky agrees with the architecture lighting
 *   instead of inventing its own light
 * - the ring is a mip-filtered textured disc that now carries the planet's
 *   shadow band, cast along that same key vector
 * - three parallax strata: a far dome + far stars locked to the camera, and a
 *   NEAR stratum (bigger stars + a nebula shelf) that lags the camera by 6 %
 *   so the backdrop moves as the player runs the 265 m of level
 * - the dome is authored darker with a warm glow around the key direction, so
 *   architecture silhouettes stay separated at the top of the frame and the
 *   sky supports the composition rather than competing with it
 */
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { COLORS, FOG } from '../config'
import { KEY_DIR } from './Lighting'

const DOME_R = 300
/** how much the near stratum lags the camera (0 = locked, 1 = world-fixed) */
const PARALLAX = 0.06

// ---------------------------------------------------------------------------
// Gradient dome
// ---------------------------------------------------------------------------
const domeMaterial = () =>
  new THREE.ShaderMaterial({
    uniforms: {
      uZenith: { value: new THREE.Color(FOG.skyZenith) },
      uHorizon: { value: new THREE.Color(FOG.skyHorizon) },
      uSun: { value: KEY_DIR.clone() },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vDir;
      uniform vec3 uZenith;
      uniform vec3 uHorizon;
      uniform vec3 uSun;
      // cheap value-noise fbm for the nebula band
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x),
                   mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
      }
      float fbm(vec2 p) {
        float v = 0.0, a = 0.5;
        for (int i = 0; i < 3; i++) { v += a * noise(p); p *= 2.1; a *= 0.5; }
        return v;
      }
      void main() {
        vec3 d = normalize(vDir);
        float h = clamp(d.y, -1.0, 1.0);
        vec3 col = mix(uHorizon, uZenith, smoothstep(-0.05, 0.65, h));
        // indigo/violet nebula bands — pulled back so the sky reads as a dark
        // backdrop the architecture can silhouette against
        float band = exp(-pow((d.y - 0.18 - d.x * 0.12) * 3.0, 2.0));
        float band2 = exp(-pow((d.y + 0.28 + d.x * 0.10) * 2.6, 2.0));
        float n = pow(fbm(d.xz * 4.0 + d.y * 3.0), 1.35);
        float n2 = fbm(d.zx * 7.0 - d.y * 5.0);
        vec3 indigo = vec3(0.13, 0.10, 0.46);
        vec3 violet = vec3(0.32, 0.13, 0.58);
        col += (indigo * band * (0.35 + 1.3 * n) + violet * band2 * n2 * 0.9) * 1.05;
        // warm glow around the key direction — the sky agrees with the rig
        float sd = max(dot(d, uSun), 0.0);
        col += vec3(0.62, 0.46, 0.30) * pow(sd, 6.0) * 0.55;
        col += vec3(0.30, 0.26, 0.24) * pow(sd, 2.0) * 0.12;
        // exposure was dropped to 0.85 for the level; the sky is authored, not
        // tonemapped, so match it here or the backdrop floats off the frame
        col *= 0.6;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  })

// ---------------------------------------------------------------------------
// Starfield — additive points, 10% twinkle amplitude
// ---------------------------------------------------------------------------
function Stars({
  count,
  radius,
  sizeScale,
  tint,
}: {
  count: number
  radius: number
  sizeScale: number
  tint: [number, number, number]
}) {
  const { geom, mat } = useMemo(() => {
    const pos = new Float32Array(count * 3)
    const phase = new Float32Array(count)
    const size = new Float32Array(count)
    for (let i = 0; i < count; i++) {
      // random direction on the dome interior
      const u = Math.random()
      const v = Math.random()
      const theta = 2 * Math.PI * u
      const phi = Math.acos(2 * v - 1)
      pos[i * 3] = radius * Math.sin(phi) * Math.cos(theta)
      pos[i * 3 + 1] = radius * Math.cos(phi)
      pos[i * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta)
      phase[i] = Math.random() * Math.PI * 2
      size[i] = (1 + Math.random() * 2) * sizeScale
    }
    const geom = new THREE.BufferGeometry()
    geom.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    geom.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1))
    geom.setAttribute('aSize', new THREE.BufferAttribute(size, 1))
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uTint: { value: new THREE.Vector3(...tint) } },
      vertexShader: /* glsl */ `
        attribute float aPhase;
        attribute float aSize;
        uniform float uTime;
        varying float vTw;
        void main() {
          vTw = 0.9 + 0.1 * sin(uTime * 2.0 + aPhase); // 10% twinkle
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * vTw * (300.0 / -mv.z);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vTw;
        uniform vec3 uTint;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          // soft core + wider falloff so stars are anti-aliased, not 1 px dots
          float a = smoothstep(0.5, 0.12, d) * 0.65 + smoothstep(0.32, 0.0, d) * 0.6;
          gl_FragColor = vec4(uTint * vTw, a);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    })
    return { geom, mat }
  }, [count, radius, sizeScale, tint])

  useFrame((state) => {
    mat.uniforms.uTime.value = state.clock.elapsedTime
  })

  return <points geometry={geom} material={mat} frustumCulled={false} />
}

// ---------------------------------------------------------------------------
// Nebula shelf — the near parallax stratum. A single large additive plane sat
// behind the planet, so the backdrop has two depths that separate as the
// player traverses the level.
// ---------------------------------------------------------------------------
function NebulaShelf() {
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 } },
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          varying vec2 vUv;
          uniform float uTime;
          float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
          float noise(vec2 p) {
            vec2 i = floor(p), f = fract(p);
            vec2 u = f * f * (3.0 - 2.0 * f);
            return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x),
                       mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
          }
          float fbm(vec2 p) {
            float v = 0.0, a = 0.5;
            for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.05; a *= 0.5; }
            return v;
          }
          void main() {
            vec2 p = vUv * vec2(3.2, 1.8);
            float n = fbm(p * 2.0 + vec2(uTime * 0.005, 0.0));
            float n2 = fbm(p * 5.0 - vec2(0.0, uTime * 0.004));
            // horizontal shelf shape, feathered top and bottom
            float shelf = smoothstep(0.0, 0.34, vUv.y) * (1.0 - smoothstep(0.58, 1.0, vUv.y));
            float edge = smoothstep(0.0, 0.18, vUv.x) * (1.0 - smoothstep(0.82, 1.0, vUv.x));
            float a = shelf * edge * pow(n, 1.6) * 0.3;
            vec3 col = mix(vec3(0.16, 0.12, 0.42), vec3(0.42, 0.20, 0.52), n2);
            col += vec3(0.30, 0.34, 0.62) * pow(n2, 3.0) * 0.6;
            gl_FragColor = vec4(col, a);
          }
        `,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
      }),
    [],
  )
  useFrame((state) => {
    mat.uniforms.uTime.value = state.clock.elapsedTime
  })
  return (
    <mesh material={mat} position={[0, 52, 292]}>
      <planeGeometry args={[430, 260]} />
    </mesh>
  )
}

// ---------------------------------------------------------------------------
// Ringed planet — banded gas giant with a key-agreeing terminator, fresnel
// limb glow, and a textured ring disc carrying the planet's shadow band.
// ---------------------------------------------------------------------------
const PLANET_R = 40

/** 512² radial ring texture: concentric bands with varying alpha + a
 *  Cassini-like division, fading to zero at the inner edge. */
function makeRingTexture(): THREE.CanvasTexture {
  const size = 512
  const c = document.createElement('canvas')
  c.width = c.height = size
  const ctx = c.getContext('2d')!
  const cx = size / 2
  ctx.clearRect(0, 0, size, size)
  ctx.strokeStyle = '#fff'
  const rInner = 118 // px — fades in from here (≈1.15 × planet radius on the plane)
  const rOuter = 250
  for (let r = rInner; r < rOuter; r++) {
    // band structure: slow sinusoid + fine ripple + occasional gaps
    let a = 0.28 + 0.4 * Math.abs(Math.sin(r * 0.11)) + 0.14 * Math.sin(r * 0.53)
    if (r > 186 && r < 199) a *= 0.08 // division gap
    if (r > 232 && r < 238) a *= 0.25
    // inner-edge fade so the ring melts into the atmosphere glow
    a *= THREE.MathUtils.smoothstep(r, rInner, rInner + 26)
    // outer-edge fade
    a *= 1 - THREE.MathUtils.smoothstep(r, rOuter - 16, rOuter)
    if (a <= 0.01) continue
    ctx.globalAlpha = Math.min(1, a)
    ctx.lineWidth = 1.6
    ctx.beginPath()
    ctx.arc(cx, cx, r, 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.globalAlpha = 1
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.NoColorSpace
  tex.anisotropy = 8
  tex.minFilter = THREE.LinearMipmapLinearFilter
  tex.generateMipmaps = true
  return tex
}

function RingedPlanet() {
  const planetMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          // world-space direction toward the key light — the SAME vector the
          // directional rig uses, so sky and level agree
          uSun: { value: KEY_DIR.clone() },
        },
        vertexShader: /* glsl */ `
          varying vec3 vWorldN;
          varying vec3 vViewDir;
          void main() {
            vWorldN = normalize(mat3(modelMatrix) * normal);
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            vViewDir = normalize(-mv.xyz);
            gl_Position = projectionMatrix * mv;
          }
        `,
        fragmentShader: /* glsl */ `
          varying vec3 vWorldN;
          varying vec3 vViewDir;
          uniform vec3 uSun;
          float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
          float noise(vec2 p) {
            vec2 i = floor(p), f = fract(p);
            vec2 u = f * f * (3.0 - 2.0 * f);
            return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x),
                       mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
          }
          float fbm(vec2 p) {
            float v = 0.0, a = 0.5;
            for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.3; a *= 0.5; }
            return v;
          }
          void main() {
            vec3 n = normalize(vWorldN);
            // --- banded gas-giant albedo (latitude + fbm warp) ---
            float lat = n.y;
            float warp = fbm(vec2(lat * 3.0, atan(n.z, n.x) * 1.2)) - 0.5;
            float bands = fbm(vec2(lat * 7.0 + warp * 1.6, warp * 2.0));
            float fine = fbm(vec2(lat * 26.0 + warp * 4.0, warp * 6.0));
            vec3 bandDark = vec3(0.075, 0.095, 0.19);
            vec3 bandLight = vec3(0.24, 0.30, 0.52);
            vec3 bandViolet = vec3(0.30, 0.22, 0.52);
            vec3 alb = mix(bandDark, bandLight, smoothstep(0.25, 0.75, bands));
            alb = mix(alb, bandViolet, smoothstep(0.6, 0.95, sin(lat * 9.0 + warp * 3.0)) * 0.35);
            alb *= 0.88 + 0.24 * fine; // fine banding detail
            alb = mix(alb, bandDark * 0.7, smoothstep(0.55, 0.95, abs(lat)));
            // --- terminator from the level's key vector ---
            float d = dot(n, uSun);
            float day = smoothstep(-0.12, 0.42, d); // tight, smoothstepped
            vec3 nightCol = vec3(0.028, 0.034, 0.062);
            vec3 col = mix(nightCol, alb * 1.2, day);
            // warm scatter right at the terminator
            col += vec3(0.42, 0.28, 0.18) * exp(-pow((d - 0.05) * 7.0, 2.0)) * 0.5;
            // --- atmosphere rim glow (fresnel), stronger on the lit side ---
            float fres = pow(1.0 - max(dot(n, normalize(vViewDir)), 0.0), 3.0);
            vec3 rimCol = vec3(0.42, 0.58, 0.95);
            col += rimCol * fres * (0.14 + 0.86 * day) * 1.45;
            col += rimCol * 0.07 * fres * (1.0 - day);
            gl_FragColor = vec4(col * 0.72, 1.0);
          }
        `,
        fog: false,
      }),
    [],
  )

  const ringMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uMap: { value: makeRingTexture() },
          uSun: { value: KEY_DIR.clone() },
          uRadius: { value: PLANET_R },
          uTint: { value: new THREE.Color('#8E9CCF') },
        },
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          varying vec3 vRel;   // world offset from the planet centre
          void main() {
            vUv = uv;
            vec3 originW = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
            vRel = (modelMatrix * vec4(position, 1.0)).xyz - originW;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          varying vec2 vUv;
          varying vec3 vRel;
          uniform sampler2D uMap;
          uniform vec3 uSun;
          uniform float uRadius;
          uniform vec3 uTint;
          void main() {
            float a = texture2D(uMap, vUv).r;
            if (a <= 0.002) discard;
            // cylindrical shadow cast by the planet along the key vector
            float along = dot(vRel, uSun);
            float perp = length(vRel - uSun * along);
            float shadow = 1.0;
            if (along < 0.0) {
              shadow = mix(0.22, 1.0, smoothstep(uRadius * 0.9, uRadius * 1.25, perp));
            }
            vec3 col = uTint * (0.55 + 0.45 * shadow) * shadow;
            gl_FragColor = vec4(col, a * (0.35 + 0.65 * shadow));
          }
        `,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        fog: false,
      }),
    [],
  )

  // Dead ahead down +Z, elevated ~19° above the camera — the DROPSHIP intro
  // camera frames it centre as the establishing shot. The celestial group
  // follows the camera position, so these are camera-relative offsets.
  return (
    <group position={[0, 84, 265]}>
      <mesh material={planetMat}>
        <sphereGeometry args={[PLANET_R, 48, 32]} />
      </mesh>
      {/* ring plane: nearly horizontal, tilted slightly toward the camera and
          rolled 0.12 — intersects the sphere so depth handles occlusion */}
      <mesh material={ringMat} rotation={[Math.PI / 2 - 0.1, 0, 0.12]}>
        <planeGeometry args={[230, 230]} />
      </mesh>
    </group>
  )
}

// ---------------------------------------------------------------------------
// Void glow — soft indigo gradient far below, so falls read "into the glow"
// ---------------------------------------------------------------------------
function VoidGlow() {
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main() {
            vUv = uv * 2.0 - 1.0;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          varying vec2 vUv;
          void main() {
            float r = length(vUv);
            float glow = pow(max(0.0, 1.0 - r), 1.6);
            vec3 col = mix(vec3(0.04, 0.05, 0.12), vec3(0.19, 0.26, 0.5), glow);
            gl_FragColor = vec4(col, glow * 0.6);
          }
        `,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
      }),
    [],
  )
  // hotter core slab directly under the canyon decks/bridge so gaps read as
  // a glowing drop into depth, not a black pit (same additive shader)
  return (
    <group>
      <mesh material={mat} position={[0, -14.5, 130]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[700, 700]} />
      </mesh>
      <mesh material={mat} position={[0, -13.2, 130]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[90, 290]} />
      </mesh>
    </group>
  )
}

const FAR_TINT: [number, number, number] = [0.82, 0.88, 1.0]
const NEAR_TINT: [number, number, number] = [1.0, 0.93, 0.86]

export default function Skybox() {
  const group = useRef<THREE.Group>(null!)
  const parallax = useRef<THREE.Group>(null!)
  const dome = useMemo(
    () => new THREE.Mesh(new THREE.SphereGeometry(DOME_R, 32, 20), domeMaterial()),
    [],
  )

  useFrame((state) => {
    // far stratum locked to the camera (renders within far=400)
    group.current.position.copy(state.camera.position)
    // near stratum lags by PARALLAX, so the backdrop slides as the player runs
    parallax.current.position.copy(state.camera.position).multiplyScalar(1 - PARALLAX)
  })

  return (
    <group>
      <color attach="background" args={[COLORS.cosmicIndigo]} />
      <group ref={group}>
        <primitive object={dome} />
        <Stars count={FOG.starCount} radius={DOME_R * 0.93} sizeScale={1} tint={FAR_TINT} />
        <RingedPlanet />
      </group>
      <group ref={parallax}>
        <Stars count={Math.round(FOG.starCount * 0.22)} radius={DOME_R * 0.78} sizeScale={1.9} tint={NEAR_TINT} />
        <NebulaShelf />
      </group>
      <VoidGlow />
    </group>
  )
}

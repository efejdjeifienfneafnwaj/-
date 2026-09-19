/**
 * AURIC VOW — world/Skybox.tsx
 * design.md §2.6 + environment.md §3: gradient dome shader (#0A0D1F zenith →
 * #16224A horizon, faint fbm nebula band), 2000-star twinkling field, and a
 * giant ringed-planet silhouette low over the east void — the establishing
 * shot through the canyon glass. Also the indigo void-glow plane far below.
 *
 * The dome group follows the camera (radius 300 < camera far 400) so stars /
 * planet read as infinitely distant.
 */
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { COLORS, FOG } from '../config'

const DOME_R = 300

// ---------------------------------------------------------------------------
// Gradient dome
// ---------------------------------------------------------------------------
const domeMaterial = () =>
  new THREE.ShaderMaterial({
    uniforms: {
      uZenith: { value: new THREE.Color(FOG.skyZenith) },
      uHorizon: { value: new THREE.Color(FOG.skyHorizon) },
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
        // saturated indigo/violet nebula bands, ~2.5× the original contrast
        float band = exp(-pow((d.y - 0.18 - d.x * 0.12) * 3.0, 2.0));
        float band2 = exp(-pow((d.y + 0.28 + d.x * 0.10) * 2.6, 2.0));
        float n = pow(fbm(d.xz * 4.0 + d.y * 3.0), 1.35);
        float n2 = fbm(d.zx * 7.0 - d.y * 5.0);
        vec3 indigo = vec3(0.13, 0.10, 0.46);
        vec3 violet = vec3(0.32, 0.13, 0.58);
        col += (indigo * band * (0.35 + 1.3 * n) + violet * band2 * n2 * 0.9) * 1.7;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  })

// ---------------------------------------------------------------------------
// Starfield — 2000 points, additive, 10% twinkle amplitude
// ---------------------------------------------------------------------------
function Stars() {
  const { geom, mat } = useMemo(() => {
    const pos = new Float32Array(FOG.starCount * 3)
    const phase = new Float32Array(FOG.starCount)
    const size = new Float32Array(FOG.starCount)
    for (let i = 0; i < FOG.starCount; i++) {
      // random direction on the dome interior
      const u = Math.random()
      const v = Math.random()
      const theta = 2 * Math.PI * u
      const phi = Math.acos(2 * v - 1)
      const r = DOME_R * 0.93
      pos[i * 3] = r * Math.sin(phi) * Math.cos(theta)
      pos[i * 3 + 1] = r * Math.cos(phi)
      pos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta)
      phase[i] = Math.random() * Math.PI * 2
      size[i] = 1 + Math.random() * 2
    }
    const geom = new THREE.BufferGeometry()
    geom.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    geom.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1))
    geom.setAttribute('aSize', new THREE.BufferAttribute(size, 1))
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
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
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.08, d);
          gl_FragColor = vec4(vec3(0.82, 0.88, 1.0) * vTw, a);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    })
    return { geom, mat }
  }, [])

  useFrame((state) => {
    mat.uniforms.uTime.value = state.clock.elapsedTime
  })

  return <points geometry={geom} material={mat} frustumCulled={false} />
}

// ---------------------------------------------------------------------------
// Ringed planet (fix2 rebuild) — real sphere with banded Lambert-style ramp
// shading (lit limb vs dark side) + fresnel atmosphere rim glow, and a
// separate tilted ring plane with a radial canvas texture (varying-alpha
// bands, faded inner edge). Opaque sphere writes depth, so the ring plane
// correctly passes behind the body. No more clip-art ellipse.
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
  tex.anisotropy = 4
  return tex
}

function RingedPlanet() {
  const planetMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          // view-space light: from camera upper-left, slightly toward camera,
          // so the lit limb is consistent as the dome group follows the camera
          uLightDir: { value: new THREE.Vector3(-0.55, 0.3, 0.75).normalize() },
        },
        vertexShader: /* glsl */ `
          varying vec3 vViewN;  // view-space normal (lighting + fresnel)
          varying vec3 vObjN;   // object-space normal (latitude bands)
          varying vec3 vViewDir;
          void main() {
            vObjN = normalize(normal);
            vViewN = normalize(normalMatrix * normal);
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            vViewDir = normalize(-mv.xyz);
            gl_Position = projectionMatrix * mv;
          }
        `,
        fragmentShader: /* glsl */ `
          varying vec3 vViewN;
          varying vec3 vObjN;
          varying vec3 vViewDir;
          uniform vec3 uLightDir;
          float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
          float noise(vec2 p) {
            vec2 i = floor(p), f = fract(p);
            vec2 u = f * f * (3.0 - 2.0 * f);
            return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x),
                       mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
          }
          float fbm(vec2 p) {
            float v = 0.0, a = 0.5;
            for (int i = 0; i < 3; i++) { v += a * noise(p); p *= 2.3; a *= 0.5; }
            return v;
          }
          void main() {
            vec3 n = normalize(vViewN);
            vec3 on = normalize(vObjN);
            // --- banded gas-giant albedo (latitude + fbm warp) ---
            float lat = on.y;
            float warp = fbm(vec2(lat * 3.0, atan(on.z, on.x) * 1.2)) - 0.5;
            float bands = fbm(vec2(lat * 7.0 + warp * 1.6, warp * 2.0));
            vec3 bandDark = vec3(0.075, 0.095, 0.19);   // deep indigo belts
            vec3 bandLight = vec3(0.24, 0.30, 0.52);    // pale indigo zones
            vec3 bandViolet = vec3(0.30, 0.22, 0.52);   // violet accent band
            vec3 alb = mix(bandDark, bandLight, smoothstep(0.25, 0.75, bands));
            alb = mix(alb, bandViolet, smoothstep(0.6, 0.95, sin(lat * 9.0 + warp * 3.0)) * 0.35);
            // polar darkening
            alb = mix(alb, bandDark * 0.7, smoothstep(0.55, 0.95, abs(lat)));
            // --- Lambert-style ramp: soft terminator, lit limb vs dark side ---
            float d = dot(n, uLightDir);
            float day = smoothstep(-0.25, 0.7, d); // soft terminator
            vec3 nightCol = vec3(0.035, 0.042, 0.075); // dark side, faint blue
            vec3 col = mix(nightCol, alb * 1.25, day);
            // lit-limb warm tint near the day edge
            float limb = pow(1.0 - abs(dot(n, normalize(vViewDir))), 2.0);
            col += vec3(0.36, 0.42, 0.72) * limb * day * 0.5;
            // --- atmosphere rim glow (fresnel), stronger on the lit side ---
            float fres = pow(1.0 - max(dot(n, normalize(vViewDir)), 0.0), 3.0);
            vec3 rimCol = vec3(0.42, 0.58, 0.95);
            col += rimCol * fres * (0.18 + 0.82 * day) * 1.5;
            // faint night-side rim so the dark limb never merges with the void
            col += rimCol * 0.08 * fres * (1.0 - day);
            gl_FragColor = vec4(col, 1.0);
          }
        `,
        fog: false,
      }),
    [],
  )
  const ringMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        map: makeRingTexture(),
        color: '#8E9CCF',
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        fog: false,
      }),
    [],
  )
  // Dead ahead down +Z, elevated ~19° above the camera — the DROPSHIP intro
  // camera (starts 22 m above / 26 m behind the spawn dais, sweeping its
  // pitch up toward horizontal while looking down-canyon +Z) frames it
  // center as the establishing shot. The celestial group follows the camera
  // position, so these are camera-relative offsets (~280 m out, inside the
  // 300 m dome, within the 400 m far plane).
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
            vec3 col = mix(vec3(0.05, 0.06, 0.14), vec3(0.22, 0.30, 0.58), glow);
            gl_FragColor = vec4(col, glow * 0.95);
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

export default function Skybox() {
  const group = useRef<THREE.Group>(null!)
  const dome = useMemo(
    () => new THREE.Mesh(new THREE.SphereGeometry(DOME_R, 32, 20), domeMaterial()),
    [],
  )

  useFrame((state) => {
    // keep the celestial shell centered on the camera (renders within far=400)
    group.current.position.copy(state.camera.position)
  })

  return (
    <group>
      <color attach="background" args={[COLORS.cosmicIndigo]} />
      <group ref={group}>
        <primitive object={dome} />
        <Stars />
        <RingedPlanet />
      </group>
      <VoidGlow />
    </group>
  )
}

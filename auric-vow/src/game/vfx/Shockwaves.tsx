/**
 * AURIC VOW — Shockwaves.tsx
 * Pooled expanding ring/disc shader meshes (vfx-hud.md §1.1 Ring primitive).
 *
 * [vfx R1] Two register bugs fixed and the profile re-authored:
 *   V8 — the ring was hardcoded flat on XZ, so wall and mid-air impacts got a
 *        floor disc floating in space. `RingOpts.normal` now orients the disc
 *        against the surface it was spawned on (default +Y = ground wave).
 *   V9 — `uWidth` was normalised against the disc radius, so the two biggest
 *        rings (1.2 and 0.6) degraded into filled pancakes. Width is now
 *        METRES and converted per-spawn, so a 0.25 m edge stays 0.25 m at any
 *        radius.
 *
 * Profile: a gaussian band with a hot leading edge and a trailing ripple at
 * 0.62× radius, HDR-boosted at the core so only the edge crosses the bloom
 * knee. That is the difference between "an expanding white circle" and a
 * pressure wave.
 *
 * [vfx R3] This file also owns the PRESSURE SHELL pool (V4): expanding
 * screen-space refraction spheres that displace the already-rendered frame
 * behind them. Every ring in the game is now paired with an optional bend, so
 * a detonation stops being light drawn over static architecture and starts
 * being an event the architecture is inside of.
 */
import { useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useGameStore } from '../store'
import { getGlyphSpriteTexture } from '../textures'
import { drainRings, drainDecals, drainDistorts, type RingCmd, type DecalCmd, type DistortCmd } from './VFXBus'
import { RefractionShell } from './EnergyShell'

// 6 → 10: a Sunspike Volley can pop 7 impact rings in one frame on top of
// the Requiem nova + afterglow rings and Aegis ripples (fix1).
const MAX_RINGS = 10
/** [vfx R2] persistent surface marks — see the DECALS section below */
const MAX_DECALS = 12

/**
 * [vfx R5] SCREEN-SIZE FLOOR — the same measured problem as the spark floor
 * in Particles.tsx and the flash floor in Flashes.tsx.
 *
 * An impact ring is authored at COMBATFX.impact.ringRadius = 0.5 m. The
 * review's combat frames were captured at 20-25 m of engagement range, and
 * 0.5 m at 25 m through a 70 degree lens at 720p is a TEN PIXEL disc whose
 * visible band is a fraction of that. The panel is right that no impact VFX
 * appears anywhere; the events are firing and are simply too small to see.
 *
 * Rings therefore hold a minimum apparent radius, capped at a multiple of
 * their authored size so the floor can only ever rescue a small ring and
 * never inflate a shockwave into the architecture.
 */
const RING_MIN_PX = 22
const RING_MAX_GROWTH = 2.6

/** CircleGeometry faces +Z; every orientation is measured from there. */
const PLANE_NORMAL = new THREE.Vector3(0, 0, 1)

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`
const FRAG = /* glsl */ `
uniform float uT;
uniform vec3 uColor;
uniform vec3 uCore;
uniform float uWidth;
uniform float uGain;
uniform float uGlyph;
uniform sampler2D uGlyphTex;
varying vec2 vUv;
void main() {
  vec2 c = vUv * 2.0 - 1.0;
  float r = length(c);
  if (r > 1.0) discard;
  // expanding front, eased outward
  float e = 1.0 - (1.0 - uT) * (1.0 - uT);
  float w = max(uWidth, 2e-3);

  // main band: gaussian across the width, biased so the OUTER side is the
  // hot leading edge and the inner side trails off
  float x = (r - e) / w;
  float lead = exp(-x * x * 2.4);
  float hot = exp(-max(x, 0.0) * max(x, 0.0) * 9.0);

  // trailing ripple at 0.62× the front radius, a third of the energy
  float x2 = (r - e * 0.62) / (w * 1.7);
  float ripple = exp(-x2 * x2 * 2.0) * 0.32;

  float shape = lead + ripple;
  float alpha = shape * (1.0 - uT) * (1.0 - uT);
  if (uGlyph > 0.5) {
    vec4 g = texture2D(uGlyphTex, vUv);
    alpha *= g.r;
  }
  if (alpha < 0.004) discard;
  // colour ramp across the band width: saturated body, hot leading filament
  vec3 col = mix(uColor, uCore, clamp(hot, 0.0, 1.0));
  // the filament is the only part authored above the bloom knee
  col *= 1.0 + hot * 1.9;
  // [vfx R4] per-spawn master gain — see RingOpts.intensity
  gl_FragColor = vec4(col * uGain, alpha * uGain);
}
`

class RingWave {
  readonly mesh: THREE.Mesh
  readonly material: THREE.ShaderMaterial
  active = false
  age = 0
  life = 0.5
  maxRadius = 2

  constructor(glyphTex: THREE.Texture) {
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uT: { value: 0 },
        uColor: { value: new THREE.Color(1, 1, 1) },
        uCore: { value: new THREE.Color('#FFF3D6') },
        uWidth: { value: 0.08 },
        uGain: { value: 1 },
        uGlyph: { value: 0 },
        uGlyphTex: { value: glyphTex },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    })
    this.mesh = new THREE.Mesh(sharedGeo, this.material)
    this.mesh.visible = false
    this.mesh.renderOrder = 19
    this.mesh.frustumCulled = false
  }

  spawn(cmd: RingCmd): void {
    this.active = true
    this.age = 0
    this.life = Math.max(0.05, cmd.life)
    this.maxRadius = Math.max(0.001, cmd.maxRadius)

    // orient against the spawning surface, then lift off it slightly so the
    // disc never z-fights the geometry it was born on
    _n.set(cmd.nx, cmd.ny, cmd.nz)
    if (_n.lengthSq() < 1e-8) _n.set(0, 1, 0)
    _n.normalize()
    this.mesh.quaternion.setFromUnitVectors(PLANE_NORMAL, _n)
    this.mesh.position.set(cmd.x, cmd.y, cmd.z).addScaledVector(_n, 0.06)
    ;(this.material.uniforms.uColor!.value as THREE.Color).set(cmd.color)
    // width is METRES; the shader works in disc-normalised radius
    this.material.uniforms.uWidth!.value = THREE.MathUtils.clamp(
      cmd.width / this.maxRadius,
      0.012,
      0.34,
    )
    this.material.uniforms.uGain!.value = cmd.intensity
    this.material.uniforms.uGlyph!.value = 0
    this.mesh.visible = true
  }

  update(dt: number, minRadius: number): void {
    if (!this.active) return
    this.age += dt
    const t = this.age / this.life
    if (t >= 1) {
      this.active = false
      this.mesh.visible = false
      return
    }
    this.material.uniforms.uT!.value = t
    // hold a minimum apparent size, but never grow past RING_MAX_GROWTH so a
    // 0.5 m impact ring can be rescued and a 30 m nova front cannot be moved
    const s = Math.min(this.maxRadius * RING_MAX_GROWTH, Math.max(this.maxRadius, minRadius))
    this.mesh.scale.set(s, s, s)
  }
}

const sharedGeo = new THREE.CircleGeometry(1, 64)
const _n = new THREE.Vector3()
const drainBuffer: RingCmd[] = []

// ---------------------------------------------------------------------------
// [vfx R2] DECALS (V19) — the world remembers being hit
//
// Every impact in the game was transient: a puff, a ring, a flash, all gone
// inside a fifth of a second. Nothing accumulated, so a fought-over deck looked
// exactly like an untouched one and the level read as a showroom.
//
// A decal is one surface-aligned quad drawn with PREMULTIPLIED alpha
// (src = ONE, dst = ONE_MINUS_SRC_ALPHA), which is what lets a single draw
// both DARKEN the surface (soot, via the alpha channel) and ADD to it (the
// cooling energy burn, via the colour channel). A separate additive pass plus
// a separate multiply pass would cost two draws and could not cross-fade.
//
// The burn cools fast (0.35 s) and the soot holds for the decal's full life,
// so the mark goes hot → glowing → sooty stain exactly as a real scorch does.
// ---------------------------------------------------------------------------

let scorchTex: THREE.CanvasTexture | null = null

/** irregular burn mask: dense core, ragged edge, a few thrown spatter dots */
function getScorchTexture(): THREE.CanvasTexture {
  if (scorchTex) return scorchTex
  const S = 256
  const c = document.createElement('canvas')
  c.width = S
  c.height = S
  const ctx = c.getContext('2d')!
  let seed = 0x1f35c7 >>> 0
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 0xffffffff
  }
  const blob = (cx: number, cy: number, r: number, a: number) => {
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r)
    g.addColorStop(0, `rgba(255,255,255,${a})`)
    g.addColorStop(0.55, `rgba(255,255,255,${a * 0.55})`)
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.fill()
  }
  // core
  blob(S / 2, S / 2, S * 0.34, 0.95)
  // ragged lobes so the mark is never a clean disc
  for (let i = 0; i < 14; i++) {
    const a = rand() * Math.PI * 2
    const d = S * (0.1 + rand() * 0.22)
    blob(S / 2 + Math.cos(a) * d, S / 2 + Math.sin(a) * d, S * (0.07 + rand() * 0.14), 0.5)
  }
  // thrown spatter
  for (let i = 0; i < 18; i++) {
    const a = rand() * Math.PI * 2
    const d = S * (0.3 + rand() * 0.17)
    blob(S / 2 + Math.cos(a) * d, S / 2 + Math.sin(a) * d, S * (0.015 + rand() * 0.035), 0.42)
  }
  // bite holes so the centre is not a solid pad
  ctx.globalCompositeOperation = 'destination-out'
  for (let i = 0; i < 9; i++) {
    const a = rand() * Math.PI * 2
    const d = S * rand() * 0.28
    blob(S / 2 + Math.cos(a) * d, S / 2 + Math.sin(a) * d, S * (0.03 + rand() * 0.07), 0.55)
  }
  ctx.globalCompositeOperation = 'source-over'
  scorchTex = new THREE.CanvasTexture(c)
  scorchTex.colorSpace = THREE.SRGBColorSpace
  return scorchTex
}

const DECAL_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`
const DECAL_FRAG = /* glsl */ `
uniform sampler2D uMask;
uniform vec3 uColor;
uniform float uSoot;
uniform float uBurn;
varying vec2 vUv;
void main() {
  float m = texture2D(uMask, vUv).a;
  if (m < 0.004) discard;
  // radial hardening: the centre of a burn is darker and hotter than its rim
  vec2 c = vUv * 2.0 - 1.0;
  float rr = clamp(1.0 - dot(c, c), 0.0, 1.0);
  float soot = m * uSoot * (0.35 + 0.65 * rr);
  float hot = pow(m, 2.2) * rr;
  // premultiplied output: rgb ADDS (the cooling burn), a DARKENS (the soot)
  vec3 burn = uColor * hot * uBurn;
  gl_FragColor = vec4(burn, clamp(soot, 0.0, 1.0));
}
`

class Decal {
  readonly mesh: THREE.Mesh
  readonly material: THREE.ShaderMaterial
  active = false
  age = 0
  life = 4
  /** authored peak values, re-applied through the fade curves each frame */
  private soot = 0.85
  private burn = 2.2

  constructor(mask: THREE.Texture) {
    this.material = new THREE.ShaderMaterial({
      vertexShader: DECAL_VERT,
      fragmentShader: DECAL_FRAG,
      uniforms: {
        uMask: { value: mask },
        uColor: { value: new THREE.Color(1, 1, 1) },
        uSoot: { value: 0.8 },
        uBurn: { value: 1 },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      toneMapped: false,
    })
    this.mesh = new THREE.Mesh(decalGeo, this.material)
    this.mesh.visible = false
    // under every additive VFX but over the surface it is burnt into
    this.mesh.renderOrder = 17
    this.mesh.frustumCulled = false
  }

  spawn(cmd: DecalCmd): void {
    this.active = true
    this.age = 0
    this.life = Math.max(0.3, cmd.life)
    _n.set(cmd.nx, cmd.ny, cmd.nz)
    if (_n.lengthSq() < 1e-8) _n.set(0, 1, 0)
    _n.normalize()
    this.mesh.quaternion.setFromUnitVectors(PLANE_NORMAL, _n)
    // random roll so repeated hits on one wall are not the same stamp
    this.mesh.rotateZ(Math.random() * Math.PI * 2)
    this.mesh.position.set(cmd.x, cmd.y, cmd.z).addScaledVector(_n, 0.022)
    const sc = Math.max(0.05, cmd.size)
    this.mesh.scale.set(sc, sc, sc)
    ;(this.material.uniforms.uColor!.value as THREE.Color).set(cmd.color)
    this.soot = 0.85 * (1 - 0.4 * cmd.energy)
    this.burn = 2.2 * cmd.energy
    this.material.uniforms.uSoot!.value = this.soot
    this.material.uniforms.uBurn!.value = this.burn
    this.mesh.visible = true
  }

  update(dt: number): void {
    if (!this.active) return
    this.age += dt
    const t = this.age / this.life
    if (t >= 1) {
      this.active = false
      this.mesh.visible = false
      return
    }
    // the burn cools in the first third of a second; the stain outlives it
    const burnFade = Math.max(0, 1 - this.age / 0.35)
    this.material.uniforms.uBurn!.value = this.burn * burnFade * burnFade
    this.material.uniforms.uSoot!.value = this.soot * (1 - t * t)
  }
}

const decalGeo = new THREE.PlaneGeometry(1, 1)
const decalBuffer: DecalCmd[] = []

// ---------------------------------------------------------------------------
// [vfx R3] PRESSURE SHELLS (V4) — the frame bends
//
// Four pooled RefractionShells. Each is an expanding sphere that samples the
// already-rasterised frame and displaces it along the surface normal, hardest
// at the silhouette, with a per-channel split and a compression band on the
// leading face. That is the element the work order calls "a distortion or
// pressure element", and the build had exactly none of it.
//
// The shell expands on an ease-OUT radius (fast front, decelerating) while
// the displacement falls on an ease-IN curve, so the bend is violent at the
// instant of the detonation and gone well before the shell reaches its
// maximum radius — the same asymmetry a real blast front has.
// ---------------------------------------------------------------------------

const MAX_DISTORTS = 4
const distortGeo = new THREE.SphereGeometry(1, 32, 20)

class PressureShell {
  readonly shell: RefractionShell
  active = false
  age = 0
  life = 0.5
  maxRadius = 6
  strength = 0.022

  constructor() {
    this.shell = new RefractionShell({
      geometry: distortGeo,
      strength: 0.022,
      opacity: 1,
      rimPow: 2.4,
      compress: 0.35,
      renderOrder: 17,
    })
  }

  spawn(cmd: DistortCmd): void {
    this.active = true
    this.age = 0
    this.life = Math.max(0.08, cmd.life)
    this.maxRadius = Math.max(0.2, cmd.maxRadius)
    this.strength = cmd.strength
    this.shell.mesh.position.set(cmd.x, cmd.y, cmd.z)
    this.shell.material.uniforms.uCompress!.value = cmd.compress
    ;(this.shell.material.uniforms.uTint!.value as THREE.Color)
      .set(cmd.color)
      .multiplyScalar(0.22)
    this.shell.mesh.scale.setScalar(0.05 * this.maxRadius)
    this.shell.setStrength(cmd.strength)
    this.shell.setOpacity(1)
    this.shell.setVisible(true)
  }

  update(dt: number): void {
    if (!this.active) return
    this.age += dt
    const t = this.age / this.life
    if (t >= 1) {
      this.active = false
      this.shell.setVisible(false)
      return
    }
    // radius: ease-out (the front decelerates through the air)
    const r = this.maxRadius * (0.05 + 0.95 * (1 - (1 - t) * (1 - t) * (1 - t)))
    this.shell.mesh.scale.setScalar(r)
    // displacement: hardest at t=0, effectively gone by 60% of the life
    const k = Math.max(0, 1 - t / 0.62)
    this.shell.setStrength(this.strength * k * k)
    this.shell.setOpacity(Math.min(1, k * 1.4))
  }
}

const distortBuffer: DistortCmd[] = []



/** Pooled shockwave rings + persistent surface decals, drained from the bus. */
export default function Shockwaves() {
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)
  const waves = useMemo(() => {
    const tex = getGlyphSpriteTexture()
    return Array.from({ length: MAX_RINGS }, () => new RingWave(tex))
  }, [])
  const decals = useMemo(() => {
    const tex = getScorchTexture()
    return Array.from({ length: MAX_DECALS }, () => new Decal(tex))
  }, [])
  const pressures = useMemo(
    () => Array.from({ length: MAX_DISTORTS }, () => new PressureShell()),
    [],
  )

  useFrame((_, delta) => {
    const ts = useGameStore.getState().timeScale
    const dt = Math.min(delta, 0.1) * ts
    // decals outlive hitstop and slow-mo by design: a scorch is not an
    // animation, it is a state of the surface, so it ages on the wall clock
    const realDt = Math.min(delta, 0.1)

    drainRings(drainBuffer)
    for (let i = 0; i < drainBuffer.length; i++) {
      const cmd = drainBuffer[i]
      const w = waves.find((v) => !v.active) ?? waves.reduce((a, b) => (a.age / a.life > b.age / b.life ? a : b))
      w.spawn(cmd)
    }
    drainBuffer.length = 0

    drainDecals(decalBuffer)
    for (let i = 0; i < decalBuffer.length; i++) {
      // recycle the OLDEST mark when the pool is full — a fresh hit always
      // wins over a stain that is already most of the way faded out
      const d =
        decals.find((v) => !v.active) ??
        decals.reduce((a, b) => (a.age / a.life > b.age / b.life ? a : b))
      d.spawn(decalBuffer[i])
    }
    decalBuffer.length = 0

    drainDistorts(distortBuffer)
    for (let i = 0; i < distortBuffer.length; i++) {
      const pr =
        pressures.find((v) => !v.active) ??
        pressures.reduce((a, b) => (a.age / a.life > b.age / b.life ? a : b))
      pr.spawn(distortBuffer[i])
    }
    distortBuffer.length = 0

    // metres of world size per pixel of screen height, per metre of distance
    const persp = camera as THREE.PerspectiveCamera
    const pxToMetres =
      persp.isPerspectiveCamera === true && size.height > 0
        ? (2 * Math.tan(THREE.MathUtils.degToRad(persp.fov) / 2)) / size.height
        : 1 / 720
    for (const w of waves) {
      if (!w.active) continue
      const camD = camera.position.distanceTo(w.mesh.position)
      w.update(dt, RING_MIN_PX * pxToMetres * camD)
    }
    for (const d of decals) d.update(realDt)
    for (const pr of pressures) pr.update(dt)
  })

  return (
    <group name="vfx-shockwaves">
      {waves.map((w, i) => (
        <primitive key={i} object={w.mesh} />
      ))}
      {decals.map((d, i) => (
        <primitive key={`d${i}`} object={d.mesh} />
      ))}
      {pressures.map((p, i) => (
        <primitive key={`p${i}`} object={p.shell.mesh} />
      ))}
    </group>
  )
}

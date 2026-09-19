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
 */
import { useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useGameStore } from '../store'
import { getGlyphSpriteTexture } from '../textures'
import { drainRings, type RingCmd } from './VFXBus'

// 6 → 10: a Sunspike Volley can pop 7 impact rings in one frame on top of
// the Requiem nova + afterglow rings and Aegis ripples (fix1).
const MAX_RINGS = 10

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
  gl_FragColor = vec4(col, alpha);
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
    this.material.uniforms.uGlyph!.value = 0
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
    this.material.uniforms.uT!.value = t
    const s = this.maxRadius
    this.mesh.scale.set(s, s, s)
  }
}

const sharedGeo = new THREE.CircleGeometry(1, 64)
const _n = new THREE.Vector3()
const drainBuffer: RingCmd[] = []

/** Pooled shockwave rings, drained from the VFX bus. */
export default function Shockwaves() {
  const waves = useMemo(() => {
    const tex = getGlyphSpriteTexture()
    return Array.from({ length: MAX_RINGS }, () => new RingWave(tex))
  }, [])

  useFrame((_, delta) => {
    const ts = useGameStore.getState().timeScale
    const dt = Math.min(delta, 0.1) * ts

    drainRings(drainBuffer)
    for (let i = 0; i < drainBuffer.length; i++) {
      const cmd = drainBuffer[i]
      const w = waves.find((v) => !v.active) ?? waves.reduce((a, b) => (a.age / a.life > b.age / b.life ? a : b))
      w.spawn(cmd)
    }
    drainBuffer.length = 0

    for (const w of waves) w.update(dt)
  })

  return (
    <group name="vfx-shockwaves">
      {waves.map((w, i) => (
        <primitive key={i} object={w.mesh} />
      ))}
    </group>
  )
}

/**
 * AURIC VOW — Shockwaves.tsx
 * Pooled expanding ring/disc shader meshes (vfx-hud.md §1.1 Ring primitive):
 * 6 concurrent, flat on XZ, radial expand via uT 0→1, alpha = (1−uT)².
 * Ring band is drawn procedurally in the fragment shader (uWidth controls
 * band thickness); uGlyph toggles the canvas glyph mask (used by the
 * extraction beacon / Auric Requiem recipes).
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
uniform float uWidth;
uniform float uGlyph;
uniform sampler2D uGlyphTex;
varying vec2 vUv;
void main() {
  vec2 c = vUv * 2.0 - 1.0;
  float r = length(c);
  if (r > 1.0) discard;
  // expanding band, eased outward
  float e = 1.0 - (1.0 - uT) * (1.0 - uT); // ease-out cubic-ish
  float band = 1.0 - abs(r - e) / max(uWidth, 1e-3);
  band = clamp(band, 0.0, 1.0);
  float alpha = band * (1.0 - uT) * (1.0 - uT);
  if (uGlyph > 0.5) {
    vec4 g = texture2D(uGlyphTex, vUv);
    alpha *= g.r;
  }
  if (alpha < 0.004) discard;
  // hot core at the band center
  vec3 col = mix(uColor, vec3(1.0, 0.95, 0.84), band * 0.45);
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
        uWidth: { value: 0.08 },
        uGlyph: { value: 0 },
        uGlyphTex: { value: glyphTex },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    })
    this.mesh = new THREE.Mesh(sharedGeo, this.material)
    this.mesh.rotation.x = -Math.PI / 2
    this.mesh.visible = false
    this.mesh.renderOrder = 19
    this.mesh.frustumCulled = false
  }

  spawn(cmd: RingCmd): void {
    this.active = true
    this.age = 0
    this.life = Math.max(0.05, cmd.life)
    this.maxRadius = cmd.maxRadius
    this.mesh.position.set(cmd.x, cmd.y + 0.06, cmd.z)
    ;(this.material.uniforms.uColor!.value as THREE.Color).set(cmd.color)
    this.material.uniforms.uWidth!.value = cmd.width
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
    const s = Math.max(0.001, this.maxRadius)
    this.mesh.scale.set(s, s, s)
  }
}

const sharedGeo = new THREE.CircleGeometry(1, 48)
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

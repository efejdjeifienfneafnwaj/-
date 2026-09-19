/**
 * AURIC VOW — Particles.tsx
 * Pooled GPU point particles (vfx-hud.md §1.1): 3 × THREE.Points pools by
 * color family (gold / teal / red), 1000 points each. Custom shader:
 * additive, distance-attenuated point size, per-particle color, life fade.
 *
 * CPU integrates motion into the position/life attributes each frame
 * (3000 particles ≈ trivial), GPU handles shape/fade. Zero runtime
 * allocation after construction.
 */
import { useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { COLORS } from '../config'
import { useGameStore } from '../store'
import { drainBursts, type BurstCmd } from './VFXBus'

// Raised 1000 → 1500 so ability-scale bursts (Requiem 120 + 40 embers,
// dash 114-spray, volley 7×30 impacts) never starve the pool (fix1).
const POOL_CAP = 1500

type Family = 'gold' | 'teal' | 'red'

const FAMILY_BASE: Record<Family, string> = {
  gold: COLORS.aureate,
  teal: COLORS.cadenceTeal,
  red: COLORS.emberRed,
}

const VERT = /* glsl */ `
attribute float aSize;
attribute float aLife;
attribute float aMaxLife;
attribute vec3 aColor;
uniform float uPixelScale;
varying float vAlpha;
varying vec3 vColor;
void main() {
  float t = aMaxLife > 0.0 ? clamp(aLife / aMaxLife, 0.0, 1.0) : 0.0;
  vAlpha = t * t;
  vColor = aColor * (0.6 + 0.4 * t);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float s = aSize * (0.55 + 0.45 * t);
  gl_PointSize = aLife > 0.0 ? s * uPixelScale / max(0.1, -mv.z) : 0.0;
  gl_Position = projectionMatrix * mv;
}
`

const FRAG = /* glsl */ `
varying float vAlpha;
varying vec3 vColor;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float disc = smoothstep(0.5, 0.05, d);
  float a = disc * vAlpha;
  if (a < 0.003) discard;
  gl_FragColor = vec4(vColor, a);
}
`

class ParticlePool {
  readonly points: THREE.Points
  private readonly cap = POOL_CAP
  private cursor = 0
  private readonly pos: Float32Array
  private readonly vel: Float32Array
  private readonly col: Float32Array
  private readonly size: Float32Array
  private readonly life: Float32Array
  private readonly maxLife: Float32Array
  private readonly grav: Float32Array
  private readonly posAttr: THREE.BufferAttribute
  private readonly lifeAttr: THREE.BufferAttribute
  private readonly colAttr: THREE.BufferAttribute
  private readonly sizeAttr: THREE.BufferAttribute
  private readonly maxLifeAttr: THREE.BufferAttribute
  readonly material: THREE.ShaderMaterial

  readonly family: Family

  constructor(family: Family) {
    this.family = family
    this.pos = new Float32Array(this.cap * 3)
    this.vel = new Float32Array(this.cap * 3)
    this.col = new Float32Array(this.cap * 3)
    this.size = new Float32Array(this.cap)
    this.life = new Float32Array(this.cap)
    this.maxLife = new Float32Array(this.cap)
    this.grav = new Float32Array(this.cap)

    const geo = new THREE.BufferGeometry()
    this.posAttr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage)
    this.lifeAttr = new THREE.BufferAttribute(this.life, 1).setUsage(THREE.DynamicDrawUsage)
    this.colAttr = new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage)
    this.sizeAttr = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage)
    this.maxLifeAttr = new THREE.BufferAttribute(this.maxLife, 1).setUsage(THREE.DynamicDrawUsage)
    geo.setAttribute('position', this.posAttr)
    geo.setAttribute('aLife', this.lifeAttr)
    geo.setAttribute('aMaxLife', this.maxLifeAttr)
    geo.setAttribute('aColor', this.colAttr)
    geo.setAttribute('aSize', this.sizeAttr)
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5) // never cull

    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uPixelScale: { value: 800 } },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
    })

    this.points = new THREE.Points(geo, this.material)
    this.points.frustumCulled = false
    this.points.renderOrder = 20

    // seed default family color so unused-but-alive slots still tint correctly
    const c = new THREE.Color(FAMILY_BASE[family])
    for (let i = 0; i < this.cap; i++) {
      this.col[i * 3] = c.r
      this.col[i * 3 + 1] = c.g
      this.col[i * 3 + 2] = c.b
    }
    this.colAttr.needsUpdate = true
  }

  /** true when this pool's family is the nearest match for the given hex */
  matches(hex: number): boolean {
    const r = ((hex >> 16) & 255) / 255
    const g = ((hex >> 8) & 255) / 255
    const b = (hex & 255) / 255
    // teal-ish → teal pool; red-ish → red pool; else gold
    if (g > r && b > r * 0.6) return this.family === 'teal'
    if (r > g * 1.4 && g < 0.45) return this.family === 'red'
    return this.family === 'gold'
  }

  spawn(cmd: BurstCmd): void {
    const color = new THREE.Color(cmd.color)
    const count = Math.min(cmd.count, this.cap)
    for (let n = 0; n < count; n++) {
      const i = this.cursor
      this.cursor = (this.cursor + 1) % this.cap
      const i3 = i * 3
      // uniform random sphere direction
      let dx = Math.random() * 2 - 1
      let dy = Math.random() * 2 - 1
      let dz = Math.random() * 2 - 1
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1
      dx /= len
      dy /= len
      dz /= len
      const spd = cmd.speed * (0.35 + Math.random() * 0.65)
      // swirled bursts spawn on a ring around the origin so the tangential
      // field reads as a vortex instead of a point puff
      const spawnR = cmd.swirl !== 0 ? 0.35 + Math.random() * 1.1 : 0.05
      const px = cmd.x + dx * spawnR
      const py = cmd.y + dy * 0.05
      const pz = cmd.z + dz * spawnR
      this.pos[i3] = px
      this.pos[i3 + 1] = py
      this.pos[i3 + 2] = pz
      let vx = dx * spd
      let vy = dy * spd
      let vz = dz * spd
      // swirl: tangential velocity field around the burst origin's Y axis.
      // tangent = normalize(cross(UP, radial)) — radial is the flat offset
      // from the origin to the spawn point. sign of cmd.swirl sets spin.
      if (cmd.swirl !== 0) {
        const rx = px - cmd.x
        const rz = pz - cmd.z
        const rl = Math.sqrt(rx * rx + rz * rz)
        // particles that spawned on the axis fall back to their radial dir
        const ux = rl > 1e-4 ? rx / rl : dx
        const uz = rl > 1e-4 ? rz / rl : dz
        const ts = cmd.swirl * (0.7 + Math.random() * 0.6)
        vx += -uz * ts
        vz += ux * ts
      }
      this.vel[i3] = vx
      this.vel[i3 + 1] = vy
      this.vel[i3 + 2] = vz
      this.col[i3] = color.r
      this.col[i3 + 1] = color.g
      this.col[i3 + 2] = color.b
      this.size[i] = cmd.size * (0.7 + Math.random() * 0.6)
      const lf = cmd.life * (0.6 + Math.random() * 0.4)
      this.life[i] = lf
      this.maxLife[i] = lf
      this.grav[i] = cmd.gravity
    }
    this.colAttr.needsUpdate = true
    this.sizeAttr.needsUpdate = true
    this.maxLifeAttr.needsUpdate = true
  }

  update(dt: number): void {
    if (dt <= 0) return
    const { pos, vel, life, grav, cap } = this
    let anyAlive = false
    for (let i = 0; i < cap; i++) {
      if (life[i] <= 0) continue
      anyAlive = true
      life[i] -= dt
      const i3 = i * 3
      vel[i3 + 1] -= grav[i] * dt
      pos[i3] += vel[i3] * dt
      pos[i3 + 1] += vel[i3 + 1] * dt
      pos[i3 + 2] += vel[i3 + 2] * dt
    }
    if (anyAlive) {
      this.posAttr.needsUpdate = true
      this.lifeAttr.needsUpdate = true
    }
  }
}

const drainBuffer: BurstCmd[] = []

/** 3 pooled Points systems (gold/teal/red), drained from the VFX bus. */
export default function Particles() {
  const pools = useMemo(
    () => [new ParticlePool('gold'), new ParticlePool('teal'), new ParticlePool('red')],
    [],
  )
  const size = useThree((s) => s.size)
  const camera = useThree((s) => s.camera)

  useFrame((_, delta) => {
    const ts = useGameStore.getState().timeScale
    const dt = Math.min(delta, 0.1) * ts

    // pixel scale for world-size point attenuation
    const persp = camera as THREE.PerspectiveCamera
    const px =
      persp.isPerspectiveCamera === true
        ? size.height / (2 * Math.tan(THREE.MathUtils.degToRad(persp.fov) / 2))
        : size.height
    for (const p of pools) p.material.uniforms.uPixelScale!.value = px

    drainBursts(drainBuffer)
    for (let i = 0; i < drainBuffer.length; i++) {
      const cmd = drainBuffer[i]
      const pool = pools.find((p) => p.matches(cmd.color)) ?? pools[0]
      pool.spawn(cmd)
    }
    drainBuffer.length = 0

    for (const p of pools) p.update(dt)
  })

  return (
    <group name="vfx-particles">
      {pools.map((p) => (
        <primitive key={p.family} object={p.points} />
      ))}
    </group>
  )
}

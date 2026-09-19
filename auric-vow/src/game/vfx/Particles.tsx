/**
 * AURIC VOW — Particles.tsx
 * Pooled GPU point particles (vfx-hud.md §1.1). CPU integrates motion into the
 * position/life attributes each frame, GPU handles shape/fade/streaking.
 * Zero runtime allocation after construction.
 *
 * [vfx R1] Rebuilt around three things the register called out:
 *   V3 — every particle now samples one of four tiles from the procedural
 *        atlas (spark / ember / smoke / debris) instead of one smoothstep blob.
 *   V7 — a dedicated NON-additive smoke pool (dark alpha mass, NormalBlending)
 *        so explosions have body and occlude what is behind them.
 *   V15 — birth ramp (no pop-in at full size), per-particle flicker, and drag
 *        so sparks decelerate instead of flying dead straight forever.
 *
 * [vfx R3] Three more, all aimed at the same tell — "these are sprites being
 * faded out", not material that was heated:
 *   • BLACKBODY COOLING. Colour is ramped across life, not just brightness:
 *     born clipped toward white (above the bloom knee, so every spark has a
 *     hot head), through the family's own hue, dying on a per-family cool
 *     target — gold cools orange→red, corruption teal cools to blue.
 *   • POWER-LAW SIZE. `pow(rand, 2.4)` over 0.40–2.45× instead of a flat
 *     0.7–1.3×, so a burst has a few big hot chunks among many fine motes and
 *     reads at two scales in one frame.
 *   • TURBULENT DRIFT. A divergence-free-ish field sampled from the particle's
 *     own position curls neighbours into filaments instead of letting each fly
 *     a straight ballistic line.
 *
 * On top of that, particles stretch along their own SCREEN-SPACE velocity:
 * the sprite is rotated into the direction of travel and squashed across it,
 * with the point size grown to match, so fast ejecta streaks and slow embers
 * stay round. That is what turns "flat square debris" into motion.
 */
import { useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { COLORS } from '../config'
import { useGameStore } from '../store'
import { drainBursts, type BurstCmd } from './VFXBus'
import { getParticleAtlas, PARTICLE_SHAPE } from './vfxTextures'

const POOL_CAP = 1500
/** smoke is heavier per pixel and far sparser — its own, smaller pool */
const SMOKE_CAP = 420

type Family = 'gold' | 'teal' | 'red' | 'smoke'

/**
 * [vfx R3] Where each family's particles LAND when they have cooled. Gold
 * energy cools like metal (orange → deep red), corruption teal cools into
 * blue, ember red into a dull coal. Smoke does not cool at all — it is mass.
 */
const FAMILY_COOL: Record<Family, [number, number, number]> = {
  gold: [1.0, 0.34, 0.07],
  teal: [0.22, 0.72, 1.0],
  red: [1.0, 0.24, 0.1],
  smoke: [1, 1, 1],
}

const FAMILY_BASE: Record<Family, string> = {
  gold: COLORS.aureate,
  teal: COLORS.cadenceTeal,
  red: COLORS.emberRed,
  smoke: '#2A2118',
}

/**
 * HDR boost for additive particles. The bloom knee is 1.0 now, so particle
 * cores have to be authored above white to bloom at all — this is the same
 * contract MATERIALS.emissiveBoost applies to the architecture's energy.
 */
const ADDITIVE_BOOST = 2.6
/** smoke is lit by nothing and must stay under the knee — it is mass, not light */
const SMOKE_BOOST = 0.18

const VERT = /* glsl */ `
attribute float aSize;
attribute float aLife;
attribute float aMaxLife;
attribute vec3 aColor;
attribute vec3 aVel;
attribute float aShape;
attribute float aStretch;
attribute float aSeed;
attribute float aRoll;
uniform float uPixelScale;
uniform float uAspect;
uniform float uTime;
uniform float uBoost;
uniform vec3 uCoolTint;
uniform float uCool;
varying float vAlpha;
varying vec3 vColor;
varying float vAngle;
varying float vStretch;
varying vec2 vTile;
void main() {
  float t = aMaxLife > 0.0 ? clamp(aLife / aMaxLife, 0.0, 1.0) : 0.0;
  // birth ramp: fade and scale up over the first 12% of life so nothing pops
  // in at full size (V15)
  float birth = smoothstep(0.0, 0.12, 1.0 - t);
  // per-particle flicker — embers breathe, sparks scintillate
  float flick = 0.80 + 0.20 * sin(uTime * (13.0 + aSeed * 23.0) + aSeed * 37.0);
  vAlpha = t * t * birth * flick;
  // [vfx R3] BLACKBODY COOLING. A spark is not a coloured dot that dims: it
  // is emitted white-hot, passes through its own hue, and dies as a dull
  // ember. Ramping only brightness is the tell that a particle system was
  // authored as a sprite fade; ramping COLOUR is what makes a burst look like
  // material that was heated. Birth clips toward white (so the head of every
  // spark crosses the bloom knee), death lands on uCoolTint.
  float heat = pow(t, 0.7);
  vec3 hotC = mix(aColor, vec3(1.0), 0.88);
  vec3 coolC = aColor * uCoolTint;
  vec3 ramped = mix(coolC, hotC, heat) * (0.30 + 1.05 * heat);
  vColor = mix(aColor * (0.55 + 0.45 * t), ramped, uCool) * uBoost;
  // 2×2 atlas; uv origin is bottom-left (flipY), tile 0 is the canvas top-left
  vTile = vec2(mod(aShape, 2.0), 1.0 - floor(aShape * 0.5));

  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vec4 clip0 = projectionMatrix * mv;
  // project a short step along the velocity to get the screen-space heading
  vec4 clip1 = projectionMatrix * (modelViewMatrix * vec4(position + aVel * 0.035, 1.0));
  vec2 s0 = clip0.xy / max(1e-4, abs(clip0.w));
  vec2 s1 = clip1.xy / max(1e-4, abs(clip1.w));
  vec2 d = vec2((s1.x - s0.x) * uAspect, s1.y - s0.y);
  float dl = length(d);
  vStretch = aStretch * clamp(dl * 7.0, 0.0, 2.4);
  // [vfx R2] streaked particles align to their screen-space heading; round
  // ones (smoke, embers, debris chips) take a per-particle roll with a slow
  // drift, so a cloud of them is never eight copies of the same sprite at the
  // same angle — the tell that gives away a billboard atlas.
  float spin = aRoll + (aSeed - 0.5) * uTime * 0.9;
  vAngle = vStretch > 0.02 && dl > 1e-5 ? atan(d.y, d.x) : spin;

  float s = aSize * (0.45 + 0.55 * t) * (0.35 + 0.65 * birth);
  gl_PointSize = aLife > 0.0 ? s * (1.0 + vStretch) * uPixelScale / max(0.1, -mv.z) : 0.0;
  gl_Position = clip0;
}
`

const FRAG = /* glsl */ `
uniform sampler2D uAtlas;
uniform float uSoft;
varying float vAlpha;
varying vec3 vColor;
varying float vAngle;
varying float vStretch;
varying vec2 vTile;
void main() {
  // y-up sprite space (gl_PointCoord is y-down)
  vec2 p = vec2(gl_PointCoord.x - 0.5, 0.5 - gl_PointCoord.y);
  float c = cos(-vAngle);
  float s = sin(-vAngle);
  vec2 r = vec2(c * p.x - s * p.y, s * p.x + c * p.y);
  // squash across the travel axis → a streak inside the enlarged point quad
  r.y *= (1.0 + vStretch);
  vec2 uv = r + 0.5;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) discard;
  vec2 tuv = clamp(uv, 0.008, 0.992) * 0.5 + vTile * 0.5;
  vec4 tex = texture2D(uAtlas, tuv);
  float a = tex.a * vAlpha * uSoft;
  if (a < 0.003) discard;
  gl_FragColor = vec4(vColor * tex.rgb, a);
}
`

class ParticlePool {
  readonly points: THREE.Points
  private readonly cap: number
  private cursor = 0
  private readonly pos: Float32Array
  private readonly vel: Float32Array
  private readonly col: Float32Array
  private readonly size: Float32Array
  private readonly life: Float32Array
  private readonly maxLife: Float32Array
  private readonly grav: Float32Array
  private readonly drag: Float32Array
  private readonly turb: Float32Array
  private readonly shape: Float32Array
  private readonly stretch: Float32Array
  private readonly seed: Float32Array
  private readonly roll: Float32Array
  private readonly posAttr: THREE.BufferAttribute
  private readonly lifeAttr: THREE.BufferAttribute
  private readonly colAttr: THREE.BufferAttribute
  private readonly sizeAttr: THREE.BufferAttribute
  private readonly maxLifeAttr: THREE.BufferAttribute
  private readonly velAttr: THREE.BufferAttribute
  private readonly shapeAttr: THREE.BufferAttribute
  private readonly stretchAttr: THREE.BufferAttribute
  private readonly seedAttr: THREE.BufferAttribute
  private readonly rollAttr: THREE.BufferAttribute
  readonly material: THREE.ShaderMaterial

  readonly family: Family

  constructor(family: Family) {
    this.family = family
    const isSmoke = family === 'smoke'
    this.cap = isSmoke ? SMOKE_CAP : POOL_CAP
    const cap = this.cap
    this.pos = new Float32Array(cap * 3)
    this.vel = new Float32Array(cap * 3)
    this.col = new Float32Array(cap * 3)
    this.size = new Float32Array(cap)
    this.life = new Float32Array(cap)
    this.maxLife = new Float32Array(cap)
    this.grav = new Float32Array(cap)
    this.drag = new Float32Array(cap)
    this.turb = new Float32Array(cap)
    this.shape = new Float32Array(cap)
    this.stretch = new Float32Array(cap)
    this.seed = new Float32Array(cap)
    this.roll = new Float32Array(cap)
    for (let i = 0; i < cap; i++) this.seed[i] = Math.random()

    const geo = new THREE.BufferGeometry()
    const dyn = (arr: Float32Array, n: number) =>
      new THREE.BufferAttribute(arr, n).setUsage(THREE.DynamicDrawUsage)
    this.posAttr = dyn(this.pos, 3)
    this.lifeAttr = dyn(this.life, 1)
    this.colAttr = dyn(this.col, 3)
    this.sizeAttr = dyn(this.size, 1)
    this.maxLifeAttr = dyn(this.maxLife, 1)
    this.velAttr = dyn(this.vel, 3)
    this.shapeAttr = dyn(this.shape, 1)
    this.stretchAttr = dyn(this.stretch, 1)
    this.seedAttr = new THREE.BufferAttribute(this.seed, 1)
    this.rollAttr = dyn(this.roll, 1)
    geo.setAttribute('position', this.posAttr)
    geo.setAttribute('aLife', this.lifeAttr)
    geo.setAttribute('aMaxLife', this.maxLifeAttr)
    geo.setAttribute('aColor', this.colAttr)
    geo.setAttribute('aSize', this.sizeAttr)
    geo.setAttribute('aVel', this.velAttr)
    geo.setAttribute('aShape', this.shapeAttr)
    geo.setAttribute('aStretch', this.stretchAttr)
    geo.setAttribute('aSeed', this.seedAttr)
    geo.setAttribute('aRoll', this.rollAttr)
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5) // never cull

    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uPixelScale: { value: 800 },
        uAspect: { value: 1.777 },
        uTime: { value: 0 },
        uBoost: { value: isSmoke ? SMOKE_BOOST : ADDITIVE_BOOST },
        uCoolTint: { value: new THREE.Vector3(...FAMILY_COOL[family]) },
        uCool: { value: isSmoke ? 0 : 1 },
        uSoft: { value: isSmoke ? 0.55 : 1 },
        uAtlas: { value: getParticleAtlas() },
      },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      // smoke is the one family that is NOT additive — it has to be able to
      // darken and occlude, which is what gives a detonation mass (V7)
      blending: isSmoke ? THREE.NormalBlending : THREE.AdditiveBlending,
    })

    this.points = new THREE.Points(geo, this.material)
    this.points.frustumCulled = false
    // smoke renders under the additive layers so cores composite on top of it
    this.points.renderOrder = isSmoke ? 18 : 20

    const c = new THREE.Color(FAMILY_BASE[family])
    for (let i = 0; i < cap; i++) {
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
    const color = _spawnColor.set(cmd.color)
    if (this.family === 'smoke') {
      // smoke is soot lit by the blast, not the blast itself: desaturate hard
      color.lerp(_soot, 0.82)
    }
    const count = Math.min(cmd.count, this.cap)
    const isSmoke = this.family === 'smoke'
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
      const py = cmd.y + dy * (isSmoke ? 0.35 : 0.05)
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
      // [vfx R3] POWER-LAW size distribution. A uniform 0.7-1.3x spread gives
      // every particle in a burst the same visual weight, which is why the old
      // bursts read as a scatter of identical dots. A power law puts most of
      // the count in fine motes and a handful of big hot chunks — the size
      // histogram real ejecta has, and the thing that gives a burst a read at
      // two different scales in one frame.
      const sizeRoll = Math.pow(Math.random(), 2.4)
      this.size[i] = cmd.size * (0.40 + 2.05 * sizeRoll) * (isSmoke ? 6.5 : 1)
      const lf = cmd.life * (0.6 + Math.random() * 0.4)
      this.life[i] = lf
      this.maxLife[i] = lf
      this.grav[i] = cmd.gravity
      this.shape[i] = cmd.shape
      this.stretch[i] = cmd.stretch
      this.roll[i] = Math.random() * Math.PI * 2
      // drag (V15): sparks bleed speed fast, embers float, smoke stalls
      this.drag[i] =
        cmd.shape === PARTICLE_SHAPE.smoke
          ? 2.4
          : cmd.shape === PARTICLE_SHAPE.ember
            ? 0.9
            : 1.6 + Math.random() * 1.2
      // turbulent drift: smoke rolls, embers wander, sparks hold their line
      this.turb[i] =
        cmd.shape === PARTICLE_SHAPE.smoke
          ? 2.1
          : cmd.shape === PARTICLE_SHAPE.ember
            ? 1.25
            : cmd.shape === PARTICLE_SHAPE.debris
              ? 0.35
              : 0.55
    }
    this.colAttr.needsUpdate = true
    this.sizeAttr.needsUpdate = true
    this.maxLifeAttr.needsUpdate = true
    this.shapeAttr.needsUpdate = true
    this.stretchAttr.needsUpdate = true
    this.rollAttr.needsUpdate = true
    // upload the freshly written state immediately: update() would otherwise
    // only flush it next frame, and never at all while timeScale is 0
    this.posAttr.needsUpdate = true
    this.lifeAttr.needsUpdate = true
    this.velAttr.needsUpdate = true
  }

  update(dt: number): void {
    if (dt <= 0) return
    const { pos, vel, life, grav, drag, turb, seed, cap } = this
    let anyAlive = false
    for (let i = 0; i < cap; i++) {
      if (life[i] <= 0) continue
      anyAlive = true
      life[i] -= dt
      const i3 = i * 3
      // exponential drag, integrated explicitly and clamped so a long frame
      // can never flip the velocity sign
      const k = Math.max(0, 1 - drag[i] * dt)
      vel[i3] *= k
      vel[i3 + 1] *= k
      vel[i3 + 2] *= k
      vel[i3 + 1] -= grav[i] * dt
      // [vfx R3] TURBULENT DRIFT (V15). Straight ballistic lines are the
      // second particle tell after hard-edged sprites: real ejecta is pushed
      // around by the air it is moving through. This is a divergence-free-ish
      // field sampled from the particle's own position, so neighbours curl
      // together into filaments instead of each wandering independently.
      const tb = turb[i]
      if (tb > 0.01) {
        const sd = seed[i] * 6.2831853
        const a = tb * dt
        vel[i3] += Math.sin(pos[i3 + 1] * 2.1 + sd) * a
        vel[i3 + 1] += Math.sin(pos[i3 + 2] * 1.9 + sd * 1.7) * a * 0.55
        vel[i3 + 2] += Math.cos(pos[i3] * 2.3 + sd * 0.9) * a
      }
      pos[i3] += vel[i3] * dt
      pos[i3 + 1] += vel[i3 + 1] * dt
      pos[i3 + 2] += vel[i3 + 2] * dt
    }
    if (anyAlive) {
      this.posAttr.needsUpdate = true
      this.lifeAttr.needsUpdate = true
      this.velAttr.needsUpdate = true
    }
  }
}

const _spawnColor = new THREE.Color()
const _soot = new THREE.Color('#1A1512')
const drainBuffer: BurstCmd[] = []

/** 4 pooled Points systems (gold/teal/red additive + smoke), drained from the bus. */
export default function Particles() {
  const pools = useMemo(
    () => [
      new ParticlePool('gold'),
      new ParticlePool('teal'),
      new ParticlePool('red'),
      new ParticlePool('smoke'),
    ],
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
    const aspect = size.height > 0 ? size.width / size.height : 1.777
    for (const p of pools) {
      p.material.uniforms.uPixelScale!.value = px
      p.material.uniforms.uAspect!.value = aspect
      // flicker runs on REAL time so embers keep shimmering during hitstop
      p.material.uniforms.uTime!.value += delta
    }

    drainBursts(drainBuffer)
    for (let i = 0; i < drainBuffer.length; i++) {
      const cmd = drainBuffer[i]
      const pool =
        cmd.shape === PARTICLE_SHAPE.smoke
          ? pools[3]
          : (pools.find((p) => p.matches(cmd.color)) ?? pools[0])
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

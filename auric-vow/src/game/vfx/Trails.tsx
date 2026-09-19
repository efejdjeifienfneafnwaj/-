/**
 * AURIC VOW — Trails.tsx
 * Pooled ribbon trails (vfx-hud.md §1.1): 8 concurrent ribbons, each a
 * camera-facing triangle strip built from a position history.
 * Zero runtime allocation: samples live in preallocated Vector3 arrays.
 *
 * [vfx R1] The ribbon used to be two verts per sample that shared one alpha
 * and one colour, which is exactly why dash and sprint trails read as flat
 * hard-edged white wedges (V5). It is now THREE verts per sample —
 * left / spine / right — carrying:
 *   • a cross-ribbon alpha ramp: 1 at the spine, 0 at both edges, so the
 *     ribbon feathers out instead of ending on a cut line;
 *   • a head→tail ramp: 1 at the head, 0 at the tail, on a squared curve;
 *   • a colour ramp: HDR solar-white filament at the spine, aureate at the
 *     edges, cooling toward the tail — the only part above the bloom knee is
 *     the filament, so trails bloom as a line, not a slab;
 *   • real UVs (u across the ribbon, v along it) driving a scrolling erosion
 *     term so the tail dissolves rather than fading uniformly.
 *
 * Sampling is distance-based (V10): the history only advances once the head
 * has travelled MIN_SEG, so a trail is the same length at 30 fps and 144 fps
 * and does not collapse to a point in slow-mo.
 */
import { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { COLORS } from '../config'
import { useGameStore } from '../store'
import { drainTrailOps, vfxEpoch, type TrailOp } from './VFXBus'

const MAX_TRAILS = 8
const SAMPLES = 24
const FADE_SEC = 0.25
const BASE_HALF_WIDTH = 0.15
/**
 * Target on-screen duration of a full ribbon (s). The segment length is
 * derived per frame from the emitter's measured SPEED, so a 30 m/s dash lays
 * down a 13 m streak and a 7 m/s sprint lays down a 3 m one — and both are
 * the same LENGTH IN TIME at 30 fps, 60 fps and 144 fps (V10).
 */
const TARGET_SPAN_SEC = 0.45
const MIN_SEG = 0.06
const MAX_SEG = 1.0

/** HDR filament: above the 1.0 bloom knee, so the spine is what glows */
const SPINE_BOOST = 2.8
const EDGE_BOOST = 1.0

const HEAD_COLOR = new THREE.Color(COLORS.solarWhite)
const MID_COLOR = new THREE.Color(COLORS.aureate)

const VERT = /* glsl */ `
attribute float aAlpha;
attribute vec3 aColor;
attribute vec2 aUv;
varying float vAlpha;
varying vec3 vColor;
varying vec2 vUv;
void main() {
  vAlpha = aAlpha;
  vColor = aColor;
  vUv = aUv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`
const FRAG = /* glsl */ `
uniform float uTime;
varying float vAlpha;
varying vec3 vColor;
varying vec2 vUv;
// cheap value noise — two sines, no texture fetch
float erosion(vec2 p) {
  return 0.5 + 0.5 * sin(p.x * 11.0 + sin(p.y * 7.0 + uTime * 3.0) * 1.7);
}
void main() {
  // vUv.x = across the ribbon (0 edge → 1 spine), vUv.y = 0 head → 1 tail
  float e = erosion(vec2(vUv.x, vUv.y * 3.0 - uTime * 0.9));
  // erosion only bites the tail half, so the head stays a solid filament
  float bite = mix(1.0, e, smoothstep(0.25, 1.0, vUv.y) * 0.75);
  float a = vAlpha * bite;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vColor, a);
}
`

/** verts per sample: left edge, spine, right edge */
const VPS = 3

class Ribbon {
  readonly mesh: THREE.Mesh
  readonly material: THREE.ShaderMaterial
  active = false
  ending = false
  /** seconds since end() was called */
  endAge = 0
  /** samples[0] = newest head */
  private readonly samples: THREE.Vector3[] = []
  /** newest head position pushed this frame (consumed in update) */
  private readonly pending = new THREE.Vector3()
  private hasPending = false
  /** how many history slots actually hold real data yet */
  private filled = 1
  /** smoothed emitter speed (m/s), drives the resampling distance */
  private speed = 0
  private readonly posAttr: THREE.BufferAttribute
  private readonly alphaAttr: THREE.BufferAttribute
  private readonly colorAttr: THREE.BufferAttribute
  private readonly uvAttr: THREE.BufferAttribute

  constructor() {
    for (let i = 0; i < SAMPLES; i++) this.samples.push(new THREE.Vector3())

    const geo = new THREE.BufferGeometry()
    const n = SAMPLES * VPS
    this.posAttr = new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(
      THREE.DynamicDrawUsage,
    )
    this.alphaAttr = new THREE.BufferAttribute(new Float32Array(n), 1).setUsage(
      THREE.DynamicDrawUsage,
    )
    this.colorAttr = new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(
      THREE.DynamicDrawUsage,
    )
    this.uvAttr = new THREE.BufferAttribute(new Float32Array(n * 2), 2)
    geo.setAttribute('position', this.posAttr)
    geo.setAttribute('aAlpha', this.alphaAttr)
    geo.setAttribute('aColor', this.colorAttr)
    geo.setAttribute('aUv', this.uvAttr)

    // static UVs: u = 0 at both edges and 1 at the spine, v = along the ribbon
    const uv = this.uvAttr.array as Float32Array
    for (let i = 0; i < SAMPLES; i++) {
      const v = i / (SAMPLES - 1)
      const b = i * VPS * 2
      uv[b] = 0
      uv[b + 1] = v
      uv[b + 2] = 1
      uv[b + 3] = v
      uv[b + 4] = 0
      uv[b + 5] = v
    }

    // two quads per segment (left-of-spine and right-of-spine)
    const idx: number[] = []
    for (let i = 0; i < SAMPLES - 1; i++) {
      const a = i * VPS
      const b = (i + 1) * VPS
      idx.push(a + 0, a + 1, b + 0, a + 1, b + 1, b + 0)
      idx.push(a + 1, a + 2, b + 1, a + 2, b + 2, b + 1)
    }
    geo.setIndex(idx)
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5)

    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uTime: { value: 0 } },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    })

    this.mesh = new THREE.Mesh(geo, this.material)
    this.mesh.frustumCulled = false
    this.mesh.visible = false
    this.mesh.renderOrder = 21
  }

  begin(p: THREE.Vector3): void {
    this.active = true
    this.ending = false
    this.endAge = 0
    this.filled = 1
    this.speed = 0
    this.hasPending = false
    this.pending.copy(p)
    for (const s of this.samples) s.copy(p)
    this.mesh.visible = true
  }

  /** record the emitter's head for this frame; resampling happens in update */
  push(x: number, y: number, z: number): void {
    this.pending.set(x, y, z)
    this.hasPending = true
  }

  /**
   * Advance the history by DISTANCE, with the distance derived from measured
   * speed so the ribbon spans a constant amount of TIME regardless of frame
   * rate (V10). Called once per frame, before the strip is rebuilt.
   */
  private resample(realDt: number): void {
    if (!this.hasPending) return
    this.hasPending = false
    const s = this.samples
    const head = s[0]
    const d = head.distanceTo(this.pending)
    if (realDt > 1e-5) {
      const inst = d / realDt
      // EMA so a single stutter frame cannot blow the segment length out
      this.speed += (inst - this.speed) * 0.3
    }
    const seg = THREE.MathUtils.clamp(
      (this.speed * TARGET_SPAN_SEC) / (SAMPLES - 1),
      MIN_SEG,
      MAX_SEG,
    )
    if (d >= seg) {
      for (let i = SAMPLES - 1; i > 0; i--) s[i].copy(s[i - 1])
      if (this.filled < SAMPLES) this.filled++
    }
    head.copy(this.pending)
  }

  end(): void {
    this.ending = true
  }

  release(): void {
    this.active = false
    this.ending = false
    this.mesh.visible = false
  }

  /** returns false when the ribbon has fully faded and been released */
  update(dt: number, realDt: number, camera: THREE.Camera): boolean {
    if (!this.active) return false
    this.resample(realDt)
    if (this.ending) {
      this.endAge += dt
      if (this.endAge >= FADE_SEC) {
        this.release()
        return false
      }
    }
    this.material.uniforms.uTime!.value += realDt
    const fade = this.ending ? Math.max(0, 1 - this.endAge / FADE_SEC) : 1

    const pos = this.posAttr.array as Float32Array
    const alp = this.alphaAttr.array as Float32Array
    const col = this.colorAttr.array as Float32Array
    const s = this.samples

    const side = _side
    const dir = _dir
    const view = _view
    const mix = _mix

    for (let i = 0; i < SAMPLES; i++) {
      const p = s[i]
      const next = s[Math.min(i + 1, SAMPLES - 1)]
      const prev = s[Math.max(i - 1, 0)]
      dir.subVectors(prev, next)
      if (dir.lengthSq() < 1e-10) dir.set(0, 1, 0)
      view.subVectors(p, camera.position)
      side.crossVectors(dir, view)
      if (side.lengthSq() < 1e-8) side.set(1, 0, 0)
      else side.normalize()

      const t = i / (SAMPLES - 1) // 0 head → 1 tail
      // width: full just behind the head, tapering to a point at the tail.
      // sqrt keeps the body wide instead of pinching immediately.
      const taper = Math.sqrt(Math.max(0, 1 - t)) * (0.55 + 0.45 * Math.min(1, t * 6))
      const halfW = BASE_HALF_WIDTH * taper * fade
      const b = i * VPS * 3
      // left edge
      pos[b] = p.x + side.x * halfW
      pos[b + 1] = p.y + side.y * halfW
      pos[b + 2] = p.z + side.z * halfW
      // spine
      pos[b + 3] = p.x
      pos[b + 4] = p.y
      pos[b + 5] = p.z
      // right edge
      pos[b + 6] = p.x - side.x * halfW
      pos[b + 7] = p.y - side.y * halfW
      pos[b + 8] = p.z - side.z * halfW

      // colour: solar-white filament at the head, cooling to aureate down the
      // tail; edges are always the cooler gold so the ramp reads across width
      if (t < 0.4) mix.copy(HEAD_COLOR).lerp(MID_COLOR, t / 0.4)
      else mix.copy(MID_COLOR)
      const eR = mix.r * EDGE_BOOST
      const eG = mix.g * EDGE_BOOST
      const eB = mix.b * EDGE_BOOST
      const sBoost = SPINE_BOOST * (1 - t * 0.55)
      col[b] = eR
      col[b + 1] = eG
      col[b + 2] = eB
      col[b + 3] = mix.r * sBoost
      col[b + 4] = mix.g * sBoost
      col[b + 5] = mix.b * sBoost
      col[b + 6] = eR
      col[b + 7] = eG
      col[b + 8] = eB

      // alpha: 0 at both edges, 1 at the spine; squared head→tail falloff.
      // Slots that have not been written yet collapse to nothing.
      const grown = i < this.filled ? 1 : 0
      const along = (1 - t) * (1 - t) * fade * grown
      const a2 = i * VPS
      alp[a2] = 0
      alp[a2 + 1] = along
      alp[a2 + 2] = 0
    }
    this.posAttr.needsUpdate = true
    this.alphaAttr.needsUpdate = true
    this.colorAttr.needsUpdate = true
    return true
  }
}

const _side = new THREE.Vector3()
const _dir = new THREE.Vector3()
const _view = new THREE.Vector3()
const _mix = new THREE.Color()

const drainBuffer: TrailOp[] = []
const startVec = new THREE.Vector3()

/** Pooled ribbon trails, driven by VFX.trail(id) push/end ops. */
export default function Trails() {
  const ribbons = useMemo(() => Array.from({ length: MAX_TRAILS }, () => new Ribbon()), [])
  const byId = useMemo(() => new Map<string, Ribbon>(), [])
  const camera = useThree((s) => s.camera)

  const lastEpoch = useRef(vfxEpoch())

  useFrame((_, delta) => {
    const ts = useGameStore.getState().timeScale
    const realDt = Math.min(delta, 0.1)
    const dt = realDt * ts

    // run restart: an emitter that was cut off mid-flight never called end(),
    // and a ribbon that is never ended is never released — it would hang in
    // the world as a frozen streak. Drop them outright rather than fade.
    const ep = vfxEpoch()
    if (ep !== lastEpoch.current) {
      lastEpoch.current = ep
      for (const r of ribbons) r.release()
      byId.clear()
    }

    drainTrailOps(drainBuffer)
    for (let i = 0; i < drainBuffer.length; i++) {
      const op = drainBuffer[i]
      if (op.end) {
        byId.get(op.id)?.end()
        continue
      }
      let r = byId.get(op.id)
      if (!r) {
        // allocate: first free, else steal the oldest ending one, else slot 0
        r = ribbons.find((rb) => !rb.active) ?? ribbons.find((rb) => rb.ending) ?? ribbons[0]
        // V11: a stolen ribbon must lose its previous owner, or two emitters
        // zigzag the same strip
        for (const [id, rb] of byId) {
          if (rb === r) byId.delete(id)
        }
        startVec.set(op.x, op.y, op.z)
        r.begin(startVec)
        byId.set(op.id, r)
      }
      r.push(op.x, op.y, op.z)
    }
    drainBuffer.length = 0

    for (const r of ribbons) {
      if (!r.active) continue
      const alive = r.update(dt, realDt, camera)
      if (!alive) {
        for (const [id, rb] of byId) {
          if (rb === r) byId.delete(id)
        }
      }
    }
  })

  return (
    <group name="vfx-trails">
      {ribbons.map((r, i) => (
        <primitive key={i} object={r.mesh} />
      ))}
    </group>
  )
}

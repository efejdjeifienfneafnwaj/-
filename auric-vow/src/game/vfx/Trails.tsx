/**
 * AURIC VOW — Trails.tsx
 * Pooled ribbon trails (vfx-hud.md §1.1): 8 concurrent ribbons, each a
 * camera-facing triangle strip built from a 24-sample position history.
 * Gold gradient shader: solar-white head → aureate → transparent tail.
 * Zero runtime allocation: samples live in preallocated Vector3 ring arrays
 * and are shifted with copyWithin-style moves.
 */
import { useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { COLORS } from '../config'
import { useGameStore } from '../store'
import { drainTrailOps, type TrailOp } from './VFXBus'

const MAX_TRAILS = 8
const SAMPLES = 24
const FADE_SEC = 0.25
// 0.05 → 0.15 half-width (≈0.3 m wide head, combat.md §3.1 streak spec):
// the previous 0.1 m ribbon read as "one thin beam" at gameplay distance (fix1).
const BASE_HALF_WIDTH = 0.15

const HEAD_COLOR = new THREE.Color(COLORS.solarWhite)
const MID_COLOR = new THREE.Color(COLORS.aureate)

const VERT = /* glsl */ `
attribute float aAlpha;
attribute vec3 aColor;
varying float vAlpha;
varying vec3 vColor;
void main() {
  vAlpha = aAlpha;
  vColor = aColor;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`
const FRAG = /* glsl */ `
varying float vAlpha;
varying vec3 vColor;
void main() {
  if (vAlpha < 0.003) discard;
  gl_FragColor = vec4(vColor, vAlpha);
}
`

class Ribbon {
  readonly mesh: THREE.Mesh
  active = false
  ending = false
  /** seconds since end() was called */
  endAge = 0
  /** samples[0] = newest head */
  private readonly samples: THREE.Vector3[] = []
  private readonly posAttr: THREE.BufferAttribute
  private readonly alphaAttr: THREE.BufferAttribute
  private readonly colorAttr: THREE.BufferAttribute

  constructor() {
    for (let i = 0; i < SAMPLES; i++) this.samples.push(new THREE.Vector3())

    const geo = new THREE.BufferGeometry()
    this.posAttr = new THREE.BufferAttribute(new Float32Array(SAMPLES * 2 * 3), 3).setUsage(
      THREE.DynamicDrawUsage,
    )
    this.alphaAttr = new THREE.BufferAttribute(new Float32Array(SAMPLES * 2), 1).setUsage(
      THREE.DynamicDrawUsage,
    )
    this.colorAttr = new THREE.BufferAttribute(new Float32Array(SAMPLES * 2 * 3), 3).setUsage(
      THREE.DynamicDrawUsage,
    )
    geo.setAttribute('position', this.posAttr)
    geo.setAttribute('aAlpha', this.alphaAttr)
    geo.setAttribute('aColor', this.colorAttr)
    const idx: number[] = []
    for (let i = 0; i < SAMPLES - 1; i++) {
      const a = i * 2
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
    }
    geo.setIndex(idx)
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5)

    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    })

    this.mesh = new THREE.Mesh(geo, mat)
    this.mesh.frustumCulled = false
    this.mesh.visible = false
    this.mesh.renderOrder = 21
  }

  begin(p: THREE.Vector3): void {
    this.active = true
    this.ending = false
    this.endAge = 0
    for (const s of this.samples) s.copy(p)
    this.mesh.visible = true
  }

  /** push a new head position; existing samples age back one slot */
  push(x: number, y: number, z: number): void {
    const s = this.samples
    for (let i = SAMPLES - 1; i > 0; i--) s[i].copy(s[i - 1])
    s[0].set(x, y, z)
  }

  end(): void {
    this.ending = true
  }

  private release(): void {
    this.active = false
    this.ending = false
    this.mesh.visible = false
  }

  /** returns false when the ribbon has fully faded and been released */
  update(dt: number, camera: THREE.Camera): boolean {
    if (!this.active) return false
    if (this.ending) {
      this.endAge += dt
      if (this.endAge >= FADE_SEC) {
        this.release()
        return false
      }
    }
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
      const halfW = BASE_HALF_WIDTH * (1 - t) * fade
      const i6 = i * 6
      pos[i6] = p.x + side.x * halfW
      pos[i6 + 1] = p.y + side.y * halfW
      pos[i6 + 2] = p.z + side.z * halfW
      pos[i6 + 3] = p.x - side.x * halfW
      pos[i6 + 4] = p.y - side.y * halfW
      pos[i6 + 5] = p.z - side.z * halfW

      // color: head solar-white → mid gold → tail gold
      if (t < 0.35) mix.copy(HEAD_COLOR).lerp(MID_COLOR, t / 0.35)
      else mix.copy(MID_COLOR)
      col[i6] = mix.r
      col[i6 + 1] = mix.g
      col[i6 + 2] = mix.b
      col[i6 + 3] = mix.r
      col[i6 + 4] = mix.g
      col[i6 + 5] = mix.b

      const a = (1 - t) * (1 - t) * fade
      alp[i * 2] = a
      alp[i * 2 + 1] = a
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

  useFrame((_, delta) => {
    const ts = useGameStore.getState().timeScale
    const dt = Math.min(delta, 0.1) * ts

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
        startVec.set(op.x, op.y, op.z)
        r.begin(startVec)
        byId.set(op.id, r)
      }
      r.push(op.x, op.y, op.z)
    }
    drainBuffer.length = 0

    for (const r of ribbons) {
      if (!r.active) continue
      const alive = r.update(dt, camera)
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

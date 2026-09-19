/**
 * AURIC VOW — Flashes.tsx
 * Pooled LightFlash primitive (vfx-hud.md §1.1): 6 PointLights, intensity
 * spike → 0 over life. Each flash also spawns a small camera-facing additive
 * FlashQuad (4-point star, canvas-generated, pool ×12) so the flash reads
 * even through bloom.
 */
import { useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useGameStore } from '../store'
import { drainFlashes, type FlashCmd } from './VFXBus'

const MAX_LIGHTS = 6 // fixed light budget; overflow steals the dimmest (below)
const MAX_QUADS = 16 // 12 → 16: volley 7-hit frames + muzzle stream (fix1)

let starTex: THREE.CanvasTexture | null = null

/** 128² 4-point star flash texture (white-on-black, additive). */
function getStarTexture(): THREE.CanvasTexture {
  if (starTex) return starTex
  const size = 128
  const c = document.createElement('canvas')
  c.width = size
  c.height = size
  const ctx = c.getContext('2d')!
  const cx = size / 2
  // soft radial core
  const core = ctx.createRadialGradient(cx, cx, 0, cx, cx, size * 0.2)
  core.addColorStop(0, 'rgba(255,255,255,1)')
  core.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = core
  ctx.fillRect(0, 0, size, size)
  // 4 spikes
  ctx.globalCompositeOperation = 'lighter'
  for (let k = 0; k < 4; k++) {
    ctx.save()
    ctx.translate(cx, cx)
    ctx.rotate((k * Math.PI) / 2)
    const spike = ctx.createLinearGradient(0, 0, size * 0.48, 0)
    spike.addColorStop(0, 'rgba(255,255,255,0.9)')
    spike.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = spike
    ctx.beginPath()
    ctx.moveTo(0, -size * 0.03)
    ctx.lineTo(size * 0.48, 0)
    ctx.lineTo(0, size * 0.03)
    ctx.closePath()
    ctx.fill()
    ctx.restore()
  }
  starTex = new THREE.CanvasTexture(c)
  starTex.colorSpace = THREE.SRGBColorSpace
  return starTex
}

interface LightSlot {
  light: THREE.PointLight
  active: boolean
  age: number
  life: number
  base: number
}

interface QuadSlot {
  mesh: THREE.Mesh
  mat: THREE.MeshBasicMaterial
  active: boolean
  age: number
  life: number
  baseScale: number
}

const drainBuffer: FlashCmd[] = []
const quadGeo = new THREE.PlaneGeometry(1, 1)

/** Pooled flash lights + star quads, drained from the VFX bus. */
export default function Flashes() {
  const camera = useThree((s) => s.camera)

  const lights = useMemo<LightSlot[]>(
    () =>
      Array.from({ length: MAX_LIGHTS }, () => {
        const light = new THREE.PointLight(0xffffff, 0, 8, 2)
        light.visible = false
        return { light, active: false, age: 0, life: 0.1, base: 0 }
      }),
    [],
  )

  const quads = useMemo<QuadSlot[]>(
    () =>
      Array.from({ length: MAX_QUADS }, () => {
        const mat = new THREE.MeshBasicMaterial({
          map: getStarTexture(),
          color: 0xffffff,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          toneMapped: false,
          side: THREE.DoubleSide,
        })
        const mesh = new THREE.Mesh(quadGeo, mat)
        mesh.visible = false
        mesh.renderOrder = 22
        mesh.frustumCulled = false
        return { mesh, mat, active: false, age: 0, life: 0.1, baseScale: 0.3 }
      }),
    [],
  )

  useFrame((_, delta) => {
    const ts = useGameStore.getState().timeScale
    const dt = Math.min(delta, 0.1) * ts

    drainFlashes(drainBuffer)
    for (let i = 0; i < drainBuffer.length; i++) {
      const cmd = drainBuffer[i]
      // light slot: first free, else the dimmest active one
      const l =
        lights.find((s) => !s.active) ??
        lights.reduce((a, b) => (a.light.intensity < b.light.intensity ? a : b))
      l.active = true
      l.age = 0
      l.life = Math.max(0.03, cmd.life)
      l.base = cmd.intensity
      l.light.color.set(cmd.color)
      l.light.distance = cmd.distance
      l.light.intensity = cmd.intensity
      l.light.position.set(cmd.x, cmd.y, cmd.z)
      l.light.visible = true
      // quad slot
      const q = quads.find((s) => !s.active) ?? quads[0]
      q.active = true
      q.age = 0
      q.life = Math.max(0.04, cmd.life * 0.8)
      q.baseScale = THREE.MathUtils.clamp(cmd.intensity / 30, 0.2, 2.6) // big ability flashes → big quads (fix1)
      q.mat.color.set(cmd.color)
      q.mesh.position.set(cmd.x, cmd.y, cmd.z)
      q.mesh.visible = true
    }
    drainBuffer.length = 0

    for (const l of lights) {
      if (!l.active) continue
      l.age += dt
      const t = l.age / l.life
      if (t >= 1) {
        l.active = false
        l.light.visible = false
        l.light.intensity = 0
        continue
      }
      const k = 1 - t
      l.light.intensity = l.base * k * k
    }

    for (const q of quads) {
      if (!q.active) continue
      q.age += dt
      const t = q.age / q.life
      if (t >= 1) {
        q.active = false
        q.mesh.visible = false
        q.mat.opacity = 0
        continue
      }
      q.mesh.quaternion.copy(camera.quaternion) // camera-facing billboard
      const s = q.baseScale * (0.7 + 1.1 * t)
      q.mesh.scale.set(s, s, s)
      q.mat.opacity = (1 - t) * (1 - t)
    }
  })

  return (
    <group name="vfx-flashes">
      {lights.map((l, i) => (
        <primitive key={`l${i}`} object={l.light} />
      ))}
      {quads.map((q, i) => (
        <primitive key={`q${i}`} object={q.mesh} />
      ))}
    </group>
  )
}

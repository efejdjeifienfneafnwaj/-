/**
 * AURIC VOW — Flashes.tsx
 * Pooled LightFlash primitive (vfx-hud.md §1.1).
 *
 * [vfx R1] Three changes:
 *   V12 — the flash was ONE 4-point star, screen-axis aligned, identical every
 *         time. It is now two layers (a randomised star with long/short spike
 *         pairs, plus a wide soft halo behind it) with a random roll and a
 *         random aspect per flash, so no two muzzle or impact flashes match.
 *   V17 — a flash could only ever be a one-shot, so nothing could light a
 *         javelin in flight or hold the nova open. This system now also drives
 *         the VFXBus TRACKED LIGHT pool: six leased PointLights that an effect
 *         owns for its whole lifetime and moves every frame.
 *   Transient survival — every flash gets a minimum 0.08 s lifetime so it
 *         cannot fall entirely between two 33 ms capture steps.
 */
import { useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useGameStore } from '../store'
import { drainFlashes, trackedLightSlots, type FlashCmd } from './VFXBus'
import { getSoftGlowTexture } from './vfxTextures'

const MAX_LIGHTS = 6 // one-shot flash lights; overflow steals the dimmest
const MAX_QUADS = 16 // 12 → 16: volley 7-hit frames + muzzle stream (fix1)
/** a flash shorter than this can vanish between two fixed capture steps */
const MIN_FLASH_LIFE = 0.08

let starTex: THREE.CanvasTexture | null = null

/**
 * 256² two-layer flash: a hot core, four long spikes, four short diagonals and
 * a faint halo ring. Drawn once; per-flash variation comes from roll/aspect.
 */
function getStarTexture(): THREE.CanvasTexture {
  if (starTex) return starTex
  const size = 256
  const c = document.createElement('canvas')
  c.width = size
  c.height = size
  const ctx = c.getContext('2d')!
  const cx = size / 2
  // soft radial core
  const core = ctx.createRadialGradient(cx, cx, 0, cx, cx, size * 0.17)
  core.addColorStop(0, 'rgba(255,255,255,1)')
  core.addColorStop(0.45, 'rgba(255,250,236,0.75)')
  core.addColorStop(1, 'rgba(255,240,210,0)')
  ctx.fillStyle = core
  ctx.fillRect(0, 0, size, size)

  ctx.globalCompositeOperation = 'lighter'
  // 4 long spikes + 4 short diagonals — an 8-point star reads as a real flare
  for (let k = 0; k < 8; k++) {
    const long = k % 2 === 0
    const len = size * (long ? 0.48 : 0.26)
    const halfW = size * (long ? 0.022 : 0.014)
    ctx.save()
    ctx.translate(cx, cx)
    ctx.rotate((k * Math.PI) / 4)
    const spike = ctx.createLinearGradient(0, 0, len, 0)
    spike.addColorStop(0, `rgba(255,255,255,${long ? 0.95 : 0.6})`)
    spike.addColorStop(0.35, `rgba(255,243,214,${long ? 0.4 : 0.22})`)
    spike.addColorStop(1, 'rgba(255,184,53,0)')
    ctx.fillStyle = spike
    ctx.beginPath()
    ctx.moveTo(0, -halfW)
    ctx.lineTo(len, 0)
    ctx.lineTo(0, halfW)
    ctx.closePath()
    ctx.fill()
    ctx.restore()
  }
  // faint halo ring so the flash has an outer boundary through bloom
  const halo = ctx.createRadialGradient(cx, cx, size * 0.14, cx, cx, size * 0.34)
  halo.addColorStop(0, 'rgba(255,214,150,0)')
  halo.addColorStop(0.55, 'rgba(255,214,150,0.16)')
  halo.addColorStop(1, 'rgba(255,184,53,0)')
  ctx.fillStyle = halo
  ctx.fillRect(0, 0, size, size)
  ctx.globalCompositeOperation = 'source-over'

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
  /** billboard root — carries position and camera-facing orientation */
  group: THREE.Group
  star: THREE.Mesh
  halo: THREE.Mesh
  starMat: THREE.MeshBasicMaterial
  haloMat: THREE.MeshBasicMaterial
  active: boolean
  age: number
  life: number
  baseScale: number
  roll: number
  aspect: number
}

const drainBuffer: FlashCmd[] = []
const quadGeo = new THREE.PlaneGeometry(1, 1)
const _c = new THREE.Color()

/** Pooled flash lights + star quads + the leased tracked-light pool. */
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

  /** the VFXBus tracked-light pool made real (V17) */
  const tracked = useMemo(
    () =>
      trackedLightSlots().map(() => {
        const l = new THREE.PointLight(0xffffff, 0, 12, 2)
        l.visible = false
        return l
      }),
    [],
  )

  const quads = useMemo<QuadSlot[]>(
    () =>
      Array.from({ length: MAX_QUADS }, () => {
        const starMat = new THREE.MeshBasicMaterial({
          map: getStarTexture(),
          color: 0xffffff,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          toneMapped: false,
          side: THREE.DoubleSide,
        })
        const haloMat = new THREE.MeshBasicMaterial({
          map: getSoftGlowTexture(),
          color: 0xffffff,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          toneMapped: false,
          side: THREE.DoubleSide,
        })
        const star = new THREE.Mesh(quadGeo, starMat)
        const halo = new THREE.Mesh(quadGeo, haloMat)
        halo.scale.setScalar(2.6)
        halo.renderOrder = 21
        star.renderOrder = 22
        const group = new THREE.Group()
        group.add(halo)
        group.add(star)
        group.visible = false
        group.frustumCulled = false
        return {
          group,
          star,
          halo,
          starMat,
          haloMat,
          active: false,
          age: 0,
          life: 0.1,
          baseScale: 0.3,
          roll: 0,
          aspect: 1,
        }
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
      l.life = Math.max(MIN_FLASH_LIFE, cmd.life)
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
      q.life = Math.max(MIN_FLASH_LIFE, cmd.life * 0.8)
      q.baseScale = THREE.MathUtils.clamp(cmd.intensity / 30, 0.2, 2.6)
      // randomised roll + aspect: no two flashes are the same shape (V12)
      q.roll = Math.random() * Math.PI * 2
      q.aspect = 0.72 + Math.random() * 0.62
      _c.set(cmd.color)
      // the star core is authored above the bloom knee, the halo below it, so
      // a flash blooms as a point rather than a disc
      q.starMat.color.setRGB(_c.r * 2.4, _c.g * 2.4, _c.b * 2.4)
      q.haloMat.color.copy(_c)
      q.group.position.set(cmd.x, cmd.y, cmd.z)
      q.group.visible = true
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

    // tracked lights: leased by effects, driven by them, mirrored here
    const slots = trackedLightSlots()
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i]
      const l = tracked[i]
      if (!l) continue
      const on = s.leased && s.intensity > 0.001
      l.visible = on
      if (!on) {
        l.intensity = 0
        continue
      }
      l.position.set(s.x, s.y, s.z)
      l.color.setHex(s.color)
      l.intensity = s.intensity
      l.distance = s.distance
      l.decay = s.decay
    }

    for (const q of quads) {
      if (!q.active) continue
      q.age += dt
      const t = q.age / q.life
      if (t >= 1) {
        q.active = false
        q.group.visible = false
        q.starMat.opacity = 0
        q.haloMat.opacity = 0
        continue
      }
      q.group.quaternion.copy(camera.quaternion) // camera-facing billboard
      q.group.rotateZ(q.roll) // random roll about the view axis
      // the core snaps out fast; the halo lingers and keeps expanding
      const s = q.baseScale * (0.55 + 1.25 * t)
      q.star.scale.set(s * q.aspect, s / q.aspect, 1)
      q.halo.scale.setScalar(s * (2.1 + 1.4 * t))
      const k = 1 - t
      q.starMat.opacity = k * k * k
      q.haloMat.opacity = k * k * 0.5
    }
  })

  return (
    <group name="vfx-flashes">
      {lights.map((l, i) => (
        <primitive key={`l${i}`} object={l.light} />
      ))}
      {tracked.map((l, i) => (
        <primitive key={`t${i}`} object={l} />
      ))}
      {quads.map((q, i) => (
        <primitive key={`q${i}`} object={q.group} />
      ))}
    </group>
  )
}

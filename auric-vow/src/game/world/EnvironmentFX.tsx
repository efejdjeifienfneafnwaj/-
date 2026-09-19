/**
 * AURIC VOW — world/EnvironmentFX.tsx
 * Mission-phase environment hooks (environment.md §7):
 * - teal → gold purification of Reliquary veins / planter soil with the
 *   phase-2 channelProgress (the visual objective progress bar)
 * - chamber gold point light ramps 4 → 14 during the channel
 * - arena medallion emissive pulses per EXTERMINATE wave (brighter as waves
 *   escalate); enemy spawn-door glow rings flare during waves
 * - bridge-gate gold seal dissolves at EXTRACT (collider removed too)
 * - extraction pad gold point ignites at EXTRACT
 * - drives banner cloth-shader time + teal vein pulse
 * - pushes the objective marker position into the store (Reliquary until
 *   EXTRACT, then the extraction pad)
 *
 * R1 (art review item 7): the gold veins get real practicals too — two pooled
 * point lights that ride the nearest GOLD_FIXTURES (slab veins, megalith
 * under-glow, medallion) by camera distance, so the gold energy in the level
 * actually lights the stone it sits on.
 */
import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { useGameStore } from '../store'
import { COLORS, LIGHTING } from '../config'
import { RELIQUARY_POSITION, EXTRACTION_PAD_POSITION, BRIDGE_SEAL } from './layout'
import { registerCollider, unregisterCollider } from './Colliders'
import { GOLD_FIXTURES } from './ShrineStation'
import {
  veinTealMaterial,
  purifyVeinMaterial,
  medallionMaterial,
  doorGlowMaterial,
  sealMaterial,
  bannerMaterial,
  TEAL_COLOR,
  GOLD_COLOR,
} from './materials'

const PHASE_INDEX: Record<string, number> = {
  DROPSHIP: 0,
  INFILTRATE: 1,
  OBJECTIVE: 2,
  EXTERMINATE: 3,
  EXTRACT: 4,
  WIN: 5,
  LOSE: 6,
}

/**
 * R2: 2 → 4. The colour script moved the canyon's bay practicals and the
 * arena's new perimeter sconces from cadence teal to aureate, so there are far
 * more gold fixtures in the level and two pooled lights could no longer cover
 * a room. Still nearest-N culled at 32 m, so the per-frame cost is unchanged.
 */
const GOLD_PRACTICALS = 4

export default function EnvironmentFX() {
  const chamberGold = useRef<THREE.PointLight>(null!)
  const padGold = useRef<THREE.PointLight>(null!)
  const sealColliderId = useRef<number | null>(null)
  const goldLights = useRef<(THREE.PointLight | null)[]>([])
  // preallocated nearest-N selection buffers (nothing allocates in useFrame)
  const gIdx = useRef<Int32Array>(new Int32Array(GOLD_PRACTICALS))
  const gDist = useRef<Float32Array>(new Float32Array(GOLD_PRACTICALS))

  // bridge-gate seal collider — removed when the seal dissolves at EXTRACT
  useEffect(() => {
    const b = new THREE.Box3(
      new THREE.Vector3(BRIDGE_SEAL.x0, BRIDGE_SEAL.y0, BRIDGE_SEAL.z0),
      new THREE.Vector3(BRIDGE_SEAL.x1, BRIDGE_SEAL.y1, BRIDGE_SEAL.z1),
    )
    sealColliderId.current = registerCollider(b, ['wall'])
    return () => {
      if (sealColliderId.current !== null) unregisterCollider(sealColliderId.current)
      sealColliderId.current = null
    }
  }, [])

  // objective marker world anchor
  useEffect(() => {
    const setObjectivePosition = useGameStore.getState().setObjectivePosition
    setObjectivePosition(RELIQUARY_POSITION.clone())
    return () => setObjectivePosition(null)
  }, [])

  useFrame((state, dt) => {
    const s = useGameStore.getState()
    const t = state.clock.elapsedTime
    const phaseIdx = PHASE_INDEX[s.phase] ?? 0

    // --- purification factor: 0 until OBJECTIVE, channel progress during, 1 after
    const purify = phaseIdx < 2 ? 0 : phaseIdx === 2 ? s.channelProgress : 1

    // Reliquary cables / planter soil / gate glow: teal → gold
    purifyVeinMaterial().color.lerpColors(TEAL_COLOR, GOLD_COLOR, purify)

    // chamber gold light ramps 2.5 → 11 with the channel. R2: cut from 4 → 14
    // — with the key at 4.4 and the fill cut hard, a 14-intensity point at the
    // room centre was re-flattening the one space that has a real key shaft.
    if (chamberGold.current) chamberGold.current.intensity = 2.5 + 8.5 * purify

    // --- teal corruption veins pulse (sin brightness)
    const pulse = 0.82 + 0.18 * Math.sin(t * 2.4)
    veinTealMaterial().color.copy(TEAL_COLOR).multiplyScalar(pulse)

    // --- arena medallion: pulse escalates with wave index during EXTERMINATE
    const med = medallionMaterial()
    if (s.phase === 'EXTERMINATE') {
      const k = 0.9 + s.wave * 0.35 + 0.25 * Math.sin(t * 3.0)
      med.color.copy(GOLD_COLOR).multiplyScalar(k)
    } else {
      med.color.copy(GOLD_COLOR).multiplyScalar(0.7 + 0.06 * Math.sin(t * 1.2))
    }

    // --- enemy spawn doors flare while waves run
    const doors = doorGlowMaterial()
    if (s.phase === 'EXTERMINATE') {
      doors.color.copy(TEAL_COLOR).multiplyScalar(1.1 + 0.5 * Math.sin(t * 4.0))
    } else {
      doors.color.copy(TEAL_COLOR).multiplyScalar(0.55)
    }

    // --- bridge seal dissolves at EXTRACT (gold burst handled by VFX layer)
    const seal = sealMaterial()
    if (phaseIdx >= 4 && s.phase !== 'LOSE') {
      seal.opacity = Math.max(0, seal.opacity - dt * 1.4)
      if (seal.opacity <= 0.05 && sealColliderId.current !== null) {
        unregisterCollider(sealColliderId.current)
        sealColliderId.current = null
      }
    } else if (seal.opacity < 0.9 && phaseIdx < 4) {
      seal.opacity = Math.min(0.9, seal.opacity + dt) // mission reset restores it
    }

    // --- extraction pad gold point (off until phase 4)
    if (padGold.current) {
      const target = s.phase === 'EXTRACT' || s.phase === 'WIN' ? 8 : 0
      padGold.current.intensity = THREE.MathUtils.lerp(padGold.current.intensity, target, 1 - Math.exp(-3 * dt))
    }

    // --- gold vein practicals: nearest 2 modelled fixtures by camera distance
    {
      const cam = state.camera.position
      const idx = gIdx.current
      const dist = gDist.current
      for (let i = 0; i < GOLD_PRACTICALS; i++) {
        idx[i] = -1
        dist[i] = Infinity
      }
      for (let f = 0; f < GOLD_FIXTURES.length; f++) {
        const p = GOLD_FIXTURES[f]
        const dx = p[0] - cam.x
        const dy = p[1] - cam.y
        const dz = p[2] - cam.z
        const d2 = dx * dx + dy * dy + dz * dz
        if (d2 > 1024) continue // 32 m cull
        for (let i = 0; i < GOLD_PRACTICALS; i++) {
          if (d2 < dist[i]) {
            for (let j = GOLD_PRACTICALS - 1; j > i; j--) {
              dist[j] = dist[j - 1]
              idx[j] = idx[j - 1]
            }
            dist[i] = d2
            idx[i] = f
            break
          }
        }
      }
      const goldPulse = 0.85 + 0.15 * Math.sin(t * 1.7)
      const lerpK = 1 - Math.exp(-6 * dt)
      for (let i = 0; i < GOLD_PRACTICALS; i++) {
        const l = goldLights.current[i]
        if (!l) continue
        const f = idx[i]
        if (f < 0) {
          l.intensity = THREE.MathUtils.lerp(l.intensity, 0, lerpK)
          continue
        }
        const p = GOLD_FIXTURES[f]
        l.position.set(p[0], p[1], p[2])
        l.intensity = LIGHTING.goldPractical.intensity * goldPulse
      }
    }

    // --- banner cloth sway
    bannerMaterial().uniforms.uTime.value = t

    // --- objective marker moves to the pad once extraction begins
    if (s.phase === 'EXTRACT' || s.phase === 'WIN') {
      const cur = s.objectivePosition
      if (!cur || cur.distanceToSquared(EXTRACTION_PAD_POSITION) > 0.01) {
        s.setObjectivePosition(EXTRACTION_PAD_POSITION.clone())
      }
    } else if (phaseIdx <= 2) {
      const cur = s.objectivePosition
      if (!cur || cur.distanceToSquared(RELIQUARY_POSITION) > 0.01) {
        s.setObjectivePosition(RELIQUARY_POSITION.clone())
      }
    }
  })

  return (
    <group>
      {/* 9 — warm gold point at the Reliquary (ramps with purification) */}
      <pointLight
        ref={chamberGold}
        position={[0, 5, 150]}
        color={COLORS.aureate}
        intensity={2.5}
        distance={14}
        decay={2}
      />
      {/* gold vein practicals — pooled, ride the nearest modelled fixtures */}
      {Array.from({ length: GOLD_PRACTICALS }).map((_, i) => (
        <pointLight
          key={i}
          ref={(r) => {
            goldLights.current[i] = r
          }}
          color={LIGHTING.goldPractical.color}
          intensity={0}
          distance={LIGHTING.goldPractical.distance}
          decay={LIGHTING.goldPractical.decay}
        />
      ))}
      {/* 10 — extraction pad gold point (off until phase EXTRACT) */}
      <pointLight
        ref={padGold}
        position={[EXTRACTION_PAD_POSITION.x, 4, EXTRACTION_PAD_POSITION.z]}
        color={COLORS.aureate}
        intensity={0}
        distance={16}
        decay={2}
      />
    </group>
  )
}

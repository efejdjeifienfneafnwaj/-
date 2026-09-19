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
 */
import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { useGameStore } from '../store'
import { COLORS } from '../config'
import { RELIQUARY_POSITION, EXTRACTION_PAD_POSITION, BRIDGE_SEAL } from './layout'
import { registerCollider, unregisterCollider } from './Colliders'
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

export default function EnvironmentFX() {
  const chamberGold = useRef<THREE.PointLight>(null!)
  const padGold = useRef<THREE.PointLight>(null!)
  const sealColliderId = useRef<number | null>(null)

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

    // chamber gold light ramps 4 → 14 with the channel
    if (chamberGold.current) chamberGold.current.intensity = 4 + 10 * purify

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
      const target = s.phase === 'EXTRACT' || s.phase === 'WIN' ? 12 : 0
      padGold.current.intensity = THREE.MathUtils.lerp(padGold.current.intensity, target, 1 - Math.exp(-3 * dt))
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
        intensity={4}
        distance={14}
        decay={2}
      />
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

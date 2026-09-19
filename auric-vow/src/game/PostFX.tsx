/**
 * AURIC VOW — PostFX.tsx
 * Post stack per design.md §2.5 (in order):
 *   Bloom → Vignette → ChromaticAberration → Noise → SMAA
 * Dynamic behavior:
 *   - ChromaticAberration spikes to 0.004 while timeScale < 1 (heavy hits / Auric Requiem)
 *   - BrightnessContrast dips -0.05 during hitstop/slow-mo frames
 */
import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { EffectComposer, Bloom, Vignette, ChromaticAberration, Noise, SMAA, BrightnessContrast } from '@react-three/postprocessing'
import type { ChromaticAberrationEffect, BrightnessContrastEffect } from 'postprocessing'
import { Vector2 } from 'three'
import { POSTFX } from './config'
import { useGameStore, selectQualityTier } from './store'

const BASE_CA = POSTFX.chromaticAberration.baseOffset
const SPIKE_CA = POSTFX.chromaticAberration.spikeOffset

export default function PostFX() {
  const caRef = useRef<ChromaticAberrationEffect>(null)
  const bcRef = useRef<BrightnessContrastEffect>(null)
  const caTmp = useRef(new Vector2(BASE_CA, BASE_CA))
  // adaptive quality: tier 1 = cheaper bloom + no SMAA, tier 2 = no bloom/SMAA
  const qualityTier = useGameStore(selectQualityTier)

  useFrame((_, dt) => {
    const timeScale = useGameStore.getState().timeScale
    const target = timeScale < 1 ? SPIKE_CA : BASE_CA
    // smooth toward target so spikes feel like a shock, not a pop
    const k = Math.min(1, dt * (timeScale < 1 ? 20 : 6))
    const v = caTmp.current
    v.x += (target - v.x) * k
    v.y = v.x
    caRef.current?.offset.copy(v)
    if (bcRef.current) {
      const contrast = timeScale < 1 ? POSTFX.brightnessContrastHitstop : 0
      bcRef.current.contrast += (contrast - bcRef.current.contrast) * k
    }
  })

  return (
    <EffectComposer multisampling={0}>
      {qualityTier < 2 ? (
        <Bloom
          intensity={qualityTier === 1 ? POSTFX.bloom.intensity * 0.6 : POSTFX.bloom.intensity}
          luminanceThreshold={POSTFX.bloom.luminanceThreshold}
          luminanceSmoothing={POSTFX.bloom.luminanceSmoothing}
          mipmapBlur={POSTFX.bloom.mipmapBlur}
        />
      ) : null}
      <Vignette
        offset={POSTFX.vignette.offset}
        darkness={POSTFX.vignette.darkness}
        eskil={POSTFX.vignette.eskil}
      />
      <ChromaticAberration ref={caRef} offset={[BASE_CA, BASE_CA]} />
      <BrightnessContrast ref={bcRef} contrast={0} brightness={0} />
      <Noise opacity={POSTFX.noise.opacity} />
      {qualityTier === 0 ? <SMAA /> : null}
    </EffectComposer>
  )
}

/**
 * AURIC VOW — PostFX.tsx
 * Post stack, in order:
 *   SSAO → Bloom → Vignette → ChromaticAberration → HueSaturation →
 *   BrightnessContrast → SMAA → Noise
 *
 * [vfx R1] What changed and why:
 *
 * 1. THE BLOOM THRESHOLD IS RECLAIMED. Tone mapping runs in-material (the
 *    Canvas sets ACESFilmic + exposure), so everything lit arrives at the
 *    composer already compressed into LDR — lit ivory lands around 0.8. With
 *    the old 0.7 knee the entire building bloomed, which is exactly why the
 *    frames read as "a greybox with a bloom filter". The knee is now 1.0 and
 *    the only things authored ABOVE white are real energy: architecture
 *    emissives (MATERIALS.emissiveBoost 3.0), particle cores, trail spines,
 *    shockwave filaments and the three-layer energy shells. Intensity came
 *    down 1.25 → 0.9 and `radius` keeps the mip chain tight so discrete
 *    sources stay discrete.
 *
 * 2. CHROMATIC ABERRATION IS AN EVENT, NOT A STATE. It used to spike to
 *    0.004 for as long as `timeScale < 1`, i.e. a fat static rainbow fringe
 *    sitting over the whole ultimate. It is now an impulse: gameplay raises
 *    `VFXBus.caImpulse()`, this file eases it out over 0.12 s from a 0.0015
 *    peak, radially modulated so the centre of frame stays clean. A falling
 *    edge on timeScale also raises one, so hitstop from combat code that has
 *    never heard of this file still gets its kick.
 *
 * 3. AMBIENT OCCLUSION. Half-res SSAO with depth-aware upsampling, first in
 *    the chain so bloom and grade see occluded contact. It needs the extra
 *    NormalPass, so it is gated to qualityTier 0.
 *
 * 4. GRADE RESPONSE. Hitstop desaturates slightly; the Auric Requiem window
 *    (raised by the ability through `VFXBus.ultGradeWindow`) pushes
 *    saturation, brightness and contrast up on a 0.18 s ease so the nova
 *    reads as a light event instead of a white hole.
 *
 * The HUD is DOM, rendered in its own layer OUTSIDE the <Canvas>, so it is
 * already composited outside the EffectComposer output and picks up none of
 * the bloom, CA, vignette or grain.
 */
import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import {
  EffectComposer,
  Bloom,
  Vignette,
  ChromaticAberration,
  Noise,
  SMAA,
  SSAO,
  HueSaturation,
  BrightnessContrast,
} from '@react-three/postprocessing'
import type {
  ChromaticAberrationEffect,
  BrightnessContrastEffect,
  HueSaturationEffect,
} from 'postprocessing'
import { Vector2 } from 'three'
import { POSTFX } from './config'
import { useGameStore, selectQualityTier } from './store'
import { PostFxSignals, caImpulse, nowSec } from './vfx/VFXBus'

/**
 * Escape hatch for the capture harness: `?noao=1` drops the SSAO pass (and
 * the NormalPass that feeds it). AO is the one pass here that re-renders the
 * scene, so on a software rasteriser it is the only thing that materially
 * changes capture wall-clock time.
 */
const AO_DISABLED =
  typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('noao')

const CA = POSTFX.chromaticAberration
const GRADE = POSTFX.grade
const AO = POSTFX.ao

/** ease-out cubic, 1 at the impulse, 0 when it has decayed */
function impulseEnvelope(age: number, dur: number): number {
  if (age < 0 || age >= dur) return 0
  const k = 1 - age / dur
  return k * k * k
}

export default function PostFX() {
  const caRef = useRef<ChromaticAberrationEffect>(null)
  const bcRef = useRef<BrightnessContrastEffect>(null)
  const hsRef = useRef<HueSaturationEffect>(null)
  const caTmp = useRef(new Vector2(CA.baseOffset, CA.baseOffset))
  const prevTimeScale = useRef(1)
  const ultBlend = useRef(0)
  // adaptive quality: tier 1 = cheaper bloom + no SMAA/AO, tier 2 = no bloom
  const qualityTier = useGameStore(selectQualityTier)

  useFrame((_, dt) => {
    const timeScale = useGameStore.getState().timeScale
    const t = nowSec()
    // post response must run on WALL CLOCK: at timeScale 0.05 a game-time
    // decay would leave the shock frozen on screen for 20× too long
    const realDt = Math.min(dt, 0.1)

    // --- chromatic aberration: discrete impulse, radially modulated --------
    // any fall in timeScale (katana hitstop, ult dilation) is one shock
    if (timeScale < prevTimeScale.current - 1e-4) {
      caImpulse(timeScale < 0.15 ? 1 : 0.7)
    }
    prevTimeScale.current = timeScale

    const env = impulseEnvelope(t - PostFxSignals.caImpulseAt, CA.impulseSec)
    const target = CA.baseOffset + (CA.spikeOffset - CA.baseOffset) * env * PostFxSignals.caImpulseAmount
    const v = caTmp.current
    // snap toward a rising shock, glide back down
    const k = Math.min(1, realDt * (target > v.x ? 45 : 14))
    v.x += (target - v.x) * k
    v.y = v.x
    caRef.current?.offset.copy(v)

    // --- grade: hitstop dip, ultimate lift ---------------------------------
    const inUlt = t >= PostFxSignals.ultFrom && t < PostFxSignals.ultUntil
    const blendTarget = inUlt ? 1 : 0
    const bk = Math.min(1, realDt / Math.max(0.016, GRADE.ultEase))
    ultBlend.current += (blendTarget - ultBlend.current) * bk
    const u = ultBlend.current
    const hitstop = timeScale < 1 && !inUlt ? 1 : 0

    if (hsRef.current) {
      const sat = GRADE.ultSaturation * u + GRADE.hitstopSaturation * hitstop
      hsRef.current.saturation += (sat - hsRef.current.saturation) * bk
    }
    if (bcRef.current) {
      const contrast = GRADE.ultContrast * u + POSTFX.brightnessContrastHitstop * hitstop
      const brightness = GRADE.ultBrightness * u
      bcRef.current.contrast += (contrast - bcRef.current.contrast) * bk
      bcRef.current.brightness += (brightness - bcRef.current.brightness) * bk
    }
  })

  const aoOn = qualityTier === 0 && !AO_DISABLED

  return (
    <EffectComposer multisampling={0} enableNormalPass={aoOn}>
      {/* contact occlusion first: bloom and grade should see the darkened
          cavities, not composite over a flat frame (E1) */}
      {aoOn ? (
        <SSAO
          intensity={AO.intensity}
          radius={AO.radius}
          samples={AO.samples}
          rings={AO.rings}
          bias={AO.bias}
          fade={AO.fade}
          luminanceInfluence={AO.luminanceInfluence}
          resolutionScale={AO.resolutionScale}
          worldDistanceThreshold={AO.worldDistanceThreshold}
          worldDistanceFalloff={AO.worldDistanceFalloff}
          worldProximityThreshold={AO.worldProximityThreshold}
          worldProximityFalloff={AO.worldProximityFalloff}
        />
      ) : null}
      {qualityTier < 2 ? (
        <Bloom
          intensity={qualityTier === 1 ? POSTFX.bloom.intensity * 0.6 : POSTFX.bloom.intensity}
          luminanceThreshold={POSTFX.bloom.luminanceThreshold}
          luminanceSmoothing={POSTFX.bloom.luminanceSmoothing}
          mipmapBlur={POSTFX.bloom.mipmapBlur}
          radius={POSTFX.bloom.radius}
        />
      ) : null}
      <Vignette
        offset={POSTFX.vignette.offset}
        darkness={POSTFX.vignette.darkness}
        eskil={POSTFX.vignette.eskil}
      />
      <ChromaticAberration
        ref={caRef}
        offset={[CA.baseOffset, CA.baseOffset]}
        radialModulation={CA.radialModulation}
        modulationOffset={CA.modulationOffset}
      />
      <HueSaturation ref={hsRef} hue={0} saturation={0} />
      <BrightnessContrast ref={bcRef} contrast={0} brightness={0} />
      {/* AA before grain: SMAA is the only AA in the stack and should not be
          asked to resolve film noise (V18) */}
      {qualityTier === 0 ? <SMAA /> : null}
      <Noise opacity={POSTFX.noise.opacity} />
    </EffectComposer>
  )
}

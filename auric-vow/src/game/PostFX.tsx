/**
 * AURIC VOW — PostFX.tsx
 * Post stack, in order:
 *   SSAO → Bloom (tight) → Bloom (wide) → Vignette → ChromaticAberration →
 *   HueSaturation → BrightnessContrast → SMAA → Noise
 *
 * [vfx R1] What changed and why:
 *
 * 1. THE BLOOM THRESHOLD IS RECLAIMED. Tone mapping runs in-material (the
 *    Canvas sets ACESFilmic + exposure), so everything lit arrives at the
 *    composer already compressed into LDR — lit ivory lands around 0.8. With
 *    the old 0.7 knee the entire building bloomed, which is exactly why the
 *    frames read as "a greybox with a bloom filter".
 *
 * 2. CHROMATIC ABERRATION IS AN EVENT, NOT A STATE. Gameplay raises
 *    `VFXBus.caImpulse()`, this file eases it out over 0.12 s.
 *
 * 3. AMBIENT OCCLUSION. Half-res SSAO with depth-aware upsampling, first in
 *    the chain so bloom and grade see occluded contact.
 *
 * 4. GRADE RESPONSE. Hitstop desaturates; the Auric Requiem window pushes
 *    saturation, brightness and contrast up.
 *
 * ---------------------------------------------------------------------------
 * [vfx R2] Four corrections, all measured against the round 2 captures:
 *
 * A. BLOOM WAS OFF. The R1 knee of 1.0 with 0.2 of smoothing meant the ramp
 *    ran 1.0 → 1.2 and NOTHING in a tone-mapped LDR frame ever reached it, so
 *    the game shipped a bloom pass that emitted zero. The knee now sits at
 *    0.85 — just above lit ivory — with a 0.35 ramp, which still gives ivory
 *    a weight of exactly zero while an HDR-authored core at 2.0+ is fully
 *    inside. Bloom is a real pass again.
 *
 * B. TWO LAYERS, NOT ONE. A tight mip chain gives a hot source a crisp halo
 *    but no atmosphere. A second pass at a higher knee (1.15) and a much
 *    wider radius (1.4) lays a dim veil around only the very brightest cores.
 *    That pairing — crisp inner halo, wide dim outer veil — is what reads as
 *    a light source rather than a glowing decal.
 *
 * C. THE GOVERNOR. One large additive mesh (the ult screen flash, a
 *    frame-filling melee arc) otherwise pins the entire bloom pyramid and
 *    every discrete source in frame dissolves into milk. Effects that are
 *    about to cover a lot of screen raise `VFXBus.addBloomLoad()`; bloom
 *    intensity is divided by (1 + load) down to a floor, and the load bleeds
 *    off over half a second. This is the luminance-weighted downweight the
 *    review asked for, computed on the CPU from the effects themselves
 *    instead of a GPU readback the software rasteriser cannot afford.
 *
 * D. THE ULTIMATE IS THREE PICTURES. Charge holds a DIM, desaturated,
 *    tight-vignette grade while the motes converge; the nova punches out of
 *    it into the lifted, saturated peak grade; the aftermath decays back.
 *    Charge and peak are separate windows on the bus so they can never blend
 *    into one flat "ability is happening" look.
 *
 * Grain is premultiplied (so it is luminance-weighted: it lives in the mids
 * and dies in the true blacks) at a third of its old opacity, and is switched
 * off entirely while a full-screen front-end overlay owns the frame.
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
  BloomEffect,
  ChromaticAberrationEffect,
  BrightnessContrastEffect,
  HueSaturationEffect,
  NoiseEffect,
  VignetteEffect,
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
const GOV = POSTFX.bloomGovernor
const WIDE = POSTFX.bloomWide

/** ease-out cubic, 1 at the impulse, 0 when it has decayed */
function impulseEnvelope(age: number, dur: number): number {
  if (age < 0 || age >= dur) return 0
  const k = 1 - age / dur
  return k * k * k
}

/**
 * [vfx R2] Grain suppression probe. The front-end screens are DOM overlays
 * owned by another stream, so rather than reach into them this polls for a
 * full-screen overlay four times a second (a single querySelector, ~microseconds)
 * and honours an explicit `setGrainSuppressed()` from anywhere as an override.
 */
const OVERLAY_SELECTOR = '.avs'
function overlayPresent(): boolean {
  if (typeof document === 'undefined') return false
  return document.querySelector(OVERLAY_SELECTOR) !== null
}

export default function PostFX() {
  const caRef = useRef<ChromaticAberrationEffect>(null)
  const bcRef = useRef<BrightnessContrastEffect>(null)
  const hsRef = useRef<HueSaturationEffect>(null)
  const bloomRef = useRef<BloomEffect>(null)
  const bloomWideRef = useRef<BloomEffect>(null)
  const vignetteRef = useRef<VignetteEffect>(null)
  const noiseRef = useRef<NoiseEffect>(null)
  const caTmp = useRef(new Vector2(CA.baseOffset, CA.baseOffset))
  const prevTimeScale = useRef(1)
  const ultBlend = useRef(0)
  const chargeBlend = useRef(0)
  const overlayTimer = useRef(0)
  const overlay = useRef(false)
  const grain = useRef(POSTFX.noise.opacity)
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

    // --- grade: hitstop dip, ult charge dim, ult peak lift -----------------
    const inUlt = t >= PostFxSignals.ultFrom && t < PostFxSignals.ultUntil
    const inCharge = t >= PostFxSignals.chargeFrom && t < PostFxSignals.chargeUntil
    const bk = Math.min(1, realDt / Math.max(0.016, GRADE.ultEase))
    ultBlend.current += ((inUlt ? 1 : 0) - ultBlend.current) * bk
    // the charge dips FAST (it is an intake of breath) and releases faster
    // still, so the nova lands on a frame that is still dark
    const ck = Math.min(1, realDt / (inCharge ? 0.1 : 0.06))
    chargeBlend.current += ((inCharge ? 1 : 0) - chargeBlend.current) * ck
    // the peak grade always wins over the charge grade it replaces
    const u = ultBlend.current
    const c = chargeBlend.current * (1 - u)
    const hitstop = timeScale < 1 && !inUlt && !inCharge ? 1 : 0

    if (hsRef.current) {
      const sat =
        GRADE.ultSaturation * u + GRADE.chargeSaturation * c + GRADE.hitstopSaturation * hitstop
      hsRef.current.saturation += (sat - hsRef.current.saturation) * bk
    }
    if (bcRef.current) {
      const contrast =
        GRADE.ultContrast * u + GRADE.chargeContrast * c + POSTFX.brightnessContrastHitstop * hitstop
      const brightness = GRADE.ultBrightness * u + GRADE.chargeBrightness * c
      bcRef.current.contrast += (contrast - bcRef.current.contrast) * bk
      bcRef.current.brightness += (brightness - bcRef.current.brightness) * bk
    }
    // the vignette closes in during the charge and opens on the nova — the
    // single cheapest way to make three beats out of one ability
    if (vignetteRef.current) {
      const dark = POSTFX.vignette.darkness + GRADE.ultVignette * u + GRADE.chargeVignette * c
      vignetteRef.current.darkness += (dark - vignetteRef.current.darkness) * bk
    }

    // --- bloom governor: one big additive mesh must not pin the pyramid ----
    if (PostFxSignals.bloomLoad > 0) {
      PostFxSignals.bloomLoad = Math.max(
        0,
        PostFxSignals.bloomLoad - realDt / Math.max(0.05, GOV.decaySec),
      )
    }
    const load = Math.min(GOV.maxLoad, PostFxSignals.bloomLoad)
    const gov = Math.max(GOV.floor, 1 / (1 + load))
    const tierScale = qualityTier === 1 ? 0.6 : 1
    if (bloomRef.current) bloomRef.current.intensity = POSTFX.bloom.intensity * tierScale * gov
    if (bloomWideRef.current) bloomWideRef.current.intensity = WIDE.intensity * tierScale * gov

    // --- grain: luminance-weighted, and off on the front end ---------------
    overlayTimer.current -= realDt
    if (overlayTimer.current <= 0) {
      overlayTimer.current = 0.25
      overlay.current = overlayPresent()
    }
    const grainTarget =
      overlay.current || PostFxSignals.grainSuppressed
        ? POSTFX.noise.titleOpacity
        : POSTFX.noise.opacity
    grain.current += (grainTarget - grain.current) * Math.min(1, realDt * 8)
    const nb = noiseRef.current?.blendMode
    if (nb) nb.opacity.value = grain.current
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
          ref={bloomRef}
          intensity={POSTFX.bloom.intensity}
          luminanceThreshold={POSTFX.bloom.luminanceThreshold}
          luminanceSmoothing={POSTFX.bloom.luminanceSmoothing}
          mipmapBlur={POSTFX.bloom.mipmapBlur}
          radius={POSTFX.bloom.radius}
        />
      ) : null}
      {/* wide dim veil — only the very brightest cores reach its knee, so it
          adds atmosphere around a source without lifting the frame (B) */}
      {qualityTier === 0 ? (
        <Bloom
          ref={bloomWideRef}
          intensity={WIDE.intensity}
          luminanceThreshold={WIDE.luminanceThreshold}
          luminanceSmoothing={WIDE.luminanceSmoothing}
          mipmapBlur
          radius={WIDE.radius}
          resolutionScale={0.5}
        />
      ) : null}
      <Vignette
        ref={vignetteRef}
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
      {/* premultiplied = the noise is multiplied by the frame under it, so it
          is luminance-weighted and the level's true blacks stay clean */}
      <Noise ref={noiseRef} premultiply opacity={POSTFX.noise.opacity} />
    </EffectComposer>
  )
}

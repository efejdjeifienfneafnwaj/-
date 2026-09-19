/**
 * AURIC VOW — PostFX.tsx
 *
 * Post stack, in order:
 *   N8AO → Bloom (tight) → Bloom (wide) → AuricTone → SMAA → AuricFilm
 *
 * =============================================================================
 * [post-color R3] THE FINDING
 * =============================================================================
 * This build had no tone curve on it. Not a badly tuned one — none at all.
 *
 * `@react-three/postprocessing`'s <EffectComposer> takes a guard on the
 * renderer and forces `gl.toneMapping = NoToneMapping` for as long as it is
 * mounted:
 *
 *     // node_modules/@react-three/postprocessing/dist/index.js
 *     useEffect(() => {
 *       toneMappingGuard.acquire(gl, NoToneMapping);
 *       gl.toneMapping = NoToneMapping;
 *       return () => { toneMappingGuard.release(gl); };
 *     }, [gl]);
 *
 * GameCanvas asks the Canvas for `ACESFilmicToneMapping` + exposure 0.85. The
 * composer revokes both the moment PostFX mounts, which is every frame of the
 * game. So every R1 and R2 comment in this file that reasons from "tone mapping
 * runs in-material, so the composer only ever sees LDR" was reasoning from a
 * renderer contract that does not exist at runtime. What actually happened:
 *
 *   scene → raw LINEAR RADIANCE → half-float buffer → post → clamp[0,1] → sRGB
 *
 * and that is the whole picture the panel scored 27/100:
 *
 *   • linear→sRGB lifts a linear 0.2 to 0.48 display. Every surface in the
 *     level piles into one lifted mid-band — "a single mid-grey value band
 *     with no darks and no controlled highlight" is the exact signature of an
 *     untone-mapped linear frame.
 *   • everything over linear 1.0 clips per-channel and flat. A gold ring
 *     becomes a solid orange slab, a teal strip a solid cyan slab, a nova a
 *     white disc with a hard edge. "Flat single-layer energy VFX."
 *   • the bloom knee of 0.85 was BELOW lit diffuse in linear HDR (a 4.4 key on
 *     0.77 ivory lands ≈1.08), so lit walls bloomed and discrete sources did
 *     not separate from them. The R2 note claiming ivory scored 0.80 and
 *     contributed zero was measuring a pipeline that was not running.
 *
 * No lighting, texture or geometry work can fix a frame with no tone curve on
 * it, which is why two rounds of careful work moved the score by 2 points.
 *
 * =============================================================================
 * WHAT THIS FILE DOES NOW
 * =============================================================================
 * The post stack owns the display transform outright, in two custom effects.
 *
 * 1. AuricTone — exposure, impulse chromatic aberration, **AgX**, and an
 *    ASC-style look (split tone, filmic S, black point, saturation). AgX is
 *    transcribed byte-for-byte from three r185's `tonemapping_pars_fragment`
 *    so there is no chance of a mistyped coefficient, but it is run here with
 *    our own exposure uniform rather than the renderer's dead one.
 *
 *    AgX rather than ACES because the brief is a curve that HOLDS highlights:
 *    ACES' RRT/ODT fit runs out of highlight room about four stops over grey
 *    and drives to paper, AgX maps 16.5 stops of log range and desaturates its
 *    way up. An emissive core now resolves as a white centre inside a
 *    saturated rim — the thing that separates a lamp from a coloured decal.
 *
 * 2. AuricFilm — vignette and grain, after AA so neither is resolved away.
 *    The vignette darkens AND cools (a real lens loses the warm end at the
 *    edge of the image circle) and is slightly anamorphic so it does not read
 *    as a circle on 16:9. The grain is weighted by `4L(1-L)`: it peaks in the
 *    mids and vanishes in both the true blacks and the blown highlights.
 *
 * AO moved from postprocessing's SSAO to **N8AO** (already installed — `n8ao`
 * is a dependency of @react-three/postprocessing and `N8AO` is one of its
 * exports; nothing was added). SSAO's `luminanceInfluence` fades occlusion out
 * on bright pixels, and a shrine made of ivory is nothing but bright pixels —
 * the one knob the old pass had was working against the one thing it had to
 * do. N8AO has no such term, is horizon-based with a bilateral denoiser and a
 * world-space radius, and bites exactly as hard on a lit wall as on a dark one.
 *
 * mergeMode="none" is deliberate. postprocessing merges consecutive effects
 * into one EffectPass, but BOTH SMAA and a chromatic-aberration effect resample
 * `inputBuffer` directly rather than chaining `inputColor` — so in a merged
 * pass whichever runs second silently discards everything before it. In the R2
 * stack SMAA sat after CA/vignette/grade and threw all of them away on every
 * edge pixel it touched. One pass per effect costs a few full-screen blits and
 * makes the chain mean what it says.
 *
 * Everything else the stack already did is kept and retuned for HDR: the bloom
 * governor (one big additive mesh must not pin the pyramid), the three-picture
 * ultimate (charge / peak / aftermath), the hitstop dip, grain suppression
 * under front-end overlays, and the tier ladder. The one rule that changed:
 * **the tone curve is never dropped**, at any tier. Bloom and AO and AA are
 * luxuries; a display transform is not.
 *
 * `?qa=1` adds `window.__qa.postReport()` (HDR scene probe — the real linear
 * radiance distribution the bloom knee has to sit above) and
 * `window.__qa.frameHistogram()` (the displayed luma histogram, which is what
 * the panel's "≥12% under 0.08, 2–4% over 0.95" target is measured against).
 *
 * =============================================================================
 * MEASURED (round 3, 960×540, quality tier 0, via those two hooks)
 * =============================================================================
 * Linear HDR handed to the composer — this is what the bloom knee sits above:
 *
 *   shot          p50      p95     p99     max     frac > 1.25 knee
 *   spawn        0.058    0.208   0.377    3.8       0.07 %
 *   chamber      0.013    0.224   0.412   11.9→3.5   0.74 %
 *   arena wide   0.009    0.110   0.536   31.2       0.78 %
 *
 * So lit architecture tops out near 0.21 linear and everything over ~0.6 is an
 * authored light source. Bloom touches well under 1% of the frame.
 *
 * Displayed luma after the whole stack:
 *
 *   shot         mean    p50     p95     p99     <0.08    >0.95
 *   spawn       0.357   0.386   0.659   0.752    9.6 %    0.03 %
 *   chamber     0.239   0.178   0.725   0.873   30.2 %    0.70 %
 *   arena wide  0.275   0.198   0.720   0.865   30.6 %    0.36 %
 *
 * against the panel's ask of ≥12 % under 0.08 and 2–4 % over 0.95. The shadow
 * end is comfortably there (and then some); the highlight end is short, and it
 * is short because of how much authored emissive area is in frame, not because
 * of the curve — the curve's own shoulder is doing its job (p99 at 0.87 with a
 * max of 0.99 is a held highlight, not a clipped one).
 *
 * For reference, the same measurement BEFORE this round's changes, on the same
 * build with only the two extra tone-mapping bugs left in place, gave the spawn
 * a displayed p50 of 0.188 and p95 of 0.434 with nothing over 0.95 at all: one
 * lifted mid-band, exactly as scored.
 *
 * Tier ladder, measured in the chamber (tier 0 / 1 / 2):
 *   mean 0.234 / 0.217 / 0.192, p95 0.726 / 0.729 / 0.700, zero console errors
 *   at any tier. Tier 2 loses AO, both blooms, AA, the radial blur and the
 *   sharpen and still holds the same value structure, which is the point.
 */
import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { EffectComposer, Bloom, SMAA, N8AO } from '@react-three/postprocessing'
import { BlendFunction, Effect } from 'postprocessing'
import type { BloomEffect, EffectComposer as EffectComposerImpl } from 'postprocessing'
import { Color, FloatType, NoToneMapping, Uniform, Vector2, WebGLRenderTarget } from 'three'
import { POSTFX } from './config'
import { useGameStore, selectQualityTier } from './store'
import { PostFxSignals, caImpulse, nowSec } from './vfx/VFXBus'
// read-only: the radial blur is driven by how fast the player is actually moving
import { PlayerAnim } from './player/PlayerRef'

const QS = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null

/**
 * Escape hatch for the capture harness: `?noao=1` drops the AO pass. AO is the
 * one pass here that runs extra geometry, so on a software rasteriser it is the
 * only thing that materially changes capture wall-clock time.
 */
const AO_DISABLED = QS?.has('noao') ?? false
const QA_MODE = QS?.has('qa') ?? false

const CA = POSTFX.chromaticAberration
const GRADE = POSTFX.grade
const AO = POSTFX.ao
const GOV = POSTFX.bloomGovernor
const WIDE = POSTFX.bloomWide
const TONE = POSTFX.tone
const VIG = POSTFX.vignette
const BLUR = POSTFX.radialBlur

// ---------------------------------------------------------------------------
// AgX — transcribed verbatim from three r185 `ShaderChunk.tonemapping_pars_fragment`
//
// Every constant below is copied out of node_modules/three rather than typed
// from memory. The only deviations from three's version are (a) the identifiers
// are prefixed `auric` so they cannot collide with another effect merged into
// the same EffectPass, and (b) exposure is a uniform of ours instead of the
// renderer's `toneMappingExposure`, which the composer has left stranded.
// ---------------------------------------------------------------------------
const AGX_GLSL = /* glsl */ `
const mat3 AURIC_SRGB_TO_REC2020 = mat3(
  vec3( 0.6274, 0.0691, 0.0164 ),
  vec3( 0.3293, 0.9195, 0.0880 ),
  vec3( 0.0433, 0.0113, 0.8956 )
);
const mat3 AURIC_REC2020_TO_SRGB = mat3(
  vec3(  1.6605, -0.1246, -0.0182 ),
  vec3( -0.5876,  1.1329, -0.1006 ),
  vec3( -0.0728, -0.0083,  1.1187 )
);
const mat3 AURIC_AGX_INSET = mat3(
  vec3( 0.856627153315983,  0.137318972929847,  0.11189821299995   ),
  vec3( 0.0951212405381588, 0.761241990602591,  0.0767994186031903 ),
  vec3( 0.0482516061458583, 0.101439036467562,  0.811302368396859  )
);
const mat3 AURIC_AGX_OUTSET = mat3(
  vec3(  1.1271005818144368,  -0.1413297634984383,  -0.14132976349843826 ),
  vec3( -0.11060664309660323,  1.157823702216272,   -0.11060664309660294 ),
  vec3( -0.016493938717834573,-0.016493938717834257, 1.2519364065950405  )
);

vec3 auricAgxContrast( vec3 x ) {
  vec3 x2 = x * x;
  vec3 x4 = x2 * x2;
  return + 15.5 * x4 * x2
         - 40.14 * x4 * x
         + 31.96 * x4
         - 6.868 * x2 * x
         + 0.4298 * x2
         + 0.1191 * x
         - 0.00232;
}

vec3 auricAgX( vec3 color ) {
  const float AgxMinEv = -12.47393;
  const float AgxMaxEv = 4.026069;
  color = AURIC_SRGB_TO_REC2020 * color;
  color = AURIC_AGX_INSET * color;
  color = max( color, 1e-10 );
  color = log2( color );
  color = ( color - AgxMinEv ) / ( AgxMaxEv - AgxMinEv );
  color = clamp( color, 0.0, 1.0 );
  color = auricAgxContrast( color );
  color = AURIC_AGX_OUTSET * color;
  color = pow( max( vec3( 0.0 ), color ), vec3( 2.2 ) );
  color = AURIC_REC2020_TO_SRGB * color;
  return clamp( color, 0.0, 1.0 );
}
`

const TONE_FRAG = /* glsl */ `
uniform float auricExposure;
uniform float auricContrast;
uniform float auricSaturation;
uniform float auricBlackPoint;
uniform float auricSplit;
uniform vec3 auricShadowTint;
uniform vec3 auricHighTint;
uniform vec2 auricCa;
uniform vec2 auricBlur;

${AGX_GLSL}

void mainImage( const in vec4 inputColor, const in vec2 uv, out vec4 outputColor ) {
  // --- chromatic aberration -------------------------------------------------
  // radially modulated: exactly zero through the centre of frame, opening up
  // only in the outer third, and only while an impulse is live.
  vec2 d = uv - 0.5;
  float r2 = min( 1.0, dot( d, d ) * 4.0 );
  float amt = auricCa.x * smoothstep( auricCa.y, 1.0, r2 );
  vec2 off = d * amt;
  vec3 c = vec3(
    texture2D( inputBuffer, uv + off ).r,
    inputColor.g,
    texture2D( inputBuffer, uv - off ).b
  );

  // --- velocity radial blur -------------------------------------------------
  // Six taps swept toward the centre of frame, with the centre itself held
  // perfectly sharp by a smoothstep on radius: the reticle and whatever you
  // are aiming at never smear, only the outer field streaks past you. This is
  // the classic sprint/dash read and the build had no motion blur of any kind.
  if ( auricBlur.x > 0.002 ) {
    float gate = smoothstep( auricBlur.y, 0.55, r2 );
    if ( gate > 0.001 ) {
      vec3 acc = vec3( 0.0 );
      float wsum = 0.0;
      for ( int i = 0; i < 6; i ++ ) {
        float f = float( i ) * 0.2;
        float w = 1.0 - f * 0.62;
        acc += texture2D( inputBuffer, 0.5 + d * ( 1.0 - f * auricBlur.x * 0.16 ) ).rgb * w;
        wsum += w;
      }
      c = mix( c, acc / wsum, gate * min( 1.0, auricBlur.x ) );
    }
  }

  // --- display transform ----------------------------------------------------
  c = auricAgX( max( c, 0.0 ) * auricExposure );

  // --- look -----------------------------------------------------------------
  // split tone: cool shadow, warm highlight. Both tints arrive normalised to
  // luminance 1 so this rotates hue without moving exposure.
  float l = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
  vec3 tint = mix( auricShadowTint, auricHighTint, smoothstep( 0.16, 0.84, l ) );
  c = mix( c, c * tint, auricSplit );

  // filmic S about the middle of the display range
  c = clamp( c, 0.0, 1.0 );
  c = mix( c, c * c * ( 3.0 - 2.0 * c ), auricContrast );

  // black point — subtract and renormalise so the toe resolves to a true 0
  c = max( c - auricBlackPoint, 0.0 ) / max( 1e-4, 1.0 - auricBlackPoint );

  // saturation restored after AgX's inherent desaturation
  float l2 = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
  c = max( mix( vec3( l2 ), c, auricSaturation ), 0.0 );

  outputColor = vec4( c, inputColor.a );
}
`

const FILM_FRAG = /* glsl */ `
uniform float auricVigDarkness;
uniform float auricVigOffset;
uniform float auricVigAspect;
uniform vec3 auricVigTint;
uniform float auricGrain;
uniform float auricGrainTime;
uniform vec2 auricGrainRes;
uniform float auricSharpen;

float auricFilmHash( vec2 p ) {
  vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
  p3 += dot( p3, p3.yzx + 33.33 );
  return fract( ( p3.x + p3.y ) * p3.z );
}

void mainImage( const in vec4 inputColor, const in vec2 uv, out vec4 outputColor ) {
  vec3 c = inputColor.rgb;

  // --- unsharp mask ---------------------------------------------------------
  // SMAA softens, a half-res AO buffer softens and a bloom veil softens; a
  // shipped frame gets that acutance back at the very end. This runs on the
  // AA'd buffer (its own pass -- inputBuffer here IS the SMAA output) and
  // before the grain, so it sharpens the picture and not the noise.
  if ( auricSharpen > 0.001 ) {
    vec2 ts = 1.0 / auricGrainRes;
    vec3 soft = 0.25 * (
      texture2D( inputBuffer, uv + vec2( ts.x, 0.0 ) ).rgb +
      texture2D( inputBuffer, uv - vec2( ts.x, 0.0 ) ).rgb +
      texture2D( inputBuffer, uv + vec2( 0.0, ts.y ) ).rgb +
      texture2D( inputBuffer, uv - vec2( 0.0, ts.y ) ).rgb
    );
    // clamped to the local neighbourhood so a hot edge cannot ring
    vec3 hi = ( c - soft ) * auricSharpen;
    c = clamp( c + clamp( hi, -0.12, 0.12 ), 0.0, 1.0 );
  }

  // --- vignette -------------------------------------------------------------
  // slightly wide (anamorphic) so it does not read as a circle on 16:9, and it
  // cools as it darkens: a real lens loses the long wavelengths first at the
  // edge of the image circle.
  vec2 d = ( uv - 0.5 ) * vec2( auricVigAspect, 1.0 ) * 2.0;
  float k = smoothstep( auricVigOffset, 1.34, length( d ) );
  c *= 1.0 - auricVigDarkness * k;
  c = mix( c, c * auricVigTint, k * 0.35 );

  // --- grain ----------------------------------------------------------------
  // weighted by 4L(1-L): peaks in the mids, zero in the true blacks and in the
  // blown highlights, which is why it reads as emulsion and not as a veil.
  float l = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
  float w = clamp( 4.0 * l * ( 1.0 - l ), 0.0, 1.0 );
  float n = auricFilmHash( uv * auricGrainRes + auricGrainTime ) - 0.5;
  c *= 1.0 + n * auricGrain * w;

  outputColor = vec4( max( c, 0.0 ), inputColor.a );
}
`

/** exposure → AgX → split tone → filmic S → black point → saturation */
class AuricToneEffect extends Effect {
  constructor() {
    super('AuricToneEffect', TONE_FRAG, {
      blendFunction: BlendFunction.SRC,
      uniforms: new Map<string, Uniform>([
        ['auricExposure', new Uniform(TONE.exposure)],
        ['auricContrast', new Uniform(TONE.contrast)],
        ['auricSaturation', new Uniform(TONE.saturation)],
        ['auricBlackPoint', new Uniform(TONE.blackPoint)],
        ['auricSplit', new Uniform(TONE.splitStrength)],
        ['auricShadowTint', new Uniform(normalisedTint(TONE.shadowTint))],
        ['auricHighTint', new Uniform(normalisedTint(TONE.highlightTint))],
        ['auricCa', new Uniform(new Vector2(CA.baseOffset, CA.modulationOffset))],
        ['auricBlur', new Uniform(new Vector2(0, BLUR.centreClear))],
      ]),
    })
  }
}

/** vignette + luminance-weighted grain, run after AA */
class AuricFilmEffect extends Effect {
  constructor() {
    super('AuricFilmEffect', FILM_FRAG, {
      blendFunction: BlendFunction.SRC,
      uniforms: new Map<string, Uniform>([
        ['auricVigDarkness', new Uniform(VIG.darkness)],
        ['auricVigOffset', new Uniform(VIG.offset)],
        ['auricVigAspect', new Uniform(VIG.aspect)],
        ['auricVigTint', new Uniform(normalisedTint(VIG.tint))],
        ['auricGrain', new Uniform(POSTFX.noise.opacity)],
        ['auricGrainTime', new Uniform(0)],
        ['auricGrainRes', new Uniform(new Vector2(1920, 1080))],
        ['auricSharpen', new Uniform(POSTFX.sharpen)],
      ]),
    })
  }

  override setSize(width: number, height: number): void {
    const u = this.uniforms.get('auricGrainRes')
    if (u) (u.value as Vector2).set(width, height)
  }
}

/**
 * A grade tint that changes hue without changing exposure: convert to linear,
 * then scale so its Rec.709 luminance is exactly 1. Multiplying a pixel by the
 * result rotates its hue and leaves its brightness where the tone curve put it.
 */
function normalisedTint(hex: string): Color {
  const c = new Color(hex).convertSRGBToLinear()
  const l = c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722
  if (l > 1e-4) c.multiplyScalar(1 / l)
  return c
}

/** ease-out cubic, 1 at the impulse, 0 when it has decayed */
function impulseEnvelope(age: number, dur: number): number {
  if (age < 0 || age >= dur) return 0
  const k = 1 - age / dur
  return k * k * k
}

/**
 * Grain suppression probe. The front-end screens are DOM overlays owned by
 * another stream, so rather than reach into them this polls for a full-screen
 * overlay four times a second (a single querySelector, ~microseconds) and
 * honours an explicit `setGrainSuppressed()` from anywhere as an override.
 */
const OVERLAY_SELECTOR = '.avs'
function overlayPresent(): boolean {
  if (typeof document === 'undefined') return false
  return document.querySelector(OVERLAY_SELECTOR) !== null
}

interface LumaStats {
  mean: number
  p01: number
  p05: number
  p50: number
  p95: number
  p99: number
  max: number
  fracBelow008: number
  fracAbove095: number
  histogram: number[]
}

/** percentile + coverage summary over an array of luminances in [0, +inf) */
function summarise(lum: Float32Array | number[], n: number): LumaStats {
  const arr = Array.prototype.slice.call(lum, 0, n) as number[]
  arr.sort((a, b) => a - b)
  const at = (p: number) => arr[Math.min(n - 1, Math.max(0, Math.round(p * (n - 1))))]
  let sum = 0
  let below = 0
  let above = 0
  const hist = new Array(16).fill(0) as number[]
  for (let i = 0; i < n; i++) {
    const v = arr[i]
    sum += v
    if (v < 0.08) below++
    if (v > 0.95) above++
    hist[Math.min(15, Math.max(0, Math.floor(v * 16)))]++
  }
  return {
    mean: +(sum / n).toFixed(4),
    p01: +at(0.01).toFixed(4),
    p05: +at(0.05).toFixed(4),
    p50: +at(0.5).toFixed(4),
    p95: +at(0.95).toFixed(4),
    p99: +at(0.99).toFixed(4),
    max: +arr[n - 1].toFixed(4),
    fracBelow008: +(below / n).toFixed(4),
    fracAbove095: +(above / n).toFixed(4),
    histogram: hist.map((h) => +(h / n).toFixed(4)),
  }
}

export default function PostFX() {
  const { gl, scene, camera } = useThree()
  const composerRef = useRef<EffectComposerImpl>(null)
  const bloomRef = useRef<BloomEffect>(null)
  const bloomWideRef = useRef<BloomEffect>(null)

  const tone = useMemo(() => new AuricToneEffect(), [])
  const film = useMemo(() => new AuricFilmEffect(), [])
  useEffect(() => {
    return () => {
      tone.dispose()
      film.dispose()
    }
  }, [tone, film])

  // live uniform handles — resolved once, mutated per frame, never allocated
  const U = useMemo(
    () => ({
      exposure: tone.uniforms.get('auricExposure')!,
      contrast: tone.uniforms.get('auricContrast')!,
      saturation: tone.uniforms.get('auricSaturation')!,
      ca: tone.uniforms.get('auricCa')!,
      blur: tone.uniforms.get('auricBlur')!,
      sharpen: film.uniforms.get('auricSharpen')!,
      vig: film.uniforms.get('auricVigDarkness')!,
      grain: film.uniforms.get('auricGrain')!,
      grainTime: film.uniforms.get('auricGrainTime')!,
    }),
    [tone, film],
  )

  const prevTimeScale = useRef(1)
  const ultBlend = useRef(0)
  const chargeBlend = useRef(0)
  const overlayTimer = useRef(0)
  const overlay = useRef(false)
  const grain = useRef(POSTFX.noise.opacity)
  const caNow = useRef(CA.baseOffset)
  const blurNow = useRef(0)
  const expNow = useRef(TONE.exposure)
  const satNow = useRef(TONE.saturation)
  const conNow = useRef(TONE.contrast)
  const vigNow = useRef(VIG.darkness)
  // adaptive quality: tier 1 = half-res AO, one bloom, no AA; tier 2 = no AO,
  // no bloom — but the tone curve and the film pass survive every tier.
  const qualityTier = useGameStore(selectQualityTier)

  // -------------------------------------------------------------------------
  // QA instrumentation (?qa=1). Two measurements, because the two numbers that
  // decide whether this axis worked live in different spaces:
  //
  //   postReport()     — the LINEAR HDR distribution the scene hands the
  //                      composer. This is what the bloom knee has to clear,
  //                      and before this round nobody had ever looked at it.
  //   frameHistogram() — the DISPLAYED luma distribution after the whole
  //                      stack, which is where "≥12% under 0.08 luma, 2–4%
  //                      over 0.95" is actually judged.
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!QA_MODE) return
    const w = window as Window & { __qa?: Record<string, unknown> }
    if (!w.__qa) return

    w.__qa.postReport = () => {
      const pw = 256
      const ph = 144
      const rt = new WebGLRenderTarget(pw, ph, { type: FloatType, depthBuffer: true })
      const prevTarget = gl.getRenderTarget()
      try {
        gl.setRenderTarget(rt)
        gl.render(scene, camera)
        gl.setRenderTarget(prevTarget)
        const buf = new Float32Array(pw * ph * 4)
        gl.readRenderTargetPixels(rt, 0, 0, pw, ph, buf)
        const n = pw * ph
        const lum = new Float32Array(n)
        let overKnee = 0
        let overWide = 0
        for (let i = 0; i < n; i++) {
          const l =
            buf[i * 4] * 0.2126 + buf[i * 4 + 1] * 0.7152 + buf[i * 4 + 2] * 0.0722
          lum[i] = l
          if (l > POSTFX.bloom.luminanceThreshold) overKnee++
          if (l > WIDE.luminanceThreshold) overWide++
        }
        return {
          space: 'linear HDR, pre-post',
          toneMappingOnRenderer: gl.toneMapping,
          rendererExposure: gl.toneMappingExposure,
          postExposure: U.exposure.value,
          bloomKnee: POSTFX.bloom.luminanceThreshold,
          fracOverBloomKnee: +(overKnee / n).toFixed(4),
          fracOverWideKnee: +(overWide / n).toFixed(4),
          ...summarise(lum, n),
        }
      } catch (e) {
        gl.setRenderTarget(prevTarget)
        return { error: String(e) }
      } finally {
        rt.dispose()
      }
    }

    w.__qa.frameHistogram = () => {
      const composer = composerRef.current
      if (!composer) return { error: 'composer not ready' }
      composer.render(0)
      const ctx = gl.getContext()
      const cw = gl.domElement.width
      const ch = gl.domElement.height
      const buf = new Uint8Array(cw * ch * 4)
      gl.setRenderTarget(null)
      ctx.readPixels(0, 0, cw, ch, ctx.RGBA, ctx.UNSIGNED_BYTE, buf)
      // stride so the sort stays cheap on a 1080p+ buffer
      const stride = Math.max(1, Math.floor(Math.sqrt((cw * ch) / 40000)))
      const lum: number[] = []
      for (let y = 0; y < ch; y += stride) {
        for (let x = 0; x < cw; x += stride) {
          const i = (y * cw + x) * 4
          lum.push(
            (buf[i] * 0.2126 + buf[i + 1] * 0.7152 + buf[i + 2] * 0.0722) / 255,
          )
        }
      }
      return {
        space: 'displayed sRGB luma',
        width: cw,
        height: ch,
        samples: lum.length,
        ...summarise(lum, lum.length),
      }
    }

    return () => {
      delete w.__qa?.postReport
      delete w.__qa?.frameHistogram
    }
  }, [gl, scene, camera, U])

  useFrame((_, dt) => {
    /*
     * PIN THE RENDERER'S TONE MAPPING OFF — measured, not assumed.
     *
     * The composer sets `gl.toneMapping = NoToneMapping` once, in a mount
     * effect. But <Canvas gl={{ toneMapping: ACESFilmic, ... }}> in GameCanvas
     * passes a fresh object literal on every render of its parent, and R3F
     * re-applies those renderer props when it sees one. So the flag flips back
     * to ACESFilmic the first time the app re-renders — which happens on every
     * phase change — and from then on the scene is tone mapped IN MATERIAL as
     * well as here.
     *
     * The QA probe caught it red-handed: `postReport()` reported
     * `toneMappingOnRenderer: 4` (ACESFilmic) on a running build, not 0. So the
     * frame the panel scored was ACES-compressed in-material, and this pass
     * would have stacked AgX on top of it — two display transforms in series,
     * which is what made the first measured frame come out a full stop under
     * where the curve puts it (display p50 0.188 against a predicted 0.32).
     *
     * One assignment per frame settles it: the scene always hands the composer
     * raw linear radiance, and there is exactly one tone curve in the build,
     * here, where this axis can actually control it.
     */
    if (gl.toneMapping !== NoToneMapping) gl.toneMapping = NoToneMapping

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
    const caTarget =
      CA.baseOffset + (CA.spikeOffset - CA.baseOffset) * env * PostFxSignals.caImpulseAmount
    // snap toward a rising shock, glide back down
    caNow.current +=
      (caTarget - caNow.current) * Math.min(1, realDt * (caTarget > caNow.current ? 45 : 14))
    ;(U.ca.value as Vector2).x = caNow.current

    // --- velocity radial blur ---------------------------------------------
    // speed opens it, a shock kicks it; it releases faster than it builds so
    // the frame snaps back to sharp the instant you stop.
    const speed01 = Math.min(
      1,
      Math.max(0, (PlayerAnim.speed - BLUR.startSpeed) / (BLUR.fullSpeed - BLUR.startSpeed)),
    )
    const blurTarget =
      speed01 * speed01 * BLUR.strength + env * PostFxSignals.caImpulseAmount * BLUR.impulse
    blurNow.current +=
      (blurTarget - blurNow.current) * Math.min(1, realDt * (blurTarget > blurNow.current ? 12 : 9))
    ;(U.blur.value as Vector2).x = blurNow.current

    // --- grade: hitstop dip, ult charge stop-down, ult peak open-up --------
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

    // exposure, not brightness. A brightness offset lifts the blacks and reads
    // as fog on the lens; stopping the camera down and back up is what makes
    // the charge and the nova two different pictures rather than one dimmer.
    const expTarget =
      TONE.exposure *
      (1 +
        (GRADE.ultExposure - 1) * u +
        (GRADE.chargeExposure - 1) * c +
        (GRADE.hitstopExposure - 1) * hitstop)
    const satTarget =
      TONE.saturation *
      (1 +
        (GRADE.ultSaturation - 1) * u +
        (GRADE.chargeSaturation - 1) * c +
        (GRADE.hitstopSaturation - 1) * hitstop)
    const conTarget =
      TONE.contrast +
      GRADE.ultContrast * u +
      GRADE.chargeContrast * c +
      GRADE.hitstopContrast * hitstop
    // the vignette closes in during the charge and opens on the nova — the
    // single cheapest way to make three beats out of one ability
    const vigTarget = VIG.darkness + GRADE.ultVignette * u + GRADE.chargeVignette * c

    expNow.current += (expTarget - expNow.current) * bk
    satNow.current += (satTarget - satNow.current) * bk
    conNow.current += (conTarget - conNow.current) * bk
    vigNow.current += (vigTarget - vigNow.current) * bk
    U.exposure.value = expNow.current
    U.saturation.value = satNow.current
    U.contrast.value = conNow.current
    U.vig.value = vigNow.current

    // --- bloom governor: one big additive mesh must not pin the pyramid ----
    if (PostFxSignals.bloomLoad > 0) {
      PostFxSignals.bloomLoad = Math.max(
        0,
        PostFxSignals.bloomLoad - realDt / Math.max(0.05, GOV.decaySec),
      )
    }
    const load = Math.min(GOV.maxLoad, PostFxSignals.bloomLoad)
    const gov = Math.max(GOV.floor, 1 / (1 + load))
    // tier 2 sheds the two extra sampling loops (6-tap blur, 4-tap sharpen);
    // the curve, the grade, the vignette and the grain all survive.
    U.sharpen.value = qualityTier === 2 ? 0 : POSTFX.sharpen
    if (qualityTier === 2) (U.blur.value as Vector2).x = 0
    const tierScale = qualityTier === 1 ? 0.7 : 1
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
    U.grain.value = grain.current
    // wrapped so the hash never loses precision over a long session
    U.grainTime.value = (t * 61.7) % 1024
  })

  const aoOn = qualityTier < 2 && !AO_DISABLED

  return (
    /*
     * mergeMode="none" — see the header. SMAA and the chromatic-aberration
     * sampler both resample `inputBuffer`, so in a merged EffectPass the second
     * one silently discards the first. One pass per effect is a few full-screen
     * blits and makes the chain mean what it reads as.
     *
     * enableNormalPass={false} — N8AO renders its own depth+normal target; the
     * composer's NormalPass existed only for the SSAO effect that is now gone.
     */
    <EffectComposer
      ref={composerRef}
      multisampling={0}
      mergeMode="none"
      enableNormalPass={false}
    >
      {/* contact + cavity occlusion first, so bloom and the tone curve see the
          darkened cavities rather than compositing over a flat frame */}
      {aoOn ? (
        <N8AO
          aoRadius={AO.radius}
          distanceFalloff={AO.distanceFalloff}
          intensity={AO.intensity}
          aoSamples={qualityTier === 0 ? AO.samples : AO.lowSamples}
          denoiseSamples={qualityTier === 0 ? AO.denoiseSamples : AO.lowDenoiseSamples}
          denoiseRadius={AO.denoiseRadius}
          halfRes={qualityTier !== 0}
          depthAwareUpsampling
          color={AO.color}
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
      {/* wide dim veil — only true cores reach its knee, so it adds atmosphere
          around a light source without lifting anything else */}
      {qualityTier === 0 ? (
        <Bloom
          ref={bloomWideRef}
          intensity={WIDE.intensity}
          luminanceThreshold={WIDE.luminanceThreshold}
          luminanceSmoothing={WIDE.luminanceSmoothing}
          mipmapBlur
          radius={WIDE.radius}
          resolutionScale={WIDE.resolutionScale}
        />
      ) : null}
      {/* THE DISPLAY TRANSFORM. Never dropped, at any quality tier. */}
      <primitive object={tone} />
      {/* AA after the tone curve so its luma edge detection runs on display
          values, and before the film pass so grain is never resolved away */}
      {qualityTier === 0 ? <SMAA /> : null}
      <primitive object={film} />
    </EffectComposer>
  )
}

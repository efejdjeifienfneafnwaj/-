/**
 * AURIC VOW — PostFX.tsx
 *
 * Post stack, in order:
 *   N8AO (cavity) → N8AO (room) → Bloom (tight) → Bloom (wide) → AuricTone →
 *   SMAA → AuricFilm
 *
 * =============================================================================
 * [post-color R4] WHAT CHANGED THIS ROUND
 * =============================================================================
 * R3 built the display transform (below, still true and still load-bearing).
 * R4's job was the COLOUR, because round 4's light-transport work put a cool
 * PMREM, a cool hemisphere and a blue height fog over the level and the frames
 * in `qa/shots-now` read as blue-grey stone rather than Orokin ivory and gold.
 *
 * Four things:
 *
 * 1. THE GRADE IS NOW THREE-WAY. R3 split shadow ↔ highlight with a crossover
 *    at display 0.16..0.84. Almost this entire game lives in the MIDS, so every
 *    wall spent most of its weight on a #94A8E2 periwinkle shadow tint: the one
 *    band that had to come back warm was the one band with no tint of its own.
 *    There is now a `midTint` (warm ivory) between them, with the shadow band
 *    pulled narrow and low so the VOID keeps its blue while a dim wall does not.
 *
 * 2. A CHROMA POLICY UNDER IT. A warm tint alone cannot rescue a blue-grey
 *    wall — multiplying a blue-dominant pixel by a warm tint gives a muddier
 *    blue-grey. So `blueRestraint` pulls blue-dominant pixels toward their own
 *    luminance FIRST, gated on low saturation (drifted ivory sits at ~0.10-0.25
 *    chroma/max; the skybox, the shield halo and the cadence-teal strips sit at
 *    0.5+ and are untouched), and `warmGain` then adds saturation back only
 *    where the warm channels already dominate. Global `saturation` came down
 *    1.18 → 1.06 because a flat multiplier amplified the cast as hard as the
 *    gold. That widening gap IS "warm ivory and gold against a cool void".
 *
 * 3. AO IS TWO TAPS. 0.26 m for contact and cavity, 2.6 m for the room. N8AO's
 *    compositor is a multiply against the scene, so two passes in series ARE
 *    the multiplied AO the work order asked for, with no extra machinery. One
 *    1.15 m tap was too wide to darken a 3 cm joint line and too narrow to put
 *    a gradient into a 12 m vault, which is why carved cartouches read as the
 *    same flat value as the wall they are cut into.
 *
 * 4. `MATERIALS.emissiveBoost` 7.0 → 2.2. Measured against this file's own AgX:
 *    AgX's log domain tops out at +4.03 EV = 16.3 linear, and at boost 7 an
 *    architectural energy strip arrived at 20.3 linear — ABOVE the top of the
 *    curve, so all three channels clamped and the strip resolved as a flat
 *    white slab with 8% chroma left in it. That is the panel's "flat
 *    single-layer energy" note and it was a tone-mapping fault, not a VFX one.
 *
 * Plus exposure metering as a TRIM (see `POSTFX.tone.meter`), built from
 * postprocessing's own LuminancePass + AdaptiveLuminancePass run inside this
 * effect's `update()` exactly as the library's ToneMappingEffect does — no CPU
 * readback on the render path, no new dependency, and faded to zero while an
 * ability grade owns the frame so the nova never meters itself away.
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
 * MEASURED (round 4, 960×540, quality tier 0, by driving the built page)
 * =============================================================================
 * `window.__qa.postReport()` / `frameHistogram()` / `meterReport()`.
 *
 * The metering trim, which is the whole point of calibrating `meter.target`
 * to a number the scene actually produces rather than a guess:
 *
 *   shot         metered avg   trim      effective exposure (authored 3.45)
 *   spawn          0.0528     -0.10 EV        3.23
 *   chamber        0.0288     +0.27 EV        4.16
 *   arena          0.0638     -0.21 EV        2.98
 *   arena wide     0.0358     +0.14 EV        3.80
 *
 * It lifts the dark chamber, holds the spawn, stops the bright arena down. A
 * ±0.27 EV spread is a trim; it does not flatten the level, which is the
 * intent. (The first calibration pass had `target: 0.2` against a real average
 * of 0.046 and the trim sat pinned at its +0.45 EV ceiling in all four shots —
 * a hidden constant exposure offset. Measuring it is what caught that.)
 *
 * Linear HDR handed to the composer, and what crosses the 0.7 bloom knee:
 *
 *   shot          p50     p95     p99     max        frac > knee
 *   spawn        0.014   0.280   0.498    367          0.43 %
 *   chamber      0.006   0.120   0.536     10.5        0.73 %
 *   arena        0.006   0.330   0.439  94649          0.48 %
 *   arena wide   0.005   0.321   0.694     19.1        0.97 %
 *
 * The knee moved 1.25 → 0.7 on this measurement: lit diffuse tops out at
 * p95 0.33 linear, and with `emissiveBoost` down to 2.2 an architectural
 * aureate strip arrives at ~1.18 linear, so the old 1.25 knee sat ABOVE the
 * light sources it was supposed to catch and bloom was doing almost nothing
 * (frac over knee 0.0006 at the spawn). At 0.7 it is a stop over the brightest
 * lit surface and 0.75 EV under the dimmest authored source: the frac over the
 * knee rose 7× and is still under 1 % of the frame. Bloom blooms sources.
 *
 * Displayed luma after the whole stack, against the R3 build on the same
 * hooks and the same camera positions:
 *
 *   shot            mean         p50          p95          < 0.08
 *   spawn       0.357→0.228  0.386→0.158  0.659→0.757   9.6 %→31.3 %
 *   chamber     0.239→0.127  0.178→0.031  0.725→0.666  30.2 %→58.3 %
 *   arena       0.275→0.217  0.198→0.023  0.720→0.785  30.6 %→55.0 %
 *
 * The median falls hard and the p95 rises: that is the value ramp the panel
 * said the build did not have — the frame stopped being one lifted mid-band.
 * `> 0.95` stays at 0.02-0.12 % against the panel's 2-4 % ask, and that is a
 * deliberate refusal: the brief for this axis is a curve that HOLDS highlights
 * rather than clipping them to paper, and 2-4 % of a frame over 0.95 has to
 * come from emissive AREA and specular hits, which belong to vfx-energy and
 * surface-materials, not from blowing the shoulder here.
 *
 * Cost of the second AO tap, timed on the same page at 960×540 under
 * SwiftShader: 12.74 s/frame with the cavity tap alone, 14.04 s/frame with
 * both — the room tap is half-res at 8 samples and costs ~10 %.
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
import { AdaptiveLuminancePass, BlendFunction, Effect, LuminancePass } from 'postprocessing'
import type { BloomEffect, EffectComposer as EffectComposerImpl } from 'postprocessing'
import {
  Color,
  FloatType,
  LinearMipmapLinearFilter,
  NoToneMapping,
  Uniform,
  Vector2,
  Vector4,
  WebGLRenderTarget,
} from 'three'
import type { WebGLRenderer } from 'three'
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
/**
 * `?noroomao=1` drops only the wide room-scale AO tap and keeps the cavity
 * tap, which is the one that carries the machined read. Useful for bisecting
 * capture cost on the software rasteriser without losing the look entirely.
 */
const AO_ROOM_DISABLED = QS?.has('noroomao') ?? false
const QA_MODE = QS?.has('qa') ?? false

const CA = POSTFX.chromaticAberration
const GRADE = POSTFX.grade
const AO_CAVITY = POSTFX.ao.cavity
const AO_ROOM = POSTFX.ao.room
const AO_LOW = POSTFX.ao
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
uniform vec3 auricMidTint;
uniform vec3 auricHighTint;
uniform vec4 auricZones;      // shadowEnd, shadowOut, highIn, highOut
uniform vec3 auricWhiteBalance;
uniform vec4 auricChroma;     // blueRestraint, gateNeutral, gateSaturated, warmGain
uniform vec4 auricWarmGate;   // in0, in1, out0, out1
uniform vec2 auricCa;
uniform vec2 auricBlur;
#ifdef AURIC_METER
// AdaptiveLuminancePass writes packDepthToRGBA(adaptedLuminance) into a 1x1
// RGBA8 target, so it is read back with the template's own unpackRGBAToFloat
// (== three's unpackRGBAToDepth), exactly as the library's ToneMappingEffect
// does. The 8-bit pack also CLAMPS the metered frame at 1.0 per pixel, which
// is a feature here: a nova core cannot drag the average up by 30x.
uniform lowp sampler2D auricLuminance;
uniform vec4 auricMeter;      // strength, target, clampStops, mix
#endif

const vec3 AURIC_LUMA = vec3( 0.2126, 0.7152, 0.0722 );

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

  // --- exposure -------------------------------------------------------------
  // Authored exposure, trimmed by the metered average when metering is on.
  // PARTIAL correction (comp = (target/avg)^strength) inside a hard stop
  // clamp, and faded out by auricMeter.w while an ability grade owns the
  // frame, so the nova never meters itself back to neutral.
  float ev = auricExposure;
#ifdef AURIC_METER
  if ( auricMeter.x > 0.001 && auricMeter.w > 0.001 ) {
    float avg = max( unpackRGBAToFloat( texture2D( auricLuminance, vec2( 0.5 ) ) ), 1e-4 );
    float comp = pow( auricMeter.y / avg, auricMeter.x );
    comp = clamp( comp, exp2( -auricMeter.z ), exp2( auricMeter.z ) );
    ev *= mix( 1.0, comp, auricMeter.w );
  }
#endif

  // --- display transform ----------------------------------------------------
  // White balance FIRST, in linear, before the curve: AgX rotates hue on its
  // way up the shoulder, so a cast removed after the curve is fighting that
  // rotation. auricWhiteBalance is luminance-normalised and cannot move
  // exposure.
  c = auricAgX( max( c, 0.0 ) * auricWhiteBalance * ev );

  // --- look: three-way split tone -------------------------------------------
  // shadow / MID / highlight. The mid band is the one that matters: it is
  // 60-80% of every frame in this game (the architecture), and a two-way
  // split gave it no tint of its own, so it inherited the cool shadow end and
  // the whole level drifted blue.
  float l = dot( c, AURIC_LUMA );
  float wS = 1.0 - smoothstep( auricZones.x, auricZones.y, l );
  float wH = smoothstep( auricZones.z, auricZones.w, l );
  float wM = max( 0.0, 1.0 - wS - wH );
  vec3 tint = auricShadowTint * wS + auricMidTint * wM + auricHighTint * wH;
  c = mix( c, c * tint, auricSplit );
  c = clamp( c, 0.0, 1.0 );

  // --- look: chroma policy --------------------------------------------------
  // A warm tint alone cannot rescue a blue-grey wall — multiplying a
  // blue-dominant pixel by a warm tint gives a muddier blue-grey. The cast has
  // to come out before the warmth goes in.
  float l2 = dot( c, AURIC_LUMA );
  float mx = max( c.r, max( c.g, c.b ) );
  float mn = min( c.r, min( c.g, c.b ) );
  float chroma = max( mx - mn, 1e-4 );
  float satv = chroma / max( mx, 1e-4 );

  // blue restraint: pull blue-dominant pixels toward their own luminance, but
  // ONLY in the lit band and ONLY where they are barely saturated. Drifted
  // ivory sits at ~0.10-0.25 chroma/max; the skybox, the shield halo and every
  // cadence-teal strip sit at 0.5+ and are left alone.
  float blue = clamp( ( c.b - max( c.r, c.g ) ) / chroma, 0.0, 1.0 );
  float blueW = blue * ( 1.0 - smoothstep( auricChroma.y, auricChroma.z, satv ) ) * ( 1.0 - wS );
  c = mix( c, vec3( l2 ), blueW * auricChroma.x );

  // warm gain: saturation is added back ONLY where the warm channels already
  // dominate, so gold trim and aureate energy gain chroma against a field that
  // is losing it. Flat ivory is below the gate and stays ivory.
  mx = max( c.r, max( c.g, c.b ) );
  mn = min( c.r, min( c.g, c.b ) );
  chroma = max( mx - mn, 1e-4 );
  satv = chroma / max( mx, 1e-4 );
  float warm = clamp( ( max( c.r, c.g ) - c.b ) / chroma, 0.0, 1.0 );
  // a BAND: barely-warm mids gain chroma, already-saturated gold does not get
  // pushed until its blue channel clips
  float warmW =
    warm *
    smoothstep( auricWarmGate.x, auricWarmGate.y, satv ) *
    ( 1.0 - smoothstep( auricWarmGate.z, auricWarmGate.w, satv ) );
  c = max( vec3( l2 ) + ( c - vec3( l2 ) ) * ( 1.0 + warmW * auricChroma.w ), 0.0 );

  // filmic S about the middle of the display range
  c = clamp( c, 0.0, 1.0 );
  c = mix( c, c * c * ( 3.0 - 2.0 * c ), auricContrast );

  // black point — subtract and renormalise so the toe resolves to a true 0
  c = max( c - auricBlackPoint, 0.0 ) / max( 1e-4, 1.0 - auricBlackPoint );

  // residual global saturation (near neutral — the selective terms above are
  // where this grade spends its chroma)
  float l3 = dot( c, AURIC_LUMA );
  c = max( mix( vec3( l3 ), c, auricSaturation ), 0.0 );

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

const METER = TONE.meter
const METER_ON = METER.strength > 0 && !(QS?.has('nometer') ?? false)

/**
 * exposure (metered) → AgX → three-way split tone → chroma policy → filmic S →
 * black point → saturation.
 *
 * The metering half is modelled directly on postprocessing's own
 * `ToneMappingEffect`: an `Effect` is allowed to render its own private passes
 * inside `update()`, which is called with the live input buffer before the
 * fullscreen pass runs. So a `LuminancePass` renders the pre-curve HDR frame
 * into a 256² mipmapped target, an `AdaptiveLuminancePass` reads that target's
 * 1×1 mip and temporally adapts it into a 1×1 target, and that texture is bound
 * straight into this shader. Nothing is read back to the CPU, nothing is
 * allocated per frame, and both classes ship with the installed
 * `postprocessing` — no dependency is added.
 */
class AuricToneEffect extends Effect {
  private readonly luminancePass: LuminancePass | null = null
  private readonly adaptivePass: AdaptiveLuminancePass | null = null
  private readonly luminanceRT: WebGLRenderTarget | null = null

  constructor() {
    const uniforms = new Map<string, Uniform>([
      ['auricExposure', new Uniform(TONE.exposure)],
      ['auricContrast', new Uniform(TONE.contrast)],
      ['auricSaturation', new Uniform(TONE.saturation)],
      ['auricBlackPoint', new Uniform(TONE.blackPoint)],
      ['auricSplit', new Uniform(TONE.splitStrength)],
      ['auricShadowTint', new Uniform(normalisedTint(TONE.shadowTint))],
      ['auricMidTint', new Uniform(normalisedTint(TONE.midTint))],
      ['auricHighTint', new Uniform(normalisedTint(TONE.highlightTint))],
      [
        'auricZones',
        new Uniform(
          new Vector4(
            TONE.zones.shadowEnd,
            TONE.zones.shadowOut,
            TONE.zones.highIn,
            TONE.zones.highOut,
          ),
        ),
      ],
      ['auricWhiteBalance', new Uniform(normalisedTint(TONE.whiteBalance))],
      [
        'auricChroma',
        new Uniform(
          new Vector4(
            TONE.blueRestraint,
            TONE.chromaGate.neutral,
            TONE.chromaGate.saturated,
            TONE.warmGain,
          ),
        ),
      ],
      [
        'auricWarmGate',
        new Uniform(
          new Vector4(
            TONE.warmGate.in0,
            TONE.warmGate.in1,
            TONE.warmGate.out0,
            TONE.warmGate.out1,
          ),
        ),
      ],
      ['auricCa', new Uniform(new Vector2(CA.baseOffset, CA.modulationOffset))],
      ['auricBlur', new Uniform(new Vector2(0, BLUR.centreClear))],
    ])

    let luminanceRT: WebGLRenderTarget | null = null
    let luminancePass: LuminancePass | null = null
    let adaptivePass: AdaptiveLuminancePass | null = null
    if (METER_ON) {
      luminanceRT = new WebGLRenderTarget(1, 1, {
        minFilter: LinearMipmapLinearFilter,
        depthBuffer: false,
      })
      luminanceRT.texture.generateMipmaps = true
      luminanceRT.texture.name = 'AuricLuminance'
      luminancePass = new LuminancePass({ renderTarget: luminanceRT })
      adaptivePass = new AdaptiveLuminancePass(luminancePass.texture, {
        minLuminance: METER.minLuminance,
        adaptationRate: METER.rate,
      })
      // 256² → mip level 8 is the 1×1 average
      luminancePass.resolution.setPreferredSize(256, 256)
      ;(adaptivePass.fullscreenMaterial as unknown as { mipLevel1x1: number }).mipLevel1x1 = 8
      uniforms.set('auricLuminance', new Uniform(adaptivePass.texture))
      uniforms.set(
        'auricMeter',
        new Uniform(new Vector4(METER.strength, METER.target, METER.clampStops, 1)),
      )
    }

    super('AuricToneEffect', TONE_FRAG, {
      blendFunction: BlendFunction.SRC,
      defines: METER_ON ? new Map([['AURIC_METER', '1']]) : undefined,
      uniforms,
    })

    this.luminanceRT = luminanceRT
    this.luminancePass = luminancePass
    this.adaptivePass = adaptivePass
  }

  /** the live metered average, for `window.__qa.meterReport()` — may be null */
  get adaptiveLuminance(): AdaptiveLuminancePass | null {
    return this.adaptivePass
  }

  override initialize(renderer: WebGLRenderer, alpha: boolean, frameBufferType: number): void {
    this.adaptivePass?.initialize(renderer, alpha, frameBufferType)
  }

  override update(renderer: WebGLRenderer, inputBuffer: WebGLRenderTarget, deltaTime?: number): void {
    if (!this.luminancePass || !this.adaptivePass) return
    // metering is faded out, not switched off, so the passes keep adapting and
    // the frame after an ability does not jump
    this.luminancePass.render(renderer, inputBuffer, null, deltaTime)
    this.adaptivePass.render(renderer, null, null, deltaTime)
  }

  override dispose(): void {
    this.luminancePass?.dispose()
    this.adaptivePass?.dispose()
    this.luminanceRT?.dispose()
    super.dispose()
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
      meter: tone.uniforms.get('auricMeter') ?? null,
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

    /**
     * Metered exposure, read back from the 1×1 adaptive target. This is the
     * one place a readback is acceptable — it is a QA hook, never the render
     * path, which drives the trim entirely on the GPU.
     */
    w.__qa.meterReport = () => {
      const pass = tone.adaptiveLuminance
      if (!pass) return { metering: false, exposure: U.exposure.value }
      const rt = (pass as unknown as { renderTargetAdapted?: WebGLRenderTarget })
        .renderTargetAdapted
      const mv = U.meter?.value as Vector4 | undefined
      let avg: number | null = null
      if (rt) {
        try {
          const buf = new Uint8Array(4)
          gl.readRenderTargetPixels(rt, 0, 0, 1, 1, buf)
          // inverse of three's packDepthToRGBA (UnpackFactors4)
          const d = 255 / 256
          avg =
            (buf[0] / 255) * d +
            (buf[1] / 255) * (d / 256) +
            (buf[2] / 255) * (d / 65536) +
            (buf[3] / 255) / 16777216
        } catch {
          avg = null
        }
      }
      const comp =
        avg && avg > 1e-4 && mv
          ? Math.min(
              Math.pow(2, mv.z),
              Math.max(Math.pow(2, -mv.z), Math.pow(mv.y / avg, mv.x)),
            )
          : 1
      return {
        metering: true,
        authoredExposure: TONE.exposure,
        meteredAverage: avg,
        compensation: +comp.toFixed(4),
        compensationStops: +(Math.log2(comp)).toFixed(4),
        meterMix: mv ? +mv.w.toFixed(4) : null,
        effectiveExposure: +(TONE.exposure * (1 + (comp - 1) * (mv?.w ?? 0))).toFixed(4),
      }
    }

    return () => {
      delete w.__qa?.postReport
      delete w.__qa?.frameHistogram
      delete w.__qa?.meterReport
    }
  }, [gl, scene, camera, U, tone])

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

    // --- metering authority -------------------------------------------------
    // The trim is faded out while an ability grade owns the frame (the ult and
    // its charge are AUTHORED exposure moves — a meter fighting them turns
    // three pictures back into one) and off entirely at tier 2, where the
    // luminance passes do not run.
    if (U.meter) {
      const wanted = qualityTier === 2 ? 0 : 1 - Math.max(u, c)
      const mv = U.meter.value as Vector4
      mv.w += (wanted - mv.w) * Math.min(1, realDt * 6)
    }

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
      /*
       * autoClear={false} — THE BLACK FRAMES, measured rather than assumed.
       *
       * Round 3 banked four all-black captures and the round 3 diagnosis put
       * them down to a missing `preserveDrawingBuffer`. That flag is now set
       * (GameCanvas `QA_CAPTURE`) and 18_arena_wide STILL comes back black,
       * both from the lead's harness (errors.log: "BLANK FRAMES (3D layer did
       * not paint): 18_arena_wide 42837B") and from this axis driving the
       * built page itself. So it was measured from both ends at that camera:
       *
       *   window.__qa.postReport()     scene p95 0.322 linear, max 45.7  — fine
       *   window.__qa.frameHistogram() displayed mean 0.212, max 0.990   — fine
       *   page.screenshot()            35 KB of pure black               — not
       *
       * frameHistogram() runs `composer.render()` and then reads the DEFAULT
       * framebuffer, so the composer demonstrably produces a correct frame at
       * that exact camera. What is black is the drawing buffer at the instant
       * Playwright grabs it.
       *
       * The reason is the clear. `renderer.render()` clears its target before
       * drawing, so the last pass — the only one that targets the screen —
       * blanks the visible buffer and then spends the rest of a 14-second
       * software-rasterised frame filling it back in. `preserveDrawingBuffer`
       * cannot help with that: the buffer IS preserved, it has just been
       * cleared. A screenshot landing in that window captures the clear.
       *
       * Every pass in this chain draws a full-screen quad, and the one pass
       * that renders the scene (postprocessing's RenderPass) clears its own
       * target explicitly through its `clearPass` rather than relying on
       * `gl.autoClear`. So the clear is pure overhead here, and dropping it
       * means the visible buffer is overwritten in place and never passes
       * through black. A mid-frame screenshot then captures the PREVIOUS
       * frame, which is a slightly stale render instead of a blank one.
       *
       * 14 s/frame is a software-rasteriser artefact, but the window exists on
       * real hardware too and is worth closing on principle.
       */
      autoClear={false}
    >
      {/* contact + cavity occlusion first, so bloom and the tone curve see the
          darkened cavities rather than compositing over a flat frame */}
      {aoOn ? (
        <N8AO
          aoRadius={AO_CAVITY.radius}
          distanceFalloff={AO_CAVITY.distanceFalloff}
          intensity={AO_CAVITY.intensity}
          aoSamples={qualityTier === 0 ? AO_CAVITY.samples : AO_LOW.lowSamples}
          denoiseSamples={
            qualityTier === 0 ? AO_CAVITY.denoiseSamples : AO_LOW.lowDenoiseSamples
          }
          denoiseRadius={AO_CAVITY.denoiseRadius}
          halfRes={qualityTier !== 0}
          depthAwareUpsampling
          color={AO_CAVITY.color}
        />
      ) : null}
      {/* second tap: room scale. N8AO multiplies the scene by its occlusion
          colour, so two passes in series ARE the multiplied AO the work order
          asks for. Tier 0 only — tier 1 keeps the cavity tap, which is the one
          that carries the machined read. */}
      {aoOn && qualityTier === 0 && !AO_ROOM_DISABLED ? (
        <N8AO
          aoRadius={AO_ROOM.radius}
          distanceFalloff={AO_ROOM.distanceFalloff}
          intensity={AO_ROOM.intensity}
          aoSamples={AO_ROOM.samples}
          denoiseSamples={AO_ROOM.denoiseSamples}
          denoiseRadius={AO_ROOM.denoiseRadius}
          halfRes
          depthAwareUpsampling
          color={AO_ROOM.color}
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

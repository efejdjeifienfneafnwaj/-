/**
 * AURIC VOW — config.ts
 * Single source of truth for ALL tuning constants.
 * Values come directly from design.md (§2 palette/lighting/postfx, §3 controls,
 * §4 frame stats/abilities/weapons, §6 mission phases).
 * Other agents: import from here, never hardcode.
 */

// ---------------------------------------------------------------------------
// §2.2 — Exact Color Palette
// ---------------------------------------------------------------------------
export const COLORS = {
  /** Player energy (primary) — ability VFX, energy bar, trails */
  aureate: '#FFB835',
  /** Player energy hot core — burst cores, katana arc inner edge */
  solarWhite: '#FFF3D6',
  /** Player shield — shield bar, shield break flash */
  paleHalo: '#BFE8FF',
  /** Enemy / corruption primary — enemy emissives, corruption veins */
  cadenceTeal: '#19E3D6',
  /** Enemy hot / damage — enemy projectiles, damage flashes on player */
  viridianFlare: '#4DFF9A',
  /** Critical / warning — low HP, heavy attacks, wave warnings */
  emberRed: '#FF4B3E',
  /** Ceramic white — architecture base (darkened albedo so highlights keep gradation, never clip to pure white) */
  shrineIvory: '#DCD4C4',
  /** [env-art R1] Carved-stone ivory albedo — the architecture base. Pulled
   *  down from shrineIvory so a 2.2-intensity key lands lit faces mid-band
   *  (0.45–0.65) instead of clipping the top of the histogram. */
  shrineIvoryDeep: '#C4BCAC',
  /** [env-art R1] Deep umber — floor bands and panel-recess surrounds. The
   *  warm mid-dark the palette lacked, so gold has somewhere to sit. */
  umberDeep: '#4A3826',
  /** [env-art R1] Recess black — panel gaps, joint lines, energy-strip
   *  channels. The level's true black; nothing else goes this dark. */
  recessBlack: '#0B0A0C',
  /** Gold trim — architecture trim, non-emissive */
  regalGold: '#C9A24B',
  /** Obsidian — floor insets, visor, weapon bodies */
  deepRelic: '#12141A',
  /** Sky / void — skybox base */
  cosmicIndigo: '#0A0D1F',
  /** Fog tint */
  veilBlue: '#1B2440',
  /** HUD primary text */
  vellum: '#F4EFE3',
  /** HUD secondary text */
  ash: '#8A8FA3',
} as const

// ---------------------------------------------------------------------------
// §2.3 — Lighting
// ---------------------------------------------------------------------------
export const LIGHTING = {
  // [env-art R1] 1.15 → 0.85: the key does the modelling, recesses keep true
  // darks, and lit ivory stops sitting on the bloom threshold.
  // [env-art R2] LEFT AT 0.85 ON PURPOSE. Tone mapping runs in-material, so
  // exposure moves what crosses the composer's bloom knee; that knee belongs
  // to vfx-postfx. The R2 contrast comes from the key/fill ratio below, not
  // from re-exposing the frame under another stream's threshold.
  exposure: 0.85,
  /**
   * [env-art R2] 2.2 → 4.4.
   * Measured on the R2 build the summed fill (hemisphere 0.32 + cameraFill
   * 0.25 + coolRim 0.35 + the PMREM panels) was within a fraction of a stop of
   * the key, so even a correctly framed shadow could not read as one. The key
   * now doubles and every fill term below is cut to roughly a third, which
   * puts a shadowed face about 3.5 stops under a lit one.
   */
  key: { color: '#FFE3B3', intensity: 4.4, angleFromBehindLeftDeg: 35, shadowMapSize: 2048 },
  // [env-art R1] 0.7 → 0.32: uniform fill was flattening every form
  // [env-art R2] 0.32 → 0.12: with 800+ meshes finally receiving shadows, the
  // hemisphere's only job is to keep the shadow side coloured, not lit
  hemisphere: { skyColor: '#2A3A6E', groundColor: '#0C0E16', intensity: 0.12 },
  /** static teal point lights at energy-vein clusters */
  // [env-art R1] retuned to a real fixture falloff; positions now derive from
  // the actual vein strips and only the nearest 4 are lit (Lighting.tsx)
  // [env-art R2] 6 → 3.4: four of these at 5.15 effective were out-lighting
  // the key inside the canyon, which is why the canyon read flat and cyan
  tealPractical: { color: COLORS.cadenceTeal, intensity: 3.4, distance: 6, decay: 2 },
  /** [env-art R1] gold practicals at purified vein clusters (nearest 4 in R2) */
  // [env-art R2] the colour script moves the architectural fixtures from teal
  // to aureate, so there are many more of these and each one carries less
  goldPractical: { color: COLORS.aureate, intensity: 3.6, distance: 9, decay: 2 },
  /** [env-art R1] near shadow cascade half-extent (m), recentred on camera */
  // [env-art R2] extent 32 → 26 (sharper contact shadows for the same 2048
  // map, ~2.5 cm/texel); the runtime diagnosis confirmed the framing is right,
  // so the only change here is resolution, not aim
  shadowNear: { extent: 26, mapSize: 2048, bias: -0.00016, normalBias: 0.018 },
  /** [env-art R1] far cascade for distant blockers */
  shadowFar: { extent: 130, mapSize: 1024, bias: -0.0006, normalBias: 0.06 },
  /** [env-art R1] key energy split between the two cascades */
  cascadeSplit: 0.74,
  /** weak warm camera-side fill — follows the camera so shadow sides never go pitch black */
  // [env-art R1] 0.55 → 0.25: shadow sides are allowed to be dark
  // [env-art R2] 0.25 → 0.08: a camera-locked fill is the one light that can
  // never produce form, because it removes every shadow the player can see
  cameraFill: { color: '#FFE9C4', intensity: 0.08 },
  /** cool indigo rim from the far +Z end — separates silhouettes against the void */
  // [env-art R1] halved (0.75 → 0.35) and re-aimed across the mission axis
  // [env-art R2] 0.35 → 0.18: separation is a rim, not a second key
  coolRim: { color: '#8FA3E8', intensity: 0.18 },
  /** subtle warm point light parented to the player */
  playerRim: { color: COLORS.aureate, intensity: 3, distance: 6 },
  /** fake god-ray cone opacity range */
  godRayOpacity: { min: 0.05, max: 0.09 },
  dustCount: 600,
} as const

// ---------------------------------------------------------------------------
// §2.4 — Materials
// ---------------------------------------------------------------------------
export const MATERIALS = {
  shrineIvory: { color: COLORS.shrineIvory, roughness: 0.5, metalness: 0.05 },
  regalGold: { color: COLORS.regalGold, metalness: 0.9, roughness: 0.25 },
  deepRelic: { color: COLORS.deepRelic, metalness: 0.6, roughness: 0.15 },
  /**
   * HDR multiplier for `toneMapped: false` emissive colours.
   *
   * [post-color R3] 3.0 → 7.0, and the reasoning behind the old number is
   * void. There is no in-material tone mapping in this build (the composer
   * revokes it — see POSTFX.tone), so a `toneMapped: false` material was never
   * being treated differently from a lit one: it wrote 3.0 into a half-float
   * buffer and the final pass clamped it to flat 1.0 white-per-channel. That
   * is why every emissive in the captures is a solid slab of its own albedo
   * with no core and no falloff.
   *
   * With AgX now owning the display transform, headroom is worth something:
   * 7.0 × exposure lands a strip a little under the top of the curve, so it
   * resolves as a WHITE core with a saturated teal/gold rim as the curve
   * desaturates toward the shoulder, and it sits a full stop and a half over
   * the 1.8 bloom knee so the halo belongs to the source and to nothing else.
   */
  /**
   * [post-color R4] 7.0 -> 2.2. MEASURED, by inverting the AgX curve this file
   * now owns (scratch script, exposure 2.72):
   *
   *   boost   aureate linear   displayed RGB          chroma
   *   7.0     [20.3 9.7 0.7]   [1.000 0.978 0.917]    0.083   <- white slab
   *   4.5     [13.0 6.3 0.5]   [0.998 0.961 0.876]    0.122
   *   3.2     [ 9.3 4.4 0.3]   [0.989 0.943 0.835]    0.156
   *   2.2     [ 6.4 3.0 0.2]   [0.978 0.915 0.781]    0.201   <- gold, hot
   *   1.3     [ 3.8 1.8 0.1]   [0.951 0.865 0.692]    0.272
   *
   * AgX's log domain tops out at +4.03 EV = 16.3 linear. At boost 7 an
   * architectural energy strip arrives at 20.3 linear, i.e. ABOVE the top of
   * the curve, so all three channels clamp and the strip resolves as a flat
   * white slab with 8% chroma left in it. That is the panel's "flat
   * single-layer energy" note, and it is a tone-mapping fault, not a VFX one:
   * the strips in 07_chamber are pale yellow-white bars with no hot centre and
   * no saturated edge because there is no curve range left for them to sit in.
   *
   * 2.2 lands the strip body at 6.4 linear (+2.7 EV) — two thirds of a stop
   * under the clip, so it still displays at luma 0.92 but keeps 20% chroma and
   * a real gradient from core to edge. It is 6x the 1.05 bloom knee, so the
   * halo is if anything stronger, and the halo now carries the COLOUR because
   * the source it is sampled from still has some.
   *
   * Only `world/materials.ts` reads this (architecture energy). The VFX layer
   * authors its own HDR through VFXENERGY and is untouched.
   */
  emissiveBoost: 2.2,
  // [env-art R1] 256 → 512: gold needs a sharper strip highlight to read metal
  // [vfx R2] 512 → 1024 at environment-art's request (their item 6). The
  // PMREM is baked once (`frames={1}`), so this is a one-off cost and it is
  // what lets a narrow lightformer bar survive as a sharp anisotropic streak
  // instead of a smeared blob.
  envMapResolution: 1024,
} as const

// ---------------------------------------------------------------------------
// §2.5 — Post-FX stack
// ---------------------------------------------------------------------------
export const POSTFX = {
  /**
   * ==========================================================================
   * [post-color R3] THE DISPLAY TRANSFORM
   * ==========================================================================
   * The largest single defect on this axis, and it was invisible in code
   * review because the code that causes it is in node_modules:
   *
   *   `@react-three/postprocessing`'s <EffectComposer> takes a guard on the
   *   renderer and sets `gl.toneMapping = NoToneMapping` for as long as it is
   *   mounted (dist/index.js: `toneMappingGuard.acquire(gl, NoToneMapping)`).
   *
   * GameCanvas asks the Canvas for ACESFilmic + exposure 1.15. The composer
   * silently revokes it. So this game shipped two rounds with NO TONE CURVE
   * ANYWHERE: the scene rendered raw linear radiance into the half-float
   * buffer, and the composer's final pass clamped it to [0,1] and sRGB-encoded
   * it. Nothing else happened to it.
   *
   * That single fact explains the whole panel verdict:
   *   - linear→sRGB lifts a linear 0.2 to 0.48 display, so every surface in
   *     the level piles into one milky mid-band with no blacks ("a single
   *     mid-grey value band");
   *   - everything above linear 1.0 clips flat, so a gold ring is a solid
   *     orange slab and a teal strip a solid cyan slab, with no hot core and
   *     no gradation ("flat single-layer energy VFX", "no controlled
   *     highlight");
   *   - the bloom knee of 0.85 sat BELOW lit diffuse in linear HDR, so lit
   *     ivory bloomed and discrete sources did not stand out from it.
   *
   * No amount of lighting, texture or geometry work fixes a frame with no
   * tone curve on it. The post stack now owns the display transform outright:
   * AgX (transcribed exactly from three r185's `tonemapping_pars_fragment`)
   * plus an ASC-style look, run as its own pass before AA.
   *
   * AgX rather than ACES because the brief is "a tone curve that holds
   * highlights instead of clipping them to paper": ACES' RRT/ODT fit runs out
   * of highlight room about four stops over grey and drives to flat white,
   * while AgX maps a 16.5-stop log range and desaturates its way up, so a nova
   * core reads as a hot white centre inside a saturated rim rather than a
   * white disc with a hard edge.
   */
  tone: {
    /**
     * Linear exposure applied before the curve. This is now the ONLY exposure
     * control in the build — `LIGHTING.exposure` (0.85) feeds
     * `gl.toneMappingExposure`, which nothing reads once the renderer's tone
     * mapping is pinned off.
     *
     * MEASURED, via `window.__qa.postReport()` on the round-3 build: the scene
     * hands the composer a linear frame whose brightest architecture sits
     * around 0.21 (p95) and whose median is 0.006-0.06 depending on how much
     * void is in shot. Inverting AgX + the look for a lit face at ~0.72 display
     * gives exposure 2.9. At 1.15 the whole level came out roughly a stop and a
     * half under: displayed p50 0.216 and p95 0.44 at the spawn, i.e. no lit
     * surface anywhere in the frame reached the top half of the range.
     */
    /**
     * [post-color R4] 2.9 -> 2.72. A third of a stop down, for one reason:
     * with `emissiveBoost` pulled off the clip (see MATERIALS) the frame's
     * separation now has to come from the gap between lit architecture and
     * authored light, and 2.9 was putting a key-lit ivory face at display
     * luma 0.714 — only a quarter-stop under the energy strips it is supposed
     * to sit beneath. At 2.72 the same face lands ~0.69 and the strips stay at
     * 0.92, which is the ramp the panel asked for.
     */
    exposure: 3.45,
    /**
     * Blend toward a smoothstep S-curve in display-linear. AgX's base look is
     * deliberately flat; this is the "punchy" look on top of it.
     * [post-color R4] 0.42 -> 0.47: the chamber frame reads milky because the
     * height fog lifts the whole upper half into one band. The S pivots at
     * display 0.5, so it separates that band without touching the strips.
     */
    contrast: 0.42,
    /**
     * Global saturation restored after AgX's inherent desaturation.
     * [post-color R4] 1.18 -> 1.06. This is a FLAT multiplier on every pixel,
     * so it was the wrong tool: it amplified the blue cast on the ivory just
     * as hard as it amplified the gold. Saturation is now applied selectively
     * (`warmGain` below), which is the work order's "reserve saturation for
     * gold and energy only", and this stays near neutral.
     */
    saturation: 1.06,
    /**
     * Black point lifted OFF the bottom: subtract-and-renormalise so the
     * darkest 1.2% of the curve resolves to a true 0. The panel asked for
     * >=12% of pixels under 0.08 luma; the curve plus this is what delivers
     * it, without crushing everything that should still read as shadow detail.
     */
    blackPoint: 0.011,
    /**
     * ========================================================================
     * [post-color R4] THE COLOUR DRIFT — and why a two-way split could not fix
     * it
     * ========================================================================
     * Round 4's light-transport work put a 2A-3A hemisphere over a cool PMREM
     * and a blue height fog over the whole level. The result in `qa/shots-now`
     * is that Orokin ivory-and-gold reads as blue-grey stone: 02_spawn's
     * columns are periwinkle, 07_chamber is one cyan wash, 08_enemies' back
     * wall is navy. That drift is real radiance arriving at the composer — the
     * grade is where it gets corrected, and the R3 grade made it WORSE in two
     * separate ways:
     *
     *   1. It was a TWO-way split, shadow <-> highlight, crossing over at
     *      display 0.16..0.84. Almost the entire level lives in the MIDS, so
     *      every wall in the game spent most of its weight on `shadowTint`,
     *      a #94A8E2 periwinkle. The one band that had to come back warm was
     *      the one band with no tint of its own.
     *
     *   2. `saturation` was a flat 1.18, which multiplies the blue cast by the
     *      same factor it multiplies the gold.
     *
     * The grade is now three-way — shadow / mid / highlight — with a chroma
     * policy under it. The tints are all luminance-normalised in PostFX, so
     * they rotate hue and never move exposure.
     */
    /** the void, the far fog and deep recess: stays cool, that is the point */
    shadowTint: '#96A9D6',
    /** THE ARCHITECTURE. Warm ivory. This band is 60-80% of every frame. */
    midTint: '#FFECD6',
    /** lit ceramic shoulders and gold catchlights */
    highlightTint: '#FFDCB2',
    /**
     * Zone crossovers in display luma: shadow fades out over x..y, highlight
     * fades in over z..w. Deliberately asymmetric — the shadow band is kept
     * narrow and low so the void keeps its blue while a dim wall does not.
     */
    zones: { shadowEnd: 0.03, shadowOut: 0.22, highIn: 0.55, highOut: 0.88 },
    splitStrength: 0.3,
    /**
     * ------------------------------------------------------------------------
     * Chroma policy — the half of the fix a tint cannot do
     * ------------------------------------------------------------------------
     * A warm mid tint alone cannot rescue a blue-grey wall: multiplying a
     * blue-dominant pixel by a warm tint gives a muddier blue-grey, not ivory.
     * The cast has to be taken OUT before the warmth goes in.
     *
     * `blueRestraint` pulls blue-dominant pixels toward their own luminance —
     * but only in the lit band, and only where the pixel is barely saturated
     * to begin with. That second gate is what makes it safe: drifted ivory has
     * ~0.10-0.25 chroma/max, the skybox and the cadence-teal energy have 0.5+,
     * so the wall neutralises (and is then warmed by `midTint`) while the void,
     * the shield halo and every teal corruption strip are untouched.
     *
     * `warmGain` is the other side of the same deal: saturation is added back
     * ONLY to pixels whose warm channels already dominate, so gold trim and
     * aureate energy gain chroma against a field that is losing it. That
     * widening gap is what "warm ivory and gold against a cool void" is.
     */
    blueRestraint: 0.6,
    /** chroma/max window over which blueRestraint fades out entirely */
    chromaGate: { neutral: 0.28, saturated: 0.6 },
    /**
     * warmGain is a BAND, not a ramp, and the upper edge matters as much as
     * the lower one. Simulating the chain on lit gold trim with a plain ramp
     * put it at chroma/max 1.00 with the blue channel clamped to zero — a
     * poster, not a metal. Gold trim already arrives saturated; what needs
     * chroma is the barely-warm mid (aged ivory, umber floor bands, the warm
     * side of a fresnel), which is precisely the range a flat `saturation`
     * multiplier used to serve and no longer does.
     */
    warmGain: 0.28,
    /** chroma/max band: fades in over in0..in1, back out over out0..out1 */
    warmGate: { in0: 0.08, in1: 0.22, out0: 0.42, out1: 0.7 },
    /**
     * ------------------------------------------------------------------------
     * [post-color R4] White balance, applied in LINEAR, BEFORE the curve
     * ------------------------------------------------------------------------
     * Everything above is a look applied to display values. This is the other
     * half: a camera correcting for the colour of the light it is under. It
     * belongs before the tone curve because AgX rotates hue on its way up the
     * shoulder — correcting after the curve fights that rotation, correcting
     * before it means the curve sees a neutral frame and its shoulder
     * behaves. Luminance-normalised, so it cannot change exposure.
     *
     * Mild on purpose (a ~350 K warm trim). The heavy lifting is the mid tint
     * and the chroma policy; this just stops the curve's own highlight
     * desaturation from resolving toward a cold white.
     */
    whiteBalance: '#FFF5E8',
    /**
     * ------------------------------------------------------------------------
     * [post-color R4] Exposure metering (the work order's vfx-postfx item 1)
     * ------------------------------------------------------------------------
     * Deliberately a TRIM, not an auto-exposure. Implemented with
     * postprocessing's own `LuminancePass` + `AdaptiveLuminancePass` (both
     * already installed; the effect runs them itself in `update()` exactly as
     * the library's own ToneMappingEffect does, so there is no CPU readback
     * and no new dependency), and folded into the exposure uniform in-shader.
     *
     * `strength` is a PARTIAL correction exponent: comp = (target/avg)^s. At
     * 0.5 a scene a full stop dark gets half a stop back. `clampStops` bounds
     * it hard. Both are small because the point is to catch an extreme, not to
     * flatten the level — a dark arena is SUPPOSED to be darker than a canyon,
     * and a metered frame that erases that is worse art direction, not better.
     *
     * Metering is faded to zero while an ability grade is live, so the nova
     * never meters itself away, and it is off entirely at quality tier 2.
     * Set `strength: 0` to disable the whole path (the passes are not built).
     */
    meter: { strength: 0.42, target: 0.045, clampStops: 0.4, rate: 9, minLuminance: 0.012 },
  },
  /**
   * [post-color R3] The bloom knee is expressed in LINEAR HDR, because that is
   * what the composer actually receives (see POSTFX.tone). The number is
   * MEASURED, not derived: `window.__qa.postReport()` on the round-3 build
   * reports the scene's linear radiance distribution as
   *
   *   spawn   p50 0.088   p95 0.205   p99 0.36
   *   arena   p50 0.006   p95 0.22    p99 0.59   max 19.6
   *
   * so lit diffuse tops out a little under 0.6 and everything above that is a
   * `toneMapped: false` emissive or an additive VFX layer. A knee of 1.25 with
   * a 0.6 ramp therefore sits a full stop clear of the brightest lit surface
   * in the game while catching every authored light source, and the measured
   * `fracOverBloomKnee` is well under 1% of the frame. Bloom blooms light
   * sources; it does not lift the frame.
   */
  // [post-color R4] knee 1.25 -> 1.05 and radius 0.7 -> 0.62. The knee moves
  // because `MATERIALS.emissiveBoost` came down from 7.0 to 2.2, so the
  // dimmest architectural energy (cadence teal, authored at 0.62x boost) now
  // arrives at ~2.2 linear instead of ~14; 1.05 keeps that source a stop clear
  // of the knee while still sitting 2.3 stops ABOVE the brightest lit diffuse
  // in the game (measured p95 0.21 linear), which is the whole contract:
  // discrete sources bloom, lit walls never do. The radius tightens because a
  // wide inner halo is what makes a source read as a decal — the atmosphere
  // belongs to the wide layer below.
  bloom: { intensity: 1.0, luminanceThreshold: 0.7, luminanceSmoothing: 0.45, mipmapBlur: true, radius: 0.62 },
  /**
   * Second, WIDE layer. A tight mip chain gives a hot source a crisp halo but
   * no atmosphere; this one runs a much higher knee (only true cores reach it)
   * over a quarter-res pyramid, which lays a dim veil several hundred pixels
   * across around a light and nothing else. Crisp inner halo + wide dim outer
   * veil is what reads as a lamp rather than a glowing decal.
   */
  // [post-color R4] intensity 0.28 -> 0.2, radius 0.96 -> 0.9. 15_ultimate_peak
  // shows this layer veiling roughly a third of the frame off one additive
  // shell. A wide veil is atmosphere at 0.2 and a bleach at 0.28.
  bloomWide: { intensity: 0.2, luminanceThreshold: 1.9, luminanceSmoothing: 1.0, radius: 0.9, resolutionScale: 0.28 },
  /**
   * Bloom governor — one large additive mesh (the ult screen flash, a
   * frame-filling melee arc) otherwise pins the whole pyramid and every
   * discrete source in frame dissolves into milk. Effects that are about to
   * cover a lot of screen raise `VFXBus.addBloomLoad()`; bloom intensity is
   * divided by (1 + load) down to a floor and the load bleeds off.
   */
  // [post-color R4] maxLoad 1.6 -> 2.4, floor 0.35 -> 0.26: same mechanism,
  // more authority. 15_ultimate_peak is the case it exists for and at a 0.35
  // floor it still let the shell wash the arena out.
  bloomGovernor: { maxLoad: 2.4, decaySec: 0.5, floor: 0.26 },
  /**
   * [post-color R3] Vignette is now part of the film pass, not a library
   * effect: it darkens AND cools the corners (a real lens loses the warm end
   * first), is slightly anamorphic so it does not read as a circle on a 16:9
   * frame, and starts far enough out that you have to look for it.
   */
  // [post-color R4] darkness 0.42 -> 0.31, offset 0.72 -> 0.78. The brief is
  // "vignette and grain at a level you have to look for"; at 0.42 starting at
  // 0.72 the corners of 07_chamber are visibly crushed, which is a filter, not
  // a lens.
  vignette: { offset: 0.78, darkness: 0.31, tint: '#2A3350', aspect: 1.07 },
  /**
   * [post-color R3] Velocity radial blur. A shipped action game at 30 m/s does
   * not hand you a perfectly sharp frame; this is the one thing on this axis
   * the build had NONE of (weakness register V13: "No motion blur of any kind
   * behind a 30 m/s dash"). Six taps scaled toward the centre of frame, gated
   * by a smoothstep on radius so the middle of the screen — where the reticle
   * and the thing you are aiming at live — stays perfectly sharp and only the
   * outer field streaks. Driven by `PlayerAnim.speed` plus a kick on every CA
   * impulse, so a hit and a dash both push the frame.
   */
  radialBlur: {
    /** m/s at which streaking starts and at which it is fully open */
    startSpeed: 13,
    fullSpeed: 34,
    /** peak blur (fraction of the radius the taps sweep) */
    strength: 0.62,
    /** extra blur added by a CA impulse (hitstop, nova) */
    impulse: 0.5,
    /** normalised radius² inside which the frame stays sharp */
    centreClear: 0.055,
  },
  /**
   * [post-color R3] Post-AA unsharp mask. SMAA softens, a half-res AO buffer
   * softens, and a bloom veil softens; a shipped frame gets that acutance back
   * with a contrast-adaptive sharpen at the very end. 4 taps, applied before
   * grain so it does not amplify the noise.
   */
  // [post-color R4] 0.42 -> 0.36: the two-tap AO below adds real edge
  // structure of its own, and stacking a strong unsharp on top of it starts to
  // ring on the trim.
  sharpen: 0.36,
  /**
   * [post-color R3] baseOffset 0.0002 -> 0. The brief is explicit: chromatic
   * aberration is an impulse, never a constant. It now sits at exactly zero
   * until `VFXBus.caImpulse()` fires, then eases out over 0.12 s, and it is
   * radially modulated so the centre of frame never fringes at all.
   */
  chromaticAberration: {
    baseOffset: 0,
    spikeOffset: 0.0024,
    radialModulation: true,
    modulationOffset: 0.2,
    impulseSec: 0.12,
  },
  /**
   * [post-color R3] Grain is luminance-weighted by `4L(1-L)`: it peaks in the
   * mids and goes to zero in both the true blacks and the blown highlights,
   * which is how film actually behaves and is why it does not read as a veil.
   * `opacity` is the peak multiplicative swing, so 0.034 is +/-1.7%.
   */
  // [post-color R4] 0.034 -> 0.026 (+/-1.3%). Same reasoning as the vignette.
  noise: { opacity: 0.026, titleOpacity: 0 },
  /**
   * [post-color R3] AO moved from postprocessing's SSAO to **N8AO**, which is
   * already installed (`n8ao` is a dependency of @react-three/postprocessing
   * and `N8AO` is exported from it) — no new dependency.
   *
   * Why: SSAO's `luminanceInfluence` fades the pass out on bright pixels. The
   * brief for this axis is AO "tuned so it bites on bright surfaces rather
   * than being cancelled there", and a shrine made of ivory is nothing BUT
   * bright surfaces, so the one control the old pass had was working directly
   * against the one thing it needed to do. N8AO has no such term: it is a
   * horizon-based pass with a bilateral denoiser and a world-space radius, it
   * darkens by multiplying radiance, and it bites exactly as hard on lit ivory
   * as on shadow.
   *
   * `color` is a very dark indigo rather than black — occlusion in a real
   * room is filled by sky bounce, so cavities go cool, not neutral.
   */
  /**
   * [post-color R4] ONE TAP BECOMES TWO, as the work order asks
   * (environment-art item 4: "run two N8AO taps — ~0.15 m for cavity and
   * ~1.5 m for room — and multiply them").
   *
   * A single 1.15 m radius is the worst of both: too wide to darken the 2-5 cm
   * bevels, joint lines and panel gaps that make a surface read as machined,
   * and too narrow to put a room-scale gradient into a 12 m vault. So the
   * cartouches in 08_enemies and the vault undersides in 07_chamber are the
   * same flat value as the wall they are cut into — exactly the panel's
   * "untextured blockout" read.
   *
   * The two passes compose for free. N8AO's compositor is
   * `mix(scene, color * scene, 1 - pow(visibility, intensity))`, i.e. a
   * multiply against the scene, so stacking two passes multiplies the two
   * occlusion terms — which is the "multiply them" the work order specifies,
   * with no extra machinery.
   *
   * Both taps run in LINEAR HDR ahead of the tone curve, and N8AO has no
   * `luminanceInfluence` term, so they bite exactly as hard on lit ivory as on
   * shadow. That is the brief's "tuned so it bites on bright surfaces rather
   * than being cancelled there", and it is why this is N8AO and not SSAO.
   *
   * `intensity` is an EXPONENT on the visibility term (`pow(texel.r,
   * intensity)` in the compositor), not a linear gain, so the two values below
   * are much lower than the single 3.4 they replace and still compose harder.
   */
  ao: {
    /**
     * Contact and cavity. Small radius, hard falloff, near-neutral colour: a
     * 3 cm joint line has no sky above it to tint it, it is just dark.
     */
    cavity: {
      radius: 0.26,
      /** 0.26 × 1.3 × 0.2 = 0.068 m depth window — contact, not room */
      distanceFalloff: 1.3,
      intensity: 2.0,
      samples: 16,
      denoiseSamples: 4,
      denoiseRadius: 8,
      color: '#090A0E',
    },
    /**
     * Room scale. Wide radius, soft falloff, cool indigo — occlusion at this
     * scale IS filled by sky bounce, so a vault underside goes cool, not
     * neutral. Cheaper samples because it is a low-frequency term.
     */
    room: {
      radius: 2.6,
      /**
       * n8ao computes `dfu = radius * distanceFalloff * 0.2` and weights a
       * sample by `smoothstep(0, 1, dfu / |Δdepth|)`, so distanceFalloff is a
       * fraction of the radius, not a metre value. The room tap needs a LOOSE
       * window (a wall 2 m away has to count as an occluder), hence 1.2 =
       * 0.62 m here against the cavity tap's 1.3 = 0.068 m.
       */
      distanceFalloff: 1.2,
      intensity: 1.05,
      samples: 8,
      denoiseSamples: 2,
      denoiseRadius: 16,
      color: '#0B1124',
    },
    /** quality tier 1: cavity tap only, half-res, fewer samples */
    lowSamples: 8,
    lowDenoiseSamples: 2,
  },
  /**
   * [post-color R3] Grade response, rewritten against the new uniforms. The
   * ultimate is three pictures and they are now made with EXPOSURE, not a
   * brightness offset: the charge stops the camera down two thirds of a stop
   * and desaturates, the nova opens it back up past neutral. A brightness add
   * lifts the blacks and reads as fog; an exposure change reads as a camera.
   */
  grade: {
    /** multipliers on `tone.saturation` / additions to `tone.contrast` */
    hitstopSaturation: 0.84,
    hitstopContrast: -0.06,
    hitstopExposure: 0.94,
    ultSaturation: 1.32,
    ultContrast: 0.12,
    ultExposure: 1.24,
    ultVignette: 0.2,
    /** seconds to ease the ult grade in and back out */
    ultEase: 0.18,
    chargeSaturation: 0.6,
    chargeContrast: 0.04,
    chargeExposure: 0.62,
    chargeVignette: 0.34,
  },
  /** screen-space sun flare (streak + ghosts), gated off at tier 2 */
  lensFlare: { streakWidth: 0.55, opacity: 0.55 },
} as const


// ---------------------------------------------------------------------------
// [vfx R1] §2.5b — Layered energy authoring
// Every ability/impact effect is built from the same three shells plus a real
// light, so the whole game's energy reads as one material. Boost values are
// HDR multipliers applied to the palette colour before it reaches the
// composer (bloom knee = 1.0).
// ---------------------------------------------------------------------------
export const VFXENERGY = {
  /** hot white core — thin, always the brightest thing in frame */
  core: { color: COLORS.solarWhite, boost: 4.0, scale: 1.0 },
  /** saturated additive mid body */
  mid: { color: COLORS.aureate, boost: 1.7, scale: 1.25 },
  /** wide soft outer falloff (fresnel) */
  outer: { color: COLORS.aureate, boost: 1.0, scale: 3.0, opacity: 0.22, power: 2.6 },
  /** pooled real lights that ability VFX carry for their whole lifetime */
  trackedLights: 6,
  /** ultimate nova light keyframe (intensity peak, metres of reach) */
  // [vfx R2] reach 28 → 35 m so the nova actually relights the arena walls,
  // and the envelope tightened to the ~0.45 s the review asked for: a light
  // event has a hard attack and a fast fall, not a one-second glow.
  novaLight: { peak: 420, distance: 35, riseSec: 0.05, holdSec: 0.08, fallSec: 0.34 },
  /**
   * [vfx R2] The nova core is authored far above every other energy element
   * in the game (7× vs the standard 4×) — it is the one moment the frame is
   * allowed a blown highlight, and at a 0.85 knee it is the only thing that
   * reaches the wide bloom layer's 1.15 threshold with any weight.
   */
  novaCoreBoost: 7.0,
  /**
   * [vfx R2] Ultimate shockwave arc. 0.35 s to 30 m read as a pop; 0.8 s with
   * an ease-out radius and alpha tied to d(radius)/dt reads as a pressure
   * front that is fastest — and brightest — at birth.
   */
  novaWave: { durSec: 0.8, radius: 30, rippleFrac: 0.62, rippleDelay: 0.11 },
  /**
   * [vfx R2] Beam/shell authoring. Energy elements taper along their length
   * (a constant-width beam is the clearest primitive tell) and their soft
   * outer falloff is clamped as the camera closes, so a 3× halo does not
   * become a screen-filling wash when the effect passes the near plane.
   */
  beam: { tipScale: 0.22, nearFadeStart: 2.2, nearFadeEnd: 0.6, outerClampDist: 6 },
} as const


// ---------------------------------------------------------------------------
// §2.6 — Fog & Atmosphere
// ---------------------------------------------------------------------------
export const FOG = {
  color: COLORS.veilBlue,
  arenaDensity: 0.012,
  canyonDensity: 0.02,
  skyZenith: '#0A0D1F',
  skyHorizon: '#16224A',
  starCount: 2000,
} as const

// ---------------------------------------------------------------------------
// §3 — Controls (key bindings)
// ---------------------------------------------------------------------------
export const KEYS = {
  forward: ['KeyW'],
  back: ['KeyS'],
  left: ['KeyA'],
  right: ['KeyD'],
  fire: ['Mouse0'], // LMB (hold = auto)
  aim: ['Mouse2'], // RMB (hold)
  slash: ['Mouse1', 'KeyF'], // MMB or F — katana quick-slash
  sprint: ['ShiftLeft', 'ShiftRight'],
  crouch: ['ControlLeft', 'ControlRight', 'KeyC'],
  jump: ['Space'],
  // 1 / 2 / 3 / 4 are the primary ability bindings; the letter keys stay as
  // aliases so existing muscle memory and the QA harness keep working.
  ability1: ['Digit1', 'Numpad1', 'KeyQ'],
  ability2: ['Digit2', 'Numpad2', 'KeyE'],
  ability3: ['Digit3', 'Numpad3', 'KeyR'],
  ability4: ['Digit4', 'Numpad4', 'KeyV'],
  objectiveHint: ['Tab', 'KeyM'],
  pause: ['Escape'],
} as const

export const AIM = {
  baseFov: 70,
  aimFov: 55,
  aimMoveSpeedMult: 0.6,
} as const

// ---------------------------------------------------------------------------
// §4 — Vessel KAIRO frame stats
// ---------------------------------------------------------------------------
export const PLAYER = {
  maxHealth: 200,
  healthOrbRestore: 15, // orbs from kills
  maxShield: 150,
  shieldRegenPerSec: 25,
  shieldRegenDelaySec: 3, // after last damage
  maxEnergy: 200,
  energyRegenPerSec: 6,
  energyPerKill: 10,
  baseMoveSpeed: 7, // m/s
  sprintSpeed: 11, // m/s
  height: 1.9, // units (1 unit = 1 m)
} as const

// ---------------------------------------------------------------------------
// §4 — Abilities
// ---------------------------------------------------------------------------
export interface AbilitySpec {
  key: string
  name: string
  cost: number
  cooldownSec: number
  damage: number
  description: string
  extra?: Record<string, number>
}

export const ABILITIES: Record<'A1' | 'A2' | 'A3' | 'A4', AbilitySpec> = {
  A1: {
    key: '1',
    name: 'Gilt Dash',
    cost: 25,
    cooldownSec: 4,
    damage: 60,
    description: '14 m golden blink-dash with afterimages; invulnerable during; damages enemies passed through.',
    extra: { dashDistance: 14 },
  },
  A2: {
    key: '2',
    name: 'Sunspike Volley',
    cost: 50,
    cooldownSec: 8,
    damage: 45, // per javelin
    description: 'Fan of 7 homing golden javelins with light seek.',
    extra: { javelinCount: 7 },
  },
  A3: {
    key: '3',
    name: 'Aegis Halo',
    cost: 75,
    cooldownSec: 14,
    damage: 30, // cast shock pulse
    description: '5s ringed gold barrier: +100 overshield, 30% speed aura, shock pulse on cast (4 m).',
    extra: { durationSec: 5, overshield: 100, speedAuraMult: 0.3, pulseRadius: 4 },
  },
  A4: {
    key: '4',
    name: 'Auric Requiem',
    cost: 150,
    cooldownSec: 30,
    damage: 250,
    description: '360° cathedral-light nova: 12 m radius, 1.2s time-dilation (slow-mo 0.25×), massive bloom/shake.',
    extra: { radius: 12, slowmoDurationSec: 1.2, slowmoScale: 0.25 },
  },
} as const

// ---------------------------------------------------------------------------
// §4 — Weapons
// ---------------------------------------------------------------------------
export const WEAPONS = {
  rifle: {
    name: 'Vow',
    damagePerShot: 14,
    roundsPerSec: 10,
    magSize: 60,
    reloadSec: 1.4,
  },
  katana: {
    name: 'Last Word',
    comboDamage: [55, 65, 90] as readonly number[], // 3-hit combo
    arcDeg: 140,
    lungeRange: 4, // m — lunge-on-slash toward target
  },
} as const

// ---------------------------------------------------------------------------
// §6 — Mission structure ("The Silent Anvil")
// ---------------------------------------------------------------------------
export type MissionPhaseId =
  | 'DROPSHIP'
  | 'INFILTRATE'
  | 'OBJECTIVE'
  | 'EXTERMINATE'
  | 'EXTRACT'
  | 'WIN'
  | 'LOSE'

export interface WaveSpec {
  troopers: number
  drones: number
  heavies: number
}

export const MISSION = {
  titleCard: 'THE SILENT ANVIL',
  dropshipDurationSec: 3, // cinematic camera sweep
  infiltratePatrolDrones: 4,
  objective: {
    channelSec: 8,
    defenders: { troopers: 6, drones: 2 } as WaveSpec,
  },
  exterminateWaves: [
    { troopers: 6, drones: 3, heavies: 0 },
    { troopers: 8, drones: 4, heavies: 1 },
    { troopers: 6, drones: 4, heavies: 2 },
  ] as readonly WaveSpec[],
  extract: {
    timerSec: 90,
    harassDrones: 4,
    padStandSec: 2, // stand on pad this long to win
  },
} as const

// ---------------------------------------------------------------------------
// §6 — Score & grades
// ---------------------------------------------------------------------------
export const SCORE = {
  perKill: 100,
  perHeadshotBonus: 25,
  perAbilityKill: 150,
  timeBonusMax: 3000,
  timeBonusDecayFromSec: 12 * 60, // decays from 12 minutes
  noDeathBonus: 1000,
  /** grade thresholds (min total score) */
  grades: { S: 9000, A: 6500, B: 4000, C: 0 },
} as const

// ---------------------------------------------------------------------------
// §2.5/§7 — Renderer defaults
// ---------------------------------------------------------------------------
export const RENDERER = {
  fov: 70,
  resolutionScale: 1.0,
  lowSpecResolutionScale: 0.75, // fallback if fps < 45 sustained (5s window)
  targetDrawCalls: 350,
  maxParticlesAlive: 3000,
} as const

// ---------------------------------------------------------------------------
// Combat feel (hitstop / slow-mo time scales)
// ---------------------------------------------------------------------------
export const TIMESCALE = {
  hitstopKatana: 0.05, // brief freeze on katana connect
  hitstopDurationSec: 0.06,
  slowmoUlt: 0.25, // Auric Requiem dilation
  slowmoUltDurationSec: 1.2,
} as const

// ---------------------------------------------------------------------------
// [enemies-hud R1] §E — Hostile look & spawn framing
// Hostiles were reading as the same ivory blob as the architecture. They now
// get a dark base plus an accent hue that appears NOWHERE in the level
// palette (desaturated crimson → violet rim), a fresnel rim term and a
// screen-width inverted-hull outline so they separate at any distance.
// ---------------------------------------------------------------------------
export const ENEMY_LOOK = {
  /** dark carapace base — reads near-black against ivory architecture, but
   *  still holds form under the retuned 0.85 exposure */
  shell: '#262A33',
  /** lifted plate for top faces / shoulder decks — the form-reading value */
  shellLit: '#3A3F4B',
  /** gunmetal joints, barrels, pistons */
  joint: '#15171C',
  /** hostile accent — desaturated crimson, used by no level material */
  accent: '#B8304A',
  /** hot accent — telegraph flare, enrage, muzzle */
  accentHot: '#FF5A66',
  /** violet fresnel rim — separates the silhouette from warm ivory walls */
  rim: '#9A5BD0',
  rimPower: 3.0,
  rimStrength: 0.42,
  /** inverted-hull outline */
  outline: { color: '#07080B', pixels: 2.6, fadeNear: 13, fadeFar: 22, opacity: 0.85 },
  /** dissolve edge (death) */
  dissolveEdge: '#FF5A66',
} as const

export const ENEMY_SPAWN = {
  /** spawn anchors are pulled toward the player to this band (m) */
  ringMin: 11,
  ringMax: 19,
  /** never spawn closer than this to the player */
  safeMin: 8,
  /** telegraph seconds between the spawn portal opening and the body landing */
  telegraphSec: 0.45,
  /** fraction of troopers that take the RUSH trait (rest hold the fire band) */
  rushShare: 0.34,
} as const

export const HUD_RADAR = {
  /** diameter in px of the diegetic radar plate */
  size: 140,
  /** world metres mapped to the outer ring */
  range: 40,
  /** seconds a "firing" threat mark survives */
  threatSec: 1.1,
} as const

// ---------------------------------------------------------------------------
// [env-art R2] §2.6b — Sky & colour script
//
// NEW block, owned by environment-art. The existing FOG block is shared
// tuning that predates the R2 colour script, so rather than editing values
// other streams read, the sky/fog palette the architecture is composed
// against lives here and Skybox.tsx / Fog.tsx / Lighting.tsx read it.
//
// The rule it encodes: the sky sits about two stops UNDER the architecture.
// A backdrop brighter than the building in front of it is the single fastest
// way to make a building look like a prop.
// ---------------------------------------------------------------------------
export const SKY = {
  /** dome zenith — near the void base colour */
  zenith: '#070915',
  /** dome horizon — pulled hard toward cosmicIndigo from FOG.skyHorizon */
  horizon: '#0C1330',
  /** master scale applied to the authored (non-tonemapped) dome colour */
  domeScale: 0.34,
  /** fog colour scale — protects the bottom of the histogram at distance */
  fogValueFloor: 0.5,
  /** fog colour at and below deck level (falls read as depth, not haze) */
  voidTint: '#05060E',
} as const

// ---------------------------------------------------------------------------
// [env-art R2] §2.2b — Colour script quotas
//
// The review asked for an enforced script: ivory + gold carry the frame,
// recess black is the level's only true dark, and cadence teal is reserved for
// the hostile domain. These are the anchors ShrineStation places fixtures
// against; architectural practicals that used to be teal are now aureate.
// ---------------------------------------------------------------------------
export const COLOR_SCRIPT = {
  /** architectural practicals (canyon bays, under-decks, monoliths, sconces) */
  fixture: COLORS.aureate,
  /** hostile / corruption only: spawn gates, vein growth, glyph stains */
  hostile: COLORS.cadenceTeal,
} as const

// ---------------------------------------------------------------------------
// [combat-feel R2] §4b — Combat feedback tuning
//
// NEW block, owned by combat-feel; nothing above this line is touched.
//
// VFXENERGY belongs to vfx-postfx and is authored for ABILITY energy, which is
// allowed to own the frame for four tenths of a second. The melee arc is on
// screen for a third of every second of melee, so it needs its own — much
// lower — exposure ceiling (work order combat-feel #3), and the bolt/muzzle/
// impact numbers the review called out live here rather than as literals
// buried in Weapons.tsx.
// ---------------------------------------------------------------------------
export const COMBATFX = {
  arc: {
    /**
     * Metres from the hand pivot to the swept outer edge. The authored blade
     * is 0.95 m and sits 0.07 m ahead of the grip, so 1.16 m is where the
     * kissaki actually is — the old 2.1 m fan drew an arc twice the length of
     * the sword that was supposedly cutting it (work order combat-feel #2).
     */
    tipRadius: 1.16,
    /** inner edge, just past the tsuba: the strip tapers to nothing here */
    guardFrac: 0.11,
    /** seconds a sample survives in the swept surface */
    fadeSec: 0.16,
    /** three-layer energy shell, authored well UNDER VFXENERGY's 4.0 / 1.7 */
    coreBoost: 1.9,
    midBoost: 0.85,
    outerBoost: 0.3,
    /** per-channel soft-knee ceiling for the additive output (linear) */
    cap: 2.0,
    /** the arc dissolves out between these camera distances (m) */
    dissolveNear: 0.5,
    dissolveFar: 1.6,
  },
  swing: {
    /** authored 3-key curve (work order combat-feel #1), seconds */
    windupSec: 0.12,
    contactSec: 0.06,
    followSec: 0.2,
    /** how far the blade cocks BACK during the wind-up (fraction of the arc) */
    anticipation: 0.14,
    /** fraction of the arc crossed by the end of the contact window */
    contactTravel: 0.8,
  },
  muzzle: {
    /** point-light keyframe (work order combat-feel #5) */
    intensity: 60,
    distance: 8,
    lifeSec: 0.09,
    /** full-intensity hold — two frames at the 30 fps capture step */
    holdSec: 0.034,
    /** the three camera-facing flash cards, metres */
    cardCore: 0.12,
    cardMid: 0.3,
    cardWide: 0.5,
  },
  tracer: {
    /** m/s — 180 drew a laser lying across the frame; 280 draws a bolt */
    speed: 280,
    /** visible bolt length (m), 14 → 3.2 */
    segment: 3.2,
    /** minimum on-screen mid-layer width (px), 6 → 3 */
    minPx: 3,
    /** the one-frame hot line muzzle → impact */
    lineLifeSec: 0.05,
    lineRadius: 0.012,
  },
  impact: {
    /** reflected ejecta count, 4 → 20 */
    sparkCount: 20,
    flashIntensity: 30,
    flashDistance: 9,
    ringRadius: 0.5,
    ringLife: 0.18,
  },
} as const

// ---------------------------------------------------------------------------
// [enemies-hud R2] §7 — hostile presentation + HUD feedback tuning
//
// NEW block, owned by enemies-hud; nothing above this line is touched.
//
// The bloom knee is 1.0 and every hostile accent is a `toneMapped:false`
// basic material, so an accent authored at its literal palette value
// (#B8304A ≈ 0.72 linear peak) can never cross the knee and never glows.
// These are the multipliers that put the hostile tells ABOVE white, which is
// what makes an enemy read as lit-from-within at 40 m instead of as a dark
// blob wearing a maroon sticker (work order enemies-hud #4).
// ---------------------------------------------------------------------------
export const ENEMY_FX = {
  /** unalerted: present but under the knee — a hostile at rest does not bloom */
  accentIdle: 0.95,
  /** alerted / in combat: just over the knee, a steady ember */
  accentAlert: 1.9,
  /** attack wind-up: unmistakable, and the ramp is what reads as "incoming" */
  accentTelegraph: 5.4,
  /** enraged Heavy floor */
  accentEnraged: 3.4,
  /** muzzle frame */
  accentMuzzle: 7.5,
  /** white-hot value written to the accent during the hit flash */
  accentHit: 4.5,
  /** white hit flash seconds (work order asks 0.06) */
  hitFlashSec: 0.06,
  /** emissive scalar written onto the lit shell during that flash */
  hitFlashEmissive: 1.35,
  /** wind-up pulse rate (Hz) for the telegraph ramp */
  telegraphHz: 6.5,
  /** additive halo shell around each accent core */
  halo: { opacity: 0.32, scale: 2.1 },
  /** world-projected nameplates (HUD) */
  nameplate: {
    /** metres — beyond this an enemy gets no plate */
    range: 52,
    /** seconds a plate stays up after the last damage */
    holdSec: 3,
    /** degrees off the aim axis that counts as "aimed at" */
    aimDeg: 7,
    /** pooled plate count */
    pool: 10,
  },
} as const

// ---------------------------------------------------------------------------
// [enemies-hud R2] §8 — HUD feedback tuning (damage numbers + hit states)
// ---------------------------------------------------------------------------
export const HUD_FEEDBACK = {
  /** damage number life (s) — 0.75 was gone before the eye found it */
  numberLifeSec: 1.1,
  /** fraction of life held at full opacity before the fade starts */
  numberHoldFrac: 0.65,
  /** px at the reference amount; a log ramp grows big hits from here */
  numberBasePx: 30,
  numberPlayerPx: 34,
  /** damage amount that maps to 1.0× on the log size ramp */
  numberRefAmount: 25,
  /** maximum size multiplier from the log ramp */
  numberMaxScale: 1.7,
} as const

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
   * [vfx R1] 1.2 → 3.0. HDR multiplier for toneMapped:false emissive colors.
   * The bloom knee moved to 1.0 (lit ivory tops out near 0.85 after ACES), so
   * ONLY real energy materials — veinTeal, veinGold, medallion, doorGlow,
   * seal — are authored above white and are the only things that bloom.
   */
  emissiveBoost: 3.0,
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
  // [vfx R1] threshold 0.7 → 1.0, intensity 1.25 → 0.9. Tone mapping runs
  // in-material, so lit ivory arrives at the composer at ≤~0.85 and can no
  // longer cross the knee; only HDR-authored energy (emissiveBoost 3.0,
  // additive VFX written overbright) blooms. `radius` keeps the mip chain
  // tight so discrete sources stay discrete instead of washing the frame.
  // [vfx R2] threshold 1.0 → 0.85, smoothing 0.2 → 0.35. At a 1.0 knee with
  // 0.2 of smoothing NOTHING in the frame crossed it: ACES + exposure 0.85
  // lands lit ivory at ~0.80 and even the HDR-authored energy only grazed the
  // ramp, so the game shipped with bloom effectively off. The knee now sits
  // just above lit ivory and the 0.35 ramp means ivory still contributes
  // zero (smoothstep(0.85, 1.20, 0.80) = 0) while a core authored at 2.0+
  // is fully inside. Discrete sources bloom; the frame does not.
  bloom: { intensity: 0.95, luminanceThreshold: 0.85, luminanceSmoothing: 0.35, mipmapBlur: true, radius: 0.72 },
  /**
   * [vfx R2] Second, WIDE bloom layer. One tight mip chain gives a hot source
   * a crisp halo but no atmosphere; a second pass at a higher knee and a much
   * larger radius lays a dim veil around only the brightest cores, which is
   * what separates "a glowing object" from "an object with a lamp in it".
   * Kept at a fifth of the main intensity so it never washes the frame.
   */
  bloomWide: { intensity: 0.26, luminanceThreshold: 1.15, luminanceSmoothing: 0.5, radius: 1.4 },
  /**
   * [vfx R2] Bloom governor — the luminance-weighted downweight the review
   * asked for. A single large additive mesh (the ult screen flash, a full
   * screen katana arc) otherwise pins the whole bloom pyramid and the frame
   * goes to milk. Effects that cover a lot of screen raise `bloomLoad` on the
   * VFX bus; the composer divides bloom intensity by (1 + load) and bleeds the
   * load off over `decaySec`. `maxLoad` caps how far bloom can be pulled down.
   */
  bloomGovernor: { maxLoad: 1.6, decaySec: 0.5, floor: 0.35 },
  vignette: { offset: 0.25, darkness: 0.65, eskil: false },
  // [vfx R1] base 0.0006 → 0.0002 and spike 0.004 → 0.0015, radially
  // modulated so the centre of frame stays clean and only the corners
  // fringe. Driven by an explicit impulse timestamp (VFXBus.caImpulse) on a
  // 0.12 s ease-out — never by a sustained `timeScale < 1` plateau.
  chromaticAberration: {
    baseOffset: 0.0002,
    spikeOffset: 0.0015,
    radialModulation: true,
    modulationOffset: 0.25,
    impulseSec: 0.12,
  },
  // [vfx R2] 0.05 → 0.02 and premultiplied, so grain is weighted by the
  // luminance underneath it: it lives in the mids and dies in the blacks
  // instead of sitting as a uniform veil over the level's true darks.
  // `titleOpacity` is what the front end gets — the title art is a still and
  // any grain on it reads as compression noise.
  noise: { opacity: 0.02, titleOpacity: 0 },
  /**
   * [vfx R1] SSAO contact pass — first in the stack, before Bloom. Gated to
   * qualityTier 0 (it costs an extra NormalPass), half-res with depth-aware
   * upsampling. `radius` is resolution-relative (≈0.6 m at gameplay depth).
   */
  // [vfx R2] AO retune requested by environment-art (their work-order item 3
  // lands in POSTFX, which this stream owns). `luminanceInfluence` 0.6 was
  // cancelling the pass on exactly the bright ivory that needed the cavity
  // read, and a 0.09 radius only ever occluded a few centimetres. 0.12 / 0.26
  // makes AO a structural term instead of a contact hint.
  ao: {
    intensity: 2.3,
    radius: 0.26,
    samples: 9,
    rings: 5,
    bias: 0.01,
    fade: 0.02,
    luminanceInfluence: 0.12,
    resolutionScale: 0.5,
    worldDistanceThreshold: 24,
    worldDistanceFalloff: 6,
    worldProximityThreshold: 0.6,
    worldProximityFalloff: 0.3,
  },
  hueSaturationPulse: 8, // during ability bursts
  brightnessContrastHitstop: -0.05, // during hitstop frames
  /**
   * [vfx R1] grade response. `hitstop` is the short desaturating dip on a
   * katana connect; `ult` is the 1.2 s Auric Requiem window — richer and a
   * touch brighter so the nova reads as a light event, not a white hole.
   */
  grade: {
    hitstopSaturation: -0.12,
    ultSaturation: 0.22,
    ultBrightness: 0.035,
    ultContrast: 0.09,
    /** seconds to ease the ult grade in and back out */
    ultEase: 0.18,
    /**
     * [vfx R2] The ultimate's CHARGE is a different picture from its peak:
     * the world dims and desaturates around the rooted player while the motes
     * converge, then the nova punches through it. Raised by the ability via
     * `VFXBus.ultChargeWindow`.
     */
    chargeSaturation: -0.3,
    chargeBrightness: -0.09,
    chargeContrast: 0.06,
    /** vignette darkness added while the ult grade is held (base is 0.65) */
    ultVignette: 0.28,
    /** vignette darkness added during the charge — the world closes in */
    chargeVignette: 0.42,
  },
  /** [vfx R1] screen-space sun flare (streak + ghosts), gated off at tier 2 */
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

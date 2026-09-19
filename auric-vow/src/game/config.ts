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
  exposure: 0.85,
  key: { color: '#FFE3B3', intensity: 2.2, angleFromBehindLeftDeg: 35, shadowMapSize: 2048 },
  // [env-art R1] 0.7 → 0.32: uniform fill was flattening every form
  hemisphere: { skyColor: '#2A3A6E', groundColor: '#0C0E16', intensity: 0.32 },
  /** static teal point lights at energy-vein clusters */
  // [env-art R1] retuned to a real fixture falloff; positions now derive from
  // the actual vein strips and only the nearest 4 are lit (Lighting.tsx)
  tealPractical: { color: COLORS.cadenceTeal, intensity: 6, distance: 6, decay: 2 },
  /** [env-art R1] gold practicals at purified vein clusters (nearest 2) */
  goldPractical: { color: COLORS.aureate, intensity: 3.2, distance: 8, decay: 2 },
  /** [env-art R1] near shadow cascade half-extent (m), recentred on camera */
  shadowNear: { extent: 32, mapSize: 2048, bias: -0.0002, normalBias: 0.02 },
  /** [env-art R1] far cascade for distant blockers */
  shadowFar: { extent: 130, mapSize: 1024, bias: -0.0006, normalBias: 0.06 },
  /** [env-art R1] key energy split between the two cascades */
  cascadeSplit: 0.72,
  /** weak warm camera-side fill — follows the camera so shadow sides never go pitch black */
  // [env-art R1] 0.55 → 0.25: shadow sides are allowed to be dark
  cameraFill: { color: '#FFE9C4', intensity: 0.25 },
  /** cool indigo rim from the far +Z end — separates silhouettes against the void */
  // [env-art R1] halved (0.75 → 0.35) and re-aimed across the mission axis
  coolRim: { color: '#8FA3E8', intensity: 0.35 },
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
  envMapResolution: 512,
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
  bloom: { intensity: 0.9, luminanceThreshold: 1.0, luminanceSmoothing: 0.2, mipmapBlur: true, radius: 0.7 },
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
  noise: { opacity: 0.05 },
  /**
   * [vfx R1] SSAO contact pass — first in the stack, before Bloom. Gated to
   * qualityTier 0 (it costs an extra NormalPass), half-res with depth-aware
   * upsampling. `radius` is resolution-relative (≈0.6 m at gameplay depth).
   */
  ao: {
    intensity: 2.0,
    radius: 0.09,
    samples: 9,
    rings: 5,
    bias: 0.03,
    fade: 0.02,
    luminanceInfluence: 0.6,
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
  novaLight: { peak: 450, distance: 28, riseSec: 0.06, holdSec: 0.1, fallSec: 0.9 },
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
  ability1: ['KeyQ'],
  ability2: ['KeyE'],
  ability3: ['Digit1', 'KeyR'],
  ability4: ['Digit4', 'Digit2', 'KeyV'],
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
    key: 'Q',
    name: 'Gilt Dash',
    cost: 25,
    cooldownSec: 4,
    damage: 60,
    description: '14 m golden blink-dash with afterimages; invulnerable during; damages enemies passed through.',
    extra: { dashDistance: 14 },
  },
  A2: {
    key: 'E',
    name: 'Sunspike Volley',
    cost: 50,
    cooldownSec: 8,
    damage: 45, // per javelin
    description: 'Fan of 7 homing golden javelins with light seek.',
    extra: { javelinCount: 7 },
  },
  A3: {
    key: '1',
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

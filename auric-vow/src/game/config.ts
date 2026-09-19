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
  exposure: 1.15,
  key: { color: '#FFE3B3', intensity: 2.2, angleFromBehindLeftDeg: 35, shadowMapSize: 2048 },
  hemisphere: { skyColor: '#2A3A6E', groundColor: '#0C0E16', intensity: 0.7 },
  /** static teal point lights at energy-vein clusters */
  tealPractical: { color: COLORS.cadenceTeal, intensity: 10, distance: 18, decay: 2 },
  /** weak warm camera-side fill — follows the camera so shadow sides never go pitch black */
  cameraFill: { color: '#FFE9C4', intensity: 0.55 },
  /** cool indigo rim from the far +Z end — separates silhouettes against the void */
  coolRim: { color: '#8FA3E8', intensity: 0.75 },
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
   * HDR multiplier for toneMapped:false emissive colors — pushes veins /
   * medallion / glow stripes just past the bloom luminanceThreshold (0.7)
   * without blowing out to pure white.
   */
  emissiveBoost: 1.2,
  envMapResolution: 256,
} as const

// ---------------------------------------------------------------------------
// §2.5 — Post-FX stack
// ---------------------------------------------------------------------------
export const POSTFX = {
  bloom: { intensity: 1.25, luminanceThreshold: 0.7, luminanceSmoothing: 0.25, mipmapBlur: true },
  vignette: { offset: 0.25, darkness: 0.65, eskil: false },
  chromaticAberration: { baseOffset: 0.0006, spikeOffset: 0.004 },
  noise: { opacity: 0.05 },
  hueSaturationPulse: 8, // during ability bursts
  brightnessContrastHitstop: -0.05, // during hitstop frames
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

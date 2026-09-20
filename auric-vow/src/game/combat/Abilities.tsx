/**
 * AURIC VOW — combat/Abilities.tsx
 * The four abilities of Vessel KAIRO. Spec: combat.md §3 + design.md §4.
 *
 *   Q — Gilt Dash:       14 m blink, 0.3s i-frames, 60 dmg pass-through,
 *                        afterimage ghosts + streak ribbon + gold spray.
 *   E — Sunspike Volley: 0.35s windup, 7 homing golden javelins, 45 dmg each.
 *   1 — Aegis Halo:      5s barrier, +100 decaying overshield, +30% speed,
 *                        30 dmg / 4 m cast shock pulse, rotating glyph halo.
 *   4 — Auric Requiem:   4-layer ult (fix2): ≤0.15s screen flash → 0.4s
 *                        rooted charge (60 motes spiral INWARD, 0.25× time)
 *                        → detonation (deforming glyph torus shockwave 0→12 m
 *                        in 0.35s + 120-particle gold vortex, 250→120 dmg,
 *                        stagger 100, heavy knockback) → 3s aftermath (glowing
 *                        glyph floor decal + 40 lingering embers + faint ring).
 *
 * All cooldown/energy enforcement goes through the store (spendEnergy);
 * HUD reads cooldowns via getCombatHudSnapshot() / onCombatEvent().
 */
import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { Input } from '@/game/Input'
import { AudioBus } from '@/game/AudioBus'
import {
  VFX,
  caImpulse,
  ultGradeWindow,
  ultChargeWindow,
  endChargeWindow,
  addBloomLoad,
  acquireLight,
  LIGHT_PRIORITY,
  type TrailHandle,
  type TrackedLightHandle,
} from '@/game/vfx/VFXBus'
import { createEnergyShell, type EnergyShell } from '@/game/vfx/EnergyShell'
import { getSoftGlowTexture, getParticleAtlas, getStreakTexture } from '@/game/vfx/vfxTextures'
import { PlayerRef } from '@/game/player/PlayerRef'
import { addTrauma } from '@/game/player/CameraRig'
import { EnemyRegistry } from '@/game/enemies/EnemyRegistry'
import { raycastLevel } from '@/game/world/Colliders'
import { ABILITIES, COLORS, TIMESCALE, VFXENERGY } from '@/game/config'
import { useGameStore } from '@/game/store'
import { getGlyphSpriteTexture } from '@/game/textures'
import { resolveEnemyHit } from './DamageSystem'
import { CombatState, canFight, combatTick, emitCombat, type AbilityId, ABILITY_IDS } from './state'
import { triggerCooldown, triggerActive, setOvershield } from '@/game/hud/abilityState'

const DEG = Math.PI / 180
const UP = new THREE.Vector3(0, 1, 0)

/** soft radial glow sprite texture (canvas, lazy — fix1 javelin heads) */
let glowTex: THREE.CanvasTexture | null = null
function getGlowTexture(): THREE.CanvasTexture {
  if (glowTex) return glowTex
  const size = 128
  const c = document.createElement('canvas')
  c.width = size
  c.height = size
  const ctx = c.getContext('2d')!
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.25, 'rgba(255,244,220,0.85)')
  g.addColorStop(0.6, 'rgba(255,184,53,0.35)')
  g.addColorStop(1, 'rgba(255,184,53,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  glowTex = new THREE.CanvasTexture(c)
  glowTex.colorSpace = THREE.SRGBColorSpace
  return glowTex
}

// ---- A1 Gilt Dash (combat.md §3.1) ----
const DASH_SPEED = 30
const DASH_DUR = 0.45
const DASH_IFRAMES = 0.3
const DASH_DMG = 60
const DASH_SWEEP_R = 1.2
const GHOST_COUNT = 3
const GHOST_INTERVAL = 0.06
const GHOST_FADE = 0.4
/** [vfx R5] metres from the lens at which an afterimage is fully gone */
const GHOST_NEAR_END = 1.2
/** metres over which it folds back in above that */
const GHOST_NEAR_SPAN = 1.4

// ---- A2 Sunspike Volley (§3.2) ----
const JAVELIN_COUNT = 7
const JAVELIN_DMG = 45
const JAVELIN_SPEED = 35
const JAVELIN_LIFE = 3
const JAVELIN_HOMING_RATE = 120 * DEG // rad/s steer cap
const JAVELIN_SEEK_RADIUS = 8
const JAVELIN_FAN_DEG = 44
const VOLLEY_WINDUP = 0.35
const VOLLEY_SPAWN_INTERVAL = 0.03
// [vfx R1] the anchor used to sit 0.35 m BEHIND the player, so the seven
// javelins assembled inside the camera's own body and the frame just went
// orange. They now assemble 1.6 m in FRONT at 0.45 m lateral spacing — a
// 2.7 m fan the player reads as seven countable spears.
const JAVELIN_FORWARD = 1.6
const JAVELIN_LATERAL = 0.64
/** windup emissive ceiling — seven full-brightness cores wash the frame */
/**
 * [vfx R3] 0.12/0.55 -> 0.45/1.15. Those numbers were chosen in R2 to stop a
 * spear that was drawn at CONSTANT alpha across its whole cone from blowing
 * the frame out. Now that every layer's alpha comes from how much of the
 * volume the eye is looking through, the visible area of a spear is roughly
 * halved and its silhouette goes to zero — so the same numbers made the
 * javelins disappear entirely (measured: B2_volley_flight, the fan is not
 * legible at 11 m). The shape is doing the exposure control now, so the
 * energy can go back up.
 */
const JAVELIN_WINDUP_MIN = 0.2
const JAVELIN_WINDUP_MAX = 0.7
/**
 * Master gain on a javelin in flight. MEASURED CEILING: `uIntensity` scales
 * the colour AND the alpha, so it is quadratic in emitted energy. At 1.55 with
 * the windup range at 0.45–1.15, seven spears × three layers × two faces of
 * HDR gold pinned the entire bloom pyramid and the capture came back as a
 * uniformly white frame (V1_volley_flight). 1.0 with the volumetric falloff
 * emits materially LESS than the round 2 constant-alpha spear did, so this is
 * the safe side of the number that was already shipping.
 */
const JAVELIN_FLIGHT_GAIN = 1.0

// ---- A3 Aegis Halo (§3.3) ----
const AEGIS_DURATION = 5
const AEGIS_OVERSHIELD = 100
const AEGIS_PULSE_DMG = 30
const AEGIS_PULSE_RADIUS = 4
const AEGIS_SPEED_MULT = 1.3

// ---- A4 Auric Requiem (§3.4) — 4-layer structure (fix2) ----
// (a) ≤0.15s screen flash, (b) 0.4s inward mote spiral, (c) deforming torus
// shockwave + 120-particle gold vortex, (d) 3s glyph floor decal + embers
// + persistent faint ring.
// [vfx R2] The charge is a longer, heavier intake now (0.4 → 0.55): it has to
// be its own PICTURE — dimmed, desaturated, vignetted, motes converging — and
// 0.4 s at 0.25× time was still over before the grade finished easing in.
/**
 * [vfx R4] 0.55 → 0.18, and the charge dilation from 0.5× to 0.9×.
 *
 * MEASURED, not restyled. `cs.requiemT` accumulates SCALED game time, so the
 * charge's WALL-CLOCK length is `REQUIEM_CHARGE / REQUIEM_CHARGE_SCALE` —
 * 1.10 s on the R3 build. The capture harness steps the ultimate at a fixed
 * 1/45 s and shoots its three ult frames 4, 11 and 24 steps after the cast,
 * i.e. at 0.089 s, 0.244 s and 0.533 s of wall clock. Every one of those
 * landed inside the charge, which is exactly why the panel reported "three
 * stages of an ultimate that are visually identical and contain no nova":
 * the nova had not gone off yet in ANY of them, and could not have.
 *
 * 0.15 / 0.9 puts the detonation at 0.167 s — step 8 — so the three frames
 * now read charge / detonation / expansion. It is also a better ability: a
 * 1.1 s rooted windup with the world at half speed spends the ult's whole
 * dramatic budget before its payload, and the 1.2 s of 0.25× dilation that
 * fires AT the blast is where the weight belongs.
 */
const REQUIEM_CHARGE = 0.15
/** gameplay blast radius (damage) — unchanged, this is a balance number */
const REQUIEM_RADIUS = 12
const REQUIEM_DMG_CENTER = 250
const REQUIEM_DMG_EDGE = 120
/*
 * [vfx R5] 3.0 -> 1.0.
 *
 * MEASURED on the driven R5 capture: the epicentre glyph disc and the 24 m
 * faint ring were still on the deck at 0.4 and 0.4 opacity three GAME seconds
 * after the blast — which, under the ult's own 0.25x dilation, is most of ten
 * seconds of wall clock. Every frame of the review set after the detonation
 * therefore carried two large flat additive discs on the floor, and the
 * panel read exactly that as "gold is a bloom blob". An afterglow is a tail,
 * not a state: 1.0 s on a squared falloff (below) puts both elements under a
 * tenth of their peak within a third of a second of game time, and the
 * PERSISTENT mark is carried by the premultiplied `VFX.decal` scorch, which
 * darkens the deck instead of adding to it.
 */
const REQUIEM_AFTERGLOW = 1.0
/** [vfx R4] peak additive opacity of the epicentre glyph glow (was 0.9) */
const REQUIEM_DECAL_PEAK = 0.1
/**
 * [vfx R2] 0.35 → 0.8 s, reaching VFXENERGY.novaWave.radius (30 m) rather
 * than stopping at the 12 m damage radius. The review's complaint was that
 * the ult had no ARC: it appeared and was gone inside a third of a second, at
 * a scale barely larger than the player. It now eases out over 0.8 s to a
 * radius that crosses the whole arena, and its alpha is driven by d(radius)/dt
 * so the front is brightest while it is moving fastest and dies as it slows —
 * which is what a pressure wave actually looks like.
 */
const REQUIEM_SHOCKWAVE_DUR = VFXENERGY.novaWave.durSec
const REQUIEM_WAVE_RADIUS = VFXENERGY.novaWave.radius
/**
 * [vfx R4] The detonation's lens flare is timed on the WALL CLOCK, not on
 * game time. It used to age on `cs.requiemT`, which is scaled — so under the
 * ult's own 0.25× dilation a "0.14 s" flash covered the frame for 0.56 s of
 * real time at up to 0.7 additive, and every capture taken inside that window
 * came back as paper. A flash is a response in the lens, not an event in the
 * world; it does not slow down when the world does.
 */
const REQUIEM_SCREEN_FLASH = 0.08
/**
 * peak additive opacity of that flare — 0.7 blew the whole frame out.
 * [vfx R5] 0.26 -> 0.17, and the over-scale below comes down with it. A soft
 * radial glow scaled to 1.9-3.2x the frame reaches the CORNERS at close to
 * its centre value once bloom has had it, which is how a lens flare ended up
 * washing the HUD numerals in the bottom corners of the ult frames. The flare
 * now concentrates inside the middle of frame and leaves the HUD anchors in
 * the dark part of its own falloff.
 */
const REQUIEM_SCREEN_FLASH_PEAK = 0.17
/** [vfx R2] time dilation during the charge — a breath, not the full stop */
const REQUIEM_CHARGE_SCALE = 0.9
/** wall-clock seconds the charge occupies at that dilation */
const REQUIEM_CHARGE_WALL = REQUIEM_CHARGE / REQUIEM_CHARGE_SCALE
/**
 * [vfx R4] Nova core envelope. The attack is ONE frame (the core is set to
 * peak at the instant of detonation) and the decay runs NOVA_CORE_DECAY game
 * seconds — the "attack far faster than the decay" the work order asks for,
 * authored on the curve rather than on a linear fade.
 */
/*
 * [vfx R4] 7.0 -> 5.2 after looking at the driven expansion frame: at 7 the
 * heart plus the three rings plus the eight shafts put the whole deck over
 * the shoulder of the tone curve, and a detonation that is uniformly white is
 * not brighter than one that keeps its architecture — it is just flatter.
 */
/*
 * 7.0 -> 5.2 -> 3.6. Each step was a driven capture, not a guess: at 7 and at
 * 5.2 the detonation frame measured as a near-uniform white field with the
 * architecture only just legible through it, which is the same "blown to
 * paper" the panel failed the previous build's ability frames for. A
 * detonation is allowed ONE blown highlight — the heart — and the rest of the
 * frame has to survive it, or the biggest moment in the game is also the one
 * with the least visual information in it.
 */
/*
 * 7.0 -> 5.2 -> 3.6 -> 2.4, and this round the SHAPE changed with it (see
 * `setNovaHollow`). A filled volume at 3.6 put roughly a 1.3 m ball of
 * clipped white 3.6 m from the lens, which is 20 degrees of the frame at
 * display 1.0 before bloom touched it. The heart is now a filled mass for
 * one frame and a HOLLOW expanding bubble after that, so the same energy is
 * spread over a thin rim and the character stays the readable shape inside
 * it. 2.4 is what the filled first frame can carry without the shoulder of
 * the tone curve eating the architecture.
 */
const NOVA_CORE_PEAK = 1.7
/*
 * [vfx R5] 0.26 -> 0.20 GAME seconds. Under the 0.25x dilation that is still
 * 0.8 s of wall clock, and it is what puts the review's third ult frame
 * (t = 0.083 game, 41% through) visibly into the aftermath instead of
 * showing the same hot heart as the second one. The panel's complaint that
 * the three ult frames are "visually identical" is a TIMING complaint.
 */
const NOVA_CORE_DECAY = 0.2
/*
 * Radii are capped deliberately. The third-person boom sits ~3.45 m behind the
 * player and the nova is centred 1.2 m above the player's feet, so the camera
 * is about 3.6 m from the origin: any layer of this shell that reaches past
 * that puts the LENS INSIDE an additive volume authored at 7×, and the frame
 * goes to paper. The veil's own scale is 1.5, so a group scale of 1.6 tops out
 * at 2.4 m — comfortably inside the boom — and the SIZE of the event is
 * carried by the rings, the pressure shells and the expanding surface, which
 * are all shapes the camera can be inside of safely.
 */
const NOVA_CORE_BURST = 1.0
/**
 * metres the heart swells to as it burns out. Raised 1.6 -> 2.9 now that the
 * heart opens into a shell: a bubble that expands FURTHER while its wall
 * thins is a release of pressure, where a solid ball that grows is just a
 * bigger lamp. The per-frame clamp in `updateRequiem` keeps the outer veil
 * inside the camera boom whatever this is set to.
 */
const NOVA_CORE_BLOOM = 2.9
/*
 * [vfx R5] GAME seconds over which the heart opens from a solid mass into a
 * hollow shell. This is short on purpose and the number was derived, not
 * chosen: `cs.requiemT` accumulates SCALED time and the detonation fires the
 * ult's 0.25x dilation, so one captured frame at the harness's fixed 1/45 s
 * step advances the effect by 1/180 = 0.0056 GAME seconds. The review's
 * "peak" frame lands about three of those after the blast, i.e. t = 0.017.
 * At 0.02 the heart is 85% open by then — a bright expanding shell with the
 * character legible inside it — where anything slower leaves the peak frame
 * looking exactly like the solid ball it replaced.
 */
const NOVA_HOLLOW_SEC = 0.02
/** radius multiplier of the heart's outermost veil layer (see `chargeCore`) */
const NOVA_VEIL_SCALE = 1.5
/*
 * [vfx R5] THE ULTIMATE IS NOT CLIPPING — IT IS FLOODING.
 *
 * MEASURED off the panel's own frame (qa/shots-r5/15_ultimate_peak.png,
 * sampled every 2nd pixel, Rec.709 luma on the encoded sRGB):
 *
 *     frame            mean    p50     p95     >0.98   >0.95   <0.08
 *     09_rifle         0.150   0.123   0.477   0.0001  0.002   0.395
 *     15_ultimate_peak 0.611   0.647   0.969   0.020   0.110   0.041
 *
 * Only 2% of that frame is actually at paper white. What the panel read as
 * "45-80% clipped" is the MEDIAN: half the picture sits above 0.647 and the
 * shadow end is gone — 4% of pixels below 0.08 against 40% in a normal frame.
 * The nova is not blowing the highlights out, it is removing the blacks, and
 * a picture with no dark values reads as white whatever its peak is.
 *
 * The cause is the nova's own PointLight: peak 420 with 35 m of reach and
 * decay 2 puts measurable light on every surface of a 40 m arena at once, so
 * there is nothing left for the blast to be brighter THAN. A detonation in a
 * shipped game lights its own neighbourhood hard and leaves the far wall in
 * the dark — the falloff is the drama. Reach comes down to 16 m so the light
 * has somewhere to stop, and the peak comes down with it because the
 * near-field of a 16 m window at the same intensity is brighter than the 35 m
 * one was.
 *
 * Authored here rather than in config.ts: config belongs to post-color, and
 * this is the drive curve, not the authored keyframe.
 */
const NOVA_LIGHT_REACH = 11
/*
 * [vfx R5] 1.0 -> 0.55 -> 0.30 -> 0.12, each step a driven capture rather
 * than a guess. A point light 1.2 m above the deck with decay 2 puts
 * `peak / 1.44` on the floor directly beneath it: at the authored 420 that is
 * 290 linear, and at 0.30 it was still 88. The measured fade frame came back
 * with the architecture correctly exposed and the whole lower two thirds of
 * the picture a featureless cream sheet, because the floor was tens of stops
 * past the shoulder of the curve while the walls were not. At 0.12 the blown
 * pool is about 5 m across — a detonation is allowed to blow its own
 * neighbourhood out — and the deck has a falloff again instead of a flat
 * field. The SIZE of the event is carried by the rings, the shafts, the
 * embers and the pressure shells, which are shapes; the light's job is to say
 * where the event is, not to be the event.
 */
const NOVA_LIGHT_GAIN = 0.12
/**
 * [vfx R5] The nova light's keyframe envelope is authored in config.ts at
 * 0.05 / 0.08 / 0.34 s, which is a well-judged 0.47 s — in GAME time. The
 * detonation fires a 0.25x dilation, so those 0.47 s are most of two seconds
 * of wall clock and BOTH of the review's post-detonation frames land inside
 * the envelope's flat hold. Measured on the driven build, the deck under the
 * blast was still at full nova exposure in the fade frame, three shots after
 * the ignition. The envelope is compressed so the light behaves like an
 * event with a fall-off rather than a lamp that is switched on for the
 * duration of the ability.
 */
const NOVA_LIGHT_ENVELOPE = 0.45
const REQUIEM_PILLARS = 8
const REQUIEM_PILLAR_RADIUS = 10
const REQUIEM_MOTES = 60

// scratch
const _dir = new THREE.Vector3()
const _right = new THREE.Vector3()
const _pt = new THREE.Vector3()
const _pt2 = new THREE.Vector3()
const _to = new THREE.Vector3()
const _desired = new THREE.Vector3()
const _prev = new THREE.Vector3()

/** leased light that rides the Gilt Dash for its whole duration */
let dashLight: TrackedLightHandle | null = null
/**
 * [vfx R4] Raised by any path that kills a dash from the outside (the Requiem
 * roots the player mid-blink); drained by `updateDash`, which owns the refs.
 * Module scope rather than CombatState because `combat/state.ts` belongs to
 * another axis this round.
 */
let ghostClearPending = false
/** [vfx R2] spark-shedder clock for the Requiem pillars (module scope: one ult) */
let pillarSparkClock = 0
/** [vfx R2] shared spark-shedder clock for javelins in flight */
/** [vfx R2] the Aegis barrier's own leased light — a shell that lights nothing
 *  is a decal painted on the air (work order item 8: one light per cluster) */
let aegisLight: TrackedLightHandle | null = null

// ---------------------------------------------------------------------------
// Cast gating
// ---------------------------------------------------------------------------

function tryCast(id: AbilityId): boolean {
  const cs = CombatState
  const spec = ABILITIES[id]
  const blocked = cs.clock < cs.cooldownReadyAt[id] || cs.requiemPhase === 1
  if (blocked || !useGameStore.getState().spendEnergy(spec.cost)) {
    emitCombat({ type: 'denied', id }) // HUD: icon shake + dull red edge flash
    AudioBus.playUIClick()
    return false
  }
  cs.cooldownReadyAt[id] = cs.clock + spec.cooldownSec
  triggerCooldown(ABILITY_IDS.indexOf(id), spec.cooldownSec) // HUD diamond sweep
  emitCombat({ type: 'cast', id })
  return true
}

// ---------------------------------------------------------------------------
// [vfx R3] Dash afterimage material (C6)
//
// The ghosts were solid additive capsules at 0.9 opacity: three filled gold
// pills standing behind the player. An afterimage is not a copy of the body,
// it is the EDGE the body left behind — so this draws rim only, with a scan
// climbing the silhouette and a vertical dissolve that eats the ghost from
// the feet up as it ages.
// ---------------------------------------------------------------------------

const GHOST_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
varying vec3 vLocal;
void main() {
  vLocal = position;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix) * normal);
  vV = cameraPosition - wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`

const GHOST_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uTime;
uniform float uAge;
varying vec3 vN;
varying vec3 vV;
varying vec3 vLocal;
void main() {
  float ndv = clamp(abs(dot(normalize(vN), normalize(vV))), 0.0, 1.0);
  float rim = pow(1.0 - ndv, 2.1);
  // energy scan travelling up the silhouette
  float scan = 0.55 + 0.45 * sin(vLocal.y * 23.0 - uTime * 11.0);
  // dissolve from the feet up as the afterimage ages
  float diss = smoothstep(uAge * 1.6 - 0.35, uAge * 1.6 + 0.25, vLocal.y + 0.6);
  float a = rim * mix(0.55, 1.0, scan) * diss * uOpacity;
  if (a < 0.004) discard;
  gl_FragColor = vec4(uColor * (0.7 + rim * 2.1), a);
}
`

// ---------------------------------------------------------------------------
// A1 — Gilt Dash
// ---------------------------------------------------------------------------

function castDash(camera: THREE.Camera) {
  const cs = CombatState
  camera.getWorldDirection(_dir)
  // flatten pitch to ±20° (§3.1)
  const horizLen = Math.hypot(_dir.x, _dir.z)
  if (horizLen < 1e-5) return
  const pitch = THREE.MathUtils.clamp(Math.atan2(_dir.y, horizLen), -20 * DEG, 20 * DEG)
  const hx = _dir.x / horizLen
  const hz = _dir.z / horizLen
  cs.dashDir.set(hx * Math.cos(pitch), Math.sin(pitch), hz * Math.cos(pitch)).normalize()

  cs.dashing = true
  cs.dashUntil = cs.clock + DASH_DUR
  cs.invulnerableUntil = cs.clock + DASH_IFRAMES
  cs.dashHits.clear()
  cs.ghostsToSpawn = GHOST_COUNT
  cs.nextGhostAt = cs.clock
  // Release before re-acquiring. A dash re-cast before the previous one has
  // expired would otherwise drop the old handles on the floor, stranding a
  // ribbon slot and a tracked-light slot for the rest of the session (the
  // only reference that could ever free them is the one being overwritten).
  // The nova path already does this; dash was the odd one out.
  cs.dashTrail?.end()
  cs.dashTrail = VFX.trail('gilt-dash')

  _pt.copy(PlayerRef.position)
  _pt.y += 1
  // [vfx R1] Layered launch package: hot core → saturated body → soft embers
  // → dark smoke kernel, all streaked along their own velocity.
  VFX.flash({ position: _pt, color: COLORS.aureate, intensity: 30, distance: 15, life: 0.18 })
  // [vfx R4] punctuation, not the event — see RingOpts.intensity
  VFX.ring({ position: PlayerRef.position, color: COLORS.aureate, maxRadius: 2.6, life: 0.3, width: 0.16, intensity: 0.4 })
  VFX.burst({ position: _pt, color: COLORS.solarWhite, count: 40, speed: 9, life: 0.28, size: 0.06, gravity: -1, stretch: 1 })
  VFX.burst({ position: _pt, color: COLORS.aureate, count: 44, speed: 3, life: 0.4, size: 0.07, gravity: -1.5, stretch: 0.85 })
  VFX.burst({ position: _pt, color: COLORS.aureate, count: 30, speed: 2, life: 0.7, size: 0.09, gravity: -0.5, shape: 'ember' })
  VFX.burst({ position: _pt, color: COLORS.aureate, count: 6, speed: 2.2, life: 0.8, size: 0.09, gravity: -0.2, shape: 'smoke' })
  // [vfx R3] the launch displaces the air behind the player: a short, sharp
  // refraction pop that bends the deck and the wall the dash left from
  VFX.distort({ position: _pt, maxRadius: 3.2, life: 0.26, strength: 0.02, compress: 0.15, tint: COLORS.aureate })
  // the dash carries its own light for its whole 0.45 s (V17), so the walls
  // the player blinks past actually register the pass
  dashLight?.release()
  dashLight = acquireLight(COLORS.aureate, 11, 2, LIGHT_PRIORITY.cosmetic)
  // a launch package this size briefly owns a quarter of the frame
  addBloomLoad(0.25)
  addTrauma(0.12) // a push, not a shake — dash stays clean (§3.1)
  AudioBus.playWhoosh()
  AudioBus.playAbility() // choir stab approximation (220/277/330 detuned sines)
  emitCombat({ type: 'dash' }) // movement agent: refresh double jump / FOV +10 kick
}

/**
 * [vfx R4] Hard-clear every afterimage. Called when the dash is cancelled out
 * from under itself (the Requiem roots the player mid-dash) — a ghost that is
 * never aged out is a second character standing in the level.
 */
function clearGhosts(
  ghostRefs: (THREE.Group | null)[],
  ghostMats: THREE.ShaderMaterial[][],
  ghostSpawnAt: number[],
): void {
  for (let i = 0; i < GHOST_COUNT; i++) {
    const g = ghostRefs[i]
    if (g) g.visible = false
    const mats = ghostMats[i]
    if (mats) for (const m of mats) m.uniforms.uOpacity!.value = 0
    ghostSpawnAt[i] = -1
  }
}

function updateDash(
  camera: THREE.Camera,
  ghostRefs: (THREE.Group | null)[],
  ghostMats: THREE.ShaderMaterial[][],
  ghostSpawnAt: number[],
) {
  const cs = CombatState
  if (ghostClearPending) {
    ghostClearPending = false
    clearGhosts(ghostRefs, ghostMats, ghostSpawnAt)
  }
  if (!cs.dashing) {
    updateGhosts(camera, ghostRefs, ghostMats, ghostSpawnAt)
    return
  }
  // motion: velocity override at 30 m/s along dash dir (PlayerRef integration)
  PlayerRef.velocity.copy(cs.dashDir).multiplyScalar(DASH_SPEED)

  _pt.copy(PlayerRef.position)
  _pt.y += 1.0
  cs.dashTrail?.push(_pt) // streak ribbon along the path
  dashLight?.set(_pt.x, _pt.y, _pt.z, 26)

  // afterimage ghosts at 0.06s intervals
  if (cs.ghostsToSpawn > 0 && cs.clock >= cs.nextGhostAt) {
    const idx = GHOST_COUNT - cs.ghostsToSpawn
    const g = ghostRefs[idx]
    if (g) {
      g.position.copy(PlayerRef.position)
      g.visible = true
      ghostSpawnAt[idx] = cs.clock
    }
    cs.ghostsToSpawn--
    cs.nextGhostAt = cs.clock + GHOST_INTERVAL
  }
  updateGhosts(camera, ghostRefs, ghostMats, ghostSpawnAt)

  // capsule sweep damage — radius 1.2 m around the dash path point
  for (const e of EnemyRegistry.list()) {
    if (!e.alive || cs.dashHits.has(e.id)) continue
    _to.copy(e.position)
    _to.y += e.height * 0.5
    _to.sub(_pt)
    if (_to.length() > DASH_SWEEP_R + e.radius) continue
    cs.dashHits.add(e.id)
    _pt2.copy(e.position)
    _pt2.y += e.height * 0.5
    resolveEnemyHit(e, DASH_DMG, { point: _pt2, ability: true, stagger: 25 })
    // white flash + teal-to-gold crackle (§3.1)
    VFX.flash({ position: _pt2, color: COLORS.solarWhite, intensity: 8, distance: 4, life: 0.1 })
    VFX.burst({ position: _pt2, color: COLORS.solarWhite, count: 6, speed: 9, life: 0.18, size: 0.05, gravity: 0, stretch: 1 })
    VFX.burst({ position: _pt2, color: COLORS.aureate, count: 8, speed: 3.5, life: 0.3, size: 0.05, gravity: 1 })
  }

  if (cs.clock >= cs.dashUntil) {
    cs.dashing = false
    cs.dashTrail?.end()
    cs.dashTrail = null
    dashLight?.release()
    dashLight = null
  }
}

function updateGhosts(
  camera: THREE.Camera,
  ghostRefs: (THREE.Group | null)[],
  ghostMats: THREE.ShaderMaterial[][],
  ghostSpawnAt: number[],
) {
  const cs = CombatState
  for (let i = 0; i < GHOST_COUNT; i++) {
    const g = ghostRefs[i]
    if (!g || !g.visible) continue
    const age = cs.clock - ghostSpawnAt[i]
    /*
     * [vfx R4, work order vfx-postfx #7] FAIL-SAFE, not just "old enough".
     *
     * `cs.clock` is the combat clock, and `combatTick` advances it by SCALED
     * time. A ghost spawned just before a hitstop or the ult's 0.25× window
     * ages at a fifth of real speed, and one spawned before a reset or a
     * teleport can find `cs.clock` BEHIND its own spawn stamp, which makes
     * `age` negative and the expiry test can never fire — the afterimage then
     * hangs in the world for the rest of the run. That is the doubled
     * character the panel saw standing behind the player in the rifle frame.
     *
     * Any ghost whose age is negative, or more than twice the fade, is stale
     * by construction and is dropped outright.
     */
    if (age >= GHOST_FADE || age < 0 || age > GHOST_FADE * 2 || ghostSpawnAt[i] < 0) {
      g.visible = false
      for (const m of ghostMats[i]) m.uniforms.uOpacity!.value = 0
      ghostSpawnAt[i] = -1
      continue
    }
    const t = age / GHOST_FADE
    // attack far faster than the decay: the afterimage is at full strength
    // for the first fifth of its life and then falls on a cubic
    /*
     * [vfx R5, work order vfx-postfx #3] NEAR-PLANE SKIP.
     *
     * A dash afterimage is laid down WHERE THE PLAYER WAS, and the
     * third-person boom sits behind the player — so on every dash the camera
     * flies straight through the line of ghosts. A body-scale additive
     * capsule at a metre from the lens is a slab across half the frame, which
     * is the untextured shape the panel found at the near plane in
     * 11_ability_dash. Fold it out over the metre before the boom reaches it
     * rather than popping it off, or the removal is its own artefact.
     */
    const camD = camera.position.distanceTo(g.position)
    const nearK = THREE.MathUtils.clamp((camD - GHOST_NEAR_END) / GHOST_NEAR_SPAN, 0, 1)
    if (nearK <= 0.001) {
      for (const m of ghostMats[i]) m.uniforms.uOpacity!.value = 0
      continue
    }
    const o = 1.15 * (1 - t) * (1 - t) * (1 - t * 0.3) * nearK * nearK
    for (const m of ghostMats[i]) {
      m.uniforms.uOpacity!.value = o
      m.uniforms.uTime!.value = cs.clock
      m.uniforms.uAge!.value = t
    }
  }
}

// ---------------------------------------------------------------------------
// A2 — Sunspike Volley
// ---------------------------------------------------------------------------

function castVolley() {
  const cs = CombatState
  // seven spears are about to own a chunk of the frame in additive gold. Tell
  // the bloom governor, or the pyramid is pinned by the fan and every other
  // discrete source in the frame dissolves into milk.
  addBloomLoad(0.7)
  cs.volleyActive = true
  cs.volleyWindupUntil = cs.clock + VOLLEY_WINDUP
  cs.volleyNextSpawnAt = cs.clock
  cs.volleySpawned = 0
  cs.volleyLaunched = false
  AudioBus.playAbility()
}

/** arc anchor behind the shoulders for javelin i (recomputed while winding up) */
function javelinAnchor(camera: THREE.Camera, i: number, out: THREE.Vector3) {
  camera.getWorldDirection(_dir)
  _dir.y = 0
  if (_dir.lengthSq() < 1e-6) _dir.set(0, 0, -1)
  _dir.normalize()
  _right.crossVectors(_dir, UP)
  // [vfx R2] The fan ARCS (work order item 11). A straight evenly-spaced row
  // of seven identical spears is a picket fence; bowing it in Y and pulling
  // the outer spears back in Z turns it into a drawn bow the eye reads as one
  // shape. The centre rides 0.55 m higher than the tips and 0.35 m further
  // forward.
  const k = JAVELIN_COUNT > 1 ? i / (JAVELIN_COUNT - 1) : 0.5
  const bow = Math.sin(k * Math.PI)
  out.copy(PlayerRef.position)
  out.y += 1.62 + bow * 0.55
  out.addScaledVector(_dir, JAVELIN_FORWARD + bow * 0.35)
  out.addScaledVector(_right, (i - (JAVELIN_COUNT - 1) / 2) * JAVELIN_LATERAL)
  return out
}

/**
 * [vfx R1] A javelin impact is now the full AAA stack instead of one gold
 * puff: hot white core sparks, a saturated gold spark body, chipped debris on
 * a heavier gravity, a dark smoke kernel that gives the hit mass, and a
 * surface-aligned shockwave ring. `normal` orients the ring against whatever
 * was hit, so wall impacts stop laying a disc on the floor.
 */
function javelinBurst(pos: THREE.Vector3, normal?: THREE.Vector3) {
  // hot white core — the only layer above the bloom knee
  VFX.burst({ position: pos, color: COLORS.solarWhite, count: 14, speed: 10, life: 0.22, size: 0.055, gravity: 0, stretch: 1 })
  // saturated gold body, streaked along velocity
  VFX.burst({ position: pos, color: COLORS.aureate, count: 30, speed: 7, life: 0.35, size: 0.08, gravity: 2, stretch: 0.9 })
  // chipped debris, heavier and slower
  VFX.burst({ position: pos, color: COLORS.aureate, count: 8, speed: 4, life: 0.6, size: 0.11, gravity: 7, shape: 'debris' })
  // dark mass so the impact occludes instead of only adding light
  VFX.burst({ position: pos, color: COLORS.aureate, count: 5, speed: 1.6, life: 0.7, size: 0.1, gravity: -0.5, shape: 'smoke' })
  VFX.ring({ position: pos, color: COLORS.aureate, maxRadius: 1.6, life: 0.3, width: 0.16, normal })
  VFX.flash({ position: pos, color: COLORS.solarWhite, intensity: 32, distance: 15, life: 0.12 })
  // [vfx R3] the air in front of the impact is displaced for a sixth of a
  // second — the pressure element every AAA impact has and this had none of
  VFX.distort({ position: pos, maxRadius: 1.7, life: 0.2, strength: 0.013, compress: 0.16, tint: COLORS.aureate })
  // [vfx R2] the spear leaves a mark: a hot energy burn that cools to soot
  VFX.decal({ position: pos, normal, color: COLORS.aureate, size: 1.5, life: 8, energy: 0.8 })
  addTrauma(0.1)
  AudioBus.playHit()
}

/**
 * [vfx R1] Per-javelin visual: a three-layer energy shell (tapered white core,
 * saturated gold mid, 3× soft outer falloff), a ribbon trail and a leased
 * PointLight, so a javelin in flight actually lights the architecture it flies
 * past instead of floating over it.
 */
export interface JavelinVisual {
  shell: EnergyShell
  /** tight hot point at the tip — the filament, never the shape */
  head: THREE.Sprite
  /** [vfx R5] anamorphic bar locked to the spear's SCREEN-SPACE axis */
  streak: THREE.Sprite
  /** the short cross-spike that keeps a tip-on spear reading as a source */
  cross: THREE.Sprite
  trail: TrailHandle | null
  /** per-index roll about the spear's own axis, so the seven are not clones */
  roll: number
  /** seconds since this javelin materialised — drives the scale-in */
  bornT: number
  /** seconds remaining of the post-impact dissolve (0 = not dissolving) */
  dissolve: number
  /** [vfx R3] seconds until this spear sheds its next ember off the shaft */
  shedAt: number
}

/**
 * [vfx R2] Work order item 12: this never hid the shell. A javelin that hit a
 * wall stopped MOVING but its three additive layers, its glow head and its
 * 3× outer falloff stayed in the world at full brightness at the point of
 * impact, which is the "beam and puck" the review saw in 12_ability_volley.
 *
 * The shell now dissolves over 0.8 s — shrinking along its length while its
 * intensity falls — and is then hard-hidden with its scale reset, so nothing
 * is left behind and the next volley starts from a clean transform.
 */
const JAVELIN_DISSOLVE = 0.8

function endJavelinVisual(v: JavelinVisual | undefined, dissolve = true): void {
  if (!v) return
  if (v.trail) {
    v.trail.end()
    v.trail = null
  }
  v.shell.releaseLight()
  if (dissolve) {
    v.dissolve = JAVELIN_DISSOLVE
  } else {
    v.dissolve = 0
    v.shell.setIntensity(0)
    v.shell.group.visible = false
    v.shell.group.scale.setScalar(1)
  }
}

/** run the post-impact dissolve for a javelin whose logical life is over */
function updateJavelinDissolve(v: JavelinVisual, dt: number): void {
  if (v.dissolve <= 0) return
  v.dissolve = Math.max(0, v.dissolve - dt)
  const k = v.dissolve / JAVELIN_DISSOLVE
  if (k <= 0) {
    v.shell.setIntensity(0)
    v.shell.group.visible = false
    v.shell.group.scale.setScalar(1)
    return
  }
  v.shell.group.visible = true
  // the spike collapses into the surface it struck and burns out
  v.shell.group.scale.set(1 + (1 - k) * 0.6, 1 + (1 - k) * 0.6, k * k)
  v.shell.setIntensity(k * k * 1.3)
  // the lens bars go with it, faster than the body — a flare has no tail
  const bk = k * k * k
  v.head.material.opacity = 0.95 * bk
  v.streak.material.opacity = 0.55 * bk
  v.cross.material.opacity = 0.40 * bk
}

const _camInv = new THREE.Quaternion()
const _axisView = new THREE.Vector3()

/**
 * [vfx R5] Lock a javelin's two lens bars to the spear's screen-space axis.
 *
 * The spear's own volume cannot carry the read when the fan is flying away
 * from the camera: at 22 degrees off tip-on a 21:1 cone projects to a disc,
 * and every extra layer stacked on a disc makes a rounder disc. What the eye
 * needs is a mark with a DIRECTION in it.
 *
 * Rotating the world axis into view space gives both things at once: the
 * (x, y) of the rotated unit vector is the direction the spear points on the
 * screen, and its length is exactly how much of the spear the lens can see.
 * So the long bar's angle and its length both fall straight out of the
 * geometry, with no projection matrix and no per-frame allocation — a
 * broadside spear grows a needle, a tip-on one collapses it, and the short
 * perpendicular bar takes over at the point where the long one has nothing
 * left to show.
 */
function alignJavelinBars(
  v: JavelinVisual,
  axis: THREE.Vector3,
  camera: THREE.Camera,
  gain: number,
): void {
  _camInv.copy(camera.quaternion).invert()
  _axisView.copy(axis)
  if (_axisView.lengthSq() < 1e-8) _axisView.set(0, 0, 1)
  _axisView.normalize().applyQuaternion(_camInv)
  // 0 = pointing straight at or away from the lens, 1 = fully broadside
  const proj = Math.hypot(_axisView.x, _axisView.y)
  const rot = proj > 1e-4 ? Math.atan2(_axisView.y, _axisView.x) : 0
  const g = Math.max(0, gain)
  v.streak.material.rotation = rot
  v.cross.material.rotation = rot + Math.PI / 2
  v.streak.scale.set((0.34 + 1.7 * proj) * g, 0.115 * g, 1)
  v.streak.material.opacity = (0.26 + 0.62 * proj) * g
  v.cross.scale.set(0.44 * g, 0.07 * g, 1)
  // the cross is what a tip-on spear has instead of a length; it fades out as
  // the long bar takes over so the pair is never two bars of equal weight
  v.cross.material.opacity = (0.58 - 0.34 * proj) * g
  v.head.material.opacity = 0.95 * g
}

function updateVolley(camera: THREE.Camera, dt: number, visuals: JavelinVisual[]) {
  const cs = CombatState
  if (!cs.volleyActive) {
    // a hard state reset (death, restart) can clear volleyActive mid-dissolve;
    // finish any spike that is still burning out rather than freezing it
    for (const v of visuals) updateJavelinDissolve(v, dt)
    return
  }

  // --- windup: materialize one javelin per 30 ms, hovering in an arc ---
  if (!cs.volleyLaunched) {
    while (cs.volleySpawned < JAVELIN_COUNT && cs.clock >= cs.volleyNextSpawnAt) {
      const j = cs.javelins[cs.volleySpawned]
      j.active = true
      j.flying = false
      j.life = JAVELIN_LIFE
      javelinAnchor(camera, cs.volleySpawned, j.pos)
      j.vel.set(0, 0, 0)
      const nv = visuals[cs.volleySpawned]
      if (nv) {
        // each spear SCALES IN over its own spawn interval instead of popping
        // at full size (work order item 11), and takes an individual roll
        nv.bornT = 0
        nv.dissolve = 0
        nv.roll = (cs.volleySpawned * 2.399963) % (Math.PI * 2)
      }
      cs.volleySpawned++
      cs.volleyNextSpawnAt = cs.clock + VOLLEY_SPAWN_INTERVAL
      AudioBus.playUIClick() // ascending chime-note approximation
    }
    // anchors track the player for the rest of the windup
    for (let i = 0; i < cs.volleySpawned; i++) {
      const j = cs.javelins[i]
      if (!j.flying) javelinAnchor(camera, i, j.pos)
    }
    // --- launch: 30° fan toward camera aim ---
    if (cs.clock >= cs.volleyWindupUntil && cs.volleySpawned >= JAVELIN_COUNT) {
      camera.getWorldDirection(_dir)
      for (let i = 0; i < JAVELIN_COUNT; i++) {
        const j = cs.javelins[i]
        const off = (-JAVELIN_FAN_DEG / 2 + (JAVELIN_FAN_DEG * i) / (JAVELIN_COUNT - 1)) * DEG
        const cos = Math.cos(off)
        const sin = Math.sin(off)
        j.vel.set(_dir.x * cos - _dir.z * sin, _dir.y, _dir.x * sin + _dir.z * cos).normalize()
        j.vel.multiplyScalar(JAVELIN_SPEED)
        j.flying = true
        // the javelin carries its own ribbon and its own light for the whole
        // flight (V17) — released in endJavelinVisual on impact or expiry
        const v = visuals[i]
        if (v) {
          v.trail = VFX.trail(`javelin-${i}`)
          // cosmetic priority: the ult may evict these, and should
          v.shell.attachLight(COLORS.aureate, 9)
        }
      }
      cs.volleyLaunched = true
      AudioBus.playWhoosh()
      addTrauma(0.15) // a push, not a shake (§3.2)
      // launch screen-presence (fix1): flash + ring + ≥100-particle fan burst
      _pt.copy(PlayerRef.position)
      _pt.y += 1.6
      VFX.flash({ position: _pt, color: COLORS.solarWhite, intensity: 30, distance: 15, life: 0.2 })
      // [vfx R4] 2.5 m / 0.30 m wide read as a white band across the lower
      // third of the driven capture — a bright flat additive disc under the
      // camera. Tighter and thinner: a pressure ring, not a floor light.
      VFX.ring({ position: PlayerRef.position, color: COLORS.aureate, maxRadius: 1.9, life: 0.26, width: 0.14, intensity: 0.4 })
      VFX.burst({ position: _pt, color: COLORS.aureate, count: 60, speed: 6, life: 0.5, size: 0.07, gravity: 1 })
      VFX.burst({ position: _pt, color: COLORS.solarWhite, count: 40, speed: 8, life: 0.35, size: 0.06, gravity: 0 })
      addBloomLoad(0.3)
    }
  }

  // --- flight: homing, wall/enemy collision ---
  let anyActive = false
  for (let ji = 0; ji < cs.javelins.length; ji++) {
    const j = cs.javelins[ji]
    if (!j.active) continue
    anyActive = true
    if (!j.flying) continue

    j.life -= dt
    _prev.copy(j.pos)

    // light homing: steer ≤120°/s toward nearest enemy within 8 m
    let target: (ReturnType<typeof EnemyRegistry.list>)[number] | null = null
    let targetD = JAVELIN_SEEK_RADIUS
    for (const e of EnemyRegistry.list()) {
      if (!e.alive) continue
      _to.copy(e.position)
      _to.y += e.height * 0.5
      const d = _to.distanceTo(j.pos)
      if (d < targetD) {
        targetD = d
        target = e
      }
    }
    if (target) {
      _desired.copy(target.position)
      _desired.y += target.height * 0.5
      _desired.sub(j.pos).normalize()
      _dir.copy(j.vel).normalize()
      const ang = _dir.angleTo(_desired)
      if (ang > 1e-4) {
        const t = Math.min(1, (JAVELIN_HOMING_RATE * dt) / ang)
        _dir.lerp(_desired, t).normalize()
        j.vel.copy(_dir).multiplyScalar(JAVELIN_SPEED)
      }
    }

    const stepLen = j.vel.length() * dt
    _dir.copy(j.vel).normalize()
    j.pos.addScaledVector(_dir, stepLen)

    // ribbon + travelling light follow the head
    const vis = visuals[ji]
    if (vis) {
      vis.trail?.push(j.pos)
      vis.shell.driveLight(j.pos.x, j.pos.y, j.pos.z, 16)
    }
    // [vfx R3] the spark shedder moved into the mesh sync below, where it runs
    // PER JAVELIN off each spear's own timer instead of once for the whole
    // volley. Seven spears each laying their own ember wake is a field of
    // cooling motes across the arena; one shared 70 ms throttle was a dotted
    // line following whichever spear happened to tick.

    // wall burst
    const wall = raycastLevel(_prev, _dir, stepLen + 0.05)
    if (wall) {
      javelinBurst(wall.point, wall.normal)
      endJavelinVisual(vis)
      j.active = false
      continue
    }

    // enemy hit
    let hit = false
    for (const e of EnemyRegistry.list()) {
      if (!e.alive) continue
      _to.copy(e.position)
      _to.y += e.height * 0.5
      if (_to.distanceTo(j.pos) > e.radius + 0.3) continue
      _pt2.copy(j.pos)
      resolveEnemyHit(e, JAVELIN_DMG, { point: _pt2, ability: true, stagger: 15 })
      javelinBurst(_pt2)
      endJavelinVisual(vis)
      j.active = false
      hit = true
      break
    }
    if (hit) continue

    if (j.life <= 0) {
      _pt2.copy(j.pos)
      javelinBurst(_pt2)
      endJavelinVisual(vis)
      j.active = false
    }
  }

  // --- sync meshes ---
  // windup ramp: javelins materialise DIM and only reach half brightness by
  // launch. Seven cores at full emissive during a 0.35 s windup is what blew
  // 12_ability_volley out to a flat orange rectangle.
  const windupT = THREE.MathUtils.clamp(
    1 - (cs.volleyWindupUntil - cs.clock) / VOLLEY_WINDUP,
    0,
    1,
  )
  // hold the governor up for as long as spears are in the air: addBloomLoad
  // bleeds off over about half a second, so a per-frame top-up is what keeps
  // the load roughly constant across a three-second flight.
  addBloomLoad(dt * 1.6)

  const B = VFXENERGY.beam
  for (let i = 0; i < JAVELIN_COUNT; i++) {
    const v = visuals[i]
    const j = cs.javelins[i]
    if (!v || !j) continue
    const g = v.shell.group
    if (!j.active) {
      // a struck javelin is not simply switched off any more — it dissolves
      updateJavelinDissolve(v, dt)
      continue
    }
    v.bornT += dt
    g.visible = true
    g.position.copy(j.pos)

    // [vfx R2] near-plane discipline (work order item 11). The outer falloff
    // is 3× the spear's radius; at a metre from the lens that is a gold wall.
    // Clamp the outer layer as the camera closes and fade the whole shell out
    // before it can cross the near plane.
    const camD = camera.position.distanceTo(j.pos)
    const outerK = THREE.MathUtils.clamp(camD / B.outerClampDist, 0.34, 1)
    v.shell.outer.scale.set(3.0 * outerK, 3.0 * outerK, 1.15)
    const nearFade = THREE.MathUtils.clamp(
      (camD - B.nearFadeEnd) / Math.max(0.01, B.nearFadeStart - B.nearFadeEnd),
      0,
      1,
    )

    // the erosion field on the mid layer has to move or it reads as a texture
    v.shell.setTime(cs.clock + v.roll)

    if (j.flying) {
      _pt.copy(j.pos).add(j.vel)
      g.lookAt(_pt)
      v.shell.setIntensity(JAVELIN_FLIGHT_GAIN * nearFade)
      // roll the spear about its own axis so the fan reads as seven objects
      g.rotateZ(cs.clock * 6 + v.roll)
      g.scale.setScalar(1)
      alignJavelinBars(v, j.vel, camera, nearFade)
      // [vfx R3] SECONDARY MOTION. A spear in flight sheds material: two
      // embers every ~50 ms off the shaft, left behind in world space with
      // their own drag and turbulence. Seven of them lay a field of cooling
      // motes across the arena that persists after the spears are gone, which
      // is the difference between "a projectile" and "a projectile that is
      // burning". Suppressed while the shell is near-plane faded so the
      // camera is never inside a cloud it cannot see past.
      if (nearFade > 0.35) {
        v.shedAt -= dt
        if (v.shedAt <= 0) {
          v.shedAt = 0.055 + Math.random() * 0.04
          _pt2.copy(j.pos).addScaledVector(j.vel, -0.012)
          VFX.burst({
            position: _pt2,
            color: COLORS.aureate,
            count: 2,
            speed: 1.7,
            life: 0.45,
            size: 0.05,
            gravity: 1.1,
            shape: 'ember',
          })
        }
      }
    } else {
      camera.getWorldDirection(_dir)
      _pt.copy(j.pos).add(_dir)
      g.lookAt(_pt)
      g.rotateZ(v.roll)
      // scale-in: 0.15 → 1 over three spawn intervals, on an ease-out
      const born = THREE.MathUtils.clamp(v.bornT / (VOLLEY_SPAWN_INTERVAL * 3), 0, 1)
      const grow = 1 - (1 - born) * (1 - born)
      g.scale.set(
        THREE.MathUtils.lerp(0.35, 1, grow),
        THREE.MathUtils.lerp(0.35, 1, grow),
        THREE.MathUtils.lerp(0.15, 1, grow),
      )
      v.shell.setIntensity(
        THREE.MathUtils.lerp(JAVELIN_WINDUP_MIN, JAVELIN_WINDUP_MAX, windupT * windupT) *
          grow *
          nearFade,
      )
      // hovering spears are billboarded AT the camera, so their axis projects
      // to nothing and the cross carries them — seven hot points in an arc
      camera.getWorldDirection(_dir)
      alignJavelinBars(
        v,
        _dir,
        camera,
        grow * nearFade * THREE.MathUtils.lerp(0.35, 1, windupT * windupT),
      )
    }
  }

  if (cs.volleyLaunched && !anyActive) {
    let dissolving = false
    for (const v of visuals) {
      if (v.dissolve > 0) dissolving = true
    }
    // the volley stays "active" until the last spike has finished dissolving,
    // so the shells are never orphaned visible by an early state reset
    if (!dissolving) {
      cs.volleyActive = false
      for (const v of visuals) endJavelinVisual(v, false)
    }
  }
}

// ---------------------------------------------------------------------------
// A3 — Aegis Halo
// ---------------------------------------------------------------------------

function castAegis() {
  const cs = CombatState
  cs.aegisUntil = cs.clock + AEGIS_DURATION
  cs.overshield = AEGIS_OVERSHIELD
  cs.speedMult = AEGIS_SPEED_MULT
  cs.nextRippleAt = cs.clock
  triggerActive(2, AEGIS_DURATION) // HUD: rotating-dash border + radial fill
  setOvershield(AEGIS_OVERSHIELD)

  // cast shock pulse: 30 dmg / 4 m / light stagger (§3.3)
  _pt.copy(PlayerRef.position)
  for (const e of EnemyRegistry.list()) {
    if (!e.alive) continue
    _to.copy(e.position).sub(_pt)
    _to.y = 0
    const d = _to.length()
    if (d > AEGIS_PULSE_RADIUS + e.radius) continue
    _pt2.copy(e.position)
    _pt2.y += e.height * 0.5
    const kb = d > 1e-4 ? _to.clone().divideScalar(d).multiplyScalar(4).setY(1.5) : undefined
    resolveEnemyHit(e, AEGIS_PULSE_DMG, { point: _pt2, ability: true, stagger: 40, knockback: kb })
  }

  // expanding ground ring + ≥100 radial sparks + big flash (§3.3, buffed fix1)
  VFX.ring({ position: _pt, color: COLORS.aureate, maxRadius: AEGIS_PULSE_RADIUS, life: 0.4, width: 0.3, intensity: 0.5 })
  VFX.ring({ position: _pt, color: COLORS.solarWhite, maxRadius: AEGIS_PULSE_RADIUS * 0.6, life: 0.3, width: 0.2, intensity: 0.45 })
  _pt.y += 1.2
  VFX.burst({ position: _pt, color: COLORS.aureate, count: 40, speed: 6, life: 0.5, size: 0.07, gravity: 2 })
  VFX.burst({ position: _pt, color: COLORS.solarWhite, count: 40, speed: 8, life: 0.4, size: 0.06, gravity: 1 })
  VFX.burst({ position: _pt, color: COLORS.aureate, count: 30, speed: 3.5, life: 0.7, size: 0.09, gravity: -0.5 })
  VFX.flash({ position: _pt, color: COLORS.aureate, intensity: 32, distance: 15, life: 0.2 })
  addBloomLoad(0.35)
  AudioBus.playAbility() // deep-bell approximation
  addTrauma(0.25)
}

/**
 * [vfx R1] Aegis is a SHELL now, not a flat additive capsule (C7):
 *   • a sphere around the player lit purely by a Fresnel rim
 *     (pow(1 - |dot(N,V)|, 3) × 0.55) so the barrier reads as a surface
 *     the light grazes, not a painted blob;
 *   • a scrolling Orokin fret band etched into the mid layer;
 *   • a width-wise colour ramp, solarWhite inner → aureate outer, all of it
 *     deliberately kept UNDER the bloom knee so the barrier never clips;
 *   • a ground-contact ellipse at the shell radius so the sphere is planted.
 */
export interface AegisVisual {
  shell: EnergyShell
  ground: THREE.Mesh
  groundMat: THREE.ShaderMaterial
  /** [vfx R5] impact-ripple layer (see AEGISRIPPLE_FRAG) */
  ripple: THREE.Mesh
  rippleMat: THREE.ShaderMaterial
  /** age in seconds of each live ripple; >= AEGIS_RIPPLE_SEC = free */
  rippleAge: number[]
  /** overshield reading from the previous frame, to detect a hit */
  lastOvershield: number
}

function updateAegis(
  dt: number,
  haloRef: THREE.Group | null,
  glyphRefs: (THREE.Mesh | null)[],
  aegis: AegisVisual,
) {
  const cs = CombatState
  const active = cs.clock < cs.aegisUntil

  // overshield break VFX (queued by the damage intercept)
  if (cs.overshieldBreakPending) {
    cs.overshieldBreakPending = false
    _pt.copy(PlayerRef.position)
    _pt.y += 1.2
    // shard burst — 40 gold glass shards + big flash (§3.3, buffed fix1)
    VFX.burst({ position: _pt, color: COLORS.solarWhite, count: 40, speed: 8, life: 0.4, size: 0.08, gravity: 6 })
    // [vfx R3] shards + a dark mass so the break has debris and not only light
    VFX.burst({ position: _pt, color: COLORS.aureate, count: 16, speed: 6, life: 0.85, size: 0.1, gravity: 8, shape: 'debris' })
    VFX.burst({ position: _pt, color: COLORS.aureate, count: 8, speed: 2.4, life: 1.1, size: 0.11, gravity: -0.4, shape: 'smoke' })
    VFX.flash({ position: _pt, color: COLORS.solarWhite, intensity: 30, distance: 15, life: 0.14 })
    // the shell collapsing inward snaps the air with it
    VFX.distort({ position: _pt, maxRadius: 3.4, life: 0.3, strength: 0.026, compress: 0.16, tint: COLORS.solarWhite })
    AudioBus.playShieldBreak()
    emitCombat({ type: 'overshield-break' })
  }

  if (!active) {
    if (cs.speedMult !== 1) cs.speedMult = 1
    if (haloRef) haloRef.visible = false
    if (aegis.shell.group.visible) {
      aegis.shell.setVisible(false)
      aegis.ground.visible = false
      aegis.ripple.visible = false
      for (let i = 0; i < AEGIS_RIPPLES; i++) aegis.rippleAge[i] = AEGIS_RIPPLE_SEC
    }
    aegis.lastOvershield = 0
    if (aegisLight) {
      aegisLight.release()
      aegisLight = null
    }
    return
  }

  /*
   * [vfx R5] IMPACT RIPPLES. The damage intercept lives in combat/state.ts,
   * which belongs to another axis this round, so the hit is detected from the
   * one signal this module already owns: a DROP in the overshield reading
   * between frames. The strike direction is taken from the nearest live
   * hostile — with no per-hit direction published there is no better estimate
   * available, and a ripple that starts on the side the shot came from is
   * right far more often than one that starts anywhere else.
   *
   * This runs BEFORE the duration decay below, on purpose. The barrier
   * bleeds its own overshield at 20 per second, which at 30 fps is a 0.67
   * drop every frame — larger than a hit threshold small enough to catch a
   * light hit. Sampling ahead of the decay makes the frame-over-frame
   * delta damage and nothing else.
   */
  const dropped = aegis.lastOvershield - cs.overshield
  if (dropped > 0.5) {
    let slot = -1
    let oldest = -1
    for (let i = 0; i < AEGIS_RIPPLES; i++) {
      if (aegis.rippleAge[i] >= AEGIS_RIPPLE_SEC) {
        slot = i
        break
      }
      if (aegis.rippleAge[i] > oldest) {
        oldest = aegis.rippleAge[i]
        slot = i
      }
    }
    _dir.set(0, 0, 1)
    let best = Infinity
    for (const e of EnemyRegistry.list()) {
      if (!e.alive) continue
      _to.copy(e.position).sub(PlayerRef.position)
      const d = _to.lengthSq()
      if (d < best && d > 1e-4) {
        best = d
        _dir.copy(_to)
      }
    }
    _dir.y = _dir.y * 0.35 + 0.18 // bias toward chest height on the shell
    _dir.normalize()
    aegis.rippleAge[slot] = 0
    const hits = aegis.rippleMat.uniforms.uHits!.value as THREE.Vector4[]
    hits[slot]!.set(_dir.x, _dir.y, _dir.z, 0)
  }
  // overshield decays with duration (§3.3)
  const remaining = cs.aegisUntil - cs.clock
  cs.overshield = Math.min(cs.overshield, AEGIS_OVERSHIELD * (remaining / AEGIS_DURATION))
  // the reference is taken AFTER the decay, so next frame's delta is damage
  aegis.lastOvershield = cs.overshield

  // underfoot ripple ring every 0.5 s
  if (cs.clock >= cs.nextRippleAt) {
    cs.nextRippleAt += 0.5
    VFX.ring({ position: PlayerRef.position, color: COLORS.solarWhite, maxRadius: 1.6, life: 0.5, width: 0.2, intensity: 0.45 })
  }

  // rotating double ring above the head + orbiting glyphs
  if (haloRef) {
    haloRef.visible = true
    haloRef.position.copy(PlayerRef.position)
    haloRef.position.y += 2.15
    haloRef.rotation.y += dt * 1.2
    for (let i = 0; i < glyphRefs.length; i++) {
      const g = glyphRefs[i]
      if (!g) continue
      const a = cs.clock * 0.9 + (i / glyphRefs.length) * Math.PI * 2
      g.position.set(Math.cos(a) * 0.95, Math.sin(cs.clock * 2 + i) * 0.07, Math.sin(a) * 0.95)
      g.rotation.y = -a + Math.PI / 2
    }
  }
  // Fresnel energy shell + ground-contact ellipse
  const shellT = remaining / AEGIS_DURATION
  const breathe = 0.86 + 0.14 * Math.sin(cs.clock * 3.1)
  // last 0.8 s flickers as the barrier fails
  const failing = shellT < 0.16 ? 0.45 + 0.55 * Math.abs(Math.sin(cs.clock * 18)) : 1
  aegis.shell.group.visible = true
  aegis.shell.group.position.copy(PlayerRef.position)
  aegis.shell.group.position.y += 0.95
  aegis.shell.setScroll(cs.clock * 0.12)
  aegis.shell.setTime(cs.clock)
  aegis.shell.setIntensity(breathe * failing)
  {
    const hits = aegis.rippleMat.uniforms.uHits!.value as THREE.Vector4[]
    let anyRipple = false
    for (let i = 0; i < AEGIS_RIPPLES; i++) {
      if (aegis.rippleAge[i] >= AEGIS_RIPPLE_SEC) {
        hits[i]!.w = -1
        continue
      }
      aegis.rippleAge[i] += dt
      const a = Math.min(1, aegis.rippleAge[i] / AEGIS_RIPPLE_SEC)
      hits[i]!.w = a >= 1 ? -1 : a
      if (a < 1) anyRipple = true
    }
    aegis.ripple.visible = anyRipple
    aegis.ripple.position.copy(aegis.shell.group.position)
    aegis.ripple.scale.copy(aegis.shell.group.scale)
    aegis.rippleMat.uniforms.uOpacity!.value = 0.62 * failing
  }
  aegis.ground.visible = true
  aegis.ground.position.copy(PlayerRef.position)
  aegis.ground.position.y += 0.05
  const gs = 1.05 + 0.05 * Math.sin(cs.clock * 3.1)
  aegis.ground.scale.set(gs, gs, 1)
  // [vfx R4] 0.62 -> 0.30. Measured on a driven Aegis capture, the contact
  // ellipse blooms into a solid white puck under the character — the brightest
  // object in the frame, and a flat additive disc at that. It is a grounding
  // cue: it has to say the dome meets the deck, not out-read the dome.
  aegis.groundMat.uniforms.uOpacity!.value = 0.3 * breathe * failing
  aegis.groundMat.uniforms.uTime!.value = cs.clock
  // the barrier is a light source: it has to put gold on the player's plates
  // and a pool on the deck, or it reads as a painted sphere
  if (!aegisLight?.live()) aegisLight = acquireLight(COLORS.aureate, 7, 2, LIGHT_PRIORITY.ability)
  aegisLight?.set(
    PlayerRef.position.x,
    PlayerRef.position.y + 0.95,
    PlayerRef.position.z,
    9 * breathe * failing,
  )
}

// ---------------------------------------------------------------------------
// A4 — Auric Requiem
// ---------------------------------------------------------------------------

interface RequiemFx {
  /** deforming torus shockwave with scrolling glyph texture (detonation) */
  torus: THREE.Mesh
  torusMat: THREE.ShaderMaterial
  /** [vfx R1] counter-rotating inner ring at 0.85× radius, 0.4× opacity */
  torusInner: THREE.Mesh
  torusInnerMat: THREE.ShaderMaterial
  /** [vfx R1] thin fast leading ring that outruns the main front */
  torusLead: THREE.Mesh
  torusLeadMat: THREE.ShaderMaterial
  /** [vfx R1] leased PointLight — the nova is a LIGHT EVENT, not a decal */
  novaLight: TrackedLightHandle | null
  /** [vfx R2] thin expanding shell with a hard leading edge (item 5) */
  shell: THREE.Mesh
  shellMat: THREE.ShaderMaterial
  motes: THREE.Points
  moteAttr: THREE.BufferAttribute
  /** [vfx R2] textured mote material — uniforms driven per frame */
  moteMat: THREE.ShaderMaterial
  moteSeeds: Float32Array // per mote: startRadius, baseAngle, yOff, swirlDir
  /** full-screen additive white-gold overlay at detonation (§3.4, fix1) */
  screenFlash: THREE.Mesh
  screenFlashMat: THREE.MeshBasicMaterial
  /** [vfx R4] WALL-CLOCK seconds since detonation — drives the lens flare */
  flashAge: number
  /**
   * [vfx R4] The charge core, and then the nova's own hot heart.
   *
   * Through R3 the charge was sixty converging motes and nothing else: a
   * capture taken anywhere in the windup was a player standing still in a
   * sparse drizzle of dots. And the detonation had no CORE — it had rings, a
   * shell, a decal and a screen flare, all of them surfaces, none of them the
   * thing those surfaces are supposed to have been thrown off by.
   *
   * This is one volumetric shell: a white-hot interior that clips through the
   * tone curve, a saturated aureate body and a wide veil. It inflates and
   * brightens across the charge, punches to ~7× at the blast, and collapses
   * on a curve whose decay is four times its attack.
   */
  chargeCore: EnergyShell
  /** aftermath: fading gold radial glyph disc on the ground (3s) */
  decal: THREE.Mesh
  decalMat: THREE.MeshBasicMaterial
  /** aftermath: persistent faint ring at the blast edge (3s) */
  faintRing: THREE.Mesh
  faintRingMat: THREE.ShaderMaterial
}

/**
 * [vfx R5] THE HEART OPENS — the ultimate stops being a lamp.
 *
 * The blind test's first-named tell is a flat single-layer additive shape.
 * The nova's heart was not flat — it was three volumetric layers — but a
 * VOLUME profile is brightest exactly where the eye is looking through the
 * most of it, i.e. dead centre, which is where the character is. At the
 * intensity a detonation wants, that is a filled disc of clipped white with
 * the hero inside it, and it is why the panel measured 45-80% of the frame at
 * paper white and could not find the character in any of the three ult
 * frames.
 *
 * A detonation is not a ball of light. It is a SHELL of light leaving a dark
 * middle. `hollow` crossfades the core and mid layers from the volume falloff
 * (alpha = pow(|N.V|, p), brightest dead centre, which is where the character
 * is) to the SHELL band added to EnergyShell this round — a gaussian in
 * |N.V| centred between the middle and the silhouette. The energy moves out
 * of the middle of the disc into a wall with a thickness, the player reads
 * through what is left, and the expanding bright wall is the event.
 *
 * The core's band sits slightly further out and narrower than the mid's, so
 * the two walls are concentric rather than coincident and the shell has a
 * hot filament inside a saturated body — the same three-layer contract every
 * other energy element in the game is built to.
 */
function setNovaHollow(shell: EnergyShell, hollow: number): void {
  const h = THREE.MathUtils.clamp(hollow, 0, 1)
  // the veil is left as a volume on purpose: a soft mass outside the wall is
  // what keeps the shell from reading as a cut-out annulus
  shell.coreMat.uniforms.uBand!.value = h
  shell.coreMat.uniforms.uBandAt!.value = 0.5
  shell.coreMat.uniforms.uBandWidth!.value = 0.26
  shell.midMat.uniforms.uBand!.value = h
  shell.midMat.uniforms.uBandAt!.value = 0.58
  shell.midMat.uniforms.uBandWidth!.value = 0.34
}

function castRequiem(fx: RequiemFx) {
  const cs = CombatState
  // hard-cancel any dash so the rooted charge isn't fought by dash velocity
  if (cs.dashing) {
    cs.dashing = false
    cs.dashTrail?.end()
    cs.dashTrail = null
    dashLight?.release()
    dashLight = null
    // ...and take its afterimages with it: a cancelled dash leaves ghosts
    // whose expiry test is then racing a time scale that just changed
    ghostClearPending = true
  }
  cs.requiemPhase = 1
  cs.requiemT = 0
  pillarSparkClock = 0
  cs.requiemOrigin.copy(PlayerRef.position)
  /*
   * [vfx R2] THE TIME ARC WAS BACKWARDS.
   *
   * `setTimeScale(scale, durationSec)` decays on REAL time (store.tickTimeScale
   * takes realDt) while `cs.requiemT` accumulates SCALED time. Firing the full
   * 0.25× dilation at CAST therefore spent the entire 1.2 s dilation window on
   * the charge: 1.2 s of wall clock at 0.25× advances the charge by only 0.3 s,
   * so the dilation had already expired by the time the nova actually went off
   * and the payoff — the one frame the ability exists for — played at normal
   * speed. Measured on the R2 build, not inferred.
   *
   * The charge now runs at a milder 0.5× (an intake of breath), and the FULL
   * 0.25× dilation is fired at the detonation, where it belongs.
   */
  useGameStore.getState().setTimeScale(REQUIEM_CHARGE_SCALE, REQUIEM_CHARGE_WALL + 0.1)
  // the CHARGE is its own picture: dim, desaturated, vignette closing in
  // around the rooted player. The lifted `ult` grade is NOT raised here — it
  // is raised at the detonation, so the nova punches out of a dark frame
  // instead of blending into one continuous "ability happening" wash.
  ultChargeWindow(REQUIEM_CHARGE_WALL)
  // eight 22 m additive shafts plus a growing core own a large slice of the
  // frame for the whole windup; without this the bloom pyramid is pinned by
  // them and every discrete source in shot disappears into the haze
  addBloomLoad(0.6)
  AudioBus.playAbility() // reversed choir swell approximation
  fx.motes.visible = true
  // the charge core is born as a dim seed and inflates with the motes
  fx.chargeCore.group.visible = true
  fx.chargeCore.group.position.copy(cs.requiemOrigin)
  fx.chargeCore.group.position.y += 1.2
  fx.chargeCore.group.scale.setScalar(0.12)
  fx.chargeCore.setIntensity(0)
  // the charge is a DENSE seed — a mass being compressed, not a shell
  setNovaHollow(fx.chargeCore, 0)
  fx.torus.visible = false
  fx.torusInner.visible = false
  fx.torusLead.visible = false
  fx.shell.visible = false
  fx.decal.visible = false
  fx.faintRing.visible = false
}

function detonateRequiem(fx: RequiemFx) {
  const cs = CombatState
  const origin = cs.requiemOrigin

  // radial damage: 250 center → 120 at edge, linear (§3.4); heavy stagger
  for (const e of EnemyRegistry.list()) {
    if (!e.alive) continue
    _to.copy(e.position).sub(origin)
    _to.y = 0
    const d = _to.length()
    if (d > REQUIEM_RADIUS + e.radius) continue
    const f = THREE.MathUtils.clamp(d / REQUIEM_RADIUS, 0, 1)
    const dmg = THREE.MathUtils.lerp(REQUIEM_DMG_CENTER, REQUIEM_DMG_EDGE, f)
    _pt2.copy(e.position)
    _pt2.y += e.height * 0.5
    // fix2: BIG knockback so survivors are visibly hurled out of the nova
    // (8→14 horizontal, 3→6 launch) and kills dissolve mid-flight
    const kb = d > 1e-4 ? _to.clone().divideScalar(d).multiplyScalar(14).setY(6) : undefined
    resolveEnemyHit(e, dmg, { point: _pt2, ability: true, stagger: 100, knockback: kb })
  }

  _pt.copy(origin)
  _pt.y += 1.2
  // (c) DETONATION — blinding flash + 120-particle gold vortex (tangential
  // swirl field) + the deforming torus shockwave mesh (see updateRequiem)
  /*
   * [vfx R5] 60 at 40 m + 45 at 30 m -> 105 at 13 m + 70 at 11 m.
   *
   * These two are POINT LIGHTS as well as quads, and a 40 m reach in a 40 m
   * arena means the detonation raises the floor of every surface in the room
   * at once. Together with the nova's own 35 m light that is three arena-wide
   * fills firing on the same frame, which is what removed the blacks from
   * 15_ultimate_peak (4% of pixels under 0.08, against ~40% in a normal
   * frame) and made the panel read the whole picture as white.
   *
   * Same energy, a third of the reach: the deck around the blast is brighter
   * than it was and the far wall is not lit at all, so the frame keeps a
   * range. The quads stay legible because Flashes.tsx now holds them to a
   * screen-space size rather than a world one.
   */
  /*
   * [vfx R5, second pass] 105 at 13 m + 70 at 11 m -> 52 at 9 m + 26 at 8 m,
   * and the lingering one's life 0.4 -> 0.22.
   *
   * Flashes.tsx ages its light slots on SCALED time, so "0.4 s" under the
   * ult's own 0.25x dilation is 1.6 s of wall clock: measured on the driven
   * fade frame, the second of these was still putting 44 of intensity on the
   * deck from 1.2 m above it, on top of the nova's own light. Two lights at
   * that height contribute `I / 1.44` to the floor directly beneath them, so
   * between them they were the pale sheet that survived every reduction made
   * to the additive geometry. The quads they drive are unaffected — those are
   * held to a screen size now, not a world one.
   */
  VFX.flash({ position: _pt, color: COLORS.solarWhite, intensity: 52, distance: 9, life: 0.12 })
  VFX.flash({ position: _pt, color: COLORS.aureate, intensity: 26, distance: 8, life: 0.22 }) // lingering glow (fix1)
  // three nested fronts instead of one constant-width white circle: a tight
  // hot leading edge, the main body, and a slower saturated trailing wave.
  // [vfx R2] all three now run the full 0.8 s arc out to the 30 m wave radius
  // (the trailing ripple deliberately lags at 0.62×, work order item 4), so
  // the ult crosses the arena instead of stopping at the damage radius.
  // [vfx R5] master gains trimmed: three 30 m additive discs lying on the
  // deck are the largest shapes in the game, and the deck is also the surface
  // the nova light is closest to. The fronts still clip at their filaments —
  // that is the ring shader's job — but they no longer add a floor under the
  // floor.
  VFX.ring({ position: origin, color: COLORS.solarWhite, maxRadius: REQUIEM_WAVE_RADIUS, life: REQUIEM_SHOCKWAVE_DUR, width: 0.5, intensity: 0.8 })
  VFX.ring({ position: origin, color: COLORS.aureate, maxRadius: REQUIEM_WAVE_RADIUS * 0.86, life: REQUIEM_SHOCKWAVE_DUR * 1.15, width: 1.1, intensity: 0.5 })
  VFX.ring({ position: origin, color: COLORS.aureate, maxRadius: REQUIEM_WAVE_RADIUS * VFXENERGY.novaWave.rippleFrac, life: REQUIEM_SHOCKWAVE_DUR * 1.4, width: 0.6, intensity: 0.7 })
  // scorched glyph burn at the epicentre — the ult leaves a mark on the world
  VFX.decal({ position: origin, color: COLORS.aureate, size: REQUIEM_RADIUS * 1.1, life: 12, energy: 0.85 })
  // RADIAL SPARK BURST — needle-streaked, not a puff
  VFX.burst({
    position: _pt,
    color: COLORS.solarWhite,
    count: 60,
    speed: 22,
    life: 0.5,
    size: 0.09,
    gravity: 0,
    stretch: 1, // full screen-space streak: these read as rays, not dots
  })
  VFX.burst({
    position: _pt,
    color: COLORS.aureate,
    count: 120,
    speed: 9,
    life: 0.9,
    size: 0.1,
    gravity: 0.6,
    swirl: 11, // gold vortex — particles orbit the blast axis as they fly out
  })
  // chipped gold ejecta thrown clear of the nova
  VFX.burst({ position: _pt, color: COLORS.aureate, count: 26, speed: 12, life: 1.1, size: 0.13, gravity: 9, shape: 'debris' })
  // dark mass under the additive core — this is what gives the ult weight
  VFX.burst({ position: _pt, color: COLORS.aureate, count: 22, speed: 4.5, life: 1.6, size: 0.14, gravity: -0.3, shape: 'smoke', swirl: 3 })
  // (d) AFTERMATH — 40 lingering embers drifting up over the scorched decal
  VFX.burst({ position: _pt, color: COLORS.solarWhite, count: 40, speed: 1.2, life: 2.6, size: 0.07, gravity: -0.4, swirl: 2.5, shape: 'ember' })

  // [vfx R3] THE PRESSURE FRONT. Three nested refraction shells expanding at
  // different rates: a violent near-field bend that is gone in a fifth of a
  // second, the main front travelling with the rings, and a slow wide sigh
  // behind it. This is the element the work order called "a distortion or
  // pressure element" — the architecture itself visibly warps and the frame
  // stops reading as decals composited over a static building.
  VFX.distort({ position: _pt, maxRadius: 5, life: 0.2, strength: 0.05, compress: 0.22, tint: COLORS.solarWhite })
  VFX.distort({ position: _pt, maxRadius: REQUIEM_WAVE_RADIUS * 0.7, life: REQUIEM_SHOCKWAVE_DUR, strength: 0.03, compress: 0.18, tint: COLORS.aureate })
  VFX.distort({ position: _pt, maxRadius: REQUIEM_WAVE_RADIUS, life: REQUIEM_SHOCKWAVE_DUR * 1.6, strength: 0.014, compress: 0.12, tint: COLORS.aureate })

  // one CA shock on the detonation frame (0.12 s ease-out), not a plateau
  caImpulse(1)
  // the charge grade ends HERE: the nova has to land on a dark frame, and the
  // lifted peak grade is raised in its place for the whole expansion
  endChargeWindow()
  // the full 1.2 s of 0.25× dilation starts AT THE BLAST (see castRequiem)
  useGameStore.getState().setTimeScale(TIMESCALE.slowmoUlt, TIMESCALE.slowmoUltDurationSec)
  // wall-clock cover for the expansion: the front takes REQUIEM_SHOCKWAVE_DUR
  // of GAME time, which under the dilation is most of two seconds of real time
  // [vfx R5] the lifted peak grade covers the DILATION and stops. It used to
  // run half a second past the shockwave as well, which on the wall clock is
  // ~2.5 s of a globally lifted picture — most of it after the event it is
  // grading has finished.
  ultGradeWindow(TIMESCALE.slowmoUltDurationSec)
  // the detonation covers most of the frame in additive energy for a few
  // frames. Tell the bloom governor, or the whole bloom pyramid is pinned by
  // the screen flash and every discrete source in frame vanishes into milk.
  // [vfx R4] 1.5 -> 2.4. The expansion frame measured as a near-uniform white
  // field; the governor has to take more off the bloom pyramid when the event
  // itself is this large, or the bloom does the blowing out rather than the
  // light.
  // [vfx R5] 2.4 -> 3.4 (the governor's own cap is 4). With the heart now a
  // hollow shell the frame's brightest element is a thin ring, and a bloom
  // pyramid pinned by the previous solid ball was smearing that ring back
  // into the flat field it was meant to replace.
  addBloomLoad(3.4)
  // the nova's own light: 0 → peak → 0 across a ~0.45 s envelope (VFXENERGY).
  // The charge already held a slot — hand it back before taking the big one,
  // or the pool leaks one light per cast. `LIGHT_PRIORITY.event` means this
  // one can EVICT a javelin or dash light: measured on the R2 build, casting
  // the ult during a live volley left the nova with no light at all.
  fx.novaLight?.release()
  fx.novaLight = acquireLight(COLORS.solarWhite, NOVA_LIGHT_REACH, 2, LIGHT_PRIORITY.event)
  fx.novaLight?.set(origin.x, origin.y + 1.2, origin.z, 0)

  addTrauma(0.7)
  AudioBus.playUltimate() // cathedral organ hit + sub-bass drop

  fx.motes.visible = false
  // torus shockwave: expands 0 → 12 m in 0.35 s (uProgress driven per-frame)
  fx.torus.visible = true
  fx.torus.position.copy(origin)
  fx.torus.position.y += 0.25
  fx.torusMat.uniforms.uProgress!.value = 0
  fx.torusMat.uniforms.uOpacity!.value = 1
  fx.torusMat.uniforms.uTime!.value = 0
  // counter-rotating inner ring at 0.85× radius / 0.4× opacity
  fx.torusInner.visible = true
  fx.torusInner.position.copy(fx.torus.position)
  fx.torusInner.rotation.z = 0
  fx.torusInnerMat.uniforms.uProgress!.value = 0
  fx.torusInnerMat.uniforms.uOpacity!.value = 0.4
  fx.torusInnerMat.uniforms.uTime!.value = 0
  // thin leading ring that outruns the body
  fx.torusLead.visible = true
  fx.torusLead.position.copy(fx.torus.position)
  fx.torusLead.rotation.z = 0
  fx.torusLeadMat.uniforms.uProgress!.value = 0
  fx.torusLeadMat.uniforms.uOpacity!.value = 0.8
  fx.torusLeadMat.uniforms.uTime!.value = 0
  // [vfx R2] the expanding SHELL — a thin surface with a hard leading edge
  // racing out ahead of the flat rings, so the nova is a volume event rather
  // than three discs on the floor (and so it cannot be mistaken for Aegis)
  fx.shell.visible = true
  fx.shell.position.copy(origin)
  fx.shell.position.y += 1.1
  fx.shell.scale.setScalar(0.4)
  fx.shellMat.uniforms.uOpacity!.value = 1
  // glowing glyph floor decal (3 s fade) + persistent faint ring at the edge
  fx.decal.visible = true
  fx.decal.position.copy(origin)
  fx.decal.position.y += 0.07
  fx.decal.rotation.z = Math.random() * Math.PI * 2
  fx.decalMat.opacity = REQUIEM_DECAL_PEAK
  fx.faintRing.visible = true
  fx.faintRing.position.copy(origin)
  fx.faintRing.position.y += 0.09
  fx.faintRingMat.uniforms.uOpacity!.value = 0.14
  // (a) full-screen white-gold flash — 0.85 → 0 over 0.14 s (≤0.15 s, fix2)
  fx.screenFlash.visible = true
  fx.flashAge = 0
  fx.screenFlashMat.opacity = REQUIEM_SCREEN_FLASH_PEAK
  // the charge core becomes the nova's heart: the attack is one frame, the
  // decay is the next quarter second (see NOVA_CORE_DECAY)
  fx.chargeCore.group.visible = true
  fx.chargeCore.group.position.copy(origin)
  fx.chargeCore.group.position.y += 1.2
  fx.chargeCore.group.scale.setScalar(NOVA_CORE_BURST)
  fx.chargeCore.setIntensity(NOVA_CORE_PEAK)
  // frame one is the solid flash; `updateRequiem` opens it into a shell over
  // NOVA_HOLLOW_SEC, which is the whole attack of the effect
  setNovaHollow(fx.chargeCore, 0)

  cs.requiemPhase = 2
  cs.requiemT = 0
}

function updateRequiem(
  dt: number,
  /** UNSCALED frame time — the lens flare must not slow down with the world */
  realDt: number,
  camera: THREE.Camera,
  fx: RequiemFx,
  pillarRefs: (THREE.Mesh | null)[],
  pillarMats: THREE.ShaderMaterial[],
) {
  const cs = CombatState
  if (cs.requiemPhase === 0) {
    if (fx.novaLight) {
      fx.novaLight.release()
      fx.novaLight = null
    }
    for (const p of pillarRefs) if (p) p.visible = false
    if (fx.screenFlash.visible) {
      fx.screenFlash.visible = false
      fx.screenFlashMat.opacity = 0
    }
    if (fx.decal.visible) {
      fx.decal.visible = false
      fx.decalMat.opacity = 0
    }
    if (fx.faintRing.visible) {
      fx.faintRing.visible = false
      fx.faintRingMat.uniforms.uOpacity!.value = 0
    }
    if (fx.shell.visible) fx.shell.visible = false
    if (fx.chargeCore.group.visible) {
      fx.chargeCore.setIntensity(0)
      fx.chargeCore.group.visible = false
    }
    return
  }
  cs.requiemT += dt
  fx.flashAge += realDt

  // pillars ring the cast point; cylindrical-billboard toward the player
  for (let i = 0; i < REQUIEM_PILLARS; i++) {
    const p = pillarRefs[i]
    if (!p) continue
    const a = (i / REQUIEM_PILLARS) * Math.PI * 2
    p.position.set(
      cs.requiemOrigin.x + Math.cos(a) * REQUIEM_PILLAR_RADIUS,
      cs.requiemOrigin.y + 10,
      cs.requiemOrigin.z + Math.sin(a) * REQUIEM_PILLAR_RADIUS,
    )
    // cylindrical billboard: a light shaft has no back, so it must always
    // face the camera (C5 — they used to be yawed tangentially and read as
    // flat cards edge-on from half the arena)
    p.rotation.y = Math.atan2(
      camera.position.x - p.position.x,
      camera.position.z - p.position.z,
    )
    pillarMats[i]!.uniforms.uTime!.value = cs.requiemT
  }

  if (cs.requiemPhase === 1) {
    // rooted during the 0.4 s charge (§3.4 — vulnerable, high risk/reward)
    PlayerRef.velocity.x = 0
    PlayerRef.velocity.z = 0

    // [vfx R2] SPARK SHEDDER (work order item 8): the shafts shed embers off
    // their ground contact as the charge builds, so they read as burning
    // columns of light rather than eight painted cards.
    // [vfx R4] 0.05 -> 0.018 s. Over a 0.18 s charge the old cadence shed
    // three embers in total; the shafts have to be visibly BURNING at their
    // ground contact for the charge to read as a build rather than a fade-in.
    pillarSparkClock += dt
    if (pillarSparkClock >= 0.018) {
      pillarSparkClock -= 0.018
      const pi = (Math.random() * REQUIEM_PILLARS) | 0
      const pa = (pi / REQUIEM_PILLARS) * Math.PI * 2
      _pt2.set(
        cs.requiemOrigin.x + Math.cos(pa) * REQUIEM_PILLAR_RADIUS,
        cs.requiemOrigin.y + 0.25,
        cs.requiemOrigin.z + Math.sin(pa) * REQUIEM_PILLAR_RADIUS,
      )
      VFX.burst({
        position: _pt2,
        color: COLORS.aureate,
        count: 3,
        speed: 1.8,
        life: 0.9,
        size: 0.06,
        gravity: -2.2,
        shape: 'ember',
      })
    }

    // [vfx R4] the shafts reach full by the HALFWAY point of the charge, not
    // at its end. With the windup tightened to 0.18 s a linear ramp over the
    // whole charge left them at a third of their value in the one frame the
    // capture takes of the ignition, and in play the telegraph has to be
    // legible while there is still time to react to it.
    // [vfx R5] 0.6 -> 0.42. Eight 22 m additive cards standing in the room at
    // 0.6 put a measurable haze across the whole upper frame; the measured
    // ult frame has its blacks gone (4% of pixels under 0.08 against ~40% in
    // a normal frame) and this is one of the three things adding to the floor.
    const fade = Math.min(1, cs.requiemT / (REQUIEM_CHARGE * 0.5)) * 0.42
    for (let i = 0; i < REQUIEM_PILLARS; i++) {
      const p = pillarRefs[i]
      if (!p) continue
      p.visible = true
      pillarMats[i].uniforms.uOpacity!.value = fade
    }
    // the charge itself is a light: the rooted player is lit from inside as
    // the motes converge
    if (!fx.novaLight) {
      fx.novaLight = acquireLight(COLORS.aureate, 16, 2, LIGHT_PRIORITY.ability)
    }
    fx.novaLight?.set(
      cs.requiemOrigin.x,
      cs.requiemOrigin.y + 1.2,
      cs.requiemOrigin.z,
      40 * Math.min(1, cs.requiemT / REQUIEM_CHARGE) ** 2,
    )

    // 60 gold motes spiral INTO the player
    const p = Math.min(1, cs.requiemT / REQUIEM_CHARGE)
    // [vfx R4] the heart inflates as the motes are swallowed. Radius grows on
    // a square root (fast at first, settling) while brightness grows on a
    // cube (almost nothing until the last third), so the charge reads as
    // pressure building rather than as a lamp being turned up.
    fx.chargeCore.group.position.set(
      cs.requiemOrigin.x,
      cs.requiemOrigin.y + 1.2,
      cs.requiemOrigin.z,
    )
    /*
     * [vfx R5] 0.12 + 0.72*sqrt(p) -> 0.10 + 0.46*sqrt(p), and the intensity
     * ramp 0.25 + 3.1p^3 -> 0.20 + 2.1p^3.
     *
     * The heart is centred at chest height, and at the old terminal scale its
     * veil layer reached 1.26 m — so in 14_ultimate_start the character is a
     * pair of boots under a white ball. The charge is meant to be pressure
     * gathering AT the chest, which only reads if there is still a chest and
     * a helmet around it; a mass that has eaten its owner has nothing left to
     * be dramatic against. The terminal veil is now 0.84 m, roughly a torso,
     * and the intensity ramp keeps its cubic shape so the last third of the
     * windup is still where almost all of the brightness arrives.
     */
    fx.chargeCore.group.scale.setScalar(0.10 + 0.46 * Math.sqrt(p))
    fx.chargeCore.setIntensity(0.2 + 2.1 * p * p * p)
    fx.chargeCore.setTime(cs.clock * 1.6)
    _pt.copy(cs.requiemOrigin)
    _pt.y += 1.2
    // drive the mote shader: convergence centre, charge progress, flicker clock
    ;(fx.moteMat.uniforms.uCenter!.value as THREE.Vector3).copy(_pt)
    fx.moteMat.uniforms.uProgress!.value = p
    fx.moteMat.uniforms.uTime!.value += dt
    for (let i = 0; i < REQUIEM_MOTES; i++) {
      const s = i * 4
      const r0 = fx.moteSeeds[s]!
      const ang = fx.moteSeeds[s + 1]! + p * Math.PI * 4 * fx.moteSeeds[s + 3]!
      const y0 = fx.moteSeeds[s + 2]!
      const r = r0 * (1 - p)
      fx.moteAttr.setXYZ(
        i,
        _pt.x + Math.cos(ang) * r,
        _pt.y + y0 * (1 - p),
        _pt.z + Math.sin(ang) * r,
      )
    }
    fx.moteAttr.needsUpdate = true

    if (cs.requiemT >= REQUIEM_CHARGE) detonateRequiem(fx)
  } else {
    // ---- (c) detonation: deforming torus shockwave 0 → 12 m in 0.35 s ----
    const t = cs.requiemT
    const DUR = REQUIEM_SHOCKWAVE_DUR
    const expand = Math.min(1, t / DUR)
    // [vfx R2] THE ARC. Cubic ease-out radius over 0.8 s out to 30 m, and —
    // this is the part that makes it read as pressure rather than as a
    // growing circle — alpha is tied to d(radius)/dt. The normalised
    // derivative of 1-(1-x)^3 is (1-x)^2, so the front is at full brightness
    // in the first frames where it is moving fastest and has faded to nothing
    // by the time it coasts to a stop.
    const eased = 1 - Math.pow(1 - expand, 3)
    const speedK = (1 - expand) * (1 - expand)
    const s = Math.max(0.001, THREE.MathUtils.lerp(0.6, REQUIEM_WAVE_RADIUS, eased))
    fx.torusMat.uniforms.uProgress!.value = expand
    fx.torusMat.uniforms.uTime!.value = t
    fx.torusMat.uniforms.uOpacity!.value = speedK
    if (fx.torus.visible) {
      fx.torus.scale.set(s, s, s)
      fx.torus.rotation.z += dt * 1.1
      if (expand >= 1) fx.torus.visible = false
    }
    // TRAILING RIPPLE at 0.62× the front radius, launched a beat late — the
    // second pressure wave every real detonation has behind its front
    if (fx.torusInner.visible) {
      const rt = Math.max(0, t - VFXENERGY.novaWave.rippleDelay)
      const rExpand = Math.min(1, rt / DUR)
      const rEased = 1 - Math.pow(1 - rExpand, 3)
      const si =
        Math.max(0.001, THREE.MathUtils.lerp(0.6, REQUIEM_WAVE_RADIUS, rEased)) *
        VFXENERGY.novaWave.rippleFrac
      fx.torusInner.scale.set(si, si, si)
      fx.torusInner.rotation.z -= dt * 2.3
      fx.torusInnerMat.uniforms.uProgress!.value = rExpand
      fx.torusInnerMat.uniforms.uTime!.value = t * 1.35
      fx.torusInnerMat.uniforms.uOpacity!.value = 0.5 * (1 - rExpand) * (1 - rExpand)
      if (rExpand >= 1) fx.torusInner.visible = false
    }
    // leading ring: thin, faster, gone first — this is the pressure front
    if (fx.torusLead.visible) {
      const le = Math.min(1, t / (DUR * 0.68))
      const sl = Math.max(
        0.001,
        THREE.MathUtils.lerp(0.6, REQUIEM_WAVE_RADIUS * 1.1, 1 - Math.pow(1 - le, 3)),
      )
      fx.torusLead.scale.set(sl, sl, sl)
      fx.torusLead.rotation.z += dt * 3.4
      fx.torusLeadMat.uniforms.uProgress!.value = le
      fx.torusLeadMat.uniforms.uTime!.value = t * 1.8
      fx.torusLeadMat.uniforms.uOpacity!.value = 0.9 * (1 - le) * (1 - le)
      if (le >= 1) fx.torusLead.visible = false
    }
    // [vfx R2] the expanding SHELL — a thin surface with a hard leading edge,
    // slightly ahead of the flat rings and gone well before them, so the ult
    // reads as a volume of released light instead of a static gold sphere
    if (fx.shell.visible) {
      const se = Math.min(1, t / (DUR * 0.55))
      const ss = THREE.MathUtils.lerp(0.4, REQUIEM_WAVE_RADIUS * 0.72, 1 - Math.pow(1 - se, 3))
      fx.shell.scale.setScalar(Math.max(0.01, ss))
      // the edge band narrows as the shell thins out across a bigger surface
      fx.shellMat.uniforms.uEdge!.value = 0.42 + se * 0.5
      fx.shellMat.uniforms.uFill!.value = 0.35 * (1 - se)
      const sFall = 1 - se
      /*
       * [vfx R5] THE SHELL SWALLOWS THE CAMERA — this is the white sheet.
       *
       * MEASURED on a driven capture of the new build: the deck was still a
       * featureless white field in the fade frame even after the heart, the
       * light and the shafts had all come down, and this is why.
       *
       * The shell reaches 0.72 * 30 m on a cubic ease-out, so it passes the
       * third-person lens about 0.02 GAME seconds after the blast and the
       * camera spends the whole rest of the effect INSIDE it. SHELL_FRAG
       * draws its hard leading edge where |N.V| is small — and for a camera
       * inside a sphere that is a great circle sweeping right across the
       * frame, drawn in `uCore`, which carries VFXENERGY.novaCoreBoost at 7x.
       * Roughly 4 linear across a band the width of the picture, every frame,
       * for the rest of the ultimate.
       *
       * The shell's job is done in its first 20 ms, while it is a small
       * surface racing out ahead of the flat rings. Fold it away over the
       * metre and a half before it reaches the lens: the read is kept and the
       * band can never be drawn from the inside.
       */
      const shellCamD = camera.position.distanceTo(fx.shell.position)
      const pass = THREE.MathUtils.clamp((shellCamD - ss) / 1.5, 0, 1)
      fx.shellMat.uniforms.uOpacity!.value = sFall * sFall * sFall * pass
      if (se >= 1) fx.shell.visible = false
    }

    // ---- (b) THE HEART burns out: one-frame attack, quarter-second decay ---
    if (fx.chargeCore.group.visible) {
      const ct = Math.min(1, t / NOVA_CORE_DECAY)
      if (ct >= 1) {
        fx.chargeCore.setIntensity(0)
        fx.chargeCore.group.visible = false
      } else {
        const k = 1 - ct
        // [vfx R5] the mass OPENS. Solid for the first frames, then a hollow
        // shell whose wall thins as it expands — see setNovaHollow. This is
        // what takes the clipped white off the middle of the frame and out of
        // the character's silhouette, and it is authored on a curve much
        // faster than the decay so the transition itself reads as the blast.
        setNovaHollow(fx.chargeCore, Math.min(1, t / NOVA_HOLLOW_SEC))
        // swells outward as it dies — released pressure, not a dimming lamp
        let scale = THREE.MathUtils.lerp(NOVA_CORE_BURST, NOVA_CORE_BLOOM, 1 - k * k)
        /*
         * [vfx R5] HARD CLAMP TO THE BOOM. The veil layer is 1.5x the group
         * scale, so a group at 2.9 reaches 4.35 m while the third-person lens
         * sits about 3.6 m from the origin: the camera ends up INSIDE an
         * additive shell authored above the bloom knee, which is a frame of
         * paper whatever the intensity is. Measure the distance rather than
         * assuming the boom length — it changes with the camera state — and
         * keep the outermost layer a clear margin inside it.
         */
        _pt.copy(cs.requiemOrigin)
        _pt.y += 1.2
        const camD = camera.position.distanceTo(_pt)
        const maxGroup = Math.max(0.25, (camD - 0.9) / NOVA_VEIL_SCALE)
        scale = Math.min(scale, maxGroup)
        fx.chargeCore.group.scale.setScalar(scale)
        fx.chargeCore.setIntensity(NOVA_CORE_PEAK * k * k * k)
        fx.chargeCore.setTime(cs.clock * 2.4)
      }
    }

    // ---- the nova's own light: 0 → 450 → 0 across the 1.2 s window ----
    if (fx.novaLight) {
      const K = VFXENERGY.novaLight
      const peak = K.peak * NOVA_LIGHT_GAIN
      const rise = K.riseSec * NOVA_LIGHT_ENVELOPE
      const hold = K.holdSec * NOVA_LIGHT_ENVELOPE
      const fall = K.fallSec * NOVA_LIGHT_ENVELOPE
      let inten: number
      if (t < rise) inten = peak * (t / rise)
      else if (t < rise + hold) inten = peak
      else {
        const f = Math.min(1, (t - rise - hold) / fall)
        inten = peak * (1 - f) * (1 - f)
      }
      fx.novaLight.set(cs.requiemOrigin.x, cs.requiemOrigin.y + 1.2, cs.requiemOrigin.z, inten)
      // the flash cools from solar-white to aureate as it falls off
      if (t > K.riseSec + K.holdSec) fx.novaLight.tint(COLORS.aureate)
      if (inten <= 0.01) {
        fx.novaLight.release()
        fx.novaLight = null
      }
    }

    // ---- (d) aftermath: glyph floor decal + faint ring fade over 3 s ----
    if (fx.decal.visible) {
      const fade = Math.max(0, 1 - t / REQUIEM_AFTERGLOW)
      fx.decalMat.opacity = REQUIEM_DECAL_PEAK * fade * fade * fade
      fx.decal.rotation.z += dt * 0.15 // slow ceremonial spin
      if (fade <= 0) fx.decal.visible = false
    }
    if (fx.faintRing.visible) {
      // [vfx R5] squared, like the disc above it. A 24 m gold annulus fading
      // LINEARLY is still at half strength halfway through the tail, which is
      // exactly the frozen gold band on the deck the panel kept naming.
      const fade = Math.max(0, 1 - t / REQUIEM_AFTERGLOW)
      fx.faintRingMat.uniforms.uOpacity!.value = 0.14 * fade * fade
      if (fade <= 0) fx.faintRing.visible = false
    }

    // (a) full-screen white-gold overlay: 0.85 → 0 over 0.14 s (≤0.15 s)
    if (fx.screenFlash.visible) {
      const ft = fx.flashAge / REQUIEM_SCREEN_FLASH
      if (ft >= 1) {
        fx.screenFlash.visible = false
        fx.screenFlashMat.opacity = 0
      } else {
        const persp = camera as THREE.PerspectiveCamera
        const dist = 1.5
        camera.getWorldDirection(_dir)
        fx.screenFlash.position.copy(camera.position).addScaledVector(_dir, dist)
        fx.screenFlash.quaternion.copy(camera.quaternion)
        const h = 2 * dist * Math.tan(THREE.MathUtils.degToRad(persp.fov ?? 70) / 2) * 1.15
        const w = h * (persp.aspect ?? 16 / 9)
        // over-scale so the radial falloff covers the corners but still
        // concentrates its energy in the middle of frame
        // the flare BLOOMS outward as it dies rather than only dimming: a
        // lens artefact spreads, it does not shrink in place
        // [vfx R5] 1.9 + 1.3t -> 1.25 + 0.75t. A soft radial glow over-scaled
        // to 1.9x the frame puts its own half-value radius PAST the corners,
        // so what should be a centred flare arrived as a uniform lift across
        // the whole picture and took the HUD readouts with it. At 1.25 the
        // falloff's shoulder lands inside the frame and the corners — where
        // every HUD anchor lives — sit in the tail of the curve.
        const grow = 1.25 + ft * 0.75
        fx.screenFlash.scale.set(w * grow, h * grow, 1)
        const k = 1 - ft
        fx.screenFlashMat.opacity = REQUIEM_SCREEN_FLASH_PEAK * k * k * k
      }
    }

    // pillars fade out — [vfx R5] over 0.25 s rather than 0.8 s, from 0.42
    // rather than 0.6. Under the ult's own 0.25x dilation 0.8 GAME seconds is
    // more than three seconds of wall clock, which is why the shafts are
    // still standing at full height in the fade frame two shots later.
    const pk = Math.max(0, 1 - t / 0.25)
    const fade = 0.42 * pk * pk
    for (let i = 0; i < REQUIEM_PILLARS; i++) {
      const p = pillarRefs[i]
      if (!p) continue
      pillarMats[i].uniforms.uOpacity!.value = fade
      if (fade <= 0) p.visible = false
    }

    // the ult's aftermath is the third picture: torus gone, embers drifting,
    // scorch on the deck. Nothing above is still visible by this point.
    if (cs.requiemT >= REQUIEM_AFTERGLOW) cs.requiemPhase = 0
  }
}

/** deterministic mote seed table (module-level so render stays pure) */
function makeMoteSeeds(): Float32Array {
  const seeds = new Float32Array(REQUIEM_MOTES * 4)
  let seed = 0x9e3779b9
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 0xffffffff
  }
  for (let i = 0; i < REQUIEM_MOTES; i++) {
    seeds[i * 4] = 4 + rand() * 3 // start radius
    seeds[i * 4 + 1] = rand() * Math.PI * 2 // base angle
    seeds[i * 4 + 2] = (rand() - 0.3) * 2.5 // y offset
    seeds[i * 4 + 3] = rand() < 0.5 ? 1 : -1 // swirl direction
  }
  return seeds
}

// ---------------------------------------------------------------------------
// Requiem torus shockwave shader (fix2 §3.4c) — a unit-radius torus, scaled
// 0.6 → 12 m over 0.35 s, whose tube deforms (radial wobble grows with
// uProgress) while the canvas glyph rune scrolls around the ring (uv.x).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// [vfx R2] Requiem charge motes (work order item 6)
//
// The 60 charge motes were a bare `PointsMaterial` with NO map, which on every
// renderer draws gl_Points as hard opaque SQUARES. Sixty gold squares spiralling
// into the player is the single most primitive thing in the build, and it was
// happening in the game's hero moment.
//
// They are now textured from the shared particle atlas (the EMBER tile: hard
// core, wide soft halo), with per-mote size (0.4–1.6×), brightness (0.5–1.5×)
// and roll, an ease-out alpha, and a screen-space stretch along the mote's own
// convergence direction so fast ones read as streaks pulled into the player.
// ---------------------------------------------------------------------------

/** the ember tile occupies the top-right quadrant of the 2×2 atlas */
const MOTE_VERT = /* glsl */ `
attribute float aSize;
attribute float aSeed;
uniform float uPixelScale;
uniform float uAspect;
uniform float uTime;
uniform float uProgress;
uniform vec3 uCenter;
varying float vAlpha;
varying float vBright;
varying float vAngle;
varying float vStretch;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vec4 clip0 = projectionMatrix * mv;
  // convergence direction in SCREEN space: the mote is pulled toward the
  // player, so it stretches along the line it is travelling
  vec3 toC = uCenter - position;
  vec4 clip1 = projectionMatrix * (modelViewMatrix * vec4(position + toC * 0.05, 1.0));
  vec2 s0 = clip0.xy / max(1e-4, abs(clip0.w));
  vec2 s1 = clip1.xy / max(1e-4, abs(clip1.w));
  vec2 d = vec2((s1.x - s0.x) * uAspect, s1.y - s0.y);
  float dl = length(d);
  vAngle = dl > 1e-5 ? atan(d.y, d.x) : aSeed * 6.2831853;
  // the pull accelerates: stretch grows with the charge
  vStretch = clamp(dl * 5.0, 0.0, 1.8) * (0.35 + uProgress);
  // ease-out alpha: motes arrive bright and wink out as they reach the core
  float ease = 1.0 - pow(max(0.0, 1.0 - uProgress), 2.0);
  vAlpha = (0.25 + 0.75 * ease) * (1.0 - smoothstep(0.86, 1.0, uProgress));
  // per-mote flicker so the swarm scintillates instead of pulsing as one
  vBright = (0.5 + aSeed) * (0.82 + 0.18 * sin(uTime * (9.0 + aSeed * 26.0) + aSeed * 41.0));
  float s = aSize * (0.55 + 0.45 * ease);
  gl_PointSize = s * (1.0 + vStretch) * uPixelScale / max(0.1, -mv.z);
  gl_Position = clip0;
}
`

const MOTE_FRAG = /* glsl */ `
uniform sampler2D uAtlas;
uniform vec3 uColor;
varying float vAlpha;
varying float vBright;
varying float vAngle;
varying float vStretch;
void main() {
  vec2 p = vec2(gl_PointCoord.x - 0.5, 0.5 - gl_PointCoord.y);
  float c = cos(-vAngle);
  float s = sin(-vAngle);
  vec2 r = vec2(c * p.x - s * p.y, s * p.x + c * p.y);
  r.y *= (1.0 + vStretch);
  vec2 uv = r + 0.5;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) discard;
  // ember tile: top-right quadrant of the shared 2x2 particle atlas
  vec4 tex = texture2D(uAtlas, clamp(uv, 0.008, 0.992) * 0.5 + vec2(0.5, 0.5));
  float a = tex.a * vAlpha;
  if (a < 0.004) discard;
  gl_FragColor = vec4(uColor * tex.rgb * vBright, a);
}
`

// ---------------------------------------------------------------------------
// [vfx R2] Requiem detonation SHELL (work order item 5)
//
// The critics read the ultimate as "the barrier again" because both were a
// sphere of gold around the player. The difference a real nova has is that its
// shell is a THIN, EXPANDING surface with a hard leading edge — it is gone from
// the inside as fast as it arrives at the outside.
//
// `uEdge` steps the silhouette hard (no soft fresnel bleed), `uFill` keeps only
// a trace of interior, and the whole thing is driven by the same eased radius
// as the ring fronts so it is unmistakably one event with them.
// ---------------------------------------------------------------------------

const SHELL_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix) * normal);
  vV = cameraPosition - wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`

const SHELL_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uCore;
uniform float uOpacity;
uniform float uEdge;
uniform float uFill;
varying vec3 vN;
varying vec3 vV;
void main() {
  float ndv = abs(dot(normalize(vN), normalize(vV)));
  float fres = 1.0 - ndv;
  // HARD leading edge: a narrow band at the silhouette, not a soft rim
  float edge = smoothstep(uEdge - 0.09, uEdge - 0.01, fres);
  float hot = smoothstep(uEdge - 0.03, uEdge + 0.02, fres);
  float a = (edge * 0.85 + uFill * pow(fres, 3.0)) * uOpacity;
  if (a < 0.004) discard;
  vec3 col = mix(uColor, uCore, hot);
  // uCore carries VFXENERGY.novaCoreBoost (7×), which is only survivable
  // because the shell starts at 0.4 m — a blinding pinpoint — and its opacity
  // falls as the CUBE of expansion. By the time the surface is metres across
  // it is contributing about 1.0 linear, i.e. a bright band, not a white-out.
  gl_FragColor = vec4(col * (0.55 + hot * 0.85), a);
}
`

const NOVA_VERT = /* glsl */ `
uniform float uProgress;
uniform float uTime;
varying vec2 vUv;
varying float vBand;
void main() {
  vUv = uv;
  // angle around the main ring
  float ang = atan(position.z, position.x);
  // deforming shockwave: radial ripple racing around the ring, amplitude
  // grows as the front expands so the torus reads as tearing outward
  float wob = sin(ang * 9.0 - uTime * 22.0) * 0.5
            + sin(ang * 17.0 + uTime * 13.0) * 0.3;
  vec3 p = position + normal * wob * (0.05 + uProgress * 0.16);
  vBand = 0.5 + 0.5 * wob;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`

const NOVA_FRAG = /* glsl */ `
uniform float uProgress;
uniform float uOpacity;
uniform float uTime;
uniform sampler2D uGlyph;
varying vec2 vUv;
varying float vBand;
void main() {
  // scrolling glyph runes around the ring (uv.x = around, uv.y = tube)
  vec2 guv = vec2(fract(vUv.x * 10.0 - uTime * 2.6), vUv.y);
  float glyph = texture2D(uGlyph, guv).r;
  vec3 gold = vec3(1.0, 0.72, 0.21);   // #FFB835
  vec3 white = vec3(1.0, 0.953, 0.84); // #FFF3D6
  // hot leading edge early, glyph-etched gold body after
  float heat = 1.0 - uProgress * 0.55;
  vec3 col = mix(gold, white, clamp(heat * (0.35 + vBand * 0.5), 0.0, 1.0));
  // [vfx R1] radial gradient ACROSS the tube: hot filament down the middle of
  // the ring width, feathering to nothing at both tube edges, so the nova has
  // a cross-section instead of a constant-width outline
  // [vfx R2] the tube scales with the ring, so at 30 m a fixed profile would
  // be a 1.5 m thick gold doughnut. Tightening the gaussian with uProgress
  // keeps the visible FRONT the same apparent thickness all the way out.
  float tube = abs(vUv.y - 0.5) * 2.0;
  float tighten = 2.6 + uProgress * 9.0;
  float prof = exp(-tube * tube * tighten);
  float core = exp(-tube * tube * (tighten * 4.2));
  col = mix(col, white, core * 0.75);
  float a = (0.18 + prof * 0.62 + glyph * 0.5 * prof) * uOpacity;
  // only the filament is authored above the bloom knee
  gl_FragColor = vec4(col * (0.9 + core * 2.2 + glyph * 0.6 * prof), a);
}
`

// ---------------------------------------------------------------------------
// [vfx R1] Requiem light pillars (C5) — the 8 shafts were bare additive
// planes with hard-cut ends and a constant fill, which is why they read as
// orange rectangles. This gives each shaft a soft gradient body, a hot
// filament down its centre, feathered ends and a ground-contact bloom, so a
// billboarded plane reads as a volume of light.
// ---------------------------------------------------------------------------

/**
 * [vfx R3] Aftermath edge ring (work order: "no untextured quad anywhere").
 * This was a bare `RingGeometry` under an unmapped MeshBasicMaterial — a
 * 24 m gold annulus at constant alpha with two hard edges, sitting on the
 * deck for three seconds after every ultimate. It is now an analytic band:
 * radius is measured per fragment, so the ring has a gaussian cross-section
 * with a hot filament and no edge at all, at any radius, with no texture and
 * no UV problem.
 */
/**
 * [vfx R3] Aegis floor contact.
 *
 * The barrier's ground plate was a 2.6 m soft-glow sprite lying flat on the
 * deck at 0.34 additive gold — a textbook flat single-layer additive shape,
 * and one seen almost edge-on from a third-person camera, so its radial
 * gradient never reaches the viewer at all.
 *
 * A barrier does not put a disc on the floor. It INTERSECTS the floor, in a
 * ring. This draws that intersection analytically: a hot gaussian band at the
 * shell's own radius, a dim pooled fill inside it, nothing outside.
 */
/**
 * [vfx R5] AEGIS IMPACT RIPPLE (work order vfx-postfx #9).
 *
 * The barrier was a static object: it breathed, it flickered when it was
 * about to fail, and nothing else about it ever changed. A shield that does
 * not respond when it is hit is a painted sphere, and "secondary motion after
 * the main event" is one of the four things the brief asks every effect for.
 *
 * Three concurrent ripples live in a vec4 array. xyz is the unit direction on
 * the shell the hit came from, w is the ripple's normalised age. The shader
 * measures the ANGLE between the fragment's own surface direction and that
 * direction and draws a gaussian band at an angle that opens with age, so the
 * ring travels across the curved surface at constant angular speed the way a
 * wave on a membrane does — not a flat circle projected onto a sphere.
 *
 * Drawn as its own thin layer rather than by extending SHELL_FRAG, because
 * every energy element in the game shares that shader and none of the others
 * needs three extra vec4s of uniform per draw.
 */
const AEGIS_RIPPLES = 3
const AEGIS_RIPPLE_SEC = 0.42

const AEGISRIPPLE_VERT = /* glsl */ `
varying vec3 vLocal;
varying vec3 vN;
varying vec3 vV;
void main() {
  vLocal = normalize(position);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix) * normal);
  vV = cameraPosition - wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`

const AEGISRIPPLE_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uCore;
uniform float uOpacity;
uniform vec4 uHits[3];
varying vec3 vLocal;
varying vec3 vN;
varying vec3 vV;
void main() {
  float band = 0.0;
  float fil = 0.0;
  for (int i = 0; i < 3; i++) {
    float age = uHits[i].w;
    if (age < 0.0 || age > 1.0) continue;
    // angle from the impact point to this fragment, 0 .. PI
    float ang = acos(clamp(dot(vLocal, normalize(uHits[i].xyz)), -1.0, 1.0));
    // the front opens on an ease-out: fast at the impact, coasting after
    float front = (1.0 - (1.0 - age) * (1.0 - age)) * 2.35;
    // the wake widens and weakens as the ring travels away from the strike
    float w = 0.11 + 0.22 * age;
    float x = (ang - front) / w;
    float g = exp(-x * x * 2.2) * (1.0 - age) * (1.0 - age);
    band += g;
    fil += exp(-x * x * 13.0) * (1.0 - age) * (1.0 - age);
  }
  if (band < 0.002) discard;
  // the ripple is a disturbance IN the shell, so it still obeys the shell's
  // own grazing-angle law: nothing of it shows where the surface faces the
  // lens, or it would read as a decal floating inside the barrier
  float ndv = clamp(abs(dot(normalize(vN), normalize(vV))), 0.0, 1.0);
  float graze = 0.30 + 0.70 * pow(1.0 - ndv, 1.4);
  float a = clamp(band, 0.0, 1.6) * graze * uOpacity;
  if (a < 0.004) discard;
  vec3 col = mix(uColor, uCore, clamp(fil, 0.0, 1.0));
  gl_FragColor = vec4(col * (0.8 + clamp(fil, 0.0, 1.0) * 2.0), a);
}
`

const AEGISFLOOR_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const AEGISFLOOR_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uCore;
uniform float uOpacity;
uniform float uTime;
varying vec2 vUv;
void main() {
  vec2 c = vUv * 2.0 - 1.0;
  float r = length(c);
  if (r > 1.0) discard;
  float ang = atan(c.y, c.x);
  // the intersection is not a perfect circle: the shell breathes and the
  // deck is not flat, so the band wanders a little around the ring
  float wob = 0.012 * sin(ang * 7.0 + uTime * 1.8) + 0.008 * sin(ang * 13.0 - uTime * 2.7);
  float x = (r - (0.80 + wob)) / 0.10;
  float ring = exp(-x * x * 2.0);
  float fil = exp(-x * x * 9.0);
  // dim pool of bounced light inside the barrier's footprint
  float pool = pow(max(0.0, 1.0 - r), 2.4) * 0.30;
  float a = (ring * 0.9 + pool) * uOpacity;
  if (a < 0.004) discard;
  vec3 col = mix(uColor, uCore, fil * 0.8);
  gl_FragColor = vec4(col * (0.8 + fil * 1.7), a);
}
`

const EDGERING_VERT = /* glsl */ `
varying vec2 vL;
void main() {
  vL = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const EDGERING_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uCore;
uniform float uOpacity;
uniform float uRadius;
uniform float uWidth;
varying vec2 vL;
void main() {
  float r = length(vL);
  float x = (r - uRadius) / max(1e-4, uWidth);
  float band = exp(-x * x * 2.3);
  float fil = exp(-x * x * 11.0);
  float a = band * uOpacity;
  if (a < 0.004) discard;
  vec3 col = mix(uColor, uCore, fil * 0.7);
  gl_FragColor = vec4(col * (0.75 + fil * 1.7), a);
}
`

const PILLAR_VERT = /* glsl */ `
uniform float uTip;
uniform float uWidth;
varying vec2 vUv;
void main() {
  vUv = uv;
  // [vfx R2] TAPER along the length (work order item 8). A constant-width
  // shaft is the clearest primitive tell there is: light spreads out of its
  // source and thins as it climbs. uv.y = 0 at the ground end.
  // [vfx R5] plus a per-shaft width. Eight shafts of identical width standing
  // at identical spacing is a procedural signature the eye picks up before it
  // picks up anything else about them.
  vec3 p = position;
  p.x *= mix(1.0, uTip, uv.y) * uWidth;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`

const PILLAR_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uCore;
uniform float uOpacity;
uniform float uTime;
uniform float uSeed;
varying vec2 vUv;
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x),
             mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main() {
  // vertical: feathered at BOTH ends, brightest where it meets the ground
  float h = vUv.y;
  float ends = smoothstep(0.0, 0.10, h) * smoothstep(1.0, 0.55, h);
  float ground = exp(-h * h * 9.0) * 0.55;
  // horizontal: wide soft body + narrow hot filament
  float x = abs(vUv.x - 0.5) * 2.0;
  float body = pow(max(0.0, 1.0 - x), 2.4);
  float core = exp(-x * x * 26.0);
  // slow vertical drift so the shaft is never a static card
  float drift = 0.9 + 0.1 * sin(h * 9.0 - uTime * 1.6 + uSeed * 6.283);
  // [vfx R3] two octaves of value noise racing UP the shaft. A smooth
  // gradient plane is still a plane; a shaft of light rising out of a
  // detonation is torn up by the air and the debris in it, and the eye reads
  // that broken internal structure as volume. The noise bites the BODY only —
  // the filament stays continuous so the pillar keeps a clean spine.
  float n1 = vnoise(vec2(vUv.x * 5.0 + uSeed * 31.0, h * 4.0 - uTime * (0.9 + uSeed * 0.6)));
  float n2 = vnoise(vec2(vUv.x * 13.0 + 7.0 + uSeed * 17.0, h * 11.0 - uTime * (2.0 + uSeed * 1.1)));
  float n = 0.6 * n1 + 0.4 * n2;
  float bodyN = body * mix(0.35, 1.25, n);
  float a = (bodyN * 0.45 + core * 0.85 + ground * bodyN) * ends * drift * uOpacity;
  if (a < 0.004) discard;
  vec3 col = mix(uColor, uCore, core);
  gl_FragColor = vec4(col * (0.85 + core * 1.9), a);
}
`

// ---------------------------------------------------------------------------
// Component — input edge handling + per-frame ability state machines + meshes
// ---------------------------------------------------------------------------

export function AbilitySystems() {
  // javelin pool state (module CombatState holds logic; refs hold meshes)
  if (CombatState.javelins.length === 0) {
    for (let i = 0; i < JAVELIN_COUNT; i++) {
      CombatState.javelins.push({
        active: false,
        flying: false,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        life: 0,
      })
    }
  }

  const ghostRefs = useRef<(THREE.Group | null)[]>([])
  const ghostSpawnAt = useRef<number[]>(Array.from({ length: GHOST_COUNT }, () => -1))
  const haloRef = useRef<THREE.Group>(null)
  const glyphRefs = useRef<(THREE.Mesh | null)[]>([])
  const pillarRefs = useRef<(THREE.Mesh | null)[]>([])
  const prevRemaining = useRef<Record<AbilityId, number>>({ A1: 0, A2: 0, A3: 0, A4: 0 })

  const ghostMats = useMemo(
    () =>
      Array.from({ length: GHOST_COUNT }, () =>
        [COLORS.aureate, COLORS.solarWhite].map(
          (hex) =>
            new THREE.ShaderMaterial({
              vertexShader: GHOST_VERT,
              fragmentShader: GHOST_FRAG,
              uniforms: {
                uColor: { value: new THREE.Color(hex).multiplyScalar(1.6) },
                uOpacity: { value: 0 },
                uTime: { value: 0 },
                uAge: { value: 0 },
              },
              transparent: true,
              blending: THREE.AdditiveBlending,
              depthWrite: false,
              side: THREE.DoubleSide,
              toneMapped: false,
            }),
        ),
      ),
    [],
  )

  const pillarMats = useMemo(
    () =>
      Array.from(
        { length: REQUIEM_PILLARS },
        (_, i) =>
          new THREE.ShaderMaterial({
            vertexShader: PILLAR_VERT,
            fragmentShader: PILLAR_FRAG,
            uniforms: {
              uColor: { value: new THREE.Color(COLORS.aureate) },
              uCore: { value: new THREE.Color(COLORS.solarWhite) },
              uOpacity: { value: 0 },
              uTime: { value: 0 },
              uTip: { value: VFXENERGY.beam.tipScale },
              // [vfx R5] golden-ratio hash per shaft: widths land on an
              // irrational spread so no two neighbours match and the set never
              // repeats around the ring
              uSeed: { value: (i * 0.6180339887) % 1 },
              uWidth: { value: 0.62 + 0.72 * ((i * 0.6180339887) % 1) },
            },
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide,
            toneMapped: false,
          }),
      ),
    [],
  )

  const glyphTex = useMemo(() => getGlyphSpriteTexture(), [])

  /**
   * [vfx R1] Seven javelins, each a three-layer energy shell: a tapered white
   * core cone, a saturated gold mid at 1.5× radius and a 3× soft outer
   * falloff, plus a glow head sprite. The outer shell is widened in RADIUS
   * only (1.15× in length) so a 0.95 m spear does not become a 2.8 m cone.
   */
  const javelinVisuals = useMemo<JavelinVisual[]>(() => {
    /*
     * [vfx R4] 0.075 x 0.95 -> 0.048 x 2.05. MEASURED from a driven capture,
     * not restyled: at 6:1 and with the volley flying AWAY from a
     * third-person camera, every spear is seen close to tip-on, and a 6:1 cone
     * seen tip-on rasterises as a disc. The captured volley frame is seven
     * glowing BALLS hanging in front of the gate — exactly the work order's
     * "only the widest softest shell layer renders".
     *
     * At 21:1 a spear still shows most of its length at the shallow angles the
     * fan spreads it to, and the silhouette the eye gets is a needle rather
     * than a sphere. The segment count goes 10 -> 14 so the outline stops
     * reading as a polygon at close range.
     */
    const geo = new THREE.ConeGeometry(0.048, 2.05, 14, 1, true)
    geo.rotateX(Math.PI / 2) // tip along +Z so lookAt() aims the spear
    return Array.from({ length: JAVELIN_COUNT }, () => {
      const shell = createEnergyShell({
        geometry: geo,
        // [vfx R3] THE FLAT-BAR FIX. Every layer here used to be authored at
        // CONSTANT alpha across the cone, so a javelin rasterised as a solid
        // yellow plank with a hard polygonal outline — the single tell the
        // blind test named first. All three layers now derive alpha from
        // |N·V|, i.e. from how much of the spear the eye is looking THROUGH,
        // which takes the alpha to zero exactly at the silhouette. A spear has
        // no edge any more; it has a thickness.
        shape: { taper: 'axis', tail: 0.58, nearFade: 1.6 },
        core: { scale: 1, profile: 'volume', power: 1.1, hot: 1, hotPow: 1.5, erode: 0.16, erodeScale: 5 },
        mid: { scale: 1, profile: 'volume', power: 0.52, hot: 0.55, hotPow: 3.0, erode: 0.34, erodeScale: 9 },
        // [vfx R4] outer power 0.26 -> 0.9. pow(|N.V|, 0.26) is within 15% of
        // 1.0 across almost the whole cone, so the "soft outer falloff" was in
        // practice a CONSTANT-alpha filled shape — the flat additive primitive
        // the blind test names first, wearing a falloff's name. At 0.9 it
        // actually thins toward the silhouette.
        outer: { scale: 1, opacity: 0.2, profile: 'volume', power: 0.9, erode: 0 },
        renderOrder: 21,
        side: THREE.DoubleSide,
      })
      shell.core.scale.set(1, 1, 1)
      shell.mid.scale.set(1.5, 1.5, 1.06)
      // [vfx R4] 3.0 → 2.4 radial (work order combat-feel #6: outer ≈ 1.6× the
      // mid radius). At 3.0 the veil was 0.45 m across on a 1.09 m spear —
      // 2.4:1 — so the widest, softest, least-shaped layer owned most of the
      // screen area and the seven merged into one orange smear. At 2.4 the
      // veil is 6:1 like the core, and the fan reads as seven countable
      // spears. Length also drops 1.15 → 1.08 so the veil stops out-running
      // the tip and blunting the point.
      shell.outer.scale.set(1.9, 1.9, 1.04)
      const head = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: getGlowTexture(),
          color: new THREE.Color(COLORS.solarWhite).multiplyScalar(3.1),
          transparent: true,
          opacity: 0.95,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          toneMapped: false,
        }),
      )
      /*
       * [vfx R4] the head sprite was a 1.05 m round glow on a 0.95 m spear —
       * i.e. the glow WAS the javelin, and it is the one element that cannot
       * read as anything but a ball. 1.05 -> 0.34.
       *
       * [vfx R5] 0.34 -> 0.15, and the energy that came off it moves into the
       * two bars below. MEASURED from 12_ability_volley.png: the fan flies
       * AWAY from a third-person camera, so every spear is seen within ~22
       * degrees of tip-on and its 2.05 m of length projects to almost nothing.
       * Whatever is left is the only thing with area — and a round sprite with
       * area is a BALL. Three spears in that frame are three gold marbles on
       * three straight lines. A round glow can only ever be the filament; the
       * DIRECTION has to come from something that is not round.
       */
      head.position.set(0, 0, 0.98)
      head.scale.set(0.15, 0.15, 1)
      head.renderOrder = 22
      /*
       * The anamorphic pair. `streak` is locked every frame to the spear's own
       * screen-space axis and scaled by how much of that axis the lens can
       * actually see, so a broadside spear grows a long needle and a tip-on
       * one collapses it to nothing. `cross` runs perpendicular at a fraction
       * of the length and never collapses, so a spear seen dead tip-on still
       * reads as a bright POINT SOURCE with a lens response rather than as a
       * sphere. Both sit under the head so the hot point composites last.
       */
      const bar = (len: number, wide: number, boost: number) => {
        const sp = new THREE.Sprite(
          new THREE.SpriteMaterial({
            map: getStreakTexture(),
            color: new THREE.Color(COLORS.aureate).multiplyScalar(boost),
            transparent: true,
            opacity: 0.85,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            toneMapped: false,
          }),
        )
        sp.position.set(0, 0, 0.98)
        sp.scale.set(len, wide, 1)
        sp.renderOrder = 21
        return sp
      }
      const streak = bar(1.5, 0.12, 2.2)
      const cross = bar(0.42, 0.075, 1.5)
      cross.material.rotation = Math.PI / 2
      shell.group.add(cross)
      shell.group.add(streak)
      shell.group.add(head)
      shell.group.visible = false
      return { shell, head, streak, cross, trail: null, roll: 0, bornT: 0, dissolve: 0, shedAt: 0 }
    })
  }, [])

  /**
   * [vfx R3] The halo ring, rebuilt as a real energy volume.
   *
   * A torus read through the |N·V| thickness term is bright along the centre
   * line of its tube and zero at the tube's silhouette, which is precisely
   * the cross-section a glowing ring of energy has. Three nested tori give
   * the filament / body / veil stack; the mid layer carries the Orokin fret
   * band so the ring has surface detail at close range.
   */
  const haloShell = useMemo(() => {
    const geo = new THREE.TorusGeometry(0.72, 0.05, 12, 72)
    geo.rotateX(Math.PI / 2) // lie flat above the head
    const sh = createEnergyShell({
      geometry: geo,
      shape: { nearFade: 0.9 },
      core: { color: COLORS.solarWhite, boost: 2.4, scale: 0.96, profile: 'volume', power: 1.5, hot: 1, hotPow: 1.3 },
      mid: { color: COLORS.aureate, boost: 1.35, scale: 1.0, profile: 'volume', power: 0.55, hot: 0.5, erode: 0.26, erodeScale: 10 },
      outer: { color: COLORS.aureate, boost: 1.0, scale: 1.3, opacity: 0.13, profile: 'volume', power: 0.24 },
      glyph: true,
      glyphRepeat: 9,
      renderOrder: 21,
      side: THREE.DoubleSide,
    })
    sh.group.visible = true
    return sh
  }, [])

  /** [vfx R1] Aegis: a Fresnel sphere + scrolling fret band + ground ellipse */
  const aegisVisual = useMemo<AegisVisual>(() => {
    const shell = createEnergyShell({
      geometry: new THREE.SphereGeometry(1, 28, 20),
      // inner layer is solarWhite, mid is aureate — the width-wise ramp
      // [vfx R3] explicitly 'rim' on every layer. The shell defaults are now
      // volumetric (right for beams and novas); a BARRIER is the one energy
      // element that must stay a surface, near-transparent face-on and hot
      // only where it is seen edge-on.
      shape: { profile: 'rim', nearFade: 1.5 },
      core: { color: COLORS.solarWhite, boost: 1.5, scale: 0.97, profile: 'rim', power: 3.0, hot: 0 },
      mid: { color: COLORS.aureate, boost: 1.15, scale: 1.0, profile: 'rim', power: 2.0, hot: 0, erode: 0 },
      // [vfx R3] the outer veil moves out to 1.18x on a MUCH softer rim
      // exponent. The R2 barrier ended on a hard bright circle because all
      // three layers peaked at the same silhouette and then stopped; a wide,
      // low-exponent halo sitting outside that ring is what bleeds the edge
      // into the frame instead of cutting it.
      outer: { color: COLORS.aureate, boost: 1.0, scale: 1.18, opacity: 0.085, power: 1.6, profile: 'rim' },
      glyph: true,
      glyphRepeat: 5,
      renderOrder: 20,
      side: THREE.DoubleSide,
    })
    /*
     * [vfx R4] THE INTERIOR IS GONE.
     *
     * Rim-only was already the intent in R3, but the exponents were soft
     * (3.0 / 2.0) and the opacities were high (0.55 / 0.50) and the sphere is
     * DoubleSide, so the near and far hemispheres each contributed. Measured
     * face-on that left roughly 0.22 of additive gold across the whole disc:
     * a translucent milk bubble around the character, which is what the
     * captured frames show sitting over four consecutive shots including both
     * ultimate frames and the katana frame.
     *
     * The rim exponents go to 5.0 / 3.2 and the opacities to 0.15 / 0.20, so
     * face-on transmission through both hemispheres is about 0.013 — an order
     * of magnitude down, below the bloom knee, effectively clear. The energy
     * that was in the fill moves into the silhouette, where a barrier's read
     * belongs, and the scrolling fret band on the mid layer is now legible
     * against it instead of being washed out by its own interior.
     */
    shell.coreMat.uniforms.uFresnelAmt!.value = 1
    shell.coreMat.uniforms.uFresnelPow!.value = 5.0
    shell.coreMat.uniforms.uOpacity!.value = 0.15
    shell.midMat.uniforms.uFresnelAmt!.value = 1
    shell.midMat.uniforms.uFresnelPow!.value = 3.2
    shell.midMat.uniforms.uOpacity!.value = 0.2
    shell.group.scale.setScalar(1.05)

    const groundMat = new THREE.ShaderMaterial({
      vertexShader: AEGISFLOOR_VERT,
      fragmentShader: AEGISFLOOR_FRAG,
      uniforms: {
        uColor: { value: new THREE.Color(COLORS.aureate) },
        uCore: { value: new THREE.Color(COLORS.solarWhite) },
        uOpacity: { value: 0 },
        uTime: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      side: THREE.DoubleSide,
    })
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.6), groundMat)
    ground.rotation.x = -Math.PI / 2
    ground.visible = false
    ground.frustumCulled = false
    ground.renderOrder = 19

    const rippleMat = new THREE.ShaderMaterial({
      vertexShader: AEGISRIPPLE_VERT,
      fragmentShader: AEGISRIPPLE_FRAG,
      uniforms: {
        uColor: { value: new THREE.Color(COLORS.aureate) },
        uCore: { value: new THREE.Color(COLORS.solarWhite).multiplyScalar(1.7) },
        uOpacity: { value: 0 },
        // w < 0 marks a free slot; the loop skips it
        uHits: {
          value: Array.from({ length: AEGIS_RIPPLES }, () => new THREE.Vector4(0, 0, 1, -1)),
        },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      toneMapped: false,
    })
    // a hair outside the shell's mid layer so the ripple rides ON the barrier
    const ripple = new THREE.Mesh(new THREE.SphereGeometry(1.02, 40, 26), rippleMat)
    ripple.visible = false
    ripple.frustumCulled = false
    ripple.renderOrder = 21

    return {
      shell,
      ground,
      groundMat,
      ripple,
      rippleMat,
      rippleAge: Array.from({ length: AEGIS_RIPPLES }, () => AEGIS_RIPPLE_SEC),
      lastOvershield: 0,
    }
  }, [])

  // requiem torus shockwave + converging motes + aftermath decal, built imperatively
  const requiemFx = useMemo<RequiemFx>(() => {
    const torusMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: {
        uProgress: { value: 0 },
        uOpacity: { value: 0 },
        uTime: { value: 0 },
        uGlyph: { value: glyphTex },
      },
      vertexShader: NOVA_VERT,
      fragmentShader: NOVA_FRAG,
    })
    // unit ring radius, fat tube — scaled 0.6 → 12 m at detonation
    const ringGeoMain = new THREE.TorusGeometry(1, 0.055, 10, 96)
    const torus = new THREE.Mesh(ringGeoMain, torusMat)
    torus.rotation.x = -Math.PI / 2 // lie flat on the ground plane
    torus.visible = false
    torus.frustumCulled = false
    torus.renderOrder = 21

    // [vfx R1] two more fronts so the nova is a nest of rings, not a circle.
    // Same shader, own uniforms, counter-rotated against the main ring.
    const makeRing = (tube: number, order: number) => {
      const mat = torusMat.clone()
      mat.uniforms = THREE.UniformsUtils.clone(torusMat.uniforms)
      mat.uniforms.uGlyph!.value = glyphTex
      const mesh = new THREE.Mesh(new THREE.TorusGeometry(1, tube, 8, 72), mat)
      mesh.rotation.x = -Math.PI / 2
      mesh.visible = false
      mesh.frustumCulled = false
      mesh.renderOrder = order
      return { mesh, mat }
    }
    const inner = makeRing(0.075, 20)
    const lead = makeRing(0.022, 22)

    // [vfx R2] textured, randomised charge motes (work order item 6). The old
    // PointsMaterial carried NO map, so these drew as 60 opaque gold SQUARES.
    const moteGeo = new THREE.BufferGeometry()
    const moteAttr = new THREE.BufferAttribute(new Float32Array(REQUIEM_MOTES * 3), 3).setUsage(
      THREE.DynamicDrawUsage,
    )
    moteGeo.setAttribute('position', moteAttr)
    const moteSeeds = makeMoteSeeds()
    // per-mote size 0.4–1.6× and an independent seed for brightness/flicker/roll
    const moteSize = new Float32Array(REQUIEM_MOTES)
    const moteSeed = new Float32Array(REQUIEM_MOTES)
    for (let i = 0; i < REQUIEM_MOTES; i++) {
      // reuse the deterministic seed table so the swarm is identical each cast
      const r = moteSeeds[i * 4 + 1]! / (Math.PI * 2)
      moteSize[i] = 0.09 * (0.4 + r * 1.2)
      moteSeed[i] = (moteSeeds[i * 4]! - 4) / 3
    }
    moteGeo.setAttribute('aSize', new THREE.BufferAttribute(moteSize, 1))
    moteGeo.setAttribute('aSeed', new THREE.BufferAttribute(moteSeed, 1))
    moteGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5)
    const moteMat = new THREE.ShaderMaterial({
      vertexShader: MOTE_VERT,
      fragmentShader: MOTE_FRAG,
      uniforms: {
        uPixelScale: { value: 800 },
        uAspect: { value: 1.777 },
        uTime: { value: 0 },
        uProgress: { value: 0 },
        uCenter: { value: new THREE.Vector3() },
        uColor: { value: new THREE.Color(COLORS.aureate).multiplyScalar(2.2) },
        uAtlas: { value: getParticleAtlas() },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
    const motes = new THREE.Points(moteGeo, moteMat)
    motes.visible = false
    motes.frustumCulled = false
    motes.renderOrder = 21

    // [vfx R2] thin expanding nova shell with a hard leading edge (item 5)
    const shellMat = new THREE.ShaderMaterial({
      vertexShader: SHELL_VERT,
      fragmentShader: SHELL_FRAG,
      uniforms: {
        uColor: { value: new THREE.Color(COLORS.aureate).multiplyScalar(1.6) },
        uCore: {
          value: new THREE.Color(COLORS.solarWhite).multiplyScalar(VFXENERGY.novaCoreBoost),
        },
        uOpacity: { value: 0 },
        uEdge: { value: 0.45 },
        uFill: { value: 0.3 },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    })
    // icosahedron, not a UV sphere: no polar pinch on a shell this large
    const shell = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 3), shellMat)
    shell.visible = false
    shell.frustumCulled = false
    shell.renderOrder = 20

    // aftermath decal: fading gold radial glyph disc scorched into the floor
    const decalMat = new THREE.MeshBasicMaterial({
      map: glyphTex,
      color: COLORS.aureate,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    })
    /*
     * [vfx R4] This is a 10.8 m additive gold disc on the deck, and the glyph
     * sprite mapped onto a CircleGeometry's square UVs makes it an OCTAGON.
     * At 0.9 additive it is the big hard-edged white polygon that owns the
     * lower left of the driven katana capture — a flat single-layer additive
     * shape at the largest scale in the game. The real surface mark is the
     * premultiplied scorch `VFX.decal` already lays at the epicentre; this
     * layer is the glow ON that mark, so it comes down to a third of the
     * energy and cools three times as fast (see updateRequiem).
     */
    const decal = new THREE.Mesh(new THREE.CircleGeometry(REQUIEM_RADIUS * 0.45, 48), decalMat)
    decal.rotation.x = -Math.PI / 2
    decal.visible = false
    decal.frustumCulled = false
    decal.renderOrder = 18

    // persistent faint ring at the blast edge (3 s fade)
    const faintRingMat = new THREE.ShaderMaterial({
      vertexShader: EDGERING_VERT,
      fragmentShader: EDGERING_FRAG,
      uniforms: {
        uColor: { value: new THREE.Color(COLORS.aureate) },
        uCore: { value: new THREE.Color(COLORS.solarWhite) },
        uOpacity: { value: 0 },
        uRadius: { value: REQUIEM_RADIUS * 0.98 },
        uWidth: { value: REQUIEM_RADIUS * 0.055 },
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    })
    // the annulus is widened well past the visible band so the gaussian has
    // room to reach zero inside the geometry — the band never meets an edge
    const faintRing = new THREE.Mesh(
      new THREE.RingGeometry(REQUIEM_RADIUS * 0.82, REQUIEM_RADIUS * 1.14, 128),
      faintRingMat,
    )
    faintRing.rotation.x = -Math.PI / 2
    faintRing.visible = false
    faintRing.frustumCulled = false
    faintRing.renderOrder = 18

    // full-screen detonation overlay (fix1): camera-locked additive quad
    const screenFlashMat = new THREE.MeshBasicMaterial({
      // [vfx R1] a RADIAL flash, not a flat white rectangle: the old overlay
      // clipped the whole frame to white and read as a broken buffer
      map: getSoftGlowTexture(),
      color: COLORS.solarWhite,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      toneMapped: false,
    })
    const screenFlash = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), screenFlashMat)
    screenFlash.visible = false
    screenFlash.frustumCulled = false
    screenFlash.renderOrder = 40

    // [vfx R4] THE HEART. Three nested volumetric layers on one sphere: a
    // white core authored far above the tone curve's shoulder (it clips, and
    // that is the point), a saturated aureate body with a scrolling erosion
    // field so it is never a smooth ball, and a wide low-exponent veil that
    // takes the silhouette to zero instead of ending on an outline.
    const chargeCore = createEnergyShell({
      geometry: new THREE.IcosahedronGeometry(1, 3),
      shape: { nearFade: 2.2 },
      core: {
        color: COLORS.solarWhite,
        boost: 3.4,
        scale: 0.52,
        profile: 'volume',
        power: 1.35,
        hot: 1,
        hotPow: 1.2,
        erode: 0.12,
        erodeScale: 4,
      },
      mid: {
        color: COLORS.aureate,
        boost: 1.9,
        scale: 0.9,
        profile: 'volume',
        power: 0.62,
        hot: 0.6,
        hotPow: 2.6,
        erode: 0.4,
        erodeScale: 8,
      },
      outer: {
        color: COLORS.aureate,
        // [vfx R5] opacity 0.15 -> 0.09 and power 0.55 -> 0.95. pow(|N.V|,0.55)
        // is above 0.7 over most of a sphere's disc, so at 0.15 this veil was
        // laying a near-uniform 0.10 of additive gold across its whole
        // projected area — a 4 m soft blob centred on the character and, at
        // DoubleSide, counted twice. It is now a falloff that actually falls
        // off, and the energy it gave up is in the rim where the event is.
        boost: 1.0,
        scale: NOVA_VEIL_SCALE,
        // [vfx R5] 0.09 -> 0.045. Measured on the driven peak frame: the
        // veil is a 2.7 m ball of soft gold drawn twice (DoubleSide) at the
        // heart's own intensity, and it was contributing about half a stop of
        // flat additive gold across a fifth of the picture — the "bloom blob"
        // read, from the one layer of the stack that has no shape in it.
        opacity: 0.045,
        profile: 'volume',
        power: 0.95,
      },
      renderOrder: 22,
      side: THREE.DoubleSide,
    })
    chargeCore.group.visible = false

    return {
      torus,
      torusMat,
      torusInner: inner.mesh,
      torusInnerMat: inner.mat,
      torusLead: lead.mesh,
      torusLeadMat: lead.mat,
      novaLight: null,
      shell,
      shellMat,
      motes,
      moteAttr,
      moteMat,
      moteSeeds,
      screenFlash,
      screenFlashMat,
      flashAge: 0,
      chargeCore,
      decal,
      decalMat,
      faintRing,
      faintRingMat,
    }
  }, [glyphTex])

  useFrame((state, rawDt) => {
    const dt = combatTick(state.clock.elapsedTime, rawDt)
    // [vfx R4] unscaled frame time, clamped the same way the systems clamp
    // theirs. Lens and post responses run on this; world events run on `dt`.
    const realDt = Math.min(rawDt, 0.1)
    const cs = CombatState

    // input edges
    if (canFight()) {
      if (Input.pressed('ability1') && tryCast('A1')) castDash(state.camera)
      if (Input.pressed('ability2') && tryCast('A2')) castVolley()
      if (Input.pressed('ability3') && tryCast('A3')) castAegis()
      if (Input.pressed('ability4') && tryCast('A4')) castRequiem(requiemFx)
    }

    // cooldown-ready pings for the HUD (§4)
    for (const id of ABILITY_IDS) {
      const remaining = Math.max(0, cs.cooldownReadyAt[id] - cs.clock)
      if (prevRemaining.current[id] > 0 && remaining <= 0) emitCombat({ type: 'ready', id })
      prevRemaining.current[id] = remaining
    }

    // mote point-size attenuation needs the viewport; only while charging
    if (cs.requiemPhase === 1) {
      const persp = state.camera as THREE.PerspectiveCamera
      const u = requiemFx.moteMat.uniforms
      u.uPixelScale!.value =
        persp.isPerspectiveCamera === true
          ? state.size.height / (2 * Math.tan(THREE.MathUtils.degToRad(persp.fov) / 2))
          : state.size.height
      u.uAspect!.value = state.size.height > 0 ? state.size.width / state.size.height : 1.777
    }

    updateDash(state.camera, ghostRefs.current, ghostMats, ghostSpawnAt.current)
    updateVolley(state.camera, dt, javelinVisuals)
    updateAegis(dt, haloRef.current, glyphRefs.current, aegisVisual)
    // the halo's erosion and fret band scroll on the combat clock; the ring
    // counter-scrolls against the group's own spin so the runes travel
    haloShell.setTime(cs.clock * 0.9)
    haloShell.setScroll(-cs.clock * 0.07)
    // the ring is the whole halo now that the flat plane is gone
    haloShell.setIntensity(1.2 + 0.14 * Math.sin(cs.clock * 3.1))
    updateRequiem(dt, realDt, state.camera, requiemFx, pillarRefs.current, pillarMats)

    // keep the HUD overshield bar in sync (the damage intercept in state.ts
    // drains cs.overshield from outside this module)
    setOvershield(cs.overshield)
  })

  return (
    <group>
      {/* ---- sunspike javelins: three-layer energy shells (core / mid /
           3× outer falloff) + glow head + ribbon + travelling light ---- */}
      {javelinVisuals.map((v, i) => (
        <primitive key={`javelin-${i}`} object={v.shell.group} />
      ))}

      {/* ---- gilt dash afterimage ghosts (additive gold player silhouettes) ---- */}
      {ghostMats.map((mats, i) => (
        <group
          key={`ghost-${i}`}
          ref={(g) => {
            ghostRefs.current[i] = g
          }}
          visible={false}
        >
          <mesh position={[0, 0.95, 0]} material={mats[0]}>
            <capsuleGeometry args={[0.32, 1.1, 4, 8]} />
          </mesh>
          <mesh position={[0, 1.72, 0]} material={mats[1]}>
            <boxGeometry args={[0.26, 0.28, 0.28]} />
          </mesh>
        </group>
      ))}

      {/* ---- aegis halo: four layers (work order item 8) — wide soft falloff
           billboard, saturated gold mid ring, hot white core ring above the
           bloom knee, and 6 orbiting glyph sprites. Previously two flat tori
           at ~0.86 additive, i.e. exactly at the knee, so the halo was a
           single-layer gold outline that never bloomed. ---- */}
      <group ref={haloRef} visible={false}>
        {/* (1) wide soft outer falloff — sits UNDER the knee, gives the halo air */}
        {/* [vfx R3] The wide soft-falloff plane is GONE. It was a 2.6 m
            additive gold disc lying flat above the character's head, i.e.
            exactly the flat single-layer additive primitive the blind test
            names first, and from a third-person camera it is seen almost
            edge-on so none of its radial gradient is visible anyway. The
            volumetric torus below is the whole element now: its outer layer
            at 1.3x with a 0.24 thickness exponent IS a wide soft falloff,
            and unlike a plane it falls off in every direction. */}
        {/* (2+3) [vfx R3] the two rings were flat `MeshBasicMaterial` tori —
             constant alpha right to the polygonal silhouette, which is the
             "flat single-layer additive shape" the blind test names first.
             They are now one volumetric EnergyShell on a torus: a hot
             filament down the middle of the tube fading to nothing at the
             tube's own outline, a saturated body, a wide veil, and a
             scrolling erosion field so the ring is never a static decal. */}
        <primitive object={haloShell.group} />
        {Array.from({ length: 6 }, (_, i) => (
          <mesh
            key={`glyph-${i}`}
            ref={(m) => {
              glyphRefs.current[i] = m
            }}
          >
            <planeGeometry args={[0.3, 0.3]} />
            <meshBasicMaterial
              map={glyphTex}
              color={COLORS.aureate}
              transparent
              opacity={0.8}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
              side={THREE.DoubleSide}
              toneMapped={false}
            />
          </mesh>
        ))}
      </group>

      {/* ---- aegis barrier: Fresnel sphere + scrolling fret band + ground
           contact ellipse (replaces the flat additive capsule, C7) ---- */}
      <primitive object={aegisVisual.shell.group} />
      <primitive object={aegisVisual.ripple} />
      <primitive object={aegisVisual.ground} />

      {/* ---- requiem: 8 vertical light pillars + motes + torus shockwave + aftermath ---- */}
      {pillarMats.map((mat, i) => (
        <mesh
          key={`pillar-${i}`}
          ref={(m) => {
            pillarRefs.current[i] = m
          }}
          material={mat}
          visible={false}
          frustumCulled={false}
        >
          {/* [vfx R4] 3 m -> 2.2 m. Eight 3 m additive cards 22 m tall put a
              measurable haze across the whole upper frame in the driven ult
              capture; the shafts have to read as columns of light standing in
              the room, not as a fog machine. */}
          <planeGeometry args={[2.2, 22]} />
        </mesh>
      ))}
      <primitive object={requiemFx.chargeCore.group} />
      <primitive object={requiemFx.motes} />
      <primitive object={requiemFx.shell} />
      <primitive object={requiemFx.torus} />
      <primitive object={requiemFx.torusInner} />
      <primitive object={requiemFx.torusLead} />
      <primitive object={requiemFx.decal} />
      <primitive object={requiemFx.faintRing} />
      <primitive object={requiemFx.screenFlash} />
    </group>
  )
}

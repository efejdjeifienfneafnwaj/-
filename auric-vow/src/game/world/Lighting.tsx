/**
 * AURIC VOW — world/Lighting.tsx
 * Light rig per design.md §2.3 + environment.md §4.
 *
 * R1 rebuild (art review):
 * - the single 110×110 ortho key is replaced by a TWO-CASCADE rig: a sharp
 *   ±32 m ortho recentred on the camera (texel-snapped so shadows don't crawl)
 *   carries contact and mid shadows, and a static wide ±130 m cascade catches
 *   distant blockers. Both share one direction, so shading never changes as
 *   the player moves; the key's energy is split between them.
 * - ambient is cut hard (hemisphere 0.7→0.32, camera fill 0.55→0.25, cool rim
 *   halved) so the 2.2 key does the modelling and recesses keep true darks.
 *
 * R2 (art review round 2), in order of how much each one changed the frame:
 * - KEY_OFFSET reweighted so the −Z component (the axis the camera looks
 *   down) carries 0.58 of the key instead of 0.27, at a lower 41° elevation.
 * - key 2.2 → 4.4 and every fill term cut to roughly a third, so a shadow is
 *   a ~3.5-stop event rather than a quarter-stop one (see config LIGHTING).
 * - the PMREM probe is re-weighted by SOLID ANGLE: the narrow specular bar
 *   goes 6 → 12 while every broad panel drops 3–4×, which buys gold its
 *   reflection without the probe acting as ambient fill.
 * - ContactBlobs: an unconditional projected contact shadow under the player
 *   and every enemy, so grounding survives the tier where casting is off.
 * - practicals are no longer six hardcoded coordinates: positions come from
 *   ShrineStation.TEAL_FIXTURES (the actual emissive strips, offset along the
 *   surface normal) and only the nearest 4 are lit, with intensity locked to
 *   the same pulse curve EnvironmentFX drives the strips with.
 * - the PMREM environment gains the pieces gold needs to read as metal: a
 *   narrow intensity-6 white strip above/behind, a near-black ground, a warm
 *   horizon band, and two wide sky panels matching FOG.skyHorizon/skyZenith so
 *   upward faces pick up the backdrop.
 *
 * R3 (light transport). The premise of this round is that R1 and R2 tuned a
 * rig that was structurally unable to produce the picture, so the structure
 * changed rather than the numbers:
 * - the two-cascade ENERGY SPLIT is gone. A directional light returns fully
 *   lit outside its shadow ortho, so the 0.74 near cascade was leaking three
 *   quarters of the key past every blocker beyond 26 m. One dominant cascade
 *   now carries 0.86 over a ±24 m box at 2048² (2.3 cm/texel); the remaining
 *   0.14 is re-tinted toward the sky and demoted to aligned sky bounce.
 * - the drei <Environment>/<Lightformer> room is replaced by a hand-authored
 *   float equirect with a real 3° SUN DISC at KEY_DIR (radiance 39, contrast
 *   ratio ~2.3e5 against the crushed anti-key hemisphere, but only ~0.05–0.10
 *   of diffuse ambient). Gold now has something to be a mirror of.
 * - the god rays are RAYMARCHED against the key's own shadow map, so a shaft
 *   is cut by the rib it passes behind instead of drawing through it.
 * - GOLD_FIXTURES, exported since R2 and never read by any light, now drives
 *   five architectural practicals, and the chamber oculus spot CASTS.
 * - the contact blobs are ellipses stretched and slid along the key's ground
 *   azimuth, so they agree with the cast shadows instead of contradicting them.
 * The shadow FILTER itself (PCSS) and the fog INTEGRAL (world-space height fog
 * + inscattering) are patched into the stock shader chunks — see GameCanvas.tsx
 * and Fog.tsx respectively, both of which document why at length.
 *
 * R4 (light transport, measured). R3's premise — that the shadows were broken
 * — was wrong, and a control capture proved it: toggling `__qa.setShadows()`
 * between two otherwise identical frames moves 92 % of the chamber and 77 % of
 * the canyon by a mean of 50–64/255. The shadow maps, the PCSS filter and the
 * flags were all working. What was broken is that the frame was ENTIRELY in
 * shadow, because the key is a 42°-elevation sun and the level's interiors are
 * roofed, so the only thing lighting them was a directionless 0.82 IBL plus a
 * hemisphere. Three rounds of bias and filter work could not have fixed that.
 * So R4 is about where the light comes from, not how it is filtered:
 * - APERTURE KEYS: each opening the sun physically enters through (two oculi,
 *   two canyon glazing bays) now carries a spot aimed along the key's own
 *   travel direction, in the key's colour, sized to put sun-level irradiance
 *   on the floor below. The oculi cast. Interiors finally have a dominant
 *   source that models form and throws a shadow you can point at.
 * - the probe's GAIN drops 0.82 → 0.26 while its CONTRAST goes up (sun disc
 *   and specular bar ×2.9, anti-key hemisphere 0.16 → 0.05), so the flat fill
 *   collapses without costing gold its reflection.
 * - hemisphere ×0.55, camera fill ×0.6, practicals ×0.62, key ×1.35.
 * - near cascade normalBias 0.02 → 0.005 (2 cm of peter-panning was most of a
 *   contact shadow's width), with the constant bias taking over the acne.
 * - the R3 chamber oculus spot is retired: at intensity 4 / decay 1.5 over a
 *   24 m throw it delivered 0.034 irradiance and cost a shadow pass.
 * The other half of R4 lives in GameCanvas.tsx: a shadow-contract sweep that
 * enforces cast/receive on every opaque lit mesh (receivers 450 → 499, casters
 * 238 → 422). While measuring it, a material census turned up the biggest open
 * problem in the build and it is not ours: of 1328 meshes only 477 are on a
 * lit material at all. The rig can never shade the other 851. Most are
 * legitimately unlit VFX, but it caps what any lighting work can achieve.
 *
 *
 * R5 (light transport). R4 established that a roofed room has to be lit by
 * the openings the sun comes through, and then lit three of the level's four
 * rooms that way. This round is mostly about the fourth.
 * - THE ARENA. `lightReport` on the R4 build shows it: the arena is the room
 *   the review set judges hardest (08_enemies, 11_ability_dash, 17_katana,
 *   18_arena_wide — four of nineteen frames) and it had NO placed light of
 *   any kind. Its 60 m walls were lit by the probe and a 0.066 hemisphere,
 *   both directionless, which is the literal mechanism behind "the arena wall
 *   tiles like wallpaper with no lit falloff" and behind a back wall that
 *   carries one value from plinth to cornice. `ARENA_VAULT_OCULUS_BAYS` has
 *   left the vault ridge open at z 190 and z 200 since R4 and nothing was
 *   ever put behind it; both slots now carry an aperture key.
 * - APERTURE SLOT POOL. The six openings are now DATA and the lights are a
 *   two-deep pool that follows the camera into the room it is in, so the two
 *   shadow passes the rig already paid for are spent where the player is.
 *   That is what lets the canyon glazing cast — 03_sprint is an arcade under
 *   a rib course and a gantry run with not one rung of shade on its deck —
 *   and lets the arena pool be cut by its own megaliths. The pool exists
 *   rather than six gated lights because `numSpotLights` and
 *   `numSpotLightShadows` are program parameters; see APERTURE_SLOTS.
 * - POOL BOUNCE. Each live aperture seats a decay-2 point light over the
 *   patch of floor its shaft lands on. In a hall lit through a hole the pool
 *   is the brightest surface by a wide margin and the wall above it is lit by
 *   the floor, not by the sky; that 1/r² vertical ramp is the cue the arena
 *   has never had, and unlike an ambient lift it cannot reach the far side of
 *   the room.
 * - CHARACTER KICKERS. The only light dedicated to the hero was a point light
 *   1.15 m behind his pelvis, which wraps a convex mass in an even value —
 *   the cue the eye reads as BULK, and half of why the panel keeps calling a
 *   measured 8.14-head figure barrel-chested. A distant near-parallel warm
 *   back-three-quarter kicker plus a cold counter-rim collapses the lit band
 *   onto the silhouette boundary instead, which is the Warframe read and
 *   which makes the same geometry look narrower. See KICKERS.
 * - probe 0.26 → 0.20 with the specular features compensated, and the fog's
 *   near value and height ramp both pulled down (Fog.tsx), because fog is the
 *   only term in the renderer that can put a floor UNDER the darks.
 *
 * Phase-driven lights (chamber/pad gold points) live in EnvironmentFX.
 * The player-follow rim light (design §2.3 #12) is owned by the player rig;
 * the camera-space KICKERS below are a separate instrument and deliberately
 * so — see the note over KICKERS for why one cannot do the other's job.
 */
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { LIGHTING, MATERIALS, COLORS, SKY } from '../config'
import { TEAL_FIXTURES, GOLD_FIXTURES } from './ShrineStation'
import { PlayerRef } from '../player/PlayerRef'
import { EnemyRegistry } from '../enemies/EnemyRegistry'
import { raycastLevel } from './Colliders'
import { getContactBlobTexture } from '../textures'

/**
 * Constant key direction (light → target); everything else follows it.
 *
 * R2 — this moved, and it is one of the most consequential numbers in the rig.
 * The old vector (-40, 60, -20) had the right hemisphere but almost no weight
 * along the axis the player actually looks down: the −Z term was 0.27 of a
 * unit vector, so the faces the camera sees took barely a quarter of the key
 * and the frame read flat no matter how bright the key got.
 *
 * Sign discipline, because it is easy to get backwards and a capture proved
 * it: KEY_OFFSET is the light's POSITION relative to its target, so light
 * TRAVELS along −KEY_OFFSET. A surface is lit when its normal points back
 * along +KEY_OFFSET. The camera looks down +Z and therefore sees −Z-facing
 * surfaces, so the key must sit at NEGATIVE z for the visible faces to be the
 * lit ones. (Moving it to +z was tried and flattened every frame into
 * backlight — worth stating here so nobody repeats it.)
 *
 * What actually changed in R2 is the WEIGHTING, not the hemisphere: the −Z
 * component goes from 0.27 to 0.58 of the vector, so the faces the player
 * walks toward take more than double the key they used to, and the elevation
 * drops 53° → 41° so shadows are long enough to read as events. At that
 * elevation the 17 m canyon outer wall throws its edge to about x = 2.5,
 * which leaves the east third of the deck in full key and the rest in shadow
 * — a raking, half-lit deck rather than a uniformly lit one.
 */
const KEY_OFFSET = new THREE.Vector3(-46, 66, -58).normalize().multiplyScalar(120)
/** unit vector pointing from the scene TOWARD the key (used by the skybox) */
export const KEY_DIR = KEY_OFFSET.clone().normalize()

// ---------------------------------------------------------------------------
// R3 — cascade geometry, and why the energy split collapsed to one light
//
// R2 split the key 0.74 / 0.26 between a ±26 m near cascade and a ±130 m far
// one. That split has a flaw that no amount of tuning fixes: a directional
// light returns FULLY LIT for any fragment outside its shadow ortho. So a
// character standing 40 m away, correctly shadowed by the far cascade, still
// received 74 % of the key from the near one — the shadow was a 0.6-stop
// event out there no matter what the config said. The near cascade's whole
// job was contact detail, and it was leaking three quarters of the key past
// every blocker beyond 26 m.
//
// Fix: ONE dominant cascade carrying 0.86 of the key over a ±24 m box at
// 2048² (2.3 cm/texel — a boot sole is four texels wide), texel-snapped and
// pushed ahead of the camera. Inside that box, which is the whole of the near
// field a third-person camera ever shows, a shadow removes 86 % of the key,
// which at hemisphere 0.12 + cameraFill 0.08 + coolRim 0.18 is a genuine
// 3.5-stop event with true black in the recesses.
//
// The far light keeps 0.14, gets a 2048² map over the same ±130 m, and is
// re-tinted toward the sky so its leak past 24 m reads as directional sky
// bounce rather than as a second, shadowless sun.
// ---------------------------------------------------------------------------
const CASCADE = {
  primary: {
    // ±24 m at 2048 is 2.34 cm/texel — finer than R2's ±26 map and at the same
    // memory, because the interesting question turned out to be "how much of
    // the key does a blocker actually remove", not "how many texels". A 68 m
    // box at 3072 was tried and is 2.25× the depth-pass fill for a 6 % coarser
    // texel; the far cascade already owns everything past 24 m and fog has
    // eaten most of the contrast out there anyway.
    extent: 24,
    mapSize: 2048,
    // R4: normalBias 0.02 → 0.005. normalBias pushes the shadow lookup along
    // the surface normal in WORLD units before projecting, so it trades acne
    // for peter-panning one-for-one: at 0.02 a contact shadow is displaced
    // 2 cm off its caster, which is most of the width of the contact itself.
    // At 2.34 cm/texel the offset only has to clear a texel's worth of depth
    // slope, and 0.005 does that while leaving the contact where the boot is.
    // The constant depth bias takes over the rest of the acne budget.
    bias: -0.00022,
    normalBias: 0.005,
    /** PCSS penumbra scale, in units of 7 texels at maximum opening */
    radius: 1.15,
    share: 0.86,
  },
  far: {
    extent: 130,
    mapSize: 2048,
    // 12.7 cm/texel out here, so this one genuinely needs a wide normal
    // offset — but 0.05 was detaching distant shadows from their casters by
    // half a texel of world space at the near end of its range.
    bias: -0.0006,
    normalBias: 0.018,
    radius: 1.0,
    share: 0.14,
  },
} as const

// ---------------------------------------------------------------------------
// R4 fill budget.
//
// These are local multipliers rather than edits to config.LIGHTING, because
// config.ts belongs to the post/colour stream and the ratios below are a
// property of the RIG (what fraction of the scene's light is directional and
// motivated), not of the grade. Measured on the R3 build:
//
//     key 4.4    non-key 108.3    keyOverFill 0.041
//
// Most of that 108 is point lights with decay 2, so it is not 108 worth of
// ambient — but the practicals were still summing to more irradiance in the
// near field than the key delivered, and the practicals are the one class of
// light that cannot model form because there are 9 of them pointing every way.
// So the two directionless terms come down and the one dominant term goes up.
// ---------------------------------------------------------------------------
/**
 * Gain on the near cascade — the single source that is allowed to model form.
 *
 * Tuned against a luma histogram of the same two framings before and after,
 * sampled over the frame minus the HUD rects. At 1.35 the ambient cut had
 * pulled the canyon's 95th percentile from 189 to 164 along with the median,
 * which is a darker frame rather than a higher-contrast one. Raising the key
 * is the correct place to put that back: it is the exact term a shadow
 * removes, so it lifts the lit planes and the highlights while leaving the
 * shadowed ones where the ambient cut left them. The spread opens instead of
 * the whole histogram sliding.
 */
const KEY_GAIN = 1.62
/** the hemisphere is the colour the shadow side is allowed to be, not a light */
const HEMI_GAIN = 0.55
/** camera-locked fill removes every shadow the player can see; keep it a trace */
const CAMERA_FILL_GAIN = 0.6
/** practical pools should read as pools, not as a second ambient */
const PRACTICAL_GAIN = 0.62

/** far cascade tint — the key colour pulled most of the way to the sky */
const FAR_TINT = new THREE.Color(LIGHTING.key.color).lerp(
  new THREE.Color(LIGHTING.hemisphere.skyColor),
  0.55,
)

/**
 * The primary cascade's depth map and world→shadow matrix, published once a
 * frame so the volumetric shafts can march through the SAME occlusion the
 * surfaces are shaded with. This is what makes a god ray a light-transport
 * event instead of a decal: the shaft is broken by the rib it passes behind.
 */
const PrimaryShadow: { map: THREE.Texture | null; matrix: THREE.Matrix4 } = {
  map: null,
  matrix: new THREE.Matrix4(),
}

// ---------------------------------------------------------------------------
// APERTURE KEYS (R4) — the change this round is actually about
//
// The R3 note below argues at length about cascades, bias and filter quality.
// All of it was answering the wrong question, and one measurement settled it.
// Driving the built page and toggling `window.__qa.setShadows()` between two
// otherwise identical frames:
//
//     chamber   mean |ON − OFF| = 49.6/255   92.4 % of pixels moved by >6
//     canyon    mean |ON − OFF| = 63.7/255   77.2 % of pixels moved by >6
//
// The shadows were never broken. The PCSS patch matches the r185 chunk (I
// re-ran the regex against the installed `shadowmap_pars_fragment` — it hits),
// the maps render, the filter runs. The problem is the opposite of the one
// three rounds of work orders assumed: when three quarters of the frame gets
// DARKER the moment shadowing is enabled, essentially the whole frame is
// already in shadow, and a shadow cannot read as a shape when there is no lit
// plane next to it to be a shape against.
//
// That is a geometry fact, not a tuning one. The key sits at 42° elevation and
// the level's interiors — the domed reliquary chamber, the arched traversal
// canyon, the arena under its gallery — are ROOFED. The sun does not get in.
// Every interior surface was therefore lit by ambient alone: the PMREM at 0.82
// plus a 0.12 hemisphere, both of which are directionless by construction.
// A directionless light cannot model form, so the frame reads exactly as the
// panel described it — an untextured blockout.
//
// AAA does not light an interior with the sun. It lights it with the places
// the sun gets in, and everything else falls off from there. So each aperture
// in the level — the two oculi, the canyon's glazed slots — now carries a
// SPOT LIGHT aimed along the key's own travel direction, in the key's colour,
// at an intensity that puts real sun-level irradiance on the floor it lands
// on. The two oculi CAST. The result is a hard-edged, off-centre pool of hot
// light on an interior floor with the dome's own ribs cut into it, which is
// the single most expensive-looking thing a renderer can do for free.
//
// They are motivated in the literal sense the brief asks for: the positions
// are the same apertures GOD_RAYS draws its visible shafts from, so the light
// on the floor is the bottom of a shaft you can see in the air above it.
//
// Sizing: the light travels `drop / KEY_DIR.y` metres from the aperture to the
// floor, and decay is 1.0 rather than the physical 2.0 on purpose — a shaft of
// sunlight through a hole is a slice of a source at infinity, so its pool does
// not fall off inverse-square across the room. Intensity is therefore just
// `floorIrradiance × path`, which keeps the number legible next to the key's
// own irradiance instead of being an opaque four-digit candela figure.
// ---------------------------------------------------------------------------
const APERTURES: {
  /** the mouth of the opening (matches a GOD_RAYS shaft) */
  p: [number, number, number]
  /** cone half-angle, rad — sized to the shaft's own bottom radius */
  angle: number
  /** irradiance delivered on the floor, in the same units as the key's */
  floorIrradiance: number
  /** metres from the aperture down to the floor it lands on */
  drop: number
  /**
   * Shadow-camera near plane, in metres ALONG THE RAY from the aperture. The
   * default 1.5 over a 97 m far spends almost the whole depth range on the
   * empty air between the vault and the first thing that can occlude, and a
   * 24-bit depth buffer distributed hyperbolically over 1.5→97 has roughly a
   * 60× coarser slope near the floor than one distributed over 14→97. That
   * difference is the entire acne budget for the arena pool.
   */
  near?: number
  /**
   * Bounce: how much of this aperture's pool comes back up off the floor, as
   * a fraction of `floorIrradiance` measured at 1 m. See `ApertureKeys` — the
   * pool is by a wide margin the brightest surface in a roofed room, so the
   * wall above it is lit by the floor, not by the sky, and that upward 1/r²
   * ramp is the thing that stops a 60 m wall reading as wallpaper.
   */
  bounce?: number
  /**
   * How far the camera can be before this aperture drops out of the slot pool
   * entirely. Sized so the fixture is already at nothing when it goes — at
   * `cull` the spot's own distance cutoff has taken it past zero, so the
   * hand-off between rooms is invisible.
   */
  cull?: number
}[] = [
  // spawn oculus — the first interior the player stands in
  { p: [0, 12, 7.5], angle: 0.46, floorIrradiance: 5.3, drop: 12, bounce: 0.1 },
  // reliquary chamber oculus — the mission's hero room, and the one frame the
  // panel is most likely to judge. Its pool lands off-centre by design.
  { p: [0, 17, 150], angle: 0.56, floorIrradiance: 6.2, drop: 17, bounce: 0.14 },
  // canyon glazing, two bays — these rake the deck the player sprints down.
  //
  // R5: these CAST now. In 03_sprint the canyon is a roofed arcade whose
  // floor carries no shadow at all, because the only light reaching it came
  // through these two openings and they were shadowless — so the gantries,
  // the transverse arches and the rib course overhead threw nothing. A lit
  // corridor with no rungs of shade across it is the clearest possible signal
  // that nothing in the frame is being transported, and it is the one the
  // panel keeps reading as "untextured blockout". A slot's 1024 over a
  // canyon bay's 11 m cone is 1.1 cm/texel, which resolves a rib comfortably.
  // (irradiance left at R4's 3.9 on purpose: 4.3 was tried and measured +17
  //  on the canyon's median, and the canyon is already the brightest room in
  //  the level. What this round changes here is that the openings CAST, not
  //  that they deliver more.)
  { p: [3.4, 10, 60], angle: 0.36, floorIrradiance: 3.9, drop: 10, bounce: 0.08, cull: 62 },
  { p: [3.4, 10, 100], angle: 0.36, floorIrradiance: 3.9, drop: 10, bounce: 0.08, cull: 62 },
  // ---------------------------------------------------------------------
  // ARENA VAULT RIDGE SLOTS — the room the review set judges hardest, and
  // until R5 the only room in the level with NO placed light of any kind.
  //
  // `ARENA_VAULT_OCULUS_BAYS` in layout.ts leaves the ridge open at z 190 and
  // z 200, so the arena has two real 10 m openings at the crown, 29.5 m over
  // the deck, and nothing was ever put behind them. Everything in 08_enemies
  // and 18_arena_wide is therefore lit by the probe and the hemisphere, both
  // directionless by construction — which is exactly why the arena's back
  // wall is one flat value from plinth to cornice and why every wide of it
  // reads as wallpaper.
  //
  // At the key's 41.7° elevation a slot 29.5 m up throws its pool 44.3 m down
  // the ray and lands it at x ≈ +20.6, z ≈ slot + 25.9. So the z=190 slot
  // pools on the floor in the north-east quadrant and the z=200 slot runs
  // past the deck and rakes the NORTH WALL — the wall that fills 08_enemies.
  // That asymmetry is not staged: it is where a 41.7° sun through those two
  // holes actually puts its light, and it leaves the west half of the room
  // in shadow, which is the half the panel wants dark.
  { p: [0, 29.5, 190], angle: 0.26, floorIrradiance: 6.4, drop: 29.5, near: 14, bounce: 0.2, cull: 88 },
  { p: [0, 29.5, 200], angle: 0.26, floorIrradiance: 5.6, drop: 29.5, near: 14, bounce: 0.17, cull: 88 },
]

/** how far past the floor the cone reaches; see the cutoff-window note below */
const APERTURE_RANGE_MULT = 2.2

/**
 * How many spot lights actually exist for the six apertures above, and why
 * this is a POOL rather than one light per opening.
 *
 * The naive version of this round's change — declare all six openings as six
 * lights, switch the ones in other rooms off with `visible = false`, and flip
 * `castShadow` with camera distance so only the near ones pay for a shadow
 * pass — is a trap, and worth recording because it looks like the obviously
 * correct optimisation.
 * `numSpotLights` and `numSpotLightShadows` are both PROGRAM PARAMETERS in
 * three's material cache (WebGLPrograms.getParameters), so either flag
 * changing rebuilds the shader for every material in the scene. Walking from
 * the canyon into the chamber would have hitched on a full program rebuild of
 * ~500 materials, repeatedly, in the exact places the capture harness stops to
 * take a picture.
 *
 * So the light COUNT is constant and the apertures are DATA. Two slots, both
 * casting, both 1024², reassigned each frame to the two nearest live
 * apertures — the same pattern TealPracticals and GoldPracticals have used
 * since R2, with intensity rather than visibility carrying the transition.
 * Two is exactly what the widest room needs (the canyon and the arena have
 * two openings each), so the pool never thrashes inside a room; it only
 * reassigns on a room change, and the fade takes the outgoing slot to zero
 * before it moves.
 *
 * Cost is the reason this is two and not six, and the reason the map stayed
 * at 1024. The shadow SAMPLER count is a hard limit, not a soft one: every
 * lit material binds one sampler per shadow-casting light on top of its own
 * six or seven maps, and WebGL2 only guarantees 16 fragment texture units.
 * Two aperture shadows plus the two cascades is four — exactly what the R4
 * rig already spent, at exactly the resolution it already spent it. So this
 * round buys the canyon glazing and the arena ridge real cast shadows for no
 * extra sampler, no extra pass and no extra depth-pass fill, purely by
 * letting the two passes already paid for follow the player into the room he
 * is standing in. 2048 was measured on the software renderer at +19 % frame
 * time for a texel density the primary cascade does not itself have.
 */
const APERTURE_SLOTS = 2
/** 2.3 cm/texel over the arena's 24 m pool — the same density as the primary
 *  cascade — and 1.1 cm over a canyon bay's 11 m one */
const APERTURE_MAP = 1024

const _apCam = new THREE.Vector3()
// Module-scope scratch, like the contact-blob buffers below: ApertureKeys is
// a singleton and these are pure per-frame workspace, so they are not state.
/** which aperture each slot currently serves, −1 for none */
const _apSlot = new Int32Array(APERTURE_SLOTS).fill(-1)
/** 0..1 fade, so a slot changing rooms passes through black rather than
 *  sliding a 24 m pool across the level */
const _apLevel = new Float32Array(APERTURE_SLOTS)
const _apWantIdx = new Int32Array(APERTURE_SLOTS).fill(-1)
const _apWantDist = new Float32Array(APERTURE_SLOTS).fill(Infinity)

function ApertureKeys() {
  const lights = useRef<(THREE.SpotLight | null)[]>([])
  const bounces = useRef<(THREE.PointLight | null)[]>([])

  const rig = useMemo(
    () =>
      APERTURES.map((a) => {
        const path = a.drop / Math.max(KEY_DIR.y, 0.2)
        // where the ray actually lands: the pool centre, and therefore both
        // the spot's aim point and the seat of its bounce
        const pool: [number, number, number] = [
          a.p[0] - KEY_DIR.x * path,
          a.p[1] - KEY_DIR.y * path,
          a.p[2] - KEY_DIR.z * path,
        ]
        const range = path * APERTURE_RANGE_MULT
        // three's distance cutoff is a smooth window, not a clip:
        //   falloff = d^-decay · (1 − (d/cutoff)⁴)²
        // At d = path and cutoff = 2.2·path the window term is 0.916, so the
        // authored `floorIrradiance` is delivered to within a tenth of a stop
        // and the number stays legible as an irradiance.
        const cutoffWindow = (1 - (path / range) ** 4) ** 2
        return {
          ...a,
          path,
          pool,
          intensity: (a.floorIrradiance * path) / cutoffWindow,
          range,
          /** point-light intensity for the upward bounce off the pool */
          bounceIntensity: (a.bounce ?? 0) * a.floorIrradiance,
          bounceRange: Math.max(24, path * 0.9),
          cull: a.cull ?? 70,
        }
      }),
    [],
  )

  useFrame(({ camera }, dt) => {
    _apCam.copy(camera.position)

    // --- rank the live apertures by camera distance (insertion sort into a
    //     preallocated APERTURE_SLOTS-wide buffer; nothing allocates) -----
    for (let i = 0; i < APERTURE_SLOTS; i++) {
      _apWantIdx[i] = -1
      _apWantDist[i] = Infinity
    }
    for (let f = 0; f < rig.length; f++) {
      const a = rig[f]
      const d = Math.hypot(_apCam.x - a.p[0], _apCam.y - a.p[1], _apCam.z - a.p[2])
      if (d > a.cull) continue
      for (let i = 0; i < APERTURE_SLOTS; i++) {
        if (d < _apWantDist[i]) {
          for (let j = APERTURE_SLOTS - 1; j > i; j--) {
            _apWantDist[j] = _apWantDist[j - 1]
            _apWantIdx[j] = _apWantIdx[j - 1]
          }
          _apWantDist[i] = d
          _apWantIdx[i] = f
          break
        }
      }
    }

    // --- hold what we already have, so a slot is only reassigned when the
    //     aperture it serves drops out of the wanted set -------------------
    // Crossfade rate. This is only ever exercised on a room change, where the
    // outgoing aperture is already past its own distance cutoff and therefore
    // contributing nothing — the fade exists so a slot never SLIDES a 24 m
    // pool across the level, not because the level change needs easing. 5 was
    // the first guess and it takes ~1.2 s to hand over (out, then in), which
    // is long enough that a capture harness stepping a dozen frames after a
    // teleport measures a room at a fifth of its light. 18 hands over in
    // ~0.2 s and is still ten frames at 60 Hz.
    const k = 1 - Math.exp(-18 * dt)
    for (let s = 0; s < APERTURE_SLOTS; s++) {
      let keep = false
      for (let i = 0; i < APERTURE_SLOTS; i++) {
        if (_apWantIdx[i] === _apSlot[s] && _apSlot[s] >= 0) {
          _apWantIdx[i] = -1 // claimed
          keep = true
          break
        }
      }
      _apLevel[s] = THREE.MathUtils.lerp(_apLevel[s], keep ? 1 : 0, k)
      if (!keep && _apLevel[s] < 0.06) {
        _apLevel[s] = 0
        _apSlot[s] = -1
      }
    }
    // --- free slots take the first unclaimed wanted aperture --------------
    for (let s = 0; s < APERTURE_SLOTS; s++) {
      if (_apSlot[s] >= 0) continue
      for (let i = 0; i < APERTURE_SLOTS; i++) {
        if (_apWantIdx[i] < 0) continue
        _apSlot[s] = _apWantIdx[i]
        _apWantIdx[i] = -1
        break
      }
    }

    // --- write the lights -------------------------------------------------
    for (let s = 0; s < APERTURE_SLOTS; s++) {
      const l = lights.current[s]
      const b = bounces.current[s]
      const f = _apSlot[s]
      if (f < 0) {
        if (l) l.intensity = 0
        if (b) b.intensity = 0
        continue
      }
      const a = rig[f]
      const lvl = _apLevel[s]
      if (l) {
        l.position.set(a.p[0], a.p[1], a.p[2])
        l.target.position.set(a.pool[0], a.pool[1], a.pool[2])
        l.target.updateMatrixWorld()
        l.angle = a.angle
        l.distance = a.range
        l.intensity = a.intensity * lvl
        l.userData.auricFloorIrradiance = a.floorIrradiance * lvl
        // the near plane is the whole point of the per-aperture shadow
        // tuning (see APERTURES.near) — a spot's depth buffer is hyperbolic,
        // so 1.5 → 97 spends its precision on empty air
        const near = a.near ?? 1.5
        const cam = l.shadow.camera
        if (cam.near !== near || cam.far !== a.range) {
          cam.near = near
          cam.far = a.range
          cam.updateProjectionMatrix()
        }
      }
      if (b) {
        b.position.set(a.pool[0], a.pool[1] + 1.2, a.pool[2])
        b.distance = a.bounceRange
        b.intensity = a.bounceIntensity * lvl
        b.userData.auricBounceAt1m = a.bounceIntensity * lvl
      }
    }
  })

  return (
    <>
      {Array.from({ length: APERTURE_SLOTS }).map((_, i) => (
        <spotLight
          key={i}
          ref={(r) => {
            lights.current[i] = r
          }}
          color={LIGHTING.key.color}
          intensity={0}
          angle={0.4}
          // a hole in a roof has a soft edge because the sun is not a point;
          // this is the term that stops the pool reading as a stage gobo
          penumbra={0.55}
          distance={40}
          decay={1.0}
          castShadow
          shadow-mapSize-width={APERTURE_MAP}
          shadow-mapSize-height={APERTURE_MAP}
          shadow-radius={1.4}
          shadow-camera-near={1.5}
          shadow-camera-far={40}
          shadow-bias={-0.0004}
          shadow-normalBias={0.012}
          onUpdate={(l: THREE.SpotLight) => {
            if (!l.target.parent) l.parent?.add(l.target)
            // reported separately from the key: a spot's intensity is candela
            // over a 25 m throw, so summing it with a directional light's
            // irradiance would make every ratio meaningless. The bridge reads
            // `auricFloorIrradiance` instead, which IS in the key's units.
            l.userData.auricRole = 'aperture'
            l.userData.auricFloorIrradiance = 0
            // Slot 0 is the LAST caster in the game to be shed — in a roofed
            // room it is the only source that models form, and losing it
            // returns the room to flat ambient. Slot 1 goes at tier 1 with
            // the far cascade.
            l.userData.auricShadowTier = i === 0 ? 2 : 1
          }}
        />
      ))}
      {/* ------------------------------------------------------------------
          Pool bounce. One point light seated 1.2 m over each live aperture's
          pool, in the pool's own colour, at decay 2.

          This is the term a roofed room cannot do without and the rig has
          never had. In a hall lit through a hole, the brightest surface by a
          wide margin is the patch of floor the shaft lands on, and that patch
          is what lights the walls: irradiance falls as 1/r² from the pool, so
          a wall is bright at the plinth, a stop down at head height and dark
          at the cornice. That gradient is the single cue that separates a
          photographed interior from a probe-lit one, and its absence is the
          literal reading the panel gives the arena — "tiles like wallpaper
          with no lit falloff".

          It is deliberately NOT a fill: at decay 2 it is 1/9 of its 1 m value
          at 3 m and 1/400 at 20 m, so it can never flatten the far side of
          the room the way an ambient term does. Non-casting, and it fades
          with the aperture that motivates it.
      ------------------------------------------------------------------- */}
      {Array.from({ length: APERTURE_SLOTS }).map((_, i) => (
        <pointLight
          key={`b${i}`}
          ref={(r) => {
            bounces.current[i] = r
          }}
          color={LIGHTING.key.color}
          intensity={0}
          distance={30}
          decay={2}
          onUpdate={(l: THREE.PointLight) => {
            l.userData.auricRole = 'bounce'
            // reported at 1 m, in the key's units, for the same reason the
            // aperture publishes its floor irradiance
            l.userData.auricBounceAt1m = 0
          }}
        />
      ))}
    </>
  )
}

// ---------------------------------------------------------------------------
// CHARACTER KICKERS (R5) — the pair of lights that make the figure a shape
//
// The standing complaint about the hero is that he reads squat and barrel-
// chested. Part of that is proportion and belongs to the rig, but a large
// part of it is light transport and belongs here, because of how the figure
// is currently lit: the only light dedicated to him is a point light 1.15 m
// behind the pelvis at distance 3.6. A point source that close wraps — its
// rays diverge across the body, so it lights the whole back of the torso at
// roughly even value instead of edging it, and a broad even value on a convex
// mass is exactly the cue the eye reads as BULK. It also puts its hottest
// spot on whatever surface is nearest, which on a third-person rear view is
// the middle of the back, i.e. the widest part of the silhouette.
//
// A kicker does the opposite. Put the source far enough away that its rays
// are near-parallel across a 1.8 m figure and the lit band collapses onto the
// true silhouette boundary — a constant-width edge that traces the outline of
// the helmet crest, the pauldron, the outer arm and the calf, with the core
// of the body left dark. That is the Warframe marketing look in one sentence,
// and the narrow bright edge plus a dark core reads SLIMMER than the same
// geometry lit flat, because the eye takes the lit band as the boundary.
//
// So: two spots, 7–8 m from the player, aimed at his chest, following him in
// CAMERA SPACE so the rim is always on the far side of the figure from the
// lens no matter which way he turns. Warm three-quarter back-left at full
// strength; cold back-right at a third of it, for the second, cooler edge
// that keeps the dark side from closing up. Neither casts.
//
//   - decay 1.0 with a 1.6× distance cutoff, the same convention the aperture
//     keys use, so the authored number is the irradiance actually delivered
//     at the subject rather than an opaque candela figure. The 1.6 is load-
//     bearing and the arithmetic is in the `rig` memo below: it is what makes
//     the cone die a couple of metres past him instead of painting the wall.
//   - penumbra 0.92 and an aim point at chest height: the cone continues past
//     the player and meets the deck a couple of metres beyond, and at that
//     penumbra the spill is a soft warm ellipse rather than a travelling
//     stage gobo. The ContactBlob sits inside it, so the figure gets a bright
//     ground around a dark contact — which grounds him twice over.
//   - killed while the player is dead or dissolved out, and faded out when
//     the lens is closer than ~1.6 m, where the cone would be behind the near
//     plane and the only thing it could light is the inside of the armour.
// ---------------------------------------------------------------------------
const KICKERS: {
  /** ground azimuth off the camera→player axis, rad. 0 = straight behind. */
  azim: number
  /** elevation over the ground plane, rad */
  elev: number
  /** metres from the subject */
  dist: number
  color: string
  /** irradiance delivered at the subject, in the same units as the key's */
  subject: number
  angle: number
}[] = [
  // warm three-quarter back rim — the one that draws the outline
  { azim: 0.72, elev: 0.56, dist: 8.0, color: '#FFF0D4', subject: 6.6, angle: 0.2 },
  // cold back rim on the other shoulder, a third of the warm one
  { azim: -1.0, elev: 0.44, dist: 7.0, color: LIGHTING.coolRim.color, subject: 2.3, angle: 0.22 },
]

const _kickFwd = new THREE.Vector3()
const _kickPos = new THREE.Vector3()

function CharacterKickers() {
  const lights = useRef<(THREE.SpotLight | null)[]>([])

  const rig = useMemo(
    () =>
      KICKERS.map((k) => {
        // Same cutoff-window compensation as the apertures, so `subject` is
        // the irradiance the figure actually receives — but at 1.6× rather
        // than the apertures' 2.2×, and the multiplier is the whole reason
        // this reads as a character light instead of a followspot. three's
        // cutoff is a smooth window, (1 − (d/cutoff)⁴)², so choosing where it
        // closes chooses how far past the subject the cone survives:
        //   2.2× — full value on a wall 3 m behind him (a travelling gobo)
        //   1.25× — dead 2 m past him, but 5:1 across the 1.8 m figure
        //   1.6× — 1.75:1 across the figure (under a stop, so he is evenly
        //          rimmed) and about a fifth of the key on a wall 3 m behind
        //          (reads as spill, which is what spill should read as)
        const range = k.dist * 1.6
        const cutoffWindow = (1 - (k.dist / range) ** 4) ** 2
        return { ...k, range, intensity: (k.subject * k.dist) / cutoffWindow }
      }),
    [],
  )

  useFrame(({ camera }) => {
    const p = PlayerRef.position
    const dead = PlayerRef.state === 'dead'
    // ground-plane direction from the lens to the figure; the kickers are
    // placed relative to THIS, not to the world, so the rim stays on the far
    // side of the silhouette through every turn the player makes
    _kickFwd.set(p.x - camera.position.x, 0, p.z - camera.position.z)
    const camDist = _kickFwd.length()
    if (camDist < 1e-3) _kickFwd.set(0, 0, 1)
    else _kickFwd.divideScalar(camDist)
    // under ~1.6 m the boom is inside the figure and the cone would light the
    // inside of the armour; fade rather than pop
    const near = THREE.MathUtils.smoothstep(camDist, 1.6, 3.0)
    const baseYaw = Math.atan2(_kickFwd.x, _kickFwd.z)

    for (let i = 0; i < rig.length; i++) {
      const l = lights.current[i]
      if (!l) continue
      const k = rig[i]
      // intensity, never `visible`: `numSpotLights` is a program parameter,
      // so hiding a light rebuilds every shader in the scene. Same reason the
      // aperture pool above is a pool.
      const gain = dead ? 0 : near
      l.intensity = k.intensity * gain
      if (gain <= 0.001) continue
      const yaw = baseYaw + k.azim
      const horiz = Math.cos(k.elev) * k.dist
      _kickPos.set(
        p.x + Math.sin(yaw) * horiz,
        p.y + 1.05 + Math.sin(k.elev) * k.dist,
        p.z + Math.cos(yaw) * horiz,
      )
      l.position.copy(_kickPos)
      l.target.position.set(p.x, p.y + 1.05, p.z)
      l.target.updateMatrixWorld()
    }
  })

  return (
    <>
      {rig.map((k, i) => (
        <spotLight
          key={i}
          ref={(r) => {
            lights.current[i] = r
          }}
          color={k.color}
          intensity={0}
          angle={k.angle}
          penumbra={0.92}
          distance={k.range}
          decay={1.0}
          onUpdate={(l: THREE.SpotLight) => {
            if (!l.target.parent) l.parent?.add(l.target)
            l.userData.auricRole = 'rim'
            l.userData.auricSubjectIrradiance = k.subject
          }}
        />
      ))}
    </>
  )
}

// ---------------------------------------------------------------------------
// Volumetric shafts (R3) — raymarched against the key's own shadow map
//
// The R2 shafts were 16-gon additive cylinders at a flat opacity: a hard cut
// at the floor, a hard silhouette at the cone wall, and — the tell that made
// them read as geometry rather than light — they passed straight THROUGH the
// ribs and galleries they should have been chopped by. E7 in the weakness
// register, "noise-modulated soft volumetrics", is the AAA behaviour.
//
// This is that. Each shaft renders its BACK faces, reconstructs the view ray
// in object space, analytically clips it to the cone, and marches 20 samples.
// At every sample it projects into the primary cascade's shadow map and tests
// occlusion — the exact same depth buffer that shades the walls. So the shaft
// carries the shadow of whatever is between it and the sun: a dome rib cuts a
// dark band across it, an arch crops it, a passing enemy breaks it. On top of
// that: a radial falloff so the cone has no silhouette edge, a vertical ramp
// so it dies out before the floor instead of being sliced by it, and a
// drifting 3-octave sine noise so the air has structure.
//
// Cost: 20 taps per fragment on four small, mostly off-screen cones, back
// faces only, depth-tested against the opaque scene. Nothing allocates.
// ---------------------------------------------------------------------------
/**
 * Euler that lays a Y-axis cylinder along the key direction.
 *
 * The four R3 shafts are vertical because their drops are 10–17 m, where a
 * 41.7° sun and a plumb line only disagree by a few metres. Over the arena's
 * 29.5 m drop they disagree by 20 m of floor, which is a third of the room —
 * enough for the visible shaft and the pool it is meant to explain to land in
 * different halves. So the arena shafts are tilted to the actual ray.
 */
const ARENA_SHAFT_ROT = (() => {
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), KEY_DIR)
  const e = new THREE.Euler().setFromQuaternion(q)
  return [e.x, e.y, e.z] as [number, number, number]
})()

const GOD_RAYS: {
  p: [number, number, number]
  r: [number, number, number]
  top: number
  bottom: number
  h: number
  /** additive radiance per metre of fully dense, fully lit shaft (see the
   *  knee at the end of the fragment shader — a 13 m axial path at 0.032
   *  lands near 0.25, which is a visible shaft that never pins the frame) */
  power: number
}[] = [
  { p: [0, 9, 7.5], r: [0, 0, 0], top: 1.6, bottom: 5, h: 18, power: 0.032 }, // spawn oculus
  { p: [0, 8.5, 150], r: [0, 0, 0], top: 6, bottom: 14, h: 17, power: 0.026 }, // chamber oculus
  { p: [3.4, 5.5, 60], r: [0, 0, -0.55], top: 1.6, bottom: 4.4, h: 12, power: 0.022 }, // canyon glass
  { p: [3.4, 5.5, 100], r: [0, 0, -0.55], top: 1.6, bottom: 4.4, h: 12, power: 0.022 }, // canyon glass
  // R5 — the two arena ridge slots. Unlike the four above, these are laid
  // along the key's ACTUAL travel direction rather than straight down (see
  // ARENA_SHAFT_ROT): over a 44 m throw a vertical cone and a 41.7° one
  // disagree by 20 m of floor, which would put the visible shaft and the pool
  // it is supposed to explain in different halves of the room.
  //
  // SIZE AND POWER ARE MEASURED, and the first attempt was a real regression
  // worth recording. A 30 m cone at bottom radius 12, standing 25 m from the
  // arena camera, subtends ~50° — it is not a shaft at that size, it is a
  // full-frame additive veil, and the probe read it as exactly that: every
  // one of the eight horizontal bands in the arena frame rose by ~25/255
  // together and the true-black fraction FELL from 31 % to 18 %. An additive
  // element that lifts the whole histogram is the precise opposite of this
  // axis's job. Halving the cone and cutting the power to 40 % puts the same
  // two beams in the frame at a third of the screen area they had, with the
  // knee at the end of SHAFT_FRAG capping what a glancing ray can accumulate.
  { p: [5.5, 21.1, 197], r: ARENA_SHAFT_ROT, top: 4, bottom: 8, h: 24, power: 0.0035 },
  { p: [5.5, 21.1, 207], r: ARENA_SHAFT_ROT, top: 4, bottom: 8, h: 24, power: 0.003 },
]

/**
 * 14 steps, not 20. When the camera stands inside one of the canyon shafts the
 * cone covers most of the screen, and every step is a dependent shadow-map
 * fetch — measured on the software renderer this view is the most expensive
 * frame in the game by a wide margin. The per-pixel march offset is dithered,
 * so 14 jittered samples band no more visibly than 20 aligned ones.
 */
const SHAFT_STEPS = 14

const SHAFT_VERT = /* glsl */ `
  varying vec3 vObj;
  void main() {
    vObj = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
  }
`

const SHAFT_FRAG = /* glsl */ `
  uniform sampler2D uShadow;
  /** shadow-projection matrix PREMULTIPLIED by this mesh's matrixWorld, so the
   *  march never needs modelMatrix (which three does not expose to fragment
   *  shaders) and the CPU pays for the concatenation once per frame */
  uniform mat4 uShadowFromObj;
  uniform float uHasShadow;
  uniform vec3 uCamObj;
  uniform vec3 uColor;
  uniform float uPower;
  uniform float uTopR;
  uniform float uBotR;
  uniform float uHalfH;
  uniform float uTime;
  varying vec3 vObj;

  void main() {
    vec3 ro = uCamObj;
    vec3 seg = vObj - ro;
    float segLen = length( seg );
    if ( segLen < 1e-4 ) discard;
    vec3 rd = seg / segLen;

    // clip the ray to the shaft: widest cylinder radius, then the height slab
    float R = max( uTopR, uBotR );
    float t0 = 0.0;
    float t1 = segLen;
    float a = rd.x * rd.x + rd.z * rd.z;
    float b = 2.0 * ( ro.x * rd.x + ro.z * rd.z );
    float c = ro.x * ro.x + ro.z * ro.z - R * R;
    if ( a > 1e-6 ) {
      float disc = b * b - 4.0 * a * c;
      if ( disc <= 0.0 ) discard;
      float sq = sqrt( disc );
      t0 = max( t0, ( -b - sq ) / ( 2.0 * a ) );
      t1 = min( t1, ( -b + sq ) / ( 2.0 * a ) );
    } else if ( c > 0.0 ) {
      discard;
    }
    if ( abs( rd.y ) > 1e-5 ) {
      float ta = ( -uHalfH - ro.y ) / rd.y;
      float tb = ( uHalfH - ro.y ) / rd.y;
      t0 = max( t0, min( ta, tb ) );
      t1 = min( t1, max( ta, tb ) );
    } else if ( abs( ro.y ) > uHalfH ) {
      discard;
    }
    if ( t1 <= t0 ) discard;

    float dt = ( t1 - t0 ) / float( ${SHAFT_STEPS} );
    // dither the march start so 20 steps do not band across the shaft
    float jitter = fract( sin( dot( gl_FragCoord.xy, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
    float t = t0 + dt * jitter;
    float acc = 0.0;

    for ( int i = 0; i < ${SHAFT_STEPS}; i ++ ) {
      vec3 p = ro + rd * t;
      t += dt;

      // radial soft edge — the cone has no silhouette, it just runs out
      float hN = clamp( ( p.y + uHalfH ) / ( 2.0 * uHalfH ), 0.0, 1.0 );
      float rAt = mix( uBotR, uTopR, hN );
      float rr = length( p.xz ) / max( rAt, 1e-3 );
      float radial = 1.0 - smoothstep( 0.18, 1.0, rr );
      if ( radial <= 0.001 ) continue;

      // vertical ramp: brightest where it enters, dying out before the deck,
      // so there is no hard floor cut
      float vert = smoothstep( 0.0, 0.34, hN ) * mix( 1.0, 0.35, 1.0 - hN );

      // drifting air structure. Two transcendentals, not three: this loop is
      // the hottest code in the renderer when a shaft fills the screen.
      float n = 0.62 + 0.38 * sin( p.x * 1.6 + p.y * 0.7 + uTime * 0.31 )
                            * sin( p.z * 1.9 - p.y * 0.5 - uTime * 0.24 );

      // occlusion from the KEY's own cascade — the shaft is cut by whatever
      // casts a shadow on the floor under it
      float vis = 1.0;
      if ( uHasShadow > 0.5 ) {
        vec4 sc = uShadowFromObj * vec4( p, 1.0 );
        sc.xyz /= sc.w;
        if ( sc.x > 0.0 && sc.x < 1.0 && sc.y > 0.0 && sc.y < 1.0 && sc.z < 1.0 ) {
          float d = texture2D( uShadow, sc.xy ).r;
          vis = step( sc.z - 0.0022, d );
        }
      }

      acc += radial * vert * n * vis;
    }

    // acc is now a path integral in metres of "dense, lit shaft". uPower is
    // brightness per such metre; the reciprocal knee keeps a ray fired straight
    // down the axis of the chamber shaft from blowing out while a glancing ray
    // stays linear, so the shaft has a core without having a hard edge.
    acc *= dt * uPower;
    acc = acc / ( 1.0 + acc * 1.6 );
    if ( acc <= 0.0008 ) discard;
    gl_FragColor = vec4( uColor * acc, 1.0 );
  }
`

const _shaftCam = new THREE.Vector3()
const WHITE_1X1 = (() => {
  const t = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1)
  t.needsUpdate = true
  return t
})()

function GodRays() {
  const group = useRef<THREE.Group>(null!)

  const geoms = useMemo(
    () =>
      GOD_RAYS.map((g) => new THREE.CylinderGeometry(g.top, g.bottom, g.h, 20, 1, false)),
    [],
  )

  const mats = useMemo(
    () =>
      GOD_RAYS.map(
        (g) =>
          new THREE.ShaderMaterial({
            uniforms: {
              uShadow: { value: WHITE_1X1 },
              uShadowFromObj: { value: new THREE.Matrix4() },
              uHasShadow: { value: 0 },
              uCamObj: { value: new THREE.Vector3() },
              uColor: { value: new THREE.Color(LIGHTING.key.color) },
              uPower: { value: g.power },
              uTopR: { value: g.top },
              uBotR: { value: g.bottom },
              uHalfH: { value: g.h * 0.5 },
              uTime: { value: 0 },
            },
            vertexShader: SHAFT_VERT,
            fragmentShader: SHAFT_FRAG,
            side: THREE.BackSide,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            toneMapped: false,
          }),
      ),
    [],
  )

  useFrame((state) => {
    const g = group.current
    if (!g) return
    const t = state.clock.elapsedTime
    for (let i = 0; i < mats.length; i++) {
      const mesh = g.children[i] as THREE.Mesh
      if (!mesh) continue
      const u = mats[i].uniforms
      _shaftCam.copy(state.camera.position)
      mesh.worldToLocal(_shaftCam)
      ;(u.uCamObj.value as THREE.Vector3).copy(_shaftCam)
      u.uTime.value = t
      // --- camera-inside fade.
      // Back-face rendering means that when the camera walks into a shaft the
      // cone covers the whole screen, and every pixel then runs the full
      // march: measured on the software renderer, standing inside the z=100
      // canyon shaft made that the most expensive frame in the game by an
      // order of magnitude. It is also wrong to look at — you do not see a
      // beam you are standing inside, you see the light on your own armour.
      // So the shaft fades out as the camera enters its radius. Free on the
      // GPU (one uniform), and it removes the worst case entirely.
      const gr = GOD_RAYS[i]
      const rMax = Math.max(gr.top, gr.bottom)
      const inSlab = Math.abs(_shaftCam.y) < gr.h * 0.5 + 1
      const radial = Math.hypot(_shaftCam.x, _shaftCam.z) / rMax
      const insideFade = inSlab ? THREE.MathUtils.smoothstep(radial, 0.5, 1.3) : 1
      if (PrimaryShadow.map) {
        u.uShadow.value = PrimaryShadow.map
        ;(u.uShadowFromObj.value as THREE.Matrix4).multiplyMatrices(
          PrimaryShadow.matrix,
          mesh.matrixWorld,
        )
        u.uHasShadow.value = 1
      } else {
        u.uShadow.value = WHITE_1X1
        u.uHasShadow.value = 0
      }
      // slow breathing, ±14 %, 6 s period, offset per shaft
      u.uPower.value =
        gr.power * (1 + 0.14 * Math.sin((t * Math.PI * 2) / 6 + i * 1.7)) * insideFade
      // a fully faded shaft is not drawn at all
      mesh.visible = insideFade > 0.004
    }
  })

  return (
    <group ref={group}>
      {GOD_RAYS.map((g, i) => (
        <mesh
          key={i}
          geometry={geoms[i]}
          material={mats[i]}
          position={g.p}
          rotation={g.r}
          renderOrder={8}
        />
      ))}
    </group>
  )
}

// ---------------------------------------------------------------------------
// Dust motes — 600 additive points following the camera in a 40 m wrap box
// ---------------------------------------------------------------------------
const DUST_COUNT = LIGHTING.dustCount
const DUST_BOX = 40

function DustField() {
  const group = useRef<THREE.Group>(null!)
  const geom = useMemo(() => {
    const g = new THREE.BufferGeometry()
    const pos = new Float32Array(DUST_COUNT * 3)
    for (let i = 0; i < DUST_COUNT * 3; i++) pos[i] = (Math.random() - 0.5) * DUST_BOX
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    return g
  }, [])

  useFrame((state, dt) => {
    group.current.position.copy(state.camera.position)
    const pos = geom.attributes.position as THREE.BufferAttribute
    const arr = pos.array as Float32Array
    const half = DUST_BOX / 2
    for (let i = 0; i < DUST_COUNT; i++) {
      arr[i * 3 + 1] += dt * 0.25 // slow upward drift
      if (arr[i * 3 + 1] > half) arr[i * 3 + 1] -= DUST_BOX
    }
    pos.needsUpdate = true
  })

  return (
    <group ref={group}>
      <points geometry={geom} frustumCulled={false}>
        <pointsMaterial
          color={LIGHTING.key.color}
          size={0.035}
          sizeAttenuation
          transparent
          opacity={0.16}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </points>
    </group>
  )
}

// ---------------------------------------------------------------------------
// Unconditional contact shadows (work order env-art #2)
//
// The cascade shadows are back (the R2 diagnosis found the maps were fine and
// almost nothing was flagged `receiveShadow`), but a character still needs a
// hard contact AO patch directly under it: a cascade's softest PCF tap is
// wider than the gap between a boot and the deck, and on quality tier 1 the
// key stops casting entirely. So every ground entity also gets a projected
// blob, drawn as one InstancedMesh of horizontal quads with a per-instance
// strength attribute.
//
// Cost: one draw call, one throttled raycast per frame (round-robin over the
// slots), zero allocation in the frame loop.
// ---------------------------------------------------------------------------
const BLOB_SLOTS = 10
const _blobM = new THREE.Matrix4()
/**
 * R3 — the blob is no longer a circle centred under the caster. The key sits
 * at 41° elevation, so a real contact shadow is an ellipse stretched 1/sin(41°)
 * ≈ 1.5× along the key's ground azimuth, and it slides AWAY from the caster as
 * the caster leaves the ground. A circle pinned under the feet is the tell that
 * says "blob shadow"; these three lines are what make it read as the same light
 * everything else is lit by.
 *
 * Rotation: Euler('XYZ') composes Rx·Ry·Rz, so Euler(-90°, 0, roll) rolls the
 * quad in its own plane first and then lays it flat. Under Rx(-90) local +X
 * maps to world +X and local +Y to world −Z, hence roll = −atan2(dz, dx).
 */
const KEY_GROUND = new THREE.Vector2(-KEY_DIR.x, -KEY_DIR.z).normalize()
/** horizontal distance a shadow travels per metre of altitude, at the key's elevation */
const KEY_SLIDE = Math.sqrt(1 - KEY_DIR.y * KEY_DIR.y) / Math.max(KEY_DIR.y, 1e-3)
/** long/short axis ratio of a sphere's shadow at the key's elevation */
const KEY_STRETCH = 1 / Math.max(KEY_DIR.y, 0.25)
const _blobQ = new THREE.Quaternion().setFromEuler(
  new THREE.Euler(-Math.PI / 2, 0, -Math.atan2(KEY_GROUND.y, KEY_GROUND.x)),
)
const _blobP = new THREE.Vector3()
const _blobS = new THREE.Vector3()
const _blobOrigin = new THREE.Vector3()
const _blobDown = new THREE.Vector3(0, -1, 0)
/** how far below an entity we look for a floor before giving up */
const BLOB_PROBE = 7
/** per-slot scratch, module scope so the frame loop allocates nothing */
const _blobX = new Float32Array(BLOB_SLOTS)
const _blobY = new Float32Array(BLOB_SLOTS)
const _blobZ = new Float32Array(BLOB_SLOTS)
const _blobR = new Float32Array(BLOB_SLOTS)
const _blobA = new Float32Array(BLOB_SLOTS)

function ContactBlobs() {
  const mesh = useRef<THREE.InstancedMesh>(null!)
  /** last known ground height per slot; probed round-robin */
  const groundY = useMemo(() => new Float32Array(BLOB_SLOTS).fill(-999), [])
  const probeCursor = useRef(0)

  const geom = useMemo(() => {
    const g = new THREE.PlaneGeometry(1, 1)
    g.setAttribute(
      'aStrength',
      new THREE.InstancedBufferAttribute(new Float32Array(BLOB_SLOTS), 1),
    )
    return g
  }, [])

  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uMap: { value: getContactBlobTexture() } },
        vertexShader: /* glsl */ `
          attribute float aStrength;
          varying vec2 vUv;
          varying float vS;
          void main() {
            vUv = uv;
            vS = aStrength;
            gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform sampler2D uMap;
          varying vec2 vUv;
          varying float vS;
          void main() {
            float a = texture2D(uMap, vUv).a * vS;
            if (a <= 0.004) discard;
            gl_FragColor = vec4(0.0, 0.0, 0.0, a);
          }
        `,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
        toneMapped: false,
      }),
    [],
  )

  useFrame(() => {
    const m = mesh.current
    if (!m) return
    const strength = geom.getAttribute('aStrength') as THREE.InstancedBufferAttribute
    const arr = strength.array as Float32Array

    // --- gather: slot 0 is always the player, 1..n the live enemies.
    //     Written into preallocated scratch arrays; no closure, no object and
    //     no array is created per frame.
    let slot = 0
    _blobX[slot] = PlayerRef.position.x
    _blobY[slot] = PlayerRef.position.y
    _blobZ[slot] = PlayerRef.position.z
    _blobR[slot] = PlayerRef.radius
    _blobA[slot] = 0.82
    slot++
    const enemies = EnemyRegistry.list()
    for (let i = 0; i < enemies.length && slot < BLOB_SLOTS; i++) {
      const e = enemies[i]
      if (!e.alive) continue
      _blobX[slot] = e.position.x
      // ground units report feet, drones report body centre — the airborne
      // fade below handles the difference without a per-type branch
      _blobY[slot] = e.position.y
      _blobZ[slot] = e.position.z
      _blobR[slot] = e.radius
      _blobA[slot] = 0.7
      slot++
    }

    // --- resolve: one floor probe per frame, round-robin over the slots, so
    //     the level raycast cost is fixed no matter how many enemies are alive
    const probe = probeCursor.current % BLOB_SLOTS
    for (let i = 0; i < slot; i++) {
      const feetY = _blobY[i]
      if (i === probe || groundY[i] < -900) {
        _blobOrigin.set(_blobX[i], feetY + 0.6, _blobZ[i])
        const hit = raycastLevel(_blobOrigin, _blobDown, BLOB_PROBE, ['floor'])
        groundY[i] = hit ? hit.point.y : feetY
      }
      const gy = groundY[i]
      const air = Math.max(0, feetY - gy)
      // a shadow spreads and fades as its caster leaves the ground
      const fade = 1 - THREE.MathUtils.smoothstep(air, 0.05, 3.2)
      const spread = 1 + Math.min(air, 3.2) * 0.42
      const size = _blobR[i] * 4.6 * spread
      // the shadow slides down-key as the caster rises, exactly as the cast
      // shadow from the key does, so the two agree where both are present
      const slide = Math.min(air, 3.2) * KEY_SLIDE
      _blobP.set(_blobX[i] + KEY_GROUND.x * slide, gy + 0.025, _blobZ[i] + KEY_GROUND.y * slide)
      _blobS.set(size * KEY_STRETCH, size, 1)
      _blobM.compose(_blobP, _blobQ, _blobS)
      m.setMatrixAt(i, _blobM)
      arr[i] = _blobA[i] * fade
    }
    // park unused slots
    for (let i = slot; i < BLOB_SLOTS; i++) arr[i] = 0

    probeCursor.current++
    strength.needsUpdate = true
    m.instanceMatrix.needsUpdate = true
  })

  return (
    <instancedMesh
      ref={mesh}
      args={[geom, mat, BLOB_SLOTS]}
      frustumCulled={false}
      renderOrder={2}
    />
  )
}

// ---------------------------------------------------------------------------
// Camera-side fill — weak warm directional that rides behind/above the camera
// so faces pointing at the player never crush to black. No shadows.
// ---------------------------------------------------------------------------
const _fillFwd = new THREE.Vector3()
const _fillPos = new THREE.Vector3()
const _fillTgt = new THREE.Vector3()

function CameraFill() {
  const light = useRef<THREE.DirectionalLight>(null!)
  useFrame(({ camera }) => {
    const l = light.current
    if (!l) return
    camera.getWorldDirection(_fillFwd)
    _fillPos.copy(camera.position).addScaledVector(_fillFwd, -18)
    _fillPos.y += 10
    l.position.copy(_fillPos)
    _fillTgt.copy(camera.position).addScaledVector(_fillFwd, 24)
    l.target.position.copy(_fillTgt)
    l.target.updateMatrixWorld()
  })
  return (
    <directionalLight
      ref={light}
      color={LIGHTING.cameraFill.color}
      intensity={LIGHTING.cameraFill.intensity * CAMERA_FILL_GAIN}
      onUpdate={(l: THREE.DirectionalLight) => {
        if (!l.target.parent) l.parent?.add(l.target)
      }}
    />
  )
}

// ---------------------------------------------------------------------------
// Near shadow cascade — a tight ortho that follows the camera, texel-snapped
// ---------------------------------------------------------------------------
const _focus = new THREE.Vector3()
const _camFwd = new THREE.Vector3()

function KeyCascade() {
  const light = useRef<THREE.DirectionalLight>(null!)
  const near = CASCADE.primary

  useFrame(({ camera }) => {
    const l = light.current
    if (!l) return
    camera.getWorldDirection(_camFwd)
    // bias the shadow box ahead of the camera — that is where the player and
    // the geometry they are about to run into live
    _focus.copy(camera.position).addScaledVector(_camFwd, near.extent * 0.4)
    _focus.y = Math.max(_focus.y, 0)
    // snap to the shadow-map texel grid so edges stop crawling as we move
    const texel = (near.extent * 2) / near.mapSize
    _focus.x = Math.round(_focus.x / texel) * texel
    _focus.y = Math.round(_focus.y / texel) * texel
    _focus.z = Math.round(_focus.z / texel) * texel
    l.position.copy(_focus).add(KEY_OFFSET)
    l.target.position.copy(_focus)
    l.target.updateMatrixWorld()
    // publish the depth map the volumetric shafts march through. `shadow.map`
    // exists only after the first shadow pass, and `shadow.matrix` is the
    // world→[0,1] projection three itself shades with, so the shafts and the
    // surfaces cannot disagree about what is occluded.
    PrimaryShadow.map = l.castShadow ? (l.shadow.map?.depthTexture ?? null) : null
    PrimaryShadow.matrix.copy(l.shadow.matrix)
  })

  return (
    <directionalLight
      ref={light}
      color={LIGHTING.key.color}
      intensity={LIGHTING.key.intensity * near.share * KEY_GAIN}
      castShadow
      shadow-mapSize-width={near.mapSize}
      shadow-mapSize-height={near.mapSize}
      shadow-radius={near.radius}
      shadow-camera-near={1}
      shadow-camera-far={300}
      shadow-camera-left={-near.extent}
      shadow-camera-right={near.extent}
      shadow-camera-top={near.extent}
      shadow-camera-bottom={-near.extent}
      shadow-bias={near.bias}
      shadow-normalBias={near.normalBias}
      onUpdate={(l: THREE.DirectionalLight) => {
        if (!l.target.parent) l.parent?.add(l.target)
        l.userData.auricRole = 'key'
        // the last caster to be switched off: everything the player can see
        // is shadowed by this one light
        l.userData.auricShadowTier = 2
      }}
    />
  )
}

// ---------------------------------------------------------------------------
// Teal practicals — nearest 4 modelled vein fixtures, pulse-locked to the
// strips they belong to (EnvironmentFX drives the same 2.4 rad/s curve).
// ---------------------------------------------------------------------------
const PRACTICAL_COUNT = 4

function TealPracticals() {
  const lights = useRef<(THREE.PointLight | null)[]>([])
  // preallocated selection buffers — nothing allocates in the frame loop
  const bestIdx = useMemo(() => new Int32Array(PRACTICAL_COUNT), [])
  const bestDist = useMemo(() => new Float32Array(PRACTICAL_COUNT), [])

  useFrame((state, dt) => {
    const cam = state.camera.position
    for (let i = 0; i < PRACTICAL_COUNT; i++) {
      bestIdx[i] = -1
      bestDist[i] = Infinity
    }
    for (let f = 0; f < TEAL_FIXTURES.length; f++) {
      const p = TEAL_FIXTURES[f]
      const dx = p[0] - cam.x
      const dy = p[1] - cam.y
      const dz = p[2] - cam.z
      const d2 = dx * dx + dy * dy + dz * dz
      if (d2 > 900) continue // 30 m cull
      for (let i = 0; i < PRACTICAL_COUNT; i++) {
        if (d2 < bestDist[i]) {
          for (let j = PRACTICAL_COUNT - 1; j > i; j--) {
            bestDist[j] = bestDist[j - 1]
            bestIdx[j] = bestIdx[j - 1]
          }
          bestDist[i] = d2
          bestIdx[i] = f
          break
        }
      }
    }
    // exactly the curve EnvironmentFX drives the strips with, so fixture and
    // light breathe together instead of drifting apart
    const pulse = 0.82 + 0.18 * Math.sin(state.clock.elapsedTime * 2.4)
    const k = 1 - Math.exp(-8 * dt)
    for (let i = 0; i < PRACTICAL_COUNT; i++) {
      const l = lights.current[i]
      if (!l) continue
      const f = bestIdx[i]
      if (f < 0) {
        l.intensity = THREE.MathUtils.lerp(l.intensity, 0, k)
        continue
      }
      const p = TEAL_FIXTURES[f]
      l.position.set(p[0], p[1], p[2])
      l.intensity = LIGHTING.tealPractical.intensity * PRACTICAL_GAIN * pulse
    }
  })

  return (
    <group>
      {Array.from({ length: PRACTICAL_COUNT }).map((_, i) => (
        <pointLight
          key={i}
          ref={(r) => {
            lights.current[i] = r
          }}
          color={LIGHTING.tealPractical.color}
          intensity={0}
          distance={LIGHTING.tealPractical.distance}
          decay={LIGHTING.tealPractical.decay}
        />
      ))}
    </group>
  )
}

// ---------------------------------------------------------------------------
// Procedural HDR probe (R3)
//
// R2 built the probe out of nine drei <Lightformer> rects. That gets you a
// room made of grey panels: the brightest thing in it was intensity 12 spread
// over a 0.85 × 14 rect, which after PMREM is a smear, not a highlight. Metal
// reflects a highlight. Specifically it reflects a SMALL, VERY BRIGHT thing
// and a LOT OF NEAR-BLACK, and the ratio between them is what the eye reads as
// "polished". A 12:0.14 probe is a ratio of 85; a real sun against a night sky
// is a ratio in the tens of thousands.
//
// So the probe is authored directly as a float equirect and PMREM'd once at
// boot. What is in it:
//   - a 3°-wide SUN DISC at radiance 46, placed exactly at KEY_DIR, so the
//     specular hot spot on every gold bevel sits on the same side as the
//     shadow the key throws. Nothing else in the frame makes gold read as
//     metal this cheaply: it is ~0.002 sr, so it adds ~0.03 to irradiance —
//     it is a highlight, not a fill. This is the solid-angle argument R2 made
//     for the narrow bar, taken to its conclusion.
//   - a narrow cool bar ~100° off, for the second ramp across a curve.
//   - an ANTI-KEY CRUSH: the hemisphere away from the sun is multiplied down
//     to 0.16, so a curved gold surface always has somewhere black to reflect.
//     Without a black in the probe, gold is painted plastic from every angle.
//   - a warm horizon band biased to the sun azimuth, a near-black ground, and
//     the SKY palette gradient so upward faces pick up the actual backdrop.
//   - a trace of gold bounce west / corruption teal east, at the level of a
//     tint rather than a light.
// ---------------------------------------------------------------------------
/** MATERIALS.envMapResolution still sizes the probe — it is now the width of
 *  the authored equirect rather than a drei cube render target. At 1024 a
 *  texel is 0.35°, so the 3° sun disc survives as a disc through PMREM's
 *  mip 0 instead of being pre-blurred into a smear. */
const ENV_W = MATERIALS.envMapResolution
const ENV_H = MATERIALS.envMapResolution / 2
/**
 * Overall probe gain.
 *
 * R4: 0.82 → 0.26, and this is the second half of the aperture fix above.
 * `scene.environmentIntensity` scales the probe's DIFFUSE irradiance and its
 * specular together, and at 0.82 an IBL built from a sky gradient is a large,
 * perfectly directionless ambient term applied to all 1328 meshes. It was the
 * dominant diffuse contributor in every interior, which is why the interiors
 * read as one flat value and why `keyOverFill` measured 0.041.
 *
 * Cutting the gain would normally cost gold its reflection, so the probe's
 * CONTRAST is raised by the same argument in the opposite direction: the sun
 * disc and the specular bar are multiplied up (they occupy ~0.002 sr, so they
 * move the highlight without moving the ambient) and the anti-key hemisphere
 * is crushed from 0.16 to 0.05. Net effect on a polished gold bevel: the
 * bright end of its reflection ramp is roughly where it was, the dark end is
 * three times darker, and the flat fill underneath is a third of what it was.
 *
 * R5: 0.26 → 0.20. Same argument one more turn of the crank, and it is only
 * available because the arena finally has a motivated source of its own (see
 * APERTURES). Until this round the arena had NO placed light at all, so the
 * probe was not merely the dominant diffuse term in that room, it was the
 * only one — which is why its 60 m walls carry one flat value from plinth to
 * cornice and why nothing in 08_enemies or 18_arena_wide casts a shadow you
 * can point at. With two ridge-slot keys and their pool bounce carrying the
 * room, the probe can go back to being what an IBL is for: the colour of the
 * sky in a reflection, and a floor under the darks.
 */
const ENV_INTENSITY = 0.2
/** compensating gain on the probe's narrow, high-radiance features.
 *  R5: 2.9 → 3.7, which is exactly the 0.26/0.20 ratio applied to the sun
 *  disc and the specular bars, so cutting the diffuse costs gold nothing at
 *  the highlight — `scene.environmentIntensity` scales diffuse and specular
 *  together, and these two terms occupy ~0.002 sr between them. */
const ENV_SPEC_GAIN = 3.7

function smoothstep01(e0: number, e1: number, x: number) {
  const t = THREE.MathUtils.clamp((x - e0) / (e1 - e0), 0, 1)
  return t * t * (3 - 2 * t)
}

function buildEnvEquirect(): THREE.DataTexture {
  const data = new Float32Array(ENV_W * ENV_H * 4)
  // THREE.Color parses sRGB hex into the linear working space, which is the
  // space PMREM wants, so these components go straight into the buffer.
  const zenith = new THREE.Color(SKY.zenith)
  const horizon = new THREE.Color(SKY.horizon)
  const voidC = new THREE.Color(SKY.voidTint)
  const warm = new THREE.Color(LIGHTING.key.color)
  const cool = new THREE.Color(LIGHTING.coolRim.color)
  const gold = new THREE.Color(COLORS.regalGold)
  const teal = new THREE.Color(COLORS.cadenceTeal)

  // second specular bar: roughly 100° off the key, low and to the east
  const bar = new THREE.Vector3(0.93, 0.26, 0.26).normalize()
  const discInner = Math.cos(0.026) // ~1.5° half-angle, full radiance
  const discOuter = Math.cos(0.052) // ~3.0° half-angle, limb

  for (let y = 0; y < ENV_H; y++) {
    const v = (y + 0.5) / ENV_H
    const theta = (v - 0.5) * Math.PI
    const dy = Math.sin(theta)
    const rxz = Math.cos(theta)
    for (let x = 0; x < ENV_W; x++) {
      const u = (x + 0.5) / ENV_W
      const phi = (u - 0.5) * Math.PI * 2
      const dx = rxz * Math.cos(phi)
      const dz = rxz * Math.sin(phi)

      let r: number
      let g: number
      let b: number
      if (dy >= 0) {
        // sky: horizon → zenith, biased so most of the dome is the darker value
        const t = Math.pow(dy, 0.55)
        r = horizon.r * (1 - t) + zenith.r * t
        g = horizon.g * (1 - t) + zenith.g * t
        b = horizon.b * (1 - t) + zenith.b * t
      } else {
        // ground: the station is a void platform, nothing bounces up
        const t = Math.min(1, -dy / 0.35)
        r = horizon.r * 0.14 * (1 - t) + voidC.r * t
        g = horizon.g * 0.14 * (1 - t) + voidC.g * t
        b = horizon.b * 0.14 * (1 - t) + voidC.b * t
      }

      const sd = dx * KEY_DIR.x + dy * KEY_DIR.y + dz * KEY_DIR.z

      // crush the anti-key hemisphere so every specular ramp has a dark end
      // R4: floor 0.16 → 0.05. A gold surface needs somewhere genuinely black
      // to reflect or it is painted plastic from every angle; this is also the
      // largest single reduction in the probe's diffuse irradiance.
      const occl = 0.05 + 0.95 * smoothstep01(-0.55, 0.4, sd)
      r *= occl
      g *= occl
      b *= occl

      // warm horizon band, strongest toward the sun azimuth
      const band = Math.exp(-((dy / 0.085) ** 2)) * Math.max(0, sd) * 0.8
      r += warm.r * band
      g += warm.g * band
      b += warm.b * band

      // the sun disc + its glow — narrow solid angle, enormous radiance
      const disc = smoothstep01(discOuter, discInner, sd) * 46 * ENV_SPEC_GAIN
      const glow = Math.pow(Math.max(sd, 0), 240) * 3.4 * ENV_SPEC_GAIN
      const sun = disc + glow
      r += warm.r * sun
      g += warm.g * sun
      b += warm.b * sun

      // second, cooler specular bar for the far side of a curve
      const bd = dx * bar.x + dy * bar.y + dz * bar.z
      const bar2 = Math.pow(Math.max(bd, 0), 700) * 6.5 * ENV_SPEC_GAIN
      r += cool.r * bar2
      g += cool.g * bar2
      b += cool.b * bar2

      // level-colour bounce: gold shrine west, a trace of corruption east
      const gw = Math.pow(Math.max(-dx, 0), 3) * Math.max(0, 1 - Math.abs(dy) * 2) * 0.09
      const te = Math.pow(Math.max(dx, 0), 3) * Math.max(0, 1 - Math.abs(dy) * 2) * 0.04
      r += gold.r * gw + teal.r * te
      g += gold.g * gw + teal.g * te
      b += gold.b * gw + teal.b * te

      const i = (y * ENV_W + x) * 4
      data[i] = r
      data[i + 1] = g
      data[i + 2] = b
      data[i + 3] = 1
    }
  }

  const tex = new THREE.DataTexture(data, ENV_W, ENV_H, THREE.RGBAFormat, THREE.FloatType)
  tex.mapping = THREE.EquirectangularReflectionMapping
  tex.minFilter = THREE.LinearFilter
  tex.magFilter = THREE.LinearFilter
  tex.colorSpace = THREE.LinearSRGBColorSpace
  tex.needsUpdate = true
  return tex
}

function ProceduralEnvironment() {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl)
    pmrem.compileEquirectangularShader()
    const src = buildEnvEquirect()
    const rt = pmrem.fromEquirectangular(src)
    scene.environment = rt.texture
    scene.environmentIntensity = ENV_INTENSITY
    src.dispose()
    pmrem.dispose()
    return () => {
      if (scene.environment === rt.texture) scene.environment = null
      rt.dispose()
    }
  }, [gl, scene])
  return null
}

// ---------------------------------------------------------------------------
// Gold practicals — the architectural fixtures the R2 colour script created
// and nobody lit (LIGHTING.goldPractical existed, GOLD_FIXTURES was exported,
// and no light ever read it). Canyon bays, wall-run slab veins, arena
// perimeter sconces, megalith under-glow and the arena medallion all have
// modelled emissive fixtures; these put a light AT each one so the fixture
// throws a pool instead of being a glowing sticker on a flatly lit wall.
//
// Nearest 5 by camera distance, 34 m cull, one shared irregular flicker so
// the pools breathe out of phase with the teal corruption.
// ---------------------------------------------------------------------------
const GOLD_COUNT = 5

function GoldPracticals() {
  const lights = useRef<(THREE.PointLight | null)[]>([])
  const bestIdx = useMemo(() => new Int32Array(GOLD_COUNT), [])
  const bestDist = useMemo(() => new Float32Array(GOLD_COUNT), [])

  useFrame((state, dt) => {
    const cam = state.camera.position
    for (let i = 0; i < GOLD_COUNT; i++) {
      bestIdx[i] = -1
      bestDist[i] = Infinity
    }
    for (let f = 0; f < GOLD_FIXTURES.length; f++) {
      const p = GOLD_FIXTURES[f]
      const dx = p[0] - cam.x
      const dy = p[1] - cam.y
      const dz = p[2] - cam.z
      const d2 = dx * dx + dy * dy + dz * dz
      if (d2 > 1156) continue // 34 m cull
      for (let i = 0; i < GOLD_COUNT; i++) {
        if (d2 < bestDist[i]) {
          for (let j = GOLD_COUNT - 1; j > i; j--) {
            bestDist[j] = bestDist[j - 1]
            bestIdx[j] = bestIdx[j - 1]
          }
          bestDist[i] = d2
          bestIdx[i] = f
          break
        }
      }
    }
    const t = state.clock.elapsedTime
    const k = 1 - Math.exp(-9 * dt)
    for (let i = 0; i < GOLD_COUNT; i++) {
      const l = lights.current[i]
      if (!l) continue
      const f = bestIdx[i]
      if (f < 0) {
        l.intensity = THREE.MathUtils.lerp(l.intensity, 0, k)
        continue
      }
      const p = GOLD_FIXTURES[f]
      l.position.set(p[0], p[1], p[2])
      // two detuned sines: a fixture flame, not a pulse generator
      const flicker = 0.9 + 0.07 * Math.sin(t * 1.7 + f * 2.1) + 0.03 * Math.sin(t * 4.3 + f)
      l.intensity = THREE.MathUtils.lerp(
        l.intensity,
        LIGHTING.goldPractical.intensity * PRACTICAL_GAIN * flicker,
        k,
      )
    }
  })

  return (
    <group>
      {Array.from({ length: GOLD_COUNT }).map((_, i) => (
        <pointLight
          key={i}
          ref={(r) => {
            lights.current[i] = r
          }}
          color={LIGHTING.goldPractical.color}
          intensity={0}
          distance={LIGHTING.goldPractical.distance}
          decay={LIGHTING.goldPractical.decay}
        />
      ))}
    </group>
  )
}

export default function Lighting() {
  const far = CASCADE.far

  return (
    <group>
      {/* procedural HDR probe (design §2.4) — a real sun disc at KEY_DIR over
          a crushed anti-key hemisphere. See buildEnvEquirect above for why the
          nine-lightformer room it replaces could not make gold read as metal. */}
      <ProceduralEnvironment />

      {/* 1a — the key. One dominant cascade, 0.86 of the light in the scene,
          following the camera and texel-snapped. */}
      <KeyCascade />

      {/* 1c — APERTURE KEYS. The key cannot reach a roofed interior, so the
          interiors get the openings the key comes through instead: shadow-
          casting spots at the two oculi and the canyon glazing, aimed along
          the key's own travel direction and in its colour, each laying a hot,
          off-centre, rib-cut pool on the floor below. See APERTURES above for
          the measurement that made this the round's main change. */}
      <ApertureKeys />

      {/* 1b — aligned sky bounce: same direction, whole-level ortho, 0.14 of
          the key and tinted toward the sky so the fraction it leaks past the
          primary cascade's box reads as directional ambient rather than as a
          second sun. Its shadow still catches domes, megaliths and monoliths
          at long range. */}
      <directionalLight
        /* exactly parallel to the primary cascade — the old `+20` on Y tilted
           this one a few degrees off, which was invisible while nothing
           received shadows and would now show as a kink at the cascade
           boundary where the two shadow directions disagree */
        position={[KEY_OFFSET.x * 1.6, KEY_OFFSET.y * 1.6, KEY_OFFSET.z * 1.6 + 130]}
        color={FAR_TINT}
        intensity={LIGHTING.key.intensity * far.share}
        castShadow
        shadow-mapSize-width={far.mapSize}
        shadow-mapSize-height={far.mapSize}
        shadow-radius={far.radius}
        shadow-camera-near={1}
        shadow-camera-far={520}
        shadow-camera-left={-far.extent}
        shadow-camera-right={far.extent}
        shadow-camera-top={far.extent}
        shadow-camera-bottom={-far.extent}
        shadow-bias={far.bias}
        shadow-normalBias={far.normalBias}
        onUpdate={(l: THREE.DirectionalLight) => {
          l.target.position.set(0, 0, 130)
          l.target.updateMatrixWorld()
          if (!l.target.parent) l.parent?.add(l.target)
          l.userData.auricRole = 'key'
          // first thing to stop casting when the fps window misses
          l.userData.auricShadowTier = 1
        }}
      />

      {/* 2 — cool indigo hemisphere fill. At 0.12 against a 3.78 key this is
          not a light, it is the colour the shadow side is allowed to be. */}
      <hemisphereLight
        args={[
          LIGHTING.hemisphere.skyColor,
          LIGHTING.hemisphere.groundColor,
          LIGHTING.hemisphere.intensity * HEMI_GAIN,
        ]}
      />

      {/* camera-side warm fill + halved cool rim, re-aimed across the axis so
          it separates silhouettes instead of back-lighting the whole level */}
      <CameraFill />
      <directionalLight
        position={[70, 34, 210]}
        color={LIGHTING.coolRim.color}
        intensity={LIGHTING.coolRim.intensity}
        onUpdate={(l: THREE.DirectionalLight) => {
          l.target.position.set(-10, 2, 140)
          l.target.updateMatrixWorld()
          if (!l.target.parent) l.parent?.add(l.target)
        }}
      />

      {/* 3–8 — teal practicals, nearest 4 modelled vein fixtures (corruption) */}
      <TealPracticals />

      {/* 1d — CHARACTER KICKERS. A far, near-parallel warm back-three-quarter
          rim plus a cold counter-rim, both following the figure in camera
          space. See KICKERS above: the close point light the rig carries
          wraps the torso and reads as bulk; a distant kicker collapses onto
          the silhouette boundary and reads as edge. This is the light-transport
          half of the "reads squat and barrel-chested" note. */}
      <CharacterKickers />

      {/* 3b — gold architectural practicals, nearest 5 modelled fixtures.
          GOLD_FIXTURES has been exported since the R2 colour script and no
          light ever read it, so every aureate bay, sconce, slab vein and
          megalith under-plate was a glowing sticker throwing no pool. */}
      <GoldPracticals />

      {/* 11 — the R3 chamber oculus spot is RETIRED. It sat at (0,24,150) with
          intensity 4, distance 60 and decay 1.5, which delivers 4/24^1.5 =
          0.034 irradiance on the chamber floor 24 m below — three orders of
          magnitude under the key, i.e. nothing at all, while still paying for
          a 1024² shadow pass every frame. Its job (a second, harder-edged
          source in the hero room) is now done properly by the chamber entry in
          APERTURES, which is sized from the throw distance instead of guessed. */}

      {/* unconditional contact shadows under the player and every enemy —
          survives the quality tier where key shadow casting is switched off */}
      <ContactBlobs />

      <GodRays />
      <DustField />
    </group>
  )
}

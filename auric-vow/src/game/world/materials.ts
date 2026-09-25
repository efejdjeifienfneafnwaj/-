/**
 * AURIC VOW — world/materials.ts
 * Shared material singletons (design.md §2.4). Emissive/energy materials are
 * mutated per-frame by EnvironmentFX (vein pulse, teal→gold purification,
 * medallion wave pulse), so they must be shared instances — never recreated
 * per mesh.
 */
import * as THREE from 'three'
import { MATERIALS, COLORS } from '../config'
import {
  getGlyphSpriteTexture,
  getOrokinNormalTexture,
  getOrokinAOTexture,
  getOrokinRoughnessTexture,
  getBrushedGoldRoughnessTexture,
  getBrushedGoldNormalTexture,
  getDetailNormalTexture,
  getPiercedScreenTexture,
  getCofferAlphaTexture,
  getFretBandTexture,
  getStripFalloffTexture,
  getOrokinAlbedoTexture,
  getMacroVariationTexture,
  getMacroMean,
  getGoldAlbedoTexture,
  getGoldORMTexture,
  getOrokinHeightTexture,
  getWeatherTexture,
  getGrowthTextures,
} from '../textures'

let ivory: THREE.MeshStandardMaterial | null = null
let gold: THREE.MeshStandardMaterial | null = null
let obsidian: THREE.MeshStandardMaterial | null = null
let rock: THREE.MeshStandardMaterial | null = null
let glass: THREE.MeshBasicMaterial | null = null
let veinTeal: THREE.MeshBasicMaterial | null = null
let veinGold: THREE.MeshBasicMaterial | null = null
let purifyVein: THREE.MeshBasicMaterial | null = null
let medallion: THREE.MeshBasicMaterial | null = null
let doorGlow: THREE.MeshBasicMaterial | null = null
let seal: THREE.MeshBasicMaterial | null = null
let glyphDecal: THREE.MeshBasicMaterial | null = null
let banner: THREE.ShaderMaterial | null = null
let rockVeinTex: THREE.CanvasTexture | null = null
let ivoryContact: THREE.MeshStandardMaterial | null = null
let goldPolished: THREE.MeshStandardMaterial | null = null
let goldCast: THREE.MeshStandardMaterial | null = null
let recess: THREE.MeshStandardMaterial | null = null
let umber: THREE.MeshStandardMaterial | null = null
let fretTrim: THREE.MeshStandardMaterial | null = null
let screen: THREE.MeshStandardMaterial | null = null
let coffer: THREE.MeshStandardMaterial | null = null

/** HDR-boosted emissive color (MATERIALS.emissiveBoost) so bloom threshold is crossed. */
function boosted(hex: string, k: number = MATERIALS.emissiveBoost): THREE.Color {
  return new THREE.Color(hex).multiplyScalar(k)
}

// ---------------------------------------------------------------------------
// R1 — carved-stone surfacing
//
// Every architectural material samples the shared Orokin trim sheet through a
// WORLD-SPACE triplanar-ish projection (dominant axis, per fragment-stable per
// vertex), so a 2 m tile is 2 m everywhere: no more 18 cm/texel walls next to
// 2 mm/texel pillars (map E11), and no stretching on non-uniformly scaled
// primitives. The AO map is also multiplied into albedo (`aoBite`) so cavities
// stay dark under DIRECT light too — PBR-pure aoMap only touches indirect, and
// this level is lit by one hard key.
// ---------------------------------------------------------------------------

/**
 * Metres covered by one tile of the Orokin sheet.
 *
 * R2: 4.0 → 2.0. At a 4 m tile a 1 m authored panel was 4 m of wall, so from
 * gameplay distance the sheet contributed one soft value change per storey and
 * the walls read as untextured. At 2 m the panels are 1 m — the scale Orokin
 * plating actually reads at — and the 512² sheet lands at ~4 mm/texel.
 */
export const TRIM_TILE_M = 2.0

/**
 * Metres covered by one tile of the micro-detail normal layer. The panel sheet
 * has nothing left between its edges closer than ~2 m; this fills that band.
 */
export const DETAIL_TILE_M = 0.25

/**
 * Metres covered by one tile of the MACRO variation layer.
 *
 * R3. This is the layer that separates a shipped surface from a tiled one.
 * Whatever the trim sheet does, it repeats every TRIM_TILE_M; across a 260 m
 * level the eye finds that period in about a second and the wall collapses
 * into "one texture". A second map an order of magnitude larger — modulating
 * albedo value and roughness — makes one bay of wall measurably different
 * from the next, which is how real cast panelling weathers, and it buries the
 * trim period underneath itself.
 *
 * R6: 13 → 30 m, with the second octave reweighted to 7.1 m (see
 * `macroRepeat2`, where the measured swings are tabulated). The work order
 * asked for a 30 m octave carrying a ≥20 % value swing across a 10 m wall
 * run. At a 13 m tile a 10 m run covered three quarters of a period — the
 * swell went up and came back down inside one look, which the eye reads as
 * lighting rather than as material. At 30 m a 10 m run is a third of a
 * period, so it is a genuine one-way value gradient across the bay, and the
 * measured swing is 30.8 % over 10 m and 48.5 % over 40 m.
 */
export const MACRO_TILE_M = 30.0

/**
 * Metres covered by one tile of the WEATHERING atlas' planar channels (grime
 * pooling, dust breakup, edge wear). Deliberately not a multiple of any trim
 * or macro tile, so dirt never lands on the same place on every panel.
 */
export const WEATHER_TILE_M = 7.0

/**
 * Tile of the atlas' R channel — the drawn stain runs — in metres.
 *
 * Read with a GRAVITY-LOCKED projection (horizontal world axis × world −Y)
 * rather than the dominant-axis planar one, because a run is defined by which
 * way is down and nothing else. 4.5 m across and 9 m tall against a 512 sheet
 * puts a run at roughly 0.9 cm/texel horizontally: a 2-texel hairline is
 * ~2 cm, a 13-texel bleed ~11 cm, which is the real scale of a stain running
 * off a bolted flange.
 */
export const RUN_TILE_U = 4.5
export const RUN_TILE_V = 9.0

/** Tile of the bimodal gloss patch layer — the wet/dry period on the deck. */
export const WET_TILE_M = 3.2

type SurfaceOpts = {
  /** albedo value modulation from the macro layer (0 = off) */
  macro?: number
  /** roughness modulation from the same macro sample */
  macroRough?: number
  /** dust deposited on up-facing surfaces (lighter, matter) */
  dust?: number
  /** soot collecting under soffits and downward faces (darker) */
  soot?: number
  /**
   * Stochastic per-tile permutation of the trim sheet (0 = off).
   *
   * R4 — this is the fix for "one panel stamped in a perfect 20×8 grid".
   * A trim sheet, however varied inside one tile, is IDENTICAL in every tile,
   * and across a 60 m wall the eye finds the lattice instantly. Each tile now
   * hashes its own integer cell and picks one of eight rigid transforms of the
   * sheet — a half-tile shift in U and/or V (which permutes which of the four
   * authored 1 m plates lands in which quadrant) and an optional mirror in U.
   * All eight map panel boundaries onto panel boundaries, so the seam trenches
   * still line up across the cell edge and nothing tears; what changes is
   * WHICH plate the player sees where. The same hash also drives a small
   * per-tile albedo and roughness offset, so two tiles showing the same plate
   * still differ in value the way cast panels actually weather.
   *
   * The value is the strength of that per-tile value jitter; the permutation
   * itself is on whenever this is > 0.
   *
   * Sampling goes through `textureGrad` with derivatives taken from the
   * CONTINUOUS uv, because the permuted uv is discontinuous at every cell
   * boundary and implicit derivatives there would select the lowest mip and
   * draw a bright seam grid — the exact artefact this is meant to remove.
   */
  tileShuffle?: number
  /**
   * Mirror in V as well as U.
   *
   * R5: this used to be off by default because it flipped the drawn gravity
   * stains in the sheet. Those stains are gone — weathering that depends on
   * which way is down now lives in the `drip` term below, in world space — so
   * the flag is only about whether the extra permutation is worth the cost.
   */
  shuffleFlipV?: boolean
  /**
   * Depth of the parallax-occlusion relief, IN METRES.
   *
   * 0 turns the raymarch off. This is the R5 answer to "all Orokin ornament is
   * painted into canvas normal maps with no relief": a normal map can only
   * say which way a surface tilts, so the moment the camera is off-axis — which
   * down a colonnade is always — a 3 cm panel inset produces no displacement
   * whatever and the wall flattens back to a printed sheet. The march steps
   * along the view vector through the authored height field and returns the uv
   * the eye would actually hit, so insets, louvre slots and bolt bores SLIDE
   * against their frames as the player moves past. That motion parallax is the
   * cue the eye uses for depth, and no amount of normal-map strength fakes it.
   *
   * Expressed in metres, not uv, so the same 3 cm reads as 3 cm whatever the
   * material's tile size is.
   *
   * Cost is bounded by distance: the march fades out between 6 and 11 m and
   * steps down from 14 taps to 6 across that band, so only near-field
   * fragments — the ones where the flattening is actually visible — pay.
   */
  parallax?: number
  /**
   * Height field the march steps through. Defaults to the Orokin sheet's own.
   * A material whose relief does NOT come from that sheet — the deck, whose
   * panel and grate structure is baked from its own albedo — must pass its
   * own, or the parallax will displace toward features the surface does not
   * have and disagree with its normal map everywhere.
   */
  parallaxMap?: THREE.Texture | null
  /**
   * Strength of the world-space gravity staining (0 = off).
   *
   * Streaks running DOWN a vertical face, keyed to world Y, so they are
   * continuous across every mesh that makes up a wall and — unlike the drawn
   * runs this replaces — immune to the tile permutation. This is what lets a
   * tile rotate 90° without a dirt run ending up horizontal.
   *
   * R6: this is now the strength of the DRAWN stain runs in the weathering
   * atlas' R channel (textures.getWeatherTexture), not a stretched noise
   * fetch, and what it deposits is a hue — ochre-red iron oxide — rather than
   * a grey multiply. A value multiply can only make a surface darker; it can
   * never make it stop being its authored colour, and "every surface still
   * sits at its authored colour" is the note this answers.
   */
  drip?: number
  /**
   * Grime pooling (0 = off).
   *
   * Keyed to the CAVITY — the AO map, plus the parallax march's own height
   * where a material has one — so dirt collects where dirt can actually
   * collect: in seam trenches, under lips, in the bottom of bolt bores. The
   * reference frame's single most repeated feature is a dark gradient in
   * every recess, and half of it is geometry occlusion while the other half
   * is simply that the recess is dirtier. This is that half, and unlike the
   * AO term it survives a blown highlight because it is in the albedo.
   */
  pool?: number
  /**
   * Verdigris / biological patina (0 = off).
   *
   * The reference image's only saturated note is green, and it is not all
   * foliage: the metal itself has gone green-grey where water sits. Measured
   * over that frame, hues in the 120–180° band are ~12 % of all pixels with
   * any chroma at all; ours were under 0.5 %. This puts a second hue family
   * into the level's materials rather than leaving green to be a prop.
   *
   * Gated on the low half of the macro layer so it appears in REGIONS — a
   * damp bay, the foot of a wall — instead of evenly everywhere, which is how
   * a patina term stops reading as a green tint pass.
   */
  patina?: number
  /**
   * Edge wear (0 = off).
   *
   * The inverse mask of the pooling term: applied to PROUD surface, where the
   * finish has been rubbed back to bright substrate. Raises value, drops
   * roughness sharply and so breaks the specular exactly along the chamfers
   * and plate edges the height field already put there.
   */
  wear?: number
  /**
   * Bimodal gloss (0 = off) — the wet/dry patch layer.
   *
   * A single roughness value across a big surface makes the specular SHEET:
   * one smooth gradient crossing the whole floor as the camera turns, which
   * is the classic untextured-blockout tell. Patches of near-wet stone at a
   * ~3 m period, biased into the geometric low points, break that into
   * separate highlights that pop and vanish independently. Drives roughness
   * down to ~0.15 at full strength against a ~0.85 matte base — a genuinely
   * bimodal distribution, not a widened unimodal one.
   */
  wet?: number
}

const SURFACE_DEFAULTS: Required<SurfaceOpts> = {
  macro: 0.34,
  macroRough: 0.18,
  dust: 0.3,
  soot: 0.42,
  tileShuffle: 0,
  shuffleFlipV: false,
  parallax: 0,
  parallaxMap: null,
  drip: 0.42,
  // R6 — ON by default for every world surface. The brief is that no surface
  // may sit at its authored colour, and a default of 0 would mean any material
  // that forgets to opt IN ships clean. A material that genuinely should not
  // weather passes 0 explicitly.
  pool: 0.62,
  patina: 0.34,
  wear: 0.42,
  wet: 0,
}

/**
 * Fragment-scope globals and samplers for the world surface.
 *
 * R4 — the projection moved from the VERTEX shader to here, and that is a
 * correctness fix, not a tuning one. Picking the dominant axis per vertex means
 * the three vertices of one triangle can disagree about which plane they are
 * projecting onto, and the rasteriser then interpolates between two unrelated
 * uv sets. On the canyon columns that produced the smeared, melted panel runs
 * visible in every round-3 frame — the panel read it as "untextured", and it
 * was actually textured with garbage coordinates. Selecting per FRAGMENT from
 * the interpolated normal makes the uv an exact function of world position
 * inside each of the three regions, so the sheet is crisp everywhere and the
 * only artefact left is a one-pixel seam at the 45° crossover.
 *
 * `avSurfUv`   raw world-projected uv. Continuous (except across that seam), so
 *              it is what the mip derivatives and the tangent frame use.
 * `avSheetUv`  the permuted lookup — discontinuous at every tile edge, which is
 *              exactly why nothing may take a derivative of it.
 * `avSheetL`   R5: the permutation's LINEAR part as a 2×2 (a quarter-turn
 *              times an optional mirror). It used to be a mirror sign alone,
 *              which was enough to un-invert a bevel; now that tiles also
 *              rotate, and now that the parallax march has to push a direction
 *              vector through the same transform, the whole matrix is needed.
 *              `avSheetLT` is its transpose — which, because every permutation
 *              is orthogonal, is also its inverse. Gradient-like quantities
 *              (the normal map's XY) transform by the transpose; direction-like
 *              quantities (the parallax step) transform by the matrix itself.
 * `avPomH`     height at the parallax hit, 0.5 when parallax is off.
 */
const AV_SURFACE_PARS = /* glsl */ `
vec2 avSurfUv;
vec2 avSheetUv;
mat2 avSheetL;
mat2 avSheetLT;
vec2 avSheetDx;
vec2 avSheetDy;
float avTileJitter;
float avPomH;
/**
 * Cavity at this fragment: 1 on a proud face, →0 in the bottom of a trench.
 * Taken from the sheet's own AO map (which is baked from the SAME height
 * field as the normal, so the two never disagree) and tightened by the
 * parallax march's hit height where the material has one. Every weathering
 * term that is supposed to know about recesses reads this, and so does the
 * albedo AO bite, so the whole surface agrees about where the crevices are
 * and only one fetch pays for it.
 */
float avCavity;
vec4 avCellHash( vec2 c ) {
  vec4 p = fract( vec4( c.xyxy ) * vec4( 0.1031, 0.1030, 0.0973, 0.1099 ) );
  p += dot( p, p.wzxy + 33.33 );
  return fract( ( p.xxyz + p.yzzw ) * p.zywx );
}
vec4 avSheetTex( sampler2D t ) {
  return textureGrad( t, avSheetUv, avSheetDx, avSheetDy );
}
vec3 avSheetNormal( sampler2D t ) {
  vec3 n = textureGrad( t, avSheetUv, avSheetDx, avSheetDy ).xyz * 2.0 - 1.0;
  return vec3( avSheetLT * n.xy, n.z );
}
`

function worldUvChunk(uvScale: number): string {
  const k = uvScale.toFixed(5)
  return /* glsl */ `
      #include <uv_vertex>
      {
        vec4 avWp = vec4( position, 1.0 );
        vec3 avN = normal;
        #ifdef USE_INSTANCING
          avWp = instanceMatrix * avWp;
          avN = mat3( instanceMatrix ) * avN;
        #endif
        avWp = modelMatrix * avWp;
        avN = normalize( mat3( modelMatrix ) * avN );
        // perf/staticBatch: a baked batch carries each piece's own
        // mat3(model) * normal in avProjN (w = 0), because its model matrix
        // no longer holds that piece's scale. Unbaked meshes never bind the
        // attribute, and an unbound attribute reads w = 1, so they keep the
        // line above.
        if ( avProjN.w < 0.5 ) avN = normalize( mat3( modelMatrix ) * avProjN.xyz );
        vec3 avA = abs( avN );
        vec2 avUv = avA.y > max( avA.x, avA.z )
          ? avWp.xz
          : ( avA.x > avA.z ? avWp.zy : avWp.xy );
        avUv *= ${k};
        vAvUv = avUv;
        vAvN = avN;
        vAvW = avWp.xyz;
        #ifdef USE_MAP
          vMapUv = avUv;
        #endif
        #ifdef USE_NORMALMAP
          vNormalMapUv = avUv;
        #endif
        #ifdef USE_ROUGHNESSMAP
          vRoughnessMapUv = avUv;
        #endif
        #ifdef USE_METALNESSMAP
          vMetalnessMapUv = avUv;
        #endif
        #ifdef USE_AOMAP
          vAoMapUv = avUv;
        #endif
      }
      `
}

const AV_VARYINGS = /* glsl */ `
varying vec2 vAvUv;
varying vec3 vAvN;
varying vec3 vAvW;
`

/**
 * Wire a standard material to the world-space trim-sheet projection.
 *
 * `aoBite`  additionally multiplies the AO map into albedo (0 = off). PBR-pure
 *           aoMap only touches indirect light; this level is lit by one hard
 *           key, so without this bite a seam under direct light is not dark.
 * `detail`  strength of the ~0.25 m micro-detail normal layer blended on top
 *           of the panel normal (0 = off). One extra texture fetch; it is what
 *           keeps a wall from going flat as the player walks up to it.
 * `opts`    macro variation and deposition — see SURFACE_DEFAULTS. These are
 *           ON by default for every world surface; a material opts out by
 *           passing 0, not by omitting them.
 */
function applyWorldSurface(
  mat: THREE.MeshStandardMaterial,
  key: string,
  uvScale: number,
  aoBite = 0,
  detail = 0,
  opts: SurfaceOpts = {},
) {
  const o = { ...SURFACE_DEFAULTS, ...opts }
  const chunk = worldUvChunk(uvScale)
  const detailRepeat = (uvScale > 0 ? 1 / DETAIL_TILE_M / uvScale : 0).toFixed(5)
  const macroRepeat = (uvScale > 0 ? 1 / MACRO_TILE_M / uvScale : 0).toFixed(6)
  // Second macro octave at 4.2× the frequency — 7.1 m against the 30 m
  // primary. One octave alone is a slow swell that the eye reads as lighting,
  // not as material; the second gives it bay-to-bay structure at
  // architectural scale.
  //
  // R6: the pair was tuned by MEASUREMENT, not by eye. Replaying the macro
  // bake and the shader's own two-octave sample over 240 wall runs, the
  // peak-to-mean value swing an ivory wall gets is:
  //
  //   13 m + 3.9 m (R5)   10 m run 37.8 %   40 m run 44.5 %
  //   30 m + 8.9 m ×0.5   10 m run 25.6 %   40 m run 41.2 %
  //   30 m + 7.1 m ×0.7   10 m run 30.8 %   40 m run 48.5 %   ← this
  //
  // The work order asked for a 30 m octave carrying ≥20 % across a 10 m run.
  // The naive move — just retuning the primary to 30 m — met that but LOST
  // local variety against R5, because a longer period puts less of its range
  // inside one look. Reweighting the second octave buys it back and takes the
  // 40 m figure, the one that decides whether a whole wall is one value, past
  // where it has ever been.
  const macroRepeat2 = (uvScale > 0 ? 4.2 / MACRO_TILE_M / uvScale : 0).toFixed(6)
  const useMacro = o.macro > 0 || o.macroRough > 0
  const macroMean = getMacroMean().toFixed(4)
  const shuffle = o.tileShuffle > 0
  const parallax = o.parallax

  // -------------------------------------------------------------------------
  // R6 — the weathering composite.
  //
  // Sampled in WORLD METRES, not in trim-tile units: avSurfUv is the
  // dominant-axis world plane already multiplied by this material's own trim
  // rate, so dividing that rate back out gives a coordinate in metres and the
  // same 11 cm rust bleed is 11 cm on the deck (1 tile = 3 m), on a gold band
  // (0.6 m) and on the arena wall (2 m). Weathering that scaled with the trim
  // sheet would put centimetre dirt on one surface and metre dirt on the next,
  // which is the tell that makes a level read as separate assets.
  //
  // Four masks, from one RGBA fetch plus one gravity-locked fetch of R:
  //   avRust    drawn stain run × verticality × dirty-region gate
  //   avPool    grime in the crevices, from avCavity
  //   avPatina  verdigris, in the DAMP regions only (the second hue family)
  //   avWear    scuff on the proud faces — the inverse of avPool
  // and each deposits a HUE, because a value multiply can darken a surface
  // but can never stop it being its authored colour.
  // -------------------------------------------------------------------------
  const invUv = uvScale > 0 ? 1 / uvScale : 0
  // NB these divide 1, not invUv: `avWm` below is ALREADY world metres (it is
  // avSurfUv with the material's trim rate divided back out), so folding the
  // trim rate in again would scale the weathering by the trim tile — which is
  // precisely the coupling this layer exists to avoid. Measured against a 30 m
  // ivory wall with the trim rate still in, the runs came out at half size and
  // repeated every 2.25 m instead of 4.5 m, fine enough that they mipped into
  // a flat grey and the rust read as nothing at all.
  const wTile = (1 / WEATHER_TILE_M).toFixed(6)
  const runU = (1 / RUN_TILE_U).toFixed(6)
  const runV = (1 / RUN_TILE_V).toFixed(6)
  const wetTile = (1 / WET_TILE_M).toFixed(6)
  const useWeather = o.drip > 0 || o.pool > 0 || o.patina > 0 || o.wear > 0 || o.wet > 0
  const weatherMasks = useWeather
    ? /* glsl */ `
        // --- weathering atlas ---
        vec2 avWm = avSurfUv * ${invUv.toFixed(5)};
        vec4 avWx = texture2D( avWeatherMap, avWm * ${wTile} );
        // crevice-ness: 0 on a proud face, →1 in the floor of a trench
        float avCrev = clamp( ( 1.0 - avCavity ) * 1.7, 0.0, 1.0 );
        // Region gates off the macro layer. Without them every panel in the
        // level weathers by the same amount, which averages back out to a
        // uniform tint — the failure mode of every "add some grime" pass. A
        // bay is dirty; the bay beside it is not.
        float avDirtyRegion = clamp( ( avMacro + 0.12 ) * 2.8, 0.0, 1.0 );
        // R6b: widened from (0.04 - m) * 3.6. Measured on a 30 m ivory wall
        // at gameplay distance, the narrow gate left the whole 60–180° half
        // of the hue circle at 0.07 % of pixels against the reference's 22 %:
        // the term existed in the shader and did nothing in the picture. At
        // (0.10 - m) * 4.0 the gate is fully open over 38 % of the macro
        // field, which is the fraction of a wall a damp bay should be.
        float avDampRegion = clamp( ( 0.10 - avMacro ) * 4.0, 0.0, 1.0 );
        ${
          o.drip > 0
            ? /* glsl */ `
        // Gravity-locked projection: horizontal world axis across, world −Y
        // down. avSurfUv.y IS world y on both wall orientations (the dominant
        // axis picks zy or xy), so this costs no extra maths, and it means a
        // run is continuous across every mesh that makes up one wall and is
        // immune to the tile permutation — a rotated tile cannot make dirt
        // run sideways because the run does not live in the tile.
        float avRun = texture2D( avWeatherMap,
          vec2( avWm.x * ${runU}, -avWm.y * ${runV} ) ).r;
        float avRust = clamp( avRun * ( 1.0 - abs( avUp ) )
          * mix( 0.40, 1.0, avDirtyRegion ) * ${(o.drip * 1.9).toFixed(3)}, 0.0, 1.0 );`
            : '\n        float avRust = 0.0;'
        }
        ${
          o.pool > 0
            ? /* glsl */ `
        float avPool = clamp( avWx.g
          * clamp( mix( 0.34, 1.0, avCrev ) + max( 0.0, -avUp ) * 0.42, 0.0, 1.0 )
          * ( 0.55 + 0.45 * avDirtyRegion ) * ${o.pool.toFixed(3)}, 0.0, 1.0 );`
            : '\n        float avPool = 0.0;'
        }
        ${
          o.patina > 0
            ? /* glsl */ `
        // The pooling channel is CONTRAST-CURVED before it drives patina, not
        // used raw. Raw, its mean of 0.32 meant the strongest patina anywhere
        // was a 7 % lerp toward green, and a 7 % lerp cannot change a hue —
        // measured, it left 0.07 % of pixels off the warm band. Patina is not
        // a wash: it is either there, in a patch, or it is not, and only a
        // mask that reaches 1.0 somewhere can put a second hue in a frame.
        // With the curve the 60–90° band lands at 7.7 % of the wall against
        // 8.2 % in the reference.
        float avPatina = clamp( smoothstep( 0.12, 0.58, avWx.g ) * avDampRegion
          * mix( 0.55, 1.0, avCrev ) * ${o.patina.toFixed(3)}, 0.0, 1.0 );`
            : '\n        float avPatina = 0.0;'
        }
        ${
          o.wear > 0
            ? `\n        float avWear = clamp( avWx.a * ( 1.0 - avCrev ) * ( 0.45 + 0.55 * ( 1.0 - avDirtyRegion ) ) * ${o.wear.toFixed(3)}, 0.0, 1.0 );`
            : '\n        float avWear = 0.0;'
        }
        ${
          o.wet > 0
            ? /* glsl */ `
        // bimodal gloss: near-wet patches at a ~3 m period, biased into the
        // low points, so the specular breaks into separate highlights that
        // appear and vanish independently instead of sheeting across the deck
        float avWetM = texture2D( avWeatherMap, avWm * ${wetTile} + vec2( 0.37, 0.61 ) ).g;
        // The crevice weighting floors at 0.62, not at 0.40. Measured on the
        // deck's own cavity map the flat panel field sits at avCrev ≈ 0, so a
        // 0.40 floor capped the patch strength at 0.35 and the roughness only
        // fell from 0.57 to 0.43 — a slightly shinier patch, not a second
        // population. The bias toward low points survives (1.6× in a trench),
        // but the patch cores now actually reach the wet lobe.
        float avWet = smoothstep( 0.30, 0.74, avWetM ) * mix( 0.62, 1.0, avCrev )
          * ${o.wet.toFixed(3)};
        diffuseColor.rgb *= mix( 1.0, 0.68, avWet );`
            : '\n        float avWet = 0.0;'
        }
`
    : `
        float avRust = 0.0;
        float avPool = 0.0;
        float avPatina = 0.0;
        float avWear = 0.0;
        float avWet = 0.0;
        vec4 avWx = vec4( 0.0, 0.0, 0.5, 0.0 );`
  const weatherColor = useWeather
    ? /* glsl */ `
        // grime pooled in the recesses — warm, dark, desaturated
        diffuseColor.rgb = mix( diffuseColor.rgb,
          diffuseColor.rgb * vec3( 0.38, 0.365, 0.325 ), avPool );
        // Iron oxide running off a fixing. The constants are chosen against a
        // hue histogram of the reference frame, not by eye: 53.7 % of its
        // pixels with any chroma sit in the 30–60° ochre band, and only 0.7 %
        // below 30°, while OUR arena frame had 40.3 % below 30° and 22.8 % in
        // the ochre band. A red rust would have deepened the band we already
        // over-weight. Over the ivory base this resolves to linear
        // ~(0.375, 0.215, 0.068) ⇒ ~34° in display space: iron ochre, the
        // reference's dominant note.
        diffuseColor.rgb = mix( diffuseColor.rgb,
          diffuseColor.rgb * vec3( 0.50, 0.33, 0.13 ) + vec3( 0.100, 0.048, 0.016 ), avRust );
        // Verdigris. The reference's ONLY saturated note is green and it is not
        // all foliage — the metal itself has gone green-grey where water sits.
        // Measured over that frame the green is 12.0 % of chromatic pixels and
        // it is weighted to the COOL side of green (8.8 % in 150–180° against
        // 3.2 % in 120–150°), so this is tuned to ~145° rather than to a leaf
        // green, and it lands at linear ~(0.162, 0.283, 0.207) — a hue with
        // almost no value change, which is how patina behaves.
        // The constants are pre-divided by the ILLUMINANT, not authored to
        // look green on a swatch. This level is lit warm on purpose — key,
        // hemisphere and probe all run about 1.00 : 0.88 : 0.68 — and an
        // albedo authored to a 145° green renders at ~108° under it, which is
        // the olive the first pass measured. Dividing the target through gives
        // an albedo near (0.155, 0.300, 0.270): cyan on a swatch, and the
        // right green once the warm light has been through it. Copper
        // carbonate is genuinely on the cyan side of green, so this is not a
        // cheat, it is the pigment — but the blue channel is deliberately held
        // BELOW a true verdigris. The panel's second note is that there is no
        // blue pixel in the reference, and a cyan-leaning patch on a wall is
        // the one way a weathering pass can put one back.
        diffuseColor.rgb = mix( diffuseColor.rgb,
          diffuseColor.rgb * vec3( 0.22, 0.50, 0.38 ) + vec3( 0.034, 0.055, 0.058 ), avPatina );
        // finish rubbed back to bright substrate on the proud edges
        diffuseColor.rgb = mix( diffuseColor.rgb,
          diffuseColor.rgb * vec3( 1.22, 1.19, 1.13 ) + 0.010, avWear );`
    : ''
  const weatherRough = /* glsl */ `
        // Roughness is where the weathering has to be doing the most work: a
        // uniform specular is the single most reliable untextured-blockout
        // tell, and every one of these terms pushes a different part of the
        // surface a different way. Rust is the matte end, bare wear the glossy
        // end, and the wet patches drive a genuinely bimodal distribution.
        roughnessFactor = clamp(
          roughnessFactor
            + avMacro * ${o.macroRough.toFixed(3)}
            + avDust * 0.22
            + avPool * 0.26
            + avRust * 0.38
            - avWear * 0.44,
          0.035, 1.0 );${
            o.wet > 0
              ? /* glsl */ `
        // The wet patches are a LERP to a target, not a subtraction, so the
        // gloss end of the distribution lands on a known value (0.14 — a
        // damp-stone lobe) regardless of what the map underneath was doing.
        // A subtraction would have made the wet roughness a function of the
        // dry roughness, which is exactly how a "bimodal" term collapses back
        // into a widened unimodal one.
        // min(), not the target alone: on a surface whose dry roughness is
        // already under the wet target — the polished-stone floors bottom out
        // around 0.07 — a straight lerp would make the wet patches ROUGHER
        // than the dry deck around them, which is backwards.
        roughnessFactor = mix( roughnessFactor, min( roughnessFactor, 0.14 ), avWet );`
              : ''
          }`
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${AV_VARYINGS}\nattribute vec4 avProjN;`)
      .replace('#include <uv_vertex>', chunk)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${AV_VARYINGS}${AV_SURFACE_PARS}`)

    // --- macro variation + deposition, injected right after the albedo read ---
    if (useMacro || o.dust > 0 || o.soot > 0) {
      shader.uniforms.avMacroMap = { value: getMacroVariationTexture() }
      shader.uniforms.avWeatherMap = { value: getWeatherTexture() }
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>\n' + AV_VARYINGS,
          '#include <common>\n' + AV_VARYINGS +
            '\nuniform sampler2D avMacroMap;\nuniform sampler2D avWeatherMap;',
        )
        .replace(
          '#include <map_fragment>',
          /* glsl */ `
        #include <map_fragment>
        float avMacro = texture2D( avMacroMap, avSurfUv * ${macroRepeat} ).r - ${macroMean};
        avMacro += ( texture2D( avMacroMap, avSurfUv * ${macroRepeat2} + 0.37 ).r - ${macroMean} ) * 0.7;
        diffuseColor.rgb *= 1.0 + avMacro * ${o.macro.toFixed(3)};
        float avUp = clamp( vAvN.y, -1.0, 1.0 );
${weatherMasks}
        // R6: the dust term is modulated by the atlas' B channel. A flat wash
        // on every up-facing polygon is a lighting artefact, not dust; dust
        // drifts, so it has to be patchy at a metre scale or the eye reads the
        // whole term as a bad ambient.
        float avDust = max( 0.0, avUp ) * ${o.dust.toFixed(3)} * ( 0.35 + 1.15 * avWx.b );
        float avSoot = max( 0.0, -avUp ) * ${o.soot.toFixed(3)};
        diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * vec3( 1.11, 1.06, 0.97 ), avDust );
        diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * vec3( 0.50, 0.49, 0.50 ), avSoot );
        // Vertical deposition ramp: everything in a 30 m hall is dirtier at the
        // plinth and cleaner at the clerestory, and a top-to-bottom value ramp
        // is most of what stops a tall wall reading as one flat slab. Keyed to
        // WORLD y so it is continuous across every mesh that makes up the wall.
        //
        // R5: deepened, and CURVED. A linear ramp spends most of its range
        // between 8 m and 16 m, which is above everything the player fights in
        // front of; raising it to the power of 1.35 moves the darkening down
        // into the 0–5 m band where bodies actually stand, which is the
        // "darken the lower band so enemies sit against a dark field" note
        // answered from the surface side rather than with extra geometry.
        diffuseColor.rgb *= mix( ${(1 - o.soot * 0.80).toFixed(3)}, 1.06,
          pow( clamp( vAvW.y / 16.0, 0.0, 1.0 ), 1.35 ) );
${weatherColor}
        `,
        )
        .replace(
          '#include <roughnessmap_fragment>',
          /* glsl */ `
        #include <roughnessmap_fragment>
        ${weatherRough}
        `,
        )
    }

    if (parallax > 0) {
      shader.uniforms.avHeightMap = { value: o.parallaxMap ?? getOrokinHeightTexture() }
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <common>\n' + AV_VARYINGS,
        '#include <common>\n' + AV_VARYINGS + '\nuniform sampler2D avHeightMap;',
      )
    }

    if (aoBite > 0) {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <map_fragment>',
        /* glsl */ `
        #include <map_fragment>
        // avCavity is already the AO fetch (see the projection block); reusing
        // it here is one texture read saved on every world-surface fragment.
        diffuseColor.rgb *= mix( 1.0, avCavity, ${aoBite.toFixed(3)} );
        `,
      )
    }
    if (detail > 0) {
      shader.uniforms.avDetailMap = { value: getDetailNormalTexture() }
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <normal_pars_fragment>',
          '#include <normal_pars_fragment>\nuniform sampler2D avDetailMap;',
        )
        .replace(
          '#include <normal_fragment_maps>',
          /* glsl */ `
        #include <normal_fragment_maps>
        #if defined( USE_NORMALMAP_TANGENTSPACE )
          {
            vec3 avDn = texture2D( avDetailMap, avSurfUv * ${detailRepeat} ).xyz * 2.0 - 1.0;
            normal = normalize( normal + tbn * vec3( avDn.xy * ${detail.toFixed(3)}, 0.0 ) );
          }
        #endif
        `,
        )
    }

    // --- world-surface sampling. LAST, because it expands the stock chunks
    // itself: onBeforeCompile sees `#include <...>` still unresolved (three
    // resolves includes inside WebGLProgram, after this hook), so the only way
    // to redirect a chunk's sampler read is to write the chunk out. Every
    // injection above wraps its include and leaves the token in place, so the
    // expansions below still find them.
    {
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <map_fragment>',
          /* glsl */ `
        {
          // Dominant-axis planar projection, per FRAGMENT (see AV_SURFACE_PARS).
          // The length guard is not paranoia: a zero-length interpolated normal
          // makes normalize() return NaN, the NaN reaches the albedo, and the
          // bloom downsample chain then smears it across the entire frame —
          // which is exactly how a single degenerate vertex turns one camera
          // angle completely black.
          float avNl = length( vAvN );
          vec3 avNw = avNl > 1e-5 ? vAvN / avNl : vec3( 0.0, 1.0, 0.0 );
          vec3 avAb = abs( avNw );
          avSurfUv = ( avAb.y > max( avAb.x, avAb.z )
            ? vAvW.xz
            : ( avAb.x > avAb.z ? vAvW.zy : vAvW.xy ) ) * ${uvScale.toFixed(5)};
          // Explicit derivatives, sanitised. They come from the CONTINUOUS uv,
          // because the permuted one below is discontinuous at every cell edge
          // and implicit derivatives there select mip 0 and draw a bright
          // lattice — the exact artefact the permutation exists to remove. The
          // one-pixel ring where the dominant axis flips still produces a huge
          // (or non-finite) gradient, so it is both NaN-checked and clamped;
          // textureGrad with a NaN lod is undefined and on this stack returns
          // NaN, which the bloom chain spreads to the whole image.
          vec2 avDx = dFdx( avSurfUv );
          vec2 avDy = dFdy( avSurfUv );
          bool avBad = any( isnan( avSurfUv ) ) || any( isnan( avDx ) ) || any( isnan( avDy ) )
            || any( isinf( avDx ) ) || any( isinf( avDy ) );
          if ( avBad ) { avSurfUv = vAvUv; avDx = dFdx( vAvUv ); avDy = dFdy( vAvUv ); }
          avSheetDx = clamp( avDx, -0.25, 0.25 );
          avSheetDy = clamp( avDy, -0.25, 0.25 );
          avPomH = 0.5;
          ${
            shuffle
              ? /* glsl */ `
          vec2 avCell = floor( avSurfUv );
          vec4 avR = avCellHash( avCell );
          // R5 — QUARTER TURNS, on top of the mirror and the half-tile deal.
          // The sheet's tile is square and its panel grid is 2×2, so a 90°
          // rotation about the tile centre maps every panel boundary onto a
          // panel boundary exactly as the mirror does: the seam trenches stay
          // continuous across the cell edge and nothing tears. It multiplies
          // the permutation count by four — 8 variants to 32 — which is the
          // difference between a period the eye finds in a second and one it
          // does not find at all across a 60 m wall.
          //
          // This only became safe once the drawn gravity runs came out of the
          // albedo sheet (see textures.buildOrokinMaps): a rotated tile would
          // otherwise have had its dirt running sideways.
          float avQ = floor( avR.x * 3.999 );
          vec2 avCS = floor( vec2( cos( avQ * 1.5707963 ), sin( avQ * 1.5707963 ) ) + 0.5 );
          mat2 avRotM = mat2( avCS.x, avCS.y, -avCS.y, avCS.x );
          vec2 avMir = vec2( step( 0.5, avR.y ), ${o.shuffleFlipV ? 'step( 0.5, avR.w )' : '0.0'} );
          vec2 avSgn = 1.0 - 2.0 * avMir;
          mat2 avMirM = mat2( avSgn.x, 0.0, 0.0, avSgn.y );
          avSheetL = avMirM * avRotM;
          avSheetLT = mat2( avSheetL[0][0], avSheetL[1][0], avSheetL[0][1], avSheetL[1][1] );
          // rotate/mirror about the tile CENTRE, then deal the four authored
          // 1 m plates into different quadrants with a half-tile shift
          vec2 avF = avSheetL * ( fract( avSurfUv ) - 0.5 ) + 0.5;
          avF += step( 0.5, avR.zw ) * 0.5;
          avSheetUv = avF;
          avTileJitter = ( avR.x + avR.y + avR.z + avR.w ) * 0.5 - 1.0;
          `
              : /* glsl */ `
          avSheetUv = avSurfUv;
          avSheetL = mat2( 1.0, 0.0, 0.0, 1.0 );
          avSheetLT = avSheetL;
          avTileJitter = 0.0;
          `
          }
          ${
            parallax > 0
              ? /* glsl */ `
          // --- parallax occlusion march ---
          //
          // The tangent frame is ANALYTIC here, not derived. The uv is a
          // world-plane projection onto the dominant axis, so the tangent and
          // bitangent are literally two world axes — no dFdx reconstruction, no
          // disagreement with the normal map, and no cost.
          vec3 avVw = cameraPosition - vAvW;
          float avVd = length( avVw );
          avVw /= max( avVd, 1e-4 );
          // fade out with distance: past ~11 m a 3 cm inset displaces well
          // under a pixel, so the march is pure cost. Step count falls with it.
          float avPomFade = 1.0 - smoothstep( 6.0, 11.0, avVd );
          if ( avPomFade > 0.02 ) {
            vec3 avTt, avBt;
            if ( avAb.y > max( avAb.x, avAb.z ) ) {
              avTt = vec3( 1.0, 0.0, 0.0 ); avBt = vec3( 0.0, 0.0, 1.0 );
            } else if ( avAb.x > avAb.z ) {
              avTt = vec3( 0.0, 0.0, 1.0 ); avBt = vec3( 0.0, 1.0, 0.0 );
            } else {
              avTt = vec3( 1.0, 0.0, 0.0 ); avBt = vec3( 0.0, 1.0, 0.0 );
            }
            vec2 avVt = vec2( dot( avVw, avTt ), dot( avVw, avBt ) );
            float avVz = max( abs( dot( avVw, avNw ) ), 0.30 );
            float avNum = floor( mix( 6.0, 14.0, avPomFade ) );
            float avLayer = 1.0 / avNum;
            // the step is a DIRECTION, so it goes through the permutation
            // matrix itself; the normal's gradient goes through the transpose.
            vec2 avStep = ( avSheetL * ( avVt / avVz ) )
              * ${(parallax * uvScale).toFixed(6)} * avPomFade * avLayer;
            float avCur = 1.0;
            vec2 avPu = avSheetUv;
            float avHs = textureGrad( avHeightMap, avPu, avSheetDx, avSheetDy ).r;
            for ( int i = 0; i < 14; i ++ ) {
              if ( float( i ) >= avNum || avHs >= avCur ) break;
              avCur -= avLayer;
              avPu -= avStep;
              avHs = textureGrad( avHeightMap, avPu, avSheetDx, avSheetDy ).r;
            }
            // one secant refinement between the last two layers, so a 6-step
            // march does not stair-step a straight machined edge into a comb
            vec2 avPp = avPu + avStep;
            float avHp = textureGrad( avHeightMap, avPp, avSheetDx, avSheetDy ).r
              - ( avCur + avLayer );
            float avHc = avHs - avCur;
            avSheetUv = mix( avPu, avPp, clamp( avHc / max( avHc - avHp, 1e-5 ), 0.0, 1.0 ) );
            avPomH = avHs;
          }
          `
              : ''
          }
        }
        avCavity = 1.0;
        #ifdef USE_AOMAP
          avCavity = avSheetTex( aoMap ).r;
        #endif
        ${
          parallax > 0
            ? // the march resolves WHICH texel the eye hits; on an inset face
              // that texel is a trench floor the AO map alone would have
              // averaged away, so the two together are sharper than either
              'avCavity = min( avCavity, 0.34 + avPomH * 0.66 );'
            : ''
        }
        #ifdef USE_MAP
          diffuseColor *= avSheetTex( map );
        #endif
        diffuseColor.rgb *= 1.0 + avTileJitter * ${o.tileShuffle.toFixed(3)};
        `,
        )
        .replace(
          '#include <roughnessmap_fragment>',
          /* glsl */ `
        float roughnessFactor = roughness;
        #ifdef USE_ROUGHNESSMAP
          roughnessFactor *= avSheetTex( roughnessMap ).g;
        #endif
        roughnessFactor = clamp( roughnessFactor - avTileJitter * ${(o.tileShuffle * 0.55).toFixed(3)}, 0.035, 1.0 );
        `,
        )
        .replace(
          '#include <metalnessmap_fragment>',
          /* glsl */ `
        float metalnessFactor = metalness;
        #ifdef USE_METALNESSMAP
          metalnessFactor *= avSheetTex( metalnessMap ).b;
        #endif
        `,
        )
        .replace(
          '#include <normal_fragment_maps>',
          /* glsl */ `
        #ifdef USE_NORMALMAP_OBJECTSPACE
          normal = avSheetNormal( normalMap );
          #ifdef FLIP_SIDED
            normal = - normal;
          #endif
          #ifdef DOUBLE_SIDED
            normal = normal * faceDirection;
          #endif
          normal = normalize( normalMatrix * normal );
        #elif defined( USE_NORMALMAP_TANGENTSPACE )
          vec3 mapN = avSheetNormal( normalMap );
          mapN.xy *= normalScale;
          normal = normalize( tbn * mapN );
        #elif defined( USE_BUMPMAP )
          normal = perturbNormalArb( - vViewPosition, normal, dHdxy_fwd(), faceDirection );
        #endif
        `,
        )
        .replace(
          '#include <aomap_fragment>',
          /* glsl */ `
        #ifdef USE_AOMAP
          float ambientOcclusion = ( avSheetTex( aoMap ).r - 1.0 ) * aoMapIntensity + 1.0;
          reflectedLight.indirectDiffuse *= ambientOcclusion;
          #if defined( USE_CLEARCOAT )
            clearcoatSpecularIndirect *= ambientOcclusion;
          #endif
          #if defined( USE_SHEEN )
            sheenSpecularIndirect *= ambientOcclusion;
          #endif
          #if defined( USE_ENVMAP ) && defined( STANDARD )
            float dotNV = saturate( dot( geometryNormal, geometryViewDir ) );
            reflectedLight.indirectSpecular *= computeSpecularOcclusion( dotNV, ambientOcclusion, material.roughness );
          #endif
        #endif
        `,
        )
    }
  }
  // QA handle. The atlas only ever exists inside a compiled shader's uniform
  // block, which is unreachable from outside; hanging it here costs one
  // reference and lets the capture harness read the bytes back and prove the
  // runs actually baked, instead of judging a weathering pass by eye.
  mat.userData.avWeatherMap = useWeather ? getWeatherTexture() : null
  mat.userData.avSurfaceOpts = o
  // distinct injected source ⇒ distinct program cache entry
  mat.customProgramCacheKey = () => key
}

/** shared trim-sheet maps (one texture object, many materials) */
function trimMaps() {
  const ao = getOrokinAOTexture()
  ao.channel = 0
  return {
    map: getOrokinAlbedoTexture(),
    normalMap: getOrokinNormalTexture(),
    roughnessMap: getOrokinRoughnessTexture(),
    aoMap: ao,
  }
}

/**
 * Shrine Ivory ceramic — carved Orokin stone.
 * Albedo pulled down to #C4BCAC so lit faces land mid-band instead of clipping
 * at the top of the histogram; normal/AO/roughness from the shared trim sheet.
 */
export function ivoryMaterial(): THREE.MeshStandardMaterial {
  if (ivory) return ivory
  const t = trimMaps()
  ivory = new THREE.MeshStandardMaterial({
    color: COLORS.shrineIvoryDeep,
    // R3: the albedo MAP is the change that matters. Until now this material
    // was one RGB constant plus shading, which is the literal definition of
    // the "untextured blockout" the panel failed twice — relief that only
    // exists in the normal disappears the moment a surface faces the key.
    // The map carries grime in the seam trenches, crowns rubbed clean,
    // per-plate casting drift and drawn stain runs, none of which depend on
    // the light, so the wall still has structure in a blown highlight.
    map: t.map,
    // R6: 0.82 → 0.74. The sheet's own roughness band is ~0.46–0.98, so at
    // 0.82 the wall sat at 0.38–0.80 and the weathering terms — which only
    // ever ADD roughness except for edge wear — pushed most of its area into
    // the matte top of that. A surface with no specular cannot have a broken
    // specular, and "highlights are not uniform" is the note. At 0.74 the
    // median lands near 0.55, where a grazing key actually produces a
    // highlight for the rust, pooling and wear terms to break up.
    roughness: 0.74,
    metalness: 0.04,
    normalMap: t.normalMap,
    roughnessMap: t.roughnessMap,
    aoMap: t.aoMap,
    aoMapIntensity: 1.35,
    // ceramic is a dielectric, not a matte card: a little environment keeps
    // the unlit side off dead flat and gives chamfers a grazing sheen
    envMapIntensity: 0.85,
  })
  // R2: 0.5 → 1.8. At 0.5 the relief was gone by 3 m; the review's single
  // loudest tell was "untextured primitive architecture".
  ivory.normalScale.set(1.8, 1.8)
  // aoBite 0.6 → 0.42: the albedo map now carries its own cavity grime, and
  // at 0.6 on top of it the seams crushed to black.
  applyWorldSurface(ivory, 'av-ivory', 1 / TRIM_TILE_M, 0.36, 0.32, {
    macro: 0.44,
    macroRough: 0.22,
    // R4: the wall the panel called "one panel stamped in a perfect 20×8 grid"
    // is this material. Eight per-tile permutations of the sheet plus a ±7 %
    // per-tile value offset break the lattice without touching geometry.
    // R5: now thirty-two, with quarter turns added — and the per-tile VALUE
    // offset goes 0.07 → 0.12, because on the arena back wall at 40 m the
    // sheet is mipped down to a blur and the permutation buys nothing: a flat
    // per-tile multiplier is the only part of the anti-tiling machinery that
    // survives to that range, and that wall is the frame the panel keeps
    // calling wallpaper.
    tileShuffle: 0.12,
    shuffleFlipV: true,
    // 3.5 cm — a real Orokin plate inset. This is the material that makes up
    // most of the level's wall area, so it is where the "painted ornament, no
    // relief" note is won or lost.
    parallax: 0.035,
    // R6 — this is the surface the panel meant by "every surface still sits at
    // its authored colour", because it IS most of the level's area. Pushed
    // past the defaults on all four weathering terms.
    drip: 0.5,
    pool: 0.72,
    patina: 0.95,
    // R6b: 0.46 → 0.62. Measured, the ivory roughness ran 0.40–0.79 at the 5th
    // and 95th percentiles; the work order asked for 0.25–0.75 per panel and
    // edge wear is the only term that pushes the GLOSSY end.
    wear: 0.62,
    // …and wear alone was not enough: its mask means 0.10 over the atlas, so
    // it moved the 5th percentile by 0.008. The wall gets the damp-patch layer
    // too, at half the deck's strength. TARGET.md's materials note is
    // literally "wet-looking patches next to matte dusty ones", and a wall in
    // that frame is not uniformly dry either.
    wet: 0.45,
  })
  return ivory
}

/**
 * Ivory variant that reads a baked vertex-colour contact AO (see
 * ShrineStation.bakeContactAO). Same surfacing as ivoryMaterial; used for the
 * instanced ribs / wall panels / buttresses whose bases must stay grounded
 * even when the SSAO pass is off on low quality tiers.
 */
export function ivoryContactMaterial(): THREE.MeshStandardMaterial {
  if (ivoryContact) return ivoryContact
  const t = trimMaps()
  ivoryContact = new THREE.MeshStandardMaterial({
    color: COLORS.shrineIvoryDeep,
    map: t.map,
    // R6: 0.82 → 0.74. The sheet's own roughness band is ~0.46–0.98, so at
    // 0.82 the wall sat at 0.38–0.80 and the weathering terms — which only
    // ever ADD roughness except for edge wear — pushed most of its area into
    // the matte top of that. A surface with no specular cannot have a broken
    // specular, and "highlights are not uniform" is the note. At 0.74 the
    // median lands near 0.55, where a grazing key actually produces a
    // highlight for the rust, pooling and wear terms to break up.
    roughness: 0.74,
    metalness: 0.04,
    normalMap: t.normalMap,
    roughnessMap: t.roughnessMap,
    aoMap: t.aoMap,
    aoMapIntensity: 1.35,
    envMapIntensity: 0.85,
    vertexColors: true,
  })
  ivoryContact.normalScale.set(1.8, 1.8)
  applyWorldSurface(ivoryContact, 'av-ivory-contact', 1 / TRIM_TILE_M, 0.36, 0.32, {
    macro: 0.44,
    macroRough: 0.22,
    tileShuffle: 0.12,
    shuffleFlipV: true,
    parallax: 0.035,
    drip: 0.5,
    pool: 0.72,
    patina: 0.95,
    // R6b: 0.46 → 0.62. Measured, the ivory roughness ran 0.40–0.79 at the 5th
    // and 95th percentiles; the work order asked for 0.25–0.75 per panel and
    // edge wear is the only term that pushes the GLOSSY end.
    wear: 0.62,
    // …and wear alone was not enough: its mask means 0.10 over the atlas, so
    // it moved the 5th percentile by 0.008. The wall gets the damp-patch layer
    // too, at half the deck's strength. TARGET.md's materials note is
    // literally "wet-looking patches next to matte dusty ones", and a wall in
    // that frame is not uniformly dry either.
    wet: 0.45,
  })
  return ivoryContact
}

/**
 * Polished gold — narrow, bright specular for edge highlights, nosings and
 * small ornament.
 *
 * R2: metal is read from its SPECULAR, not its albedo. The old #D9B25F base
 * was a bright ochre that lit like painted plastic, because for a metal the
 * base colour IS the reflectance — a light one washes the reflection out and
 * leaves a flat mid-tone wherever the environment is dim. Dropping it to
 * ~#8C6B2A makes the unlit side of every bevel go properly dark and lets the
 * narrow env strip (see Lighting.tsx) carry the read. The brushed normal +
 * 0.12–0.45 roughness map then smear that highlight along the brush direction
 * instead of blowing one round dot.
 */
export function goldPolishedMaterial(): THREE.MeshStandardMaterial {
  if (goldPolished) return goldPolished
  const orm = getGoldORMTexture()
  orm.channel = 0
  goldPolished = new THREE.MeshPhysicalMaterial({
    // R2b: #8C6B2A was the value the review asked for, and in isolation it is
    // right — but a metal takes essentially ALL of its colour from what it
    // reflects, and this probe is deliberately almost black. At that albedo
    // every gold surface that did not happen to catch the narrow bar rendered
    // dark brown, and the level lost the "gold" half of its colour script.
    // The fix is to pay for the contrast with envMapIntensity (which only
    // scales a METAL's reflection, so it does not lift the ivory) rather than
    // with albedo. Landed at #AE8438 with a 3.4 env gain.
    //
    // R3 adds the two things that were still missing for this to BE metal
    // rather than a gold-coloured dielectric:
    //
    //  * a real anisotropic lobe. Brushed and cast gold stretches its
    //    highlight ALONG the grain; a round isotropic dot is the single most
    //    reliable "untextured primitive" tell on a metal. three's
    //    MeshPhysicalMaterial does this properly, and the tangent frame it
    //    derives comes from the same world-projected UV as the brush normal,
    //    so the lobe and the ridges agree by construction.
    //  * a packed ORM, so wear drives albedo, roughness AND metalness from one
    //    field. Real gilding is not uniformly metal: where it has dulled the
    //    metalness falls, the roughness climbs and the colour goes redder,
    //    all together. A constant metalness of 1.0 across every gold surface
    //    in a level is a material-authoring tell, not a look.
    //
    // R4 is where the "tan rubber rope" note is actually answered. The colour
    // and the BRDF were already defensible; what was missing was that all
    // three gold maps were built from value noise, so the surface had no
    // straight machined edge anywhere and its highlight had nothing to break
    // against. It therefore rendered as one smooth, evenly-lit tube whatever
    // the probe did. The sheet is now DRAWN (reeded lands, chamfered grooves,
    // cross-straps, bead rows, a fret inlay) and its roughness is a function
    // of that drawn height, so a polished land sits at ~0.06 and throws a hard
    // specular line off the key light ALONE. That read does not depend on the
    // environment probe at all, which is the point: envMapIntensity comes down
    // from 3.4, because a broad bright probe smeared across a featureless
    // surface is precisely what made it look like tinted rubber.
    //
    // R5 answers the note that gold is STILL "either a black outline or a
    // bloom blob". That is a two-state read, and a two-state read is what a
    // mirror gives you: at the old 0.045–0.09 land roughness the lobe was
    // narrow enough that a surface either pointed at the probe's bright bar
    // (several stops over the bloom knee → blob) or did not (probe floor →
    // outline). The sheet's band moved to 0.115–0.62 (textures.GOLD_ROUGH_*),
    // which spreads that energy over tens of degrees so a curved run RAMPS,
    // and the probe gain comes down with it so the bright end lands under the
    // knee instead of on top of it. The albedo goes up ~15 % to pay for the
    // dimmer probe: a metal has no diffuse, so its base colour is its F0, and
    // #AE8438 is a much darker gold than any real gilding.
    color: '#C29A4E',
    map: getGoldAlbedoTexture(),
    metalness: 1.0,
    metalnessMap: orm,
    // the map is authored at its final 0.115–0.62 band; 0.85 keeps the small
    // polished ornament a touch tighter than the bulk trim
    roughness: 0.85,
    roughnessMap: orm,
    aoMap: orm,
    aoMapIntensity: 1.25,
    normalMap: getBrushedGoldNormalTexture(),
    envMapIntensity: 2.0,
    anisotropy: 0.9,
    anisotropyRotation: 0,
  })
  // R4: 0.5 → 1.15. At 0.5 the authored chamfers and strap lips were a
  // suggestion; the whole reason to draw them is that they model under the key.
  goldPolished.normalScale.set(1.15, 1.15)
  applyWorldSurface(goldPolished, 'av-gold-polished', 1 / 0.6, 0.55, 0, {
    // metal gets only a whisper of macro — the layer exists to break a tiling
    // period on stone, and on a reflective surface it reads as paint
    macro: 0.1,
    macroRough: 0.08,
    dust: 0.16,
    soot: 0.3,
    // gilding does stain, but a run of dirt down a mirror is a dielectric
    // read; keep it to a hint that only breaks the specular
    drip: 0.22,
    // R6: gold does not oxidise, but the steel it is bolted to does, and the
    // grime that collects against a raised bead does not care what is under
    // it. Wear runs HIGH on metal — that is where a polished land comes from —
    // and it is the term that gives the anisotropic lobe something to break
    // against along the reeds.
    pool: 0.4,
    patina: 0.16,
    wear: 0.62,
  })
  return goldPolished
}

/**
 * Cast gold — the bulk trim. Rougher (×1.45 on the same brushed map → about
 * 0.17–0.65) so big runs read as cast metal with a broad ramp rather than one
 * blown-out chrome strip.
 */
export function goldCastMaterial(): THREE.MeshStandardMaterial {
  if (goldCast) return goldCast
  const orm = getGoldORMTexture()
  orm.channel = 0
  goldCast = new THREE.MeshPhysicalMaterial({
    color: '#A8823A',
    map: getGoldAlbedoTexture(),
    metalness: 0.98,
    metalnessMap: orm,
    // R5: 1.12 → 1.05 against the retargeted 0.115–0.62 band ⇒ ~0.12–0.65.
    // The bulk trim is the widest lobe in the gold set, which is what a big
    // cast run should be.
    roughness: 1.05,
    roughnessMap: orm,
    aoMap: orm,
    aoMapIntensity: 1.25,
    normalMap: getBrushedGoldNormalTexture(),
    envMapIntensity: 1.8,
    // broader runs of cast metal, so a slightly softer lobe than the polished
    anisotropy: 0.6,
  })
  goldCast.normalScale.set(1.05, 1.05)
  applyWorldSurface(goldCast, 'av-gold-cast', 1 / 0.9, 0.55, 0, {
    macro: 0.13,
    macroRough: 0.1,
    dust: 0.2,
    soot: 0.34,
    drip: 0.26,
    pool: 0.46,
    patina: 0.2,
    wear: 0.55,
  })
  return goldCast
}

/** Legacy name — the bulk trim gold. */
export function goldMaterial(): THREE.MeshStandardMaterial {
  if (gold) return gold
  gold = goldCastMaterial()
  return gold
}

/**
 * Near-black recess — every panel gap, channel behind an energy strip and
 * joint shadow line. This is the level's true black: nothing else is allowed
 * this dark, so recesses always separate from the ivory faces.
 */
export function recessMaterial(): THREE.MeshStandardMaterial {
  if (recess) return recess
  recess = new THREE.MeshStandardMaterial({
    color: COLORS.recessBlack,
    roughness: 0.99,
    // R2: 0.15 → 0.0. Any metalness at all gave the recesses an env-map
    // specular sheen, which is exactly how a "true black" stops being one.
    metalness: 0.0,
    envMapIntensity: 0.08,
    // R3: even the true black gets relief. A recess is a cast channel, not a
    // painted stripe, and at a grazing angle the key has to find SOMETHING on
    // it — a perfectly smooth black plane in an otherwise machined level is a
    // tell on its own.
    normalMap: getDetailNormalTexture(),
    roughnessMap: getOrokinRoughnessTexture(),
  })
  recess.normalScale.set(0.75, 0.75)
  applyWorldSurface(recess, 'av-recess', 1 / 0.7, 0, 0, {
    macro: 0.1,
    macroRough: 0.06,
    dust: 0.12,
    soot: 0.0,
    // the true black has nowhere darker to go
    drip: 0.0,
    pool: 0.0,
    // a recess is where water sits, so it is the one place the green is
    // allowed to be strong — and it is the level's darkest value, so a green
    // there reads as a hue without lifting any value
    patina: 0.42,
    wear: 0.22,
  })
  return recess
}

/**
 * Deep umber — floor bands and panel-recess surrounds. The warm mid-dark the
 * palette was missing, so gold has somewhere to sit between ivory and black.
 */
export function umberMaterial(): THREE.MeshStandardMaterial {
  if (umber) return umber
  const t = trimMaps()
  umber = new THREE.MeshStandardMaterial({
    color: COLORS.umberDeep,
    map: t.map,
    roughness: 0.78,
    metalness: 0.25,
    normalMap: t.normalMap,
    roughnessMap: t.roughnessMap,
    aoMap: t.aoMap,
    envMapIntensity: 1.2,
  })
  umber.normalScale.set(1.35, 1.35)
  applyWorldSurface(umber, 'av-umber', 1 / TRIM_TILE_M, 0.4, 0.28, {
    tileShuffle: 0.08,
    shuffleFlipV: true,
    parallax: 0.032,
  })
  return umber
}

/**
 * Pierced Orokin screen — a stone lattice hung 6 cm in front of a flat wall
 * span, so the span reads as a silhouette with a dark recess behind it rather
 * than as a blank primitive. Alpha-tested (no sorting cost, writes depth, and
 * therefore casts a PIERCED shadow, which is most of the point).
 */
export function screenMaterial(): THREE.MeshStandardMaterial {
  if (screen) return screen
  const tex = getPiercedScreenTexture()
  const sao = getOrokinAOTexture()
  sao.channel = 0
  screen = new THREE.MeshStandardMaterial({
    color: COLORS.shrineIvoryDeep,
    // R3: a screen is the same carved stone as the wall behind it, so it gets
    // the same albedo, cavity and macro treatment. Only the alphaMap stays on
    // the mesh's own UVs — the holes have to land where the geometry says.
    map: getOrokinAlbedoTexture(),
    roughness: 0.8,
    metalness: 0.05,
    alphaMap: tex,
    transparent: false,
    alphaTest: 0.5,
    side: THREE.DoubleSide,
    normalMap: getOrokinNormalTexture(),
    roughnessMap: getOrokinRoughnessTexture(),
    aoMap: sao,
    aoMapIntensity: 1.2,
    envMapIntensity: 0.85,
  })
  screen.normalScale.set(1.4, 1.4)
  applyWorldSurface(screen, 'av-screen', 1 / TRIM_TILE_M, 0.34, 0.3, {
    macro: 0.28,
    tileShuffle: 0.06,
  })
  return screen
}

/**
 * Coffer panel — a stepped square frame with the centre punched out, used on
 * vault soffits and the deep wall bays. The hole shows the recess material
 * behind it; the frame catches the key. This is where a meaningful share of
 * the level's true darks come from.
 */
export function cofferMaterial(): THREE.MeshStandardMaterial {
  if (coffer) return coffer
  const cao = getOrokinAOTexture()
  cao.channel = 0
  coffer = new THREE.MeshStandardMaterial({
    color: COLORS.shrineIvoryDeep,
    map: getOrokinAlbedoTexture(),
    roughness: 0.84,
    metalness: 0.05,
    alphaMap: getCofferAlphaTexture(),
    alphaTest: 0.5,
    side: THREE.DoubleSide,
    normalMap: getOrokinNormalTexture(),
    roughnessMap: getOrokinRoughnessTexture(),
    aoMap: cao,
    aoMapIntensity: 1.2,
    envMapIntensity: 0.85,
  })
  coffer.normalScale.set(1.3, 1.3)
  applyWorldSurface(coffer, 'av-coffer', 1 / TRIM_TILE_M, 0.34, 0.3, {
    macro: 0.28,
    tileShuffle: 0.06,
  })
  return coffer
}

/**
 * Filigree band — gold fret run applied as an alpha-mapped decal strip along
 * column joints, arch springs and wall courses.
 */
export function fretTrimMaterial(): THREE.MeshStandardMaterial {
  if (fretTrim) return fretTrim
  const tex = getFretBandTexture()
  fretTrim = new THREE.MeshPhysicalMaterial({
    // matched to goldPolished: a filigree band is the same metal as the trim
    // it runs beside, and at #D8B25C it was reading as a painted stripe
    color: '#C29A4E',
    metalness: 1.0,
    roughness: 0.9,
    roughnessMap: getBrushedGoldRoughnessTexture(),
    normalMap: getBrushedGoldNormalTexture(),
    // R4: 3.0 → 2.4, matching the rest of the gold set. The machined sheet now
    // carries the specular; the probe only has to fill the dark side.
    // R5: 2.4 → 1.9 with the rest of the gold set, as the lobe widened.
    envMapIntensity: 1.9,
    // a filigree run is a long thin metal element: the highlight has to travel
    // along it, not sit as a dot in the middle of every cell
    anisotropy: 0.8,
    map: tex,
    alphaMap: tex,
    transparent: true,
    alphaTest: 0.35,
    side: THREE.DoubleSide,
  })
  fretTrim.normalScale.set(0.4, 0.4)
  return fretTrim
}

/** Deep Relic obsidian — near-mirror floors/props. */
export function obsidianMaterial(): THREE.MeshStandardMaterial {
  if (obsidian) return obsidian
  const m = MATERIALS.deepRelic
  const t = trimMaps()
  obsidian = new THREE.MeshStandardMaterial({
    color: m.color,
    map: t.map,
    // R5 — metalness 0.6 → 0.20, roughness 0.34 → 0.44, env 2.0 → 1.25.
    //
    // This is the material on the canyon pylons, the low walls and the big
    // curved wall masses, and in every wide frame it renders as a FLAT BLUE
    // FIELD. The cause is not the colour, it is the metalness: a metal has no
    // diffuse term at all, so at 0.6 the shader was throwing away 60 % of an
    // albedo map that carries per-plate drift, seam grime and cavity, and
    // replacing it with a near-mirror reflection of the sky — which is a
    // smooth two-stop gradient. A smooth gradient reflected in a smooth
    // surface is, by construction, a flat colour, and no amount of texture
    // authoring can survive it. Dropping to 0.20 is also physically right:
    // this is polished STONE, a dielectric, not a metal, and the previous
    // value was a gloss knob being turned with the wrong parameter.
    metalness: m.metalness * 0.34,
    roughness: 0.44,
    normalMap: t.normalMap,
    roughnessMap: t.roughnessMap,
    aoMap: t.aoMap,
    aoMapIntensity: 1.3,
    // a polished dark stone is still READ through its reflection — just a
    // broader, dimmer one that the surface detail can break up
    envMapIntensity: 1.25,
  })
  obsidian.normalScale.set(1.35, 1.35)
  applyWorldSurface(obsidian, 'av-obsidian', 1 / TRIM_TILE_M, 0.35, 0.3, {
    tileShuffle: 0.07,
    shuffleFlipV: true,
    parallax: 0.03,
    // a polished stone floor is the surface where a single roughness sheets
    // most visibly, so it gets the bimodal patch layer too — weaker than the
    // deck's, because obsidian is glossy to start with
    wet: 0.55,
  })
  return obsidian
}

/**
 * 256² emissive fleck map for debris rock: sparse gold vein squiggles on
 * black, so only the veins pick up the material's emissive color.
 */
function getRockVeinTexture(): THREE.CanvasTexture {
  if (rockVeinTex) return rockVeinTex
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, size, size)
  // thin branching gold veins
  ctx.strokeStyle = '#fff'
  ctx.lineCap = 'round'
  for (let i = 0; i < 26; i++) {
    let x = frand() * size
    let y = frand() * size
    ctx.lineWidth = 0.8 + frand() * 1.6
    ctx.beginPath()
    ctx.moveTo(x, y)
    const segs = 3 + (frand() * 4) | 0
    for (let s = 0; s < segs; s++) {
      x += (frand() - 0.5) * 42
      y += (frand() - 0.5) * 42
      ctx.lineTo(x, y)
    }
    ctx.stroke()
  }
  // sparse hot flecks
  ctx.fillStyle = '#fff'
  for (let i = 0; i < 60; i++) {
    const r = 0.5 + frand() * 1.4
    ctx.beginPath()
    ctx.arc(frand() * size, frand() * size, r, 0, Math.PI * 2)
    ctx.fill()
  }
  rockVeinTex = new THREE.CanvasTexture(canvas)
  rockVeinTex.wrapS = THREE.RepeatWrapping
  rockVeinTex.wrapT = THREE.RepeatWrapping
  rockVeinTex.colorSpace = THREE.NoColorSpace
  return rockVeinTex
}

/** Dark asteroid rock with gold vein emissive flecks (debris field). */
export function rockMaterial(): THREE.MeshStandardMaterial {
  if (rock) return rock
  const rao = getOrokinAOTexture()
  rao.channel = 0
  rock = new THREE.MeshStandardMaterial({
    color: '#22242C',
    roughness: 0.92,
    metalness: 0.18,
    // R3: debris rock had no surface maps at all — a smooth shaded blob is
    // read as a primitive from a thumbnail. The detail normal at a 1.2 m tile
    // gives it chipping and tool-free fracture grain, the cavity map darkens
    // its own crevices, and the macro layer keeps one boulder from looking
    // like the next.
    normalMap: getDetailNormalTexture(),
    roughnessMap: getOrokinRoughnessTexture(),
    aoMap: rao,
    aoMapIntensity: 1.25,
    envMapIntensity: 0.55,
    emissive: boosted(COLORS.aureate, 0.9),
    emissiveMap: getRockVeinTexture(),
    emissiveIntensity: 1.1,
  })
  rock.normalScale.set(1.5, 1.5)
  applyWorldSurface(rock, 'av-rock', 1 / 1.2, 0.45, 0, {
    macro: 0.42,
    macroRough: 0.14,
    dust: 0.34,
    soot: 0.3,
  })
  return rock
}

/** Additive translucent window glass (canyon east wall). */
export function glassMaterial(): THREE.MeshBasicMaterial {
  if (glass) return glass
  glass = new THREE.MeshBasicMaterial({
    color: '#7FB8E8',
    transparent: true,
    opacity: 0.09,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  })
  return glass
}

/**
 * Cadence teal energy veins (enemy domain). Pulsed by EnvironmentFX.
 * The alphaMap ramps the strip out at both ends so it dies into its recessed
 * channel instead of stopping on a hard cut.
 */
export function veinTealMaterial(): THREE.MeshBasicMaterial {
  if (veinTeal) return veinTeal
  veinTeal = new THREE.MeshBasicMaterial({
    color: boosted(COLORS.cadenceTeal, MATERIALS.emissiveBoost * 0.62),
    toneMapped: false,
    alphaMap: getStripFalloffTexture(),
    transparent: true,
  })
  return veinTeal
}

// ---------------------------------------------------------------------------
// R6 — the second, SOFT material family
//
// Work-order environment-art item 6. The reference frame is not a hard-surface
// level with props on it: growth, cable and cloth are load-bearing, and they
// are most of why it does not read as a CAD render. All three are authored
// here so the geometry that uses them — catenary cable runs between the gold
// fixture anchors, growth cards at wall/floor junctions, hanging cloth at the
// aperture bays — only has to place quads and tubes.
//
// None of these go through applyWorldSurface. A world-projected trim sheet is
// exactly wrong for a soft surface: cloth and cable carry their own UVs along
// their own length, and a planar projection would slide the weave across the
// fold. The world surface exists to make hard architecture agree with itself;
// this family exists to disagree with it.
// ---------------------------------------------------------------------------

let growth: THREE.MeshStandardMaterial | null = null
let cable: THREE.MeshPhysicalMaterial | null = null
let cloth: THREE.MeshPhysicalMaterial | null = null

/**
 * Alpha-tested growth card — desaturated dark green fronds, double sided.
 *
 * Alpha TESTED, not blended: it writes depth, so it sorts against everything
 * for free and casts a pierced shadow, and a pierced shadow is most of what
 * sells a card as a plant rather than as a decal.
 */
export function growthMaterial(): THREE.MeshStandardMaterial {
  if (growth) return growth
  const t = getGrowthTextures()
  growth = new THREE.MeshStandardMaterial({
    map: t.map,
    alphaMap: t.alphaMap,
    alphaTest: 0.45,
    side: THREE.DoubleSide,
    // leaves are matte on top and the level's key is hard; a low env keeps the
    // back faces from lifting into a flat silhouette
    roughness: 0.88,
    metalness: 0.0,
    envMapIntensity: 0.55,
    // a leaf is thin: without this the shadowed side is a black hole in the
    // middle of the only saturated hue in the frame
    emissive: '#0E1A0C',
    emissiveIntensity: 0.2,
  })
  return growth
}

/**
 * Sagging cable — near-black rubber with a clearcoat sheen.
 *
 * Almost no diffuse and a tight coat lobe, so the read is a single travelling
 * highlight down the top of the catenary. That highlight is the whole point:
 * it is a curve in a level made of straight lines.
 */
export function cableMaterial(): THREE.MeshPhysicalMaterial {
  if (cable) return cable
  const n = getDetailNormalTexture()
  cable = new THREE.MeshPhysicalMaterial({
    color: '#14161A',
    roughness: 0.55,
    metalness: 0.0,
    clearcoat: 0.7,
    clearcoatRoughness: 0.28,
    normalMap: n,
    envMapIntensity: 1.1,
  })
  cable.normalScale.set(0.5, 0.5)
  return cable
}

/**
 * Hanging cloth — dusty warm canvas with a sheen lobe.
 *
 * `sheen` is the term that makes cloth cloth: a broad retro-reflective rim
 * that brightens at grazing angles, which is why a hanging sheet reads soft
 * even when it is a flat quad. Double sided with flat shading off, so the
 * folds carry the form.
 */
export function clothMaterial(): THREE.MeshPhysicalMaterial {
  if (cloth) return cloth
  cloth = new THREE.MeshPhysicalMaterial({
    // dusty canvas, a value BELOW the stone it hangs against: at #6A604E it
    // rendered brighter than the wall and read as cardboard rather than cloth
    color: '#4B4336',
    roughness: 0.94,
    metalness: 0.0,
    side: THREE.DoubleSide,
    sheen: 1.0,
    sheenRoughness: 0.75,
    sheenColor: new THREE.Color('#C8B392'),
    envMapIntensity: 0.9,
    normalMap: getDetailNormalTexture(),
  })
  cloth.normalScale.set(0.35, 0.35)
  return cloth
}

/** Aureate gold energy (player/purified domain). */
export function veinGoldMaterial(): THREE.MeshBasicMaterial {
  if (veinGold) return veinGold
  veinGold = new THREE.MeshBasicMaterial({
    color: boosted(COLORS.aureate),
    toneMapped: false,
    alphaMap: getStripFalloffTexture(),
    transparent: true,
  })
  return veinGold
}

/**
 * Purification veins — Reliquary cables, planter soil, gate flash.
 * EnvironmentFX lerps this color teal → gold with channelProgress.
 */
export function purifyVeinMaterial(): THREE.MeshBasicMaterial {
  if (purifyVein) return purifyVein
  purifyVein = new THREE.MeshBasicMaterial({
    color: boosted(COLORS.cadenceTeal, MATERIALS.emissiveBoost * 0.62),
    toneMapped: false,
  })
  return purifyVein
}

/** Arena floor medallion — gold, intensity pulses with wave state. */
export function medallionMaterial(): THREE.MeshBasicMaterial {
  if (medallion) return medallion
  medallion = new THREE.MeshBasicMaterial({ color: boosted(COLORS.aureate), toneMapped: false })
  return medallion
}

/** Enemy spawn-door glow rings — teal, flares during EXTERMINATE waves. */
export function doorGlowMaterial(): THREE.MeshBasicMaterial {
  if (doorGlow) return doorGlow
  doorGlow = new THREE.MeshBasicMaterial({
    color: boosted(COLORS.cadenceTeal, MATERIALS.emissiveBoost * 0.62),
    toneMapped: false,
  })
  return doorGlow
}

/** Bridge-gate gold seal — fades/dissolves when phase reaches EXTRACT. */
export function sealMaterial(): THREE.MeshBasicMaterial {
  if (seal) return seal
  seal = new THREE.MeshBasicMaterial({
    color: boosted(COLORS.aureate, 1.4),
    transparent: true,
    opacity: 0.9,
    toneMapped: false,
    side: THREE.DoubleSide,
  })
  return seal
}

/** Teal Cadence glyph decal sprite (corruption sites). */
export function glyphDecalMaterial(): THREE.MeshBasicMaterial {
  if (glyphDecal) return glyphDecal
  glyphDecal = new THREE.MeshBasicMaterial({
    map: getGlyphSpriteTexture(),
    color: COLORS.cadenceTeal,
    transparent: true,
    // R1: corruption glyphs were reading as flat green rectangles; they are a
    // stain on the architecture, not a light source
    opacity: 0.38,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  })
  return glyphDecal
}

/** Cloth-sway banner shader — indigo cloth, gold glyph. uTime driven by EnvironmentFX. */
export function bannerMaterial(): THREE.ShaderMaterial {
  if (banner) return banner
  banner = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uMap: { value: getGlyphSpriteTexture() },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vN;
      varying vec3 vW;
      uniform float uTime;
      void main() {
        vUv = uv;
        vec3 p = position;
        float sway = 1.0 - uv.y; // anchored at top edge
        // R6: the sway derivative is taken ANALYTICALLY and folded into the
        // normal. Without it the cloth waves while its shading stays nailed to
        // the flat quad, which is a worse read than not waving at all — the
        // eye tracks the silhouette moving against a static highlight and
        // immediately calls it a billboard.
        float ax = sin( uTime * 1.3 + p.y * 1.5 ) * 0.10;
        float az = cos( uTime * 1.1 + p.y * 2.0 ) * 0.14;
        p.x += ax * sway;
        p.z += az * sway;
        float dx = cos( uTime * 1.3 + p.y * 1.5 ) * 1.5 * 0.10 * sway - ax;
        float dz = -sin( uTime * 1.1 + p.y * 2.0 ) * 2.0 * 0.14 * sway - az;
        vec3 n = normalize( normal + vec3( -dx, 0.0, -dz ) * 0.8 );
        vec4 wp = vec4( p, 1.0 );
        mat3 nm = mat3( modelMatrix );
        #ifdef USE_INSTANCING
          wp = instanceMatrix * wp;
          nm = nm * mat3( instanceMatrix );
        #endif
        wp = modelMatrix * wp;
        vN = normalize( nm * n );
        vW = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vN;
      varying vec3 vW;
      uniform sampler2D uMap;
      void main() {
        // R6: the cloth was INDIGO — vec3(0.055,0.075,0.16). The panel's
        // second named difference from the reference is that the reference
        // has no blue pixel in it, and a hanging banner is a large, soft,
        // saturated area of exactly the wrong hue. It is now dusty warm
        // canvas: the same family as the level's stone, a value darker.
        vec3 cloth = mix( vec3( 0.052, 0.040, 0.026 ), vec3( 0.145, 0.116, 0.074 ), vUv.y );
        float g = texture2D( uMap, vUv ).r;
        vec3 col = mix( cloth, vec3( 0.52, 0.37, 0.13 ), g * 0.95 );
        // gold hem
        col = mix( col, vec3( 0.46, 0.33, 0.12 ), smoothstep( 0.06, 0.0, abs( vUv.y - 0.02 ) ) * 0.8 );

        // --- lighting. Map item E19: this sat among lit geometry with no
        // lighting term at all, so it read as a decal however it was coloured.
        // A hand-written ShaderMaterial gets none of three's lighting, so the
        // terms are written out: a wrapped lambert against the level's warm
        // key, a hemispheric fill, and the SHEEN rim that makes cloth cloth —
        // a broad grazing-angle brightening, which is the one cue that
        // separates a hanging sheet from a painted board.
        vec3 N = normalize( vN );
        vec3 V = normalize( cameraPosition - vW );
        N = faceforward( N, -V, N );
        vec3 L = normalize( vec3( -0.42, 0.78, 0.46 ) );
        float wrap = clamp( ( dot( N, L ) + 0.45 ) / 1.45, 0.0, 1.0 );
        float sheen = pow( 1.0 - abs( dot( N, V ) ), 2.6 );
        vec3 lit = col * ( 0.30 + 1.45 * wrap )
          + col * vec3( 0.16, 0.15, 0.13 ) * ( 0.5 + 0.5 * N.y )
          + vec3( 0.26, 0.21, 0.14 ) * sheen * ( 0.25 + 0.75 * wrap );

        // R2: a hand-written ShaderMaterial gets NONE of three's output
        // pipeline — no tone map, no output colour-space conversion. This one
        // was writing raw linear values into an sRGB target, so a deep indigo
        // banner rendered as a pale blue-grey rectangle sitting several stops
        // off every lit surface around it. These two includes put it back in
        // the same space as the rest of the frame.
        gl_FragColor = vec4( lit, 1.0 );
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    side: THREE.DoubleSide,
  })
  return banner
}

// ---------------------------------------------------------------------------
// Floor panel/grating texture (fix2) — kills the "Tron vector art" flat black
// ---------------------------------------------------------------------------
let floor: THREE.MeshStandardMaterial | null = null
let floorMapTex: THREE.CanvasTexture | null = null
let floorRoughTex: THREE.CanvasTexture | null = null
let floorNormalTex: THREE.CanvasTexture | null = null
let floorAoTex: THREE.CanvasTexture | null = null
let floorHeightTex: THREE.CanvasTexture | null = null
let goldEdge: THREE.MeshStandardMaterial | null = null
let grooveTex: THREE.CanvasTexture | null = null
let groove: THREE.MeshBasicMaterial | null = null

/**
 * 512² obsidian floor paneling. One tile = 4 m (sampled with world-space UVs,
 * see floorMaterial). 4×4 structural panels with dark seams, per-panel value
 * jitter, occasional grate cells and edge wear — so large floors read as
 * built surfaces, not a single flat vector fill.
 */
/**
 * Deterministic hash in place of Math.random for the floor sheet.
 * R4: the deck was baked from Math.random, so every reload produced a
 * different floor and no QA capture could be compared against the previous
 * one. Same distribution, stable across runs.
 */
let floorSeed = 0
function frand(): number {
  floorSeed = (floorSeed * 1664525 + 1013904223) >>> 0
  return floorSeed / 4294967296
}

function makeFloorCanvases(): [HTMLCanvasElement, HTMLCanvasElement] {
  floorSeed = 0x9e3779b9
  const size = 512
  const alb = document.createElement('canvas')
  alb.width = alb.height = size
  const a = alb.getContext('2d')!
  const rgh = document.createElement('canvas')
  rgh.width = rgh.height = size
  const r = rgh.getContext('2d')!

  // base obsidian / mid-rough
  a.fillStyle = '#12141A'
  a.fillRect(0, 0, size, size)
  r.fillStyle = 'rgb(150,150,150)'
  r.fillRect(0, 0, size, size)

  // per-pixel micro variation (roughness only, subtle albedo noise)
  const img = a.getImageData(0, 0, size, size)
  const rimg = r.getImageData(0, 0, size, size)
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (frand() - 0.5) * 7
    img.data[i] += n
    img.data[i + 1] += n
    img.data[i + 2] += n + frand() * 2
    const rn = (frand() - 0.5) * 34
    rimg.data[i] += rn
    rimg.data[i + 1] += rn
    rimg.data[i + 2] += rn
  }
  a.putImageData(img, 0, 0)
  r.putImageData(rimg, 0, 0)

  const cell = size / 4 // 4×4 panels = 1 m each
  // per-panel value jitter + occasional grate insets
  for (let py = 0; py < 4; py++) {
    for (let px = 0; px < 4; px++) {
      const jx = px * cell
      const jy = py * cell
      // panel value jitter
      const v = (frand() - 0.5) * 10
      a.fillStyle = `rgba(${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${v > 0 ? 255 : 8},${Math.abs(v) / 255})`
      a.fillRect(jx, jy, cell, cell)
      const rv = 140 + frand() * 40
      r.fillStyle = `rgba(${rv},${rv},${rv},0.35)`
      r.fillRect(jx, jy, cell, cell)
      // grate inset on ~1/3 of panels: recessed cell grid, rougher
      if (frand() < 0.34) {
        const m = 14 // inset margin
        const gx = jx + m
        const gy = jy + m
        const gw = cell - m * 2
        a.fillStyle = '#0B0D12'
        a.fillRect(gx, gy, gw, gw)
        r.fillStyle = 'rgb(210,210,210)'
        r.fillRect(gx, gy, gw, gw)
        const bars = 6
        const bw = gw / bars
        for (let b = 1; b < bars; b++) {
          a.fillStyle = '#1B202A'
          a.fillRect(gx + b * bw - 1.5, gy + 3, 3, gw - 6)
          a.fillRect(gx + 3, gy + b * bw - 1.5, gw - 6, 3)
          r.fillStyle = 'rgb(110,110,110)'
          r.fillRect(gx + b * bw - 1.5, gy + 3, 3, gw - 6)
          r.fillRect(gx + 3, gy + b * bw - 1.5, gw - 6, 3)
        }
        // grate frame highlight (top/left catch light)
        a.fillStyle = 'rgba(70,80,100,0.5)'
        a.fillRect(gx, gy, gw, 2)
        a.fillRect(gx, gy, 2, gw)
      } else if (frand() < 0.4) {
        // plain panel: small corner bolts / wear ticks
        a.fillStyle = 'rgba(58,64,78,0.6)'
        const b = 7
        for (const [bx, by] of [
          [jx + b, jy + b],
          [jx + cell - b, jy + b],
          [jx + b, jy + cell - b],
          [jx + cell - b, jy + cell - b],
        ]) {
          a.beginPath()
          a.arc(bx, by, 2.2, 0, Math.PI * 2)
          a.fill()
        }
      }
    }
  }

  // panel seams — dark, rough (drawn last so they sit on top)
  for (let i = 0; i <= 4; i++) {
    const p = i * cell
    a.fillStyle = '#06070B'
    a.fillRect(p - 1.5, 0, 3, size)
    a.fillRect(0, p - 1.5, size, 3)
    r.fillStyle = 'rgb(225,225,225)'
    r.fillRect(p - 1.5, 0, 3, size)
    r.fillRect(0, p - 1.5, size, 3)
    // seam edge highlight (worn metal lip catching the key light)
    a.fillStyle = 'rgba(52,58,72,0.55)'
    a.fillRect(p + 1.5, 0, 1, size)
    a.fillRect(0, p + 1.5, size, 1)
  }

  return [alb, rgh]
}

/**
 * Textured obsidian floor: panel/grating map + roughnessMap. UVs are derived
 * from world position in the shader (1 tile = 4 m, dominant-axis planar
 * projection) so the same material works on any sized box without stretching.
 */
export function floorMaterial(): THREE.MeshStandardMaterial {
  if (floor) return floor
  if (!floorMapTex) {
    const [alb, rgh] = makeFloorCanvases()
    floorMapTex = new THREE.CanvasTexture(alb)
    floorMapTex.wrapS = floorMapTex.wrapT = THREE.RepeatWrapping
    floorMapTex.colorSpace = THREE.SRGBColorSpace
    floorMapTex.anisotropy = 16
    floorRoughTex = new THREE.CanvasTexture(rgh)
    floorRoughTex.wrapS = floorRoughTex.wrapT = THREE.RepeatWrapping
    floorRoughTex.colorSpace = THREE.NoColorSpace
    floorRoughTex.anisotropy = 16
    // relief straight off the albedo's own value structure: seams become
    // grooves, grate bars become ribs, bolts become domes
    floorNormalTex = normalFromLuminance(alb, 2.6)
    // and a cavity map off the same value structure, so panel seams and grate
    // wells darken under the key instead of only shading
    floorAoTex = cavityFromLuminance(alb, 5, 2.8)
    // R5: and a height field off the same structure, for the parallax march.
    // The deck is seen at a grazing angle in almost every frame, which is the
    // exact geometry where a normal map alone gives nothing away — the grate
    // wells now actually recede instead of being a darker painted square.
    floorHeightTex = heightFromLuminance(alb, 0.02, 0.2)
  }
  const m = MATERIALS.deepRelic
  if (floorAoTex) floorAoTex.channel = 0
  floor = new THREE.MeshStandardMaterial({
    color: '#9E9EA6', // albedo comes from the map; pulled down for value depth
    map: floorMapTex,
    roughnessMap: floorRoughTex,
    normalMap: floorNormalTex ?? undefined,
    aoMap: floorAoTex ?? undefined,
    aoMapIntensity: 1.3,
    // R6: 0.9 → 1.0. The DRY end of the deck has to be genuinely matte for
    // the wet patches to read as a second population rather than as a slightly
    // shinier version of the same one; × map (~0.45–0.88) lands the dry base
    // at ~0.5–0.88 and the `wet` term pins the patches at 0.14.
    roughness: 1.0,
    metalness: m.metalness * 0.6,
    // the deck is 30–40 % of most frames and it is a polished dark stone: the
    // environment is most of what it should be showing
    envMapIntensity: 1.6,
  })
  // R2: 0.7 → 1.6. The floor is 30–40 % of most frames; its seams and grate
  // bars have to model under the key, not just tint.
  floor.normalScale.set(1.6, 1.6)
  // 1 tile = 3 m, world-space projection (same helper as the stone surfaces),
  // plus the 0.25 m detail layer so the deck under the player is not flat
  applyWorldSurface(floor, 'av-floor', 1 / 3, 0.35, 0.3, {
    // the deck reads at a grazing angle across a long run, which is where a
    // repeating tile is most obvious — so the macro layer works hardest here
    macro: 0.44,
    macroRough: 0.22,
    dust: 0.26,
    soot: 0.0,
    // and the shuffle works hardest here too: a 3 m deck tile repeats ~20×
    // across the arena floor in a single frame
    tileShuffle: 0.08,
    shuffleFlipV: true,
    // 2.5 cm of relief: a recessed grate well and a 3 mm seam. Marched against
    // the deck's OWN height field, not the wall sheet's.
    parallax: 0.025,
    parallaxMap: floorHeightTex,
    // a floor is horizontal, so the gravity streaks would be masked out
    // anyway; spend the fetch somewhere it can be seen
    drip: 0,
    // R6 — the deck is 30–40 % of most frames and it was the surface whose
    // specular sheeted worst: one roughness across a 40 m run means one
    // gradient crossing the whole floor as the camera turns. `wet` makes the
    // distribution bimodal (matte base, 0.14 patches at a ~3 m period biased
    // into the low points), which is the work order's floor item.
    pool: 0.68,
    patina: 0.26,
    wear: 0.5,
    wet: 0.95,
  })
  return floor
}

/**
 * Sobel a canvas' luminance into a tangent-space normal map. Used for the
 * floor (and any other authored albedo whose value structure IS its relief).
 */
function normalFromLuminance(src: HTMLCanvasElement, strength: number): THREE.CanvasTexture {
  const size = src.width
  const sctx = src.getContext('2d')!
  const d = sctx.getImageData(0, 0, size, size).data
  const h = new Float32Array(size * size)
  for (let i = 0; i < h.length; i++) {
    h[i] = (d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114) / 255
  }
  const at = (x: number, y: number) =>
    h[(((y % size) + size) % size) * size + (((x % size) + size) % size)]
  const out = document.createElement('canvas')
  out.width = out.height = size
  const octx = out.getContext('2d')!
  const img = octx.createImageData(size, size)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      let nx = (at(x - 1, y) - at(x + 1, y)) * strength
      let ny = (at(x, y - 1) - at(x, y + 1)) * strength
      const inv = 1 / Math.sqrt(nx * nx + ny * ny + 1)
      nx *= inv
      ny *= inv
      img.data[i] = (nx * 0.5 + 0.5) * 255
      img.data[i + 1] = (ny * 0.5 + 0.5) * 255
      img.data[i + 2] = inv * 255
      img.data[i + 3] = 255
    }
  }
  octx.putImageData(img, 0, 0)
  const t = new THREE.CanvasTexture(out)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.colorSpace = THREE.NoColorSpace
  t.anisotropy = 4
  return t
}

/**
 * Cavity/AO from a canvas' luminance: a texel darker than its neighbourhood is
 * in a crevice. Same principle as the trim sheet's bake, run on an authored
 * albedo whose value structure IS its relief.
 */
/**
 * Height field straight off a canvas' luminance, contrast-stretched so the
 * parallax march has a full 0–1 band to work in.
 *
 * The deck's relief is authored as VALUE in its albedo — seams are dark, grate
 * wells are darker, bolt heads are light — so its luminance already is its
 * height field, the same assumption `normalFromLuminance` makes. Inverting
 * that relationship would push the seams proud of the panels.
 */
function heightFromLuminance(src: HTMLCanvasElement, lo: number, hi: number): THREE.CanvasTexture {
  const size = src.width
  const d = src.getContext('2d')!.getImageData(0, 0, size, size).data
  const out = document.createElement('canvas')
  out.width = out.height = size
  const octx = out.getContext('2d')!
  const img = octx.createImageData(size, size)
  for (let i = 0; i < size * size; i++) {
    const j = i * 4
    const l = (d[j] * 0.299 + d[j + 1] * 0.587 + d[j + 2] * 0.114) / 255
    const v = Math.min(1, Math.max(0, (l - lo) / (hi - lo)))
    img.data[j] = img.data[j + 1] = img.data[j + 2] = v * 255
    img.data[j + 3] = 255
  }
  octx.putImageData(img, 0, 0)
  const t = new THREE.CanvasTexture(out)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.colorSpace = THREE.NoColorSpace
  t.anisotropy = 4
  return t
}

function cavityFromLuminance(
  src: HTMLCanvasElement,
  radius: number,
  gain: number,
): THREE.CanvasTexture {
  const size = src.width
  const d = src.getContext('2d')!.getImageData(0, 0, size, size).data
  const h = new Float32Array(size * size)
  for (let i = 0; i < h.length; i++) {
    h[i] = (d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114) / 255
  }
  const at = (x: number, y: number) =>
    h[(((y % size) + size) % size) * size + (((x % size) + size) % size)]
  const out = document.createElement('canvas')
  out.width = out.height = size
  const octx = out.getContext('2d')!
  const img = octx.createImageData(size, size)
  const step = Math.max(1, Math.round(radius / 2))
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let sum = 0
      let n = 0
      for (let oy = -radius; oy <= radius; oy += step) {
        for (let ox = -radius; ox <= radius; ox += step) {
          sum += at(x + ox, y + oy)
          n++
        }
      }
      const cav = h[y * size + x] - sum / n
      const ao = Math.min(1, Math.max(0.2, 1 + cav * gain))
      const i = (y * size + x) * 4
      img.data[i] = img.data[i + 1] = img.data[i + 2] = ao * 255
      img.data[i + 3] = 255
    }
  }
  octx.putImageData(img, 0, 0)
  const t = new THREE.CanvasTexture(out)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.colorSpace = THREE.NoColorSpace
  t.anisotropy = 4
  return t
}

/**
 * Bright gold edge-highlight for raised floor trims — lighter than regalGold,
 * non-emissive so it catches the key light without crossing the bloom
 * threshold.
 */
export function goldEdgeMaterial(): THREE.MeshStandardMaterial {
  if (goldEdge) return goldEdge
  const orm = getGoldORMTexture()
  orm.channel = 0
  goldEdge = new THREE.MeshPhysicalMaterial({
    // still the brightest gold in the level, but no longer near-white: these
    // are 3.5 cm lips seen edge-on, and at #EFCF8E they were a solid pale
    // line that flattened every nosing into a sticker
    color: '#D8AE5C',
    map: getGoldAlbedoTexture(),
    metalness: 1.0,
    metalnessMap: orm,
    roughness: 0.8, // × the 0.115–0.62 map ⇒ ~0.09–0.50, the tightest ramp here
    roughnessMap: orm,
    // R4: a nosing with no cavity term is a sticker. The ORM's R channel bottoms
    // at 0.34 in the groove floors, which is what separates the lip from the
    // channel behind it when both are catching the same key.
    aoMap: orm,
    aoMapIntensity: 1.15,
    normalMap: getBrushedGoldNormalTexture(),
    envMapIntensity: 2.1,
    // the strongest lobe in the level: a nosing is a 3.5 cm lip seen nearly
    // edge-on, and an anisotropic streak running ALONG it is exactly the
    // read that makes a metal edge legible at 20 m
    anisotropy: 0.72,
  })
  goldEdge.normalScale.set(0.62, 0.62)
  // a 0.5 m tile, so the brush is fine enough to sit on a 3.5 cm lip without
  // the 256² brush map beating against itself into a visible weave
  applyWorldSurface(goldEdge, 'av-gold-edge', 1 / 0.5, 0.4, 0, {
    macro: 0.09,
    macroRough: 0.06,
    dust: 0.14,
    soot: 0.26,
    // a 3.5 cm nosing is the one thing in the level that stays clean
    drip: 0.1,
  })
  return goldEdge
}

/**
 * Arena radial-groove etching: 1024² canvas, concentric etched rings + rays
 * emanating from arena center. White strokes with soft alpha; tinted gold by
 * the material (× 1.2, toneMapped:false — deliberately LOW so it stays under
 * the bloom threshold and reads as faintly glowing etching, not a blowout).
 */
export function arenaGrooveMaterial(): THREE.MeshBasicMaterial {
  if (groove) return groove
  if (!grooveTex) {
    const size = 1024
    const c = document.createElement('canvas')
    c.width = c.height = size
    const ctx = c.getContext('2d')!
    const cx = size / 2
    ctx.clearRect(0, 0, size, size)
    ctx.strokeStyle = '#fff'
    ctx.lineCap = 'round'
    // concentric etched rings (skip a few — broken archaeology)
    for (let i = 0; i < 9; i++) {
      const rr = 70 + i * 48
      if (i === 4) continue
      ctx.globalAlpha = 0.32 - i * 0.02
      ctx.lineWidth = i % 3 === 0 ? 3.5 : 1.8
      ctx.beginPath()
      // dashed arcs so rings read as carved segments, not perfect circles
      const segs = 10 + i * 2
      for (let s = 0; s < segs; s++) {
        const a0 = (s / segs) * Math.PI * 2
        const a1 = a0 + (Math.PI * 2 / segs) * 0.72
        ctx.arc(cx, cx, rr, a0, a1)
        ctx.moveTo(cx + Math.cos(a1) * rr, cx + Math.sin(a1) * rr)
      }
      ctx.stroke()
    }
    // radial rays
    const rays = 24
    for (let i = 0; i < rays; i++) {
      const ang = (i / rays) * Math.PI * 2
      const long = i % 3 === 0
      ctx.globalAlpha = long ? 0.3 : 0.16
      ctx.lineWidth = long ? 2.4 : 1.4
      ctx.beginPath()
      ctx.moveTo(cx + Math.cos(ang) * 78, cx + Math.sin(ang) * 78)
      ctx.lineTo(cx + Math.cos(ang) * (long ? 440 : 300), cx + Math.sin(ang) * (long ? 440 : 300))
      ctx.stroke()
      // ray-end tick
      if (long) {
        ctx.globalAlpha = 0.28
        ctx.beginPath()
        ctx.arc(cx + Math.cos(ang) * 448, cx + Math.sin(ang) * 448, 5, 0, Math.PI * 2)
        ctx.stroke()
      }
    }
    ctx.globalAlpha = 1
    grooveTex = new THREE.CanvasTexture(c)
    grooveTex.colorSpace = THREE.NoColorSpace
    grooveTex.anisotropy = 4
  }
  groove = new THREE.MeshBasicMaterial({
    map: grooveTex,
    // R2: 1.2 → 0.4. The arena floor mandala is now real inlaid geometry
    // (recessed channels + gold spokes), so this etch pass is a faint
    // secondary read on top of it rather than the whole ornament.
    color: boosted(COLORS.aureate, 0.4),
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  })
  return groove
}

// ---------------------------------------------------------------------------
// Color scratch for EnvironmentFX lerps (HDR-boosted so pulses stay in bloom
// range).
//
// R2 colour script: these two are NOT boosted equally any more. Gold is the
// player's own energy and the shrine's light, so it stays at the full
// MATERIALS.emissiveBoost. Cadence teal is corruption — a stain on the
// architecture — and at the same boost the Reliquary cables and vein clusters
// were the brightest objects in the shrine, which is exactly backwards for a
// frame that is supposed to be ~75 % ivory and gold. Teal drops to 0.62 of the
// boost, so it still crosses the bloom knee and still reads as unstable
// energy, but it no longer out-shines the room it is infecting.
// ---------------------------------------------------------------------------
export const TEAL_COLOR = boosted(COLORS.cadenceTeal, MATERIALS.emissiveBoost * 0.62)
export const GOLD_COLOR = boosted(COLORS.aureate)

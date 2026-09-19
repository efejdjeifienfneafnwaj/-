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
 * into "one texture". A second map an order of magnitude larger — ~6.5 trim
 * periods — modulating albedo value and roughness makes one bay of wall
 * measurably different from the next, which is how real cast panelling
 * weathers, and it buries the trim period underneath itself.
 */
export const MACRO_TILE_M = 13.0

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
  /** mirror in V as well as U. Off by default: it flips drawn gravity stains. */
  shuffleFlipV?: boolean
}

const SURFACE_DEFAULTS: Required<SurfaceOpts> = {
  macro: 0.34,
  macroRough: 0.18,
  dust: 0.3,
  soot: 0.42,
  tileShuffle: 0,
  shuffleFlipV: false,
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
 * `avSheetFlip` mirror sign; the normal map must apply it to X/Y or a mirrored
 *              tile lights with its bevels inverted.
 */
const AV_SURFACE_PARS = /* glsl */ `
vec2 avSurfUv;
vec2 avSheetUv;
vec2 avSheetFlip;
vec2 avSheetDx;
vec2 avSheetDy;
float avTileJitter;
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
  return vec3( n.xy * avSheetFlip, n.z );
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
  // Second macro octave at ~3.4× the frequency (≈3.8 m against 13 m). One
  // octave alone is a slow swell that the eye reads as lighting, not as
  // material; the second gives it bay-to-bay structure at architectural scale.
  const macroRepeat2 = (uvScale > 0 ? 3.37 / MACRO_TILE_M / uvScale : 0).toFixed(6)
  const useMacro = o.macro > 0 || o.macroRough > 0
  const macroMean = getMacroMean().toFixed(4)
  const shuffle = o.tileShuffle > 0
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${AV_VARYINGS}`)
      .replace('#include <uv_vertex>', chunk)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${AV_VARYINGS}${AV_SURFACE_PARS}`)

    // --- macro variation + deposition, injected right after the albedo read ---
    if (useMacro || o.dust > 0 || o.soot > 0) {
      shader.uniforms.avMacroMap = { value: getMacroVariationTexture() }
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>\n' + AV_VARYINGS,
          '#include <common>\n' + AV_VARYINGS + '\nuniform sampler2D avMacroMap;',
        )
        .replace(
          '#include <map_fragment>',
          /* glsl */ `
        #include <map_fragment>
        float avMacro = texture2D( avMacroMap, avSurfUv * ${macroRepeat} ).r - ${macroMean};
        avMacro += ( texture2D( avMacroMap, avSurfUv * ${macroRepeat2} + 0.37 ).r - ${macroMean} ) * 0.5;
        diffuseColor.rgb *= 1.0 + avMacro * ${o.macro.toFixed(3)};
        float avUp = clamp( vAvN.y, -1.0, 1.0 );
        float avDust = max( 0.0, avUp ) * ${o.dust.toFixed(3)};
        float avSoot = max( 0.0, -avUp ) * ${o.soot.toFixed(3)};
        diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * vec3( 1.11, 1.06, 0.97 ), avDust );
        diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * vec3( 0.50, 0.49, 0.50 ), avSoot );
        // Vertical deposition ramp: everything in a 30 m hall is dirtier at the
        // plinth and cleaner at the clerestory, and a top-to-bottom value ramp
        // is most of what stops a tall wall reading as one flat slab. Keyed to
        // WORLD y so it is continuous across every mesh that makes up the wall.
        diffuseColor.rgb *= mix( ${(1 - o.soot * 0.62).toFixed(3)}, 1.06, clamp( vAvW.y / 16.0, 0.0, 1.0 ) );
        `,
        )
        .replace(
          '#include <roughnessmap_fragment>',
          /* glsl */ `
        #include <roughnessmap_fragment>
        roughnessFactor = clamp(
          roughnessFactor + avMacro * ${o.macroRough.toFixed(3)} + avDust * 0.20,
          0.035, 1.0 );
        `,
        )
    }

    if (aoBite > 0) {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <map_fragment>',
        /* glsl */ `
        #include <map_fragment>
        #ifdef USE_AOMAP
          float avAo = avSheetTex( aoMap ).r;
          diffuseColor.rgb *= mix( 1.0, avAo, ${aoBite.toFixed(3)} );
        #endif
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
          ${
            shuffle
              ? /* glsl */ `
          vec2 avCell = floor( avSurfUv );
          vec4 avR = avCellHash( avCell );
          // mirror in U (and optionally V). 1 - f maps 0→1 and 0.5→0.5, so a
          // panel boundary always lands on a panel boundary and the seam
          // trenches stay continuous across the cell edge.
          vec2 avMir = vec2( step( 0.5, avR.x ), ${o.shuffleFlipV ? 'step( 0.5, avR.w )' : '0.0'} );
          vec2 avF = fract( avSurfUv );
          avF = mix( avF, 1.0 - avF, avMir );
          // half-tile shift = one authored 1 m plate, so the four plates are
          // dealt into different quadrants tile to tile
          avF += step( 0.5, avR.yz ) * 0.5;
          avSheetUv = avF;
          avSheetFlip = 1.0 - 2.0 * avMir;
          avTileJitter = ( avR.x + avR.y + avR.z + avR.w ) * 0.5 - 1.0;
          `
              : /* glsl */ `
          avSheetUv = avSurfUv;
          avSheetFlip = vec2( 1.0 );
          avTileJitter = 0.0;
          `
          }
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
    roughness: 0.82,
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
    macro: 0.34,
    macroRough: 0.18,
    // R4: the wall the panel called "one panel stamped in a perfect 20×8 grid"
    // is this material. Eight per-tile permutations of the sheet plus a ±7 %
    // per-tile value offset break the lattice without touching geometry.
    tileShuffle: 0.07,
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
    roughness: 0.82,
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
    macro: 0.34,
    macroRough: 0.18,
    tileShuffle: 0.07,
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
    color: '#AE8438',
    map: getGoldAlbedoTexture(),
    metalness: 1.0,
    metalnessMap: orm,
    // the map is authored at its final 0.045–0.92 band, so the multiplier is 1
    roughness: 1.0,
    roughnessMap: orm,
    aoMap: orm,
    aoMapIntensity: 1.25,
    normalMap: getBrushedGoldNormalTexture(),
    envMapIntensity: 2.6,
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
    color: '#8E6C2C',
    map: getGoldAlbedoTexture(),
    metalness: 0.98,
    metalnessMap: orm,
    // R4: 1.3 → 1.12. The ORM's own band already reaches 0.92 in the groove
    // floors; multiplying that by 1.3 clipped two thirds of the sheet to fully
    // matte and threw away the land/groove contrast that makes it read as
    // metal. 1.12 gives ~0.05–1.0 with the polished lands intact.
    roughness: 1.12,
    roughnessMap: orm,
    aoMap: orm,
    aoMapIntensity: 1.25,
    normalMap: getBrushedGoldNormalTexture(),
    envMapIntensity: 2.2,
    // broader runs of cast metal, so a slightly softer lobe than the polished
    anisotropy: 0.6,
  })
  goldCast.normalScale.set(1.05, 1.05)
  applyWorldSurface(goldCast, 'av-gold-cast', 1 / 0.9, 0.55, 0, {
    macro: 0.13,
    macroRough: 0.1,
    dust: 0.2,
    soot: 0.34,
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
  applyWorldSurface(umber, 'av-umber', 1 / TRIM_TILE_M, 0.4, 0.28, { tileShuffle: 0.08 })
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
    color: '#AE8438',
    metalness: 1.0,
    roughness: 0.85,
    roughnessMap: getBrushedGoldRoughnessTexture(),
    normalMap: getBrushedGoldNormalTexture(),
    // R4: 3.0 → 2.4, matching the rest of the gold set. The machined sheet now
    // carries the specular; the probe only has to fill the dark side.
    envMapIntensity: 2.4,
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
    metalness: m.metalness,
    roughness: 0.34,
    normalMap: t.normalMap,
    roughnessMap: t.roughnessMap,
    aoMap: t.aoMap,
    // a polished dark stone is READ through its reflection; without this it is
    // just a dark grey card
    envMapIntensity: 2.0,
  })
  obsidian.normalScale.set(1.15, 1.15)
  applyWorldSurface(obsidian, 'av-obsidian', 1 / TRIM_TILE_M, 0.35, 0.3, { tileShuffle: 0.07 })
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
      uniform float uTime;
      void main() {
        vUv = uv;
        vec3 p = position;
        float sway = 1.0 - uv.y; // anchored at top edge
        p.x += sin(uTime * 1.3 + p.y * 1.5) * 0.10 * sway;
        p.z += cos(uTime * 1.1 + p.y * 2.0) * 0.14 * sway;
        vec4 wp = vec4(p, 1.0);
        #ifdef USE_INSTANCING
          wp = instanceMatrix * wp;
        #endif
        gl_Position = projectionMatrix * modelViewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      uniform sampler2D uMap;
      void main() {
        vec3 cloth = mix(vec3(0.055, 0.075, 0.16), vec3(0.086, 0.133, 0.29), vUv.y);
        float g = texture2D(uMap, vUv).r;
        vec3 col = mix(cloth, vec3(0.85, 0.68, 0.30), g * 0.95);
        // gold hem
        col = mix(col, vec3(0.79, 0.64, 0.29), smoothstep(0.06, 0.0, abs(vUv.y - 0.02)) * 0.8);
        // R2: a hand-written ShaderMaterial gets NONE of three's output
        // pipeline — no tone map, no output colour-space conversion. This one
        // was writing raw linear values into an sRGB target, so a deep indigo
        // banner rendered as a pale blue-grey rectangle sitting several stops
        // off every lit surface around it. These two includes put it back in
        // the same space as the rest of the frame.
        gl_FragColor = vec4(col, 1.0);
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
    roughness: 0.9, // × map (~0.45–0.88) → matte panels, glossier grate bars
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
    color: '#C79A45',
    map: getGoldAlbedoTexture(),
    metalness: 1.0,
    metalnessMap: orm,
    roughness: 0.8, // × the 0.045–0.92 map ⇒ ~0.04–0.74, the narrowest ramp here
    roughnessMap: orm,
    // R4: a nosing with no cavity term is a sticker. The ORM's R channel bottoms
    // at 0.34 in the groove floors, which is what separates the lip from the
    // channel behind it when both are catching the same key.
    aoMap: orm,
    aoMapIntensity: 1.15,
    normalMap: getBrushedGoldNormalTexture(),
    envMapIntensity: 2.8,
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

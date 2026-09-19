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

/**
 * Wire a standard material to the world-space trim-sheet projection.
 *
 * `aoBite`  additionally multiplies the AO map into albedo (0 = off). PBR-pure
 *           aoMap only touches indirect light; this level is lit by one hard
 *           key, so without this bite a seam under direct light is not dark.
 * `detail`  strength of the ~0.25 m micro-detail normal layer blended on top
 *           of the panel normal (0 = off). One extra texture fetch; it is what
 *           keeps a wall from going flat as the player walks up to it.
 */
function applyWorldSurface(
  mat: THREE.MeshStandardMaterial,
  key: string,
  uvScale: number,
  aoBite = 0,
  detail = 0,
) {
  const chunk = worldUvChunk(uvScale)
  const detailRepeat = (uvScale > 0 ? 1 / DETAIL_TILE_M / uvScale : 0).toFixed(5)
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace('#include <uv_vertex>', chunk)
    if (aoBite > 0) {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <map_fragment>',
        /* glsl */ `
        #include <map_fragment>
        #ifdef USE_AOMAP
          float avAo = texture2D( aoMap, vAoMapUv ).r;
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
            vec3 avDn = texture2D( avDetailMap, vNormalMapUv * ${detailRepeat} ).xyz * 2.0 - 1.0;
            normal = normalize( normal + tbn * vec3( avDn.xy * ${detail.toFixed(3)}, 0.0 ) );
          }
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
    roughness: 0.82,
    metalness: 0.04,
    normalMap: t.normalMap,
    roughnessMap: t.roughnessMap,
    aoMap: t.aoMap,
    aoMapIntensity: 1.35,
  })
  // R2: 0.5 → 1.8. At 0.5 the relief was gone by 3 m; the review's single
  // loudest tell was "untextured primitive architecture".
  ivory.normalScale.set(1.8, 1.8)
  applyWorldSurface(ivory, 'av-ivory', 1 / TRIM_TILE_M, 0.6, 0.32)
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
    roughness: 0.82,
    metalness: 0.04,
    normalMap: t.normalMap,
    roughnessMap: t.roughnessMap,
    aoMap: t.aoMap,
    aoMapIntensity: 1.35,
    vertexColors: true,
  })
  ivoryContact.normalScale.set(1.8, 1.8)
  applyWorldSurface(ivoryContact, 'av-ivory-contact', 1 / TRIM_TILE_M, 0.6, 0.32)
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
  goldPolished = new THREE.MeshStandardMaterial({
    // R2b: #8C6B2A was the value the review asked for, and in isolation it is
    // right — but a metal takes essentially ALL of its colour from what it
    // reflects, and this probe is deliberately almost black. At that albedo
    // every gold surface that did not happen to catch the narrow bar rendered
    // dark brown, and the level lost the "gold" half of its colour script.
    // The fix is to pay for the contrast with envMapIntensity (which only
    // scales a METAL's reflection, so it does not lift the ivory) rather than
    // with albedo. Landed at #AE8438 with a 3.4 env gain.
    color: '#AE8438',
    metalness: 1.0,
    // the map is authored at the final 0.14–0.5 band, so the multiplier is 1
    roughness: 1.0,
    roughnessMap: getBrushedGoldRoughnessTexture(),
    normalMap: getBrushedGoldNormalTexture(),
    envMapIntensity: 3.4,
  })
  goldPolished.normalScale.set(0.5, 0.5)
  applyWorldSurface(goldPolished, 'av-gold-polished', 1 / 0.6)
  return goldPolished
}

/**
 * Cast gold — the bulk trim. Rougher (×1.45 on the same brushed map → about
 * 0.17–0.65) so big runs read as cast metal with a broad ramp rather than one
 * blown-out chrome strip.
 */
export function goldCastMaterial(): THREE.MeshStandardMaterial {
  if (goldCast) return goldCast
  goldCast = new THREE.MeshStandardMaterial({
    color: '#8E6C2C',
    metalness: 0.98,
    roughness: 1.3,
    roughnessMap: getBrushedGoldRoughnessTexture(),
    normalMap: getBrushedGoldNormalTexture(),
    envMapIntensity: 2.8,
  })
  goldCast.normalScale.set(0.6, 0.6)
  applyWorldSurface(goldCast, 'av-gold-cast', 1 / 0.9)
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
    roughness: 0.78,
    metalness: 0.25,
    normalMap: t.normalMap,
    roughnessMap: t.roughnessMap,
    aoMap: t.aoMap,
  })
  umber.normalScale.set(1.35, 1.35)
  applyWorldSurface(umber, 'av-umber', 1 / TRIM_TILE_M, 0.55, 0.28)
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
  screen = new THREE.MeshStandardMaterial({
    color: COLORS.shrineIvoryDeep,
    roughness: 0.8,
    metalness: 0.05,
    alphaMap: tex,
    transparent: false,
    alphaTest: 0.5,
    side: THREE.DoubleSide,
    normalMap: getOrokinNormalTexture(),
    roughnessMap: getOrokinRoughnessTexture(),
  })
  screen.normalScale.set(1.2, 1.2)
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
  coffer = new THREE.MeshStandardMaterial({
    color: COLORS.shrineIvoryDeep,
    roughness: 0.84,
    metalness: 0.05,
    alphaMap: getCofferAlphaTexture(),
    alphaTest: 0.5,
    side: THREE.DoubleSide,
    normalMap: getOrokinNormalTexture(),
    roughnessMap: getOrokinRoughnessTexture(),
  })
  coffer.normalScale.set(1.1, 1.1)
  return coffer
}

/**
 * Filigree band — gold fret run applied as an alpha-mapped decal strip along
 * column joints, arch springs and wall courses.
 */
export function fretTrimMaterial(): THREE.MeshStandardMaterial {
  if (fretTrim) return fretTrim
  const tex = getFretBandTexture()
  fretTrim = new THREE.MeshStandardMaterial({
    // matched to goldPolished: a filigree band is the same metal as the trim
    // it runs beside, and at #D8B25C it was reading as a painted stripe
    color: '#AE8438',
    metalness: 1.0,
    roughness: 0.85,
    roughnessMap: getBrushedGoldRoughnessTexture(),
    envMapIntensity: 3.0,
    map: tex,
    alphaMap: tex,
    transparent: true,
    alphaTest: 0.35,
    side: THREE.DoubleSide,
  })
  return fretTrim
}

/** Deep Relic obsidian — near-mirror floors/props. */
export function obsidianMaterial(): THREE.MeshStandardMaterial {
  if (obsidian) return obsidian
  const m = MATERIALS.deepRelic
  const t = trimMaps()
  obsidian = new THREE.MeshStandardMaterial({
    color: m.color,
    metalness: m.metalness,
    roughness: 0.34,
    normalMap: t.normalMap,
    roughnessMap: t.roughnessMap,
    aoMap: t.aoMap,
  })
  obsidian.normalScale.set(1.15, 1.15)
  applyWorldSurface(obsidian, 'av-obsidian', 1 / TRIM_TILE_M, 0.45, 0.3)
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
    let x = Math.random() * size
    let y = Math.random() * size
    ctx.lineWidth = 0.8 + Math.random() * 1.6
    ctx.beginPath()
    ctx.moveTo(x, y)
    const segs = 3 + (Math.random() * 4) | 0
    for (let s = 0; s < segs; s++) {
      x += (Math.random() - 0.5) * 42
      y += (Math.random() - 0.5) * 42
      ctx.lineTo(x, y)
    }
    ctx.stroke()
  }
  // sparse hot flecks
  ctx.fillStyle = '#fff'
  for (let i = 0; i < 60; i++) {
    const r = 0.5 + Math.random() * 1.4
    ctx.beginPath()
    ctx.arc(Math.random() * size, Math.random() * size, r, 0, Math.PI * 2)
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
  rock = new THREE.MeshStandardMaterial({
    color: '#22242C',
    roughness: 0.92,
    metalness: 0.18,
    emissive: boosted(COLORS.aureate, 0.9),
    emissiveMap: getRockVeinTexture(),
    emissiveIntensity: 1.1,
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
let goldEdge: THREE.MeshStandardMaterial | null = null
let grooveTex: THREE.CanvasTexture | null = null
let groove: THREE.MeshBasicMaterial | null = null

/**
 * 512² obsidian floor paneling. One tile = 4 m (sampled with world-space UVs,
 * see floorMaterial). 4×4 structural panels with dark seams, per-panel value
 * jitter, occasional grate cells and edge wear — so large floors read as
 * built surfaces, not a single flat vector fill.
 */
function makeFloorCanvases(): [HTMLCanvasElement, HTMLCanvasElement] {
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
    const n = (Math.random() - 0.5) * 7
    img.data[i] += n
    img.data[i + 1] += n
    img.data[i + 2] += n + Math.random() * 2
    const rn = (Math.random() - 0.5) * 34
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
      const v = (Math.random() - 0.5) * 10
      a.fillStyle = `rgba(${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${v > 0 ? 255 : 8},${Math.abs(v) / 255})`
      a.fillRect(jx, jy, cell, cell)
      const rv = 140 + Math.random() * 40
      r.fillStyle = `rgba(${rv},${rv},${rv},0.35)`
      r.fillRect(jx, jy, cell, cell)
      // grate inset on ~1/3 of panels: recessed cell grid, rougher
      if (Math.random() < 0.34) {
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
      } else if (Math.random() < 0.4) {
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
    floorMapTex.anisotropy = 4
    floorRoughTex = new THREE.CanvasTexture(rgh)
    floorRoughTex.wrapS = floorRoughTex.wrapT = THREE.RepeatWrapping
    floorRoughTex.colorSpace = THREE.NoColorSpace
    floorRoughTex.anisotropy = 4
    // relief straight off the albedo's own value structure: seams become
    // grooves, grate bars become ribs, bolts become domes
    floorNormalTex = normalFromLuminance(alb, 2.6)
  }
  const m = MATERIALS.deepRelic
  floor = new THREE.MeshStandardMaterial({
    color: '#9E9EA6', // albedo comes from the map; pulled down for value depth
    map: floorMapTex,
    roughnessMap: floorRoughTex,
    normalMap: floorNormalTex ?? undefined,
    roughness: 0.9, // × map (~0.45–0.88) → matte panels, glossier grate bars
    metalness: m.metalness * 0.6,
  })
  // R2: 0.7 → 1.6. The floor is 30–40 % of most frames; its seams and grate
  // bars have to model under the key, not just tint.
  floor.normalScale.set(1.6, 1.6)
  // 1 tile = 3 m, world-space projection (same helper as the stone surfaces),
  // plus the 0.25 m detail layer so the deck under the player is not flat
  applyWorldSurface(floor, 'av-floor', 1 / 3, 0, 0.3)
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
 * Bright gold edge-highlight for raised floor trims — lighter than regalGold,
 * non-emissive so it catches the key light without crossing the bloom
 * threshold.
 */
export function goldEdgeMaterial(): THREE.MeshStandardMaterial {
  if (goldEdge) return goldEdge
  goldEdge = new THREE.MeshStandardMaterial({
    // still the brightest gold in the level, but no longer near-white: these
    // are 3.5 cm lips seen edge-on, and at #EFCF8E they were a solid pale
    // line that flattened every nosing into a sticker
    color: '#C79A45',
    metalness: 1.0,
    roughness: 0.62, // × 0.14–0.5 map ⇒ ~0.09–0.31, the narrowest ramp here
    roughnessMap: getBrushedGoldRoughnessTexture(),
    envMapIntensity: 3.6,
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

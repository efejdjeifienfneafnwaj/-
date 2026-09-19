/**
 * AURIC VOW — textures.ts
 * Boot-time canvas-generated textures (design.md §8 — fully procedural,
 * no external fetches). Both are returned as THREE.CanvasTexture.
 *
 * - getNoiseRoughnessTexture(): 512×512 grayscale fine speckle
 *   (ceramic material roughnessMap)
 * - getGlyphSpriteTexture(): 256×256 glowing radial rune glyph
 *   (corruption decals, ability icon backgrounds)
 */
import * as THREE from 'three'

let noiseRoughness: THREE.CanvasTexture | null = null
let glyphSprite: THREE.CanvasTexture | null = null

function makeCanvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas')
  c.width = size
  c.height = size
  const ctx = c.getContext('2d')
  if (!ctx) throw new Error('2D canvas context unavailable')
  return [c, ctx]
}

/** 512² grayscale speckle for ceramic roughness variation. */
export function getNoiseRoughnessTexture(): THREE.CanvasTexture {
  if (noiseRoughness) return noiseRoughness
  const size = 512
  const [canvas, ctx] = makeCanvas(size)
  const img = ctx.createImageData(size, size)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    // base mid-gray with fine speckle; occasional brighter speck
    let v = 128 + (Math.random() - 0.5) * 44
    if (Math.random() < 0.02) v += 60
    d[i] = d[i + 1] = d[i + 2] = Math.max(0, Math.min(255, v))
    d[i + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
  // soften with a light blur pass so the speckle reads as micro-roughness
  ctx.filter = 'blur(1px)'
  ctx.drawImage(canvas, 0, 0)
  ctx.filter = 'none'

  noiseRoughness = new THREE.CanvasTexture(canvas)
  noiseRoughness.wrapS = THREE.RepeatWrapping
  noiseRoughness.wrapT = THREE.RepeatWrapping
  noiseRoughness.colorSpace = THREE.NoColorSpace
  noiseRoughness.needsUpdate = true
  return noiseRoughness
}

/** 256² radial-stroke rune glyph, white-on-black (tint via material color). */
export function getGlyphSpriteTexture(): THREE.CanvasTexture {
  if (glyphSprite) return glyphSprite
  const size = 256
  const [canvas, ctx] = makeCanvas(size)
  const cx = size / 2
  const cy = size / 2

  ctx.fillStyle = '#000000'
  ctx.fillRect(0, 0, size, size)

  // seeded-ish radial strokes — a "Cadence rune"
  ctx.strokeStyle = '#ffffff'
  ctx.lineCap = 'round'
  const strokes = 12
  for (let i = 0; i < strokes; i++) {
    const a = (i / strokes) * Math.PI * 2 + (i % 2 ? 0.13 : 0)
    const r0 = 28 + (i % 3) * 10
    const r1 = 86 + ((i * 37) % 30)
    ctx.lineWidth = i % 4 === 0 ? 5 : 2.5
    ctx.beginPath()
    ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0)
    // slight arc for an etched, ceremonial feel
    const bend = a + (i % 2 ? 0.35 : -0.35)
    ctx.quadraticCurveTo(
      cx + Math.cos(bend) * ((r0 + r1) / 2),
      cy + Math.sin(bend) * ((r0 + r1) / 2),
      cx + Math.cos(a + 0.12) * r1,
      cy + Math.sin(a + 0.12) * r1,
    )
    ctx.stroke()
  }
  // inner ring + center dot
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.arc(cx, cy, 20, 0, Math.PI * 2)
  ctx.stroke()
  ctx.fillStyle = '#ffffff'
  ctx.beginPath()
  ctx.arc(cx, cy, 7, 0, Math.PI * 2)
  ctx.fill()

  // radial glow falloff so edges bloom softly
  const grad = ctx.createRadialGradient(cx, cy, 40, cx, cy, 126)
  grad.addColorStop(0, 'rgba(0,0,0,0)')
  grad.addColorStop(1, 'rgba(0,0,0,0.9)')
  ctx.globalCompositeOperation = 'destination-out'
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, size, size)
  ctx.globalCompositeOperation = 'source-over'

  glyphSprite = new THREE.CanvasTexture(canvas)
  glyphSprite.colorSpace = THREE.SRGBColorSpace
  glyphSprite.needsUpdate = true
  return glyphSprite
}

/** pre-generate all boot textures; call once at boot */
export function initTextures() {
  getNoiseRoughnessTexture()
  getGlyphSpriteTexture()
  getOrokinNormalTexture()
  getOrokinAOTexture()
  getOrokinRoughnessTexture()
  getBrushedGoldRoughnessTexture()
  getBrushedGoldNormalTexture()
  getDetailNormalTexture()
  getPiercedScreenTexture()
  getCofferAlphaTexture()
  getContactBlobTexture()
  getFretBandTexture()
  getStripFalloffTexture()
}

// ---------------------------------------------------------------------------
// R1 — Orokin surface detail set (normal / AO / roughness) + trim sheets
//
// One authored height field drives three maps, so seams, chamfers and fret
// ornament agree across normal, cavity-AO and roughness. Everything is baked
// once at boot into CanvasTextures; nothing here allocates per frame.
// A tile covers 2 m of wall (see materials.ts world-space UV projection), so
// texel density is constant across the level regardless of mesh scale.
// ---------------------------------------------------------------------------

let orokinNormal: THREE.CanvasTexture | null = null
let orokinAO: THREE.CanvasTexture | null = null
let orokinRough: THREE.CanvasTexture | null = null
let goldRough: THREE.CanvasTexture | null = null
let goldNormal: THREE.CanvasTexture | null = null
let detailNormal: THREE.CanvasTexture | null = null
let piercedScreen: THREE.CanvasTexture | null = null
let cofferAlpha: THREE.CanvasTexture | null = null
let contactBlob: THREE.CanvasTexture | null = null
let fretStrip: THREE.CanvasTexture | null = null
let stripFalloff: THREE.CanvasTexture | null = null

const TRIM_SIZE = 512

/** value noise with a deterministic hash — stable across reloads */
function hash2(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453
  return s - Math.floor(s)
}
function vnoise(x: number, y: number): number {
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const fx = x - ix
  const fy = y - iy
  const ux = fx * fx * (3 - 2 * fx)
  const uy = fy * fy * (3 - 2 * fy)
  const a = hash2(ix, iy)
  const b = hash2(ix + 1, iy)
  const c = hash2(ix, iy + 1)
  const d = hash2(ix + 1, iy + 1)
  return (a + (b - a) * ux) * (1 - uy) + (c + (d - c) * ux) * uy
}

/** rounded rect path helper (tile-local, no wrap handling — motifs stay inset) */
function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h - r)
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
}

/**
 * Authored height field for the Orokin panel sheet.
 *
 * R2: one tile is now 2 m (materials.TRIM_TILE_M), so this 512² sheet is
 * ~4 mm/texel and every edge below is a real, straight, machined edge rather
 * than a blurred suggestion. The order of authoring matters: *rectilinear
 * primitives first* (seam trench → chamfer ramp → panel face → fret meander →
 * bolt punches → stepped ribs), fine value noise only at the very end as a
 * surface grain. Value noise cannot produce a straight edge, so it is never
 * allowed to carry structure.
 *
 * 2×2 panels per tile = 1 m panels, the scale Orokin wall plating reads at.
 */
function buildOrokinHeight(): Float32Array {
  const size = TRIM_SIZE
  const [canvas, ctx] = makeCanvas(size)
  ctx.fillStyle = '#3a3a3a' // seam trench floor — the deepest level of the sheet
  ctx.fillRect(0, 0, size, size)

  const cell = size / 2
  /** crisp axis-aligned bar helper (no AA rounding on the long edges) */
  const bar = (x: number, y: number, w: number, h: number, v: number) => {
    ctx.fillStyle = `rgb(${v},${v},${v})`
    ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h))
  }

  for (let py = 0; py < 2; py++) {
    for (let px = 0; px < 2; px++) {
      const x0 = px * cell
      const y0 = py * cell
      const inset = 9 // seam half-width in px (≈3.5 cm trench)
      // machined chamfer: a stepped ramp from the trench floor up to the face.
      // Few, WIDE value steps read as a bevel that catches the key light;
      // many narrow ones just blur back into a fillet.
      const steps = 5
      for (let s = 0; s < steps; s++) {
        const t = s / (steps - 1)
        const k = inset + (1 - t) * 8
        const v = Math.round(58 + t * 128) // 0x3a → 0xba
        rr(ctx, x0 + k, y0 + k, cell - k * 2, cell - k * 2, 5 - t * 3)
        ctx.fillStyle = `rgb(${v},${v},${v})`
        ctx.fill()
      }
      const f0 = x0 + inset
      const fw = cell - inset * 2
      // --- fret meander inside the face: a rectilinear Orokin key run, drawn
      //     as bars so every edge is axis-aligned and 2-3 texels wide ---
      const m = 26 // margin from the face edge to the fret run
      const fb = 7 // fret bar width
      // continuous outer rails (top/bottom/left/right of the fret course)
      bar(f0 + m, y0 + inset + m, fw - m * 2, fb, 208)
      bar(f0 + m, y0 + cell - inset - m - fb, fw - m * 2, fb, 208)
      bar(f0 + m, y0 + inset + m, fb, fw - m * 2, 208)
      bar(f0 + cell - inset - m - fb, y0 + inset + m, fb, fw - m * 2, 208)
      // stepped meander teeth off the top and bottom rails
      const teeth = 4
      const step = (fw - m * 2) / teeth
      for (let t = 0; t < teeth; t++) {
        const tx = f0 + m + t * step + step * 0.22
        bar(tx, y0 + inset + m, fb, step * 0.42, 196)
        bar(tx, y0 + inset + m + step * 0.42 - fb, step * 0.46, fb, 196)
        bar(
          tx + step * 0.46 - fb,
          y0 + cell - inset - m - step * 0.42,
          fb,
          step * 0.42,
          196,
        )
        bar(tx, y0 + cell - inset - m - step * 0.42, step * 0.46, fb, 196)
      }
      // --- recessed centre field: a flat inset with a hard 2-texel lip. No
      //     stamped medallion — the sheet tiles 265 m and any bold motif reads
      //     as wallpaper; ornament density is carried by real geometry. ---
      const cM = m + 24
      bar(f0 + cM, y0 + inset + cM, fw - cM * 2, fw - cM * 2, 96)
      bar(f0 + cM, y0 + inset + cM, fw - cM * 2, 2, 226) // top lip catches light
      bar(f0 + cM, y0 + inset + cM, 2, fw - cM * 2, 226)
      bar(f0 + cM, y0 + inset + cM + (fw - cM * 2) - 2, fw - cM * 2, 2, 62)
      bar(f0 + cM + (fw - cM * 2) - 2, y0 + inset + cM, 2, fw - cM * 2, 62)
      // --- bolt punches at the panel corners: a dark bore with a proud head ---
      for (const [bx, by] of [
        [f0 + 20, y0 + inset + 20],
        [f0 + fw - 20, y0 + inset + 20],
        [f0 + 20, y0 + inset + fw - 20],
        [f0 + fw - 20, y0 + inset + fw - 20],
      ]) {
        ctx.fillStyle = 'rgb(54,54,54)'
        ctx.beginPath()
        ctx.arc(bx, by, 6.5, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = 'rgb(236,236,236)'
        ctx.beginPath()
        ctx.arc(bx, by, 4.2, 0, Math.PI * 2)
        ctx.fill()
      }
      // --- short stepped ribs along the face edges (machined stiffeners) ---
      for (let i = 0; i < 6; i++) {
        const rx = f0 + 30 + i * ((fw - 60) / 6)
        bar(rx, y0 + inset + 8, 12, 6, 176)
        bar(rx, y0 + cell - inset - 14, 12, 6, 176)
      }
    }
  }
  // a single sub-texel softening pass: keeps the edges straight (they survive
  // the Sobel as a 2-texel ramp) without turning chamfers back into fillets
  ctx.filter = 'blur(0.6px)'
  ctx.drawImage(canvas, 0, 0)
  ctx.filter = 'none'

  const d = ctx.getImageData(0, 0, size, size).data
  const h = new Float32Array(size * size)
  for (let i = 0; i < h.length; i++) {
    // fine machined grain LAST, on top of the authored relief, at an amplitude
    // that can never compete with a drawn edge
    const x = i % size
    const y = (i / size) | 0
    const grain = (vnoise(x * 0.22, y * 0.22) - 0.5) * 0.04 + (vnoise(x * 0.9, y * 0.9) - 0.5) * 0.018
    h[i] = Math.min(1, Math.max(0, d[i * 4] / 255 + grain))
  }
  return h
}

function heightSample(h: Float32Array, x: number, y: number): number {
  const size = TRIM_SIZE
  const xi = ((x % size) + size) % size
  const yi = ((y % size) + size) % size
  return h[yi * size + xi]
}

function buildOrokinMaps() {
  const size = TRIM_SIZE
  const h = buildOrokinHeight()

  const [nCanvas, nCtx] = makeCanvas(size)
  const [aCanvas, aCtx] = makeCanvas(size)
  const [rCanvas, rCtx] = makeCanvas(size)
  const nImg = nCtx.createImageData(size, size)
  const aImg = aCtx.createImageData(size, size)
  const rImg = rCtx.createImageData(size, size)

  // R2: 2.1 → 2.8. The sheet is read at 2 m/tile now, so the relief has to
  // survive gameplay distance as well as a close-up.
  const strength = 2.8
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      // --- normal (Sobel on the height field) ---
      const hl = heightSample(h, x - 1, y)
      const hr = heightSample(h, x + 1, y)
      const hd = heightSample(h, x, y - 1)
      const hu = heightSample(h, x, y + 1)
      let nx = (hl - hr) * strength
      let ny = (hd - hu) * strength
      const nz = 1
      const inv = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz)
      nx *= inv
      ny *= inv
      nImg.data[i] = (nx * 0.5 + 0.5) * 255
      nImg.data[i + 1] = (ny * 0.5 + 0.5) * 255
      nImg.data[i + 2] = nz * inv * 255
      nImg.data[i + 3] = 255

      // --- cavity AO: height vs a wide neighbourhood average ---
      let sum = 0
      let n = 0
      for (let oy = -6; oy <= 6; oy += 3) {
        for (let ox = -6; ox <= 6; ox += 3) {
          sum += heightSample(h, x + ox, y + oy)
          n++
        }
      }
      const cav = h[y * size + x] - sum / n
      // R2: floor 0.42 → 0.22 and gain 2.2 → 3.4. Panel seams, bolt bores and
      // the recessed centre field are supposed to be the darkest values on a
      // lit wall; at 0.42 they were a grey hint.
      const ao = Math.min(1, Math.max(0.22, 1 + cav * 3.4))
      const av = ao * 255
      aImg.data[i] = aImg.data[i + 1] = aImg.data[i + 2] = av
      aImg.data[i + 3] = 255

      // --- roughness: raised machined faces polish, cavities stay matte ---
      const hv = h[y * size + x]
      let rough = 0.98 - hv * 0.52 + (vnoise(x * 0.5, y * 0.5) - 0.5) * 0.16
      rough = Math.min(1, Math.max(0.16, rough))
      const rv = rough * 255
      rImg.data[i] = rImg.data[i + 1] = rImg.data[i + 2] = rv
      rImg.data[i + 3] = 255
    }
  }
  nCtx.putImageData(nImg, 0, 0)
  aCtx.putImageData(aImg, 0, 0)
  rCtx.putImageData(rImg, 0, 0)

  const mk = (c: HTMLCanvasElement) => {
    const t = new THREE.CanvasTexture(c)
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.colorSpace = THREE.NoColorSpace
    t.anisotropy = 4
    t.needsUpdate = true
    return t
  }
  orokinNormal = mk(nCanvas)
  orokinAO = mk(aCanvas)
  orokinRough = mk(rCanvas)
}

/** Tiling Orokin panel normal map (seams, chamfers, fret, cartouche). */
export function getOrokinNormalTexture(): THREE.CanvasTexture {
  if (!orokinNormal) buildOrokinMaps()
  return orokinNormal!
}

/** Matching cavity/AO map — recesses bottom out at 0.28 so gaps read dark. */
export function getOrokinAOTexture(): THREE.CanvasTexture {
  if (!orokinAO) buildOrokinMaps()
  return orokinAO!
}

/** Matching roughness map — polished raised faces, matte cavities. */
export function getOrokinRoughnessTexture(): THREE.CanvasTexture {
  if (!orokinRough) buildOrokinMaps()
  return orokinRough!
}

/**
 * 256² anisotropic brushed-metal roughness for gold: long streaks along U so
 * highlights break up into a ramp instead of a single blown specular dot.
 *
 * R2: the output band is authored directly at 0.12–0.45 (was a ~0.2–0.8
 * spread that the materials then had to scale down), so a gold material can
 * use `roughness: 1.0` and get the specced brushed range. Cast gold
 * multiplies up from the same map.
 */
// R2b: widened 0.12–0.45 → 0.14–0.50. A very tight lobe put the whole key
// specular into a handful of pixels; a slightly broader one spreads it into
// the ramp along a bevel that actually reads as metal at gameplay distance.
const GOLD_ROUGH_LO = 0.14
const GOLD_ROUGH_HI = 0.5

export function getBrushedGoldRoughnessTexture(): THREE.CanvasTexture {
  if (goldRough) return goldRough
  const size = 256
  const [canvas, ctx] = makeCanvas(size)
  const img = ctx.createImageData(size, size)
  for (let y = 0; y < size; y++) {
    // per-row streak value: long in U, high frequency in V
    const streak = vnoise(y * 0.9, 11.3) * 0.55 + vnoise(y * 3.1, 4.7) * 0.25
    for (let x = 0; x < size; x++) {
      const along = vnoise(x * 0.06, y * 0.8) * 0.3
      const grain = (hash2(x, y) - 0.5) * 0.08
      const t = Math.min(1, Math.max(0, 0.42 + streak * 0.5 + along - 0.22 + grain))
      const v = GOLD_ROUGH_LO + t * (GOLD_ROUGH_HI - GOLD_ROUGH_LO)
      const i = (y * size + x) * 4
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v * 255
      img.data[i + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  goldRough = new THREE.CanvasTexture(canvas)
  goldRough.wrapS = goldRough.wrapT = THREE.RepeatWrapping
  goldRough.colorSpace = THREE.NoColorSpace
  goldRough.anisotropy = 8
  return goldRough
}

/**
 * Matching 256² brushed NORMAL map for gold.
 *
 * A true anisotropic BRDF lobe is not worth its cost on a software rasteriser,
 * but the thing it buys — a highlight that smears ALONG the brush direction
 * instead of sitting as one round blown dot — can be bought with geometry
 * instead: long shallow ridges running down U. The surface normal wobbles only
 * across the streaks, so the specular reflection stretches perpendicular to
 * them, which is exactly what brushed metal does.
 */
export function getBrushedGoldNormalTexture(): THREE.CanvasTexture {
  if (goldNormal) return goldNormal
  const size = 256
  const [canvas, ctx] = makeCanvas(size)
  const img = ctx.createImageData(size, size)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // height varies fast across V, slowly along U → ridges run along U
      const hHere =
        vnoise(x * 0.035, y * 2.4) * 0.6 +
        vnoise(x * 0.11, y * 7.5) * 0.28 +
        vnoise(x * 0.02, y * 22.0) * 0.12
      const hUp =
        vnoise(x * 0.035, (y + 1) * 2.4) * 0.6 +
        vnoise(x * 0.11, (y + 1) * 7.5) * 0.28 +
        vnoise(x * 0.02, (y + 1) * 22.0) * 0.12
      const hRight =
        vnoise((x + 1) * 0.035, y * 2.4) * 0.6 +
        vnoise((x + 1) * 0.11, y * 7.5) * 0.28 +
        vnoise((x + 1) * 0.02, y * 22.0) * 0.12
      let nx = (hHere - hRight) * 3.2
      let ny = (hHere - hUp) * 3.2
      const inv = 1 / Math.sqrt(nx * nx + ny * ny + 1)
      nx *= inv
      ny *= inv
      const i = (y * size + x) * 4
      img.data[i] = (nx * 0.5 + 0.5) * 255
      img.data[i + 1] = (ny * 0.5 + 0.5) * 255
      img.data[i + 2] = inv * 255
      img.data[i + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  goldNormal = new THREE.CanvasTexture(canvas)
  goldNormal.wrapS = goldNormal.wrapT = THREE.RepeatWrapping
  goldNormal.colorSpace = THREE.NoColorSpace
  goldNormal.anisotropy = 8
  return goldNormal
}

/**
 * 256² micro-detail normal, tiled at ~0.25 m (see materials.applyWorldSurface).
 *
 * The panel sheet carries 1 m structure; at 2 m from the camera a 1 m panel is
 * half the screen and there is nothing left between its edges. This layer is
 * the near-field surface: a fine machined cross-hatch, tool chatter, and
 * sparse chipping. It is blended on top of the panel normal, never instead of
 * it, so far surfaces still get the panel read and near surfaces get grain.
 */
export function getDetailNormalTexture(): THREE.CanvasTexture {
  if (detailNormal) return detailNormal
  const size = 256
  const [canvas, ctx] = makeCanvas(size)
  // author a height field first, in a canvas, so scratches are straight lines
  ctx.fillStyle = 'rgb(128,128,128)'
  ctx.fillRect(0, 0, size, size)
  ctx.lineCap = 'butt'
  // Fine machined cross-hatch. The strokes are deliberately SHORT (12–60 px
  // of a 256 px tile that covers 0.25 m) and their angles are spread: a first
  // pass used 40–240 px strokes at two fixed angles, and because the tile
  // repeats every 0.25 m those long strokes lined up tile-to-tile into
  // continuous metre-scale streaks that made carved stone read as brushed
  // steel. Short, angularly varied strokes stay grain instead of becoming
  // structure when tiled.
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i < 150; i++) {
      const ang = (hash2(i * 8.3, pass * 2.7) - 0.5) * Math.PI + pass * 1.05
      const r = hash2(i * 3.7, pass * 11.1)
      ctx.strokeStyle = r > 0.5 ? 'rgb(158,158,158)' : 'rgb(102,102,102)'
      ctx.lineWidth = 0.5 + hash2(i, pass) * 0.9
      const cx = hash2(i * 1.3, pass * 5.2) * size
      const cy = hash2(i * 2.9, pass * 7.4) * size
      const len = 12 + hash2(i * 4.1, pass) * 48
      ctx.beginPath()
      ctx.moveTo(cx - Math.cos(ang) * len * 0.5, cy - Math.sin(ang) * len * 0.5)
      ctx.lineTo(cx + Math.cos(ang) * len * 0.5, cy + Math.sin(ang) * len * 0.5)
      ctx.stroke()
    }
  }
  // sparse chipping / casting pits
  for (let i = 0; i < 40; i++) {
    const r = 1 + hash2(i * 9.1, 3.3) * 3.2
    ctx.fillStyle = 'rgb(74,74,74)'
    ctx.beginPath()
    ctx.arc(hash2(i * 2.2, 8.8) * size, hash2(i * 6.6, 1.4) * size, r, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.filter = 'blur(0.5px)'
  ctx.drawImage(canvas, 0, 0)
  ctx.filter = 'none'

  const d = ctx.getImageData(0, 0, size, size).data
  const h = new Float32Array(size * size)
  for (let i = 0; i < h.length; i++) {
    const x = i % size
    const y = (i / size) | 0
    h[i] = d[i * 4] / 255 + (vnoise(x * 1.7, y * 1.7) - 0.5) * 0.09
  }
  const at = (x: number, y: number) =>
    h[(((y % size) + size) % size) * size + (((x % size) + size) % size)]
  const img = ctx.createImageData(size, size)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      let nx = (at(x - 1, y) - at(x + 1, y)) * 2.2
      let ny = (at(x, y - 1) - at(x, y + 1)) * 2.2
      const inv = 1 / Math.sqrt(nx * nx + ny * ny + 1)
      nx *= inv
      ny *= inv
      img.data[i] = (nx * 0.5 + 0.5) * 255
      img.data[i + 1] = (ny * 0.5 + 0.5) * 255
      img.data[i + 2] = inv * 255
      img.data[i + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  detailNormal = new THREE.CanvasTexture(canvas)
  detailNormal.wrapS = detailNormal.wrapT = THREE.RepeatWrapping
  detailNormal.colorSpace = THREE.NoColorSpace
  detailNormal.anisotropy = 4
  return detailNormal
}

/**
 * 512² pierced-screen alpha mask (white = stone, black = hole).
 *
 * Flat wall spans are the thing that reads as "untextured primitive" from a
 * thumbnail. A screen panel hung 6 cm in front of one turns it into a
 * silhouette: the holes show the dark recess behind, the ribs catch the key,
 * and the whole span gains a depth cue no map can fake.
 *
 * The motif is a 4×4 grid of Orokin vesica openings inside a fret border,
 * with a lens boss at every rib crossing.
 */
export function getPiercedScreenTexture(): THREE.CanvasTexture {
  if (piercedScreen) return piercedScreen
  const size = 512
  const [canvas, ctx] = makeCanvas(size)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, size, size)

  ctx.fillStyle = '#000000'
  const cells = 4
  const cw = size / cells
  const border = 30
  for (let cy = 0; cy < cells; cy++) {
    for (let cx = 0; cx < cells; cx++) {
      const ox = cx * cw + cw / 2
      const oy = cy * cw + cw / 2
      // pointed-oval (vesica) opening: two arcs meeting at top and bottom
      const rw = cw * 0.31
      const rh = cw * 0.4
      ctx.beginPath()
      ctx.moveTo(ox, oy - rh)
      ctx.quadraticCurveTo(ox + rw, oy - rh * 0.35, ox + rw * 0.72, oy)
      ctx.quadraticCurveTo(ox + rw, oy + rh * 0.35, ox, oy + rh)
      ctx.quadraticCurveTo(ox - rw, oy + rh * 0.35, ox - rw * 0.72, oy)
      ctx.quadraticCurveTo(ox - rw, oy - rh * 0.35, ox, oy - rh)
      ctx.closePath()
      ctx.fill()
      // small round relief holes flanking each opening
      for (const s of [-1, 1]) {
        ctx.beginPath()
        ctx.arc(ox + s * cw * 0.42, oy, cw * 0.055, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  }
  // solid fret border: punch the frame back to stone
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, size, border)
  ctx.fillRect(0, size - border, size, border)
  ctx.fillRect(0, 0, border, size)
  ctx.fillRect(size - border, 0, border, size)
  // lens bosses at the rib crossings (solid, so they read as nodes)
  for (let cy = 1; cy < cells; cy++) {
    for (let cx = 1; cx < cells; cx++) {
      ctx.beginPath()
      ctx.arc(cx * cw, cy * cw, cw * 0.12, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  piercedScreen = new THREE.CanvasTexture(canvas)
  piercedScreen.wrapS = piercedScreen.wrapT = THREE.RepeatWrapping
  piercedScreen.colorSpace = THREE.NoColorSpace
  piercedScreen.anisotropy = 4
  return piercedScreen
}

/**
 * 256² coffer alpha mask — a single square opening inside a stepped frame.
 * Used on the ceiling/vault coffer panels so the recess behind them shows
 * through as a true dark, which is where the level's bottom 12 % of luma
 * has to come from.
 */
export function getCofferAlphaTexture(): THREE.CanvasTexture {
  if (cofferAlpha) return cofferAlpha
  const size = 256
  const [canvas, ctx] = makeCanvas(size)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, size, size)
  ctx.fillStyle = '#000000'
  const m = 46
  ctx.fillRect(m, m, size - m * 2, size - m * 2)
  // chamfered corners: put the stone back as triangles
  ctx.fillStyle = '#ffffff'
  const c = 30
  for (const [sx, sy] of [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ]) {
    const px = sx ? size - m : m
    const py = sy ? size - m : m
    ctx.beginPath()
    ctx.moveTo(px, py)
    ctx.lineTo(px + (sx ? -c : c), py)
    ctx.lineTo(px, py + (sy ? -c : c))
    ctx.closePath()
    ctx.fill()
  }
  cofferAlpha = new THREE.CanvasTexture(canvas)
  cofferAlpha.wrapS = cofferAlpha.wrapT = THREE.ClampToEdgeWrapping
  cofferAlpha.colorSpace = THREE.NoColorSpace
  return cofferAlpha
}

/**
 * 256×64 tiling filigree band — Orokin fret run for trim/glyph decal bands.
 * White on transparent black; tint and opacity come from the material.
 */
export function getFretBandTexture(): THREE.CanvasTexture {
  if (fretStrip) return fretStrip
  const w = 256
  const hgt = 64
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = hgt
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D canvas context unavailable')
  ctx.clearRect(0, 0, w, hgt)
  ctx.strokeStyle = '#ffffff'
  ctx.fillStyle = '#ffffff'
  ctx.lineCap = 'butt'
  // continuous rails top and bottom
  ctx.globalAlpha = 0.85
  ctx.fillRect(0, 7, w, 3)
  ctx.fillRect(0, hgt - 10, w, 3)
  // repeating fret motif: 4 cells across the 256 px tile
  const cells = 4
  const cw = w / cells
  for (let c = 0; c < cells; c++) {
    const x = c * cw
    ctx.globalAlpha = 0.95
    ctx.lineWidth = 3
    // stepped meander
    ctx.beginPath()
    ctx.moveTo(x + 6, hgt - 16)
    ctx.lineTo(x + 6, 20)
    ctx.lineTo(x + cw * 0.42, 20)
    ctx.lineTo(x + cw * 0.42, hgt - 24)
    ctx.lineTo(x + cw * 0.72, hgt - 24)
    ctx.lineTo(x + cw * 0.72, 26)
    ctx.stroke()
    // lens + pip
    ctx.globalAlpha = 0.8
    ctx.beginPath()
    ctx.ellipse(x + cw * 0.86, hgt / 2, 9, 14, 0, 0, Math.PI * 2)
    ctx.stroke()
    ctx.globalAlpha = 1
    ctx.beginPath()
    ctx.arc(x + cw * 0.86, hgt / 2, 3.2, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 1
  fretStrip = new THREE.CanvasTexture(canvas)
  fretStrip.wrapS = THREE.RepeatWrapping
  fretStrip.wrapT = THREE.ClampToEdgeWrapping
  fretStrip.colorSpace = THREE.SRGBColorSpace
  fretStrip.anisotropy = 4
  return fretStrip
}

/**
 * 8×128 alpha ramp: opaque through the middle, fading to zero at both ends.
 * Used as an alphaMap on energy strips so they die into their channel
 * instead of ending on a hard cut.
 */
export function getStripFalloffTexture(): THREE.CanvasTexture {
  if (stripFalloff) return stripFalloff
  const w = 8
  const hgt = 128
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = hgt
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D canvas context unavailable')
  const g = ctx.createLinearGradient(0, 0, 0, hgt)
  g.addColorStop(0, '#000000')
  g.addColorStop(0.16, '#d8d8d8')
  g.addColorStop(0.5, '#ffffff')
  g.addColorStop(0.84, '#d8d8d8')
  g.addColorStop(1, '#000000')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, hgt)
  stripFalloff = new THREE.CanvasTexture(canvas)
  stripFalloff.wrapS = stripFalloff.wrapT = THREE.ClampToEdgeWrapping
  stripFalloff.colorSpace = THREE.NoColorSpace
  return stripFalloff
}

/**
 * 128² soft contact-shadow blob — opaque black core, feathered to nothing at
 * the rim, with a slight density shoulder so it does not read as an airbrush
 * dot. Sampled by the unconditional contact-shadow decals in Lighting.tsx,
 * which have to survive the quality tier where key shadow casting is off.
 */
export function getContactBlobTexture(): THREE.CanvasTexture {
  if (contactBlob) return contactBlob
  const size = 128
  const [canvas, ctx] = makeCanvas(size)
  const img = ctx.createImageData(size, size)
  const c = (size - 1) / 2
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x - c) / c
      const dy = (y - c) / c
      const r = Math.sqrt(dx * dx + dy * dy)
      // core stays dense out to 0.35, then a long smooth falloff to 1.0
      let a = 1 - THREE.MathUtils.smoothstep(r, 0.3, 1.0)
      a = Math.pow(a, 1.35)
      const i = (y * size + x) * 4
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255
      img.data[i + 3] = Math.max(0, Math.min(255, a * 255))
    }
  }
  ctx.putImageData(img, 0, 0)
  contactBlob = new THREE.CanvasTexture(canvas)
  contactBlob.wrapS = contactBlob.wrapT = THREE.ClampToEdgeWrapping
  contactBlob.colorSpace = THREE.NoColorSpace
  return contactBlob
}

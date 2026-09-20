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
  getOrokinAlbedoTexture()
  getOrokinHeightTexture()
  getEnemyPlateTextures()
  getMacroVariationTexture()
  getWeatherTexture()
  getGoldAlbedoTexture()
  getGoldORMTexture()
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
let orokinHeight: THREE.CanvasTexture | null = null
let orokinHeightStats = { mean: 0.5, min: 0, max: 1, p05: 0, p95: 1 }
let goldRough: THREE.CanvasTexture | null = null
let goldNormal: THREE.CanvasTexture | null = null
let detailNormal: THREE.CanvasTexture | null = null
let piercedScreen: THREE.CanvasTexture | null = null
let cofferAlpha: THREE.CanvasTexture | null = null
let contactBlob: THREE.CanvasTexture | null = null
let fretStrip: THREE.CanvasTexture | null = null
let stripFalloff: THREE.CanvasTexture | null = null
let orokinAlbedo: THREE.CanvasTexture | null = null
let orokinAlbedoMean = 1
let macroVariation: THREE.CanvasTexture | null = null
let macroMean = 0.6
let goldAlbedo: THREE.CanvasTexture | null = null
let goldORM: THREE.CanvasTexture | null = null
let goldRoughMean = 0.3
let goldRoughRange: [number, number] = [0.05, 0.9]
let goldAlbedoMean = 1

/**
 * Sheet resolution.
 *
 * R3: 512 → 1024. One tile is 2 m of wall and now carries FOUR different 1 m
 * plates (fret / louvre bank / flanged boss / stepped inset) instead of one
 * stamp repeated four times, and a 1024 sheet puts that at ~2 mm/texel — fine
 * enough that a bolt head is a bolt head at arm's length instead of a smear.
 */
const TRIM_SIZE = 1024

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

  const cell = size / 2 // one 1 m panel at TRIM_TILE_M = 2
  const S = size / 512 // authoring unit: every constant below is in 512-px terms

  /** crisp axis-aligned bar helper (no AA rounding on the long edges) */
  const bar = (x: number, y: number, w: number, h: number, v: number) => {
    ctx.fillStyle = `rgb(${v},${v},${v})`
    ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h))
  }
  const disc = (x: number, y: number, r: number, v: number) => {
    ctx.fillStyle = `rgb(${v},${v},${v})`
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }
  /** bolt: a dark counter-bore with a proud head and a lit crescent */
  const bolt = (x: number, y: number, r: number) => {
    disc(x, y, r, 48)
    disc(x, y, r * 0.66, 238)
    disc(x - r * 0.12, y - r * 0.12, r * 0.42, 214)
  }

  const FACE = 186
  const TRENCH = 46
  const inset = 18 * S // seam half-width (~3.5 cm of a 1 m panel)

  /**
   * Seam trench → stepped chamfer → panel face, plus mitred corners.
   * Few WIDE value steps read as a machined bevel that catches the key light;
   * many narrow ones just blur back into a fillet.
   */
  const panelBase = (x0: number, y0: number) => {
    const steps = 6
    for (let s = 0; s < steps; s++) {
      const t = s / (steps - 1)
      const k = inset + (1 - t) * 16 * S
      const v = Math.round(58 + t * (FACE - 58))
      rr(ctx, x0 + k, y0 + k, cell - k * 2, cell - k * 2, (10 - t * 7) * S)
      ctx.fillStyle = `rgb(${v},${v},${v})`
      ctx.fill()
    }
    // mitred plate corners — Orokin plating is never square-cornered
    ctx.fillStyle = `rgb(${TRENCH},${TRENCH},${TRENCH})`
    const c = 34 * S
    for (const [sx, sy] of [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ]) {
      const px = x0 + (sx ? cell - inset : inset)
      const py = y0 + (sy ? cell - inset : inset)
      ctx.beginPath()
      ctx.moveTo(px, py)
      ctx.lineTo(px + (sx ? -c : c), py)
      ctx.lineTo(px, py + (sy ? -c : c))
      ctx.closePath()
      ctx.fill()
    }
  }

  // --- panel variant A: fret meander course around a recessed centre field ---
  const faceFret = (f0: number, g0: number, fw: number) => {
    const m = 52 * S
    const fb = 14 * S
    // The meander runs inside a RECESSED course. A fret drawn proud of the
    // face at 208 against a 186 face is a 22-level difference — it survives
    // neither the Sobel nor the cavity bake, which is why the first pass of
    // this panel read as blank. Sinking the course to 118 first gives every
    // bar a 90-level step on both sides and a real machined shadow line.
    bar(f0 + m - 10 * S, g0 + m - 10 * S, fw - m * 2 + 20 * S, fw - m * 2 + 20 * S, 118)
    bar(f0 + m, g0 + m, fw - m * 2, fb, 226)
    bar(f0 + m, g0 + fw - m - fb, fw - m * 2, fb, 226)
    bar(f0 + m, g0 + m, fb, fw - m * 2, 226)
    bar(f0 + fw - m - fb, g0 + m, fb, fw - m * 2, 226)
    const teeth = 4
    const step = (fw - m * 2) / teeth
    for (let t = 0; t < teeth; t++) {
      const tx = f0 + m + t * step + step * 0.22
      bar(tx, g0 + m, fb, step * 0.42, 214)
      bar(tx, g0 + m + step * 0.42 - fb, step * 0.46, fb, 214)
      bar(tx + step * 0.46 - fb, g0 + fw - m - step * 0.42, fb, step * 0.42, 214)
      bar(tx, g0 + fw - m - step * 0.42, step * 0.46, fb, 214)
    }
    const cM = m + 40 * S
    const cw = fw - cM * 2
    bar(f0 + cM, g0 + cM, cw, cw, 96)
    bar(f0 + cM, g0 + cM, cw, 4 * S, 230) // top lip catches the key
    bar(f0 + cM, g0 + cM, 4 * S, cw, 230)
    bar(f0 + cM, g0 + cM + cw - 4 * S, cw, 4 * S, 60)
    bar(f0 + cM + cw - 4 * S, g0 + cM, 4 * S, cw, 60)
    // a shallow cross key inside the recess so it is not a blank hole
    bar(f0 + cM + cw * 0.5 - 5 * S, g0 + cM + 12 * S, 10 * S, cw - 24 * S, 132)
    bar(f0 + cM + 12 * S, g0 + cM + cw * 0.5 - 5 * S, cw - 24 * S, 10 * S, 132)
    for (const [bx, by] of [
      [f0 + 40 * S, g0 + 40 * S],
      [f0 + fw - 40 * S, g0 + 40 * S],
      [f0 + 40 * S, g0 + fw - 40 * S],
      [f0 + fw - 40 * S, g0 + fw - 40 * S],
    ]) {
      bolt(bx, by, 13 * S)
    }
  }

  // --- panel variant B: louvre vent bank (7 slots with proud lips) ---
  const faceLouvre = (f0: number, g0: number, fw: number) => {
    const m = 44 * S
    const iw = fw - m * 2
    // sunken frame field
    bar(f0 + m, g0 + m, iw, iw, 128)
    const slots = 7
    const sh = iw / slots
    for (let i = 0; i < slots; i++) {
      const sy = g0 + m + i * sh
      bar(f0 + m + 8 * S, sy + sh * 0.14, iw - 16 * S, sh * 0.46, 52) // slot trench
      bar(f0 + m + 8 * S, sy + sh * 0.14, iw - 16 * S, 4 * S, 84) // shadowed upper lip
      bar(f0 + m + 8 * S, sy + sh * 0.60 - 6 * S, iw - 16 * S, 9 * S, 236) // proud lower lip
    }
    // frame rails with a hard outer lip
    bar(f0 + m - 10 * S, g0 + m - 10 * S, iw + 20 * S, 10 * S, 212)
    bar(f0 + m - 10 * S, g0 + m + iw, iw + 20 * S, 10 * S, 212)
    bar(f0 + m - 10 * S, g0 + m - 10 * S, 10 * S, iw + 20 * S, 212)
    bar(f0 + m + iw, g0 + m - 10 * S, 10 * S, iw + 20 * S, 212)
    // vertical mullions splitting the bank into three bays
    bar(f0 + m + iw / 3 - 5 * S, g0 + m, 10 * S, iw, 200)
    bar(f0 + m + (iw * 2) / 3 - 5 * S, g0 + m, 10 * S, iw, 200)
    for (const [bx, by] of [
      [f0 + 34 * S, g0 + 34 * S],
      [f0 + fw - 34 * S, g0 + 34 * S],
      [f0 + 34 * S, g0 + fw - 34 * S],
      [f0 + fw - 34 * S, g0 + fw - 34 * S],
    ]) {
      bolt(bx, by, 11 * S)
    }
  }

  // --- panel variant C: raised octagonal flange over a recessed ring ---
  const faceBoss = (f0: number, g0: number, fw: number) => {
    const cxp = f0 + fw / 2
    const cyp = g0 + fw / 2
    disc(cxp, cyp, fw * 0.415, 88) // recessed ring field
    disc(cxp, cyp, fw * 0.415 - 4 * S, 104)
    ctx.fillStyle = 'rgb(216,216,216)'
    ctx.beginPath()
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8
      const px = cxp + Math.cos(a) * fw * 0.3
      const py = cyp + Math.sin(a) * fw * 0.3
      if (i === 0) ctx.moveTo(px, py)
      else ctx.lineTo(px, py)
    }
    ctx.closePath()
    ctx.fill()
    disc(cxp, cyp, fw * 0.235, 178) // flange step
    disc(cxp, cyp, fw * 0.125, 58) // bore
    disc(cxp, cyp, fw * 0.085, 156) // plug
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2
      bolt(cxp + Math.cos(a) * fw * 0.185, cyp + Math.sin(a) * fw * 0.185, 10 * S)
    }
    // four radial keys tying the flange into the plate corners
    const kw = fw * 0.15
    bar(cxp - fw * 0.46, cyp - 9 * S, kw, 18 * S, 200)
    bar(cxp + fw * 0.46 - kw, cyp - 9 * S, kw, 18 * S, 200)
    bar(cxp - 9 * S, cyp - fw * 0.46, 18 * S, kw, 200)
    bar(cxp - 9 * S, cyp + fw * 0.46 - kw, 18 * S, kw, 200)
    for (const [bx, by] of [
      [f0 + 36 * S, g0 + 36 * S],
      [f0 + fw - 36 * S, g0 + fw - 36 * S],
    ]) {
      bolt(bx, by, 12 * S)
    }
  }

  // --- panel variant D: double-stepped inset with a vertical reveal groove ---
  const faceStep = (f0: number, g0: number, fw: number) => {
    const m = 34 * S
    const w1 = fw - m * 2
    bar(f0 + m, g0 + m, w1, w1, 150)
    bar(f0 + m, g0 + m, w1, 4 * S, 228)
    bar(f0 + m, g0 + m, 4 * S, w1, 228)
    bar(f0 + m, g0 + m + w1 - 4 * S, w1, 4 * S, 64)
    bar(f0 + m + w1 - 4 * S, g0 + m, 4 * S, w1, 64)
    const m2 = m + 44 * S
    const w2 = fw - m2 * 2
    bar(f0 + m2, g0 + m2, w2, w2, 100)
    bar(f0 + m2, g0 + m2, w2, 4 * S, 196)
    bar(f0 + m2, g0 + m2, 4 * S, w2, 196)
    // reveal groove down the middle of the inner field
    bar(f0 + fw * 0.5 - 8 * S, g0 + m2 + 8 * S, 16 * S, w2 - 16 * S, 54)
    bar(f0 + fw * 0.5 - 8 * S, g0 + m2 + 8 * S, 5 * S, w2 - 16 * S, 182)
    // bolt row along the top rail, stiffener ribs along the bottom
    for (let i = 0; i < 5; i++) {
      bolt(f0 + m + (i + 0.5) * (w1 / 5), g0 + m + 20 * S, 9 * S)
    }
    for (let i = 0; i < 7; i++) {
      bar(f0 + m + 10 * S + i * ((w1 - 20 * S) / 7), g0 + fw - m - 26 * S, 18 * S, 11 * S, 178)
    }
  }

  // Four DIFFERENT 1 m plates per 2 m tile. A single repeated stamp is the
  // clearest "wallpaper" tell there is; four variants read as a plated wall.
  const variants = [faceFret, faceLouvre, faceBoss, faceStep]
  for (let py = 0; py < 2; py++) {
    for (let px = 0; px < 2; px++) {
      const x0 = px * cell
      const y0 = py * cell
      panelBase(x0, y0)
      variants[py * 2 + px](x0 + inset, y0 + inset, cell - inset * 2)
    }
  }
  // a single sub-texel softening pass: keeps the edges straight (they survive
  // the Sobel as a 2-texel ramp) without turning chamfers back into fillets
  ctx.filter = `blur(${(0.6 * S).toFixed(2)}px)`
  ctx.drawImage(canvas, 0, 0)
  ctx.filter = 'none'

  const d = ctx.getImageData(0, 0, size, size).data
  const h = new Float32Array(size * size)
  for (let i = 0; i < h.length; i++) {
    // fine machined grain LAST, on top of the authored relief, at an amplitude
    // that can never compete with a drawn edge. Frequencies are divided by S so
    // the grain stays the same WORLD size as the sheet resolution changes.
    const x = i % size
    const y = (i / size) | 0
    const grain =
      (vnoise((x * 0.22) / S, (y * 0.22) / S) - 0.5) * 0.04 +
      (vnoise((x * 0.9) / S, (y * 0.9) / S) - 0.5) * 0.018
    h[i] = Math.min(1, Math.max(0, d[i * 4] / 255 + grain))
  }
  return h
}

/**
 * Wrapping separable box blur of the height field.
 *
 * The cavity bake needs "height minus its neighbourhood average". Doing that
 * with a strided 25-tap gather per texel is 26 M samples on a 1024² sheet and
 * cost ~0.6 s of boot on its own; two separable passes are 2 M, give the FULL
 * box over the same support instead of a strided approximation, and land the
 * whole texture set under 0.4 s.
 */
function boxBlurWrap(h: Float32Array, size: number, radius: number): Float32Array {
  const tmp = new Float32Array(size * size)
  const out = new Float32Array(size * size)
  const w = radius * 2 + 1
  for (let y = 0; y < size; y++) {
    const row = y * size
    let acc = 0
    for (let k = -radius; k <= radius; k++) acc += h[row + ((k % size) + size) % size]
    for (let x = 0; x < size; x++) {
      tmp[row + x] = acc / w
      acc -= h[row + ((x - radius) % size + size) % size]
      acc += h[row + ((x + radius + 1) % size + size) % size]
    }
  }
  for (let x = 0; x < size; x++) {
    let acc = 0
    for (let k = -radius; k <= radius; k++) acc += tmp[(((k % size) + size) % size) * size + x]
    for (let y = 0; y < size; y++) {
      out[y * size + x] = acc / w
      acc -= tmp[(((y - radius) % size + size) % size) * size + x]
      acc += tmp[(((y + radius + 1) % size + size) % size) * size + x]
    }
  }
  return out
}

function heightSample(h: Float32Array, x: number, y: number): number {
  const size = TRIM_SIZE
  const xi = ((x % size) + size) % size
  const yi = ((y % size) + size) % size
  return h[yi * size + xi]
}

/**
 * One height field → four agreeing maps: normal, cavity-AO, roughness and
 * ALBEDO.
 *
 * R3: the albedo is the new one and it is the reason this round exists. Up to
 * now every stone surface in the level was a single RGB constant — the panel
 * relief only ever showed up as a shading gradient, so from 8 m the walls
 * flattened back to one value band and read as an untextured blockout. A real
 * surface carries its history in its diffuse: grime settling in the seam
 * trenches, crowns rubbed back to clean stone, plate-to-plate value drift from
 * the casting, broad patina, and dirt running down from every ledge and bolt
 * bore. None of that depends on the light, so it survives at any distance and
 * in any exposure.
 */
function buildOrokinMaps() {
  const size = TRIM_SIZE
  const S = size / 512
  const h = buildOrokinHeight()

  const [nCanvas, nCtx] = makeCanvas(size)
  const [aCanvas, aCtx] = makeCanvas(size)
  const [rCanvas, rCtx] = makeCanvas(size)
  const [cCanvas, cCtx] = makeCanvas(size)
  const [hCanvas, hCtx] = makeCanvas(size)
  const nImg = nCtx.createImageData(size, size)
  const aImg = aCtx.createImageData(size, size)
  const rImg = rCtx.createImageData(size, size)
  const cImg = cCtx.createImageData(size, size)
  // R5: the height field itself is now published as a map. A normal map says
  // which way a surface tilts; it cannot say that one plate stands 3 cm proud
  // of the one beside it, so at any grazing angle the relief flattens and the
  // wall goes back to reading as a printed sheet. The parallax-occlusion
  // raymarch in materials.applyWorldSurface marches THIS field, which is why
  // it has to leave the bake as a texture rather than staying a Float32Array.
  const hImg = hCtx.createImageData(size, size)
  {
    let hSum = 0
    let hMin = 1
    let hMax = 0
    const hist = new Uint32Array(256)
    for (let i = 0; i < h.length; i++) {
      const v = h[i]
      hSum += v
      if (v < hMin) hMin = v
      if (v > hMax) hMax = v
      hist[Math.min(255, Math.max(0, Math.round(v * 255)))]++
      const j = i * 4
      hImg.data[j] = hImg.data[j + 1] = hImg.data[j + 2] = v * 255
      hImg.data[j + 3] = 255
    }
    // 5th/95th percentile: the band the raymarch actually has to cover, which
    // is what the height SCALE has to be tuned against — min/max are two bolt
    // crowns and one pit floor and say nothing about the working depth.
    let acc = 0
    let p05 = 0
    let p95 = 1
    for (let b = 0; b < 256; b++) {
      acc += hist[b]
      if (p05 === 0 && acc >= h.length * 0.05) p05 = b / 255
      if (acc >= h.length * 0.95) {
        p95 = b / 255
        break
      }
    }
    orokinHeightStats = { mean: hSum / h.length, min: hMin, max: hMax, p05, p95 }
    hCtx.putImageData(hImg, 0, 0)
  }

  // The Sobel reads neighbours one TEXEL apart, so at double the sheet
  // resolution the same physical slope produces half the gradient. Scaling by
  // S keeps the relief identical in world terms as TRIM_SIZE changes.
  const strength = 2.8 * S
  const aoR = Math.round(6 * S)
  const hBlur = boxBlurWrap(h, size, aoR)
  let albedoSum = 0
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

      // --- cavity: height vs a wide neighbourhood average ---
      const hv = h[y * size + x]
      const cavRaw = hv - hBlur[y * size + x] // <0 concave, >0 convex (crown)
      // Panel seams, bolt bores and the recessed centre field are supposed to
      // be the darkest values on a lit wall; at a 0.42 floor they were a hint.
      const ao = Math.min(1, Math.max(0.22, 1 + cavRaw * 3.4))
      const av = ao * 255
      aImg.data[i] = aImg.data[i + 1] = aImg.data[i + 2] = av
      aImg.data[i + 3] = 255

      // --- roughness: raised machined faces polish, cavities stay matte ---
      let rough = 0.98 - hv * 0.52 + (vnoise((x * 0.5) / S, (y * 0.5) / S) - 0.5) * 0.16
      // grime in a crevice is dust, not stone: push it fully matte
      rough = Math.min(1, Math.max(0.16, rough + Math.max(0, -cavRaw) * 0.9))
      const rv = rough * 255
      rImg.data[i] = rImg.data[i + 1] = rImg.data[i + 2] = rv
      rImg.data[i + 3] = 255

      // --- albedo: the map that makes this stop being a flat colour ---
      // per-plate casting drift (each of the four 1 m plates its own value)
      const pIdx = (x < size / 2 ? 0 : 1) + (y < size / 2 ? 0 : 2)
      const jitter = (hash2(pIdx * 13.7 + 0.5, 4.1) - 0.5) * 0.12
      // broad patina, three octaves, none of them strong enough to be seen as
      // noise on its own — this is the low-frequency life of the surface
      const blotch =
        (vnoise((x * 0.012) / S, (y * 0.012) / S) - 0.5) * 0.15 +
        (vnoise((x * 0.05) / S, (y * 0.05) / S) - 0.5) * 0.075 +
        (vnoise((x * 0.21) / S, (y * 0.21) / S) - 0.5) * 0.035
      // a one-sided darkening octave: a symmetric blotch on a base of ~1.0
      // clips its bright half against white and only half the patina survives
      const blotchDown = vnoise((x * 0.026) / S + 31.7, (y * 0.026) / S + 11.3) * 0.14
      // Local cavity alone only finds EDGES: the middle of a 3.5 cm trench has
      // neighbours that are also trench, so cavRaw ≈ 0 there and the first
      // pass left every seam floor as clean as the panel face. Absolute height
      // is what says "this is the bottom of a channel" — dirt is a function of
      // where it can settle, not of local curvature. Both terms together fill
      // the trench AND darken its walls.
      const lowness = Math.min(1, Math.max(0, (0.5 - hv) / 0.4))
      // Weighting matters as much as magnitude. The cavity term is FINE detail
      // — seam floors, bolt bores, the shadow line under a lip — and it can be
      // strong without the eye reading it as a pattern. The absolute-height
      // term covers whole recessed fields, so pushed hard it paints the panel
      // MOTIF into the diffuse and the wall reads as printed wallpaper rather
      // than as relief. Cavity up, lowness down.
      const grime = Math.min(1, Math.max(0, -cavRaw) * 2.6 + lowness * 0.5)
      const crown = Math.min(1, Math.max(0, cavRaw) * 2.0)
      let lum = 1.0 + jitter + blotch - blotchDown + crown * 0.08 - grime * 0.52
      lum = Math.min(1, Math.max(0.12, lum))
      albedoSum += lum
      // grime is warm and dirty; rubbed crowns stay neutral
      const warm = grime * 0.55
      cImg.data[i] = lum * 255
      cImg.data[i + 1] = lum * (1 - warm * 0.1) * 255
      cImg.data[i + 2] = lum * (1 - warm * 0.26) * 255
      cImg.data[i + 3] = 255
    }
  }
  nCtx.putImageData(nImg, 0, 0)
  aCtx.putImageData(aImg, 0, 0)
  rCtx.putImageData(rImg, 0, 0)
  cCtx.putImageData(cImg, 0, 0)
  orokinAlbedoMean = albedoSum / (size * size)

  // Authored staining on top of the per-texel field: dirt pooling against the
  // uphill side of a lip, in straight-sided smudges.
  //
  // R5 — these used to be long vertical DRIP RUNS, and that was a layering
  // mistake rather than a strength one. Gravity does not tile: the moment the
  // tile permutation mirrors or (now) rotates a cell, a drawn run points
  // sideways or upward and the surface reads as printed. Weathering that
  // depends on which way is down belongs in the shader, keyed to world Y,
  // where it is continuous across every mesh and immune to the permutation —
  // see the avDrip term in materials.applyWorldSurface. What stays in the
  // sheet is the direction-free half: short, wide smudges that read the same
  // at any of the eight (now sixteen) tile orientations.
  cCtx.globalCompositeOperation = 'multiply'
  for (let i = 0; i < 52; i++) {
    const sx = hash2(i * 3.1 + 0.3, 1.7) * size
    const sy = hash2(i * 7.3 + 0.9, 5.9) * size * 0.72
    const w = (14 + hash2(i + 0.7, 2.2) * 44) * S
    const hgt = (22 + hash2(i * 1.9 + 1.3, 8.4) * 62) * S
    const a = 0.1 + hash2(i * 5.5 + 2.1, 3.3) * 0.16
    const g = cCtx.createRadialGradient(
      sx + w * 0.5,
      sy + hgt * 0.5,
      Math.min(w, hgt) * 0.12,
      sx + w * 0.5,
      sy + hgt * 0.5,
      Math.max(w, hgt) * 0.5,
    )
    g.addColorStop(0, `rgba(104,92,74,${a.toFixed(3)})`)
    g.addColorStop(0.55, `rgba(126,114,96,${(a * 0.55).toFixed(3)})`)
    g.addColorStop(1, 'rgba(255,255,255,0)')
    cCtx.fillStyle = g
    cCtx.fillRect(sx, sy, w, hgt)
  }
  cCtx.globalCompositeOperation = 'source-over'

  const mk = (c: HTMLCanvasElement, srgb = false) => {
    const t = new THREE.CanvasTexture(c)
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace
    // R4: 8 → 16. Every wall in this level is seen at a grazing angle down a
    // colonnade or across a 60 m span, which is exactly the case anisotropic
    // filtering exists for; at 8 the panel seams smeared into a grey band past
    // ~15 m and took the machined read with them.
    t.anisotropy = 16
    t.needsUpdate = true
    return t
  }
  orokinNormal = mk(nCanvas)
  orokinAO = mk(aCanvas)
  orokinRough = mk(rCanvas)
  orokinAlbedo = mk(cCanvas, true)
  orokinHeight = mk(hCanvas)
}

/**
 * The authored Orokin height field as a map (R = height, 0 = seam-trench
 * floor, 1 = bolt crown). Marched by the parallax-occlusion loop in
 * materials.applyWorldSurface so panel insets, louvre slots and bolt bores
 * actually shift against the face as the camera moves.
 */
export function getOrokinHeightTexture(): THREE.CanvasTexture {
  if (!orokinHeight) buildOrokinMaps()
  return orokinHeight!
}

/** Measured stats of the Orokin height field (parallax scale tuning + QA). */
export function getOrokinHeightStats() {
  if (!orokinHeight) buildOrokinMaps()
  return orokinHeightStats
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
 * Matching ALBEDO for the Orokin sheet — a tint multiplier, mean ≈ 0.93, so a
 * material keeps its base colour and gains grime, wear, per-plate casting
 * drift and patina. This is the map that stops carved stone being a flat fill.
 */
export function getOrokinAlbedoTexture(): THREE.CanvasTexture {
  if (!orokinAlbedo) buildOrokinMaps()
  return orokinAlbedo!
}

/** Mean luminance of the Orokin albedo map (measured at bake, for tuning). */
export function getOrokinAlbedoMean(): number {
  if (!orokinAlbedo) buildOrokinMaps()
  return orokinAlbedoMean
}

/** periodic value noise — lattice wraps at `period`, so the tile is seamless */
function pvnoise(x: number, y: number, period: number): number {
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const fx = x - ix
  const fy = y - iy
  const ux = fx * fx * (3 - 2 * fx)
  const uy = fy * fy * (3 - 2 * fy)
  const w = (v: number) => ((v % period) + period) % period
  const a = hash2(w(ix), w(iy))
  const b = hash2(w(ix + 1), w(iy))
  const c = hash2(w(ix), w(iy + 1))
  const d = hash2(w(ix + 1), w(iy + 1))
  return (a + (b - a) * ux) * (1 - uy) + (c + (d - c) * ux) * uy
}

/**
 * Periodic value noise with INDEPENDENT periods per axis.
 *
 * pvnoise wraps both axes at the same period, which is only correct when the
 * lattice frequency is the same in both. Every anisotropic layer — a rust
 * fibre that is fine across the run and coarse along it, a brushed grain — is
 * by definition not, and using pvnoise for one leaves a hard seam on whichever
 * axis has the lower frequency. The fibre breakup on the weathering atlas is
 * 96 × 11, so it needed this.
 */
function pvnoise2(x: number, y: number, px: number, py: number): number {
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const fx = x - ix
  const fy = y - iy
  const ux = fx * fx * (3 - 2 * fx)
  const uy = fy * fy * (3 - 2 * fy)
  const wx = (v: number) => ((v % px) + px) % px
  const wy = (v: number) => ((v % py) + py) % py
  const a = hash2(wx(ix), wy(iy))
  const b = hash2(wx(ix + 1), wy(iy))
  const c = hash2(wx(ix), wy(iy + 1))
  const d = hash2(wx(ix + 1), wy(iy + 1))
  return (a + (b - a) * ux) * (1 - uy) + (c + (d - c) * ux) * uy
}

/**
 * 256² MACRO variation — the layer every shipped game has and a blockout does
 * not.
 *
 * A trim sheet, however well authored, repeats. Tiled at 2 m across a 260 m
 * level it becomes wallpaper: the eye locks onto the period and the wall reads
 * as one printed texture rather than as built material. The fix is a second,
 * very low frequency map (see materials.MACRO_TILE_M — ~13 m per tile, roughly
 * six times the trim period) that modulates albedo VALUE and roughness. Blocks
 * of wall then differ from each other at architectural scale, exactly as real
 * cast panels weather unevenly, and the trim period disappears underneath it.
 *
 * Authored with PERIODIC value noise so the 13 m tile itself is seamless —
 * a hard discontinuity every 13 m would be worse than the tiling it fixes.
 * Rescaled after generation so the measured mean is 0.6, which the shader maps
 * back to a multiplier of ~1.0: the layer redistributes value, it does not
 * darken the level.
 */
export function getMacroVariationTexture(): THREE.CanvasTexture {
  if (macroVariation) return macroVariation
  const size = 256
  const [canvas, ctx] = makeCanvas(size)
  const raw = new Float32Array(size * size)
  let sum = 0
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size
      const v = y / size
      const m =
        pvnoise(u * 3, v * 3, 3) * 0.5 +
        pvnoise(u * 7, v * 7, 7) * 0.28 +
        pvnoise(u * 13, v * 13, 13) * 0.14 +
        pvnoise(u * 29, v * 29, 29) * 0.08
      raw[y * size + x] = m
      sum += m
    }
  }
  const mean = sum / raw.length
  const img = ctx.createImageData(size, size)
  let outSum = 0
  for (let i = 0; i < raw.length; i++) {
    // recentre on 0.6 and widen the spread so the layer actually does work
    const v = Math.min(1, Math.max(0, 0.6 + (raw[i] - mean) * 1.75))
    outSum += v
    const j = i * 4
    img.data[j] = img.data[j + 1] = img.data[j + 2] = v * 255
    img.data[j + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
  macroMean = outSum / raw.length
  macroVariation = new THREE.CanvasTexture(canvas)
  macroVariation.wrapS = macroVariation.wrapT = THREE.RepeatWrapping
  macroVariation.colorSpace = THREE.NoColorSpace
  macroVariation.anisotropy = 4
  return macroVariation
}

/** Measured mean of the macro variation map (the shader's neutral point). */
export function getMacroMean(): number {
  getMacroVariationTexture()
  return macroMean
}


// ---------------------------------------------------------------------------
// R6 — the weathering atlas
//
// The panel's third named difference between our frames and the reference was
// "every surface still sits at its authored colour". The macro layer above
// answers TILING; it does not answer WEATHERING, because it is one channel of
// value noise, and value noise cannot make a rust run. A run starts at a
// fixing, travels straight down under gravity, spreads as it goes and dies;
// it has a source, a direction and an end. Noise has none of those, which is
// why the round-5 `drip` term — a noise fetch stretched 17× vertically —
// read as a soft vertical smudge rather than as dirt that has run.
//
// So the runs are DRAWN: bolted flange bars at rectilinear rows, bolts at a
// fixed pitch along them, and a tapering gradient run falling from each one
// that actually emits. Noise only breaks the runs into fibres afterwards. The
// same atlas carries three more channels that the shader needs and that no
// single-channel map could hold at once:
//
//   R  rust / stain runs, gravity aligned (drawn, then fibre-broken)
//   G  grime pooling blotches — low frequency, contrast-curved so it POOLS
//      into patches instead of averaging out
//   B  dust deposition breakup, mid frequency
//   A  edge wear / scuff — drawn rectilinear scrapes plus fine grain
//
// Sampled in WORLD metres in the shader, at a fixed tile independent of every
// material's own trim scale, so a 12 cm rust run is 12 cm on the deck, on a
// column and on a 40 m arena wall. The R channel gets its own gravity-locked
// projection (horizontal world axis × world −Y); the rest use the material's
// dominant-axis planar projection.
// ---------------------------------------------------------------------------

const WEATHER_SIZE = 512
let weather: THREE.DataTexture | null = null
let weatherStats = { runMean: 0, runCover: 0, poolMean: 0, wearMean: 0 }

/**
 * One stain run: a straight, slightly tapering vertical band with a gradient
 * that is strongest just under its source and gone by its tail. Drawn three
 * times (at x, x−size, x+size) so a run crossing the tile edge is continuous
 * when the map wraps.
 */
function drawRun(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  len: number,
  alpha: number,
  size: number,
) {
  const g = ctx.createLinearGradient(0, y, 0, y + len)
  g.addColorStop(0, `rgba(255,255,255,${(alpha * 0.55).toFixed(3)})`)
  g.addColorStop(0.06, `rgba(255,255,255,${alpha.toFixed(3)})`)
  g.addColorStop(0.34, `rgba(255,255,255,${(alpha * 0.62).toFixed(3)})`)
  g.addColorStop(0.72, `rgba(255,255,255,${(alpha * 0.22).toFixed(3)})`)
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  // widen in three straight steps as it falls — a run spreads, but it spreads
  // in flat-sided tongues, not in a cone
  for (let s = 0; s < 3; s++) {
    const y0 = y + (len * s) / 3
    const h0 = len / 3
    const ww = w * (1 + s * 0.34)
    for (const ox of [-size, 0, size]) {
      ctx.fillRect(x + ox - ww * 0.5, y0, ww, h0)
    }
  }
}

function buildWeatherMaps() {
  const size = WEATHER_SIZE

  // --- R: drawn stain runs -------------------------------------------------
  const [, s] = makeCanvas(size)
  s.fillStyle = '#000'
  s.fillRect(0, 0, size, size)
  s.globalCompositeOperation = 'lighter'
  // Every row sits in the upper 74 % and every run is dead well before the
  // bottom edge, so the tile wraps vertically with nothing to line up.
  for (let r = 0; r < 7; r++) {
    const ry = 10 + hash2(r * 4.7 + 0.31, 2.13) * size * 0.68
    const pitch = 24 + hash2(r * 2.9 + 1.7, 7.41) * 44
    // the fixing itself — a straight bolted flange bar. Rectilinear, full
    // width, so the run has a visible SOURCE and the eye reads cause first.
    const barH = 2 + Math.floor(hash2(r + 3.3, 9.1) * 3)
    s.fillStyle = 'rgba(255,255,255,0.11)'
    s.fillRect(0, ry, size, barH)
    s.fillStyle = 'rgba(255,255,255,0.22)'
    s.fillRect(0, ry + barH, size, 1)
    for (let x = hash2(r * 5.1, 3.7) * pitch; x < size; x += pitch) {
      const k = hash2(x * 0.021 + r * 3.7, 5.2)
      if (k < 0.40) continue
      const w = 2 + Math.floor(hash2(x * 0.013 + r, 8.8) * 11)
      // Clamped so the run's gradient reaches zero INSIDE the tile. A run
      // that ran off the bottom edge would be cut flat by the canvas and the
      // map would then have a hard horizontal line across every wall in the
      // level at the 9 m wrap — the one artefact a tiling weather map cannot
      // have, because the eye finds a straight horizontal discontinuity
      // faster than it finds anything else.
      const room = size - (ry + barH) - 12
      const len = Math.min(room, 44 + hash2(x * 0.017 + r * 2.2, 1.9) * 300)
      if (len < 24) continue
      const a = 0.30 + hash2(x * 0.031 + r, 6.6) * 0.55
      // bolt head: a short, wide bleed halo right at the source
      s.fillStyle = `rgba(255,255,255,${(a * 0.5).toFixed(3)})`
      s.fillRect(x - w * 0.9, ry + barH, w * 1.8, 3)
      drawRun(s, x, ry + barH, w, len, a, size)
      // a wide bleed always has hairlines beside it
      if (k > 0.66) {
        drawRun(s, x - w - 2 - hash2(x, 2.2) * 5, ry + barH, 1.5, len * 0.55, a * 0.5, size)
      }
      if (k > 0.82) {
        drawRun(s, x + w + 2 + hash2(x, 5.4) * 6, ry + barH, 1.5, len * 0.42, a * 0.44, size)
      }
    }
  }
  s.globalCompositeOperation = 'source-over'
  const sData = s.getImageData(0, 0, size, size).data

  // --- A: drawn edge wear / scuff -----------------------------------------
  const [, w] = makeCanvas(size)
  w.fillStyle = '#000'
  w.fillRect(0, 0, size, size)
  w.globalCompositeOperation = 'lighter'
  // Straight scrapes only — a scuff on a machined plate follows the plate, so
  // it is axis-aligned. Curves here would read as a paint effect.
  for (let i = 0; i < 430; i++) {
    const hx = hash2(i * 1.7 + 0.5, 3.1)
    const hy = hash2(i * 2.3 + 1.1, 6.7)
    const hl = hash2(i * 3.9 + 2.7, 8.3)
    const ha = hash2(i * 5.3 + 0.9, 1.5)
    const len = 6 + hl * 54
    const th = 1 + Math.floor(hash2(i * 1.3, 4.4) * 2)
    w.fillStyle = `rgba(255,255,255,${(0.18 + ha * 0.6).toFixed(3)})`
    const horiz = hash2(i * 7.1, 2.9) < 0.55
    // drawn at every wrap offset, so a scratch crossing the tile edge comes
    // out of the other side instead of being clipped flat against it
    for (const ox of [-size, 0]) {
      for (const oy of [-size, 0]) {
        if (horiz) w.fillRect(hx * size + ox, hy * size + oy, len, th)
        else w.fillRect(hx * size + ox, hy * size + oy, th, len)
      }
    }
  }
  // chipped plate corners — small rectilinear bites where an edge has gone
  for (let i = 0; i < 34; i++) {
    const cx = hash2(i * 2.1 + 3.3, 7.9) * size
    const cy = hash2(i * 4.7 + 1.9, 2.5) * size
    const cw = 3 + hash2(i * 1.1, 9.3) * 12
    const ch = 3 + hash2(i * 3.7, 4.1) * 12
    w.fillStyle = `rgba(255,255,255,${(0.34 + hash2(i, 5.5) * 0.45).toFixed(3)})`
    for (const ox of [-size, 0]) for (const oy of [-size, 0]) w.fillRect(cx + ox, cy + oy, cw, ch)
  }
  w.globalCompositeOperation = 'source-over'
  const wData = w.getImageData(0, 0, size, size).data

  // --- composite the four channels ----------------------------------------
  // The composite deliberately does NOT go through a canvas. A 2D canvas
  // backing store is PREMULTIPLIED, and this atlas' alpha channel is data
  // (edge wear), not coverage — every texel with wear 0 would have had its
  // R, G and B crushed to zero on upload, which would have deleted the rust
  // runs from exactly the clean panels they are supposed to stain. A
  // DataTexture hands the bytes to WebGL untouched.
  const data = new Uint8Array(size * size * 4)
  let runSum = 0
  let runCov = 0
  let poolSum = 0
  let wearSum = 0
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x
      const j = i * 4
      const u = x / size
      const v = y / size

      // R — the drawn run, broken into fibres. High frequency ACROSS the run,
      // low frequency along it, which is what turns a painted band into dirt.
      const fibre =
        pvnoise2(u * 96, v * 11, 96, 11) * 0.62 + pvnoise2(u * 27, v * 5, 27, 5) * 0.38
      const run = Math.min(1, (sData[j] / 255) * (0.30 + 1.25 * fibre))
      runSum += run
      if (run > 0.15) runCov++

      // G — grime pooling. Two periodic octaves, then a contrast curve: dirt
      // collects in patches and leaves the rest of the panel alone, so the
      // interesting part of this channel is its TOP tail, not its mean.
      const pn =
        pvnoise(u * 4, v * 4, 4) * 0.56 +
        pvnoise(u * 9, v * 9, 9) * 0.29 +
        pvnoise(u * 19, v * 19, 19) * 0.15
      const pool = Math.min(1, Math.max(0, (pn - 0.30) * 1.75)) ** 1.35
      poolSum += pool

      // B — dust breakup, mid frequency. Multiplies the shader's world-normal
      // dust term so settled dust is patchy instead of a flat wash on every
      // up-facing polygon.
      const dust = Math.min(
        1,
        Math.max(0, pvnoise(u * 13, v * 13, 13) * 0.68 + pvnoise(u * 31, v * 31, 31) * 0.32),
      )

      // A — scuff, with fine grain under it
      const grain = pvnoise(u * 71, v * 71, 71)
      // The drawn scuffs are sparse by design — a scratch is a line, not a
      // field — but measured over the tile they came out at a mean of 0.019,
      // which after the material's own wear weight is nothing. The squared
      // grain floor under them gives every proud face a low, uneven polish
      // that breaks the specular between the scratches without ever reading
      // as noise.
      const wear = Math.min(1, (wData[j] / 255) * (0.45 + 0.9 * grain) + grain * grain * 0.22)
      wearSum += wear

      data[j] = run * 255
      data[j + 1] = pool * 255
      data[j + 2] = dust * 255
      data[j + 3] = wear * 255
    }
  }
  const n = size * size
  weatherStats = {
    runMean: runSum / n,
    runCover: runCov / n,
    poolMean: poolSum / n,
    wearMean: wearSum / n,
  }
  weather = new THREE.DataTexture(data, size, size, THREE.RGBAFormat)
  weather.wrapS = weather.wrapT = THREE.RepeatWrapping
  weather.colorSpace = THREE.NoColorSpace
  // DataTexture defaults to NEAREST with no mip chain; at the distances this
  // is read across a 260 m level that would alias into a shimmering mess.
  weather.magFilter = THREE.LinearFilter
  weather.minFilter = THREE.LinearMipmapLinearFilter
  weather.generateMipmaps = true
  // the runs are long and thin and are read at grazing angles down every
  // colonnade; without anisotropy they mip into a grey wash by 8 m
  weather.anisotropy = 16
  weather.needsUpdate = true
  return weather
}

/**
 * RGBA weathering atlas — R stain runs, G grime pools, B dust breakup,
 * A edge wear. See buildWeatherMaps. Premultiplied alpha is NOT wanted here
 * (A is data, not coverage), which is why it is composed through ImageData
 * rather than by drawing the four canvases on top of each other.
 */
export function getWeatherTexture(): THREE.DataTexture {
  if (weather) return weather
  return buildWeatherMaps()
}

/** Measured channel statistics of the weathering atlas (tuning + QA). */
export function getWeatherStats(): {
  runMean: number
  runCover: number
  poolMean: number
  wearMean: number
} {
  getWeatherTexture()
  return weatherStats
}

/**
 * Gold surface set — ONE authored height field → normal, ORM and albedo.
 *
 * R4. The previous pass built gold entirely out of value noise: the normal was
 * three octaves of `vnoise`, the roughness was a noise streak field, and the
 * albedo was a noise tarnish field. Noise cannot make a straight machined
 * edge, and without straight edges a metal has nothing for its highlight to
 * break against — every gold run in the level rendered as one smooth,
 * uniformly-lit tube, which is exactly why the panel called it "tan rubber
 * rope" rather than metal.
 *
 * What actually reads as gold at 20 m is not the colour, it is a NARROW
 * specular that runs CONTINUOUSLY along a machined land and stops dead at a
 * groove. So the sheet is drawn, in this order:
 *
 *   1. reeded moulding — parallel polished lands separated by chamfered
 *      grooves (three-step chamfers, so the ramp catches the key as a
 *      distinct value rather than blurring into a fillet)
 *   2. score lines with a lit lower lip
 *   3. two cross-straps with proud lips and bolt beads, running perpendicular
 *      to the reeds so the highlight is interrupted at a hard edge
 *   4. a sunken fret-meander inlay course
 *   5. sparse cast pits
 *   6. ONLY THEN the fine brush striation, as noise at an amplitude that
 *      cannot compete with any drawn edge
 *
 * The roughness map is then a function of the drawn height, so the lands come
 * out at ~0.06 (a mirror — it will produce a hard specular line from the key
 * alone, with no dependence on how bright the environment probe happens to
 * be) and the groove floors at ~0.5. That contrast is the metal read.
 */
const GOLD_SIZE = 512

/**
 * Authored roughness band: polished land → groove floor.
 *
 * R5: 0.055–0.52 → 0.14–0.40, which is the band the panel asked for
 * ("pull the gold trim ORM roughness to 0.12–0.30").
 *
 * 0.055 is a mirror, and a mirror is exactly why gold kept coming back as
 * "either a black outline or a bloom blob": at that roughness a gold land
 * reflects a near-delta image of the probe, so it is either pointing at the
 * narrow bright bar — in which case it returns a value several stops over the
 * bloom knee and blooms into a shapeless blob — or it is not, in which case it
 * returns the probe's near-black floor and the trim renders as a dark outline
 * against the ivory. There is no third state, and no amount of albedo or
 * exposure work can create one. Widening the lobe to 0.14–0.40 gives the land
 * a specular that covers tens of degrees, so it RAMPS across a curved run:
 * bright at the facing angle, falling off smoothly to a warm mid, which is how
 * a real gilded moulding reads and what lets the eye follow its form.
 */
const GOLD_ROUGH_LO = 0.14
const GOLD_ROUGH_HI = 0.4

function buildGoldHeight(): Float32Array {
  const size = GOLD_SIZE
  const [canvas, ctx] = makeCanvas(size)
  const G = size / 512 // authoring unit — every constant below is 512-px terms

  const bar = (x: number, y: number, w: number, h: number, v: number) => {
    ctx.fillStyle = `rgb(${v},${v},${v})`
    ctx.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h)))
  }
  const disc = (x: number, y: number, r: number, v: number) => {
    ctx.fillStyle = `rgb(${v},${v},${v})`
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }
  /** bead: counter-sunk ring with a proud dome and a lit crescent */
  const bead = (x: number, y: number, r: number) => {
    disc(x, y, r, 62)
    disc(x, y, r * 0.7, 244)
    disc(x - r * 0.14, y - r * 0.14, r * 0.44, 224)
  }

  const LAND = 210
  const GROOVE = 48

  ctx.fillStyle = `rgb(${LAND},${LAND},${LAND})`
  ctx.fillRect(0, 0, size, size)

  // --- 1/2: reeded moulding. Lands run along U; grooves cut across V. ---
  const BAND = 64 * G // 8 reeds per tile
  for (let b = 0; b < size / BAND; b++) {
    const y0 = b * BAND
    // groove with a three-step chamfer on each side
    const gc = y0 + BAND * 0.68
    const gw = BAND * 0.085
    for (let s = 0; s < 4; s++) {
      const t = s / 3
      const w = gw * (1 + (1 - t) * 1.15)
      const v = Math.round(LAND + (GROOVE - LAND) * t)
      bar(0, gc - w, size, w * 2, v)
    }
    // the lit lip on the far side of the groove — a one-texel bright line is
    // what makes a chamfer read as machined rather than as a soft dent
    bar(0, gc + gw * 1.0, size, 2 * G, 246)
    // secondary score line higher up the land
    bar(0, y0 + BAND * 0.22, size, 3 * G, 92)
    bar(0, y0 + BAND * 0.22 + 3 * G, size, 2 * G, 238)
  }

  // --- 3: cross-straps, perpendicular to the reeds ---
  const strap = (x0: number) => {
    const w = 30 * G
    bar(x0 - 5 * G, 0, w + 10 * G, size, 138) // shoulder trench the strap sits in
    bar(x0, 0, w, size, 228) // strap face
    bar(x0, 0, 4 * G, size, 252) // lit leading lip
    bar(x0 + w - 4 * G, 0, 4 * G, size, 118) // shaded trailing lip
    for (let i = 0; i < 9; i++) bead(x0 + w * 0.5, (i + 0.5) * (size / 9), 8 * G)
  }
  strap(46 * G)
  strap(302 * G)

  // --- 4: sunken fret-meander inlay course ---
  const yb = 168 * G
  const hb = 62 * G
  bar(0, yb - 4 * G, size, hb + 8 * G, 150) // surround
  bar(0, yb, size, hb, 104) // channel floor
  bar(0, yb, size, 4 * G, 58) // top shadow line
  bar(0, yb + hb - 4 * G, size, 4 * G, 240) // bottom lit lip
  const p = size / 8 // meander period — divides the tile, so it wraps
  const t = hb * 0.17
  for (let i = 0; i < 8; i++) {
    const x0 = i * p
    bar(x0 + p * 0.08, yb + hb * 0.18, p * 0.62, t, 216)
    bar(x0 + p * 0.08, yb + hb * 0.18, t, hb * 0.62, 216)
    bar(x0 + p * 0.08, yb + hb * 0.62, p * 0.46, t, 216)
    bar(x0 + p * 0.5, yb + hb * 0.34, t, hb * 0.34, 216)
  }

  // --- 5: sparse cast pits ---
  for (let i = 0; i < 34; i++) {
    disc(hash2(i * 2.7, 4.4) * size, hash2(i * 6.1, 9.2) * size, (1.2 + hash2(i, 3.1) * 2.6) * G, 54)
  }

  // sub-texel softening: keeps the drawn edges as a 2-texel ramp through the
  // Sobel instead of a 1-texel step that aliases at distance
  ctx.filter = `blur(${(0.55 * G).toFixed(2)}px)`
  ctx.drawImage(canvas, 0, 0)
  ctx.filter = 'none'

  const d = ctx.getImageData(0, 0, size, size).data
  const h = new Float32Array(size * size)
  for (let i = 0; i < h.length; i++) {
    const x = i % size
    const y = (i / size) | 0
    // --- 6: brush striation LAST. Long in U, high frequency in V, and small
    // enough in amplitude that it can only ever modulate a land, never carve
    // one. This is what smears the specular ALONG the reed.
    const brush =
      (vnoise((x * 0.03) / G, (y * 2.6) / G) - 0.5) * 0.042 +
      (vnoise((x * 0.09) / G, (y * 8.1) / G) - 0.5) * 0.02 +
      (vnoise((x * 0.02) / G, (y * 23.0) / G) - 0.5) * 0.009
    h[i] = Math.min(1, Math.max(0, d[i * 4] / 255 + brush))
  }
  return h
}

function buildGoldMaps() {
  const size = GOLD_SIZE
  const G = size / 512
  const h = buildGoldHeight()
  const hBlur = boxBlurWrap(h, size, Math.round(5 * G))

  const [nCanvas, nCtx] = makeCanvas(size)
  const [cCanvas, cCtx] = makeCanvas(size)
  const [oCanvas, oCtx] = makeCanvas(size)
  const [rCanvas, rCtx] = makeCanvas(size)
  const nImg = nCtx.createImageData(size, size)
  const cImg = cCtx.createImageData(size, size)
  const oImg = oCtx.createImageData(size, size)
  const rImg = rCtx.createImageData(size, size)

  const sample = (x: number, y: number) =>
    h[(((y % size) + size) % size) * size + (((x % size) + size) % size)]
  const strength = 2.4 * G
  let roughSum = 0
  let roughMin = 1
  let roughMax = 0
  let albedoSum = 0

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      const hv = h[y * size + x]
      const cav = hv - hBlur[y * size + x]

      // --- normal ---
      let nx = (sample(x - 1, y) - sample(x + 1, y)) * strength
      let ny = (sample(x, y - 1) - sample(x, y + 1)) * strength
      const inv = 1 / Math.sqrt(nx * nx + ny * ny + 1)
      nx *= inv
      ny *= inv
      nImg.data[i] = (nx * 0.5 + 0.5) * 255
      nImg.data[i + 1] = (ny * 0.5 + 0.5) * 255
      nImg.data[i + 2] = inv * 255
      nImg.data[i + 3] = 255

      // --- wear / tarnish field (still noise, but it only MODULATES; the
      // structure is all drawn) ---
      const u = x / size
      const v = y / size
      const wearRaw = pvnoise(u * 7, v * 7, 7) * 0.58 + pvnoise(u * 17, v * 17, 17) * 0.42
      const wt = Math.min(1, Math.max(0, (wearRaw - 0.44) / 0.34))
      const wear = wt * wt * (3 - 2 * wt)
      const pit = hash2(x * 1.7, y * 2.3) > 0.9965 ? 1 : 0

      // --- roughness: driven by the DRAWN height. A polished land lands at
      // ~0.06 and produces a hard specular line off the key alone; a groove
      // floor sits at ~0.5 and scatters. That contrast IS the metal read, and
      // unlike an environment reflection it does not depend on the probe.
      let rough = GOLD_ROUGH_HI - hv * (GOLD_ROUGH_HI - GOLD_ROUGH_LO)
      // R5: the additive terms are scaled back with the band. At the old
      // amplitudes a worn groove floor added 0.15 + 0.55 on top of 0.52 and
      // clipped to fully matte, which threw away the land/groove contrast the
      // drawn sheet exists to provide — two thirds of the tile was one value.
      rough += wear * 0.1 + pit * 0.22 + Math.max(0, -cav) * 0.38
      rough = Math.min(0.62, Math.max(0.115, rough))
      roughSum += rough
      if (rough < roughMin) roughMin = rough
      if (rough > roughMax) roughMax = rough
      rImg.data[i] = rImg.data[i + 1] = rImg.data[i + 2] = rough * 255
      rImg.data[i + 3] = 255

      // --- cavity AO: groove floors, bead bores and the inlay channel go
      // properly dark. The old map floored at 0.72, which is a hint, not an
      // occlusion — a metal with no dark side is a plastic.
      const ao = Math.min(1, Math.max(0.34, 1 + cav * 3.2 - pit * 0.3))
      // --- metalness: worn gilding reflects less crisply but never stops
      // being metal (a dielectric at gold albedo renders as ochre paint).
      const metal = Math.min(1, Math.max(0.76, 1 - wear * 0.18 - pit * 0.26))
      oImg.data[i] = ao * 255
      oImg.data[i + 1] = rough * 255
      oImg.data[i + 2] = metal * 255
      oImg.data[i + 3] = 255

      // --- albedo multiplier. A metal takes nearly all its colour from what
      // it reflects, so this stays a whisper of value — but grime in a groove
      // and a rubbed-clean land are light-independent, which is what keeps
      // gold from flattening to one tone in a blown highlight.
      const grime = Math.min(1, Math.max(0, -cav) * 2.4 + Math.max(0, (0.45 - hv) / 0.4) * 0.45)
      const crown = Math.min(1, Math.max(0, cav) * 1.8)
      const lum = Math.min(1, Math.max(0.3, 1.0 - grime * 0.4 - pit * 0.4 + crown * 0.07 - wear * 0.08))
      albedoSum += lum
      const warm = grime * 0.5 + wear * 0.3
      cImg.data[i] = lum * 255
      cImg.data[i + 1] = lum * (1 - warm * 0.09) * 255
      cImg.data[i + 2] = lum * (1 - warm * 0.3) * 255
      cImg.data[i + 3] = 255
    }
  }
  nCtx.putImageData(nImg, 0, 0)
  cCtx.putImageData(cImg, 0, 0)
  oCtx.putImageData(oImg, 0, 0)
  rCtx.putImageData(rImg, 0, 0)

  goldRoughMean = roughSum / (size * size)
  goldRoughRange = [roughMin, roughMax]
  goldAlbedoMean = albedoSum / (size * size)

  const mk = (c: HTMLCanvasElement, srgb = false) => {
    const t = new THREE.CanvasTexture(c)
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace
    // R4: 8 → 16. Gold trim is almost always seen at a grazing angle along a
    // long run, which is the exact case anisotropic filtering exists for; at 8
    // the reed lands smeared into a single band past ~12 m.
    t.anisotropy = 16
    t.needsUpdate = true
    return t
  }
  goldNormal = mk(nCanvas)
  goldAlbedo = mk(cCanvas, true)
  goldORM = mk(oCanvas)
  goldRough = mk(rCanvas)
}

/** Gold albedo multiplier — groove grime, rubbed lands, cast pits, tarnish. */
export function getGoldAlbedoTexture(): THREE.CanvasTexture {
  if (!goldAlbedo) buildGoldMaps()
  return goldAlbedo!
}

/**
 * Packed gold ORM — R cavity AO, G roughness, B metalness.
 * three samples `.g` for roughnessMap and `.b` for metalnessMap, so this one
 * texture can be bound to roughnessMap, metalnessMap and aoMap at once.
 */
export function getGoldORMTexture(): THREE.CanvasTexture {
  if (!goldORM) buildGoldMaps()
  return goldORM!
}

/** Greyscale copy of the ORM's roughness channel, for materials that want it alone. */
export function getBrushedGoldRoughnessTexture(): THREE.CanvasTexture {
  if (!goldRough) buildGoldMaps()
  return goldRough!
}

/** Machined gold normal — reeds, chamfers, straps, beads and fret inlay. */
export function getBrushedGoldNormalTexture(): THREE.CanvasTexture {
  if (!goldNormal) buildGoldMaps()
  return goldNormal!
}

/** Measured stats from the gold bake (for tuning and QA assertions). */
export function getGoldStats(): { roughMean: number; roughMin: number; roughMax: number; albedoMean: number } {
  if (!goldORM) buildGoldMaps()
  return {
    roughMean: goldRoughMean,
    roughMin: goldRoughRange[0],
    roughMax: goldRoughRange[1],
    albedoMean: goldAlbedoMean,
  }
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
  detailNormal.anisotropy = 8
  return detailNormal
}

// ---------------------------------------------------------------------------
// R6 — the second material family
//
// The reference frame's biggest single departure from ours is not a lighting
// one: green foliage grows over the metal at the top and right, there is
// cable and cloth in it, and those soft materials break the hard surface up.
// A level made entirely of one hard family reads as a CAD render however well
// that family is authored, which is why this sits in the surface-materials
// axis rather than in prop art.
//
// These bake LAZILY — nothing here is generated unless a material asks for it
// — so they cost nothing at boot until geometry that uses them exists.
// ---------------------------------------------------------------------------

const GROWTH_SIZE = 256
let growthMap: THREE.CanvasTexture | null = null
let growthAlpha: THREE.CanvasTexture | null = null

/**
 * Alpha-tested growth card: a cluster of tapering fronds rooted at the bottom
 * edge of the tile, so a quad standing on a wall/floor junction reads as
 * something growing out of the joint.
 *
 * Returned as two OPAQUE textures rather than one RGBA canvas, because a 2D
 * canvas backing store is premultiplied: a colour map with partial alpha in it
 * comes back with its RGB crushed toward black at every blade edge, which is
 * exactly where an alpha-tested card gets cut.
 */
export function getGrowthTextures(): { map: THREE.CanvasTexture; alphaMap: THREE.CanvasTexture } {
  if (growthMap && growthAlpha) return { map: growthMap, alphaMap: growthAlpha }
  const size = GROWTH_SIZE
  const [cCanvas, c] = makeCanvas(size)
  const [aCanvas, a] = makeCanvas(size)
  // Dark and DESATURATED. The reference's green reads as a hue against warm
  // grey, not as a saturated prop colour, and a bright green card here would
  // compete with the gold accents that carry the level's colour script.
  c.fillStyle = '#20281B'
  c.fillRect(0, 0, size, size)
  a.fillStyle = '#000'
  a.fillRect(0, 0, size, size)

  const blade = (
    ctx: CanvasRenderingContext2D,
    x0: number,
    len: number,
    lean: number,
    wide: number,
    fill: string,
  ) => {
    const tipX = x0 + lean
    const tipY = size - len
    ctx.fillStyle = fill
    ctx.beginPath()
    ctx.moveTo(x0 - wide, size)
    ctx.quadraticCurveTo(x0 - wide * 0.7 + lean * 0.35, size - len * 0.55, tipX, tipY)
    ctx.quadraticCurveTo(x0 + wide * 0.7 + lean * 0.35, size - len * 0.55, x0 + wide, size)
    ctx.closePath()
    ctx.fill()
  }

  for (let i = 0; i < 46; i++) {
    const x0 = hash2(i * 3.1 + 0.7, 2.9) * size
    const len = size * (0.28 + hash2(i * 1.7 + 2.3, 5.1) * 0.62)
    const lean = (hash2(i * 5.3 + 1.1, 8.7) - 0.5) * size * 0.55
    const wide = 3 + hash2(i * 2.7, 4.3) * 9
    // depth by value: blades behind are darker and cooler
    const d = hash2(i * 7.9 + 0.3, 1.3)
    const gg = Math.round(46 + d * 74)
    const rr = Math.round(28 + d * 46)
    const bb = Math.round(24 + d * 34)
    for (const ox of [-size, 0, size]) {
      blade(a, x0 + ox, len, lean, wide, '#fff')
      blade(c, x0 + ox, len, lean, wide, `rgb(${rr},${gg},${bb})`)
    }
  }
  // a dry, yellowed fringe on the tips and a dark rot at the root — foliage is
  // never one green, and a card that is one green reads as a decal
  c.globalCompositeOperation = 'source-atop'
  const fr = c.createLinearGradient(0, 0, 0, size)
  fr.addColorStop(0, 'rgba(122,110,54,0.55)')
  fr.addColorStop(0.42, 'rgba(96,96,50,0.18)')
  fr.addColorStop(1, 'rgba(24,34,20,0.5)')
  c.fillStyle = fr
  c.fillRect(0, 0, size, size)
  c.globalCompositeOperation = 'source-over'

  const mk = (cv: HTMLCanvasElement, srgb: boolean) => {
    const t = new THREE.CanvasTexture(cv)
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace
    t.anisotropy = 8
    t.needsUpdate = true
    return t
  }
  growthMap = mk(cCanvas, true)
  growthAlpha = mk(aCanvas, false)
  return { map: growthMap, alphaMap: growthAlpha }
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

// ---------------------------------------------------------------------------
// R5 — shared ENEMY armour sheet (normal + packed ORM + albedo).
//
// The enemies have had no art pass in five rounds and render as flat-shaded
// boxes; a single frame of that at melee range is what the panel said "ends
// the comparison". This is the surface half of the fix, and it lives here
// because it is a texture bake. Binding it to the Trooper / Heavy / Drone
// materials is the enemy axis' job — see the note in my report.
//
// Deliberately NOT the Orokin sheet: the architecture is cast ceramic plating
// at 1 m panels, an enemy is a fabricated combat shell at ~15 cm plates, and
// reusing the wall trim on a body is its own kind of tell. Same authoring
// discipline though — drawn rectilinear structure first (plate borders with
// chamfers, a recessed joint channel, a vent louvre bank, a bolt row, a
// weld/seam ladder), value noise only at the end as grain.
// ---------------------------------------------------------------------------
let enemyNormal: THREE.CanvasTexture | null = null
let enemyORM: THREE.CanvasTexture | null = null
let enemyAlbedo: THREE.CanvasTexture | null = null

const ENEMY_SIZE = 512

function buildEnemyMaps() {
  const size = ENEMY_SIZE
  const E = size / 512
  const [canvas, ctx] = makeCanvas(size)

  const bar = (x: number, y: number, w: number, h: number, v: number) => {
    ctx.fillStyle = `rgb(${v},${v},${v})`
    ctx.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h)))
  }
  const disc = (x: number, y: number, r: number, v: number) => {
    ctx.fillStyle = `rgb(${v},${v},${v})`
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }
  const rivet = (x: number, y: number, r: number) => {
    disc(x, y, r, 56)
    disc(x, y, r * 0.64, 232)
    disc(x - r * 0.13, y - r * 0.13, r * 0.4, 208)
  }

  const SHELL = 120 // the shell field the plates are bolted onto
  const FACE = 198 // plate face
  ctx.fillStyle = `rgb(${SHELL},${SHELL},${SHELL})`
  ctx.fillRect(0, 0, size, size)

  // recessed joint channel running the full tile in both axes — this is what
  // splits the body into plates when the model is 30 px tall
  const cell = size / 2
  for (let i = 0; i < 2; i++) {
    bar(i * cell - 9 * E, 0, 18 * E, size, 44)
    bar(0, i * cell - 9 * E, size, 18 * E, 44)
  }

  /** one ~15 cm armour plate: chamfer border, face, clipped corner */
  const plate = (x0: number, y0: number, w: number) => {
    const m = 22 * E
    // three-step chamfer into the face
    for (let s = 0; s < 3; s++) {
      const t = s / 2
      const k = m - t * 12 * E
      const v = Math.round(72 + t * (FACE - 72))
      rr(ctx, x0 + k, y0 + k, w - k * 2, w - k * 2, (9 - t * 5) * E)
      ctx.fillStyle = `rgb(${v},${v},${v})`
      ctx.fill()
    }
    // clipped corner — asymmetry, so the plate has a readable "up"
    ctx.fillStyle = `rgb(${SHELL},${SHELL},${SHELL})`
    ctx.beginPath()
    ctx.moveTo(x0 + w - m, y0 + m)
    ctx.lineTo(x0 + w - m - 44 * E, y0 + m)
    ctx.lineTo(x0 + w - m, y0 + m + 44 * E)
    ctx.closePath()
    ctx.fill()
    // lit top lip / shaded bottom lip on the face
    bar(x0 + m, y0 + m, w - m * 2, 4 * E, 244)
    bar(x0 + m, y0 + w - m - 4 * E, w - m * 2, 4 * E, 62)
  }

  const inner = cell
  for (let py = 0; py < 2; py++) {
    for (let px = 0; px < 2; px++) {
      const x0 = px * inner
      const y0 = py * inner
      plate(x0, y0, inner)
      const q = py * 2 + px
      const fx = x0 + 44 * E
      const fy = y0 + 44 * E
      const fw = inner - 88 * E
      if (q === 0) {
        // vent louvre bank — 5 slots with proud lower lips
        for (let i = 0; i < 5; i++) {
          const sy = fy + (i + 0.5) * (fw / 5) - fw / 14
          bar(fx, sy, fw, fw / 11, 50)
          bar(fx, sy + fw / 11, fw, 5 * E, 236)
        }
      } else if (q === 1) {
        // sunken inspection hatch with a rivet ring
        bar(fx + fw * 0.12, fy + fw * 0.12, fw * 0.76, fw * 0.76, 108)
        bar(fx + fw * 0.12, fy + fw * 0.12, fw * 0.76, 4 * E, 56)
        bar(fx + fw * 0.12, fy + fw * 0.86, fw * 0.76, 4 * E, 228)
        for (let i = 0; i < 4; i++) {
          rivet(fx + fw * (0.2 + 0.2 * i), fy + fw * 0.88, 7 * E)
        }
      } else if (q === 2) {
        // weld ladder: stiffener ribs across the face
        for (let i = 0; i < 6; i++) {
          bar(fx, fy + i * (fw / 6) + fw / 24, fw, fw / 18, 224)
          bar(fx, fy + i * (fw / 6) + fw / 24 + fw / 18, fw, 3 * E, 74)
        }
      } else {
        // bolted strap crossing the plate, with a bore at its centre
        bar(fx + fw * 0.34, fy, fw * 0.32, fw, 220)
        bar(fx + fw * 0.34, fy, 4 * E, fw, 246)
        bar(fx + fw * 0.66 - 4 * E, fy, 4 * E, fw, 92)
        disc(fx + fw * 0.5, fy + fw * 0.5, fw * 0.14, 52)
        disc(fx + fw * 0.5, fy + fw * 0.5, fw * 0.09, 150)
        for (let i = 0; i < 2; i++) rivet(fx + fw * 0.5, fy + fw * (0.14 + 0.72 * i), 8 * E)
      }
    }
  }

  ctx.filter = `blur(${(0.5 * E).toFixed(2)}px)`
  ctx.drawImage(canvas, 0, 0)
  ctx.filter = 'none'

  const d = ctx.getImageData(0, 0, size, size).data
  const h = new Float32Array(size * size)
  for (let i = 0; i < h.length; i++) {
    const x = i % size
    const y = (i / size) | 0
    h[i] = Math.min(
      1,
      Math.max(
        0,
        d[i * 4] / 255 +
          (vnoise((x * 0.3) / E, (y * 0.3) / E) - 0.5) * 0.05 +
          (vnoise((x * 1.4) / E, (y * 1.4) / E) - 0.5) * 0.022,
      ),
    )
  }
  const hBlur = boxBlurWrap(h, size, Math.round(5 * E))

  const [nCanvas, nCtx] = makeCanvas(size)
  const [oCanvas, oCtx] = makeCanvas(size)
  const [cCanvas, cCtx] = makeCanvas(size)
  const nImg = nCtx.createImageData(size, size)
  const oImg = oCtx.createImageData(size, size)
  const cImg = cCtx.createImageData(size, size)
  const at = (x: number, y: number) =>
    h[(((y % size) + size) % size) * size + (((x % size) + size) % size)]
  const strength = 2.6 * E

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      const hv = h[y * size + x]
      const cav = hv - hBlur[y * size + x]

      let nx = (at(x - 1, y) - at(x + 1, y)) * strength
      let ny = (at(x, y - 1) - at(x, y + 1)) * strength
      const inv = 1 / Math.sqrt(nx * nx + ny * ny + 1)
      nImg.data[i] = (nx * inv * 0.5 + 0.5) * 255
      nImg.data[i + 1] = (ny * inv * 0.5 + 0.5) * 255
      nImg.data[i + 2] = inv * 255
      nImg.data[i + 3] = 255

      // ORM: R cavity AO, G roughness, B metalness
      const ao = Math.min(1, Math.max(0.3, 1 + cav * 3.4))
      let rough = 0.72 - hv * 0.3 + (vnoise((x * 0.6) / E, (y * 0.6) / E) - 0.5) * 0.14
      rough = Math.min(0.95, Math.max(0.22, rough + Math.max(0, -cav) * 0.7))
      // raised plate faces are the machined, part-metal armour; the shell
      // field between them is a matte composite. One constant metalness over a
      // whole body is the same authoring tell it is on architecture.
      const metal = Math.min(0.85, Math.max(0.12, (hv - 0.42) * 1.6))
      oImg.data[i] = ao * 255
      oImg.data[i + 1] = rough * 255
      oImg.data[i + 2] = metal * 255
      oImg.data[i + 3] = 255

      // albedo multiplier. The plate/shell VALUE split is the point: at 30 px
      // it is the only thing giving the silhouette internal structure, and it
      // is light-independent so it survives being backlit by the ult.
      const plateT = Math.min(1, Math.max(0, (hv - 0.46) / 0.22))
      const grime = Math.min(1, Math.max(0, -cav) * 2.6 + Math.max(0, (0.44 - hv) / 0.4) * 0.7)
      const lum = Math.min(1, Math.max(0.2, 0.66 + plateT * 0.4 - grime * 0.36))
      const warm = grime * 0.4
      cImg.data[i] = lum * 255
      cImg.data[i + 1] = lum * (1 - warm * 0.08) * 255
      cImg.data[i + 2] = lum * (1 - warm * 0.2) * 255
      cImg.data[i + 3] = 255
    }
  }
  nCtx.putImageData(nImg, 0, 0)
  oCtx.putImageData(oImg, 0, 0)
  cCtx.putImageData(cImg, 0, 0)

  const mk = (c: HTMLCanvasElement, srgb = false) => {
    const t = new THREE.CanvasTexture(c)
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace
    t.anisotropy = 8
    t.needsUpdate = true
    return t
  }
  enemyNormal = mk(nCanvas)
  enemyORM = mk(oCanvas)
  enemyAlbedo = mk(cCanvas, true)
}

/**
 * Shared enemy armour maps. One tile is ~0.5 m of body, so a `repeat` of
 * (bodyWidth/0.5, bodyHeight/0.5) on a Trooper box lands the plates at the
 * ~15 cm the sheet is authored for.
 *
 * `orm` is packed R=cavity AO, G=roughness, B=metalness and can be bound to
 * aoMap, roughnessMap and metalnessMap at once (three reads .r/.g/.b
 * respectively), exactly as the gold set does.
 */
export function getEnemyPlateTextures(): {
  map: THREE.CanvasTexture
  normalMap: THREE.CanvasTexture
  orm: THREE.CanvasTexture
} {
  if (!enemyNormal) buildEnemyMaps()
  return { map: enemyAlbedo!, normalMap: enemyNormal!, orm: enemyORM! }
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

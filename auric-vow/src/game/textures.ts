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
  getMacroVariationTexture()
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
  const nImg = nCtx.createImageData(size, size)
  const aImg = aCtx.createImageData(size, size)
  const rImg = rCtx.createImageData(size, size)
  const cImg = cCtx.createImageData(size, size)

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

  // Authored staining on top of the per-texel field: dirt runs DOWN from
  // ledges and bolt bores in straight-sided streaks. Drawn (not noised) so the
  // runs have direction, which is what reads as weathering rather than dither.
  cCtx.globalCompositeOperation = 'multiply'
  for (let i = 0; i < 52; i++) {
    const sx = hash2(i * 3.1 + 0.3, 1.7) * size
    const sy = hash2(i * 7.3 + 0.9, 5.9) * size * 0.72
    const w = (5 + hash2(i + 0.7, 2.2) * 26) * S
    const hgt = (40 + hash2(i * 1.9 + 1.3, 8.4) * 170) * S
    const a = 0.12 + hash2(i * 5.5 + 2.1, 3.3) * 0.2
    const g = cCtx.createLinearGradient(0, sy, 0, sy + hgt)
    g.addColorStop(0, `rgba(104,92,74,${a.toFixed(3)})`)
    g.addColorStop(0.35, `rgba(126,114,96,${(a * 0.6).toFixed(3)})`)
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

/** authored roughness band: polished land → groove floor */
const GOLD_ROUGH_LO = 0.055
const GOLD_ROUGH_HI = 0.52

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
      rough += wear * 0.15 + pit * 0.34 + Math.max(0, -cav) * 0.55
      rough = Math.min(0.92, Math.max(0.045, rough))
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

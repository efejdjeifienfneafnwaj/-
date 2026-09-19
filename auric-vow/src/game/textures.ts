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
 * 2×2 panels per tile (1 m each): deep seams, machined chamfers running up to
 * the face, a stepped fret channel and a raised cartouche lens per panel.
 */
function buildOrokinHeight(): Float32Array {
  const size = TRIM_SIZE
  const [canvas, ctx] = makeCanvas(size)
  ctx.fillStyle = '#4a4a4a' // recessed base
  ctx.fillRect(0, 0, size, size)

  const cell = size / 2
  for (let py = 0; py < 2; py++) {
    for (let px = 0; px < 2; px++) {
      const x0 = px * cell
      const y0 = py * cell
      const inset = 7 // seam half-width in px
      // machined chamfer: nested strokes ramping from seam floor up to the face
      const steps = 9
      for (let s = 0; s < steps; s++) {
        const t = s / (steps - 1)
        const k = inset + (1 - t) * 9
        const v = Math.round(74 + t * 108) // 0x4a → 0xb6
        ctx.fillStyle = `rgb(${v},${v},${v})`
        rr(ctx, x0 + k, y0 + k, cell - k * 2, cell - k * 2, 14 - t * 5)
        ctx.fill()
      }
      // stepped fret channel inside the face (Orokin double-rail)
      ctx.strokeStyle = 'rgb(112,112,112)'
      ctx.lineWidth = 5
      rr(ctx, x0 + 34, y0 + 34, cell - 68, cell - 68, 18)
      ctx.stroke()
      ctx.strokeStyle = 'rgb(186,186,186)'
      ctx.lineWidth = 1.6
      rr(ctx, x0 + 39, y0 + 39, cell - 78, cell - 78, 15)
      ctx.stroke()
      // shallow recessed centre field — a flat inset, NOT a stamped medallion:
      // the sheet tiles across 265 m of level, so any bold motif reads as
      // wallpaper. Ornament density is carried by real geometry instead.
      ctx.fillStyle = 'rgb(150,150,150)'
      rr(ctx, x0 + 70, y0 + 70, cell - 140, cell - 140, 10)
      ctx.fill()
      ctx.strokeStyle = 'rgb(120,120,120)'
      ctx.lineWidth = 2
      rr(ctx, x0 + 70, y0 + 70, cell - 140, cell - 140, 10)
      ctx.stroke()
      // bolt pips at the panel corners
      ctx.fillStyle = 'rgb(196,196,196)'
      for (const [bx, by] of [
        [x0 + 26, y0 + 26],
        [x0 + cell - 26, y0 + 26],
        [x0 + 26, y0 + cell - 26],
        [x0 + cell - 26, y0 + cell - 26],
      ]) {
        ctx.beginPath()
        ctx.arc(bx, by, 3.4, 0, Math.PI * 2)
        ctx.fill()
      }
      // short stepped ribs top and bottom of the face
      ctx.fillStyle = 'rgb(160,160,160)'
      for (let i = 0; i < 5; i++) {
        const rx = x0 + 58 + i * 28
        ctx.fillRect(rx, y0 + 19, 13, 6)
        ctx.fillRect(rx, y0 + cell - 25, 13, 6)
      }
    }
  }
  ctx.filter = 'blur(1.4px)'
  ctx.drawImage(canvas, 0, 0)
  ctx.filter = 'none'

  const d = ctx.getImageData(0, 0, size, size).data
  const h = new Float32Array(size * size)
  for (let i = 0; i < h.length; i++) {
    // fine machined grain on top of the authored relief
    const x = i % size
    const y = (i / size) | 0
    const grain = (vnoise(x * 0.22, y * 0.22) - 0.5) * 0.045 + (vnoise(x * 0.9, y * 0.9) - 0.5) * 0.02
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

  const strength = 2.1
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
      // recesses go properly dark (0.28) so gaps read as gaps under any light
      const ao = Math.min(1, Math.max(0.42, 1 + cav * 2.2))
      const av = ao * 255
      aImg.data[i] = aImg.data[i + 1] = aImg.data[i + 2] = av
      aImg.data[i + 3] = 255

      // --- roughness: raised machined faces polish, cavities stay matte ---
      const hv = h[y * size + x]
      let rough = 0.95 - hv * 0.4 + (vnoise(x * 0.5, y * 0.5) - 0.5) * 0.14
      rough = Math.min(1, Math.max(0.18, rough))
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
 */
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
      const v = Math.min(1, Math.max(0, 0.42 + streak * 0.5 + along - 0.22 + grain))
      const i = (y * size + x) * 4
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v * 255
      img.data[i + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  goldRough = new THREE.CanvasTexture(canvas)
  goldRough.wrapS = goldRough.wrapT = THREE.RepeatWrapping
  goldRough.colorSpace = THREE.NoColorSpace
  goldRough.anisotropy = 4
  return goldRough
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

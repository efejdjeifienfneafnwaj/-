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

/** pre-generate both textures; call once at boot */
export function initTextures() {
  getNoiseRoughnessTexture()
  getGlyphSpriteTexture()
}

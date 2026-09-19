/**
 * AURIC VOW — vfx/vfxTextures.ts  [vfx R1]
 * Procedural, baked-once canvas textures owned by the VFX layer.
 *
 * Per the ownership map, VFX sprite atlases live here rather than in
 * `textures.ts` (architecture surfacing). Everything is generated at first
 * use and cached forever — no per-frame allocation, no external assets.
 *
 * Contents:
 *   PARTICLE ATLAS (2×2, 512²) — the four shapes every burst is built from:
 *     (0) spark   hot needle core, used stretched along velocity
 *     (1) ember   small hard core + wide soft halo, slow drifters
 *     (2) smoke   irregular alpha puff, the only NON-additive shape — it is
 *                 what gives an explosion mass and lets it occlude
 *     (3) debris  chipped chunk with a soft edge (never a hard square)
 *   getSoftGlowTexture()   — radial white→aureate falloff, glow heads
 *   getStreakTexture()     — anamorphic horizontal streak for lens flare
 *   getShellGlyphTexture() — seamless Orokin fret band for scrolling shells
 */
import * as THREE from 'three'

// ---------------------------------------------------------------------------
// particle shape atlas
// ---------------------------------------------------------------------------

/** atlas tile ids — keep in sync with ATLAS_UV below and BurstOpts.shape */
export const PARTICLE_SHAPE = { spark: 0, ember: 1, smoke: 2, debris: 3 } as const
export type ParticleShapeName = keyof typeof PARTICLE_SHAPE

/** tile origin (u,v) for each id in a 2×2 atlas; tile size is 0.5 */
export const ATLAS_TILE = 0.5

let particleAtlas: THREE.CanvasTexture | null = null

function radial(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  stops: [number, string][],
) {
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r)
  for (const [o, c] of stops) g.addColorStop(o, c)
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fill()
}

/** deterministic PRNG so the atlas is byte-identical every run */
function makeRand(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0xffffffff
  }
}

export function getParticleAtlas(): THREE.CanvasTexture {
  if (particleAtlas) return particleAtlas
  const S = 512
  const T = S / 2 // tile size in px
  const c = document.createElement('canvas')
  c.width = S
  c.height = S
  const ctx = c.getContext('2d')!
  // NOTE: the canvas is left transparent on purpose — the alpha channel IS
  // the particle shape, and the smoke tile depends on it to have holes.
  const rand = makeRand(0x5eed1337)

  // -- tile 0 (top-left): SPARK — tight needle core, tiny bloom skirt -------
  ctx.save()
  ctx.translate(T * 0.5, T * 0.5)
  radial(ctx, 0, 0, T * 0.46, [
    [0, 'rgba(255,255,255,1)'],
    [0.09, 'rgba(255,255,255,0.95)'],
    [0.26, 'rgba(255,236,196,0.42)'],
    [0.62, 'rgba(255,184,53,0.10)'],
    [1, 'rgba(255,184,53,0)'],
  ])
  ctx.restore()

  // -- tile 1 (top-right): EMBER — hard core, wide soft halo ---------------
  ctx.save()
  ctx.translate(T * 1.5, T * 0.5)
  radial(ctx, 0, 0, T * 0.48, [
    [0, 'rgba(255,255,255,1)'],
    [0.16, 'rgba(255,243,214,0.85)'],
    [0.34, 'rgba(255,184,53,0.34)'],
    [0.7, 'rgba(255,140,30,0.08)'],
    [1, 'rgba(255,140,30,0)'],
  ])
  // faint flicker specks so embers are not perfect discs
  ctx.globalCompositeOperation = 'lighter'
  for (let i = 0; i < 5; i++) {
    const a = rand() * Math.PI * 2
    const r = T * (0.12 + rand() * 0.18)
    radial(ctx, Math.cos(a) * r, Math.sin(a) * r, T * 0.06, [
      [0, 'rgba(255,240,200,0.5)'],
      [1, 'rgba(255,240,200,0)'],
    ])
  }
  ctx.globalCompositeOperation = 'source-over'
  ctx.restore()

  // -- tile 2 (bottom-left): SMOKE — irregular alpha puff -------------------
  ctx.save()
  ctx.translate(T * 0.5, T * 1.5)
  // base cloud
  radial(ctx, 0, 0, T * 0.47, [
    [0, 'rgba(255,255,255,0.80)'],
    [0.45, 'rgba(255,255,255,0.40)'],
    [0.78, 'rgba(255,255,255,0.10)'],
    [1, 'rgba(255,255,255,0)'],
  ])
  // lumps: break the silhouette so it never reads as a disc
  for (let i = 0; i < 9; i++) {
    const a = rand() * Math.PI * 2
    const r = T * (0.08 + rand() * 0.24)
    radial(ctx, Math.cos(a) * r, Math.sin(a) * r, T * (0.12 + rand() * 0.16), [
      [0, 'rgba(255,255,255,0.22)'],
      [1, 'rgba(255,255,255,0)'],
    ])
  }
  // bite a few holes so light can pass through the plume
  ctx.globalCompositeOperation = 'destination-out'
  for (let i = 0; i < 7; i++) {
    const a = rand() * Math.PI * 2
    const r = T * (0.1 + rand() * 0.3)
    radial(ctx, Math.cos(a) * r, Math.sin(a) * r, T * (0.05 + rand() * 0.1), [
      [0, 'rgba(0,0,0,0.5)'],
      [1, 'rgba(0,0,0,0)'],
    ])
  }
  ctx.globalCompositeOperation = 'source-over'
  ctx.restore()

  // -- tile 3 (bottom-right): DEBRIS — chipped chunk, soft edge -------------
  ctx.save()
  ctx.translate(T * 1.5, T * 1.5)
  ctx.beginPath()
  const verts = 6
  for (let i = 0; i <= verts; i++) {
    const a = (i / verts) * Math.PI * 2
    const r = T * (0.17 + rand() * 0.14)
    const x = Math.cos(a) * r
    const y = Math.sin(a) * r * 0.72
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.closePath()
  const gg = ctx.createLinearGradient(-T * 0.3, -T * 0.3, T * 0.3, T * 0.3)
  gg.addColorStop(0, 'rgba(255,243,214,1)')
  gg.addColorStop(0.55, 'rgba(255,184,53,0.85)')
  gg.addColorStop(1, 'rgba(160,90,20,0.55)')
  ctx.fillStyle = gg
  ctx.shadowColor = 'rgba(255,184,53,0.9)'
  ctx.shadowBlur = T * 0.16
  ctx.fill()
  ctx.shadowBlur = 0
  // soft outer glow so the chip never reads as a hard sticker
  ctx.globalCompositeOperation = 'lighter'
  radial(ctx, 0, 0, T * 0.44, [
    [0, 'rgba(255,184,53,0.22)'],
    [1, 'rgba(255,184,53,0)'],
  ])
  ctx.globalCompositeOperation = 'source-over'
  ctx.restore()

  particleAtlas = new THREE.CanvasTexture(c)
  particleAtlas.colorSpace = THREE.SRGBColorSpace
  particleAtlas.wrapS = THREE.ClampToEdgeWrapping
  particleAtlas.wrapT = THREE.ClampToEdgeWrapping
  particleAtlas.generateMipmaps = true
  particleAtlas.minFilter = THREE.LinearMipmapLinearFilter
  particleAtlas.needsUpdate = true
  return particleAtlas
}

// ---------------------------------------------------------------------------
// soft radial glow — glow heads, flash halos, ground contact ellipses
// ---------------------------------------------------------------------------

let softGlow: THREE.CanvasTexture | null = null

export function getSoftGlowTexture(): THREE.CanvasTexture {
  if (softGlow) return softGlow
  const S = 256
  const c = document.createElement('canvas')
  c.width = S
  c.height = S
  const ctx = c.getContext('2d')!
  radial(ctx, S / 2, S / 2, S / 2, [
    [0, 'rgba(255,255,255,1)'],
    [0.12, 'rgba(255,250,235,0.92)'],
    [0.3, 'rgba(255,215,140,0.45)'],
    [0.62, 'rgba(255,184,53,0.14)'],
    [1, 'rgba(255,184,53,0)'],
  ])
  softGlow = new THREE.CanvasTexture(c)
  softGlow.colorSpace = THREE.SRGBColorSpace
  return softGlow
}

// ---------------------------------------------------------------------------
// anamorphic streak — lens flare bar
// ---------------------------------------------------------------------------

let streak: THREE.CanvasTexture | null = null

export function getStreakTexture(): THREE.CanvasTexture {
  if (streak) return streak
  const W = 512
  const H = 64
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, W, H)
  // horizontal falloff × vertical falloff, drawn as a stack of thin bars so
  // the streak has a hot filament and a soft body
  for (let y = 0; y < H; y++) {
    const vy = Math.abs(y / (H - 1) - 0.5) * 2
    const va = Math.pow(1 - vy, 6)
    if (va <= 0.002) continue
    const g = ctx.createLinearGradient(0, 0, W, 0)
    g.addColorStop(0, 'rgba(255,220,170,0)')
    g.addColorStop(0.25, `rgba(255,228,186,${(va * 0.35).toFixed(3)})`)
    g.addColorStop(0.5, `rgba(255,255,255,${va.toFixed(3)})`)
    g.addColorStop(0.75, `rgba(255,228,186,${(va * 0.35).toFixed(3)})`)
    g.addColorStop(1, 'rgba(255,220,170,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, y, W, 1)
  }
  streak = new THREE.CanvasTexture(c)
  streak.colorSpace = THREE.SRGBColorSpace
  return streak
}

// ---------------------------------------------------------------------------
// seamless Orokin fret band — scrolls around energy shells and ult rings
// ---------------------------------------------------------------------------

let shellGlyph: THREE.CanvasTexture | null = null

export function getShellGlyphTexture(): THREE.CanvasTexture {
  if (shellGlyph) return shellGlyph
  const W = 512
  const H = 128
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, W, H)
  ctx.strokeStyle = 'rgba(255,255,255,0.92)'
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  const CELLS = 8
  const cw = W / CELLS
  const rand = makeRand(0x0140c1a7)
  for (let i = 0; i < CELLS; i++) {
    const x0 = i * cw
    ctx.save()
    ctx.translate(x0, 0)
    // stepped fret: a bracket, a bar and an eye — the Orokin vocabulary
    ctx.lineWidth = 5
    ctx.beginPath()
    ctx.moveTo(cw * 0.12, H * 0.72)
    ctx.lineTo(cw * 0.12, H * 0.34)
    ctx.lineTo(cw * 0.36, H * 0.34)
    ctx.lineTo(cw * 0.36, H * 0.2)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(cw * 0.52, H * 0.2)
    ctx.lineTo(cw * 0.52, H * 0.66)
    ctx.lineTo(cw * 0.86, H * 0.66)
    ctx.stroke()
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.ellipse(cw * 0.7, H * 0.36, cw * 0.1, H * 0.12, 0, 0, Math.PI * 2)
    ctx.stroke()
    if (rand() > 0.5) {
      ctx.beginPath()
      ctx.moveTo(cw * 0.2, H * 0.86)
      ctx.lineTo(cw * 0.8, H * 0.86)
      ctx.stroke()
    }
    ctx.restore()
  }
  // top/bottom hairlines tie the band together and survive mipping
  ctx.globalAlpha = 0.5
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.moveTo(0, 6)
  ctx.lineTo(W, 6)
  ctx.moveTo(0, H - 6)
  ctx.lineTo(W, H - 6)
  ctx.stroke()
  ctx.globalAlpha = 1

  shellGlyph = new THREE.CanvasTexture(c)
  shellGlyph.colorSpace = THREE.SRGBColorSpace
  shellGlyph.wrapS = THREE.RepeatWrapping
  shellGlyph.wrapT = THREE.ClampToEdgeWrapping
  return shellGlyph
}

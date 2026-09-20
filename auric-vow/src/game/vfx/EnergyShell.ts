/**
 * AURIC VOW — vfx/EnergyShell.ts  [vfx R1]
 *
 * The one way energy is drawn in this game. Every ability shell — the Requiem
 * nova rings, the Aegis barrier, the Sunspike javelins — is built from the
 * same three nested layers plus a real light, so they all read as one
 * material instead of "an additive primitive in gold":
 *
 *   core   hot white (#FFF3D6 × 4.0), thin, never scaled up. This is the only
 *          thing in frame authored above 1.0 on purpose, and after the bloom
 *          knee moved to 1.0 it is the thing that blooms.
 *   mid    saturated aureate (#FFB835 × 1.7) at 1.25×, optionally etched with
 *          a scrolling Orokin fret band so the surface has structure.
 *   outer  wide soft falloff at 3×, opacity ~0.22, driven by a Fresnel term
 *          so it fades at the silhouette instead of ending on a hard edge.
 *
 * Plus a leased PointLight (VFXBus.acquireLight, max 6 live) so the effect
 * actually relights the architecture and the player's plates.
 *
 * [vfx R3] THE SHAPE FIX. Through round 2 every layer here was drawn at
 * CONSTANT alpha over its whole surface, so a spear, a beam or a nova core
 * rasterised as a filled shape with a hard polygonal outline — which is
 * exactly the "flat single-layer additive shape" the blind test names first.
 * Layers now choose a falloff FAMILY:
 *
 *   volume  alpha = pow(|N·V|, p)      — a mass. Brightest where the eye looks
 *                                        through the most of it, ZERO at the
 *                                        silhouette, so it has no edge at all.
 *   rim     alpha = pow(1-|N·V|, p)    — a surface. For barriers only.
 *
 * plus an along-axis taper measured from the geometry's own extent (beams
 * fade out at the tail instead of ending on a cut), two octaves of scrolling
 * value-noise erosion, a hot-core term that clips the thickest part toward a
 * colour authored ABOVE the layer's own peak, and a near-plane dissolve.
 *
 * It also owns the screen-space refraction shell (see the bottom of the file).
 *
 * Allocation: everything is built once at construction. `setIntensity`,
 * `setScroll`, `setColors`, `setTime` and `setUniform` only write uniforms, so
 * these are safe to drive from useFrame.
 */
import * as THREE from 'three'
import { VFXENERGY } from '../config'
import { getShellGlyphTexture } from './vfxTextures'
import { acquireLight, type TrackedLightHandle } from './VFXBus'

const SHELL_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vN;
varying vec3 vV;
varying float vDist;
varying float vAxis;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  // normals must survive non-uniform layer scales (a javelin outer shell is
  // 3x in radius and 1.15x in length) or the thickness term skews along the
  // fat axis and the beam goes flat again.
  mat3 nm = mat3(modelMatrix);
  vec3 invScale = vec3(
    1.0 / max(1e-5, length(nm[0])),
    1.0 / max(1e-5, length(nm[1])),
    1.0 / max(1e-5, length(nm[2]))
  );
  vN = normalize(nm * (normal * invScale * invScale));
  vV = cameraPosition - wp.xyz;
  vDist = length(vV);
  // object-space position along the shell's local +Z (beams are built tip-up
  // on Z), remapped 0..1 by the geometry's own extent — independent of UVs so
  // it works on lathes, cylinders and cones alike.
  vAxis = position.z;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`

const SHELL_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uHot;
uniform float uOpacity;
uniform float uIntensity;
uniform float uFresnelAmt;
uniform float uFresnelPow;
uniform float uVolume;
uniform float uVolumePow;
uniform float uBand;
uniform float uBandAt;
uniform float uBandWidth;
uniform float uHotAmt;
uniform float uHotPow;
uniform float uGlyphAmt;
uniform float uGlyphRepeat;
uniform float uScroll;
uniform float uErode;
uniform float uErodeScale;
uniform float uTime;
uniform float uTaperMode;
uniform float uTailFade;
uniform float uHeadFade;
uniform float uAxisMin;
uniform float uAxisSpan;
uniform float uNearFade;
uniform sampler2D uGlyphTex;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vV;
varying float vDist;
varying float vAxis;

float h21(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = h21(i);
  float b = h21(i + vec2(1.0, 0.0));
  float c = h21(i + vec2(0.0, 1.0));
  float d = h21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(vV);
  // |N.V| is 1 where the eye looks straight through the thickest part of a
  // convex volume and 0 at the silhouette. That single term is the difference
  // between an additive PRIMITIVE (constant alpha, hard cut edge) and a
  // VOLUME that fades to nothing at its own outline.
  float ndv = clamp(abs(dot(N, V)), 0.0, 1.0);
  float rim = pow(clamp(1.0 - ndv, 0.0, 1.0), uFresnelPow);
  float vol = pow(ndv, uVolumePow);
  float shape = mix(1.0, rim, uFresnelAmt);
  shape = mix(shape, vol, uVolume);
  // [vfx R5] SHELL band — a third falloff family, between the two above.
  //
  // 'volume' is brightest through the middle of the shape and 'rim' only at
  // its outline, and NEITHER of them is what a detonation looks like. A
  // released blast is HOLLOW: a bright wall of light with a dark middle, and
  // on a sphere that is a gaussian in |N.V| centred between the two extremes
  // rather than at either of them. A fresnel rim cannot stand in for it — on
  // a 1.2 m sphere 3.6 m from the lens, pow(1-|N.V|, 3) puts its half-value
  // inside the outer 2% of the disc radius, which rasterises as a six-pixel
  // hairline. This band, at its default width, covers the outer 40% of the
  // radius: a wall with a thickness, which is what the eye reads as a shell.
  if (uBand > 0.001) {
    float bx = (ndv - uBandAt) / max(1e-3, uBandWidth);
    shape = mix(shape, exp(-bx * bx), uBand);
  }

  // along-axis authoring: beams taper to nothing at the tail and (optionally)
  // at the head, so no energy element ever ends on a flat cut.
  float ax = clamp((vAxis - uAxisMin) / max(1e-4, uAxisSpan), 0.0, 1.0);
  if (uTaperMode > 1.5) ax = vUv.y;
  if (uTaperMode > 0.5) {
    if (uTailFade > 0.001) shape *= smoothstep(0.0, uTailFade, ax);
    if (uHeadFade > 0.001) shape *= 1.0 - smoothstep(1.0 - uHeadFade, 1.0, ax);
  }

  if (uErode > 0.001) {
    float n = vnoise(vec2(vUv.x * uErodeScale * 2.0, ax * uErodeScale - uTime * 1.9));
    float n2 = vnoise(vec2(vUv.x * uErodeScale * 5.0 + 13.0, ax * uErodeScale * 2.4 - uTime * 3.3));
    float e = 0.62 * n + 0.38 * n2;
    shape *= mix(1.0, 0.30 + 1.15 * e, uErode);
  }

  float a = shape * uOpacity;
  vec3 col = uColor;
  if (uGlyphAmt > 0.001) {
    float g = texture2D(uGlyphTex, vec2(vUv.x * uGlyphRepeat + uScroll, vUv.y)).r;
    a *= mix(1.0, 0.30 + g * 1.05, uGlyphAmt);
    col += uColor * g * uGlyphAmt * 0.75;
  }
  // the thickest part of the volume clips toward white: a hot core inside a
  // saturated body, which is what makes energy read as emitting rather than
  // as a coloured decal.
  if (uHotAmt > 0.001) col = mix(col, uHot, clamp(pow(ndv, uHotPow) * uHotAmt, 0.0, 1.0));
  // near-plane dissolve: a shell the camera is inside must not wash the frame
  if (uNearFade > 0.001) a *= smoothstep(0.0, uNearFade, vDist);
  a *= uIntensity;
  if (a < 0.003) discard;
  gl_FragColor = vec4(col * uIntensity, a);
}
`

export interface EnergyShellLayerOpts {
  color?: string
  boost?: number
  scale?: number
  opacity?: number
}

/**
 * [vfx R3] How a layer's alpha is derived from the surface.
 *
 *  'volume' — alpha = pow(|N.V|, p). Bright where the eye looks through the
 *             THICKEST part of the shape, zero at the silhouette. This is what
 *             a beam, a spear, a nova core or any solid energy mass wants: it
 *             has no edge at all, because the edge is where it goes to zero.
 *  'rim'    — alpha = pow(1-|N.V|, p). Bright at the silhouette, transparent
 *             face-on. This is what a BARRIER wants — a surface, not a mass.
 *  'flat'   — constant alpha. Kept only for callers that drive their own mask.
 *
 * The round 2 build authored every core layer as 'flat', which is exactly why
 * the panel's first-named tell was "flat single-layer additive shapes": a
 * ConeGeometry filled at constant alpha is a hard-edged yellow plank no matter
 * how many copies of it are stacked.
 */
export type ShellProfile = 'volume' | 'rim' | 'flat'

export interface ShellShapeOpts {
  /** falloff family for this layer */
  profile?: ShellProfile
  /** falloff exponent — low = broad soft body, high = tight filament */
  power?: number
  /** how hard the thickest part clips toward `hotColor` (0 = never) */
  hot?: number
  /** exponent on the hot-core term */
  hotPow?: number
  /** colour the core clips to; defaults to solar white */
  hotColor?: string
  /** 0..1 scrolling value-noise erosion — energy that is alive, not a decal */
  erode?: number
  /** erosion cell density along the shell */
  erodeScale?: number
  /** taper source: 'axis' = local +Z extent (beams), 'uv' = uv.y, 'none' */
  taper?: 'axis' | 'uv' | 'none'
  /** fraction of the length the tail fades in over */
  tail?: number
  /** fraction of the length the head fades out over */
  head?: number
  /** metres over which the shell dissolves as the camera gets close */
  nearFade?: number
}

export interface EnergyShellOpts {
  /** base geometry, shared by all three layers (scaled per layer) */
  geometry: THREE.BufferGeometry
  core?: EnergyShellLayerOpts & ShellShapeOpts
  mid?: EnergyShellLayerOpts & ShellShapeOpts
  outer?: EnergyShellLayerOpts & ShellShapeOpts & { power?: number }
  /** etch the mid layer with the scrolling Orokin fret band */
  glyph?: boolean
  /** how many fret cells wrap around the mid layer's U axis */
  glyphRepeat?: number
  /** renderOrder band for VFX is 18–22 */
  renderOrder?: number
  /** THREE.FrontSide by default; shells that are seen from inside want Double */
  side?: THREE.Side
  /** shape defaults applied to every layer before its own overrides */
  shape?: ShellShapeOpts
}

function hdr(hex: string, boost: number): THREE.Color {
  return new THREE.Color(hex).multiplyScalar(boost)
}

const HOT_DEFAULT = '#FFFFFF'

/** layer defaults: a hot tight core, a broad saturated body, a very wide veil */
const PROFILE_DEFAULTS: Record<'core' | 'mid' | 'outer', Required<Pick<ShellShapeOpts,
  'profile' | 'power' | 'hot' | 'hotPow' | 'erode' | 'erodeScale'>>> = {
  core: { profile: 'volume', power: 0.85, hot: 1, hotPow: 2.2, erode: 0, erodeScale: 6 },
  mid: { profile: 'volume', power: 0.5, hot: 0.45, hotPow: 3.5, erode: 0.22, erodeScale: 7 },
  outer: { profile: 'volume', power: 0.3, hot: 0, hotPow: 3, erode: 0, erodeScale: 5 },
}

function layerMaterial(
  color: THREE.Color,
  opacity: number,
  shape: ShellShapeOpts,
  fallback: (typeof PROFILE_DEFAULTS)['core'],
  glyphAmt: number,
  glyphRepeat: number,
  side: THREE.Side,
  axisMin: number,
  axisSpan: number,
): THREE.ShaderMaterial {
  const profile = shape.profile ?? fallback.profile
  const power = shape.power ?? fallback.power
  const taper = shape.taper ?? 'none'
  return new THREE.ShaderMaterial({
    vertexShader: SHELL_VERT,
    fragmentShader: SHELL_FRAG,
    uniforms: {
      uColor: { value: color },
      // The hot core has to be authored ABOVE the layer it sits inside, or
      // "clips to white" is a lie: mixing an HDR gold at 4.0 toward a 1.0
      // white makes the middle of the beam DARKER than its body, which is
      // exactly backwards. Scale the hot target off the layer's own peak.
      uHot: {
        value: new THREE.Color(shape.hotColor ?? HOT_DEFAULT).multiplyScalar(
          Math.max(1, Math.max(color.r, color.g, color.b)) * 1.35,
        ),
      },
      uOpacity: { value: opacity },
      uIntensity: { value: 1 },
      uFresnelAmt: { value: profile === 'rim' ? 1 : 0 },
      uFresnelPow: { value: profile === 'rim' ? power : 1 },
      uVolume: { value: profile === 'volume' ? 1 : 0 },
      uVolumePow: { value: profile === 'volume' ? power : 1 },
      // hollow-shell crossfade, driven at runtime (see the SHELL band note)
      uBand: { value: 0 },
      uBandAt: { value: 0.55 },
      uBandWidth: { value: 0.32 },
      uHotAmt: { value: shape.hot ?? fallback.hot },
      uHotPow: { value: shape.hotPow ?? fallback.hotPow },
      uGlyphAmt: { value: glyphAmt },
      uGlyphRepeat: { value: glyphRepeat },
      uScroll: { value: 0 },
      uErode: { value: shape.erode ?? fallback.erode },
      uErodeScale: { value: shape.erodeScale ?? fallback.erodeScale },
      uTime: { value: 0 },
      uTaperMode: { value: taper === 'none' ? 0 : taper === 'axis' ? 1 : 2 },
      uTailFade: { value: shape.tail ?? 0 },
      uHeadFade: { value: shape.head ?? 0 },
      uAxisMin: { value: axisMin },
      uAxisSpan: { value: axisSpan },
      uNearFade: { value: shape.nearFade ?? 0 },
      uGlyphTex: { value: glyphAmt > 0 ? getShellGlyphTexture() : null },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side,
    toneMapped: false,
  })
}

/**
 * Three nested additive layers + an optional leased PointLight.
 * Add `shell.group` to the scene graph; drive it with setIntensity/setScroll.
 */
export class EnergyShell {
  readonly group = new THREE.Group()
  readonly core: THREE.Mesh
  readonly mid: THREE.Mesh
  readonly outer: THREE.Mesh
  readonly coreMat: THREE.ShaderMaterial
  readonly midMat: THREE.ShaderMaterial
  readonly outerMat: THREE.ShaderMaterial
  private light: TrackedLightHandle | null = null

  constructor(o: EnergyShellOpts) {
    const side = o.side ?? THREE.FrontSide
    const C = { ...VFXENERGY.core, ...o.core }
    const M = { ...VFXENERGY.mid, ...o.mid }
    const O = { ...VFXENERGY.outer, ...o.outer }
    const ro = o.renderOrder ?? 21
    const base: ShellShapeOpts = o.shape ?? {}

    // measure the geometry's own extent along local +Z once, so the along-axis
    // taper works on any beam geometry without the caller hand-feeding limits
    o.geometry.computeBoundingBox()
    const bb = o.geometry.boundingBox
    const axisMin = bb ? bb.min.z : -0.5
    const axisSpan = bb ? Math.max(1e-4, bb.max.z - bb.min.z) : 1

    const merge = (layer?: ShellShapeOpts): ShellShapeOpts => ({ ...base, ...layer })

    this.coreMat = layerMaterial(
      hdr(C.color, C.boost),
      1,
      merge(o.core),
      PROFILE_DEFAULTS.core,
      0,
      1,
      side,
      axisMin,
      axisSpan,
    )
    this.midMat = layerMaterial(
      hdr(M.color, M.boost),
      0.85,
      merge(o.mid),
      PROFILE_DEFAULTS.mid,
      o.glyph ? 1 : 0,
      o.glyphRepeat ?? 4,
      side,
      axisMin,
      axisSpan,
    )
    this.outerMat = layerMaterial(
      hdr(O.color, O.boost ?? 1),
      O.opacity ?? 0.22,
      merge(o.outer),
      PROFILE_DEFAULTS.outer,
      0,
      1,
      side,
      axisMin,
      axisSpan,
    )

    this.core = new THREE.Mesh(o.geometry, this.coreMat)
    this.mid = new THREE.Mesh(o.geometry, this.midMat)
    this.outer = new THREE.Mesh(o.geometry, this.outerMat)
    this.core.scale.setScalar(C.scale)
    this.mid.scale.setScalar(M.scale)
    this.outer.scale.setScalar(O.scale)
    // outer → mid → core: the hot core always composites last and wins
    this.outer.renderOrder = ro - 1
    this.mid.renderOrder = ro
    this.core.renderOrder = ro + 1
    for (const m of [this.outer, this.mid, this.core]) {
      m.frustumCulled = false
      this.group.add(m)
    }
    this.group.visible = false
  }

  /** every layer material, outer → core (for bulk uniform writes) */
  get materials(): readonly THREE.ShaderMaterial[] {
    return [this.outerMat, this.midMat, this.coreMat]
  }

  /**
   * Advance the erosion noise. Call once per frame with accumulated REAL time
   * for any shell authored with `erode > 0` — a static noise field on a live
   * beam reads as a texture, not as energy.
   */
  setTime(t: number): void {
    for (const m of this.materials) m.uniforms.uTime!.value = t
  }

  /** write one uniform across all three layers (no-op where it is absent) */
  setUniform(name: string, value: number): void {
    for (const m of this.materials) {
      const u = m.uniforms[name]
      if (u) u.value = value
    }
  }

  /** per-layer opacity — lets a caller re-balance core/body/veil at runtime */
  setOpacity(core: number, mid: number, outer: number): void {
    this.coreMat.uniforms.uOpacity!.value = core
    this.midMat.uniforms.uOpacity!.value = mid
    this.outerMat.uniforms.uOpacity!.value = outer
  }

  /** master brightness, 0 = off. Drives all three layers and the light. */
  setIntensity(k: number): void {
    this.coreMat.uniforms.uIntensity!.value = k
    this.midMat.uniforms.uIntensity!.value = k
    this.outerMat.uniforms.uIntensity!.value = k
  }

  /** advance the scrolling fret band (mid layer only) */
  setScroll(t: number): void {
    this.midMat.uniforms.uScroll!.value = t
  }

  /** retint mid-life (e.g. nova cooling white → gold) */
  setColors(coreHex: string, midHex: string, coreBoost?: number, midBoost?: number): void {
    ;(this.coreMat.uniforms.uColor!.value as THREE.Color)
      .set(coreHex)
      .multiplyScalar(coreBoost ?? VFXENERGY.core.boost)
    ;(this.midMat.uniforms.uColor!.value as THREE.Color)
      .set(midHex)
      .multiplyScalar(midBoost ?? VFXENERGY.mid.boost)
  }

  /** per-layer scale override (for shells that grow, like the nova rings) */
  setScale(base: number): void {
    const C = VFXENERGY.core.scale
    const M = VFXENERGY.mid.scale
    const O = VFXENERGY.outer.scale
    this.core.scale.setScalar(base * C)
    this.mid.scale.setScalar(base * M)
    this.outer.scale.setScalar(base * O)
  }

  /** lease a real light for this shell's lifetime (null when the pool is full) */
  attachLight(color: string, distance: number): TrackedLightHandle | null {
    // a handle cached across a run restart is dead (resetVfx bumped the slot
    // generation). Testing liveness rather than nullness is what lets the
    // shell take a fresh slot instead of holding a dead one forever.
    if (this.light?.live()) return this.light
    this.light = acquireLight(color, distance)
    return this.light
  }

  /** drive the leased light; no-op when the pool was exhausted */
  driveLight(x: number, y: number, z: number, intensity: number): void {
    this.light?.set(x, y, z, intensity)
  }

  tintLight(color: string): void {
    this.light?.tint(color)
  }

  releaseLight(): void {
    this.light?.release()
    this.light = null
  }

  setVisible(v: boolean): void {
    this.group.visible = v
    if (!v) this.releaseLight()
  }

  dispose(): void {
    this.releaseLight()
    this.coreMat.dispose()
    this.midMat.dispose()
    this.outerMat.dispose()
  }
}

export function createEnergyShell(o: EnergyShellOpts): EnergyShell {
  return new EnergyShell(o)
}

// ---------------------------------------------------------------------------
// [vfx R3] SCREEN-SPACE REFRACTION — V4
//
// The register's V4 ("no refraction or scene-texture sample anywhere; the ult
// bends nothing") was still open after two rounds, and it is one of the few
// things a shipped game does on this axis that this build did not do AT ALL.
// A pressure wave that does not displace what is behind it is a decal.
//
// The whole mechanism is one call: `copyFramebufferToTexture` grabs whatever
// has been rasterised so far — which, at a transparent mesh's draw call, is
// the fully lit opaque scene — into a texture the shell then samples at an
// offset UV. No extra scene pass, no extra render target binding, no
// dependency on the post stack (which another stream owns and which may have
// its NormalPass switched off by the capture harness).
//
// It is defensive on purpose: the grab texture is allocated to match the
// bound buffer's own type and colour space (the composer runs half-float, and
// copyTexSubImage2D from a float buffer into an RGBA8 texture is a GL error),
// and a single GL error disables the whole thing for the session, leaving the
// shells running on their fresnel term alone.
// ---------------------------------------------------------------------------

class SceneGrabber {
  private tex: THREE.FramebufferTexture | null = null
  private w = 0
  private h = 0
  private type: THREE.TextureDataType = THREE.UnsignedByteType
  private failed = false

  get supported(): boolean {
    return !this.failed
  }

  /** the last grabbed frame, or null when unavailable */
  get texture(): THREE.Texture | null {
    return this.failed ? null : this.tex
  }

  /**
   * Grab the currently bound colour buffer.
   *
   * MEASURED FAILURE this guards against: the post stack runs SSAO, so the
   * composer renders the scene a SECOND time through a NormalPass with an
   * override material. A grab taken during that pass captures the normal
   * buffer, and a first version of this that cached one grab per
   * `info.render.frame` handed those normals to the shell — which is why the
   * volley frame came back pure white and the barrier frame came back as a
   * black sphere with a magenta lobe in it. The caller therefore skips the
   * call entirely when an override material is active, and nothing is cached
   * across passes.
   */
  capture(renderer: THREE.WebGLRenderer): THREE.Texture | null {
    if (this.failed) return null
    const rt = renderer.getRenderTarget()
    const w = rt ? rt.width : Math.floor(renderer.domElement.width)
    const h = rt ? rt.height : Math.floor(renderer.domElement.height)
    if (w < 8 || h < 8) return null
    const type = rt ? rt.texture.type : THREE.UnsignedByteType
    if (!this.tex || this.w !== w || this.h !== h || this.type !== type) {
      this.tex?.dispose()
      const t = new THREE.FramebufferTexture(w, h)
      t.type = type
      t.colorSpace = rt ? rt.texture.colorSpace : THREE.SRGBColorSpace
      t.minFilter = THREE.LinearFilter
      t.magFilter = THREE.LinearFilter
      t.generateMipmaps = false
      this.tex = t
      this.w = w
      this.h = h
      this.type = type
    }
    try {
      renderer.copyFramebufferToTexture(this.tex)
      const gl = renderer.getContext()
      const err = gl.getError()
      if (err !== gl.NO_ERROR) {
        this.failed = true
        this.tex.dispose()
        this.tex = null
        return null
      }
    } catch {
      this.failed = true
      this.tex?.dispose()
      this.tex = null
      return null
    }
    return this.tex
  }
}

export const sceneGrabber = new SceneGrabber()

const REFRACT_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vNV;
varying vec3 vV;
varying vec4 vClip;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix) * normal);
  vNV = normalize(normalMatrix * normal);
  vV = cameraPosition - wp.xyz;
  vClip = projectionMatrix * viewMatrix * wp;
  gl_Position = vClip;
}
`

const REFRACT_FRAG = /* glsl */ `
uniform sampler2D uScene;
uniform float uHasScene;
uniform float uStrength;
uniform float uOpacity;
uniform float uRimPow;
uniform float uCompress;
uniform vec3 uTint;
varying vec3 vN;
varying vec3 vNV;
varying vec3 vV;
varying vec4 vClip;
void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(vV);
  float ndv = clamp(abs(dot(N, V)), 0.0, 1.0);
  // the shell bends light where it is seen edge-on and vanishes face-on —
  // the same geometry a real pressure front has
  float rim = pow(clamp(1.0 - ndv, 0.0, 1.0), uRimPow);
  float a = rim * uOpacity;
  if (a < 0.004) discard;
  vec2 suv = vClip.xy / max(1e-4, vClip.w) * 0.5 + 0.5;
  vec2 dir = vNV.xy;
  float dl = length(dir);
  dir = dl > 1e-4 ? dir / dl : vec2(0.0, 1.0);
  vec2 off = dir * rim * uStrength;
  vec3 col;
  if (uHasScene > 0.5) {
    // per-channel offset: a real lens disperses, and the split is what makes
    // the displacement legible against flat architecture
    col.r = texture2D(uScene, clamp(suv + off * 1.14, 0.001, 0.999)).r;
    col.g = texture2D(uScene, clamp(suv + off, 0.001, 0.999)).g;
    col.b = texture2D(uScene, clamp(suv + off * 0.86, 0.001, 0.999)).b;
    // compression band: the leading face of a pressure wave darkens what is
    // behind it before the hot edge blows it out. HARD CAPPED: a pressure
    // shell must read as a lens, never as a hole cut in the frame, so it can
    // take at most a quarter of the light out of the band it covers.
    col *= 1.0 - clamp(uCompress, 0.0, 0.25) * rim;
  } else {
    // no grab available on this driver: fall back to a purely ADDITIVE
    // pressure rim. It must never composite black over the frame.
    gl_FragColor = vec4(uTint * rim * 3.0, 0.0);
    return;
  }
  col += uTint * rim * rim;
  gl_FragColor = vec4(col, a);
}
`

export interface RefractionShellOpts {
  geometry: THREE.BufferGeometry
  /** UV-space displacement at the silhouette (0.02 ≈ 2% of the screen) */
  strength?: number
  opacity?: number
  rimPow?: number
  /** 0..1 darkening of the compressed band */
  compress?: number
  tint?: string
  renderOrder?: number
  side?: THREE.Side
}

/**
 * A pressure shell that displaces the rendered scene behind it.
 *
 * Drops to a pure additive tint (no displacement, no crash) on any driver
 * where the framebuffer grab is not permitted.
 */
export class RefractionShell {
  readonly mesh: THREE.Mesh
  readonly material: THREE.ShaderMaterial

  constructor(o: RefractionShellOpts) {
    this.material = new THREE.ShaderMaterial({
      vertexShader: REFRACT_VERT,
      fragmentShader: REFRACT_FRAG,
      uniforms: {
        uScene: { value: null },
        uHasScene: { value: 0 },
        uStrength: { value: o.strength ?? 0.02 },
        uOpacity: { value: o.opacity ?? 1 },
        uRimPow: { value: o.rimPow ?? 2.2 },
        uCompress: { value: o.compress ?? 0.35 },
        uTint: { value: new THREE.Color(o.tint ?? '#FFD79A').multiplyScalar(0.25) },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      side: o.side ?? THREE.DoubleSide,
      toneMapped: false,
    })
    this.mesh = new THREE.Mesh(o.geometry, this.material)
    this.mesh.frustumCulled = false
    this.mesh.visible = false
    // under every additive layer: the energy composites ON TOP of the bend
    this.mesh.renderOrder = o.renderOrder ?? 17
    this.mesh.onBeforeRender = (renderer, scene, _cam, _geo, material) => {
      // Only ever grab during the pass that is actually drawing THIS material.
      // A depth/normal prepass, a shadow pass or any override-material pass
      // would otherwise hand the shell a buffer full of normals.
      if (material !== this.material || (scene as THREE.Scene).overrideMaterial) {
        this.material.uniforms.uHasScene!.value = 0
        return
      }
      const tex = sceneGrabber.capture(renderer as THREE.WebGLRenderer)
      this.material.uniforms.uScene!.value = tex
      this.material.uniforms.uHasScene!.value = tex ? 1 : 0
    }
  }

  setStrength(v: number): void {
    this.material.uniforms.uStrength!.value = v
  }

  setOpacity(v: number): void {
    this.material.uniforms.uOpacity!.value = v
  }

  setVisible(v: boolean): void {
    this.mesh.visible = v
  }

  dispose(): void {
    this.material.dispose()
  }
}

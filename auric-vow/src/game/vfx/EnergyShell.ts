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
 * Allocation: everything is built once at construction. `setIntensity`,
 * `setScroll` and `setColors` only write uniforms, so these are safe to drive
 * from useFrame.
 */
import * as THREE from 'three'
import { VFXENERGY } from '../config'
import { getShellGlyphTexture } from './vfxTextures'
import { acquireLight, type TrackedLightHandle } from './VFXBus'

const SHELL_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vN;
varying vec3 vV;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix) * normal);
  vV = cameraPosition - wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`

const SHELL_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uIntensity;
uniform float uFresnelAmt;
uniform float uFresnelPow;
uniform float uGlyphAmt;
uniform float uGlyphRepeat;
uniform float uScroll;
uniform sampler2D uGlyphTex;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vV;
void main() {
  float ndv = abs(dot(normalize(vN), normalize(vV)));
  // rim term: 1 at the silhouette, 0 face-on — the soft outer falloff
  float fres = pow(clamp(1.0 - ndv, 0.0, 1.0), uFresnelPow);
  float a = mix(1.0, fres, uFresnelAmt) * uOpacity;
  vec3 col = uColor;
  if (uGlyphAmt > 0.001) {
    float g = texture2D(uGlyphTex, vec2(vUv.x * uGlyphRepeat + uScroll, vUv.y)).r;
    a *= mix(1.0, 0.30 + g * 1.05, uGlyphAmt);
    col += uColor * g * uGlyphAmt * 0.75;
  }
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

export interface EnergyShellOpts {
  /** base geometry, shared by all three layers (scaled per layer) */
  geometry: THREE.BufferGeometry
  core?: EnergyShellLayerOpts
  mid?: EnergyShellLayerOpts
  outer?: EnergyShellLayerOpts & { power?: number }
  /** etch the mid layer with the scrolling Orokin fret band */
  glyph?: boolean
  /** how many fret cells wrap around the mid layer's U axis */
  glyphRepeat?: number
  /** renderOrder band for VFX is 18–22 */
  renderOrder?: number
  /** THREE.FrontSide by default; shells that are seen from inside want Double */
  side?: THREE.Side
}

function hdr(hex: string, boost: number): THREE.Color {
  return new THREE.Color(hex).multiplyScalar(boost)
}

function layerMaterial(
  color: THREE.Color,
  opacity: number,
  fresnelAmt: number,
  fresnelPow: number,
  glyphAmt: number,
  glyphRepeat: number,
  side: THREE.Side,
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: SHELL_VERT,
    fragmentShader: SHELL_FRAG,
    uniforms: {
      uColor: { value: color },
      uOpacity: { value: opacity },
      uIntensity: { value: 1 },
      uFresnelAmt: { value: fresnelAmt },
      uFresnelPow: { value: fresnelPow },
      uGlyphAmt: { value: glyphAmt },
      uGlyphRepeat: { value: glyphRepeat },
      uScroll: { value: 0 },
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

    this.coreMat = layerMaterial(hdr(C.color, C.boost), 1, 0, 1, 0, 1, side)
    this.midMat = layerMaterial(
      hdr(M.color, M.boost),
      0.85,
      0.35,
      1.6,
      o.glyph ? 1 : 0,
      o.glyphRepeat ?? 4,
      side,
    )
    this.outerMat = layerMaterial(
      hdr(O.color, O.boost ?? 1),
      O.opacity ?? 0.22,
      1,
      O.power ?? VFXENERGY.outer.power,
      0,
      1,
      side,
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

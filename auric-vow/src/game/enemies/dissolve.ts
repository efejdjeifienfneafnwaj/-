/**
 * AURIC VOW — enemies/dissolve.ts
 * Shared hostile SHELL material patch (enemies-mission.md §6 step 2, extended
 * in R1 for the art review).
 *
 * One `onBeforeCompile` per material does three jobs, because three.js only
 * allows a single hook:
 *   1. death dissolve — a smooth 3-D value-noise front with a directional
 *      sweep (bottom→top by default) instead of the old `floor(pos*14)`
 *      cube hash, so the front reads as an erosion, not as voxels;
 *   2. an ember-hot edge band that hugs the front and stays crimson;
 *   3. a fresnel rim term `pow(1 - dot(N,V), p)` in the hostile rim hue, so
 *      the silhouette separates from warm ivory architecture at any range.
 *
 * Plus `makeOutlineMaterial()` — an inverted-hull outline whose thickness is
 * authored in SCREEN PIXELS (constant width at any distance) and which fades
 * in past ~13 m so distant hostiles stay legible without ringing everything
 * in the foreground.
 */
import * as THREE from 'three'
import { ENEMY_LOOK } from '@/game/config'

export interface DissolveHandle {
  /** 0 → 1 dissolve progress */
  uniform: { value: number }
  /** world-ish direction the dissolve front travels along (object space) */
  dir: { value: THREE.Vector3 }
  reset(): void
}

export interface ShellOptions {
  /** hot colour of the dissolve front */
  edgeColor?: string
  /** fresnel rim colour (null disables the rim) */
  rim?: string | null
  rimPower?: number
  rimStrength?: number
}

const NOISE_GLSL = /* glsl */ `
  float auricHash(vec3 p) {
    return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453123);
  }
  float auricNoise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float n000 = auricHash(i);
    float n100 = auricHash(i + vec3(1.0, 0.0, 0.0));
    float n010 = auricHash(i + vec3(0.0, 1.0, 0.0));
    float n110 = auricHash(i + vec3(1.0, 1.0, 0.0));
    float n001 = auricHash(i + vec3(0.0, 0.0, 1.0));
    float n101 = auricHash(i + vec3(1.0, 0.0, 1.0));
    float n011 = auricHash(i + vec3(0.0, 1.0, 1.0));
    float n111 = auricHash(i + vec3(1.0, 1.0, 1.0));
    return mix(
      mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
      mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y),
      f.z);
  }
  float auricFbm(vec3 p) {
    return auricNoise(p) * 0.62 + auricNoise(p * 2.7) * 0.26 + auricNoise(p * 6.1) * 0.12;
  }
`

/**
 * Patch a standard material with the hostile shell shader.
 * Back-compatible with the old `patchDissolve(mat, '#hex')` call shape.
 */
export function patchDissolve(
  material: THREE.MeshStandardMaterial,
  opts: ShellOptions | string = {},
): DissolveHandle {
  const o: ShellOptions = typeof opts === 'string' ? { edgeColor: opts } : opts
  const uniform = { value: 0 }
  const dir = { value: new THREE.Vector3(0, 1, 0) }
  const edge = new THREE.Color(o.edgeColor ?? ENEMY_LOOK.dissolveEdge)
  const rimOn = o.rim !== null
  const rim = new THREE.Color(o.rim ?? ENEMY_LOOK.rim)
  const rimPower = o.rimPower ?? ENEMY_LOOK.rimPower
  const rimStrength = rimOn ? (o.rimStrength ?? ENEMY_LOOK.rimStrength) : 0

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uDissolve = uniform
    shader.uniforms.uDissolveDir = dir
    shader.uniforms.uDissolveColor = { value: edge }
    shader.uniforms.uRimColor = { value: rim }
    shader.uniforms.uRimPower = { value: rimPower }
    shader.uniforms.uRimStrength = { value: rimStrength }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vDissolvePos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvDissolvePos = position;')
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         varying vec3 vDissolvePos;
         uniform float uDissolve;
         uniform vec3 uDissolveDir;
         uniform vec3 uDissolveColor;
         uniform vec3 uRimColor;
         uniform float uRimPower;
         uniform float uRimStrength;
         ${NOISE_GLSL}`,
      )
      .replace(
        '#include <dithering_fragment>',
        /* glsl */ `
        // --- fresnel rim: hostile hue, strongest at grazing angles ---------
        if (uRimStrength > 0.0) {
          vec3 rimV = normalize(vViewPosition);
          float rimF = pow(1.0 - clamp(dot(normalize(normal), rimV), 0.0, 1.0), uRimPower);
          gl_FragColor.rgb += uRimColor * rimF * uRimStrength;
        }
        // --- death dissolve: smooth erosion front with a directional sweep --
        if (uDissolve > 0.0005) {
          float dSweep = clamp(dot(vDissolvePos, uDissolveDir) * 0.55 + 0.5, 0.0, 1.0);
          float dMask = auricFbm(vDissolvePos * 9.0) * 0.55 + dSweep * 0.45;
          float dFront = uDissolve * 1.25 - 0.12;
          if (dMask < dFront) discard;
          float dEdge = 1.0 - smoothstep(0.0, 0.085, dMask - dFront);
          vec3 hot = mix(uDissolveColor, vec3(1.0), dEdge * dEdge);
          gl_FragColor.rgb += hot * dEdge * 2.6;
        }
        #include <dithering_fragment>
        `,
      )
  }
  // Three.js builds its program cache key from material FEATURE FLAGS, not
  // from anything onBeforeCompile injects, and appends customProgramCacheKey
  // verbatim. Without a key here, a hostile shell material and any plain
  // map-less MeshStandardMaterial elsewhere in the scene (weapon plate, player
  // undersuit, brass) hash identically and share whichever program compiled
  // first — so either the hostiles silently lose the rim and the dissolve, or
  // an unrelated prop starts discarding fragments. world/materials.ts already
  // keys its own injected chunk for the same reason.
  material.customProgramCacheKey = () => 'auric-hostile-shell'
  // force recompile if the material was already used once
  material.needsUpdate = true
  return {
    uniform,
    dir,
    reset() {
      uniform.value = 0
    },
  }
}

// ---------------------------------------------------------------------------
// Inverted-hull outline
// ---------------------------------------------------------------------------

/**
 * Shared "world units per pixel per metre of depth" uniform. The manager
 * refreshes it once a frame from the live camera fov + drawing-buffer height,
 * and every outline material holds a REFERENCE to this same object, so one
 * write re-sizes every hostile outline.
 */
export const outlineScale = { value: 2 * Math.tan(THREE.MathUtils.degToRad(35)) / 1080 }

/** call once per frame with the live camera + canvas height (px) */
export function updateOutlineScale(fovDeg: number, heightPx: number): void {
  if (heightPx > 0) outlineScale.value = (2 * Math.tan(THREE.MathUtils.degToRad(fovDeg * 0.5))) / heightPx
}

const OUTLINE_VERT = /* glsl */ `
  uniform float uScale;
  uniform float uPixels;
  uniform float uFadeNear;
  uniform float uFadeFar;
  varying float vFade;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vec3 n = normalize(normalMatrix * normal);
    float depth = max(0.05, -mv.z);
    mv.xyz += n * (uScale * uPixels * depth);
    vFade = smoothstep(uFadeNear, uFadeFar, depth);
    gl_Position = projectionMatrix * mv;
  }
`

const OUTLINE_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vFade;
  void main() {
    float a = vFade * uOpacity;
    if (a < 0.01) discard;
    gl_FragColor = vec4(uColor, a);
  }
`

export interface OutlineHandle {
  material: THREE.ShaderMaterial
  /** drop the outline out as the corpse dissolves */
  setOpacity(v: number): void
  dispose(): void
}

/** an inverted-hull outline material of constant screen-space width */
export function makeOutlineMaterial(pixels: number = ENEMY_LOOK.outline.pixels): OutlineHandle {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uScale: outlineScale,
      uPixels: { value: pixels },
      uFadeNear: { value: ENEMY_LOOK.outline.fadeNear },
      uFadeFar: { value: ENEMY_LOOK.outline.fadeFar },
      uColor: { value: new THREE.Color(ENEMY_LOOK.outline.color) },
      uOpacity: { value: ENEMY_LOOK.outline.opacity },
    },
    vertexShader: OUTLINE_VERT,
    fragmentShader: OUTLINE_FRAG,
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
    fog: false,
    toneMapped: false,
  })
  return {
    material,
    setOpacity(v: number) {
      material.uniforms.uOpacity.value = Math.max(0, v)
    },
    dispose() {
      material.dispose()
    },
  }
}

// ---------------------------------------------------------------------------
// Shared hostile glow sprite  [enemies-hud R2]
//
// Every accent on a hostile is a small hard-edged emissive primitive — a 3 cm
// visor slit, a 5 cm core sphere. Under a 1.0 bloom knee those are two or
// three pixels of bloom at gameplay distance, which is why the hostiles read
// as unlit dark shapes in the capture set. Each accent now carries a
// camera-facing falloff sprite off ONE baked 64×64 radial texture, shared by
// every enemy in the scene, so the tell has a soft core that survives
// distance without a per-enemy texture or a per-frame allocation.
// ---------------------------------------------------------------------------

let glowTex: THREE.Texture | null = null

/** the one baked radial-falloff texture every hostile glow sprite samples */
export function getEnemyGlowTexture(): THREE.Texture {
  if (glowTex) return glowTex
  const S = 64
  const canvas = document.createElement('canvas')
  canvas.width = S
  canvas.height = S
  const ctx = canvas.getContext('2d')
  if (ctx) {
    const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2)
    // a tight core with a long tail — a linear falloff blooms as a disc
    g.addColorStop(0.0, 'rgba(255,255,255,1)')
    g.addColorStop(0.18, 'rgba(255,255,255,0.62)')
    g.addColorStop(0.42, 'rgba(255,255,255,0.20)')
    g.addColorStop(0.72, 'rgba(255,255,255,0.05)')
    g.addColorStop(1.0, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, S, S)
  }
  glowTex = new THREE.CanvasTexture(canvas)
  glowTex.colorSpace = THREE.NoColorSpace
  glowTex.needsUpdate = true
  return glowTex
}

/**
 * An additive camera-facing glow for a hostile accent. `color` is authored in
 * HDR by the caller each frame (ENEMY_FX levels), so this is deliberately
 * `toneMapped: false` and never depth-writes.
 */
export function makeEnemyGlowMaterial(color: string): THREE.SpriteMaterial {
  return new THREE.SpriteMaterial({
    map: getEnemyGlowTexture(),
    color: new THREE.Color(color),
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
    fog: false,
  })
}

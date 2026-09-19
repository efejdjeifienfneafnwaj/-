/**
 * AURIC VOW — enemies/dissolve.ts
 * Shared death-dissolve material patch (enemies-mission.md §6 step 2):
 * adds a `uDissolve` uniform to a MeshStandardMaterial — fragments below a
 * blocky noise threshold are discarded, and the dissolving edge glows
 * teal → white-hot. Drive uniform.value 0→1 over the dissolve duration.
 */
import * as THREE from 'three'
import { COLORS } from '@/game/config'

export interface DissolveHandle {
  uniform: { value: number }
  reset(): void
}

const NOISE_GLSL = /* glsl */ `
  float auricHash(vec3 p) {
    return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453123);
  }
`

export function patchDissolve(material: THREE.MeshStandardMaterial, edgeColor: string = COLORS.cadenceTeal): DissolveHandle {
  const uniform = { value: 0 }
  const edge = new THREE.Color(edgeColor)
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uDissolve = uniform
    shader.uniforms.uDissolveColor = { value: edge }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vDissolvePos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvDissolvePos = position;')
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>\nvarying vec3 vDissolvePos;\nuniform float uDissolve;\nuniform vec3 uDissolveColor;\n${NOISE_GLSL}`,
      )
      .replace(
        '#include <dithering_fragment>',
        `
        float dNoise = auricHash(floor(vDissolvePos * 14.0));
        if (uDissolve > 0.001 && dNoise < uDissolve) discard;
        // teal → white-hot edge band hugging the dissolve front
        float dEdge = 1.0 - smoothstep(0.0, 0.09, abs(dNoise - uDissolve));
        vec3 hot = mix(uDissolveColor, vec3(1.0), dEdge * dEdge);
        gl_FragColor.rgb += hot * dEdge * step(0.001, uDissolve) * 3.0;
        #include <dithering_fragment>
        `,
      )
  }
  // force recompile if the material was already used once
  material.needsUpdate = true
  return {
    uniform,
    reset() {
      uniform.value = 0
    },
  }
}

/**
 * AURIC VOW — world/Fog.tsx
 * FogExp2 veil (design.md §2.6, environment.md §6). Density/color smoothly
 * switch per zone by tracking the camera's z (the camera follows the player):
 *   A spawn 0.010 #1B2440 | B canyon 0.020 #1B2440→#16224A |
 *   C chamber 0.012 #1E2A4A | D arena 0.012 #1B2440 | E extraction 0.015 #16224A
 *
 * R1 (art review): every zone colour is scaled by VALUE_FLOOR and the fog
 * darkens further as the camera drops below deck level. Exposure came down to
 * 0.85 to give the level true darks — an unchanged fog colour would have put
 * that back, lifting every distant recess into the same blue haze.
 */
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { FOG } from '../config'
import { ZONE_Z } from './layout'

interface FogZone {
  density: number
  color: THREE.Color
}

/** global scale on every fog colour — protects the bottom of the histogram */
const VALUE_FLOOR = 0.72
/** extra darkening applied as the camera descends into the void */
const VOID_TINT = new THREE.Color('#080A14')

export default function Fog() {
  const fogRef = useRef<THREE.FogExp2>(null!)

  const zones = useMemo(
    () => ({
      spawn: { density: 0.01, color: new THREE.Color(FOG.color) } as FogZone,
      canyonA: { density: FOG.canyonDensity, color: new THREE.Color(FOG.color) } as FogZone,
      canyonB: { density: FOG.canyonDensity, color: new THREE.Color(FOG.skyHorizon) } as FogZone,
      chamber: { density: 0.012, color: new THREE.Color('#1E2A4A') } as FogZone,
      arena: { density: FOG.arenaDensity, color: new THREE.Color(FOG.color) } as FogZone,
      extraction: { density: 0.015, color: new THREE.Color(FOG.skyHorizon) } as FogZone,
    }),
    [],
  )

  const targetColor = useMemo(() => new THREE.Color(FOG.color), [])

  // pre-scale every zone colour once (no per-frame allocation)
  useMemo(() => {
    for (const z of Object.values(zones)) z.color.multiplyScalar(VALUE_FLOOR)
  }, [zones])

  useFrame((state, dt) => {
    const fog = fogRef.current
    if (!fog) return
    const z = state.camera.position.z

    let density: number
    if (z < ZONE_Z.canyon[0]) {
      density = zones.spawn.density
      targetColor.copy(zones.spawn.color)
    } else if (z < ZONE_Z.canyon[1]) {
      // canyon: tint warms toward the horizon color deeper in
      const t = (z - ZONE_Z.canyon[0]) / (ZONE_Z.canyon[1] - ZONE_Z.canyon[0])
      density = zones.canyonA.density
      targetColor.lerpColors(zones.canyonA.color, zones.canyonB.color, t)
    } else if (z < ZONE_Z.chamber[1]) {
      density = zones.chamber.density
      targetColor.copy(zones.chamber.color)
    } else if (z < ZONE_Z.arena[1]) {
      density = zones.arena.density
      targetColor.copy(zones.arena.color)
    } else {
      density = zones.extraction.density
      targetColor.copy(zones.extraction.color)
    }

    // below deck level the fog deepens toward the void value, so falls and
    // under-structure read as depth instead of a uniform blue wash
    const below = THREE.MathUtils.clamp(-state.camera.position.y / 12, 0, 1)
    if (below > 0) targetColor.lerp(VOID_TINT, below * 0.7)

    const k = 1 - Math.exp(-2.2 * dt) // smooth zone transitions
    fog.density = THREE.MathUtils.lerp(fog.density, density, k)
    fog.color.lerp(targetColor, k)
  })

  return <fogExp2 ref={fogRef} attach="fog" args={[FOG.color, FOG.arenaDensity]} />
}

/**
 * AURIC VOW — VFXSystems.tsx
 * Mounts every pooled VFX system inside the R3F Canvas and binds the active
 * camera for the screen-space HUD layer (DamageNumbers / objective marker).
 * All per-frame updates happen inside each system's own useFrame and respect
 * store.timeScale (hitstop / slow-mo).
 *
 * Usage: `<VFXSystems />` anywhere inside <Canvas>.
 */
import { useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import Particles from './Particles'
import Trails from './Trails'
import Shockwaves from './Shockwaves'
import Flashes from './Flashes'
import Ambient from './Ambient'
import { bindCamera, unbindCamera } from '../hud/DamageNumbers'

export default function VFXSystems() {
  const camera = useThree((s) => s.camera)

  useEffect(() => {
    bindCamera(camera)
    return () => unbindCamera(camera)
  }, [camera])

  return (
    <group name="vfx-systems">
      <Particles />
      <Trails />
      <Shockwaves />
      <Flashes />
      <Ambient />
    </group>
  )
}

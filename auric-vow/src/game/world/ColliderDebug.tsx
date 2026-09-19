/**
 * AURIC VOW — world/ColliderDebug.tsx
 * Debug toggle (` Backquote) that visualizes all registered colliders as
 * wireframe boxes, tinted by tag (environment.md §5 debug toggle).
 */
import { useEffect, useMemo, useState } from 'react'
import * as THREE from 'three'
import { getColliders } from './Colliders'

function colorFor(tags: string[]): string {
  if (tags.includes('wallrun')) return '#19E3D6'
  if (tags.includes('extract-pad')) return '#FFB835'
  if (tags.includes('objective')) return '#FF4B3E'
  if (tags.includes('floor') || tags.includes('platform')) return '#4DFF9A'
  return '#BFE8FF'
}

export default function ColliderDebug() {
  const [on, setOn] = useState(false)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.code === 'Backquote') setOn((v) => !v)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const boxes = useMemo(() => {
    if (!on) return []
    return getColliders().map((c) => {
      const size = c.box.getSize(new THREE.Vector3())
      const center = c.box.getCenter(new THREE.Vector3())
      return { id: c.id, size, center, color: colorFor(c.tags) }
    })
  }, [on])

  if (!on) return null

  return (
    <group>
      {boxes.map((b) => (
        <mesh key={b.id} position={b.center} scale={b.size}>
          <boxGeometry args={[1, 1, 1]} />
          <meshBasicMaterial wireframe color={b.color} toneMapped={false} depthTest={false} />
        </mesh>
      ))}
    </group>
  )
}

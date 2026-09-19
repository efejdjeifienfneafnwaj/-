/**
 * AURIC VOW — enemies/EnemyManager.tsx
 * Spawning + wave director (enemies-mission.md §5).
 *
 * - Phase-driven spawn tables read from config.MISSION + mission/zones.ts
 * - 0.5s stagger between individual spawns, teal puff + flash on spawn,
 *   max 12 alive (overflow waits in the queue)
 * - dead entities dissolve (driven by deathTimer here) then despawn
 * - pauses on WIN / LOSE
 *
 * `SpawnStatus` is polled by MissionDirector to detect wave-clear:
 * a wave is cleared when pending === 0 && EnemyRegistry.aliveCount() === 0
 * for the key the manager last queued.
 */
import { useEffect, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useGameStore } from '@/game/store'
import { MISSION, COLORS, type WaveSpec } from '@/game/config'
import { VFX } from '@/game/vfx/VFXBus'
import { ZONES } from '@/game/mission/zones'
import {
  EnemyRegistry,
  registerEnemy,
  unregisterEnemy,
  clearEnemies,
  type EnemyEntity,
  type EnemyType,
} from './EnemyRegistry'
import { Drone } from './Drone'
import { Trooper } from './Trooper'
import { Heavy } from './Heavy'
import { EnemyBoltPool } from './EnemyProjectiles'

const MAX_ALIVE = 12
const SPAWN_GAP = 0.5
const _spawnVfx = new THREE.Vector3()

/** polled by MissionDirector (module-level, mutable, no React state) */
export const SpawnStatus = {
  /** items still waiting in the spawn queue */
  pending: 0,
  /** `${phase}:${wave}` of the last queued spawn table */
  key: '',
}

interface QueueItem {
  at: number
  type: EnemyType
  pos: THREE.Vector3
  alerted: boolean
  waypoints?: THREE.Vector3[]
}

const ENTITY_SPEC: Record<EnemyType, { hp: number; radius: number; height: number; dissolveSec: number }> = {
  drone: { hp: 40, radius: 0.35, height: 0.5, dissolveSec: 0.6 },
  trooper: { hp: 90, radius: 0.35, height: 1.8, dissolveSec: 0.6 },
  heavy: { hp: 500, radius: 0.8, height: 2.6, dissolveSec: 1.0 },
}

function jitter(p: THREE.Vector3, r = 2): THREE.Vector3 {
  return p.clone().add(new THREE.Vector3((Math.random() - 0.5) * r, 0, (Math.random() - 0.5) * r))
}

/** build the spawn table for a wave; heavies arrive mid-wave for drama */
function waveQueue(spec: WaveSpec, key: string): QueueItem[] {
  const q: QueueItem[] = []
  let t = 0
  let door = 0
  const nextDoor = () => {
    const p = ZONES.arena.doors[door % ZONES.arena.doors.length]
    door++
    return jitter(p, 3)
  }
  for (let i = 0; i < spec.troopers; i++) {
    q.push({ at: t, type: 'trooper', pos: nextDoor(), alerted: true })
    t += SPAWN_GAP
  }
  for (let i = 0; i < spec.drones; i++) {
    q.push({ at: t, type: 'drone', pos: nextDoor().setY(4 + Math.random() * 2), alerted: true })
    t += SPAWN_GAP
  }
  // heavies step out mid-wave with a beat of silence before them
  for (let i = 0; i < spec.heavies; i++) {
    q.push({ at: t + 1.5, type: 'heavy', pos: nextDoor(), alerted: true })
    t += 1.5 + SPAWN_GAP
  }
  SpawnStatus.key = key
  return q
}

export function EnemyManager() {
  const [enemies, setEnemies] = useState<EnemyEntity[]>([])
  const phase = useGameStore((s) => s.phase)
  const wave = useGameStore((s) => s.wave)
  const queue = useRef<QueueItem[]>([])
  const queueClock = useRef(0)
  const sinceSpawn = useRef(SPAWN_GAP)

  // ---- phase-driven spawn tables ----
  useEffect(() => {
    queue.current = []
    queueClock.current = 0
    sinceSpawn.current = SPAWN_GAP
    SpawnStatus.pending = 0

    switch (phase) {
      case 'DROPSHIP': {
        // full reset (new run / retry)
        clearEnemies()
        setEnemies([])
        SpawnStatus.key = 'DROPSHIP'
        break
      }

      case 'INFILTRATE': {
        clearEnemies()
        setEnemies([])
        // 4 patrol drones on fixed canyon loops (B1–B3) — optional kills
        const q: QueueItem[] = ZONES.dronePatrols.map((loop, i) => ({
          at: i * SPAWN_GAP,
          type: 'drone' as const,
          pos: loop[0].clone(),
          alerted: false,
          waypoints: loop,
        }))
        queue.current = q
        SpawnStatus.key = 'INFILTRATE:0'
        break
      }

      case 'OBJECTIVE': {
        // 6 troopers + 2 drones trickling in pairs every ~2.5s
        const sp = ZONES.reliquary.defenderSpawns
        const q: QueueItem[] = []
        const d = MISSION.objective.defenders
        let t = 0
        let i = 0
        let troopersLeft = d.troopers
        let dronesLeft = d.drones
        while (troopersLeft > 0 || dronesLeft > 0) {
          for (let k = 0; k < 2; k++) {
            if (troopersLeft > 0) {
              q.push({ at: t + k * SPAWN_GAP, type: 'trooper', pos: jitter(sp[i % sp.length], 2.5), alerted: true })
              troopersLeft--
            } else if (dronesLeft > 0) {
              q.push({ at: t + k * SPAWN_GAP, type: 'drone', pos: jitter(sp[i % sp.length], 2.5).setY(5), alerted: true })
              dronesLeft--
            }
            i++
          }
          t += 2.5
        }
        queue.current = q
        SpawnStatus.key = 'OBJECTIVE:0'
        break
      }

      case 'EXTERMINATE': {
        const spec = MISSION.exterminateWaves[wave]
        if (spec) queue.current = waveQueue(spec, `EXTERMINATE:${wave}`)
        break
      }

      case 'EXTRACT': {
        // 4 harass drones in pairs along the bridge during the run
        const bs = ZONES.extraction.bridgeSpawns
        const q: QueueItem[] = []
        for (let i = 0; i < MISSION.extract.harassDrones; i++) {
          q.push({
            at: (i < 2 ? 0 : 8) + (i % 2) * SPAWN_GAP,
            type: 'drone',
            pos: bs[i % bs.length].clone(),
            alerted: true,
          })
        }
        queue.current = q
        SpawnStatus.key = 'EXTRACT:0'
        break
      }

      default:
        break
    }
    SpawnStatus.pending = queue.current.length
  }, [phase, wave])

  // ---- queue processing + death/despawn lifecycle ----
  useFrame((_, delta) => {
    const s = useGameStore.getState()
    if (s.phase === 'WIN' || s.phase === 'LOSE') return
    const dt = Math.min(delta, 0.05) * s.timeScale

    // spawn queue
    if (queue.current.length > 0) {
      queueClock.current += dt
      sinceSpawn.current += dt
      const head = queue.current[0]
      if (queueClock.current >= head.at && sinceSpawn.current >= SPAWN_GAP && EnemyRegistry.aliveCount() < MAX_ALIVE) {
        queue.current.shift()
        SpawnStatus.pending = queue.current.length
        sinceSpawn.current = 0
        const spec = ENTITY_SPEC[head.type]
        const e = registerEnemy({
          type: head.type,
          position: head.pos,
          hp: spec.hp,
          radius: spec.radius,
          height: spec.height,
          alerted: head.alerted,
          waypoints: head.waypoints,
          dissolveSec: spec.dissolveSec,
        })
        // spawn FX — enemy steps out of teal light
        _spawnVfx.copy(head.pos).setY(head.pos.y + spec.height * 0.5)
        VFX.burst({ position: _spawnVfx, color: COLORS.cadenceTeal, count: 8, speed: 3, life: 0.5, size: 0.06 })
        VFX.flash({ position: _spawnVfx, color: COLORS.cadenceTeal, intensity: 6, distance: 8, life: 0.35 })
        setEnemies((list) => [...list, e])
      }
    }

    // death dissolve clock + despawn
    let removed = false
    for (const e of EnemyRegistry.list()) {
      if (e.alive) continue
      const ent = EnemyRegistry.get(e.id)
      if (!ent) continue
      ent.deathTimer += dt
      if (ent.deathTimer > ent.dissolveSec + 0.1) {
        unregisterEnemy(ent.id)
        removed = true
      }
    }
    if (removed) setEnemies((list) => list.filter((e) => EnemyRegistry.get(e.id) !== undefined))
  })

  return (
    <group>
      {enemies.map((e) =>
        e.type === 'drone' ? (
          <Drone key={e.id} entity={e} />
        ) : e.type === 'trooper' ? (
          <Trooper key={e.id} entity={e} />
        ) : (
          <Heavy key={e.id} entity={e} />
        ),
      )}
      <EnemyBoltPool />
    </group>
  )
}

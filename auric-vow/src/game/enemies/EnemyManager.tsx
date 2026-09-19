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
import { MISSION, ENEMY_LOOK, ENEMY_SPAWN, type WaveSpec } from '@/game/config'
import { VFX } from '@/game/vfx/VFXBus'
import { ZONES } from '@/game/mission/zones'
import { PlayerRef } from '@/game/player/PlayerRef'
import { raycastLevel } from '@/game/world/Colliders'
import { hasLineOfSight, clearThreat } from './ai'
import { updateOutlineScale } from './dissolve'
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
const _ring = new THREE.Vector3()
const _framed = new THREE.Vector3()
const _down = new THREE.Vector3(0, -1, 0)
const _eye = new THREE.Vector3()
const _out = new THREE.Vector3()

/**
 * [enemies-hud R1] Reinforcements used to arrive at fixed arena-door anchors
 * up to 40 m from the player, which is why 21 capture frames contained no
 * legible enemy. Every combat spawn is now FRAMED: the door direction is
 * kept (they still come from the doors) but the anchor is pulled along that
 * bearing into an 11–19 m band around the player, snapped to the floor, and
 * rejected back to the door anchor if the framed point has no line of sight.
 */
function frameSpawn(anchor: THREE.Vector3, flying: boolean, out: THREE.Vector3): THREE.Vector3 {
  out.copy(anchor)
  _ring.subVectors(anchor, PlayerRef.position)
  _ring.y = 0
  let d = _ring.length()
  if (d < 0.01) {
    _ring.set(0, 0, 1)
    d = 1
  } else {
    _ring.divideScalar(d)
  }
  const want = Math.max(ENEMY_SPAWN.safeMin, THREE.MathUtils.clamp(d, ENEMY_SPAWN.ringMin, ENEMY_SPAWN.ringMax))
  if (want >= d - 0.5) return out // already close enough — keep the door anchor
  _framed.copy(PlayerRef.position).addScaledVector(_ring, want)
  _framed.y = anchor.y

  if (flying) {
    _framed.y = Math.max(PlayerRef.position.y + 2.5, anchor.y)
  } else {
    // drop onto the floor under the framed point
    _spawnVfx.copy(_framed).setY(PlayerRef.position.y + 6)
    const hit = raycastLevel(_spawnVfx, _down, 14, ['floor', 'platform', 'wall', 'objective'])
    if (!hit) return out // no ground there — fall back to the authored anchor
    _framed.y = hit.point.y + 0.02
  }

  // must be visible from the player's chest, or the entrance is pointless
  _eye.copy(PlayerRef.position).setY(PlayerRef.position.y + PlayerRef.height * 0.6)
  _spawnVfx.copy(_framed).setY(_framed.y + 1.2)
  if (!hasLineOfSight(_eye, _spawnVfx)) return out
  return out.copy(_framed)
}

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
  /** spawns whose entrance telegraph is playing but whose body has not landed */
  const landing = useRef<{ t: number; item: QueueItem }[]>([])

  // ---- phase-driven spawn tables ----
  useEffect(() => {
    queue.current = []
    landing.current = []
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
  useFrame((state, delta) => {
    const s = useGameStore.getState()
    // keep the hostile outline exactly N pixels wide whatever the camera does
    const cam = state.camera as THREE.PerspectiveCamera
    if (cam.isPerspectiveCamera) updateOutlineScale(cam.fov, state.size.height)
    if (s.phase === 'WIN' || s.phase === 'LOSE') return
    const dt = Math.min(delta, 0.05) * s.timeScale

    // spawn queue → staged entrance (portal telegraph, then the body)
    if (queue.current.length > 0) {
      queueClock.current += dt
      sinceSpawn.current += dt
      const head = queue.current[0]
      if (
        queueClock.current >= head.at &&
        sinceSpawn.current >= SPAWN_GAP &&
        EnemyRegistry.aliveCount() + landing.current.length < MAX_ALIVE
      ) {
        queue.current.shift()
        sinceSpawn.current = 0
        const spec = ENTITY_SPEC[head.type]
        const flying = head.type === 'drone'
        // frame the anchor toward the player so reinforcements arrive ON SCREEN
        const pos = head.alerted ? frameSpawn(head.pos, flying, _out).clone() : head.pos.clone()
        // stage 1 — the entrance telegraph: a crimson ground ring + rising motes
        _spawnVfx.copy(pos).setY(pos.y + 0.05)
        VFX.ring({
          position: _spawnVfx,
          color: ENEMY_LOOK.accent,
          maxRadius: spec.radius * 3.2,
          life: ENEMY_SPAWN.telegraphSec + 0.15,
          width: 0.18,
        })
        VFX.burst({
          position: _spawnVfx,
          color: ENEMY_LOOK.accent,
          count: 8,
          speed: 2.2,
          life: ENEMY_SPAWN.telegraphSec + 0.2,
          size: 0.05,
          gravity: 3,
        })
        landing.current.push({ t: ENEMY_SPAWN.telegraphSec, item: { ...head, pos } })
        // a body still mid-entrance counts as pending, or MissionDirector can
        // see 0 queued / 0 alive during the telegraph and clear the wave early
        SpawnStatus.pending = queue.current.length + landing.current.length
      }
    }

    // staged entrance: the body arrives after the telegraph has been read
    if (landing.current.length > 0) {
      for (let i = landing.current.length - 1; i >= 0; i--) {
        const l = landing.current[i]
        l.t -= dt
        if (l.t > 0) continue
        landing.current.splice(i, 1)
        SpawnStatus.pending = queue.current.length + landing.current.length
        const spec = ENTITY_SPEC[l.item.type]
        const e = registerEnemy({
          type: l.item.type,
          position: l.item.pos,
          hp: spec.hp,
          radius: spec.radius,
          height: spec.height,
          alerted: l.item.alerted,
          waypoints: l.item.waypoints,
          dissolveSec: spec.dissolveSec,
        })
        // stage 2 — arrival: hard flash + impact burst at chest height
        _spawnVfx.copy(l.item.pos).setY(l.item.pos.y + spec.height * 0.5)
        VFX.burst({
          position: _spawnVfx,
          color: ENEMY_LOOK.accentHot,
          count: 12,
          speed: 4.5,
          life: 0.45,
          size: 0.06,
          gravity: -3,
        })
        VFX.flash({ position: _spawnVfx, color: ENEMY_LOOK.accentHot, intensity: 8, distance: 9, life: 0.28 })
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
        clearThreat(ent.id)
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

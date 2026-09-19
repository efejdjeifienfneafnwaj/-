/**
 * AURIC VOW — mission/MissionDirector.tsx
 * Authoritative mission phase machine (enemies-mission.md §7, design.md §6):
 *
 *   DROPSHIP (3s) → INFILTRATE (reach chamber door z=133) → OBJECTIVE
 *   (channel 8s inside the 4 m Reliquary ring; pauses if player leaves > 1s)
 *   → EXTERMINATE (3 waves from config.MISSION, 3s between waves)
 *   → EXTRACT (90s timer, 4 harass drones; stand on pad 2s → WIN; timer 0 → LOSE)
 *   hp ≤ 0 at any time → LOSE.
 *
 * Runs inside the R3F canvas. The phase clock uses REAL unclamped dt (fps-
 * independent cinematics); gameplay timers use scaled dt (store.timeScale).
 * Zone bounds live in mission/zones.ts. Renders nothing itself.
 */
import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { PlayerRef } from '@/game/player/PlayerRef'
import { useGameStore } from '@/game/store'
import { MISSION } from '@/game/config'
import { AudioBus } from '@/game/AudioBus'
import { EnemyRegistry } from '@/game/enemies/EnemyRegistry'
import { SpawnStatus } from '@/game/enemies/EnemyManager'
import { ZONES } from './zones'

const CHANNEL_GRACE = 1.0 // seconds outside the ring before channel pauses
const WAVE_BREAK = 3.0 // seconds between last death and next wave

export function MissionDirector() {
  const phaseClock = useRef(0)
  const grace = useRef(0)
  const waveBreak = useRef(0)
  const lastPhase = useRef('')

  useFrame((_, delta) => {
    const s = useGameStore.getState()
    // Mission timers run on REAL elapsed time — unclamped. Clamping dt here
    // (e.g. min(delta, 0.05)) dilates game time at low fps: the 3s dropship
    // intro and the 90s extraction countdown would stretch far beyond their
    // design durations. Clamped dt is only for physics/integration steps,
    // which this director has none of.
    const realDt = delta
    const dt = realDt * s.timeScale
    const phase = s.phase

    if (phase === 'WIN' || phase === 'LOSE') return

    // --- lose check, any phase ---
    if (s.hp <= 0) {
      s.setPhase('LOSE')
      return
    }

    // --- phase entry bookkeeping ---
    if (phase !== lastPhase.current) {
      lastPhase.current = phase
      phaseClock.current = 0
      grace.current = 0
      waveBreak.current = 0
      // objective marker target for the new phase (set once — HUD subscribes)
      switch (phase) {
        case 'DROPSHIP':
        case 'INFILTRATE':
          s.setObjectivePosition(ZONES.chamberDoor.position.clone())
          break
        case 'OBJECTIVE':
          s.setObjectivePosition(ZONES.reliquary.position.clone())
          break
        case 'EXTERMINATE':
          s.setObjectivePosition(null) // arena medallion pulses instead
          break
        case 'EXTRACT':
          s.setObjectivePosition(ZONES.extraction.beacon.clone())
          break
        default:
          break
      }
    }
    // phase clock is real-time: the DROPSHIP cinematic lasts exactly
    // dropshipDurationSec wall-clock seconds regardless of fps/timeScale
    phaseClock.current += realDt

    switch (phase) {
      case 'DROPSHIP': {
        // 3s cinematic sweep, then the run begins
        if (phaseClock.current >= MISSION.dropshipDurationSec) {
          s.setPhase('INFILTRATE')
          AudioBus.playUIClick() // banner tick — HUD owns the title card
        }
        break
      }

      case 'INFILTRATE': {
        // crossing the chamber-door trigger opens the OBJECTIVE phase
        if (PlayerRef.position.z >= ZONES.chamberDoor.triggerZ) {
          s.setPhase('OBJECTIVE')
          s.setChannelProgress(0)
          AudioBus.playEnemyChirp() // the Reliquary wakes
        }
        break
      }

      case 'OBJECTIVE': {
        const dist = PlayerRef.position.distanceTo(ZONES.reliquary.position)
        const inside = dist <= ZONES.reliquary.channelRadius
        if (inside) {
          grace.current = 0
        } else {
          grace.current += dt
        }
        // channel advances inside the ring; brief exits (< 1s) don't pause it
        if (inside || grace.current < CHANNEL_GRACE) {
          s.setChannelProgress(s.channelProgress + dt / MISSION.objective.channelSec)
        }
        if (s.channelProgress >= 1) {
          s.setWave(0)
          s.setPhase('EXTERMINATE')
          AudioBus.playAbility() // chamber-flash sting
        }
        break
      }

      case 'EXTERMINATE': {
        const key = `EXTERMINATE:${s.wave}`
        // wait until EnemyManager has queued this wave before testing clear
        if (SpawnStatus.key !== key) break
        if (SpawnStatus.pending === 0 && EnemyRegistry.aliveCount() === 0) {
          waveBreak.current += dt
          if (waveBreak.current >= WAVE_BREAK) {
            if (s.wave + 1 < MISSION.exterminateWaves.length) {
              s.setWave(s.wave + 1) // EnemyManager spawns the next wave
              AudioBus.playEnemyChirp() // "THE CADENCE SWELLS"
            } else {
              s.setPhase('EXTRACT')
              s.setExtractionTimer(MISSION.extract.timerSec)
              s.setExtractionHold(0)
              AudioBus.playAbility() // beacon ignition sting
            }
          }
        } else {
          waveBreak.current = 0
        }
        break
      }

      case 'EXTRACT': {
        // 90s countdown
        const t = Math.max(0, s.extractionTimer - dt)
        s.setExtractionTimer(t)
        if (t <= 0) {
          s.setPhase('LOSE') // "THE BEACON DIMS"
          return
        }
        // stand on the pad for 2s to win
        const p = PlayerRef.position
        const pad = ZONES.extraction.pad
        const onPad =
          Math.abs(p.y - pad.y) < 2.5 &&
          (p.x - pad.x) * (p.x - pad.x) + (p.z - pad.z) * (p.z - pad.z) <=
            ZONES.extraction.padRadius * ZONES.extraction.padRadius
        const hold = onPad ? s.extractionHold + dt : 0
        s.setExtractionHold(hold)
        if (hold >= MISSION.extract.padStandSec) {
          s.finalizeScore(s.gameTime) // bake in time + no-death bonuses once
          s.setPhase('WIN')
        }
        break
      }
    }
  })

  return null
}

/**
 * AURIC VOW — enemyState.ts
 * Minimal mutable bridge so the ENEMIES agent can report the alive-enemy
 * count shown in the EXTERMINATE wave chip ("× 9" in teal). The store has
 * no enemy registry, so this is the lightweight HUD-facing channel.
 *
 * Enemies-agent contract:
 *   import { setEnemiesAlive } from '@/game/hud'
 *   setEnemiesAlive(manager.aliveCount)  // on spawn/death, or per frame
 */
export const enemyState = {
  /** enemies currently alive (EXTERMINATE wave chip readout) */
  alive: 0,
}

export function setEnemiesAlive(n: number): void {
  enemyState.alive = Math.max(0, Math.floor(n))
}

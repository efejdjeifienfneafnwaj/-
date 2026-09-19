/**
 * AURIC VOW — App root.
 * Full-screen R3F canvas behind DOM screens:
 *   title → game → (pause / win / lose)
 * The mission phase machine (store.phase) drives win/lose;
 * pointer-lock state drives pause.
 */
import { useCallback, useEffect, useState } from 'react'
import GameCanvas from '@/game/GameCanvas'
import TitleScreen from '@/screens/TitleScreen'
import PauseScreen from '@/screens/PauseScreen'
import WinScreen from '@/screens/WinScreen'
import LoseScreen from '@/screens/LoseScreen'
import { useGameStore } from '@/game/store'
import { HUD, DamageNumbers } from '@/game/hud'
import { Input } from '@/game/Input'
import { AudioBus } from '@/game/AudioBus'
import { initTextures } from '@/game/textures'

type Screen = 'title' | 'game' | 'pause' | 'win' | 'lose'

export default function App() {
  const [screen, setScreen] = useState<Screen>('title')
  const phase = useGameStore((s) => s.phase)

  // boot-time procedural textures (design.md §8)
  useEffect(() => {
    initTextures()
  }, [])

  // mission end → win/lose screens (only while actually playing — the world
  // simulates behind the title screen as a backdrop and may reach LOSE there)
  useEffect(() => {
    if (phase === 'WIN') setScreen((s) => (s === 'game' || s === 'pause' ? 'win' : s))
    else if (phase === 'LOSE') setScreen((s) => (s === 'game' || s === 'pause' ? 'lose' : s))
  }, [phase])

  // pointer-lock loss during play = pause (covers Esc)
  useEffect(() => {
    return Input.onLockChange((locked) => {
      if (!locked) {
        setScreen((s) => (s === 'game' ? 'pause' : s))
      } else {
        setScreen((s) => (s === 'pause' ? 'game' : s))
      }
    })
  }, [])

  const engage = useCallback(() => {
    AudioBus.unlock()
    AudioBus.playUIClick()
    useGameStore.getState().resetRun()
    setScreen('game')
    Input.requestPointerLock()
  }, [])

  const resume = useCallback(() => {
    Input.requestPointerLock()
    // 'game' is set by the lock-change listener above
  }, [])

  const toTitle = useCallback(() => {
    useGameStore.getState().resetRun()
    Input.exitPointerLock()
    setScreen('title')
  }, [])

  const retry = useCallback(() => {
    useGameStore.getState().resetRun()
    setScreen('game')
    Input.requestPointerLock()
  }, [])

  return (
    <>
      <GameCanvas />
      {/* DOM overlay: HUD + pooled damage numbers (sole drainers of
          store.damageEvents) — only while a run is active, never on title */}
      {(screen === 'game' || screen === 'pause') && (
        <>
          <HUD />
          <DamageNumbers />
        </>
      )}
      {screen === 'title' && <TitleScreen onEngage={engage} />}
      {screen === 'pause' && <PauseScreen onResume={resume} onAbandon={toTitle} />}
      {screen === 'win' && <WinScreen onRestart={toTitle} />}
      {screen === 'lose' && <LoseScreen onRetry={retry} onTitle={toTitle} />}
    </>
  )
}

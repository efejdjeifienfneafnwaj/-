/**
 * AURIC VOW — Lose screen: staged failure reveal + retry (H9).
 * Same beat structure as the win screen so the two read as one system —
 * only the palette (ember over a cold wash) and the copy differ.
 */
import { useEffect, useState } from 'react'
import { COLORS } from '@/game/config'
import { useGameStore, selectTallies } from '@/game/store'
import { AudioBus } from '@/game/AudioBus'
import '@/game/hud/hud.css'

interface Props {
  onRetry: () => void
  onTitle: () => void
}

function useStage(count: number, step = 150, delay = 300): number {
  const [n, setN] = useState(0)
  useEffect(() => {
    const timers = Array.from({ length: count }, (_, i) =>
      setTimeout(() => setN(i + 1), delay + i * step),
    )
    return () => timers.forEach(clearTimeout)
  }, [count, step, delay])
  return n
}

export default function LoseScreen({ onRetry, onTitle }: Props) {
  const { kills, score } = useGameStore(selectTallies)
  const stage = useStage(4)

  const rows: [string, string][] = [
    ['KILLS', String(kills)],
    ['SCORE', score.toLocaleString()],
  ]

  return (
    <div className="avs av-fade-in">
      <div
        className="avs-scrim"
        style={{
          background:
            'linear-gradient(180deg, rgba(5,6,12,0.94) 0%, rgba(5,6,12,0.3) 30%, rgba(5,6,12,0.32) 50%, rgba(5,6,12,0.9) 80%, rgba(3,4,9,0.98) 100%), radial-gradient(ellipse 70% 50% at 50% 52%, rgba(90,20,18,0.28), transparent 72%)',
        }}
      />
      <div className="avs-vig" />
      <div className="avs-body">
        <p className="avs-eyebrow" style={{ color: COLORS.emberRed }}>
          SIGNAL LOST
        </p>
        <div className="avs-wordmark av-title-in" style={{ padding: '12px 44px 14px' }}>
          <i className="avs-fil tl" />
          <i className="avs-fil tr" />
          <i className="avs-fil bl" />
          <i className="avs-fil br" />
          <h1
            className="avs-title"
            style={{
              fontSize: 'clamp(34px, 5.6vmin, 68px)',
              background: 'linear-gradient(178deg, #FFE6E2 0%, #FF4B3E 46%, #6E1710 80%, #C4453A 100%)',
              WebkitBackgroundClip: 'text',
              backgroundClip: 'text',
            }}
          >
            VESSEL SEVERED
          </h1>
        </div>
        <p className="avs-sub">THE CADENCE CLAIMS THE ANVIL</p>

        <div className="avs-rows" style={{ marginTop: 34 }}>
          {rows.map(([k, v], i) => (
            <div
              className={stage >= i + 1 ? 'avs-row avs-reveal' : 'avs-row'}
              key={k}
              style={stage >= i + 1 ? undefined : { opacity: 0 }}
            >
              <span className="k">{k}</span>
              <span className="dots" />
              <span className="v" style={k === 'SCORE' ? { color: COLORS.aureate } : undefined}>
                {v}
              </span>
            </div>
          ))}
        </div>

        {stage >= 3 && (
          <div className="avs-actions avs-reveal">
            <button
              className="avs-btn primary"
              onClick={() => {
                AudioBus.playUIClick()
                onRetry()
              }}
            >
              RETRY
            </button>
            <button
              className="avs-btn ghost"
              onClick={() => {
                AudioBus.playUIClick()
                onTitle()
              }}
            >
              TITLE
            </button>
          </div>
        )}
      </div>
      <div className="avs-rule-b" />
    </div>
  )
}

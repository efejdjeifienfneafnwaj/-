/**
 * AURIC VOW — Lose screen: teal static dissolve + retry.
 */
import { COLORS } from '@/game/config'
import { useGameStore, selectTallies } from '@/game/store'
import { AudioBus } from '@/game/AudioBus'

interface Props {
  onRetry: () => void
  onTitle: () => void
}

export default function LoseScreen({ onRetry, onTitle }: Props) {
  const { kills, score } = useGameStore(selectTallies)

  return (
    <div
      className="av-fade-in fixed inset-0 z-20 flex flex-col items-center justify-center"
      style={{ background: 'radial-gradient(ellipse at center, rgba(25,227,214,0.08), rgba(10,13,31,0.94) 70%)' }}
    >
      <p className="font-display text-sm tracking-[0.5em]" style={{ color: COLORS.cadenceTeal }}>
        SIGNAL LOST
      </p>
      <h2
        className="font-display mt-3 text-6xl font-bold tracking-[0.25em]"
        style={{ color: COLORS.emberRed, textShadow: `0 0 40px rgba(25,227,214,0.3)` }}
      >
        VESSEL SEVERED
      </h2>
      <p className="font-hud mt-4 text-base tracking-[0.3em]" style={{ color: COLORS.ash }}>
        THE CADENCE CLAIMS THE ANVIL
      </p>

      <div className="font-hud mt-10 flex gap-12 text-lg tracking-[0.2em]">
        <span style={{ color: COLORS.ash }}>
          KILLS <span style={{ color: COLORS.vellum }}>{kills}</span>
        </span>
        <span style={{ color: COLORS.ash }}>
          SCORE <span style={{ color: COLORS.aureate }}>{score.toLocaleString()}</span>
        </span>
      </div>

      <div className="mt-12 flex gap-6">
        <button
          className="font-display cursor-pointer border px-14 py-3 text-lg tracking-[0.35em] transition-colors duration-200"
          style={{ borderColor: COLORS.regalGold, color: COLORS.aureate, background: 'rgba(201,162,75,0.08)' }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(201,162,75,0.22)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(201,162,75,0.08)')}
          onClick={() => {
            AudioBus.playUIClick()
            onRetry()
          }}
        >
          RETRY
        </button>
        <button
          className="font-display cursor-pointer border px-14 py-3 text-lg tracking-[0.35em] transition-colors duration-200"
          style={{ borderColor: '#3A4160', color: COLORS.ash, background: 'transparent' }}
          onMouseEnter={(e) => (e.currentTarget.style.color = COLORS.vellum)}
          onMouseLeave={(e) => (e.currentTarget.style.color = COLORS.ash)}
          onClick={() => {
            AudioBus.playUIClick()
            onTitle()
          }}
        >
          TITLE
        </button>
      </div>
    </div>
  )
}

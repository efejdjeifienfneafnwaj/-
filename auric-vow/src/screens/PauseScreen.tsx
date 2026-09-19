/**
 * AURIC VOW — Pause menu (Esc / pointer-lock loss).
 */
import { COLORS } from '@/game/config'
import { AudioBus } from '@/game/AudioBus'

interface Props {
  onResume: () => void
  onAbandon: () => void
}

export default function PauseScreen({ onResume, onAbandon }: Props) {
  return (
    <div
      className="av-fade-in fixed inset-0 z-20 flex flex-col items-center justify-center"
      style={{ background: 'rgba(10,13,31,0.82)', backdropFilter: 'blur(6px)' }}
    >
      <h2
        className="font-display text-5xl font-bold tracking-[0.3em]"
        style={{ color: COLORS.vellum, textShadow: `0 0 30px rgba(255,184,53,0.25)` }}
      >
        PAUSED
      </h2>
      <p className="font-hud mt-2 text-sm tracking-[0.3em]" style={{ color: COLORS.ash }}>
        THE VOW HOLDS
      </p>
      <div className="mt-12 flex flex-col items-center gap-5">
        <button
          className="font-display cursor-pointer border px-14 py-3 text-lg tracking-[0.35em] transition-colors duration-200"
          style={{ borderColor: COLORS.regalGold, color: COLORS.aureate, background: 'rgba(201,162,75,0.08)' }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(201,162,75,0.22)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(201,162,75,0.08)')}
          onClick={() => {
            AudioBus.playUIClick()
            onResume()
          }}
        >
          RESUME
        </button>
        <button
          className="font-display cursor-pointer border px-14 py-3 text-lg tracking-[0.35em] transition-colors duration-200"
          style={{ borderColor: '#3A4160', color: COLORS.ash, background: 'transparent' }}
          onMouseEnter={(e) => (e.currentTarget.style.color = COLORS.vellum)}
          onMouseLeave={(e) => (e.currentTarget.style.color = COLORS.ash)}
          onClick={() => {
            AudioBus.playUIClick()
            onAbandon()
          }}
        >
          ABANDON RUN
        </button>
      </div>
    </div>
  )
}

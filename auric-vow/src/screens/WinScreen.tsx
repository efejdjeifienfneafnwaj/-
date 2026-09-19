/**
 * AURIC VOW — Win screen: score + S/A/B/C grade.
 */
import { COLORS } from '@/game/config'
import { useGameStore, gradeForScore, selectTallies } from '@/game/store'
import { AudioBus } from '@/game/AudioBus'

interface Props {
  onRestart: () => void
}

const GRADE_COLORS: Record<string, string> = {
  S: COLORS.aureate,
  A: COLORS.solarWhite,
  B: COLORS.paleHalo,
  C: COLORS.ash,
}

export default function WinScreen({ onRestart }: Props) {
  const { kills, headshots, abilityKills, score } = useGameStore(selectTallies)
  const grade = gradeForScore(score)

  return (
    <div
      className="av-fade-in fixed inset-0 z-20 flex flex-col items-center justify-center"
      style={{ background: 'radial-gradient(ellipse at center, rgba(27,36,64,0.7), rgba(10,13,31,0.94) 75%)' }}
    >
      <p className="font-display text-sm tracking-[0.5em]" style={{ color: COLORS.aureate }}>
        EXTRACTION COMPLETE
      </p>
      <h2
        className="font-display mt-3 text-6xl font-bold tracking-[0.25em]"
        style={{ color: COLORS.vellum, textShadow: `0 0 40px rgba(255,184,53,0.35)` }}
      >
        VOW FULFILLED
      </h2>

      {/* grade diamond */}
      <div
        className="mt-10 flex h-28 w-28 rotate-45 items-center justify-center border-2"
        style={{ borderColor: GRADE_COLORS[grade], boxShadow: `0 0 34px ${GRADE_COLORS[grade]}66, inset 0 0 24px ${GRADE_COLORS[grade]}33` }}
      >
        <span className="font-display -rotate-45 text-6xl font-bold" style={{ color: GRADE_COLORS[grade] }}>
          {grade}
        </span>
      </div>

      <div className="font-hud mt-10 grid grid-cols-2 gap-x-14 gap-y-2 text-center text-lg tracking-[0.2em]">
        <span style={{ color: COLORS.ash }}>SCORE</span>
        <span className="font-semibold" style={{ color: COLORS.aureate }}>{score.toLocaleString()}</span>
        <span style={{ color: COLORS.ash }}>KILLS</span>
        <span style={{ color: COLORS.vellum }}>{kills}</span>
        <span style={{ color: COLORS.ash }}>HEADSHOTS</span>
        <span style={{ color: COLORS.vellum }}>{headshots}</span>
        <span style={{ color: COLORS.ash }}>ABILITY KILLS</span>
        <span style={{ color: COLORS.vellum }}>{abilityKills}</span>
      </div>

      <button
        className="font-display mt-12 cursor-pointer border px-14 py-3 text-lg tracking-[0.35em] transition-colors duration-200"
        style={{ borderColor: COLORS.regalGold, color: COLORS.aureate, background: 'rgba(201,162,75,0.08)' }}
        onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(201,162,75,0.22)')}
        onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(201,162,75,0.08)')}
        onClick={() => {
          AudioBus.playUIClick()
          onRestart()
        }}
      >
        RETURN TO TITLE
      </button>
    </div>
  )
}

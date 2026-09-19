/**
 * AURIC VOW — Win screen: staged results reveal (H9).
 *
 * The final state no longer snaps in complete. The reveal is beat-by-beat:
 * title → breakdown rows, one every 140 ms → grade stamp with a scale punch
 * and a sting → score count-up over 0.9 s → actions. Rows are leadered with a
 * gold dot rule so the numbers hang on a common right edge.
 */
import { useEffect, useState } from 'react'
import { COLORS } from '@/game/config'
import { useShallow } from 'zustand/react/shallow'
import { useGameStore, gradeForScore, selectTallies } from '@/game/store'
import { AudioBus } from '@/game/AudioBus'
import '@/game/hud/hud.css'

interface Props {
  onRestart: () => void
}

const GRADE_COLORS: Record<string, string> = {
  S: COLORS.aureate,
  A: COLORS.solarWhite,
  B: COLORS.paleHalo,
  C: COLORS.ash,
}

/** eased count-up, started after `delay` ms */
function useCountUp(target: number, delay: number, dur = 900): number {
  const [v, setV] = useState(0)
  useEffect(() => {
    let raf = 0
    let start = 0
    const step = (now: number) => {
      if (!start) start = now
      const p = Math.min(1, (now - start) / dur)
      setV(Math.round(target * (1 - Math.pow(1 - p, 3))))
      if (p < 1) raf = requestAnimationFrame(step)
    }
    const t = setTimeout(() => {
      raf = requestAnimationFrame(step)
    }, delay)
    return () => {
      clearTimeout(t)
      cancelAnimationFrame(raf)
    }
  }, [target, delay, dur])
  return v
}

/** how many staged beats have played */
function useStage(count: number, step = 140, delay = 260): number {
  const [n, setN] = useState(0)
  useEffect(() => {
    const timers = Array.from({ length: count }, (_, i) =>
      setTimeout(() => setN(i + 1), delay + i * step),
    )
    return () => timers.forEach(clearTimeout)
  }, [count, step, delay])
  return n
}

export default function WinScreen({ onRestart }: Props) {
  const { kills, headshots, abilityKills, score } = useGameStore(useShallow(selectTallies))
  const grade = gradeForScore(score)
  const stage = useStage(6)
  const shownScore = useCountUp(score, 900)

  useEffect(() => {
    const t = setTimeout(() => AudioBus.playUIClick(), 820)
    return () => clearTimeout(t)
  }, [])

  const rows: [string, string][] = [
    ['KILLS', String(kills)],
    ['HEADSHOTS', String(headshots)],
    ['ABILITY KILLS', String(abilityKills)],
  ]

  return (
    <div className="avs av-fade-in">
      <div className="avs-scrim" />
      <div className="avs-vig" />
      <div className="avs-body">
        <p className="avs-eyebrow" style={{ color: COLORS.aureate }}>
          EXTRACTION COMPLETE
        </p>
        <div className="avs-wordmark av-title-in" style={{ padding: '12px 44px 14px' }}>
          <i className="avs-fil tl" />
          <i className="avs-fil tr" />
          <i className="avs-fil bl" />
          <i className="avs-fil br" />
          <h1 className="avs-title" style={{ fontSize: 'clamp(34px, 5.6vmin, 68px)' }}>
            VOW FULFILLED
          </h1>
        </div>

        {stage >= 4 && (
          <div className="avs-grade stamp" style={{ color: GRADE_COLORS[grade] }}>
            <span>{grade}</span>
          </div>
        )}

        <div className="avs-rows">
          {rows.map(([k, v], i) =>
            stage >= i + 1 ? (
              <div className="avs-row avs-reveal" key={k}>
                <span className="k">{k}</span>
                <span className="dots" />
                <span className="v">{v}</span>
              </div>
            ) : (
              <div className="avs-row" key={k} style={{ opacity: 0 }}>
                <span className="k">{k}</span>
                <span className="dots" />
                <span className="v">{v}</span>
              </div>
            ),
          )}
          {stage >= 5 && (
            <div className="avs-row total avs-reveal">
              <span className="k">SCORE</span>
              <span className="dots" />
              <span className="v">{shownScore.toLocaleString()}</span>
            </div>
          )}
        </div>

        {stage >= 6 && (
          <div className="avs-actions avs-reveal">
            <button
              className="avs-btn primary"
              onClick={() => {
                AudioBus.playUIClick()
                onRestart()
              }}
            >
              RETURN TO TITLE
            </button>
          </div>
        )}
      </div>
      <div className="avs-rule-b" />
    </div>
  )
}

/**
 * AURIC VOW — Pause menu (Esc / pointer-lock loss).
 * Restyled onto the shared screen vocabulary: scrim + vignette, engraved
 * wordmark plate, chamfered buttons. (The sim keeps running behind this —
 * gating `useFrame`/`timeScale` is M1 and lives in the store + GameCanvas,
 * which this stream does not own.)
 */
import { COLORS } from '@/game/config'
import { AudioBus } from '@/game/AudioBus'
import '@/game/hud/hud.css'

interface Props {
  onResume: () => void
  onAbandon: () => void
}

export default function PauseScreen({ onResume, onAbandon }: Props) {
  return (
    <div className="avs av-fade-in" style={{ backdropFilter: 'blur(5px)' }}>
      <div
        className="avs-scrim"
        style={{ background: 'linear-gradient(180deg, rgba(6,8,16,0.9), rgba(4,5,11,0.9))' }}
      />
      <div className="avs-vig" />
      <div className="avs-body">
        <div className="avs-wordmark" style={{ padding: '12px 46px 14px' }}>
          <i className="avs-fil tl" />
          <i className="avs-fil tr" />
          <i className="avs-fil bl" />
          <i className="avs-fil br" />
          <h1 className="avs-title" style={{ fontSize: 'clamp(30px, 4.6vmin, 56px)' }}>
            PAUSED
          </h1>
        </div>
        <p className="avs-sub" style={{ color: COLORS.ash }}>
          THE VOW HOLDS
        </p>

        <div className="avs-menu">
          <button
            className="avs-btn"
            onClick={() => {
              AudioBus.playUIClick()
              onResume()
            }}
          >
            RESUME
          </button>
          <button
            className="avs-btn ghost"
            onClick={() => {
              AudioBus.playUIClick()
              onAbandon()
            }}
          >
            ABANDON RUN
          </button>
        </div>
      </div>
      <div className="avs-rule-b" />
    </div>
  )
}

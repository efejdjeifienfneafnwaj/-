/**
 * AURIC VOW — Title screen.
 *
 * R1 art pass (H8): the plain centred text column is replaced by a composed
 * front end — a gradient scrim that darkens the live mission behind it and
 * reserves a quiet band for the wordmark, a layered plate/bevel/filigree
 * treatment instead of glow-on-serif, the subtitle demoted to ash, a real
 * menu, and the control hints collapsed to one low-opacity base line.
 *
 * The hero camera itself belongs to the world stream (a title camera lives in
 * GameCanvas/Lighting, which this stream does not own) — everything here is
 * the composition that sits over it.
 */
import { useEffect, useState } from 'react'
import { AudioBus } from '@/game/AudioBus'
import '@/game/hud/hud.css'

interface Props {
  onEngage: () => void
}

const HINTS: [string, string][] = [
  ['WASD', 'MOVE'],
  ['SHIFT', 'SPRINT'],
  ['LMB', 'RIFLE'],
  ['F', 'KATANA'],
  ['Q E 1 4', 'ABILITIES'],
]

export default function TitleScreen({ onEngage }: Props) {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setReady(true), 420)
    return () => clearTimeout(t)
  }, [])

  const engage = () => {
    AudioBus.playUIClick()
    onEngage()
  }

  return (
    <div className="avs av-fade-in" style={{ cursor: 'pointer' }} onClick={engage}>
      <div className="avs-scrim" />
      <div className="avs-vig" />

      <div className="avs-body">
        <p className="avs-eyebrow av-fade-in">VESSEL KAIRO</p>

        <div className="avs-wordmark av-title-in">
          <i className="avs-fil tl" />
          <i className="avs-fil tr" />
          <i className="avs-fil bl" />
          <i className="avs-fil br" />
          <h1 className="avs-title">AURIC VOW</h1>
        </div>

        <p className="avs-sub">THE SILENT ANVIL</p>

        {ready && (
          <div className="avs-menu avs-reveal">
            <button
              className="avs-btn"
              onClick={(e) => {
                e.stopPropagation()
                engage()
              }}
            >
              ENGAGE
            </button>
            <div className="avs-btn ghost" style={{ cursor: 'default', pointerEvents: 'none' }}>
              MISSION · THE SILENT ANVIL
            </div>
          </div>
        )}
      </div>

      <div className="avs-hints">
        {HINTS.map(([k, v]) => (
          <span key={k}>
            <b>{k}</b> {v}
          </span>
        ))}
      </div>
      <div className="avs-rule-b" />
    </div>
  )
}

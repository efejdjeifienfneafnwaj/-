/**
 * AURIC VOW — Title screen.
 *
 * R2: ENGAGE is a filled gold plate (the one action on the screen), the
 * mission line is a caption rather than a second outlined button, the
 * duplicated subtitle is gone, the type ramp/letterspacing/hairline weights
 * are hud.css tokens shared with the pause and results screens, and the
 * scrim's quiet band is two stops lighter so the architecture behind it is
 * actually visible (the title CAMERA itself is the world stream's).
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
import { LANG, T, setLang } from '@/i18n'
import '@/game/hud/hud.css'

interface Props {
  onEngage: () => void
}

const COPY = T.title

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
        <p className="avs-eyebrow av-fade-in">{COPY.eyebrow}</p>

        <div className="avs-wordmark av-title-in">
          <i className="avs-fil tl" />
          <i className="avs-fil tr" />
          <i className="avs-fil bl" />
          <i className="avs-fil br" />
          {/* the logo stays in English in every language */}
          <h1 className="avs-title" lang="en">
            AURIC VOW
          </h1>
        </div>
        {COPY.logoSub && <p className="avs-logo-sub av-fade-in">{COPY.logoSub}</p>}

        {ready && (
          <div className="avs-menu avs-reveal">
            <button
              className="avs-btn primary"
              onClick={(e) => {
                e.stopPropagation()
                engage()
              }}
            >
              {COPY.engage}
            </button>
            {/* [R2] the mission line was a second outlined button competing
                with ENGAGE, under a subtitle that printed the same words. The
                subtitle is gone and this is a caption. */}
            <div className="avs-caption">
              {COPY.missionLabel} · <b>{COPY.missionName}</b>
            </div>
          </div>
        )}
      </div>

      <div className="avs-hints">
        {COPY.hints.map(([k, v]) => (
          <span key={k}>
            <b>{k}</b> {v}
          </span>
        ))}
      </div>
      <div className="avs-rule-b" />

      {/* language toggle — top-right corner, clear of the menu and hints; it
          must never reach the screen-wide click-to-engage handler */}
      <button
        type="button"
        className="avs-lang"
        aria-label={COPY.langToggleAria}
        lang={LANG === 'ja' ? 'en' : 'ja'}
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation()
          setLang(LANG === 'ja' ? 'en' : 'ja')
        }}
      >
        {COPY.langToggle}
      </button>
    </div>
  )
}

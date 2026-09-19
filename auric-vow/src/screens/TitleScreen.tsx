/**
 * AURIC VOW — Title screen.
 * Gold-on-indigo cinematic title; click engages pointer lock and starts the run.
 */
import { COLORS } from '@/game/config'

interface Props {
  onEngage: () => void
}

export default function TitleScreen({ onEngage }: Props) {
  return (
    <div
      className="av-fade-in fixed inset-0 z-20 flex cursor-pointer flex-col items-center justify-center"
      style={{ background: 'radial-gradient(ellipse at 50% 60%, rgba(27,36,64,0.55), rgba(10,13,31,0.92) 75%)' }}
      onClick={onEngage}
    >
      {/* thin gold rules */}
      <div style={{ width: 220, height: 1, background: `linear-gradient(90deg, transparent, ${COLORS.regalGold}, transparent)` }} />
      <p
        className="font-display mt-4 text-sm tracking-[0.5em]"
        style={{ color: COLORS.ash }}
      >
        VESSEL KAIRO
      </p>
      <h1
        className="av-title-in font-display my-6 text-center text-7xl font-bold md:text-8xl"
        style={{
          color: COLORS.aureate,
          textShadow: `0 0 24px rgba(255,184,53,0.45), 0 0 80px rgba(255,184,53,0.2)`,
        }}
      >
        AURIC VOW
      </h1>
      <p className="font-display text-xl tracking-[0.6em]" style={{ color: COLORS.vellum }}>
        THE SILENT ANVIL
      </p>
      <p
        className="av-pulse-gold font-hud mt-16 text-lg font-semibold tracking-[0.35em]"
        style={{ color: COLORS.solarWhite }}
      >
        CLICK TO ENGAGE
      </p>
      <div className="mt-3 flex gap-6 text-xs tracking-[0.25em]" style={{ color: COLORS.ash }}>
        <span>WASD MOVE</span>
        <span>LMB RIFLE</span>
        <span>F KATANA</span>
        <span>Q / E / 1 / 4 ABILITIES</span>
      </div>
      <div
        className="absolute bottom-0 left-0 right-0"
        style={{ height: 1, background: `linear-gradient(90deg, transparent, ${COLORS.regalGold}, transparent)` }}
      />
    </div>
  )
}

/**
 * AURIC VOW — localisation.
 *
 * Plain module, no React context: the language is resolved ONCE at startup
 * (`?lang=en|ja` > localStorage 'auricvow.lang' > 'ja') and every consumer
 * reads the already-selected dictionary (`T`) at module scope. Switching
 * language stores the choice and reloads the page, which is the simplest way
 * to re-render everything — including the HUD's static lookup tables that
 * the per-frame rAF loop reads without allocating.
 *
 * Only VALUES are translated. Internal ids (mission phase ids, enemy types,
 * ability ids) stay as keys.
 */
import type { MissionPhaseId } from '@/game/config'

export type Lang = 'ja' | 'en'

const STORAGE_KEY = 'auricvow.lang'
const LANG_PARAM = 'lang'

function isLang(v: unknown): v is Lang {
  return v === 'ja' || v === 'en'
}

function resolveLang(): Lang {
  try {
    const q = new URLSearchParams(window.location.search).get(LANG_PARAM)
    if (isLang(q)) return q
  } catch {
    /* no window / malformed URL — fall through */
  }
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (isLang(stored)) return stored
  } catch {
    /* storage blocked (private mode, sandboxed iframe) */
  }
  return 'ja'
}

export const LANG: Lang = resolveLang()

/** persist the choice and reload so every string (HUD tables included) re-resolves */
export function setLang(l: Lang): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, l)
  } catch {
    /* storage blocked — the URL param below still carries the choice */
  }
  const url = new URL(window.location.href)
  // an explicit ?lang= outranks storage, so it must follow the new choice
  if (url.searchParams.has(LANG_PARAM) || !canStore()) url.searchParams.set(LANG_PARAM, l)
  window.history.replaceState(window.history.state, '', url)
  window.location.reload()
}

function canStore(): boolean {
  try {
    const k = `${STORAGE_KEY}.probe`
    window.localStorage.setItem(k, '1')
    window.localStorage.removeItem(k)
    return true
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Dictionary
// ---------------------------------------------------------------------------

export interface Dict {
  docTitle: string
  title: {
    eyebrow: string
    /** small localised line under the (always-English) AURIC VOW logo; '' = none */
    logoSub: string
    engage: string
    missionLabel: string
    missionName: string
    hints: readonly (readonly [key: string, label: string])[]
    /** label of the toggle that switches AWAY from the current language */
    langToggle: string
    langToggleAria: string
  }
  pause: {
    title: string
    sub: string
    resume: string
    abandon: string
  }
  win: {
    eyebrow: string
    title: string
    kills: string
    headshots: string
    abilityKills: string
    score: string
    toTitle: string
  }
  lose: {
    eyebrow: string
    title: string
    sub: string
    kills: string
    score: string
    retry: string
    toTitle: string
  }
  hud: {
    phaseBanner: Partial<Record<MissionPhaseId, string>>
    phaseObjective: Record<MissionPhaseId, string>
    /** nameplate copy keyed by enemy TYPE id */
    enemyName: Record<string, string>
    hostile: string
    bossName: string
    bossEnraged: string
    bossWeakPoint: string
    radar: string
    energyUnit: string
    weaponName: string
    wave: (n: number, of: number) => string
    threat: string
    purifying: string
    skipHint: string
    /** appended after a space to the objective distance */
    distUnit: string
    /** A1..A4 */
    abilityNames: readonly [string, string, string, string]
  }
}

const en: Dict = {
  docTitle: 'AURIC VOW — The Silent Anvil',
  title: {
    eyebrow: 'VESSEL KAIRO',
    logoSub: '',
    engage: 'ENGAGE',
    missionLabel: 'MISSION',
    missionName: 'THE SILENT ANVIL',
    hints: [
      ['WASD', 'MOVE'],
      ['SHIFT', 'SPRINT'],
      ['LMB', 'RIFLE'],
      ['F', 'KATANA'],
      ['1 2 3 4', 'ABILITIES'],
    ],
    langToggle: '日本語',
    langToggleAria: '日本語に切り替え',
  },
  pause: {
    title: 'PAUSED',
    sub: 'THE VOW HOLDS',
    resume: 'RESUME',
    abandon: 'ABANDON RUN',
  },
  win: {
    eyebrow: 'EXTRACTION COMPLETE',
    title: 'VOW FULFILLED',
    kills: 'KILLS',
    headshots: 'HEADSHOTS',
    abilityKills: 'ABILITY KILLS',
    score: 'SCORE',
    toTitle: 'RETURN TO TITLE',
  },
  lose: {
    eyebrow: 'SIGNAL LOST',
    title: 'VESSEL SEVERED',
    sub: 'THE CADENCE CLAIMS THE ANVIL',
    kills: 'KILLS',
    score: 'SCORE',
    retry: 'RETRY',
    toTitle: 'TITLE',
  },
  hud: {
    phaseBanner: {
      DROPSHIP: 'THE SILENT ANVIL',
      INFILTRATE: 'INFILTRATE',
      OBJECTIVE: 'THE NULL RELIQUARY',
      EXTERMINATE: 'EXTERMINATE',
      EXTRACT: 'EXTRACT',
    },
    phaseObjective: {
      DROPSHIP: 'Approach the Anvil of Silence',
      INFILTRATE: 'Breach the Reliquary chamber',
      OBJECTIVE: 'Hold position — purify the Reliquary',
      EXTERMINATE: 'Purge the Cadence',
      EXTRACT: 'Reach the extraction beacon',
      WIN: 'Mission complete',
      LOSE: 'Vessel lost',
    },
    enemyName: {
      drone: 'CHIRP',
      trooper: 'VOTARY',
      heavy: 'CANTOR',
    },
    hostile: 'HOSTILE',
    bossName: 'CANTOR',
    bossEnraged: 'ENRAGED',
    bossWeakPoint: 'REAR REACTOR — WEAK POINT',
    radar: 'AUSPEX',
    energyUnit: 'EN',
    weaponName: 'VOW',
    wave: (n, of) => `WAVE ${n} / ${of}`,
    threat: 'THREAT',
    purifying: 'PURIFYING',
    skipHint: 'SPACE · FIRE — SKIP',
    distUnit: 'M',
    abilityNames: ['Gilt Dash', 'Sunspike Volley', 'Aegis Halo', 'Auric Requiem'],
  },
}

const ja: Dict = {
  docTitle: 'AURIC VOW — 沈黙の鉄床',
  title: {
    eyebrow: '器カイロ',
    logoSub: '黄金の誓約',
    engage: '出撃',
    missionLabel: '任務',
    missionName: '沈黙の鉄床',
    hints: [
      ['WASD', '移動'],
      ['SHIFT', 'ダッシュ'],
      ['左クリック', 'ライフル'],
      ['F', '刀'],
      ['1 2 3 4', 'アビリティ'],
    ],
    langToggle: 'EN',
    langToggleAria: 'Switch to English',
  },
  pause: {
    title: '一時停止',
    sub: '誓約はなお続く',
    resume: '再開',
    abandon: '任務を放棄',
  },
  win: {
    eyebrow: '脱出完了',
    title: '誓約成就',
    kills: '撃破数',
    headshots: 'ヘッドショット',
    abilityKills: 'アビリティ撃破',
    score: 'スコア',
    toTitle: 'タイトルへ戻る',
  },
  lose: {
    eyebrow: '信号途絶',
    title: '器、断たれる',
    sub: '律動が鉄床を呑む',
    kills: '撃破数',
    score: 'スコア',
    retry: '再挑戦',
    toTitle: 'タイトル',
  },
  hud: {
    phaseBanner: {
      DROPSHIP: '沈黙の鉄床',
      INFILTRATE: '潜入',
      OBJECTIVE: '虚無の聖遺物庫',
      EXTERMINATE: '殲滅',
      EXTRACT: '脱出',
    },
    phaseObjective: {
      DROPSHIP: '沈黙の鉄床へ接近せよ',
      INFILTRATE: '聖遺物庫へ突入せよ',
      OBJECTIVE: '位置を死守 — 聖遺物を浄化せよ',
      EXTERMINATE: '律動の軍勢を殲滅せよ',
      EXTRACT: '脱出ビーコンへ向かえ',
      WIN: '任務完了',
      LOSE: '器を喪失',
    },
    enemyName: {
      drone: 'チャープ',
      trooper: 'ヴォタリー',
      heavy: 'カンター',
    },
    hostile: '敵性体',
    bossName: 'カンター',
    bossEnraged: '激昂',
    bossWeakPoint: '背部リアクター — 弱点',
    radar: 'オースペクス',
    energyUnit: 'EN',
    weaponName: 'ヴァウ',
    wave: (n, of) => `ウェーブ ${n} / ${of}`,
    threat: '脅威',
    purifying: '浄化中',
    skipHint: 'SPACE・射撃でスキップ',
    distUnit: 'm',
    abilityNames: ['金閃', '陽槍斉射', '守護の光輪', '黄金の鎮魂歌'],
  },
}

const DICTS: Record<Lang, Dict> = { ja, en }

/** the active dictionary — fixed for the lifetime of the page */
export const T: Dict = DICTS[LANG]

/** top-level section lookup, e.g. `t('hud').radar` */
export function t<K extends keyof Dict>(key: K): Dict[K] {
  return T[key]
}

// apply document-level language state once, at import
try {
  document.documentElement.lang = LANG
  document.title = T.docTitle
} catch {
  /* non-DOM context */
}

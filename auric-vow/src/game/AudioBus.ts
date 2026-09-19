/**
 * AURIC VOW — AudioBus.ts
 * Procedural WebAudio synth SFX (design.md §8). No external audio assets.
 *
 * The AudioContext is created lazily on the first user gesture (call
 * `AudioBus.unlock()` from a click handler — the title screen does this).
 * Every play*() is safe to call before unlock; it no-ops until ready.
 */

type OscType = OscillatorType

class AudioBusImpl {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private unlocked = false

  /** create/resume the context — call from a user gesture */
  unlock() {
    if (!this.ctx) {
      const AC: typeof AudioContext | undefined =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!AC) return
      this.ctx = new AC()
      this.master = this.ctx.createGain()
      this.master.gain.value = 0.5
      this.master.connect(this.ctx.destination)
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume()
    this.unlocked = true
  }

  get ready() {
    return this.unlocked && this.ctx !== null && this.ctx.state === 'running'
  }

  setMasterVolume(v: number) {
    if (this.master && this.ctx) this.master.gain.setValueAtTime(v, this.ctx.currentTime)
  }

  // -- primitives -------------------------------------------------------------

  private osc(type: OscType, freq: number, t0: number, dur: number, gainPeak: number): OscillatorNode | null {
    if (!this.ctx || !this.master) return null
    const o = this.ctx.createOscillator()
    const g = this.ctx.createGain()
    o.type = type
    o.frequency.setValueAtTime(freq, t0)
    g.gain.setValueAtTime(0, t0)
    g.gain.linearRampToValueAtTime(gainPeak, t0 + 0.005)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    o.connect(g).connect(this.master)
    o.start(t0)
    o.stop(t0 + dur + 0.05)
    return o
  }

  private noise(dur: number, t0: number, gainPeak: number, filterFreq: number, filterType: BiquadFilterType = 'bandpass') {
    if (!this.ctx || !this.master) return
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur))
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate)
    const data = buf.getChannelData(0)
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
    const src = this.ctx.createBufferSource()
    src.buffer = buf
    const filt = this.ctx.createBiquadFilter()
    filt.type = filterType
    filt.frequency.setValueAtTime(filterFreq, t0)
    const g = this.ctx.createGain()
    g.gain.setValueAtTime(gainPeak, t0)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    src.connect(filt).connect(g).connect(this.master)
    src.start(t0)
    src.stop(t0 + dur + 0.05)
  }

  private now(): number | null {
    return this.ready && this.ctx ? this.ctx.currentTime : null
  }

  // -- SFX vocabulary (design.md §8) --------------------------------------------

  /** rifle zap — filtered noise burst + saw drop */
  playRifle() {
    const t = this.now()
    if (t === null) return
    this.noise(0.07, t, 0.25, 3200)
    const o = this.osc('sawtooth', 880, t, 0.09, 0.12)
    o?.frequency.exponentialRampToValueAtTime(140, t + 0.09)
  }

  /** katana shing — metallic FM sweep */
  playKatana() {
    const t = this.now()
    if (t === null || !this.ctx || !this.master) return
    const carrier = this.ctx.createOscillator()
    const mod = this.ctx.createOscillator()
    const modGain = this.ctx.createGain()
    const g = this.ctx.createGain()
    carrier.type = 'triangle'
    carrier.frequency.setValueAtTime(2400, t)
    carrier.frequency.exponentialRampToValueAtTime(420, t + 0.22)
    mod.type = 'square'
    mod.frequency.setValueAtTime(1337, t)
    modGain.gain.setValueAtTime(900, t)
    modGain.gain.exponentialRampToValueAtTime(60, t + 0.22)
    mod.connect(modGain).connect(carrier.frequency)
    g.gain.setValueAtTime(0.16, t)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28)
    carrier.connect(g).connect(this.master)
    carrier.start(t)
    mod.start(t)
    carrier.stop(t + 0.3)
    mod.stop(t + 0.3)
  }

  /** ability choir — detuned sine stack with a slow swell */
  playAbility() {
    const t = this.now()
    if (t === null || !this.ctx || !this.master) return
    const base = 220
    const detunes = [0, 3, -4, 7, 12] // cents-ish multipliers below
    const ratios = [1, 1.5, 2, 2.5, 3]
    detunes.forEach((d, i) => {
      const o = this.ctx!.createOscillator()
      const g = this.ctx!.createGain()
      o.type = 'sine'
      o.frequency.setValueAtTime(base * ratios[i] * (1 + d / 1200), t)
      const peak = 0.05 / (i * 0.6 + 1)
      g.gain.setValueAtTime(0, t)
      g.gain.linearRampToValueAtTime(peak, t + 0.25)
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1)
      o.connect(g).connect(this.master!)
      o.start(t)
      o.stop(t + 1.2)
    })
  }

  /** ultimate — deep boom under the choir */
  playUltimate() {
    const t = this.now()
    if (t === null) return
    this.playAbility()
    const o = this.osc('sine', 110, t, 1.4, 0.3)
    o?.frequency.exponentialRampToValueAtTime(36, t + 1.2)
    this.noise(0.9, t, 0.12, 500, 'lowpass')
  }

  /** hit confirm — short tick */
  playHit() {
    const t = this.now()
    if (t === null) return
    this.noise(0.04, t, 0.2, 2200, 'highpass')
    const o = this.osc('square', 620, t, 0.05, 0.08)
    o?.frequency.exponentialRampToValueAtTime(320, t + 0.05)
  }

  /** player hurt — low thud */
  playHurt() {
    const t = this.now()
    if (t === null) return
    const o = this.osc('sawtooth', 160, t, 0.18, 0.18)
    o?.frequency.exponentialRampToValueAtTime(60, t + 0.18)
    this.noise(0.12, t, 0.12, 300, 'lowpass')
  }

  /** enemy chirp — Cadence teal blip */
  playEnemyChirp() {
    const t = this.now()
    if (t === null) return
    const o = this.osc('sine', 1200, t, 0.12, 0.07)
    o?.frequency.setValueAtTime(1200, t)
    o?.frequency.exponentialRampToValueAtTime(1800, t + 0.05)
    o?.frequency.exponentialRampToValueAtTime(900, t + 0.12)
  }

  /** shield break — glassy crunch */
  playShieldBreak() {
    const t = this.now()
    if (t === null) return
    this.noise(0.25, t, 0.2, 4200, 'highpass')
    const o = this.osc('triangle', 1900, t, 0.2, 0.1)
    o?.frequency.exponentialRampToValueAtTime(300, t + 0.2)
  }

  /** reload click-clack */
  playReload() {
    const t = this.now()
    if (t === null) return
    this.noise(0.03, t, 0.15, 1800, 'bandpass')
    this.noise(0.04, t + 0.12, 0.15, 1200, 'bandpass')
  }

  /** jump / dash whoosh */
  playWhoosh() {
    const t = this.now()
    if (t === null || !this.ctx || !this.master) return
    this.noise(0.3, t, 0.1, 800, 'bandpass')
  }

  /** UI click — tiny gold tick */
  playUIClick() {
    const t = this.now()
    if (t === null) return
    const o = this.osc('sine', 1560, t, 0.06, 0.09)
    o?.frequency.exponentialRampToValueAtTime(1040, t + 0.06)
  }
}

/** Global audio singleton. */
export const AudioBus = new AudioBusImpl()

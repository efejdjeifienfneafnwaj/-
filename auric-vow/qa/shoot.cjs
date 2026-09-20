/* eslint-disable */
/**
 * AURIC VOW — headless capture harness.
 *
 * Serves ./dist, opens it with ?qa=1 (pins quality tier 0 and enables the
 * QaBridge), pins a fixed per-frame delta so animation-heavy moments are
 * reproducible on a software renderer, and captures a fixed shot list for the
 * visual-review loop.
 *
 *   node qa/shoot.cjs [outDir] [port]
 *   env: SHOT_W, SHOT_H, FIXED_DT
 */
const path = require('path')
const fs = require('fs')
const http = require('http')
/**
 * Resolve Playwright and a browser binary that actually exists on disk.
 * A project-local Playwright may be a different version from the one whose
 * browsers are installed under /opt/pw-browsers, in which case it looks for a
 * revision that was never downloaded. Prefer the global install, and pin the
 * executable path as a second line of defence.
 */
function resolvePlaywright() {
  const candidates = ['/opt/node22/lib/node_modules/playwright', 'playwright']
  for (const c of candidates) {
    try {
      return require(c)
    } catch (e) {
      /* try the next one */
    }
  }
  throw new Error('playwright not found')
}
const { chromium } = resolvePlaywright()
const fsx = require('fs')
const CHROME_CANDIDATES = [
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  '/opt/pw-browsers/chromium/chrome-linux/chrome',
]
const CHROME = CHROME_CANDIDATES.find((p) => fsx.existsSync(p))

const OUT = path.resolve(process.argv[2] || 'qa/shots')
const PORT = Number(process.argv[3] || 8137)
const DIST = path.resolve(__dirname, '..', 'dist')
const W = Number(process.env.SHOT_W || 1280)
const H = Number(process.env.SHOT_H || 720)
const DT = Number(process.env.FIXED_DT || 1 / 30)
/** QUICK=1 keeps only the frames that decide the look, for fast verify rounds */
const QUICK = process.env.QUICK === '1'
const QUICK_KEEP = new Set(['02_spawn', '03_sprint', '07_chamber', '08_enemies', '09_rifle', '15_ultimate_peak', '17_katana', '18_arena_wide'])

const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json', '.woff2': 'font/woff2', '.woff': 'font/woff', '.svg': 'image/svg+xml' }
function serve() {
  return new Promise((res) => {
    const srv = http.createServer((req, r) => {
      let p = decodeURIComponent(req.url.split('?')[0])
      if (p === '/') p = '/index.html'
      const f = path.join(DIST, p)
      if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end() }
      r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' })
      fs.createReadStream(f).pipe(r)
    })
    srv.listen(PORT, () => res(srv))
  })
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  const srv = await serve()
  const browser = await chromium.launch({
    ...(CHROME ? { executablePath: CHROME } : {}),
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'],
  })
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 })
  const page = await ctx.newPage()
  await page.route(/^https?:\/\/(?!localhost)/, (r) => r.abort())
  const errors = []
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 300)) })

  await page.goto(`http://localhost:${PORT}/?qa=1`, { waitUntil: 'load' })
  await page.waitForFunction(() => !!window.__qa && !!window.__qa.gl, null, { timeout: 90000 })

  /** render exactly n frames (fixed dt → n*DT seconds of game time) */
  const step = (n = 1) => page.evaluate((n) => new Promise((res) => {
    let c = 0
    const f = () => { c++; c >= n ? res(true) : requestAnimationFrame(f) }
    requestAnimationFrame(f)
  }), n)

  const shots = []
  /**
   * A frame whose 3D layer failed to paint compresses to a small fraction of a
   * real render, because only the flat HUD survives. Round 3 banked four such
   * frames as clean passes. Reject anything suspiciously small, step the clock
   * and shoot again; report a frame that never recovers rather than keeping it.
   */
  const MIN_RENDER_BYTES = 150 * 1024
  const blankFrames = []
  const snap = async (name, note) => {
    if (QUICK && !QUICK_KEEP.has(name)) { console.log('skip', name); return }
    const file = path.join(OUT, name + '.png')
    let bytes = 0
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await step(2)
      await page.screenshot({ path: file, timeout: 180000 })
      bytes = fs.statSync(file).size
      if (bytes >= MIN_RENDER_BYTES) break
      console.log('retry', name, '- only', bytes, 'bytes, 3D layer probably did not paint')
    }
    if (bytes < MIN_RENDER_BYTES) {
      blankFrames.push({ name, bytes })
      console.log('BLANK', name, bytes, 'bytes after 3 attempts')
    }
    shots.push({ name, note, bytes })
    console.log('shot', name, '-', note)
  }

  /** retune the fixed step: short-lived flashes need a fine step to be caught,
   *  long effects need a coarse one so the shot does not cost minutes */
  const setDt = (dt) => page.evaluate((dt) => window.__qa.setFixedDt(dt), dt)
  await setDt(DT)
  await step(4)
  await snap('01_title', 'title screen over the live world backdrop')

  // engage
  await page.mouse.click(W / 2, H / 2)
  await step(2)
  await page.evaluate(() => window.__qa.setPhase('INFILTRATE'))
  await step(6)
  await snap('02_spawn', 'third-person view at the spawn dais looking down the canyon')

  // traversal: sprint down the canyon
  await page.keyboard.down('ShiftLeft'); await page.keyboard.down('KeyW')
  await step(20)
  await snap('03_sprint', 'sprinting down the traversal canyon')
  await page.keyboard.press('Space'); await step(4)
  await snap('04_air', 'mid-air after a jump (glide/air control)')
  await page.keyboard.up('KeyW'); await page.keyboard.up('ShiftLeft')

  // wall-run: park the player against the B2 west slab and run along it
  await page.evaluate(() => { window.__qa.teleport(-1.2, 2.5, 50); window.__qa.lookAt(-1.2, 3.5, 64) })
  await step(3)
  await page.keyboard.down('KeyW'); await page.keyboard.press('Space')
  await step(10)
  await snap('05_wallrun', 'wall-run along the gold-veined canyon slab')
  await page.keyboard.up('KeyW')

  // slide
  await page.evaluate(() => { window.__qa.teleport(0, 0.2, 145); window.__qa.lookAt(0, 1.5, 160) })
  await step(3)
  await page.keyboard.down('ShiftLeft'); await page.keyboard.down('KeyW'); await step(8)
  await page.keyboard.down('ControlLeft'); await step(5)
  await snap('06_slide', 'power slide across the reliquary chamber floor')
  await page.keyboard.up('ControlLeft'); await page.keyboard.up('KeyW'); await page.keyboard.up('ShiftLeft')

  // chamber / objective hero shot
  await page.evaluate(() => { window.__qa.teleport(0, 0.2, 142); window.__qa.lookAt(0, 4, 152) })
  await step(6)
  await snap('07_chamber', 'the Null Reliquary chamber (mission objective)')

  // arena + enemies
  await page.evaluate(() => { window.__qa.setPhase('EXTERMINATE'); window.__qa.grantEnergy(); window.__qa.teleport(0, 0.2, 180) })
  await step(30)

  /**
   * Stand the player a fixed distance from a live GROUND enemy and aim at its
   * chest, so combat frames actually contain a target. Aiming at the nearest
   * enemy without this puts high-hovering drones (and therefore empty sky) in
   * frame, which is what round 1 captured.
   */
  const frameEnemy = (standoff = 11) =>
    page.evaluate((standoff) => {
      const p = window.__playerRef.position
      const all = window.__qa.enemyPositions().filter((e) => e[2])
      if (!all.length) return null
      // ground troops only: a drone hovering overhead puts empty sky in frame
      const ground = all.filter((e) => e[3][1] < 2.5)
      const es = ground.length ? ground : all
      es.sort(
        (a, b) =>
          Math.hypot(a[3][0] - p.x, a[3][2] - p.z) - Math.hypot(b[3][0] - p.x, b[3][2] - p.z),
      )
      const e = es[0]
      const [ex, ey, ez] = e[3]
      const dx = p.x - ex, dz = p.z - ez
      const len = Math.hypot(dx, dz) || 1
      window.__qa.teleport(ex + (dx / len) * standoff, 0.2, ez + (dz / len) * standoff)
      window.__qa.lookAt(ex, ey + 1.1, ez)
      // remember the target so the aim can be re-applied right before the
      // shutter: the player settles onto the floor over the following frames
      // and the camera boom drifts off the target if it is aimed only once
      window.__qaTarget = [ex, ey + 1.1, ez]
      return { count: all.length, ground: ground.length, target: e, standoff }
    }, standoff)

  /** re-apply the aim at the remembered target, immediately before a shot */
  const reaim = () =>
    page.evaluate(() => {
      const t = window.__qaTarget
      if (t) window.__qa.lookAt(t[0], t[1], t[2])
    })

  const aimed = await frameEnemy(11)
  await step(6)
  await reaim(); await step(1); await snap('08_enemies', 'combat arena framed on a live ground enemy: ' + JSON.stringify(aimed && aimed.count))

  // rifle fire — fine step so the muzzle flash and tracers are caught mid-life
  await frameEnemy(11)
  await step(2)
  await setDt(1 / 90)
  await page.mouse.down(); await step(3)
  await reaim(); await step(1); await snap('09_rifle', 'rifle firing: muzzle flash, tracers, impacts')
  await step(8)
  await reaim(); await step(1); await snap('10_rifle_hits', 'sustained fire with hit feedback and damage numbers')
  await page.mouse.up()
  await setDt(DT)
  await step(2)

  // abilities
  await frameEnemy(13)
  await page.keyboard.press('Digit1'); await step(2)
  await reaim(); await step(1); await snap('11_ability_dash', 'Gilt Dash (Q): blink-dash with afterimages')
  await step(6)
  await page.evaluate(() => window.__qa.grantEnergy())
  await frameEnemy(14)
  await page.keyboard.press('Digit2'); await step(3)
  await reaim(); await step(1); await snap('12_ability_volley', 'Sunspike Volley (E): homing javelin fan')
  await step(6)
  await page.evaluate(() => window.__qa.grantEnergy())
  await frameEnemy(11)
  await page.keyboard.press('Digit3'); await step(3)
  await reaim(); await step(1); await snap('13_ability_halo', 'Aegis Halo (1): ringed gold barrier')
  await step(6)
  await page.evaluate(() => window.__qa.grantEnergy())
  await frameEnemy(9)
  await setDt(1 / 45)
  await page.keyboard.press('Digit4'); await step(3)
  await reaim(); await step(1); await snap('14_ultimate_start', 'Auric Requiem (4): nova ignition')
  await step(6)
  await reaim(); await step(1); await snap('15_ultimate_peak', 'Auric Requiem at full expansion with slow-mo grade')
  await step(12)
  await reaim(); await step(1); await snap('16_ultimate_fade', 'Auric Requiem dissipating')

  // melee
  await frameEnemy(2.6)
  await setDt(1 / 60)
  await step(2)
  await page.keyboard.press('KeyF'); await step(3)
  await reaim(); await step(1); await snap('17_katana', 'katana slash arc')

  await setDt(DT)

  // wide environment / composition shots
  await page.evaluate(() => { window.__qa.teleport(-20, 0.2, 172); window.__qa.lookAt(6, 3, 205) })
  await step(5)
  await snap('18_arena_wide', 'arena across the floor: composition, depth, silhouette')
  // Vantage points are measured, not guessed: the camera boom can push the
  // lens through the ceiling from a high perch, and the frame then renders
  // nothing. Probing this view at several heights, y=9 puts the lens at 11.7 m
  // and renders black, while y=2 puts it at 3.3 m and renders at 1.2 MB.
  await page.evaluate(() => { window.__qa.teleport(0, 2, 118); window.__qa.lookAt(0, 4, 140) })
  await step(5)
  await snap('19_canyon_wide', 'canyon looking toward the chamber gate')
  await page.evaluate(() => { window.__qa.teleport(0, 3, 240); window.__qa.lookAt(0, 6, 262) })
  await step(5)
  await snap('20_extraction', 'extraction bridge and pad')
  // Same reason: aiming steeply up swings the boom under the deck and the
  // frame goes black. A shallower look keeps the lens in the room and still
  // shows the sky through the canyon opening.
  await page.evaluate(() => { window.__qa.teleport(0, 2, 60); window.__qa.lookAt(0, 12, 92) })
  await step(5)
  await snap('21_skybox', 'sky and distant station silhouettes above the canyon')

  const st = await page.evaluate(() => {
    const s = window.__gameStore.getState()
    const g = window.__qa.gl
    return { phase: s.phase, hp: s.hp, shield: s.shield, energy: s.energy, kills: s.kills, tier: s.qualityTier, programs: g.info.programs.length, textures: g.info.memory.textures, geometries: g.info.memory.geometries }
  })
  fs.writeFileSync(path.join(OUT, 'state.json'), JSON.stringify({ state: st, aimed, shots, viewport: [W, H], fixedDt: DT }, null, 2))
  if (blankFrames.length) {
    errors.push('BLANK FRAMES (3D layer did not paint): ' + blankFrames.map((b) => b.name + ' ' + b.bytes + 'B').join(', '))
  }
  fs.writeFileSync(path.join(OUT, 'errors.log'), errors.join('\n'))
  console.log('state', JSON.stringify(st))
  console.log('errors', errors.length, 'blank', blankFrames.length)
  await browser.close(); srv.close()
}
main().catch((e) => { console.error(e); process.exit(1) })

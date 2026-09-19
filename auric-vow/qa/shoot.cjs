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
const { chromium } = require('playwright')

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
  const snap = async (name, note) => {
    if (QUICK && !QUICK_KEEP.has(name)) { console.log('skip', name); return }
    await page.screenshot({ path: path.join(OUT, name + '.png'), timeout: 180000 })
    shots.push({ name, note })
    console.log('shot', name, '-', note)
  }

  await page.evaluate((dt) => window.__qa.setFixedDt(dt), DT)
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
  const aimed = await page.evaluate(() => {
    const p = window.__playerRef.position
    const es = window.__qa.enemyPositions().filter((e) => e[2])
    if (!es.length) return null
    es.sort((a, b) => Math.hypot(a[3][0] - p.x, a[3][2] - p.z) - Math.hypot(b[3][0] - p.x, b[3][2] - p.z))
    const e = es[0]
    window.__qa.lookAt(e[3][0], e[3][1] + 1.2, e[3][2])
    return { count: es.length, target: e }
  })
  await step(4)
  await snap('08_enemies', 'combat arena with live enemies: ' + JSON.stringify(aimed && aimed.count))

  // rifle fire
  await page.mouse.down(); await step(5)
  await snap('09_rifle', 'rifle firing: muzzle flash, tracers, impacts')
  await step(8)
  await snap('10_rifle_hits', 'sustained fire with hit feedback and damage numbers')
  await page.mouse.up(); await step(2)

  // abilities
  await page.keyboard.press('KeyQ'); await step(3)
  await snap('11_ability_dash', 'Gilt Dash (Q): blink-dash with afterimages')
  await step(6)
  await page.evaluate(() => window.__qa.grantEnergy())
  await page.keyboard.press('KeyE'); await step(4)
  await snap('12_ability_volley', 'Sunspike Volley (E): homing javelin fan')
  await step(6)
  await page.evaluate(() => window.__qa.grantEnergy())
  await page.keyboard.press('Digit1'); await step(4)
  await snap('13_ability_halo', 'Aegis Halo (1): ringed gold barrier')
  await step(6)
  await page.evaluate(() => window.__qa.grantEnergy())
  await page.keyboard.press('Digit4'); await step(3)
  await snap('14_ultimate_start', 'Auric Requiem (4): nova ignition')
  await step(6)
  await snap('15_ultimate_peak', 'Auric Requiem at full expansion with slow-mo grade')
  await step(12)
  await snap('16_ultimate_fade', 'Auric Requiem dissipating')

  // melee
  await page.evaluate(() => {
    const p = window.__playerRef.position
    const es = window.__qa.enemyPositions().filter((e) => e[2])
    if (es.length) {
      es.sort((a, b) => Math.hypot(a[3][0] - p.x, a[3][2] - p.z) - Math.hypot(b[3][0] - p.x, b[3][2] - p.z))
      const e = es[0]
      window.__qa.teleport(e[3][0] - 2.5, e[3][1], e[3][2])
      window.__qa.lookAt(e[3][0], e[3][1] + 1.2, e[3][2])
    }
  })
  await step(3)
  await page.keyboard.press('KeyF'); await step(3)
  await snap('17_katana', 'katana slash arc')

  // wide environment / composition shots
  await page.evaluate(() => { window.__qa.teleport(-22, 6.5, 172); window.__qa.lookAt(6, 2, 205) })
  await step(5)
  await snap('18_arena_wide', 'arena from the upper gallery: composition, depth, silhouette')
  await page.evaluate(() => { window.__qa.teleport(0, 9, 118); window.__qa.lookAt(0, 4, 140) })
  await step(5)
  await snap('19_canyon_wide', 'canyon from the high ledge toward the chamber gate')
  await page.evaluate(() => { window.__qa.teleport(0, 3, 240); window.__qa.lookAt(0, 6, 262) })
  await step(5)
  await snap('20_extraction', 'extraction bridge and pad')
  await page.evaluate(() => { window.__qa.teleport(0, 2, 60); window.__qa.lookAt(0, 30, 90) })
  await step(5)
  await snap('21_skybox', 'sky / void backdrop and distant station silhouettes')

  const st = await page.evaluate(() => {
    const s = window.__gameStore.getState()
    const g = window.__qa.gl
    return { phase: s.phase, hp: s.hp, shield: s.shield, energy: s.energy, kills: s.kills, tier: s.qualityTier, programs: g.info.programs.length, textures: g.info.memory.textures, geometries: g.info.memory.geometries }
  })
  fs.writeFileSync(path.join(OUT, 'state.json'), JSON.stringify({ state: st, aimed, shots, viewport: [W, H], fixedDt: DT }, null, 2))
  fs.writeFileSync(path.join(OUT, 'errors.log'), errors.join('\n'))
  console.log('state', JSON.stringify(st))
  console.log('errors', errors.length)
  await browser.close(); srv.close()
}
main().catch((e) => { console.error(e); process.exit(1) })

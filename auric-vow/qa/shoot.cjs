/* eslint-disable */
/**
 * Headless screenshot harness for AURIC VOW.
 * Usage: node qa/shoot.cjs [outDir] [port]
 * Serves ./dist statically, drives the game via window.__qa, captures
 * a fixed set of gameplay shots for the AAA critic loop.
 */
const path = require('path')
const fs = require('fs')
const http = require('http')
const { chromium } = require('playwright')

const OUT = path.resolve(process.argv[2] || 'qa/shots')
const PORT = Number(process.argv[3] || 8137)
const DIST = path.resolve(__dirname, '..', 'dist')
const W = Number(process.env.SHOT_W || 1280), H = Number(process.env.SHOT_H || 720)

const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' }
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
    executablePath: fs.existsSync('/opt/pw-browsers/chromium') ? undefined : undefined,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'],
  })
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 })
  const page = await ctx.newPage()
  await page.route(/^https?:\/\/(?!localhost)/, (r) => r.abort())
  const errors = []
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text().slice(0, 300)) })
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' })
  await page.waitForFunction(() => !!window.__qa, null, { timeout: 60000 })
  await page.waitForTimeout(1500)
  const snap = async (name) => { await page.screenshot({ path: path.join(OUT, name + '.png'), timeout: 180000 }); console.log('shot', name) }

  const fpsProbe = () => page.evaluate(() => new Promise((res) => { let n = 0; const s = performance.now(); const f = () => { n++; if (performance.now() - s > 3000) res(n / ((performance.now() - s) / 1000)); else requestAnimationFrame(f) }; requestAnimationFrame(f) }))
  const fpsTitle = await fpsProbe()
  await snap('01_title')
  // engage
  await page.mouse.click(W / 2, H / 2)
  await page.waitForTimeout(500)
  await page.evaluate(() => window.__qa.setPhase('INFILTRATE'))
  await page.waitForTimeout(2500)
  await snap('02_infiltrate_start')

  // sprint forward
  await page.keyboard.down('KeyW'); await page.keyboard.down('ShiftLeft')
  await page.waitForTimeout(1800)
  await snap('03_sprint')
  await page.keyboard.press('Space')
  await page.waitForTimeout(350)
  await snap('04_jump')
  await page.keyboard.up('ShiftLeft'); await page.keyboard.up('KeyW')

  // combat: jump to exterminate, look at nearest enemy
  await page.evaluate(() => { window.__qa.setPhase('EXTERMINATE'); window.__qa.grantEnergy() })
  await page.waitForTimeout(2500)
  const aimed = await page.evaluate(() => {
    const p = window.__playerRef.position
    const es = window.__qa.enemyPositions().filter((e) => e[2])
    if (!es.length) return null
    es.sort((a, b) => Math.hypot(a[3][0]-p.x, a[3][2]-p.z) - Math.hypot(b[3][0]-p.x, b[3][2]-p.z))
    const e = es[0]
    window.__qa.lookAt(e[3][0], e[3][1] + 1, e[3][2])
    return e
  })
  console.log('aimed at', JSON.stringify(aimed))
  await page.waitForTimeout(400)
  await snap('05_enemies')
  await page.mouse.down(); await page.waitForTimeout(250)
  await snap('06_fire')
  await page.waitForTimeout(400)
  await snap('07_fire_hits')
  await page.mouse.up()
  await page.keyboard.press('KeyQ'); await page.waitForTimeout(300)
  await snap('08_ability1')
  await page.keyboard.press('KeyE'); await page.waitForTimeout(300)
  await snap('09_ability2')
  await page.evaluate(() => window.__qa.grantEnergy())
  await page.keyboard.press('Digit4'); await page.waitForTimeout(500)
  await snap('10_ultimate')
  await page.waitForTimeout(1200)
  await snap('11_ultimate_late')
  await page.keyboard.press('KeyF'); await page.waitForTimeout(200)
  await snap('12_melee')

  // look around environment
  await page.evaluate(() => { const p = window.__playerRef.position; window.__qa.lookAt(p.x, p.y + 12, p.z + 30) })
  await page.waitForTimeout(400)
  await snap('13_env_up')

  const fpsGame = await fpsProbe()
  const st = await page.evaluate(() => { const s = window.__gameStore.getState(); return { phase: s.phase, hp: s.health, shield: s.shield, energy: s.energy, tier: s.qualityTier } })
  console.log('state', JSON.stringify(st))
  console.log('fps title/game (swiftshader, relative only)', fpsTitle.toFixed(2), fpsGame.toFixed(2))
  fs.writeFileSync(path.join(OUT, 'state.json'), JSON.stringify({ ...st, fpsTitle, fpsGame, aimed }, null, 2))
  fs.writeFileSync(path.join(OUT, 'errors.log'), errors.join('\n'))
  console.log('errors:', errors.length)
  await browser.close(); srv.close()
}
main().catch((e) => { console.error(e); process.exit(1) })

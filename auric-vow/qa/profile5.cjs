/* eslint-disable */
/** JS CPU profile over N gameplay frames: self time by function, and time inside three's render vs game code. */
const path = require('path'), fs = require('fs'), http = require('http')
function rp() { for (const c of ['/opt/node22/lib/node_modules/playwright', 'playwright']) { try { return require(c) } catch (e) {} } throw new Error('no playwright') }
const { chromium } = rp()
const CHROME = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find((p) => fs.existsSync(p))
const DIST = path.resolve(process.env.DIST || path.join(__dirname, '..', 'dist'))
const PORT = Number(process.argv[2] || 8265)
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.woff': 'font/woff' }
const srv = http.createServer((q, r) => { let p = q.url.split('?')[0]; if (p === '/') p = '/index.html'; const f = path.join(DIST, p); if (!fs.existsSync(f)) { r.writeHead(404); return r.end() } r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r) }).listen(PORT)
;(async () => {
  const b = await chromium.launch({ executablePath: CHROME, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--disable-dev-shm-usage'] })
  const ctx = await b.newContext({ viewport: { width: 320, height: 180 } })
  const page = await ctx.newPage()
  await page.route(/^https?:\/\/(?!localhost)/, (r) => r.abort())
  await page.goto(`http://localhost:${PORT}/?qa=1`)
  await page.waitForFunction(() => !!window.__qa && !!window.__qa.gl, null, { timeout: 180000 })
  const step = (n) => page.evaluate((n) => new Promise((res) => { let c = 0; const f = () => { c++; c >= n ? res(1) : requestAnimationFrame(f) }; requestAnimationFrame(f) }), n)
  await page.mouse.click(160, 90); await step(2)
  await page.evaluate(() => { window.__qa.setFixedDt(1 / 30); window.__qa.setPhase('EXTERMINATE') })
  await step(90)
  await page.evaluate(() => { window.__qa.teleport(0, 0.2, 180); window.__qa.lookAt(0, 1.5, 210) })
  await step(6)
  const cdp = await ctx.newCDPSession(page)
  await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 })
  await cdp.send('Profiler.start')
  const t0 = Date.now(); await step(20); const wall = Date.now() - t0
  const { profile } = await cdp.send('Profiler.stop')
  const byId = new Map(profile.nodes.map((n) => [n.id, n]))
  const dt = profile.timeDeltas, samples = profile.samples
  const self = new Map()
  let total = 0
  for (let i = 0; i < samples.length; i++) {
    const n = byId.get(samples[i]); const d = dt[i] || 0; total += d
    const cf = n.callFrame
    const k = `${cf.functionName || '(anon)'} ${path.basename(cf.url || '')}:${cf.lineNumber}`
    self.set(k, (self.get(k) || 0) + d)
  }
  console.log('wall ms for 20 frames', wall, ' profiled ms', (total / 1000).toFixed(0))
  const top = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30)
  for (const [k, v] of top) console.log(((v / total) * 100).toFixed(1).padStart(5) + '%', (v / 1000 / 20).toFixed(1).padStart(7) + ' ms/frame', k)
  await b.close(); srv.close()
})().catch((e) => { console.error(e); process.exit(1) })

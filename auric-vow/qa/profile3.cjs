/* eslint-disable */
/** Per-pass draw-call and triangle split, averaged over several frames. */
const path = require('path'), fs = require('fs'), http = require('http')
function rp() { for (const c of ['/opt/node22/lib/node_modules/playwright', 'playwright']) { try { return require(c) } catch (e) {} } throw new Error('no playwright') }
const { chromium } = rp()
const CHROME = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find((p) => fs.existsSync(p))
const DIST = path.resolve(process.env.DIST || path.join(__dirname, '..', 'dist'))
const PORT = Number(process.argv[2] || 8262)
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.woff': 'font/woff' }
const srv = http.createServer((q, r) => { let p = q.url.split('?')[0]; if (p === '/') p = '/index.html'; const f = path.join(DIST, p); if (!fs.existsSync(f)) { r.writeHead(404); return r.end() } r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r) }).listen(PORT)
;(async () => {
  const b = await chromium.launch({ executablePath: CHROME, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--disable-dev-shm-usage'] })
  const page = await (await b.newContext({ viewport: { width: 640, height: 360 } })).newPage()
  await page.route(/^https?:\/\/(?!localhost)/, (r) => r.abort())
  await page.goto(`http://localhost:${PORT}/?qa=1`)
  await page.waitForFunction(() => !!window.__qa && !!window.__qa.gl, null, { timeout: 180000 })
  const step = (n) => page.evaluate((n) => new Promise((res) => { let c = 0; const f = () => { c++; c >= n ? res(1) : requestAnimationFrame(f) }; requestAnimationFrame(f) }), n)
  await page.mouse.click(320, 180); await step(2)
  await page.evaluate(() => {
    window.__qa.setFixedDt(1 / 30); window.__qa.setPhase('EXTERMINATE')
    const gl = window.__qa.gl
    const acc = (window.__passAcc = { shadowCalls: 0, shadowTris: 0, totalCalls: 0, totalTris: 0, frames: 0 })
    gl.info.autoReset = false
    const orig = gl.shadowMap.render.bind(gl.shadowMap)
    gl.shadowMap.render = function (...a) {
      const c0 = gl.info.render.calls, t0 = gl.info.render.triangles
      orig(...a)
      acc.shadowCalls += gl.info.render.calls - c0
      acc.shadowTris += gl.info.render.triangles - t0
    }
    const tick = () => { acc.totalCalls += gl.info.render.calls; acc.totalTris += gl.info.render.triangles; acc.frames++; gl.info.reset(); requestAnimationFrame(tick) }
    gl.info.reset(); requestAnimationFrame(tick)
  })
  await step(90) // past chunking
  const spot = async (label, x, y, z, lx, ly, lz) => {
    await page.evaluate(([x, y, z, lx, ly, lz]) => { window.__qa.teleport(x, y, z); window.__qa.lookAt(lx, ly, lz) }, [x, y, z, lx, ly, lz])
    await step(4)
    await page.evaluate(() => { const a = window.__passAcc; a.shadowCalls = a.shadowTris = a.totalCalls = a.totalTris = a.frames = 0 })
    await step(20)
    const a = await page.evaluate(() => ({ ...window.__passAcc }))
    const pf = (v) => Math.round(v / a.frames)
    console.log(label.padEnd(8), 'per frame: calls', pf(a.totalCalls), '(shadow', pf(a.shadowCalls) + ', main+post', pf(a.totalCalls - a.shadowCalls) + ')   tris', pf(a.totalTris), '(shadow', pf(a.shadowTris) + ')')
  }
  await spot('canyon', 0, 0.2, 40, 0, 1.5, 70)
  await spot('chamber', 0, 0.2, 142, 0, 3, 152)
  await spot('arena', 0, 0.2, 180, 0, 1.5, 210)
  console.log('perf', JSON.stringify(await page.evaluate(() => window.__qa.perf || null)))
  await b.close(); srv.close()
})().catch((e) => { console.error(e); process.exit(1) })

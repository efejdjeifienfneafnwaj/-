/* eslint-disable */
/** Main-thread CPU per frame: whole rAF callback, time inside renderer.render, time inside shadow render. node qa/profile7.cjs <dist> <port> [query] */
const path = require('path'), fs = require('fs'), http = require('http')
function rp() { for (const c of ['/opt/node22/lib/node_modules/playwright', 'playwright']) { try { return require(c) } catch (e) {} } throw new Error('no playwright') }
const { chromium } = rp()
const CHROME = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find((p) => fs.existsSync(p))
const DIST = path.resolve(process.argv[2]), PORT = Number(process.argv[3] || 8330), QUERY = process.argv[4] || ''
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.woff': 'font/woff' }
const srv = http.createServer((q, r) => { let p = q.url.split('?')[0]; if (p === '/') p = '/index.html'; const f = path.join(DIST, p); if (!fs.existsSync(f)) { r.writeHead(404); return r.end() } r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r) }).listen(PORT)
;(async () => {
  const b = await chromium.launch({ executablePath: CHROME, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--disable-dev-shm-usage'] })
  const page = await (await b.newContext({ viewport: { width: 320, height: 180 } })).newPage()
  await page.route(/^https?:\/\/(?!localhost)/, (r) => r.abort())
  await page.addInitScript(() => {
    const acc = (window.__cpu = { raf: 0, frames: 0, render: 0, shadow: 0, on: false })
    const orig = window.requestAnimationFrame.bind(window)
    window.requestAnimationFrame = (cb) => orig((t) => { const t0 = performance.now(); try { cb(t) } finally { if (acc.on) acc.raf += performance.now() - t0 } })
  })
  await page.goto(`http://localhost:${PORT}/?qa=1${QUERY}`)
  await page.waitForFunction(() => !!window.__qa && !!window.__qa.gl, null, { timeout: 180000 })
  const step = (n) => page.evaluate((n) => new Promise((res) => { let c = 0; const f = () => { c++; c >= n ? res(1) : requestAnimationFrame(f) }; requestAnimationFrame(f) }), n)
  await page.evaluate(() => window.__qa.setFixedDt(1 / 30))
  await page.mouse.click(160, 90); await step(2)
  await page.evaluate(() => {
    window.__qa.setPhase('EXTERMINATE')
    const gl = window.__qa.gl, acc = window.__cpu
    const r0 = gl.render.bind(gl); let depth = 0
    gl.render = function (...a) { const t0 = performance.now(); depth++; try { return r0(...a) } finally { depth--; if (acc.on && depth === 0) acc.render += performance.now() - t0 } }
    const s0 = gl.shadowMap.render.bind(gl.shadowMap)
    gl.shadowMap.render = function (...a) { const t0 = performance.now(); try { return s0(...a) } finally { if (acc.on) acc.shadow += performance.now() - t0 } }
  })
  await step(130)
  const res = []
  for (const [label, x, y, z, lx, ly, lz] of [['canyon', 0, 0.2, 40, 0, 1.5, 70], ['chamber', 0, 0.2, 142, 0, 3, 152], ['arena', 0, 0.2, 180, 0, 1.5, 210]]) {
    await page.evaluate(([x, y, z, lx, ly, lz]) => { window.__qa.teleport(x, y, z); window.__qa.lookAt(lx, ly, lz) }, [x, y, z, lx, ly, lz])
    await step(35)
    await page.evaluate(() => { const a = window.__cpu; a.raf = a.render = a.shadow = 0; a.on = true })
    await step(10)
    const a = await page.evaluate(() => { const a = window.__cpu; a.on = false; return { ...a } })
    res.push(`${label}: rAF ${(a.raf / 10).toFixed(1)} ms  (render ${(a.render / 10).toFixed(1)}, of which shadow ${(a.shadow / 10).toFixed(1)}; game+other ${((a.raf - a.render) / 10).toFixed(1)})`)
  }
  console.log(QUERY || 'default'); for (const l of res) console.log('  ' + l)
  await b.close(); srv.close()
})().catch((e) => { console.error(e); process.exit(1) })

/* eslint-disable */
/** Wall-clock ms per frame at three spots (software rasteriser: compare builds, not absolutes). node qa/frametime.cjs <dist> <port> */
const path = require('path'), fs = require('fs'), http = require('http')
function rp() { for (const c of ['/opt/node22/lib/node_modules/playwright', 'playwright']) { try { return require(c) } catch (e) {} } throw new Error('no playwright') }
const { chromium } = rp()
const CHROME = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find((p) => fs.existsSync(p))
const DIST = path.resolve(process.argv[2]), PORT = Number(process.argv[3] || 8310)
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.woff': 'font/woff' }
const srv = http.createServer((q, r) => { let p = q.url.split('?')[0]; if (p === '/') p = '/index.html'; const f = path.join(DIST, p); if (!fs.existsSync(f)) { r.writeHead(404); return r.end() } r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r) }).listen(PORT)
;(async () => {
  const b = await chromium.launch({ executablePath: CHROME, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--disable-dev-shm-usage'] })
  const page = await (await b.newContext({ viewport: { width: 640, height: 360 } })).newPage()
  await page.route(/^https?:\/\/(?!localhost)/, (r) => r.abort())
  await page.goto(`http://localhost:${PORT}/?qa=1`)
  await page.waitForFunction(() => !!window.__qa && !!window.__qa.gl, null, { timeout: 180000 })
  const step = (n) => page.evaluate((n) => new Promise((res) => { let c = 0; const f = () => { c++; c >= n ? res(1) : requestAnimationFrame(f) }; requestAnimationFrame(f) }), n)
  await page.evaluate(() => window.__qa.setFixedDt(1 / 30))
  await page.mouse.click(320, 180); await step(2)
  await page.evaluate(() => window.__qa.setPhase('EXTERMINATE')); await step(130)
  const out = []
  for (const [label, x, y, z, lx, ly, lz] of [['canyon', 0, 0.2, 40, 0, 1.5, 70], ['chamber', 0, 0.2, 142, 0, 3, 152], ['arena', 0, 0.2, 180, 0, 1.5, 210]]) {
    await page.evaluate(([x, y, z, lx, ly, lz]) => { window.__qa.teleport(x, y, z); window.__qa.lookAt(lx, ly, lz) }, [x, y, z, lx, ly, lz])
    await step(35) // past a local-batch rescan
    const t0 = Date.now(); await step(10); out.push(`${label} ${((Date.now() - t0) / 10).toFixed(0)} ms/frame`)
  }
  console.log(path.basename(path.dirname(DIST)) + '/' + path.basename(DIST), out.join('  '))
  await b.close(); srv.close()
})().catch((e) => { console.error(e); process.exit(1) })

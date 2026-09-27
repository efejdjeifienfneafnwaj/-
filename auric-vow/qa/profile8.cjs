/* eslint-disable */
/** GPU time per pass via EXT_disjoint_timer_query_webgl2. node qa/profile8.cjs <dist> <port> <w>x<h> [query] */
const path = require('path'), fs = require('fs'), http = require('http')
function rp() { for (const c of ['/opt/node22/lib/node_modules/playwright', 'playwright']) { try { return require(c) } catch (e) {} } throw new Error('no playwright') }
const { chromium } = rp()
const CHROME = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find((p) => fs.existsSync(p))
const DIST = path.resolve(process.argv[2]), PORT = Number(process.argv[3] || 8340)
const [W, H] = (process.argv[4] || '640x360').split('x').map(Number), QUERY = process.argv[5] || ''
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.woff': 'font/woff' }
const srv = http.createServer((q, r) => { let p = q.url.split('?')[0]; if (p === '/') p = '/index.html'; const f = path.join(DIST, p); if (!fs.existsSync(f)) { r.writeHead(404); return r.end() } r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r) }).listen(PORT)
;(async () => {
  const b = await chromium.launch({ executablePath: CHROME, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--disable-dev-shm-usage'] })
  const page = await (await b.newContext({ viewport: { width: W, height: H } })).newPage()
  await page.route(/^https?:\/\/(?!localhost)/, (r) => r.abort())
  await page.goto(`http://localhost:${PORT}/?qa=1${QUERY}`)
  await page.waitForFunction(() => !!window.__qa && !!window.__qa.gl, null, { timeout: 180000 })
  const step = (n) => page.evaluate((n) => new Promise((res) => { let c = 0; const f = () => { c++; c >= n ? res(1) : requestAnimationFrame(f) }; requestAnimationFrame(f) }), n)
  await page.evaluate(() => window.__qa.setFixedDt(1 / 30))
  await page.mouse.click(W / 2, H / 2); await step(2)
  await page.evaluate(() => {
    window.__qa.setPhase('EXTERMINATE')
    const R = window.__qa.gl, gl = R.getContext(), ext = gl.getExtension('EXT_disjoint_timer_query_webgl2'), main = window.__qa.scene
    const T = (window.__gt = { on: false, pending: [], acc: {}, frames: 0 })
    let cur = null
    const begin = (label) => { if (!T.on) return; const q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q); cur = { q, label } }
    const end = () => { if (!cur) return; gl.endQuery(ext.TIME_ELAPSED_EXT); T.pending.push(cur); cur = null }
    const labelOf = (sc) => {
      if (sc === main) { const t = R.getRenderTarget(); return 'scene' + (T.mainIdx++ === 0 ? '' : '#' + (T.mainIdx - 1)) }
      const m = sc.children && sc.children[0] && sc.children[0].material
      return 'post:' + ((m && (m.name || m.constructor.name)) || sc.type)
    }
    const r0 = R.render.bind(R); let depth = 0
    R.render = function (sc, cam) { if (depth++ === 0) begin(labelOf(sc)); try { return r0(sc, cam) } finally { if (--depth === 0) end() } }
    const s0 = R.shadowMap.render.bind(R.shadowMap)
    R.shadowMap.render = function (...a) { const outer = cur && cur.label; end(); begin('shadowmaps'); try { return s0(...a) } finally { end(); if (outer) begin(outer + '(after shadow)') } }
    const poll = () => {
      T.pending = T.pending.filter(({ q, label }) => {
        if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) return true
        const ns = gl.getQueryParameter(q, gl.QUERY_RESULT); gl.deleteQuery(q)
        const k = label.replace('(after shadow)', ''); T.acc[k] = (T.acc[k] || 0) + ns / 1e6; return false
      })
      requestAnimationFrame(poll)
    }
    requestAnimationFrame(poll)
    const tick = () => { T.mainIdx = 0; if (T.on) T.frames++; requestAnimationFrame(tick) }
    requestAnimationFrame(tick)
  })
  await step(130)
  for (const [label, x, y, z, lx, ly, lz] of [['chamber', 0, 0.2, 142, 0, 3, 152], ['arena', 0, 0.2, 180, 0, 1.5, 210]]) {
    await page.evaluate(([x, y, z, lx, ly, lz]) => { window.__qa.teleport(x, y, z); window.__qa.lookAt(lx, ly, lz) }, [x, y, z, lx, ly, lz])
    await step(35)
    await page.evaluate(() => { const T = window.__gt; T.acc = {}; T.frames = 0; T.on = true })
    await step(6)
    await page.evaluate(() => { window.__gt.on = false })
    await step(4)
    const T = await page.evaluate(() => ({ acc: window.__gt.acc, frames: window.__gt.frames }))
    const rows = Object.entries(T.acc).map(([k, v]) => [k, v / T.frames]).sort((a, b) => b[1] - a[1])
    const tot = rows.reduce((s, r) => s + r[1], 0)
    console.log(`== ${label} ${W}x${H} ${QUERY}  total GPU ${tot.toFixed(0)} ms/frame`)
    for (const [k, v] of rows.slice(0, 18)) console.log('  ' + ((v / tot) * 100).toFixed(1).padStart(5) + '%  ' + v.toFixed(1).padStart(8) + ' ms  ' + k)
  }
  await b.close(); srv.close()
})().catch((e) => { console.error(e); process.exit(1) })

/* eslint-disable */
/**
 * Visual parity capture: the same deterministic frames from one build, so two
 * builds can be diffed. Waits past PerfDirector's chunking pass first.
 *   node qa/parity.cjs <distDir> <outDir> [port]
 */
const path = require('path'), fs = require('fs'), http = require('http')
function rp() { for (const c of ['/opt/node22/lib/node_modules/playwright', 'playwright']) { try { return require(c) } catch (e) {} } throw new Error('no playwright') }
const { chromium } = rp()
const CHROME = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find((p) => fs.existsSync(p))
const DIST = path.resolve(process.argv[2]), OUT = path.resolve(process.argv[3]), PORT = Number(process.argv[4] || 8270)
const QUERY = process.argv[5] || ''
const ONLY_SPAWN = process.env.ONLY_SPAWN === '1'
fs.mkdirSync(OUT, { recursive: true })
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.woff': 'font/woff' }
const srv = http.createServer((q, r) => { let p = q.url.split('?')[0]; if (p === '/') p = '/index.html'; const f = path.join(DIST, p); if (!fs.existsSync(f)) { r.writeHead(404); return r.end() } r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r) }).listen(PORT)
;(async () => {
  const b = await chromium.launch({ executablePath: CHROME, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--disable-dev-shm-usage'] })
  const page = await (await b.newContext({ viewport: { width: 640, height: 360 } })).newPage()
  await page.route(/^https?:\/\/(?!localhost)/, (r) => r.abort())
  await page.goto(`http://localhost:${PORT}/?qa=1${QUERY}`)
  await page.waitForFunction(() => !!window.__qa && !!window.__qa.gl, null, { timeout: 180000 })
  const step = (n) => page.evaluate((n) => new Promise((res) => { let c = 0; const f = () => { c++; c >= n ? res(1) : requestAnimationFrame(f) }; requestAnimationFrame(f) }), n)
  await page.evaluate(() => window.__qa.setFixedDt(1 / 30))
  await page.mouse.click(320, 180); await step(2)
  await page.evaluate(() => window.__qa.setPhase('INFILTRATE'))
  await step(90)
  const shot = async (name, x, y, z, lx, ly, lz) => {
    await page.evaluate(([x, y, z, lx, ly, lz]) => { window.__qa.teleport(x, y, z); window.__qa.lookAt(lx, ly, lz) }, [x, y, z, lx, ly, lz])
    await step(24) // let springs, cascades and cached shadows settle
    await page.evaluate(([lx, ly, lz]) => window.__qa.lookAt(lx, ly, lz), [lx, ly, lz])
    await step(2)
    await page.screenshot({ path: path.join(OUT, name + '.png'), timeout: 180000 })
    console.log('shot', name)
  }
  await shot('a_spawn', 0, 0.2, 5, 0, 1.5, 40)
  if (ONLY_SPAWN) { await b.close(); srv.close(); return }
  await shot('b_canyon', 0, 0.2, 40, 0, 2, 75)
  await shot('c_chamber', 0, 0.2, 142, 0, 3, 152)
  await page.evaluate(() => window.__qa.setPhase('EXTERMINATE')); await step(10)
  await shot('d_arena', 0, 0.2, 180, 0, 2, 210)
  if (process.env.DUMP_OCTA) {
    const info = await page.evaluate(() => {
      const { scene, camera } = window.__qa
      const out = []
      scene.traverse((m) => {
        if (!m.isMesh || m.geometry?.type !== 'OctahedronGeometry' || m.isInstancedMesh) return
        const p = m.getWorldPosition(camera.position.clone())
        let chain = []; for (let n = m; n; n = n.parent) chain.push((n.name || n.type) + (n.visible ? '' : '(HIDDEN)') + (n.layers.mask !== 1 ? '[L' + n.layers.mask + ']' : ''))
        out.push({ pos: [p.x, p.y, p.z].map((v) => +v.toFixed(1)), scale: [m.scale.x, m.scale.y, m.scale.z], chain: chain.join(' < '), perf: Object.keys(m.userData).filter((k) => k.startsWith('__perf')), mat: m.material.type, side: m.material.side, mwU: m.matrixWorldAutoUpdate, mU: m.matrixAutoUpdate })
      })
      return out
    })
    for (const o of info) console.log('OCTA', JSON.stringify(o))
  }
  await b.close(); srv.close()
})().catch((e) => { console.error(e); process.exit(1) })

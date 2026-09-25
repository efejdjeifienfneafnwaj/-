/* eslint-disable */
/** Which materials get their program re-resolved every frame (getProgram -> customProgramCacheKey). */
const path = require('path'), fs = require('fs'), http = require('http')
function rp() { for (const c of ['/opt/node22/lib/node_modules/playwright', 'playwright']) { try { return require(c) } catch (e) {} } throw new Error('no playwright') }
const { chromium } = rp()
const CHROME = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find((p) => fs.existsSync(p))
const DIST = path.resolve(process.env.DIST || path.join(__dirname, '..', 'dist'))
const PORT = Number(process.argv[2] || 8267)
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.woff': 'font/woff' }
const srv = http.createServer((q, r) => { let p = q.url.split('?')[0]; if (p === '/') p = '/index.html'; const f = path.join(DIST, p); if (!fs.existsSync(f)) { r.writeHead(404); return r.end() } r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r) }).listen(PORT)
;(async () => {
  const b = await chromium.launch({ executablePath: CHROME, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--disable-dev-shm-usage'] })
  const page = await (await b.newContext({ viewport: { width: 320, height: 180 } })).newPage()
  await page.route(/^https?:\/\/(?!localhost)/, (r) => r.abort())
  await page.goto(`http://localhost:${PORT}/?qa=1${process.env.Q || ''}`)
  await page.waitForFunction(() => !!window.__qa && !!window.__qa.gl, null, { timeout: 180000 })
  const step = (n) => page.evaluate((n) => new Promise((res) => { let c = 0; const f = () => { c++; c >= n ? res(1) : requestAnimationFrame(f) }; requestAnimationFrame(f) }), n)
  await page.mouse.click(160, 90); await step(2)
  await page.evaluate(() => { window.__qa.setFixedDt(1 / 30); window.__qa.setPhase('EXTERMINATE') })
  await step(90)
  await page.evaluate(() => { window.__qa.teleport(0, 0.2, 180); window.__qa.lookAt(0, 1.5, 210) })
  await step(6)
  await page.evaluate(() => {
    const { scene } = window.__qa
    const counts = (window.__pc = new Map()), vers = (window.__pv = new Map())
    const seen = new Set()
    const wrap = (m, o) => {
      if (!m || seen.has(m)) return; seen.add(m)
      const orig = m.customProgramCacheKey.bind(m)
      const key = `${m.type}:${m.name || ''}:${o.name || o.parent?.name || ''}`
      vers.set(key, m.version)
      m.customProgramCacheKey = function () { counts.set(key, (counts.get(key) || 0) + 1); return orig() }
      m.__k = key
    }
    scene.traverse((o) => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => wrap(m, o)); if (o.customDepthMaterial) wrap(o.customDepthMaterial, o) })
    const gl = window.__qa.gl
    window.__lv = []
  })

  const sig = await page.evaluate(() => {
    const { scene, gl } = window.__qa
    const byMat = new Map()
    const v0 = new Map()
    scene.traverse((o) => {
      if (!o.material) return
      const mats = Array.isArray(o.material) ? o.material : [o.material]
      for (const m of mats) {
        const g = o.geometry || { attributes: {} }
        const s = [o.isInstancedMesh ? 'I' : '-', o.isInstancedMesh && o.instanceColor ? 'C' : '-', o.isSkinnedMesh ? 'S' : '-',
          (m.vertexColors && g.attributes.color && g.attributes.color.itemSize === 4) ? 'A' : '-',
          (g.attributes.tangent && (m.normalMap || m.anisotropy > 0)) ? 'T' : '-',
          g.morphAttributes && g.morphAttributes.position ? 'M' + g.morphAttributes.position.length : '-',
          o.isPoints ? 'P' : o.isLine ? 'L' : o.isSprite ? 'Sp' : ''].join('')
        let e = byMat.get(m); if (!e) byMat.set(m, (e = { sigs: new Map(), name: m.name, type: m.type, obj: o.name || o.parent?.name || '' }))
        e.sigs.set(s, (e.sigs.get(s) || 0) + 1)
        v0.set(m, m.version)
      }
    })
    window.__v0 = v0
    const mixed = [...byMat.values()].filter((e) => e.sigs.size > 1).map((e) => `${e.type}:${e.name}:${e.obj} ${[...e.sigs.entries()].map(([k, v]) => k + 'x' + v).join(' ')}`)
    // renders per frame and their targets
    const log = (window.__rl = [])
    const orig = gl.render.bind(gl)
    gl.render = function (sc, cam) { const t = gl.getRenderTarget(); if (sc === scene) log.push(new Error().stack.split('\n').slice(2, 7).map((l) => l.trim().replace(/\(.*\/([^/]+:\d+):\d+\)/, '($1)')).join(' < ')); log.push(`${sc.type}${sc === scene ? '(main)' : ''}:${cam.type}->${t ? (t.texture?.colorSpace || 'rt') + ':' + t.width + 'x' + t.height : 'SCREEN'}`); return orig(sc, cam) }
    return mixed
  })
  console.log('materials shared across differing object kinds:', sig.length)
  for (const l of sig.slice(0, 40)) console.log('  ', l)
  await step(1)
  await page.evaluate(() => { window.__rl.length = 0 })
  await step(1)
  const rl = await page.evaluate(() => window.__rl.filter((x) => !x.includes('OrthographicCamera')))
  console.log('scene renders in one frame:', rl.length); for (const l of rl.slice(0, 30)) console.log('  ', l)
  const bumped = await page.evaluate(() => { const out = []; for (const [m, v] of window.__v0) if (m.version !== v) out.push(`${m.type}:${m.name} +${m.version - v}`); return out })
  console.log('materials whose version changed:', bumped.length); for (const l of bumped.slice(0, 20)) console.log('  ', l)

  if (process.env.TRAP) {
    await page.evaluate(() => {
      const { scene } = window.__qa
      const hits = (window.__vh = new Map())
      const seen = new Set()
      scene.traverse((o) => {
        const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : []
        for (const m of mats) {
          if (seen.has(m)) continue; seen.add(m)
          let v = m.version
          Object.defineProperty(m, 'version', { configurable: true, get() { return v }, set(n) {
            v = n
            const st = new Error().stack.split('\n').slice(2, 6).map((l) => l.trim().replace(/\(.*\/([^/]+:\d+):\d+\)/, '($1)')).join(' < ')
            const k = `${m.type}:${m.name}:${o.name || o.parent?.name || ''} ${st}`
            hits.set(k, (hits.get(k) || 0) + 1)
          } })
        }
      })
    })
    await step(5)
    const vh = await page.evaluate(() => [...window.__vh.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12))
    console.log('version bumps over 5 frames:'); for (const [k, v] of vh) console.log(String(v).padStart(4), k.slice(0, 380))
  }
  await step(10)
  const r = await page.evaluate(() => {
    const out = [...window.__pc.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)
    return { total: [...window.__pc.values()].reduce((a, b) => a + b, 0), out }
  })
  console.log('program re-resolves over 10 frames:', r.total)
  for (const [k, v] of r.out) console.log(String(v).padStart(5), k)
  await b.close(); srv.close()
})().catch((e) => { console.error(e); process.exit(1) })

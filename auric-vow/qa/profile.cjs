/* eslint-disable */
/**
 * Performance profile of the built game: scene cost counters plus a per-
 * feature frame-time ablation. Absolute times are from a software rasteriser
 * and mean nothing on their own; the RATIOS between rows are what matter.
 *
 *   node qa/profile.cjs [port]
 */
const path = require('path'), fs = require('fs'), http = require('http')
function rp() { for (const c of ['/opt/node22/lib/node_modules/playwright', 'playwright']) { try { return require(c) } catch (e) {} } throw new Error('no playwright') }
const { chromium } = rp()
const CHROME = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome-linux/chrome'].find((p) => fs.existsSync(p))
const DIST = path.resolve(__dirname, '..', 'dist')
const PORT = Number(process.argv[2] || 8251)
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.woff': 'font/woff' }
const srv = http.createServer((q, r) => { let p = q.url.split('?')[0]; if (p === '/') p = '/index.html'; const f = path.join(DIST, p); if (!fs.existsSync(f)) { r.writeHead(404); return r.end() } r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r) }).listen(PORT)

;(async () => {
  const W = 960, H = 540
  const b = await chromium.launch({ executablePath: CHROME, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--disable-dev-shm-usage'] })
  const page = await (await b.newContext({ viewport: { width: W, height: H } })).newPage()
  await page.route(/^https?:\/\/(?!localhost)/, (r) => r.abort())
  page.on('pageerror', (e) => console.log('PAGEERR', e.message.slice(0, 200)))
  const t0 = Date.now()
  await page.goto(`http://localhost:${PORT}/?qa=1`)
  await page.waitForFunction(() => !!window.__qa && !!window.__qa.gl, null, { timeout: 180000 })
  console.log('boot to QA-ready ms', Date.now() - t0)

  const step = (n) => page.evaluate((n) => new Promise((res) => { let c = 0; const f = () => { c++; c >= n ? res(1) : requestAnimationFrame(f) }; requestAnimationFrame(f) }), n)
  /** mean wall ms per frame over n frames */
  const timeFrames = (n) => page.evaluate((n) => new Promise((res) => { let c = 0; const s = performance.now(); const f = () => { c++; if (c >= n) res((performance.now() - s) / n); else requestAnimationFrame(f) }; requestAnimationFrame(f) }), n)

  await page.mouse.click(W / 2, H / 2); await step(2)
  await page.evaluate(() => { window.__qa.setFixedDt(1 / 30); window.__qa.setPhase('INFILTRATE') })
  const t1 = Date.now(); await step(3); console.log('first gameplay frames (shader compile) ms', Date.now() - t1)
  await step(80) // past PerfDirector's chunking pass
  console.log('perf stats', JSON.stringify(await page.evaluate(() => window.__qa.perf || null)))

  const counters = async (label) => {
    const c = await page.evaluate(() => {
      const gl = window.__qa.gl, scene = window.__qa.scene
      gl.info.autoReset = false; gl.info.reset()
      return new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(() => {
        const r = { calls: gl.info.render.calls, tris: gl.info.render.triangles, programs: gl.info.programs.length, geos: gl.info.memory.geometries, tex: gl.info.memory.textures, dpr: gl.getPixelRatio() }
        gl.info.autoReset = true
        let meshes = 0, inst = 0, instances = 0, casters = 0, visibleMeshes = 0
        const lights = { point: 0, pointLive: 0, spot: 0, spotLive: 0, spotShadow: 0, dir: 0, dirShadow: 0, hemi: 0, rectArea: 0, zeroIntensity: 0 }
        scene.traverse((o) => {
          if (o.isMesh) { meshes++; if (o.visible) visibleMeshes++; if (o.castShadow) casters++; if (o.isInstancedMesh) { inst++; instances += o.count } }
          if (o.isLight) {
            const live = o.visible && o.intensity > 0
            if (o.intensity === 0) lights.zeroIntensity++
            if (o.isPointLight) { lights.point++; if (live) lights.pointLive++ }
            else if (o.isSpotLight) { lights.spot++; if (live) lights.spotLive++; if (o.castShadow) lights.spotShadow++ }
            else if (o.isDirectionalLight) { lights.dir++; if (o.castShadow) lights.dirShadow++ }
            else if (o.isHemisphereLight) lights.hemi++
            else if (o.isRectAreaLight) lights.rectArea++
          }
        })
        r.meshes = meshes; r.visibleMeshes = visibleMeshes; r.instancedMeshes = inst; r.instances = instances; r.casters = casters; r.lights = lights
        res(r)
      })))
    })
    console.log(label, JSON.stringify(c))
    return c
  }

  const place = (x, y, z, lx, ly, lz) => page.evaluate(([x, y, z, lx, ly, lz]) => { window.__qa.teleport(x, y, z); window.__qa.lookAt(lx, ly, lz) }, [x, y, z, lx, ly, lz])

  // --- canyon ---
  await place(0, 0.2, 40, 0, 1.5, 70); await step(4)
  await counters('CANYON counters')
  console.log('CANYON baseline ms/frame', (await timeFrames(4)).toFixed(0))

  // --- arena ---
  await page.evaluate(() => { window.__qa.setPhase('EXTERMINATE') }); await step(6)
  await place(0, 0.2, 180, 0, 1.5, 210); await step(4)
  await counters('ARENA counters')
  const base = await timeFrames(4)
  console.log('ARENA baseline ms/frame', base.toFixed(0))

  // --- ablations (arena) ---
  const ablate = async (label, on, off) => {
    await page.evaluate(on); await step(3)
    const t = await timeFrames(4)
    console.log(`  ablate ${label.padEnd(34)} ms/frame ${t.toFixed(0).padStart(6)}   ${((1 - t / base) * 100).toFixed(0)}% cheaper`)
    await page.evaluate(off); await step(3)
  }
  await ablate('shadows off',
    () => window.__qa.setShadows(false),
    () => window.__qa.setShadows(true))
  await ablate('all point+spot lights hidden',
    () => { window.__saved = []; window.__qa.scene.traverse((o) => { if ((o.isPointLight || o.isSpotLight) && o.visible) { window.__saved.push(o); o.visible = false } }) },
    () => { (window.__saved || []).forEach((o) => (o.visible = true)) })
  await ablate('zero-intensity lights hidden',
    () => { window.__saved = []; window.__qa.scene.traverse((o) => { if (o.isLight && o.intensity === 0 && o.visible) { window.__saved.push(o); o.visible = false } }) },
    () => { (window.__saved || []).forEach((o) => (o.visible = true)) })
  await ablate('dpr 0.5 (fill-rate probe)',
    () => { window.__dpr = window.__qa.gl.getPixelRatio(); window.__qa.gl.setPixelRatio(0.5) },
    () => { window.__qa.gl.setPixelRatio(window.__dpr) })
  await ablate('camera far 400 -> 80 (culling probe)',
    () => { const c = window.__qa.camera; window.__far = c.far; c.far = 80; c.updateProjectionMatrix() },
    () => { const c = window.__qa.camera; c.far = window.__far; c.updateProjectionMatrix() })

  await b.close(); srv.close()
})().catch((e) => { console.error(e); process.exit(1) })

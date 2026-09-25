/* eslint-disable */
const path = require('path'), fs = require('fs'), http = require('http')
function rp() { for (const c of ['/opt/node22/lib/node_modules/playwright', 'playwright']) { try { return require(c) } catch (e) {} } throw new Error('no playwright') }
const { chromium } = rp()
const CHROME = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find((p) => fs.existsSync(p))
const DIST = path.resolve(__dirname, '..', 'dist')
const PORT = Number(process.argv[2] || 8252)
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.woff': 'font/woff' }
const srv = http.createServer((q, r) => { let p = q.url.split('?')[0]; if (p === '/') p = '/index.html'; const f = path.join(DIST, p); if (!fs.existsSync(f)) { r.writeHead(404); return r.end() } r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r) }).listen(PORT)
;(async () => {
  const b = await chromium.launch({ executablePath: CHROME, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--disable-dev-shm-usage'] })
  const page = await (await b.newContext({ viewport: { width: 960, height: 540 } })).newPage()
  await page.route(/^https?:\/\/(?!localhost)/, (r) => r.abort())
  await page.goto(`http://localhost:${PORT}/?qa=1`)
  await page.waitForFunction(() => !!window.__qa && !!window.__qa.gl, null, { timeout: 180000 })
  const step = (n) => page.evaluate((n) => new Promise((res) => { let c = 0; const f = () => { c++; c >= n ? res(1) : requestAnimationFrame(f) }; requestAnimationFrame(f) }), n)
  await page.mouse.click(480, 270); await step(2)
  await page.evaluate(() => { window.__qa.setFixedDt(1 / 30); window.__qa.setPhase('EXTERMINATE') }); await step(6)
  await page.evaluate(() => { window.__qa.teleport(0, 0.2, 180); window.__qa.lookAt(0, 1.5, 210) }); await step(4)
  const r = await page.evaluate(() => new Promise((res) => {
    const gl = window.__qa.gl, scene = window.__qa.scene, cam = window.__qa.camera
    const measure = () => new Promise((ok) => { gl.info.autoReset = false; gl.info.reset(); requestAnimationFrame(() => requestAnimationFrame(() => { const v = { calls: gl.info.render.calls, tris: gl.info.render.triangles }; gl.info.autoReset = true; ok(v) })) })
    ;(async () => {
      const all = await measure()
      gl.shadowMap.autoUpdate = false
      const noShadowPass = await measure()
      gl.shadowMap.autoUpdate = true
      // biggest triangle contributors
      const rows = []
      const camPos = cam.getWorldPosition(new cam.position.constructor())
      let far120 = 0, far120tris = 0, total = 0
      scene.traverse((o) => {
        if (!o.isMesh || !o.visible || !o.geometry) return
        const g = o.geometry
        const tri = (g.index ? g.index.count : (g.attributes.position ? g.attributes.position.count : 0)) / 3
        const n = o.isInstancedMesh ? o.count : 1
        const t = tri * n
        total += t
        if (!g.boundingSphere) g.computeBoundingSphere()
        const c = g.boundingSphere.center.clone().applyMatrix4(o.matrixWorld)
        const d = c.distanceTo(camPos)
        if (!o.isInstancedMesh && d > 120) { far120++; far120tris += t }
        rows.push({ name: o.name || o.parent?.name || o.type, tri: Math.round(tri), n, t: Math.round(t), inst: !!o.isInstancedMesh, cast: o.castShadow, frustumCulled: o.frustumCulled, mat: o.material?.type })
      })
      rows.sort((a, b) => b.t - a.t)
      const noCull = rows.filter((r) => r.frustumCulled === false).length
      res({ all, noShadowPass, sceneTris: Math.round(total), far120, far120tris: Math.round(far120tris), notFrustumCulled: noCull, top: rows.slice(0, 18) })
    })()
  }))
  console.log('draw calls/tris WITH shadow pass   ', JSON.stringify(r.all))
  console.log('draw calls/tris WITHOUT shadow pass', JSON.stringify(r.noShadowPass))
  console.log('scene triangles (all visible meshes, no culling):', r.sceneTris)
  console.log('non-instanced meshes > 120 m from camera:', r.far120, 'tris', r.far120tris)
  console.log('meshes with frustumCulled=false:', r.notFrustumCulled)
  console.log('top contributors:')
  for (const x of r.top) console.log('  ', String(x.t).padStart(9), 'tris', String(x.tri).padStart(7), 'x', String(x.n).padStart(4), x.inst ? 'INST' : '    ', x.cast ? 'cast' : '    ', x.frustumCulled ? '' : 'NOCULL', x.mat, x.name)
  await b.close(); srv.close()
})().catch((e) => { console.error(e); process.exit(1) })

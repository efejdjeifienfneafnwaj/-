/* eslint-disable */
/** Which objects produce the draw calls: frustum-visible renderables grouped by name, and shadow casters. */
const path = require('path'), fs = require('fs'), http = require('http')
function rp() { for (const c of ['/opt/node22/lib/node_modules/playwright', 'playwright']) { try { return require(c) } catch (e) {} } throw new Error('no playwright') }
const { chromium } = rp()
const CHROME = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find((p) => fs.existsSync(p))
const DIST = path.resolve(__dirname, '..', 'dist')
const PORT = Number(process.argv[2] || 8263)
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
  await page.evaluate(() => { window.__qa.setFixedDt(1 / 30); window.__qa.setPhase('EXTERMINATE') })
  await step(90)
  const spot = async (label, x, y, z, lx, ly, lz) => {
    await page.evaluate(([x, y, z, lx, ly, lz]) => { window.__qa.teleport(x, y, z); window.__qa.lookAt(lx, ly, lz) }, [x, y, z, lx, ly, lz])
    await step(4)
    // frustum math done in page with three from a mesh's constructor chain
    const out = await page.evaluate(() => {
      const { scene, camera } = window.__qa
      const Matrix4 = camera.matrixWorld.constructor
      const m = new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
      const e = m.elements
      const planes = [
        [e[3] - e[0], e[7] - e[4], e[11] - e[8], e[15] - e[12]],
        [e[3] + e[0], e[7] + e[4], e[11] + e[8], e[15] + e[12]],
        [e[3] + e[1], e[7] + e[5], e[11] + e[9], e[15] + e[13]],
        [e[3] - e[1], e[7] - e[5], e[11] - e[9], e[15] - e[13]],
        [e[3] - e[2], e[7] - e[6], e[11] - e[10], e[15] - e[14]],
        [e[3] + e[2], e[7] + e[6], e[11] + e[10], e[15] + e[14]],
      ].map((p) => { const l = Math.hypot(p[0], p[1], p[2]); return p.map((v) => v / l) })
      const groups = {}, casters = {}
      let vis = 0, cast = 0, total = 0
      scene.traverseVisible((o) => {
        if (!(o.isMesh || o.isPoints || o.isLine || o.isSprite)) return
        if (!o.layers.test(camera.layers)) return
        total++
        const mats = Array.isArray(o.material) ? o.material.length : 1
        let name = (o.name || o.parent?.name || o.geometry?.type || '?').replace(/#.*$/, '').slice(0, 40)
        if (o.castShadow) { cast += mats; casters[name] = (casters[name] || 0) + mats }
        let inView = true
        if (o.frustumCulled && o.geometry) {
          if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere()
          const s = (o.isInstancedMesh && o.boundingSphere) ? o.boundingSphere : o.geometry.boundingSphere
          const c = s.center.clone().applyMatrix4(o.matrixWorld)
          const r = s.radius * o.matrixWorld.getMaxScaleOnAxis()
          for (const p of planes) if (p[0] * c.x + p[1] * c.y + p[2] * c.z + p[3] < -r) { inView = false; break }
        }
        if (inView) { vis += mats; groups[name] = (groups[name] || 0) + mats }
      })
      const top = (g) => Object.entries(g).sort((a, b) => b[1] - a[1]).slice(0, 25)
      return { total, vis, cast, top: top(groups), topCast: top(casters) }
    })
    console.log('==', label, 'renderables', out.total, 'in view', out.vis, 'casters', out.cast)
    console.log(' main:', out.top.map(([k, v]) => `${k}:${v}`).join('  '))
    console.log(' cast:', out.topCast.map(([k, v]) => `${k}:${v}`).join('  '))
  }
  await spot('arena', 0, 0.2, 180, 0, 1.5, 210)
  await spot('canyon', 0, 0.2, 40, 0, 1.5, 70)
  await b.close(); srv.close()
})().catch((e) => { console.error(e); process.exit(1) })

/* eslint-disable */
/** Identify what is drawn at given pixels in the arena parity view. node qa/pick.cjs <dist> port x,y ... */
const path = require('path'), fs = require('fs'), http = require('http')
function rp() { for (const c of ['/opt/node22/lib/node_modules/playwright', 'playwright']) { try { return require(c) } catch (e) {} } throw new Error('no playwright') }
const { chromium } = rp()
const CHROME = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find((p) => fs.existsSync(p))
const DIST = path.resolve(process.argv[2]), PORT = Number(process.argv[3])
const PTS = process.argv.slice(4).map((s) => s.split(',').map(Number))
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
  await page.evaluate(() => window.__qa.setPhase('INFILTRATE')); await step(90)
  await page.evaluate(() => window.__qa.setPhase('EXTERMINATE')); await step(10)
  await page.evaluate(() => { window.__qa.teleport(0, 0.2, 180); window.__qa.lookAt(0, 2, 210) }); await step(24)
  await page.evaluate(() => window.__qa.lookAt(0, 2, 210)); await step(2)
  const out = await page.evaluate((pts) => {
    const { scene, camera } = window.__qa
    // find three's Raycaster via a mesh's raycast? build minimal: use camera to make ray and test bounding spheres + mesh.raycast needs Raycaster
    const R = window.__THREE_RAYCASTER
    return R ? null : 'no raycaster'
  }, PTS)
  // Use three from the page bundle: grab constructor through a Vector3 prototype chain is not possible; so do manual ray vs triangle on candidate meshes
  const res = await page.evaluate((pts) => {
    const { scene, camera } = window.__qa
    camera.updateMatrixWorld()
    const V = camera.position.constructor
    const results = []
    for (const [px, py] of pts) {
      const ndc = new V((px / 640) * 2 - 1, -(py / 360) * 2 + 1, 0.5)
      const o = new V().setFromMatrixPosition(camera.matrixWorld)
      const d = ndc.clone().unproject(camera).sub(o).normalize()
      const hits = []
      const a = new V(), bb = new V(), c = new V(), e1 = new V(), e2 = new V(), h = new V(), s = new V(), q = new V()
      const M = camera.matrixWorld.constructor
      const tmp = new M()
      scene.traverse((m) => {
        if (!m.isMesh || !m.geometry || !m.geometry.attributes.position) return
        let vis = true; for (let n = m; n; n = n.parent) if (!n.visible) { vis = false; break }
        if (!vis) return
        const pos = m.geometry.attributes.position, idx = m.geometry.index
        const count = m.isInstancedMesh ? m.count : 1
        const triN = idx ? idx.count / 3 : pos.count / 3
        for (let k = 0; k < count; k++) {
          const W = tmp.copy(m.matrixWorld)
          if (m.isInstancedMesh) { const im = new M(); m.getMatrixAt(k, im); W.multiply(im) }
          // ray vs bounding sphere prefilter
          if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere()
          { const bs = m.geometry.boundingSphere; const cc = bs.center.clone().applyMatrix4(W); const rr = bs.radius * W.getMaxScaleOnAxis(); const oc = cc.clone().sub(o); const tp = oc.dot(d); const d2 = oc.lengthSq() - tp * tp; if (d2 > rr * rr || tp < -rr) continue }
          let best = Infinity
          for (let t = 0; t < triN; t++) {
            const i0 = idx ? idx.getX(t * 3) : t * 3, i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1, i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2
            a.fromBufferAttribute(pos, i0).applyMatrix4(W); bb.fromBufferAttribute(pos, i1).applyMatrix4(W); c.fromBufferAttribute(pos, i2).applyMatrix4(W)
            e1.subVectors(bb, a); e2.subVectors(c, a); h.crossVectors(d, e2); const det = e1.dot(h); if (Math.abs(det) < 1e-9) continue
            const f = 1 / det; s.subVectors(o, a); const u = f * s.dot(h); if (u < 0 || u > 1) continue
            q.crossVectors(s, e1); const v = f * d.dot(q); if (v < 0 || u + v > 1) continue
            const tt = f * e2.dot(q); if (tt > 0.1 && tt < best) best = tt
          }
          if (best < Infinity) {
            let path = []; for (let n = m; n && n !== scene; n = n.parent) path.push(n.name || n.type)
            // would three's frustum test keep it? (cached bounds, as the renderer sees them)
            let inFr = null
            if (!m.isInstancedMesh && m.geometry.boundingSphere) {
              camera.updateMatrixWorld(); const pm = new M().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); const e = pm.elements
              const pl = [[e[3]-e[0],e[7]-e[4],e[11]-e[8],e[15]-e[12]],[e[3]+e[0],e[7]+e[4],e[11]+e[8],e[15]+e[12]],[e[3]+e[1],e[7]+e[5],e[11]+e[9],e[15]+e[13]],[e[3]-e[1],e[7]-e[5],e[11]-e[9],e[15]-e[13]],[e[3]-e[2],e[7]-e[6],e[11]-e[10],e[15]-e[14]],[e[3]+e[2],e[7]+e[6],e[11]+e[10],e[15]+e[14]]].map((p) => { const l = Math.hypot(p[0], p[1], p[2]); return p.map((v) => v / l) })
              const cc = m.geometry.boundingSphere.center.clone().applyMatrix4(m.matrixWorld); const rr = m.geometry.boundingSphere.radius * m.matrixWorld.getMaxScaleOnAxis()
              inFr = pl.every((p) => p[0] * cc.x + p[1] * cc.y + p[2] * cc.z + p[3] >= -rr)
            }
            hits.push({ side: m.material?.side, det: +m.matrixWorld.determinant().toFixed(3), idet: m.isInstancedMesh ? +(() => { const im = new M(); m.getMatrixAt(k, im); return im.determinant() })().toFixed(3) : null, g: m.geometry.type, mv: m.material?.visible, cw: m.material?.colorWrite, op: m.material?.opacity, inFr, uuid: m.uuid.slice(0, 8), t: +best.toFixed(2), name: path.slice(0, 5).join(' < '), layers: m.layers.mask, inst: m.isInstancedMesh ? k : -1, fc: m.frustumCulled, mat: m.material?.type + ':' + (m.material?.name || ''), tr: !!m.material?.transparent, perf: JSON.stringify(Object.keys(m.userData).filter((x) => x.startsWith('__perf'))) })
          }
        }
      })
      hits.sort((x, y) => x.t - y.t)
      results.push({ px, py, hits: hits.slice(0, 6) })
    }
    return results
  }, PTS)
  for (const r of res) { console.log('pixel', r.px, r.py); for (const h of r.hits) console.log('  ', JSON.stringify(h)) }
  await b.close(); srv.close()
})().catch((e) => { console.error(e); process.exit(1) })

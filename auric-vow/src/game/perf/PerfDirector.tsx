/* eslint-disable react-hooks/immutability -- imperative three.js renderer and scene-graph mutation inside useFrame is idiomatic R3F */
/**
 * AURIC VOW — perf/PerfDirector.tsx
 *
 * Frame-cost work that must not change what the frame looks like.
 *
 * Measured on the build this was written against (arena, 960x540):
 *
 *   draw calls per frame      4 837   of which 3 297 are shadow-map passes
 *   triangles per frame   6 010 620   of which 4 915 596 are shadow-map passes
 *   point lights in shader       33   of which 16-18 sit at intensity 0
 *
 * Four things drove that, and each has a fix that leaves the image alone:
 *
 * 1. INSTANCE CHUNKING. Ornament is instanced, one InstancedMesh per piece
 *    type, with its instances spread along the whole 265 m level. three.js
 *    culls an InstancedMesh as one sphere around all its instances, so every
 *    one of them is drawn in every pass — main view and all four shadow maps —
 *    wherever the camera is. Splitting each static InstancedMesh into spatial
 *    cells gives the frustum something to reject. Same geometry and material
 *    objects, so no new shader programs.
 *
 * 2. SHADOW CACHING. The far cascade has a fixed box over the whole level and
 *    only static stone falls in it at a resolution where characters do not
 *    register, so it is redrawn a few times a second instead of every frame,
 *    and at once on every mission phase change (the bridge seal opens at
 *    EXTRACT). Aperture spot shadows redraw every other frame, and at once
 *    whenever the pool reassigns a slot to a new opening.
 *
 * 3. LIGHT BUDGET. Every point light in the scene is looped over by every lit
 *    fragment, including lights at intensity 0. The pools were built at
 *    constant size on purpose — the light COUNT is a shader-program parameter,
 *    so changing it recompiles every material — and that is preserved here:
 *    exactly LIGHT_BUDGET point lights are admitted each frame, ranked by how
 *    much of their light could reach anything in view. Idle pool lights rank
 *    last and drop out; a VFX flash that fires next to the player ranks first.
 *
 * 4. ONE SHADOW RENDER PER FRAME. The post stack can render the scene more
 *    than once a frame, and every scene render re-renders every shadow map.
 *    The renderer's shadow pass is armed once per frame here instead.
 *
 * Distance culling was tried and deliberately left out: the fog is a height
 * fog whose density halves every ~6 m above the deck, so tall structures stay
 * readable at 200 m and beyond. Culling by distance would pop visible
 * silhouettes, which is a quality loss, not a free win.
 *
 * All exclusion is done with render LAYERS, never with `visible`. Game code
 * toggles `visible` for its own reasons (a seal opening, a light switching
 * off); layers are orthogonal to that, so the two can never fight over the
 * same flag. Nothing else in the codebase uses layers, and three.js gates
 * mesh draws, shadow casters and light gathering all on `layers.test()`.
 *
 * Plus two things that are not per-frame cost but are what makes the game
 * feel like it "doesn't run":
 *
 * 5. SHADER WARMUP. The first gameplay frames used to stall for ~6 s compiling
 *    programs for everything not visible from the title camera. The whole
 *    scene is compiled asynchronously behind the title screen instead.
 *
 * 6. DYNAMIC RESOLUTION lives in GameCanvas's QualityWatcher: it scales the
 *    pixel ratio smoothly and recovers, and never switches shadows or post
 *    effects off.
 */
import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useGameStore } from '../store'
import { PerfStats } from './stats'
import { StaticBatcher } from './staticBatch'

// ---------------------------------------------------------------------------
// tuning
// ---------------------------------------------------------------------------

/** hidden layers — no camera or shadow camera ever enables these */
const LAYER_CHUNKED_SOURCE = 31
const LAYER_CULLED = 30

/** chunk cell edge in metres (XZ). Near cascade box is ±24 m. */
const CHUNK_CELL = 36
/**
 * Only split meshes heavy enough to be worth it. Every chunk in view is its
 * own draw call, and a draw call costs CPU whatever it draws; splitting a
 * light mesh buys a few culled triangles for several extra calls. Measured:
 * splitting all 315 candidates doubled main-pass draw calls for a 60% cut in
 * triangles; the heavy ones carry nearly all of that cut on their own.
 */
const CHUNK_MIN_TRIS = 12000
const CHUNK_MIN_TRIS_PER_INSTANCE = 150
/** frames to observe an InstancedMesh for runtime writes before chunking it */
const CHUNK_OBSERVE_FROM = 30
const CHUNK_AT = 75

/** point lights admitted to the shader each frame */
const LIGHT_BUDGET = 10

/** a light further than this beyond its own range cannot light anything in view */
const LIGHT_IRRELEVANT_DIST = 200
/** rescan interval for the light / shadow-light lists */
const RESCAN_EVERY = 60

/** far cascade refresh interval (frames) when nothing forces it */
const FAR_SHADOW_EVERY = 20
/** aperture spot refresh interval (frames) */
const SPOT_SHADOW_EVERY = 2

// ---------------------------------------------------------------------------
// QA switches: ?qa=1&noperf=lights,chunks,batch,shadows,warmup disables a subsystem so
// its effect on the image can be isolated by diffing captures.
// ---------------------------------------------------------------------------

const NOPERF = new Set(
  typeof window !== 'undefined'
    ? (new URLSearchParams(window.location.search).get('noperf') || '').split(',').filter(Boolean)
    : [],
)

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const _m = new THREE.Matrix4()
const _p = new THREE.Vector3()
const _camPos = new THREE.Vector3()

function hideOnLayer(o: THREE.Object3D, layer: number) {
  if (o.userData.__perfLayerSaved === undefined) o.userData.__perfLayerSaved = o.layers.mask
  o.layers.set(layer)
}

function restoreLayer(o: THREE.Object3D) {
  const saved = o.userData.__perfLayerSaved
  if (saved !== undefined) {
    o.layers.mask = saved
    delete o.userData.__perfLayerSaved
  }
}

function isHiddenByPerf(o: THREE.Object3D) {
  return o.userData.__perfLayerSaved !== undefined
}

/** the object and all its ancestors are `visible` */
function effectivelyVisible(o: THREE.Object3D): boolean {
  let n: THREE.Object3D | null = o
  while (n) {
    if (!n.visible) return false
    n = n.parent
  }
  return true
}

// ---------------------------------------------------------------------------
// 1. instance chunking
// ---------------------------------------------------------------------------

interface ChunkRecord {
  source: THREE.InstancedMesh
  chunks: THREE.InstancedMesh[]
  matrixVersion: number
  colorVersion: number
}

function geometryHasInstancedAttributes(g: THREE.BufferGeometry): boolean {
  for (const k in g.attributes) {
    if ((g.attributes[k] as THREE.InstancedBufferAttribute).isInstancedBufferAttribute) return true
  }
  return false
}

/**
 * Split one static InstancedMesh into per-cell InstancedMeshes that share its
 * geometry and material. Returns null when it is not worth splitting.
 */
function chunkInstancedMesh(src: THREE.InstancedMesh): THREE.InstancedMesh[] | null {
  if (!src.parent || src.count < 2) return null
  if (geometryHasInstancedAttributes(src.geometry)) return null
  const g = src.geometry
  const triPer = (g.index ? g.index.count : g.attributes.position ? g.attributes.position.count : 0) / 3
  if (triPer < CHUNK_MIN_TRIS_PER_INSTANCE || triPer * src.count < CHUNK_MIN_TRIS) return null

  src.updateWorldMatrix(true, false)
  const cells = new Map<string, number[]>()
  for (let i = 0; i < src.count; i++) {
    src.getMatrixAt(i, _m)
    _p.setFromMatrixPosition(_m).applyMatrix4(src.matrixWorld)
    const key = `${Math.floor(_p.x / CHUNK_CELL)},${Math.floor(_p.z / CHUNK_CELL)}`
    let list = cells.get(key)
    if (!list) cells.set(key, (list = []))
    list.push(i)
  }
  if (cells.size < 2) return null

  const out: THREE.InstancedMesh[] = []
  const _c = new THREE.Color()
  for (const [key, idx] of cells) {
    const chunk = new THREE.InstancedMesh(src.geometry, src.material, idx.length)
    chunk.name = `${src.name || 'inst'}#${key}`
    for (let j = 0; j < idx.length; j++) {
      src.getMatrixAt(idx[j], _m)
      chunk.setMatrixAt(j, _m)
      if (src.instanceColor) {
        src.getColorAt(idx[j], _c)
        chunk.setColorAt(j, _c)
      }
    }
    chunk.instanceMatrix.needsUpdate = true
    if (chunk.instanceColor) chunk.instanceColor.needsUpdate = true

    chunk.position.copy(src.position)
    chunk.quaternion.copy(src.quaternion)
    chunk.scale.copy(src.scale)
    chunk.matrixAutoUpdate = src.matrixAutoUpdate
    if (!src.matrixAutoUpdate) chunk.matrix.copy(src.matrix)
    chunk.castShadow = src.castShadow
    chunk.receiveShadow = src.receiveShadow
    chunk.renderOrder = src.renderOrder
    chunk.frustumCulled = true
    chunk.visible = src.visible
    chunk.layers.mask = src.userData.__perfLayerSaved ?? src.layers.mask
    chunk.customDepthMaterial = src.customDepthMaterial
    chunk.customDistanceMaterial = src.customDistanceMaterial
    chunk.onBeforeRender = src.onBeforeRender
    chunk.onAfterRender = src.onAfterRender
    chunk.userData = { ...src.userData, __perfChunkOf: src.uuid }
    delete chunk.userData.__perfLayerSaved
    chunk.computeBoundingBox()
    chunk.computeBoundingSphere()
    src.parent.add(chunk)
    out.push(chunk)
  }
  return out
}

function revertChunks(rec: ChunkRecord) {
  for (const c of rec.chunks) c.removeFromParent()
  restoreLayer(rec.source)
  PerfStats.chunkReverts++
}

// ---------------------------------------------------------------------------
// the director
// ---------------------------------------------------------------------------

export default function PerfDirector() {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const camera = useThree((s) => s.camera)

  const frame = useRef(0)
  const observed = useRef(new Map<THREE.InstancedMesh, number>())
  const chunked = useRef<ChunkRecord[]>([])
  const warmupStarted = useRef(false)
  const lastPhase = useRef('')
  const spotLastKey = useRef(new Map<THREE.SpotLight, string>())
  const pointLights = useRef<THREE.PointLight[]>([])
  const shadowLights = useRef<(THREE.DirectionalLight | THREE.SpotLight)[]>([])
  const batcher = useRef<StaticBatcher | null>(null)

  useEffect(() => {
    return () => {
      // unmount: undo everything so a remount starts clean
      for (const rec of chunked.current) revertChunks(rec)
      chunked.current = []
      batcher.current?.dispose()
      batcher.current = null
      scene.traverse((o) => restoreLayer(o))
      gl.shadowMap.autoUpdate = true
    }
  }, [scene, gl])

  // runs after every priority-0 system and before PostFX renders at 1
  useFrame(() => {
    const f = ++frame.current
    camera.getWorldPosition(_camPos)

    // ---- light / shadow-light lists, rescanned now and then -----------------
    if (f === 1 || f % RESCAN_EVERY === 0) {
      const pl: THREE.PointLight[] = []
      const sl: (THREE.DirectionalLight | THREE.SpotLight)[] = []
      scene.traverse((o) => {
        const l = o as THREE.PointLight & THREE.SpotLight & THREE.DirectionalLight
        if (!l.isLight) return
        if (l.isPointLight && !l.castShadow) pl.push(l)
        else if ((l.isDirectionalLight || l.isSpotLight) && l.castShadow) sl.push(l)
      })
      pointLights.current = pl
      shadowLights.current = sl
    }

    // ---- 3. light budget (from the very first frame, so every program is
    //         compiled once, with the final light count) -----------------------
    if (!NOPERF.has('lights')) {
      const cands: { l: THREE.PointLight; s: number }[] = []
      for (const l of pointLights.current) {
        // the renderer only counts lights whose whole parent chain is visible
        if (!l.parent || !effectivelyVisible(l)) continue
        const range = l.distance > 0 ? l.distance : 30
        const d = l.getWorldPosition(_p).distanceTo(_camPos)
        // how much of its light could land on anything near enough to see
        let s = (l.intensity * (range * range)) / Math.max(1, d * d)
        if (d - range > LIGHT_IRRELEVANT_DIST) s = 0
        // hysteresis: a light already admitted keeps its seat unless clearly beaten
        if (!isHiddenByPerf(l)) s *= 1.5
        cands.push({ l, s })
      }
      cands.sort((a, b) => b.s - a.s)
      const k = Math.min(LIGHT_BUDGET, cands.length)
      for (let i = 0; i < cands.length; i++) {
        if (i < k) restoreLayer(cands[i].l)
        else hideOnLayer(cands[i].l, LAYER_CULLED)
      }
      PerfStats.lightsAdmitted = k
      PerfStats.lightsCandidates = cands.length
    }

    // ---- 5. shader warmup, behind the title screen ---------------------------
    if (!warmupStarted.current && f === 8 && !NOPERF.has('warmup')) {
      warmupStarted.current = true
      const t0 = performance.now()
      const r = gl as THREE.WebGLRenderer & {
        compileAsync?: (s: THREE.Object3D, c: THREE.Camera) => Promise<unknown>
      }
      if (r.compileAsync) {
        r.compileAsync(scene, camera)
          .then(() => {
            PerfStats.warmupMs = Math.round(performance.now() - t0)
          })
          .catch(() => {
            PerfStats.warmupMs = -2
          })
      }
    }

    // ---- 1. instance chunking --------------------------------------------------
    if (f === CHUNK_OBSERVE_FROM && !NOPERF.has('chunks')) {
      scene.traverse((o) => {
        const m = o as THREE.InstancedMesh
        if (!m.isInstancedMesh || !m.frustumCulled) return
        if (m.userData.__perfChunkOf) return
        if (m.instanceMatrix.usage === THREE.DynamicDrawUsage) return
        observed.current.set(m, m.instanceMatrix.version)
      })
    }
    if (f === CHUNK_AT) {
      const staticInstanced = new Set<THREE.InstancedMesh>()
      for (const [m, v0] of observed.current) {
        // written to while we watched: it is animated, leave it alone
        if (m.instanceMatrix.version !== v0 || !m.parent) continue
        const chunks = chunkInstancedMesh(m)
        if (!chunks) {
          // light enough to bake outright (see 1b)
          staticInstanced.add(m)
          continue
        }
        hideOnLayer(m, LAYER_CHUNKED_SOURCE)
        chunked.current.push({
          source: m,
          chunks,
          matrixVersion: m.instanceMatrix.version,
          colorVersion: m.instanceColor ? m.instanceColor.version : -1,
        })
        PerfStats.chunkedSources++
        PerfStats.chunksCreated += chunks.length
      }
      observed.current.clear()

      // ---- 1b. static batching of the level's plain meshes --------------------
      const levelRoot = scene.getObjectByName('level-root')
      if (levelRoot && !NOPERF.has('batch')) {
        const t0 = performance.now()
        const b = new StaticBatcher(
          levelRoot,
          (o) => hideOnLayer(o, LAYER_CHUNKED_SOURCE),
          (o) => restoreLayer(o),
        )
        b.build(camera.layers, staticInstanced)
        batcher.current = b
        PerfStats.batchMs = Math.round(performance.now() - t0)
        PerfStats.batchRejects = b.rejects
      }
    }
    // same frame as any change, before anything is drawn
    if (batcher.current) {
      batcher.current.check()
      PerfStats.batchedSources = batcher.current.sourcesBatched
      PerfStats.batchesCreated = batcher.current.batches.length
      PerfStats.batchReverts = batcher.current.reverts
    }
    // keep chunks honest: mirror visibility, and revert if the source changes
    if (f > CHUNK_AT && (f & 7) === 0 && chunked.current.length) {
      chunked.current = chunked.current.filter((rec) => {
        const src = rec.source
        const changed =
          !src.parent ||
          src.instanceMatrix.version !== rec.matrixVersion ||
          (src.instanceColor ? src.instanceColor.version : -1) !== rec.colorVersion
        if (changed) {
          revertChunks(rec)
          return false
        }
        for (const c of rec.chunks) c.visible = src.visible
        return true
      })
    }

    // ---- 2 + 4. shadow caching, and one shadow render per frame -----------------
    // Arm the renderer's shadow pass exactly once for this frame: however many
    // times the post stack renders the scene, the maps are drawn once.
    if (NOPERF.has('shadows')) return
    gl.shadowMap.autoUpdate = false
    gl.shadowMap.needsUpdate = true

    const phase = useGameStore.getState().phase
    const phaseChanged = phase !== lastPhase.current
    lastPhase.current = phase
    for (const l of shadowLights.current) {
      if (!l.castShadow || !l.shadow) continue
      if ((l as THREE.DirectionalLight).isDirectionalLight) {
        const cam = l.shadow.camera as THREE.OrthographicCamera
        // the near cascade follows the camera: it redraws every frame
        if (Math.abs(cam.right - cam.left) < 120) {
          l.shadow.autoUpdate = true
          continue
        }
        // the far cascade has a fixed box over the whole level
        l.shadow.autoUpdate = false
        if (f < 4 || phaseChanged || f % FAR_SHADOW_EVERY === 0) {
          l.shadow.needsUpdate = true
          PerfStats.farShadowRedraws++
        }
      } else {
        const sp = l as THREE.SpotLight
        sp.shadow.autoUpdate = false
        const key =
          `${sp.position.x.toFixed(2)},${sp.position.y.toFixed(2)},${sp.position.z.toFixed(2)}` +
          `|${sp.target.position.x.toFixed(2)},${sp.target.position.y.toFixed(2)},${sp.target.position.z.toFixed(2)}` +
          `|${sp.angle.toFixed(3)}|${sp.shadow.camera.near}|${sp.shadow.camera.far}`
        const moved = spotLastKey.current.get(sp) !== key
        spotLastKey.current.set(sp, key)
        if (moved || phaseChanged || f % SPOT_SHADOW_EVERY === 0) {
          sp.shadow.needsUpdate = true
          PerfStats.spotShadowRedraws++
        }
      }
    }
  }, 0.5)

  return null
}

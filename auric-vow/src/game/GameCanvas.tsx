/**
 * AURIC VOW — GameCanvas.tsx
 * R3F canvas host. Renderer config per design.md §2.3/§7.
 * Scene composition per design.md §1.2: world → player → combat → enemies →
 * mission → vfx, then the frame-end GameTick orchestrator.
 *
 * R3 (light-transport) — the renderer contract changed in one consequential
 * way, documented at length next to AURIC_SHADOW_TYPE below: the canvas was
 * asking for `PCFSoftShadowMap`, which three r185 no longer implements. Every
 * shadow in the game was a single unfiltered depth tap. It is now a real
 * percentage-closer-soft-shadow filter (blocker search → contact hardening →
 * 12-tap Vogel PCF), which is the difference between a stair-stepped hard
 * edge and a penumbra that tightens where a boot meets the deck.
 *
 * R4 (light-transport) — two clauses, one small and one large, both measured.
 *
 * Small: `ShadowContract` below enforces the cast/receive flags on the live
 * scene instead of asking ~1300 call sites to remember two booleans. Measured
 * effect is real but modest — receivers 450 → 499, casters 238 → 422 — because
 * of the large finding below.
 *
 * Large, and the most useful thing this round turned up: of 1328 meshes in the
 * live scene only 477 are on a LIT material (MeshStandard/MeshPhysical). 749
 * are `MeshBasicMaterial`, which has no lighting term at all. Most of those
 * are legitimate — 647 are invisible pooled VFX and 693 are transparent or
 * additive — but it means the shadow-flag population was never the two-thirds
 * shortfall it looks like from the raw counts, and the lighting rig only ever
 * gets to shade 36 % of the scene graph. See the `litMeshes` / `litReceive`
 * fields in `lightReport` below, which are the honest denominators.
 *
 * Also settled this round: `PCSS_INSTALLED` was re-verified against the
 * installed r185 `shadowmap_pars_fragment` — the regex matches, the patch is
 * live, `shadowMapType` reads 0 (Basic, as intended for the PCSS path). The
 * standing theory that the patch had silently stopped matching is disproved,
 * and so is the theory that shadows were not rendering: see Lighting.tsx for
 * the shadows-on/shadows-off control capture that settled it.
 */
import { useEffect, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import PostFX from './PostFX'
import { Input } from './Input'
import { AudioBus } from './AudioBus'
import { LIGHTING, RENDERER, PLAYER } from './config'
import { useGameStore } from './store'
import {
  Skybox,
  Fog,
  Lighting,
  ShrineStation,
  EnvironmentFX,
  ColliderDebug,
  SPAWN_POSITION,
} from './world'
import { PlayerController, PlayerRig, CameraRig, resetPlayer, PlayerRef } from './player'
import { CamRef } from './player/CameraRig'
import { CombatSystems, WeaponViewModel, resetCombat, ImpactFx } from './combat'
import { EnemyManager, EnemyRegistry } from './enemies'
import { MissionDirector, ObjectiveMarker } from './mission'
import { VFXSystems, resetVfx } from './vfx'
import { setEnemiesAlive } from './hud'

// ---------------------------------------------------------------------------
// PCSS — percentage-closer soft shadows
//
// WHY THIS EXISTS, because it is the single largest light-transport defect in
// the build and it was invisible in code review:
//
//   three r185 maps ONLY `PCFShadowMap` → SHADOWMAP_TYPE_PCF and
//   `VSMShadowMap` → SHADOWMAP_TYPE_VSM. Anything else — including the
//   `PCFSoftShadowMap` constant this canvas was passing — falls through
//   `generateShadowMapTypeDefine()` to SHADOWMAP_TYPE_BASIC, whose getShadow()
//   is ONE unfiltered `texture2D` tap and a `step()`. So every shadow in the
//   game was a hard, aliased, per-texel binary edge: at 2.5 cm/texel that is a
//   visible staircase on every contact, which is exactly the "light never
//   interacts with the scene" read the panel gave us.
//
// The BASIC path does have one property nothing else has: because
// `compareFunction` is null, the depth texture is bound as a plain sampler2D
// and we can read REAL BLOCKER DEPTHS. That is what PCSS needs and what the
// hardware-PCF (sampler2DShadow) path cannot give. So instead of settling for
// three's 5-tap Vogel PCF, we stay on BASIC and replace its getShadow with:
//
//   1. an 8-tap Vogel blocker search over the light's maximum penumbra,
//      early-outing to fully lit when nothing occludes (the common case),
//   2. an average-blocker-depth → receiver separation estimate,
//   3. a 12-tap Vogel PCF whose radius is lerped from 0.85 texels at contact
//      to `shadow.radius * 7` texels far from the caster.
//
// Contact hardening is the whole point: a character's feet get a shadow that
// is razor sharp where it touches and opens up under the torso, and a dome
// throws a soft-edged shadow across the deck 40 m away. Both from one light.
//
// The patch is a string surgery on a stock shader chunk, so it verifies
// itself: if the anchor does not match (three upgraded, chunk reworded) we
// fall back to `PCFShadowMap`, which at least gets three's own 5-tap filter
// instead of the 1-tap BASIC path we were silently on.
// ---------------------------------------------------------------------------
const PCSS_ANCHOR =
  /if \( frustumTest \) \{\s*float depth = texture2D\( shadowMap, shadowCoord\.xy \)\.r;[\s\S]*?\n\t{3}\}/

const PCSS_BODY = /* glsl */ `if ( frustumTest ) {
				float auricTexel = 1.0 / shadowMapSize.x;
				// interleaved gradient noise rotates the disc per pixel so the
				// 12 taps read as film grain instead of 12 banded rings
				float auricPhi = fract( 52.9829189 * fract( dot( gl_FragCoord.xy, vec2( 0.06711056, 0.00583715 ) ) ) ) * PI2;
				float auricMaxR = max( shadowRadius, 0.0001 ) * 7.0 * auricTexel;
				float auricBlockerSum = 0.0;
				float auricBlockerCount = 0.0;
				for ( int bi = 0; bi < 8; bi ++ ) {
					float bf = float( bi );
					float br = sqrt( ( bf + 0.5 ) * 0.125 );
					float bt = bf * 2.3999632 + auricPhi;
					float bd = texture2D( shadowMap, shadowCoord.xy + vec2( cos( bt ), sin( bt ) ) * br * auricMaxR ).r;
					#ifdef USE_REVERSED_DEPTH_BUFFER
						if ( bd > shadowCoord.z ) { auricBlockerSum += bd; auricBlockerCount += 1.0; }
					#else
						if ( bd < shadowCoord.z ) { auricBlockerSum += bd; auricBlockerCount += 1.0; }
					#endif
				}
				// every tap at the WIDEST radius is a blocker, so no tap inside it
				// can escape: deep umbra, skip the filter. With the fully-lit
				// early-out above this keeps the 12-tap filter for penumbra
				// pixels only, which are a thin band of any frame.
				if ( auricBlockerCount > 7.5 ) {
					shadow = 0.0;
				} else if ( auricBlockerCount > 0.5 ) {
					float auricSep = abs( shadowCoord.z - auricBlockerSum / auricBlockerCount );
					float auricPen = clamp( auricSep * 190.0, 0.0, 1.0 );
					float auricFilterR = mix( 0.85 * auricTexel, auricMaxR, auricPen );
					float auricSum = 0.0;
					for ( int fi = 0; fi < 12; fi ++ ) {
						float ff = float( fi );
						float fr = sqrt( ( ff + 0.5 ) * 0.0833333 );
						float ft = ff * 2.3999632 + auricPhi + 1.7;
						float fd = texture2D( shadowMap, shadowCoord.xy + vec2( cos( ft ), sin( ft ) ) * fr * auricFilterR ).r;
						#ifdef USE_REVERSED_DEPTH_BUFFER
							auricSum += step( fd, shadowCoord.z );
						#else
							auricSum += step( shadowCoord.z, fd );
						#endif
					}
					shadow = auricSum * 0.0833333;
				}
			}`

/** true once the chunk has been rewritten; drives the shadow-map type below */
const PCSS_INSTALLED = (() => {
  const src = THREE.ShaderChunk.shadowmap_pars_fragment
  const next = src.replace(PCSS_ANCHOR, PCSS_BODY)
  if (next === src) return false
  THREE.ShaderChunk.shadowmap_pars_fragment = next
  return true
})()

/**
 * BasicShadowMap here does NOT mean "basic shadows" — it means "bind the depth
 * map as a plain sampler2D", which is the prerequisite for the PCSS filter
 * installed above. If the patch failed we drop to PCFShadowMap so we still get
 * three's own filtered path rather than the unfiltered one-tap default.
 */
const AURIC_SHADOW_TYPE = PCSS_INSTALLED ? THREE.BasicShadowMap : THREE.PCFShadowMap

/**
 * Frame-end orchestrator (design.md §1.2 loop/GameLoop):
 *   - on phase entry to DROPSHIP (game start / retry): respawn the player at
 *     the world spawn point, face them down-canyon (+Z), reset combat state
 *   - per frame: decay hitstop/slow-mo (real dt), regen + game clock (scaled
 *     dt), feed the HUD alive-enemy count, then end the input frame LAST.
 *
 * Priority 0 subscriber — runs after the player agents' negative-priority
 * frames and, being mounted last, after every other priority-0 system.
 * Rendering itself is taken over by PostFX's EffectComposer (priority 1).
 */
function GameTick() {
  const lastPhase = useRef('')

  useFrame((_, delta) => {
    const store = useGameStore.getState()
    // real, unclamped delta: the game clock / regen / timeScale decay are
    // timers and must track wall-clock time even at low fps (clamping here
    // dilates game time). Only physics integration steps clamp dt.
    const realDt = delta
    const scaledDt = realDt * store.timeScale

    if (store.phase !== lastPhase.current) {
      lastPhase.current = store.phase
      if (store.phase === 'DROPSHIP') {
        resetPlayer(SPAWN_POSITION)
        resetCombat()
        // resetCombat() only clears state flags, so the ability updates that
        // own leased lights and live ribbons early-out instead of releasing
        // them. The bus has to be cleared explicitly or a restart taken
        // mid-ability strands both for the rest of the session.
        resetVfx()
        ImpactFx.clear()
        CamRef.yaw = Math.PI // face +Z, down the traversal canyon
        CamRef.pitch = -0.08
      }
    }

    store.tickTimeScale(realDt)
    store.regenTick(scaledDt)
    store.advanceGameTime(scaledDt)
    setEnemiesAlive(EnemyRegistry.aliveCount())
    Input.endFrame() // LAST — after all systems have read input this frame
  })

  return null
}

/**
 * Adaptive quality watcher (config.RENDERER.lowSpecResolutionScale wiring).
 * After a warmup, measures avg fps over rolling 5s windows; while fps < 45 it
 * steps the store.qualityTier down (0 → 1 → 2) and applies each tier:
 *   tier 1: dpr 0.75 + key-light shadow casting off
 *   tier 2: dpr 0.50 (Bloom/SMAA are dropped by PostFX reacting to the tier)
 * Tiers never recover automatically (no oscillation); PostFX subscribes to
 * store.qualityTier and reconfigures the composer.
 */
const FPS_FLOOR = 45
const FPS_WINDOW_SEC = 5
const FPS_WARMUP_SEC = 2

/**
 * Shed shadow cost one rung at a time instead of all at once.
 *
 * R3: the old version killed every directional shadow the first time the fps
 * window missed, which is the one change that guarantees the frame reads as a
 * greybox — the key stops interacting with anything. Lighting.tsx tags each
 * caster with `userData.auricShadowTier`, the tier at which it is allowed to
 * stop casting:
 *   tier 1 — the far cascade (130 m ortho, 12.7 cm/texel) and the chamber
 *            spot go; the primary 24 m cascade that carries every shadow the
 *            player can actually see stays, at half its map size.
 *   tier 2 — everything stops casting and the ContactBlobs carry grounding.
 */
function shedShadows(scene: THREE.Scene, tier: 1 | 2) {
  scene.traverse((o) => {
    const l = o as THREE.DirectionalLight | THREE.SpotLight
    if (!l.castShadow) return
    const anyLight = l as unknown as { isDirectionalLight?: boolean; isSpotLight?: boolean }
    if (!anyLight.isDirectionalLight && !anyLight.isSpotLight) return
    const at = (l.userData.auricShadowTier as number | undefined) ?? 1
    if (tier < at) {
      // survives this tier — but halve its map so the pass costs a quarter
      if (tier === 1 && l.shadow.mapSize.x > 1024) {
        l.shadow.mapSize.setScalar(Math.max(1024, Math.round(l.shadow.mapSize.x * 0.5)))
        l.shadow.map?.dispose()
        l.shadow.map = null
      }
      return
    }
    l.castShadow = false
    l.shadow.map?.dispose()
    l.shadow.map = null
  })
}

// ---------------------------------------------------------------------------
// Shadow participation pass (R4, light-transport)
//
// MEASURED, not assumed. `window.__qa.lightReport()` on the R3 build reports
//
//     meshes 1328   castShadow 238   receiveShadow 450
//
// and a material census of the same scene reports that only 477 of those 1328
// are on a lit material at all (199 MeshStandard + 278 MeshPhysical); 749 are
// MeshBasicMaterial and 100 are ShaderMaterial. So the honest statement is not
// "878 meshes cannot be shadowed" — most of those are invisible pooled VFX —
// it is "of the 477 meshes the light rig can actually shade, a meaningful
// fraction were opted out of shadowing by omission". No amount of bias tuning
// or filter work can put a shadow on a surface whose `receiveShadow` is false;
// the fragment never samples the map. And it is a renderer-contract problem
// rather than an authoring one: every stream adds meshes and each one has to
// remember two booleans, so the flags drift out of date the moment anybody
// adds a prop.
//
// So the contract is enforced here instead of being asked for 1300 times.
// The pass opts a mesh IN by default and opts it OUT only for the cases where
// shadowing is wrong rather than merely absent:
//
//   - additive / non-normal blending, or a transparent material that does not
//     write depth — VFX cards, energy shells, god-ray cones, the skybox. An
//     additive card that receives a shadow goes *dark* where it should be
//     bright, and one that casts throws a solid black rectangle.
//   - unlit materials (MeshBasicMaterial and friends have no lighting term, so
//     receiving does nothing, and an emissive fixture casting a shadow of
//     itself is a bug).
//   - Sprites, Points and Lines, which have no shadow path at all.
//   - anything explicitly marked `userData.auricNoShadow`, which is the
//     escape hatch for other streams: set it and this pass leaves the object
//     alone in both directions.
//
// Two properties make this cheap enough to run on a live scene:
//   - in three r185 `receiveShadow` is a plain uniform (WebGLRenderer.js:2687),
//     not a program define, so flipping it recompiles nothing. Making it
//     UNIFORM across a shared material can only reduce the program count,
//     never raise it.
//   - a WeakSet remembers every object already decided, so the steady-state
//     cost is one `has()` per object and the pass only does real work for
//     meshes that streamed in since the last sweep.
//
// It re-sweeps on an interval rather than once at mount because the level,
// the enemies and the pooled VFX all appear after the first frame.
// ---------------------------------------------------------------------------
const SHADOW_SWEEP_SEC = 0.75
/** world-space bounding radius below which a mesh is not promoted to a caster */
const CASTER_MIN_RADIUS = 0.34

function opaqueLit(m: THREE.Material): boolean {
  const any = m as THREE.Material & {
    isMeshBasicMaterial?: boolean
    isPointsMaterial?: boolean
    isSpriteMaterial?: boolean
    isLineBasicMaterial?: boolean
    isShaderMaterial?: boolean
    isRawShaderMaterial?: boolean
  }
  // unlit: nothing to shade, and a glowing fixture must not throw a shadow
  if (any.isMeshBasicMaterial || any.isPointsMaterial || any.isSpriteMaterial) return false
  if (any.isLineBasicMaterial) return false
  // hand-written shaders do their own lighting (or none) — leave them alone
  if (any.isShaderMaterial || any.isRawShaderMaterial) return false
  if (m.blending !== THREE.NormalBlending) return false
  if (m.transparent && m.depthWrite === false) return false
  return true
}

function sweepShadowFlags(scene: THREE.Scene, seen: WeakSet<THREE.Object3D>) {
  scene.traverse((o) => {
    if (seen.has(o)) return
    const mesh = o as THREE.Mesh & { isMesh?: boolean; isSkinnedMesh?: boolean }
    if (!mesh.isMesh) return
    seen.add(o)
    if (o.userData?.auricNoShadow) return
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    let ok = mats.length > 0
    for (const m of mats) {
      if (!m || !opaqueLit(m)) {
        ok = false
        break
      }
    }
    if (!ok) return
    // RECEIVING is free — it is one uniform and one extra texture fetch on a
    // fragment that is already being shaded, so every opaque lit surface in
    // the game gets it unconditionally. This is the half of the fix that
    // actually makes shadows appear.
    mesh.receiveShadow = true
    // CASTING is not free: it is a whole extra draw per shadow map, and a
    // 3 cm trim bead is a caster that costs a draw call to contribute a
    // sub-texel smudge and some acne. So casting is promoted only for
    // geometry big enough to throw a shadow a player can point at — columns,
    // ribs, pendants, planters — measured off the geometry's own bounding
    // sphere, scaled into world units.
    if (!mesh.castShadow) {
      const g = mesh.geometry
      if (!g) return
      if (g.boundingSphere === null) g.computeBoundingSphere()
      const r = g.boundingSphere?.radius ?? 0
      const s = mesh.matrixWorld.getMaxScaleOnAxis()
      if (r * s >= CASTER_MIN_RADIUS) mesh.castShadow = true
    }
  })
}

function ShadowContract() {
  const seen = useRef<WeakSet<THREE.Object3D>>(new WeakSet())
  const acc = useRef(SHADOW_SWEEP_SEC)
  useFrame(({ scene }, delta) => {
    acc.current += delta
    if (acc.current < SHADOW_SWEEP_SEC) return
    acc.current = 0
    sweepShadowFlags(scene, seen.current)
  })
  return null
}

/** QA capture mode (?qa=1): pin quality tier 0 so screenshots show the real
 * art direction even on software renderers that never reach 45 fps. */
const QA_CAPTURE =
  typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('qa')

function QualityWatcher() {
  const acc = useRef({ warmup: FPS_WARMUP_SEC, windowT: 0, frames: 0 })

  useFrame(({ scene, setDpr }, delta) => {
    if (QA_CAPTURE) return
    const a = acc.current
    if (a.warmup > 0) {
      a.warmup -= delta
      return
    }
    a.windowT += delta
    a.frames++
    if (a.windowT < FPS_WINDOW_SEC) return

    const fps = a.frames / a.windowT
    a.windowT = 0
    a.frames = 0

    const store = useGameStore.getState()
    const tier = store.qualityTier
    if (fps >= FPS_FLOOR || tier >= 2) return

    const next = (tier + 1) as 1 | 2
    store.setQualityTier(next)
    // setDpr applies the pixel ratio AND resizes the drawing buffer
    setDpr(next === 1 ? RENDERER.lowSpecResolutionScale : 0.5)
    shedShadows(scene, next)
  })

  return null
}

/**
 * DROPSHIP intro skip: Space / click / Esc jumps straight to INFILTRATE.
 * CameraRig sees the phase change mid-intro and snaps the boom to the
 * gameplay position. Mounted before GameTick so edges are read before
 * Input.endFrame() clears them.
 */
function IntroSkipper() {
  useFrame(() => {
    if (useGameStore.getState().phase !== 'DROPSHIP') return
    if (Input.pressed('jump') || Input.pressed('fire') || Input.pressed('pause')) {
      useGameStore.getState().setPhase('INFILTRATE')
      AudioBus.playUIClick()
    }
  })
  return null
}

/** QA/debug hook surface (exposed in every build — dev AND preview). */
interface QaWindow extends Window {
  __gameStore?: typeof useGameStore
  __playerRef?: typeof PlayerRef
  __qa?: {
    setPhase: (p: Parameters<ReturnType<typeof useGameStore.getState>['setPhase']>[0]) => void
    teleport: (x: number, y: number, z: number) => void
    grantEnergy: () => void
    /** aim the camera at a world point (sets CamRef yaw/pitch from the player head) */
    lookAt: (x: number, y: number, z: number) => void
    /** [id, type, alive, [x,y,z]] for every registered enemy (combat evidence) */
    enemyPositions: () => [number, string, boolean, number[]][]
    /** ?qa=1 only — light-transport measurements (set by QaBridge) */
    lightReport?: () => unknown
    /** ?qa=1 only — set by QaBridge */
    gl?: THREE.WebGLRenderer
    scene?: THREE.Scene
    camera?: THREE.Camera
    setFixedDt?: (dt: number | null) => void
    setShadows?: (on: boolean) => void
  }
}


/**
 * QA bridge (?qa=1 only). Exposes the renderer/scene/camera on window.__qa and
 * allows pinning a fixed per-frame delta. R3F computes one delta per frame via
 * clock.getDelta() and hands the same value to every useFrame subscriber, so
 * patching it here drives the whole simulation at a deterministic step —
 * screenshots of 0.3 s VFX are reproducible on software renderers that run at
 * a fraction of a frame per second.
 */
function QaBridge() {
  const { gl, scene, camera, clock } = useThree()
  useEffect(() => {
    if (!QA_CAPTURE) return
    const w = window as QaWindow & { __qaGl?: unknown }
    const orig = clock.getDelta.bind(clock)
    let fixed: number | null = null
    clock.getDelta = () => {
      const real = orig()
      return fixed === null ? real : fixed
    }
    const q = w.__qa
    if (q) {
      q.gl = gl
      q.scene = scene
      q.camera = camera
      q.setFixedDt = (dt: number | null) => {
        fixed = dt
      }
      // light-transport instrumentation. The whole axis is a set of ratios
      // (key vs fill, casters vs receivers, shadow texel size), so the numbers
      // that decide whether it worked are read straight off the live graph
      // rather than eyeballed from a capture.
      q.lightReport = () => {
        let meshes = 0
        let cast = 0
        let receive = 0
        const lights: Record<string, unknown>[] = []
        let keyIntensity = 0
        let fillSum = 0
        let apertureIrradiance = 0
        let apertureCount = 0
        let shadowCasters = 0
        // the denominators that matter: an unlit material has no lighting term,
        // so counting it in a shadow-participation ratio flatters the number
        let litMeshes = 0
        let litReceive = 0
        let litCast = 0
        let unlitMeshes = 0
        scene.traverse((o) => {
          const m = o as THREE.Mesh
          if (m.isMesh) {
            meshes++
            if (m.castShadow) cast++
            if (m.receiveShadow) receive++
            const mm = Array.isArray(m.material) ? m.material[0] : m.material
            const lit = !!mm && !!(mm as THREE.MeshStandardMaterial).isMeshStandardMaterial
            if (lit) {
              litMeshes++
              if (m.receiveShadow) litReceive++
              if (m.castShadow) litCast++
            } else if (mm) unlitMeshes++
          }
          const l = o as THREE.Light & {
            isLight?: boolean
            shadow?: THREE.LightShadow
            distance?: number
          }
          if (!l.isLight) return
          const role = l.userData?.auricRole ?? 'other'
          if (l.castShadow) shadowCasters++
          if (role === 'key') keyIntensity += l.intensity
          else if (role === 'aperture') {
            // a spot's `intensity` is candela over its whole throw, so adding
            // it to a directional light's irradiance is a category error. The
            // rig publishes the irradiance each aperture actually lands on the
            // floor below it, which IS comparable with the key.
            apertureIrradiance += (l.userData?.auricFloorIrradiance as number) ?? 0
            apertureCount++
          } else fillSum += l.intensity
          lights.push({
            type: l.type,
            role,
            intensity: +l.intensity.toFixed(3),
            castShadow: l.castShadow === true,
            mapSize: l.shadow ? l.shadow.mapSize.x : 0,
            radius: l.shadow ? l.shadow.radius : 0,
          })
        })
        return {
          shadowMapEnabled: gl.shadowMap.enabled,
          shadowMapType: gl.shadowMap.type,
          pcss: PCSS_INSTALLED,
          toneMapping: gl.toneMapping,
          exposure: gl.toneMappingExposure,
          outputColorSpace: gl.outputColorSpace,
          meshes,
          castShadow: cast,
          receiveShadow: receive,
          litMeshes,
          unlitMeshes,
          litReceive,
          litCast,
          /** the number the R4 shadow contract exists to move, over the only
           *  denominator that means anything: meshes a light can shade */
          litReceivePct: +((100 * litReceive) / Math.max(litMeshes, 1)).toFixed(1),
          litCastPct: +((100 * litCast) / Math.max(litMeshes, 1)).toFixed(1),
          shadowCasters,
          apertureCount,
          apertureIrradiance: +apertureIrradiance.toFixed(3),
          keyIntensity: +keyIntensity.toFixed(3),
          nonKeyIntensity: +fillSum.toFixed(3),
          keyOverFill: +(keyIntensity / Math.max(fillSum, 1e-6)).toFixed(3),
          environmentIntensity: scene.environmentIntensity,
          hasEnvironment: scene.environment !== null,
          lights,
        }
      }
      q.setShadows = (on: boolean) => {
        gl.shadowMap.enabled = on
        scene.traverse((o) => {
          const l = o as THREE.DirectionalLight
          if (l.isDirectionalLight) l.castShadow = on
        })
      }
    }
    return () => {
      clock.getDelta = orig
    }
  }, [gl, scene, camera, clock])
  return null
}

export default function GameCanvas() {
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = wrapRef.current?.querySelector('canvas')
    if (el instanceof HTMLElement) Input.attach(el)
    return () => Input.detach()
  }, [])

  // QA / screenshot-script hooks — unconditional (tiny cost), so preview
  // builds can jump phases and teleport without a dev-only bundle.
  useEffect(() => {
    const w = window as QaWindow
    w.__gameStore = useGameStore
    w.__playerRef = PlayerRef
    w.__qa = {
      setPhase: (p) => useGameStore.getState().setPhase(p),
      teleport: (x, y, z) => {
        PlayerRef.position.set(x, y, z)
        PlayerRef.velocity.set(0, 0, 0)
      },
      grantEnergy: () => useGameStore.getState().addEnergy(PLAYER.maxEnergy),
      // camera faces (x,y,z): invert the CameraRig look basis
      // (_look = (-sin yaw · cos p, sin p, -cos yaw · cos p)) from the head
      lookAt: (x, y, z) => {
        const dx = x - PlayerRef.position.x
        const dy = y - (PlayerRef.position.y + 1.6) // head height
        const dz = z - PlayerRef.position.z
        const len = Math.hypot(dx, dy, dz)
        if (len < 1e-4) return
        CamRef.pitch = Math.asin(dy / len)
        CamRef.yaw = Math.atan2(-dx, -dz)
      },
      enemyPositions: () =>
        EnemyRegistry.list().map((e) => [e.id, e.type, e.alive, e.position.toArray()]),
    }
    return () => {
      delete w.__gameStore
      delete w.__playerRef
      delete w.__qa
    }
  }, [])

  return (
    <div
      ref={wrapRef}
      style={{ position: 'fixed', inset: 0, zIndex: 0 }}
      onPointerDown={() => AudioBus.unlock()}
    >
      <Canvas
        shadows={{ type: AURIC_SHADOW_TYPE }}
        dpr={[1, 2]}
        gl={{
          antialias: false, // SMAA in the post stack handles AA
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: LIGHTING.exposure,
          outputColorSpace: THREE.SRGBColorSpace,
          powerPreference: 'high-performance',
          // QA capture only: without a preserved drawing buffer a screenshot
          // taken between frames grabs a cleared surface, which banked four
          // all-black frames in the round 3 review as if they were renders.
          preserveDrawingBuffer: QA_CAPTURE,
        }}
        camera={{ fov: RENDERER.fov, near: 0.1, far: 400, position: [0, 3, 8] }}
      >
        {/* world */}
        <Skybox />
        <Fog />
        <Lighting />
        <ShrineStation />
        <EnvironmentFX />
        <ColliderDebug />

        {/* player */}
        <PlayerController />
        <PlayerRig />
        <CameraRig />

        {/* combat */}
        <CombatSystems />
        <WeaponViewModel />

        {/* enemies */}
        <EnemyManager />

        {/* mission */}
        <MissionDirector />
        <ObjectiveMarker />

        {/* vfx */}
        <VFXSystems />

        {/* renderer contract: every opaque lit mesh casts and receives */}
        <ShadowContract />

        {/* adaptive quality + intro skip (mounted before GameTick) */}
        <QualityWatcher />
        <IntroSkipper />

        {/* frame-end orchestrator (mounted last → runs last at priority 0) */}
        <GameTick />
        <QaBridge />

        <PostFX />
      </Canvas>
    </div>
  )
}

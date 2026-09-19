/**
 * AURIC VOW — GameCanvas.tsx
 * R3F canvas host. Renderer config per design.md §2.3/§7.
 * Scene composition per design.md §1.2: world → player → combat → enemies →
 * mission → vfx, then the frame-end GameTick orchestrator.
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
import { CombatSystems, WeaponViewModel, resetCombat } from './combat'
import { EnemyManager, EnemyRegistry } from './enemies'
import { MissionDirector, ObjectiveMarker } from './mission'
import { VFXSystems } from './vfx'
import { setEnemiesAlive } from './hud'

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

function disableKeyShadows(scene: THREE.Scene) {
  scene.traverse((o) => {
    const l = o as THREE.DirectionalLight
    if (l.isDirectionalLight && l.castShadow) {
      l.castShadow = false
      l.shadow.map?.dispose()
      l.shadow.map = null
    }
  })
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
    disableKeyShadows(scene)
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
        shadows={{ type: THREE.PCFSoftShadowMap }}
        dpr={[1, 2]}
        gl={{
          antialias: false, // SMAA in the post stack handles AA
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: LIGHTING.exposure,
          outputColorSpace: THREE.SRGBColorSpace,
          powerPreference: 'high-performance',
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

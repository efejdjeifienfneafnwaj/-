/* eslint-disable react-refresh/only-export-components -- module exports shared combat helpers alongside the system component */
/**
 * AURIC VOW — combat/Weapons.tsx
 * "Vow" hitscan auto-rifle + "Last Word" katana. Spec: combat.md §1–2, §5.
 *
 * Rifle: 14 dmg (×2 headshot) / 10 rps / 60 mag / 1.4s auto-reload,
 * 120 m range with 100%→70% falloff beyond 40 m, spread bloom model,
 * golden moving-head tracers, muzzle flash via VFX + view-model star quad,
 * wall-blocked via raycastLevel.
 *
 * Katana: F/MMB 3-hit combo (55/65/90), 140°/120°/100° arcs, 4 m target
 * magnetism lunge at 16 m/s, golden ribbon trail via VFX.trail, hitstop on
 * connect (60 ms, finisher 90 ms), air-slam shockwave variant.
 */
import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { Input } from '@/game/Input'
import { AudioBus } from '@/game/AudioBus'
import { VFX } from '@/game/vfx/VFXBus'
import { PlayerRef } from '@/game/player/PlayerRef'
import { addTrauma, CamRef } from '@/game/player/CameraRig'
import { MOVE } from '@/game/player/movementConfig'
import { EnemyRegistry } from '@/game/enemies/EnemyRegistry'
import { raycastLevel } from '@/game/world/Colliders'
import { COLORS, COMBATFX, TIMESCALE, WEAPONS } from '@/game/config'
import { useGameStore } from '@/game/store'
import { ImpactFx, raycastEnemies, resolveEnemyHit, rifleFalloff, RIFLE_RANGE } from './DamageSystem'
import { CombatState, canFight, combatTick } from './state'
import { ammoState, consumeAmmo, startReload } from '@/game/hud/ammoState'
import { PlayerSockets } from '@/game/player/PlayerRig'

const RIFLE = WEAPONS.rifle
const KATANA = WEAPONS.katana
const DEG = Math.PI / 180
const UP = new THREE.Vector3(0, 1, 0)

/**
 * Grip-space muzzle offset — the barrel tip of the re-authored rifle, which is
 * modelled around a grip origin at (0,0,0) with the bore along -Z
 * (ViewModel.tsx). The view model publishes the real mesh position into
 * `MuzzleWorld` every frame; this constant is only the local anchor the flash
 * meshes are parented at. It is NOT a fallback: see `getMuzzleWorld`.
 */
export const MUZZLE_LOCAL = new THREE.Vector3(0, 0.055, -0.62)

// katana tuning (combat.md §2)
//
// [combat-feel R2] Durations re-authored to the 3-key curve the review asked
// for (work order combat-feel #1): 120 ms wind-up, a 60 ms contact window and
// a 200 ms follow-through = 380 ms. A 220 ms swing at a constant rate has no
// readable moment of impact; this one does, and `swingPhase()` below is the
// curve every consumer (arc strip, ribbon, blade mesh, damage) shares.
const SWING_TOTAL =
  COMBATFX.swing.windupSec + COMBATFX.swing.contactSec + COMBATFX.swing.followSec
const SWING_DUR = [SWING_TOTAL, SWING_TOTAL, SWING_TOTAL * 1.16] as const
const SWING_ARC_DEG = [140, 120, 100] as const
/** fraction of a swing spent winding up — the frame the edge lands on */
const SWING_CONTACT_AT = COMBATFX.swing.windupSec / SWING_TOTAL
/** fraction of a swing at which the contact window closes (lunge ends here) */
const SWING_CONTACT_END =
  (COMBATFX.swing.windupSec + COMBATFX.swing.contactSec) / SWING_TOTAL
/**
 * [combat-feel R2] 2.6 → 2.0 m. The arc now describes an actual 1.16 m blade
 * swung from the hand socket, so the damage volume has to shrink with it or
 * the crescent and the kill stop agreeing.
 */
const SWING_RANGE = 2.0
/**
 * Blade roll (about the blade axis) per combo step, so the EDGE leads the cut
 * instead of `lookAt()` picking an arbitrary roll off world up (weakness C11).
 * After lookAt the rig's local +X is the sweep tangent, so +90° rolls the ha
 * (local -Y) onto it. The overhead chop already leads with -Y.
 */
const SWING_ROLL = [Math.PI / 2, -Math.PI / 2, 0] as const
const CHAIN_WINDOW = 0.5
const LUNGE_SPEED = 16
const LUNGE_RANGE = KATANA.lungeRange // 4 m
const LUNGE_HALF_ANGLE = 60 * DEG
const SLAM_RADIUS = 3
const SLAM_DMG = 40
const SLAM_MIN_FALL = 5

// scratch
const _dir = new THREE.Vector3()
const _right = new THREE.Vector3()
const _upv = new THREE.Vector3()
const _origin = new THREE.Vector3()
const _muzzle = new THREE.Vector3()
const _end = new THREE.Vector3()
const _to = new THREE.Vector3()
const _pt = new THREE.Vector3()
const _hitPt = new THREE.Vector3()
const _kb = new THREE.Vector3()
const _normal = new THREE.Vector3()
const _reflect = new THREE.Vector3()
const _sweep = new THREE.Vector3()
const _guard = new THREE.Vector3()
const _camFwd = new THREE.Vector3()
const _camRel = new THREE.Vector3()

// ---------------------------------------------------------------------------
// Tracer pool — travelling bolts, not 1-frame streaks.
//
// [combat-feel R1] The old pool died after 0.09 s, i.e. 36 m of a 120 m
// weapon (weakness C3), so nothing was ever mid-flight when a frame was
// captured. Life is derived from the actual shot distance and the bolt is
// retired only once the TAIL has reached the impact point.
//
// [combat-feel R2] 180 m/s over a 14 m segment drew a fourteen-metre LASER
// lying across the frame — the shape of a beam weapon, not of a projectile.
// Work order combat-feel #6: 280 m/s over 3.2 m, i.e. a short fast object
// with a head, and the on-screen width floor cut 6 px → 3 px so the bolt
// stops fattening into a rod at distance.
//
// Each bolt is the three-layer energy shell plus a head, so it reads as a
// projectile rather than a line:
//   core    thread-thin white cylinder, tapered to nothing at the tail
//   mid     saturated aureate band, rolled about the bolt axis to face the
//           camera, soft across its width and ramped down its length
//   outer   a wide, very dim falloff band — the bolt's atmosphere
//   head    additive sprite: the bolt itself, the thing the eye tracks
// ---------------------------------------------------------------------------

const TRACER_COUNT = 28
const TRACER_SPEED = COMBATFX.tracer.speed
const TRACER_SEG = COMBATFX.tracer.segment
const TRACER_CORE_R = 0.016
const TRACER_MID_R = 0.07
const TRACER_OUTER_R = 0.2
/** minimum on-screen mid width (px): distant bolts must never sub-pixel out */
const TRACER_MIN_PX = COMBATFX.tracer.minPx

interface Tracer {
  group: THREE.Group
  core: THREE.Mesh
  halo: THREE.Mesh
  outer: THREE.Mesh
  head: THREE.Sprite
  coreMat: THREE.MeshBasicMaterial
  haloMat: THREE.MeshBasicMaterial
  outerMat: THREE.MeshBasicMaterial
  headMat: THREE.SpriteMaterial
  active: boolean
  start: THREE.Vector3
  dir: THREE.Vector3
  dist: number
  travel: number
  life: number
}

/** tapered core: radius 1 at the head (+Y), 0.22 at the tail */
const tracerCoreGeo = new THREE.CylinderGeometry(1, 0.22, 1, 8, 1, true)
tracerCoreGeo.translate(0, 0.5, 0) // pivot at the tail: scale.y = segment length

/**
 * Band quad shared by the mid and outer bolt layers: unit square, pivot at the
 * tail, vertex alpha ramped to nothing down the tail (the length taper the
 * work order asks for) and a soft cross-section supplied by `getBandTexture`
 * so the band is never a hard-edged rectangle under bloom.
 */
const tracerHaloGeo = new THREE.PlaneGeometry(1, 1)
tracerHaloGeo.translate(0, 0.5, 0)
tracerHaloGeo.setAttribute(
  'color',
  // PlaneGeometry emits +Y row first: verts 0,1 = head, verts 2,3 = tail
  new THREE.BufferAttribute(
    new Float32Array([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 0]),
    4,
  ),
)

/** 32×4 cross-section falloff: transparent → hot centre → transparent. */
let bandTex: THREE.CanvasTexture | null = null
function getBandTexture(): THREE.CanvasTexture {
  if (bandTex) return bandTex
  const w = 32
  const c = document.createElement('canvas')
  c.width = w
  c.height = 4
  const ctx = c.getContext('2d')!
  const g = ctx.createLinearGradient(0, 0, w, 0)
  g.addColorStop(0, 'rgba(255,255,255,0)')
  g.addColorStop(0.32, 'rgba(255,236,196,0.55)')
  g.addColorStop(0.5, 'rgba(255,255,255,1)')
  g.addColorStop(0.68, 'rgba(255,236,196,0.55)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, 4)
  bandTex = new THREE.CanvasTexture(c)
  bandTex.colorSpace = THREE.SRGBColorSpace
  bandTex.wrapS = THREE.ClampToEdgeWrapping
  bandTex.wrapT = THREE.ClampToEdgeWrapping
  return bandTex
}

/** 64² hot round bolt head (white core → aureate falloff). */
let boltTex: THREE.CanvasTexture | null = null
function getBoltTexture(): THREE.CanvasTexture {
  if (boltTex) return boltTex
  const size = 64
  const c = document.createElement('canvas')
  c.width = size
  c.height = size
  const ctx = c.getContext('2d')!
  const cx = size / 2
  const g = ctx.createRadialGradient(cx, cx, 0, cx, cx, cx)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.28, 'rgba(255,243,214,0.95)')
  g.addColorStop(0.6, 'rgba(255,184,53,0.35)')
  g.addColorStop(1, 'rgba(255,184,53,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  boltTex = new THREE.CanvasTexture(c)
  boltTex.colorSpace = THREE.SRGBColorSpace
  return boltTex
}

function makeTracers(): Tracer[] {
  return Array.from({ length: TRACER_COUNT }, () => {
    const coreMat = new THREE.MeshBasicMaterial({
      color: COLORS.solarWhite,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    })
    const haloMat = new THREE.MeshBasicMaterial({
      map: getBandTexture(),
      color: COLORS.aureate,
      transparent: true,
      opacity: 0,
      vertexColors: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    })
    const outerMat = new THREE.MeshBasicMaterial({
      map: getBandTexture(),
      color: COLORS.aureate,
      transparent: true,
      opacity: 0,
      vertexColors: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    })
    const headMat = new THREE.SpriteMaterial({
      map: getBoltTexture(),
      color: COLORS.solarWhite,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    })
    const core = new THREE.Mesh(tracerCoreGeo, coreMat)
    const halo = new THREE.Mesh(tracerHaloGeo, haloMat)
    const outer = new THREE.Mesh(tracerHaloGeo, outerMat)
    const head = new THREE.Sprite(headMat)
    head.renderOrder = 21
    const group = new THREE.Group()
    // draw order: wide falloff first, then the saturated band, then the core
    group.add(outer, halo, core)
    group.visible = false
    head.visible = false
    return {
      group,
      core,
      halo,
      outer,
      head,
      coreMat,
      haloMat,
      outerMat,
      headMat,
      active: false,
      start: new THREE.Vector3(),
      dir: new THREE.Vector3(),
      dist: 0,
      travel: 0,
      life: 0,
    }
  })
}

function spawnTracer(pool: Tracer[], from: THREE.Vector3, to: THREE.Vector3) {
  const t = pool.find((x) => !x.active)
  if (!t) return
  t.active = true
  t.start.copy(from)
  t.dir.copy(to).sub(from)
  t.dist = t.dir.length()
  if (t.dist > 0.001) t.dir.divideScalar(t.dist)
  t.group.quaternion.setFromUnitVectors(UP, t.dir)
  t.travel = 0
  // flight time + the time the tail needs to catch up, plus slack: the bolt is
  // actually retired by `tail >= dist`; this is only a runaway guard.
  t.life = t.dist / TRACER_SPEED + TRACER_SEG / TRACER_SPEED + 0.25
  t.group.visible = true
  t.head.visible = true
}

const _tracerMid = new THREE.Vector3()
const _tracerCamLocal = new THREE.Vector3()
const _tracerQInv = new THREE.Quaternion()

function updateTracers(pool: Tracer[], dt: number, camera: THREE.Camera, viewportH: number) {
  // world metres per screen pixel at 1 m — used to clamp bolt width on screen
  const persp = camera as THREE.PerspectiveCamera
  const fov = persp.isPerspectiveCamera ? persp.fov : 70
  const pxScale = viewportH > 0 ? (2 * Math.tan((fov * DEG) / 2)) / viewportH : 0

  for (const t of pool) {
    if (!t.active) continue
    t.travel += TRACER_SPEED * dt
    t.life -= dt
    const head = Math.min(t.travel, t.dist)
    const tail = Math.max(0, t.travel - TRACER_SEG)
    if (tail >= t.dist || t.life <= 0) {
      t.active = false
      t.group.visible = false
      t.head.visible = false
      continue
    }
    const len = Math.max(0.05, head - tail)
    t.group.position.copy(t.start).addScaledVector(t.dir, tail)

    // screen-space width floor so a 100 m bolt still covers ~3 px
    _tracerMid.copy(t.group.position).addScaledVector(t.dir, len * 0.5)
    const camDist = _tracerMid.distanceTo(camera.position)
    const minW = TRACER_MIN_PX * pxScale * camDist
    const midW = Math.max(TRACER_MID_R * 2, minW)
    const outerW = Math.max(TRACER_OUTER_R * 2, minW * 2.6)
    const coreR = Math.max(TRACER_CORE_R, minW * 0.13)

    t.core.scale.set(coreR, len, coreR)
    t.halo.scale.set(midW, len, 1)
    t.outer.scale.set(outerW, len, 1)

    // roll both bands about the bolt axis so they always face the camera
    _tracerCamLocal
      .copy(camera.position)
      .sub(t.group.position)
      .applyQuaternion(_tracerQInv.copy(t.group.quaternion).invert())
    const roll = Math.atan2(_tracerCamLocal.x, _tracerCamLocal.z)
    t.halo.rotation.y = roll
    t.outer.rotation.y = roll

    // fade only over the last segment, as the tail runs into the impact point
    const endFade = THREE.MathUtils.clamp((t.dist - tail) / TRACER_SEG, 0, 1)
    t.coreMat.opacity = endFade
    t.haloMat.opacity = 0.85 * endFade
    t.outerMat.opacity = 0.2 * endFade

    // bolt head sprite: rides the leading edge until it lands
    if (head < t.dist - 0.01) {
      t.head.visible = true
      t.head.position.copy(t.start).addScaledVector(t.dir, head)
      t.head.scale.setScalar(Math.max(0.22, 7 * pxScale * camDist))
      t.headMat.opacity = 1
    } else {
      t.head.visible = false
    }
  }
}

// ---------------------------------------------------------------------------
// Hot line — the one-frame streak muzzle → impact
//
// [combat-feel R2, work order combat-feel #6] A bolt that takes 0.3 s to
// arrive gives the trigger frame nothing to show: the muzzle lights up and
// then nothing happens for ten frames, which is why the round 2 shots read as
// if the gun were not firing. A hitscan weapon needs the instantaneous
// "line drawn to the target" read on the trigger frame as well as the
// travelling bolt. This is that line: a thread-thin additive cylinder from
// the real barrel tip to the real impact point, alive for ~50 ms.
// ---------------------------------------------------------------------------

const HOTLINE_COUNT = 6

interface HotLine {
  mesh: THREE.Mesh
  mat: THREE.MeshBasicMaterial
  active: boolean
  age: number
}

/** unit cylinder along +Y, pivot at the base: scale.y = length */
const hotLineGeo = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true)
hotLineGeo.translate(0, 0.5, 0)

function makeHotLines(): HotLine[] {
  return Array.from({ length: HOTLINE_COUNT }, () => {
    const mat = new THREE.MeshBasicMaterial({
      color: COLORS.solarWhite,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    })
    const mesh = new THREE.Mesh(hotLineGeo, mat)
    mesh.frustumCulled = false
    mesh.renderOrder = 20
    mesh.visible = false
    return { mesh, mat, active: false, age: 0 }
  })
}

const _lineDir = new THREE.Vector3()

function spawnHotLine(pool: HotLine[], from: THREE.Vector3, to: THREE.Vector3) {
  const l = pool.find((x) => !x.active) ?? pool[0]!
  _lineDir.copy(to).sub(from)
  const len = _lineDir.length()
  if (len < 0.05) return
  _lineDir.divideScalar(len)
  l.active = true
  l.age = 0
  l.mesh.visible = true
  l.mesh.position.copy(from)
  l.mesh.quaternion.setFromUnitVectors(UP, _lineDir)
  l.mesh.scale.set(COMBATFX.tracer.lineRadius, len, COMBATFX.tracer.lineRadius)
  l.mat.opacity = 1
}

function updateHotLines(pool: HotLine[], dt: number) {
  for (const l of pool) {
    if (!l.active) continue
    l.age += dt
    const t = l.age / COMBATFX.tracer.lineLifeSec
    if (t >= 1) {
      l.active = false
      l.mesh.visible = false
      l.mat.opacity = 0
      continue
    }
    // hold for the first third so a 33 ms capture step cannot miss it
    l.mat.opacity = t < 0.34 ? 1 : 1 - (t - 0.34) / 0.66
    // the line thins as it dies rather than just dimming
    l.mesh.scale.x = l.mesh.scale.z = COMBATFX.tracer.lineRadius * (1 - t * 0.6)
  }
}

// ---------------------------------------------------------------------------
// Deferred impact FX — the bolt has to ARRIVE before the wall lights up
//
// [combat-feel R1, weakness C3] Impact VFX used to fire on the same frame as
// the trace, so a 90 m shot flashed the wall half a second before the tracer
// got there. Damage stays instant (gameplay + hitmarker must not lag); the
// *visual* wall/miss response is queued at dist / TRACER_SPEED.
// ---------------------------------------------------------------------------

const IMPACT_QUEUE = 24

interface PendingImpact {
  active: boolean
  at: number
  hit: boolean
  point: THREE.Vector3
  normal: THREE.Vector3
  dir: THREE.Vector3
}

function makeImpactQueue(): PendingImpact[] {
  return Array.from({ length: IMPACT_QUEUE }, () => ({
    active: false,
    at: 0,
    hit: false,
    point: new THREE.Vector3(),
    normal: new THREE.Vector3(0, 1, 0),
    dir: new THREE.Vector3(0, 0, -1),
  }))
}

function scheduleImpact(
  q: PendingImpact[],
  clock: number,
  travel: number,
  hit: boolean,
  point: THREE.Vector3,
  normal: THREE.Vector3,
  dir: THREE.Vector3,
) {
  const slot = q.find((x) => !x.active) ?? q[0]!
  slot.active = true
  slot.at = clock + travel
  slot.hit = hit
  slot.point.copy(point)
  slot.normal.copy(normal)
  slot.dir.copy(dir)
}

// ---------------------------------------------------------------------------
// Gunplay feedback pools — muzzle light, brass shell casings, scorch decals.
// All pooled, zero runtime allocation after construction.
// ---------------------------------------------------------------------------

/** 128² dark radial char blotch (scorch decal, normal blending). */
let scorchTex: THREE.CanvasTexture | null = null
function getScorchTexture(): THREE.CanvasTexture {
  if (scorchTex) return scorchTex
  const size = 128
  const c = document.createElement('canvas')
  c.width = size
  c.height = size
  const ctx = c.getContext('2d')!
  const cx = size / 2
  const g = ctx.createRadialGradient(cx, cx, 0, cx, cx, size * 0.5)
  g.addColorStop(0, 'rgba(8,6,4,0.95)')
  g.addColorStop(0.45, 'rgba(12,9,6,0.75)')
  g.addColorStop(0.8, 'rgba(10,8,5,0.25)')
  g.addColorStop(1, 'rgba(10,8,5,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  // ragged char edges — short dark strokes radiating out
  ctx.strokeStyle = 'rgba(8,6,4,0.5)'
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + (i % 2 ? 0.2 : 0)
    ctx.lineWidth = 2 + (i % 3)
    ctx.beginPath()
    ctx.moveTo(cx + Math.cos(a) * size * 0.18, cx + Math.sin(a) * size * 0.18)
    ctx.lineTo(cx + Math.cos(a) * size * (0.34 + (i % 3) * 0.04), cx + Math.sin(a) * size * (0.34 + (i % 3) * 0.04))
    ctx.stroke()
  }
  scorchTex = new THREE.CanvasTexture(c)
  scorchTex.colorSpace = THREE.SRGBColorSpace
  return scorchTex
}

// ---- brass shell casings: instanced lit cylinders, 1.2 s life, pool 28 ----
// [combat-feel R1, weakness C13] flat unlit rects that never landed → real
// brass: metalness 0.9 so the muzzle light glints off them, ejected from the
// receiver (not the muzzle) with a lateral impulse and tumble, 1.2 s life.
const SHELL_COUNT = 28
const SHELL_LIFE = 1.2
const SHELL_GRAVITY = 14

interface ShellState {
  active: boolean
  life: number
  pos: THREE.Vector3
  vel: THREE.Vector3
  axis: THREE.Vector3
  spin: number
  angle: number
}

interface GunFx {
  /** 2-frame muzzle point light: the shot lights the weapon and the walls */
  light: THREE.PointLight
  lightAge: number
  shells: THREE.InstancedMesh
  shellState: ShellState[]
  shellDummy: THREE.Object3D
  scorches: {
    mesh: THREE.Mesh
    mat: THREE.MeshBasicMaterial
    active: boolean
    age: number
  }[]
}

const SCORCH_COUNT = 32
const SCORCH_LIFE = 6

function makeGunFx(): GunFx {
  // 2-frame muzzle light (work order combat-feel #5). Kept permanently in the
  // scene at intensity 0 so the light count — and therefore every material's
  // shader permutation — never changes mid-mission.
  const light = new THREE.PointLight('#FFE9C4', 0, COMBATFX.muzzle.distance, 2)
  light.castShadow = false

  const shellGeo = new THREE.CylinderGeometry(0.0115, 0.0125, 0.052, 7, 1)
  const shellMat = new THREE.MeshStandardMaterial({
    color: 0xc9962e, // brushed brass
    metalness: 0.9,
    roughness: 0.28,
  })
  const shells = new THREE.InstancedMesh(shellGeo, shellMat, SHELL_COUNT)
  shells.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  shells.frustumCulled = false
  const shellDummy = new THREE.Object3D()
  const shellState: ShellState[] = Array.from({ length: SHELL_COUNT }, () => ({
    active: false,
    life: 0,
    pos: new THREE.Vector3(),
    vel: new THREE.Vector3(),
    axis: new THREE.Vector3(1, 0, 0),
    spin: 0,
    angle: 0,
  }))
  // park all instances at zero scale
  for (let i = 0; i < SHELL_COUNT; i++) {
    shellDummy.position.set(0, -100, 0)
    shellDummy.scale.setScalar(0.0001)
    shellDummy.updateMatrix()
    shells.setMatrixAt(i, shellDummy.matrix)
  }

  const scorches = Array.from({ length: SCORCH_COUNT }, () => {
    const mat = new THREE.MeshBasicMaterial({
      map: getScorchTexture(),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    })
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat)
    mesh.visible = false
    mesh.renderOrder = 6
    return { mesh, mat, active: false, age: 0 }
  })

  return { light, lightAge: 1e9, shells, shellState, shellDummy, scorches }
}

const MUZZLE_LIGHT_LIFE = COMBATFX.muzzle.lifeSec

/**
 * [combat-feel R1, weakness C10] There used to be FOUR muzzle-flash systems
 * firing per shot — a world star sprite, a bus flash quad, a bus point light
 * and a pair of view-model quads — stacking into one white blob that bloom
 * then smeared across the frame. There is now exactly one shaped, randomly
 * rolled, camera-facing flash, and it lives on the weapon (ViewModel.tsx)
 * where it can be occluded by the gun. This is its light: two frames of real
 * illumination so the shot lights the barrel, the hand and the nearby walls.
 */
function spawnMuzzleLight(fx: GunFx, muzzle: THREE.Vector3) {
  fx.light.position.copy(muzzle)
  fx.light.intensity = COMBATFX.muzzle.intensity
  fx.lightAge = 0
}

/**
 * Muzzle flash part 3: eject a brass casing from the RECEIVER's ejection port
 * (published by the view model), not from the muzzle — casings used to spray
 * out of the barrel a metre ahead of the gun.
 */
function spawnShell(fx: GunFx, camera: THREE.Camera) {
  const s = fx.shellState.find((x) => !x.active)
  if (!s) return
  camera.getWorldDirection(_dir)
  _right.crossVectors(_dir, UP)
  if (_right.lengthSq() < 1e-6) _right.set(1, 0, 0)
  _right.normalize()
  s.active = true
  s.life = SHELL_LIFE
  if (EjectWorld.valid) s.pos.copy(EjectWorld.position)
  else s.pos.copy(camera.position).addScaledVector(_dir, 0.5)
  // ~1.5 m/s lateral, a light toss up and a touch of back-throw
  s.vel
    .copy(_right)
    .multiplyScalar(1.4 + Math.random() * 0.5)
    .addScaledVector(UP, 1.5 + Math.random() * 0.7)
    .addScaledVector(_dir, -0.3 - Math.random() * 0.35)
  s.axis.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize()
  s.spin = 16 + Math.random() * 20
  s.angle = Math.random() * Math.PI * 2
}

/** tracer endpoint: stick a scorch decal to the hit surface (~6 s fade) */
function spawnScorch(fx: GunFx, point: THREE.Vector3, normal: THREE.Vector3) {
  const s = fx.scorches.find((x) => !x.active) ?? fx.scorches[0]
  s.active = true
  s.age = 0
  s.mesh.visible = true
  s.mesh.position.copy(point).addScaledVector(normal, 0.02)
  s.mesh.quaternion.setFromUnitVectors(_fwd, normal)
  s.mesh.rotateZ(Math.random() * Math.PI * 2)
  const sc = 0.32 + Math.random() * 0.2
  s.mesh.scale.set(sc, sc, sc)
  s.mat.opacity = 0.85
}

const _fwd = new THREE.Vector3(0, 0, 1)

function updateGunFx(fx: GunFx, dt: number) {
  // [combat-feel R2] Muzzle light 25 → 60 at 8 m over 0.09 s, and — the part
  // that actually matters for a 30 fps capture — a FLAT HOLD at full
  // intensity for the first 34 ms (work order combat-feel #5). A light that
  // starts decaying on frame 0 is, at a 33 ms step, a light that was never
  // brighter than half. With the hold, the player's own armour, the hand and
  // the wall in front of the muzzle all take a full-strength flash.
  if (fx.lightAge < MUZZLE_LIGHT_LIFE) {
    fx.lightAge += dt
    const hold = COMBATFX.muzzle.holdSec
    if (fx.lightAge <= hold) {
      fx.light.intensity = COMBATFX.muzzle.intensity
    } else {
      const t = Math.min(1, (fx.lightAge - hold) / Math.max(1e-4, MUZZLE_LIGHT_LIFE - hold))
      fx.light.intensity = COMBATFX.muzzle.intensity * (1 - t) * (1 - t)
    }
  } else if (fx.light.intensity !== 0) {
    fx.light.intensity = 0
  }

  // brass casings: gravity arc + tumble, die at 0.8 s
  let dirty = false
  for (let i = 0; i < SHELL_COUNT; i++) {
    const s = fx.shellState[i]!
    if (!s.active) continue
    dirty = true
    s.life -= dt
    if (s.life <= 0) {
      s.active = false
      fx.shellDummy.position.set(0, -100, 0)
      fx.shellDummy.scale.setScalar(0.0001)
      fx.shellDummy.updateMatrix()
      fx.shells.setMatrixAt(i, fx.shellDummy.matrix)
      continue
    }
    s.vel.y -= SHELL_GRAVITY * dt
    s.pos.addScaledVector(s.vel, dt)
    s.angle += s.spin * dt
    // one cheap bounce off the player's ground plane so brass settles instead
    // of sinking through the floor
    if (s.pos.y < PlayerRef.position.y + 0.02 && s.vel.y < 0) {
      s.pos.y = PlayerRef.position.y + 0.02
      s.vel.y = -s.vel.y * 0.32
      s.vel.x *= 0.55
      s.vel.z *= 0.55
      s.spin *= 0.5
    }
    fx.shellDummy.position.copy(s.pos)
    fx.shellDummy.quaternion.setFromAxisAngle(s.axis, s.angle)
    fx.shellDummy.scale.setScalar(1)
    fx.shellDummy.updateMatrix()
    fx.shells.setMatrixAt(i, fx.shellDummy.matrix)
  }
  if (dirty) fx.shells.instanceMatrix.needsUpdate = true

  // scorch decals: 6 s char fade
  for (const s of fx.scorches) {
    if (!s.active) continue
    s.age += dt
    const t = s.age / SCORCH_LIFE
    if (t >= 1) {
      s.active = false
      s.mesh.visible = false
      s.mat.opacity = 0
      continue
    }
    s.mat.opacity = 0.85 * (1 - t) * (1 - t * 0.4)
  }
}

// ---------------------------------------------------------------------------
// Rifle
// ---------------------------------------------------------------------------

/**
 * World-space muzzle tip, published each frame by the third-person view model
 * (combat/ViewModel.tsx) from the actual barrel mesh. Tracers, muzzle flashes,
 * shells and the muzzle light all spawn here so they leave the weapon the
 * player can see rather than the camera.
 */
export const MuzzleWorld = { position: new THREE.Vector3(), valid: false }

/**
 * World-space ejection port, published by the view model from the receiver
 * mesh. Brass leaves the gun here, not out of the barrel.
 */
export const EjectWorld = { position: new THREE.Vector3(), valid: false }

/**
 * World-space muzzle position — the rig's real barrel tip, or `null`.
 *
 * [combat-feel R2, work order combat-feel #5] The camera-space fallback is
 * GONE. It used to place the muzzle 0.62 m in front of the lens whenever the
 * hand socket had not published, which meant every flash, every bolt, every
 * shell and the muzzle light spawned in mid-air at head height — a shot
 * leaving nothing the player could see. Callers that get `null` must suppress
 * shot VFX outright rather than guess.
 */
export function getMuzzleWorld(_camera: THREE.Camera, out: THREE.Vector3): THREE.Vector3 | null {
  if (!MuzzleWorld.valid) return null
  return out.copy(MuzzleWorld.position)
}

function applySpread(dir: THREE.Vector3, spreadDeg: number) {
  // uniform-ish disc perturbation via orthonormal basis around dir
  _right.crossVectors(dir, UP)
  if (_right.lengthSq() < 1e-6) _right.set(1, 0, 0)
  _right.normalize()
  _upv.crossVectors(_right, dir)
  const r = Math.tan(spreadDeg * DEG) * Math.sqrt(Math.random())
  const a = Math.random() * Math.PI * 2
  dir.addScaledVector(_right, Math.cos(a) * r).addScaledVector(_upv, Math.sin(a) * r).normalize()
}

function fireShot(
  camera: THREE.Camera,
  tracers: Tracer[],
  fx: GunFx,
  impacts: PendingImpact[],
  lines: HotLine[],
) {
  const cs = CombatState
  cs.ammo = ammoState.mag // mirror HUD-authoritative mag for the snapshot
  cs.fireCooldown = 1 / RIFLE.roundsPerSec
  cs.bloom = Math.min(3 - (cs.aiming ? 0.15 : 0.6), cs.bloom + 0.35)

  camera.getWorldDirection(_dir)
  applySpread(_dir, cs.spreadDeg)
  _origin.copy(camera.position)

  // enemy hit vs. wall block (combat.md §1: raycast from camera center)
  const enemyHit = raycastEnemies(_origin, _dir, RIFLE_RANGE)
  const wall = raycastLevel(_origin, _dir, RIFLE_RANGE)
  const wallDist = wall ? wall.distance : Infinity

  // [combat-feel R2, work order combat-feel #5] No barrel tip published means
  // no rig on screen; the shot still resolves (the player must never lose a
  // trigger pull to a camera state) but NOTHING visual is spawned, because
  // every muzzle-anchored effect would otherwise land in mid-air.
  const hasMuzzle = getMuzzleWorld(camera, _muzzle) !== null

  if (enemyHit && enemyHit.distance < wallDist + 0.01) {
    const dmg = RIFLE.damagePerShot * rifleFalloff(enemyHit.distance)
    // Damage and hit confirmation stay on the trigger frame — the hitmarker
    // must not lag the trigger. Only the world-surface response is deferred.
    resolveEnemyHit(enemyHit.enemy, dmg, {
      point: enemyHit.point,
      crit: enemyHit.crit,
      dir: _dir,
    })
    // [combat-feel R2] The bolt now terminates on exactly the point
    // DamageSystem resolved against, so the streak, the hot line and the
    // flesh response all land on the same spot. No deferred surface event is
    // queued for an enemy: `resolveEnemyHit` has already fired the full flesh
    // package on the trigger frame (a hitmarker must not lag the trigger),
    // and the deferred queue's job is scorch-and-sparks on WORLD geometry.
    _end.copy(enemyHit.point)
  } else if (wall) {
    // [combat-feel R1] deferred to bolt arrival (weakness C3) — see the
    // impact queue above. Scorch, sparks and the impact light all fire there.
    _normal.copy(wall.normal)
    _end.copy(wall.point)
    scheduleImpact(
      impacts,
      cs.clock,
      (hasMuzzle ? _muzzle.distanceTo(_end) : wall.distance) / TRACER_SPEED,
      true,
      _end,
      _normal,
      _dir,
    )
  } else {
    // explicit miss branch: the bolt still has to DO something at max range,
    // otherwise long shots simply vanish (work order combat-feel #5)
    _end.copy(_dir).multiplyScalar(RIFLE_RANGE).add(_origin)
    _normal.copy(_dir).multiplyScalar(-1)
    scheduleImpact(impacts, cs.clock, RIFLE_RANGE / TRACER_SPEED, false, _end, _normal, _dir)
  }

  cs.muzzleFlashAt = hasMuzzle ? cs.clock : -1
  cs.muzzleFlip = !cs.muzzleFlip

  if (hasMuzzle) {
    spawnTracer(tracers, _muzzle, _end)
    // the instantaneous read: one hot thread from the barrel to the hit, held
    // for two frames, under the travelling bolt
    spawnHotLine(lines, _muzzle, _end)
    // muzzle flash set: the flash cards live on the weapon (ViewModel.tsx);
    // this is its light, its brass and a short spit of bore ejecta
    spawnMuzzleLight(fx, _muzzle)
    spawnShell(fx, camera)
    ImpactFx.sparks(_muzzle, _dir, 6, {
      speed: 11,
      spread: 0.14,
      color: COLORS.solarWhite,
      life: 0.12,
      width: 0.013,
      gravity: 2,
    })
  }

  // ---- recoil: shaped kick with a spring-back recentre (weakness C1) ----
  // The old code added a permanent 0.008 rad to CamRef.pitch per shot and
  // never gave it back, so a full 60-round magazine walked the camera 27°
  // into the sky. The kick is now borrowed: every radian added here is
  // recorded as debt and paid back by recoverRecoil() once fire stops.
  cs.recoil = Math.min(1.5, cs.recoil + 1)
  addTrauma(0.035)
  const kickUp = RECOIL_PITCH * (0.75 + Math.random() * 0.5)
  const kickSide = RECOIL_YAW * (Math.random() * 2 - 1)
  const before = CamRef.pitch
  CamRef.pitch = THREE.MathUtils.clamp(
    CamRef.pitch + kickUp,
    -MOVE.cam.pitchLimit,
    MOVE.cam.pitchLimit,
  )
  recoilDebt.pitch += CamRef.pitch - before
  CamRef.yaw += kickSide
  recoilDebt.yaw += kickSide
  AudioBus.playRifle()
}

/**
 * Borrowed recoil, returned. Tracks how much of the camera's current aim came
 * from the weapon rather than the player, and eases it back out — slowly while
 * the trigger is down (so the climb is still felt), fast once it is released.
 * Anything the player does with the mouse is untouched: we only ever subtract
 * what we added.
 */
const recoilDebt = { pitch: 0, yaw: 0 }
const RECOIL_PITCH = 0.013
const RECOIL_YAW = 0.0032

function recoverRecoil(dt: number, firing: boolean) {
  if (recoilDebt.pitch === 0 && recoilDebt.yaw === 0) return
  const rate = firing ? 1.6 : 9
  const k = Math.min(1, rate * dt)
  const dp = recoilDebt.pitch * k
  const dy = recoilDebt.yaw * k
  CamRef.pitch = THREE.MathUtils.clamp(
    CamRef.pitch - dp,
    -MOVE.cam.pitchLimit,
    MOVE.cam.pitchLimit,
  )
  CamRef.yaw -= dy
  recoilDebt.pitch -= dp
  recoilDebt.yaw -= dy
  if (Math.abs(recoilDebt.pitch) < 1e-5) recoilDebt.pitch = 0
  if (Math.abs(recoilDebt.yaw) < 1e-5) recoilDebt.yaw = 0
}

/**
 * Fire the deferred surface response for every bolt that has landed this
 * frame: scorch decal, stretched velocity-aligned ejecta, a one-frame impact
 * light and the bus' soft spark blob underneath.
 */
function updateImpacts(impacts: PendingImpact[], fx: GunFx, clock: number) {
  for (const im of impacts) {
    if (!im.active || clock < im.at) continue
    im.active = false
    if (im.hit) {
      // [combat-feel R2, work order combat-feel #7] A bullet hitting stone is
      // FOUR things happening at once, and round 2 shipped one of them at a
      // quarter strength. Now: a tight cone of ejecta reflected about the
      // surface normal, a second slower stretched burst that lingers, a ring
      // lying ON the surface (not a floor disc in mid-air), a real light and
      // the scorch.
      _reflect.copy(im.dir).reflect(im.normal).normalize()
      _reflect.addScaledVector(im.normal, 0.55).normalize()
      // 1. the reflected cone — fast, white, gone in a third of a second
      ImpactFx.sparks(im.point, _reflect, COMBATFX.impact.sparkCount, {
        speed: 13,
        spread: 0.42,
        color: COLORS.solarWhite,
        life: 0.3,
        width: 0.018,
        gravity: 9,
      })
      // 2. the second, stretched burst — slower, gold, arcs and falls
      ImpactFx.sparks(im.point, im.normal, 10, {
        speed: 5.5,
        spread: 0.95,
        color: COLORS.aureate,
        life: 0.5,
        width: 0.026,
        gravity: 11,
      })
      VFX.burst({
        position: im.point,
        color: COLORS.aureate,
        count: 8,
        speed: 4.5,
        life: 0.3,
        size: 0.055,
        gravity: 4,
      })
      // 3. surface-aligned pressure ring: the hit has a plane
      VFX.ring({
        position: im.point,
        color: COLORS.solarWhite,
        maxRadius: COMBATFX.impact.ringRadius,
        life: COMBATFX.impact.ringLife,
        width: 0.35,
        normal: im.normal,
      })
      // 4. the light: 8/5 lit nothing at gameplay distance
      VFX.flash({
        position: im.point,
        color: COLORS.solarWhite,
        intensity: COMBATFX.impact.flashIntensity,
        distance: COMBATFX.impact.flashDistance,
        life: 0.09,
      })
      spawnScorch(fx, im.point, im.normal)
    } else {
      // max-range puff: a bolt that hits nothing still burns out visibly
      VFX.burst({
        position: im.point,
        color: COLORS.aureate,
        count: 5,
        speed: 2.2,
        life: 0.12,
        size: 0.09,
        gravity: 0,
      })
    }
  }
}

function updateRifle(
  camera: THREE.Camera,
  dt: number,
  tracers: Tracer[],
  fx: GunFx,
  impacts: PendingImpact[],
  lines: HotLine[],
) {
  const cs = CombatState
  const holdingFire = canFight() && Input.held('fire')
  cs.aiming = canFight() && Input.held('aim')
  cs.fireCooldown -= dt
  cs.recoil = Math.max(0, cs.recoil - 10 * dt) // spring recovery 10/s
  recoverRecoil(dt, holdingFire)
  cs.bloom = Math.max(0, cs.bloom - 4 * dt) // bloom decays 4°/s
  const base = cs.aiming ? 0.15 : 0.6 // aimed spread 0.15° (0.6 × 0.4 aim mult ≈ spec pair)
  cs.spreadDeg = Math.min(3, base + cs.bloom)

  // reload state is HUD-authoritative (hud/ammoState.ts ticks & refills)
  cs.reloading = ammoState.reloading
  if (cs.reloading) return

  // auto-reload when empty (no manual reload — R is ability 3)
  if (ammoState.mag <= 0) {
    startReload()
    cs.reloading = true
    AudioBus.playReload()
    return
  }

  const blocked = cs.requiemPhase === 1 // rooted during ult charge
  if (
    !blocked &&
    holdingFire &&
    cs.fireCooldown <= 0 &&
    consumeAmmo() // false → mag went dry between frames; next pass reloads
  ) {
    fireShot(camera, tracers, fx, impacts, lines)
  }
  cs.ammo = ammoState.mag
}

// ---------------------------------------------------------------------------
// Katana
// ---------------------------------------------------------------------------

let trailSeq = 0
/** swing time of the last arc sample, so the strip can be sub-sampled */
let lastArcT = 0
/**
 * Bumped on every `startSwing`. The arc strip watches it and breaks the
 * surface when it changes: without this, a chained combo bridges a triangle
 * from the end of the previous swing to the start of the next one, which is a
 * metre-wide sheet of additive light across the middle of the frame.
 */
let swingToken = 0
/** scratch swing descriptor for arc sub-sampling (never allocated per frame) */
const _arcSample = { step: 0, t: 0, dur: 1 }

function findLungeTarget(camera: THREE.Camera): number | null {
  camera.getWorldDirection(_dir)
  _dir.y = 0
  if (_dir.lengthSq() < 1e-6) _dir.set(0, 0, -1)
  _dir.normalize()
  let bestId: number | null = null
  let bestD: number = LUNGE_RANGE
  for (const e of EnemyRegistry.list()) {
    if (!e.alive) continue
    _to.copy(e.position).sub(PlayerRef.position)
    _to.y = 0
    const d = _to.length()
    if (d > LUNGE_RANGE + e.radius || d < 1e-4) continue
    _to.divideScalar(d)
    if (Math.acos(THREE.MathUtils.clamp(_to.dot(_dir), -1, 1)) > LUNGE_HALF_ANGLE) continue
    if (d < bestD) {
      bestD = d
      bestId = e.id
    }
  }
  return bestId
}

function startSwing(camera: THREE.Camera, step: 0 | 1 | 2) {
  const cs = CombatState
  const airborne = !PlayerRef.isGrounded
  cs.swing = {
    step,
    t: 0,
    dur: SWING_DUR[step],
    resolved: false,
    airborne,
    targetId: findLungeTarget(camera),
    hitIds: new Set<number>(),
    trail: VFX.trail(`katana-${++trailSeq}`),
  }
  lastArcT = 0
  swingToken++
  AudioBus.playKatana()
  if (airborne && step === 2) {
    cs.slamPending = true
    cs.slamMinVy = 0
    cs.slamUntil = cs.clock + 1.5
  }
}

const _pivot = new THREE.Vector3()
const _pivotCache = new THREE.Vector3()
let pivotClock = -1

/**
 * The swing pivot: the player's RIGHT HAND, read from the socket the weapon is
 * actually parented to.
 *
 * [combat-feel R2, work order combat-feel #1 — BLOCKER] The arc used to pivot
 * on `PlayerRef.position + 1.25y`, the middle of the collision capsule, while
 * the blade mesh hangs off `PlayerSockets.rightHand`. The drawn sword and the
 * drawn arc were therefore describing two different swings half a metre
 * apart, which is the whole reason 17_katana read as a crescent decal pasted
 * over a character rather than as that character cutting.
 *
 * Sampled once per combat frame — a socket's world matrix is not free, and
 * `bladePoseWorld` is called up to five times a frame to sub-sample the arc.
 */
function swingPivot(out: THREE.Vector3): THREE.Vector3 {
  if (pivotClock !== CombatState.clock) {
    pivotClock = CombatState.clock
    const hand = PlayerSockets.rightHand
    if (hand) hand.getWorldPosition(_pivotCache)
    else _pivotCache.copy(PlayerRef.position).setY(PlayerRef.position.y + 1.25)
  }
  return out.copy(_pivotCache)
}

/**
 * Authored 3-key swing curve → fraction of the arc travelled, in [-a, 1].
 *
 *   wind-up        120 ms   the blade cocks BACK by `anticipation`
 *   contact         60 ms   80% of the arc is crossed; damage lands here
 *   follow-through 200 ms   the last 20%, eased out to a settle
 *
 * Every consumer shares it — the swept arc strip, the ribbon, the blade
 * mesh's `lookAt` target and the damage window — so what the player sees and
 * what the game resolves are the same motion. A constant-rate sweep has no
 * moment of impact at all, which is what "no weight" meant (weakness C11).
 */
function swingPhase(t: number, dur: number): number {
  const S = COMBATFX.swing
  const k = dur / SWING_TOTAL
  const w = S.windupSec * k
  const c = S.contactSec * k
  const tt = THREE.MathUtils.clamp(t, 0, dur)
  if (tt < w) {
    const u = tt / Math.max(1e-4, w)
    return -S.anticipation * (u * u * (3 - 2 * u))
  }
  if (tt < w + c) {
    const u = (tt - w) / Math.max(1e-4, c)
    return -S.anticipation + (S.anticipation + S.contactTravel) * (u * u * (3 - 2 * u))
  }
  const u = THREE.MathUtils.clamp((tt - w - c) / Math.max(1e-4, dur - w - c), 0, 1)
  return S.contactTravel + (1 - S.contactTravel) * (1 - (1 - u) ** 3)
}

/**
 * World-space blade pose at the current point of a swing.
 *
 * `outTip` is the kissaki; `outGuard` is the inner edge of the swept surface,
 * a hand's width past the tsuba. Both sit at a fixed radius from the hand
 * pivot, so the swept surface is a real spherical fan rather than the flat
 * chest-height ring the audit flagged (weakness C2) — and that radius is the
 * length of the sword that is drawn, 1.16 m, not the old 2.1 m.
 */
function bladePoseWorld(
  camera: THREE.Camera,
  swing: { step: number; t: number; dur: number },
  outTip: THREE.Vector3,
  outGuard: THREE.Vector3 | null,
): THREE.Vector3 {
  const e = swingPhase(swing.t, swing.dur)
  const ec = THREE.MathUtils.clamp(e, 0, 1)
  const R = COMBATFX.arc.tipRadius
  camera.getWorldDirection(_dir)
  _dir.y = 0
  if (_dir.lengthSq() < 1e-6) _dir.set(0, 0, -1)
  _dir.normalize()
  _right.crossVectors(_dir, UP)
  swingPivot(_pivot)
  if (swing.step === 0) {
    // Draw Cut — 140° horizontal sweep, right → left, with a shallow rise
    const az = THREE.MathUtils.lerp(70, -70, e) * DEG
    const el = (2 + Math.sin(ec * Math.PI) * 8) * DEG
    const ch = Math.cos(el) * R
    outTip
      .copy(_pivot)
      .addScaledVector(_dir, Math.cos(az) * ch)
      .addScaledVector(_right, Math.sin(az) * ch)
    outTip.y = _pivot.y + Math.sin(el) * R
  } else if (swing.step === 1) {
    // Rising Reversal — diagonal, low-left to high-right
    const az = THREE.MathUtils.lerp(-55, 55, e) * DEG
    const el = THREE.MathUtils.lerp(-40, 44, e) * DEG
    const ch = Math.cos(el) * R
    outTip
      .copy(_pivot)
      .addScaledVector(_dir, Math.cos(az) * ch)
      .addScaledVector(_right, Math.sin(az) * ch)
    outTip.y = _pivot.y + Math.sin(el) * R
  } else {
    // Heaven Splitter — overhead chop swept in the vertical plane that holds
    // the aim vector, pivoting on the hand rather than dropping past the feet
    const el = THREE.MathUtils.lerp(76, -40, e) * DEG
    outTip.copy(_pivot).addScaledVector(_dir, Math.cos(el) * R)
    outTip.y = _pivot.y + Math.sin(el) * R
  }
  if (outGuard) outGuard.copy(_pivot).lerp(outTip, COMBATFX.arc.guardFrac)
  return outTip
}

/**
 * Roll (about the blade axis) the view model should apply after aiming the
 * katana at `bladeTipWorld`, so the EDGE leads the cut instead of `lookAt()`
 * picking an arbitrary roll off world up.
 */
export function bladeRollForStep(step: number): number {
  return SWING_ROLL[step] ?? 0
}



/** world-space blade-tip position along the swing arc (drives VFX ribbon) */
export function bladeTipWorld(
  camera: THREE.Camera,
  swing: { step: number; t: number; dur: number },
  out: THREE.Vector3,
): THREE.Vector3 {
  return bladePoseWorld(camera, swing, out, null)
}

// ---------------------------------------------------------------------------
// Swept blade arc — the swing's actual path through space
//
// [combat-feel R1, weakness C2] The katana's only "arc" was an expanding ring
// on the XZ plane at chest height, which is wrong for two of the three combo
// steps and reads as a floor decal in the air. R1 replaced it with a swept
// triangle strip between the guard and the tip.
//
// [combat-feel R2, work order combat-feel #2 and #3 — BLOCKERS] R1's strip was
// still wrong in four ways, all fixed here:
//   - it swept a 2.1 m radius around a 0.95 m sword, so the crescent was
//     twice the length of the blade that drew it → COMBATFX.arc.tipRadius;
//   - DoubleSide, vertex-coloured, flat-additive: no taper at the guard and
//     no exposure ceiling, so a swing near the camera filled the frame →
//     a three-layer shader shell with a per-channel soft knee at 2.0;
//   - no near-plane handling at all, and in third person the blade crosses
//     the lens constantly → a fragment dissolve between 0.5 m and 1.6 m;
//   - samples taken behind the camera bridged a triangle across the whole
//     view → `breakStrip()` restarts the surface instead.
// ---------------------------------------------------------------------------

const ARC_SAMPLES = 20
const ARC_FADE = COMBATFX.arc.fadeSec

const _arcEdgeA = new THREE.Vector3()
const _arcEdgeB = new THREE.Vector3()
const _arcNormal = new THREE.Vector3()
const _arcToCam = new THREE.Vector3()

/**
 * Three-layer energy shell across one swept surface.
 *
 * `aEdge` runs 0 at the guard to 1 at the tip; `aAge` is the sample's age in
 * the strip. The core is a thin white ridge riding the leading edge, the mid
 * is the saturated aureate body, the outer is a dim wide falloff — i.e. the
 * same authoring the work order asks of every energy element, done in ONE
 * draw call instead of three stacked additive meshes.
 *
 * The output is soft-kneed per channel: linear up to 1.0, then asymptotic
 * toward `uCap` (2.0). An additive strip that can cover a fifth of the frame
 * must not be allowed to pin the bloom pass on its own, which is exactly what
 * round 2 did with `VFXENERGY.core.boost` at 4.0.
 */
const ARC_VERT = /* glsl */ `
attribute float aEdge;
attribute float aAge;
varying float vEdge;
varying float vAge;
varying vec3 vWorld;
void main() {
  vEdge = aEdge;
  vAge = aAge;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`

const ARC_FRAG = /* glsl */ `
uniform vec3 uCore;
uniform vec3 uMid;
uniform vec3 uOuter;
uniform float uCoreB;
uniform float uMidB;
uniform float uOuterB;
uniform float uCap;
uniform float uNear;
uniform float uFar;
uniform float uFade;
varying float vEdge;
varying float vAge;
varying vec3 vWorld;

void main() {
  float a = clamp(1.0 - vAge / uFade, 0.0, 1.0);   // 1 = newest sample
  float e = clamp(vEdge, 0.0, 1.0);

  // the strip tapers to nothing at the guard: no slab of light on the hand
  float core  = pow(e, 10.0) * pow(a, 3.0);
  float mid   = pow(e, 2.6) * pow(a, 1.7);
  float outer = pow(e, 1.3) * a * a;

  vec3 c = uCore * (core * uCoreB) + uMid * (mid * uMidB) + uOuter * (outer * uOuterB);
  float alpha = clamp(core + mid * 0.7 + outer * 0.4, 0.0, 1.0);

  // near-camera dissolve — a metre-wide additive fan swept through the lens
  // is a white wall, and in third person the blade passes the lens often
  float d = distance(vWorld, cameraPosition);
  float nf = smoothstep(uNear, uFar, d);
  alpha *= nf;
  c *= nf;

  if (alpha <= 0.003) discard;

  // soft knee: passthrough to 1.0, then asymptotic toward uCap
  c = min(c, vec3(1.0)) + (vec3(1.0) - exp(-max(c - vec3(1.0), vec3(0.0)))) * (uCap - 1.0);
  gl_FragColor = vec4(c, alpha);
}
`

function makeSwingArc() {
  const geo = new THREE.BufferGeometry()
  const pos = new Float32Array(ARC_SAMPLES * 2 * 3)
  const edge = new Float32Array(ARC_SAMPLES * 2)
  const ageBuf = new Float32Array(ARC_SAMPLES * 2)
  for (let i = 0; i < ARC_SAMPLES; i++) {
    edge[i * 2] = 0 // inner: the guard
    edge[i * 2 + 1] = 1 // outer: the tip
  }
  const posAttr = new THREE.BufferAttribute(pos, 3)
  const ageAttr = new THREE.BufferAttribute(ageBuf, 1)
  posAttr.setUsage(THREE.DynamicDrawUsage)
  ageAttr.setUsage(THREE.DynamicDrawUsage)
  geo.setAttribute('position', posAttr)
  geo.setAttribute('aEdge', new THREE.BufferAttribute(edge, 1))
  geo.setAttribute('aAge', ageAttr)

  // Two windings, so the strip can be drawn SINGLE-SIDED whichever way the
  // blade happens to be travelling (work order combat-feel #2 asks for
  // FrontSide; a fixed winding would simply cull half the combo).
  const idxA: number[] = []
  const idxB: number[] = []
  for (let i = 0; i < ARC_SAMPLES - 1; i++) {
    const a = i * 2
    idxA.push(a, a + 1, a + 3, a, a + 3, a + 2)
    idxB.push(a, a + 3, a + 1, a, a + 2, a + 3)
  }
  const windA = new THREE.BufferAttribute(new Uint16Array(idxA), 1)
  const windB = new THREE.BufferAttribute(new Uint16Array(idxB), 1)
  let usingA = true
  geo.setIndex(windA)
  geo.setDrawRange(0, 0)
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4) // never cull

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uCore: { value: new THREE.Color(COLORS.solarWhite) },
      uMid: { value: new THREE.Color(COLORS.aureate) },
      uOuter: { value: new THREE.Color(COLORS.aureate) },
      uCoreB: { value: COMBATFX.arc.coreBoost },
      uMidB: { value: COMBATFX.arc.midBoost },
      uOuterB: { value: COMBATFX.arc.outerBoost },
      uCap: { value: COMBATFX.arc.cap },
      uNear: { value: COMBATFX.arc.dissolveNear },
      uFar: { value: COMBATFX.arc.dissolveFar },
      uFade: { value: ARC_FADE },
    },
    vertexShader: ARC_VERT,
    fragmentShader: ARC_FRAG,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.FrontSide,
    toneMapped: false,
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.frustumCulled = false
  mesh.renderOrder = 19
  mesh.visible = false

  const ages = new Float32Array(ARC_SAMPLES)
  let count = 0

  /** drop expired samples off the front of the ring */
  function trim() {
    let drop = 0
    while (drop < count && ages[drop]! >= ARC_FADE) drop++
    if (drop === 0) return
    for (let i = drop; i < count; i++) {
      ages[i - drop] = ages[i]!
      for (let k = 0; k < 6; k++) pos[(i - drop) * 6 + k] = pos[i * 6 + k]!
    }
    count -= drop
  }

  function hide() {
    if (mesh.visible) {
      mesh.visible = false
      geo.setDrawRange(0, 0)
    }
  }

  return {
    object: mesh as THREE.Object3D,

    /** append one blade pose to the swept surface */
    push(guard: THREE.Vector3, tip: THREE.Vector3) {
      if (count >= ARC_SAMPLES) {
        // shift by one and overwrite the last slot
        for (let i = 1; i < ARC_SAMPLES; i++) {
          ages[i - 1] = ages[i]!
          for (let k = 0; k < 6; k++) pos[(i - 1) * 6 + k] = pos[i * 6 + k]!
        }
        count = ARC_SAMPLES - 1
      }
      const o = count * 6
      pos[o] = guard.x
      pos[o + 1] = guard.y
      pos[o + 2] = guard.z
      pos[o + 3] = tip.x
      pos[o + 4] = tip.y
      pos[o + 5] = tip.z
      ages[count] = 0
      count++
    },

    /**
     * Break the strip. Used when a pose falls behind the camera: rather than
     * bridging a triangle across the lens (which draws a full-screen sheet of
     * additive light), the surface simply restarts in front of it.
     */
    breakStrip() {
      if (count !== 0) {
        count = 0
        hide()
      }
    },

    update(dt: number, camera: THREE.Camera) {
      if (count === 0) {
        hide()
        return
      }
      for (let i = 0; i < count; i++) ages[i] = ages[i]! + dt
      trim()
      if (count < 2) {
        hide()
        return
      }
      for (let i = 0; i < count; i++) {
        const a = ages[i]!
        ageBuf[i * 2] = a
        ageBuf[i * 2 + 1] = a
      }

      // single-sided facing: pick the winding whose front faces the camera,
      // measured on the middle rib of the strip
      const m = Math.max(0, Math.min(count - 2, (count - 1) >> 1))
      const o = m * 6
      const n = (m + 1) * 6
      _arcEdgeA.set(pos[o + 3]! - pos[o]!, pos[o + 4]! - pos[o + 1]!, pos[o + 5]! - pos[o + 2]!)
      _arcEdgeB.set(pos[n + 3]! - pos[o + 3]!, pos[n + 4]! - pos[o + 4]!, pos[n + 5]! - pos[o + 5]!)
      _arcNormal.crossVectors(_arcEdgeA, _arcEdgeB)
      _arcToCam.set(
        camera.position.x - pos[o + 3]!,
        camera.position.y - pos[o + 4]!,
        camera.position.z - pos[o + 5]!,
      )
      const wantA = _arcNormal.dot(_arcToCam) >= 0
      if (wantA !== usingA) {
        usingA = wantA
        geo.setIndex(wantA ? windA : windB)
      }

      posAttr.needsUpdate = true
      ageAttr.needsUpdate = true
      geo.setDrawRange(0, (count - 1) * 6)
      mesh.visible = true
    },

    clear() {
      count = 0
      geo.setDrawRange(0, 0)
      mesh.visible = false
    },
  }
}

type SwingArc = ReturnType<typeof makeSwingArc>

function resolveSwing(camera: THREE.Camera) {
  const cs = CombatState
  const swing = cs.swing
  if (!swing) return
  camera.getWorldDirection(_dir)
  _dir.y = 0
  if (_dir.lengthSq() < 1e-6) _dir.set(0, 0, -1)
  _dir.normalize()
  const halfArc = (SWING_ARC_DEG[swing.step] / 2) * DEG
  const origin = PlayerRef.position
  // direction the edge is travelling at contact — drives ejecta and knock feel
  _right.crossVectors(_dir, UP).normalize()
  if (swing.step === 0) _sweep.copy(_right).multiplyScalar(-1).addScaledVector(UP, 0.12)
  else if (swing.step === 1) _sweep.copy(_right).multiplyScalar(0.75).addScaledVector(UP, 0.85)
  else _sweep.copy(UP).multiplyScalar(-1).addScaledVector(_dir, 0.35)
  _sweep.normalize()
  let hits = 0
  for (const e of EnemyRegistry.list()) {
    if (!e.alive || swing.hitIds.has(e.id)) continue
    _to.copy(e.position).sub(origin)
    const dy = _to.y + e.height * 0.5 - 1.0 // chest vs player mid
    _to.y = 0
    const d = _to.length()
    if (d > SWING_RANGE + e.radius || d < 1e-4) continue
    if (Math.abs(dy) > 2.2) continue
    _to.divideScalar(d)
    const ang = Math.acos(THREE.MathUtils.clamp(_to.dot(_dir), -1, 1))
    if (ang > halfArc) continue
    swing.hitIds.add(e.id)
    hits++
    _pt.copy(e.position)
    _pt.y += e.height * 0.55
    let kb: THREE.Vector3 | undefined
    if (swing.step === 2) {
      // finisher knockback 6 m (combat.md §2)
      kb = _kb.copy(_to).multiplyScalar(6).setY(2).clone()
    }
    resolveEnemyHit(e, KATANA.comboDamage[swing.step], {
      point: _pt,
      stagger: 30,
      knockback: kb,
      dir: _sweep,
    })
    // [combat-feel R1] ejecta thrown ALONG the cut, so the sparks describe the
    // swing direction instead of puffing symmetrically (work order #6)
    ImpactFx.sparks(_pt, _sweep, 14, {
      speed: 13,
      spread: 0.34,
      color: COLORS.solarWhite,
      life: 0.3,
      width: 0.03,
    })
    ImpactFx.sparks(_pt, _sweep, 8, {
      speed: 7,
      spread: 0.9,
      color: COLORS.aureate,
      life: 0.42,
      width: 0.034,
      gravity: 8,
    })
    // white-gold impact flash at contact (combat.md §2.1)
    VFX.flash({ position: _pt, color: COLORS.solarWhite, intensity: 12, distance: 5, life: 0.09 })
  }
  if (hits > 0) {
    // hitstop: 60 ms, 90 ms on finisher (combat.md §5)
    useGameStore
      .getState()
      .setTimeScale(TIMESCALE.hitstopKatana, swing.step === 2 ? 0.09 : TIMESCALE.hitstopDurationSec)
    addTrauma(0.15)
  }
  // [combat-feel R1] The expanding XZ ring at chest height that used to stand
  // in for the arc is gone: it was a floor decal floating in the air for two
  // of the three combo steps. The swept arc mesh (makeSwingArc) now carries
  // the read, and a connect adds a short pressure ring on the ground only.
  if (hits > 0) {
    _pt.copy(origin)
    _pt.y += 0.06
    VFX.ring({ position: _pt, color: COLORS.aureate, maxRadius: 1.8, life: 0.22, width: 0.25 })
  }
}

function endSwing(chain: boolean, camera: THREE.Camera) {
  const cs = CombatState
  const swing = cs.swing
  if (!swing) return
  swing.trail.end()
  const wasFinisher = swing.step === 2
  cs.swing = null
  cs.comboStep = wasFinisher ? 0 : ((swing.step + 1) % 3)
  cs.comboWindowUntil = wasFinisher ? 0 : cs.clock + CHAIN_WINDOW
  if (chain && cs.slashQueued && !wasFinisher) {
    cs.slashQueued = false
    startSwing(camera, cs.comboStep as 0 | 1 | 2)
  } else {
    cs.slashQueued = false
  }
}

let arcToken = -1

function updateKatana(camera: THREE.Camera, dt: number, arc: SwingArc) {
  const cs = CombatState

  if (canFight() && Input.pressed('slash')) {
    if (cs.swing) {
      // buffer the next combo hit near the end of the current swing
      if (cs.swing.t / cs.swing.dur > 0.5) cs.slashQueued = true
    } else {
      const step = (cs.clock < cs.comboWindowUntil ? cs.comboStep : 0) as 0 | 1 | 2
      startSwing(camera, step)
    }
  }

  const swing = cs.swing
  if (swing) {
    if (arcToken !== swingToken) {
      arcToken = swingToken
      arc.breakStrip()
    }
    swing.t += dt

    // Target magnetism lunge (combat.md §2). [combat-feel R2] Gated to the
    // wind-up and contact windows: a lunge that keeps driving through a 200 ms
    // follow-through slides the player past the enemy he just cut.
    if (swing.targetId !== null && swing.t < swing.dur * SWING_CONTACT_END) {
      const target = EnemyRegistry.list().find((e) => e.id === swing.targetId && e.alive)
      if (target) {
        _to.copy(target.position).sub(PlayerRef.position)
        _to.y = 0
        const d = _to.length()
        if (d > 1.3) {
          _to.divideScalar(d)
          PlayerRef.velocity.x = _to.x * LUNGE_SPEED
          PlayerRef.velocity.z = _to.z * LUNGE_SPEED
        }
      }
    }

    if (!swing.resolved && swing.t >= swing.dur * SWING_CONTACT_AT) {
      swing.resolved = true
      resolveSwing(camera)
    }

    // Golden ribbon trail from the blade tip + the swept arc surface between
    // the guard and the tip (work order combat-feel #6).
    //
    // The arc is sub-sampled between the previous and current swing time, at
    // a rate chosen so a full swing always lands ~16 samples in the strip
    // whatever the frame rate — otherwise a 30 fps capture gets a 5-facet
    // crescent and a 144 fps session gets an arc cut short by the ring size.
    const sub = THREE.MathUtils.clamp(Math.round(dt / 0.011), 1, 4)
    _arcSample.step = swing.step
    _arcSample.dur = swing.dur
    camera.getWorldDirection(_camFwd)
    for (let i = 1; i <= sub; i++) {
      _arcSample.t = lastArcT + (swing.t - lastArcT) * (i / sub)
      bladePoseWorld(camera, _arcSample, _pt, _guard)
      // [combat-feel R2] reject samples behind the camera (work order #2):
      // a rib behind the lens projects to nonsense and drags a triangle
      // across the entire frame
      _camRel.copy(_pt).sub(camera.position)
      if (_camRel.dot(_camFwd) <= 0.05) {
        arc.breakStrip()
        continue
      }
      arc.push(_guard, _pt)
    }
    lastArcT = swing.t
    bladePoseWorld(camera, swing, _pt, _guard)
    // the ribbon is emitted from the blade TIP, which is now a point on the
    // real sword rather than a point 2.1 m from the collision capsule
    swing.trail.push(_pt)

    if (swing.t >= swing.dur) endSwing(true, camera)
  }

  // air-slam: step-3 airborne → shockwave on landing if falling fast (§2)
  if (cs.slamPending) {
    if (PlayerRef.isGrounded) {
      cs.slamPending = false
      if (cs.slamMinVy < -SLAM_MIN_FALL) {
        _pt.copy(PlayerRef.position)
        for (const e of EnemyRegistry.list()) {
          if (!e.alive) continue
          _to.copy(e.position).sub(_pt)
          _to.y = 0
          const d = _to.length()
          if (d > SLAM_RADIUS + e.radius) continue
          _hitPt.copy(e.position)
          _hitPt.y += e.height * 0.5
          const kb = d > 1e-4 ? _to.clone().divideScalar(d).multiplyScalar(4).setY(2) : undefined
          resolveEnemyHit(e, SLAM_DMG, { point: _hitPt, stagger: 30, knockback: kb })
        }
        VFX.ring({ position: _pt, color: COLORS.aureate, maxRadius: SLAM_RADIUS, life: 0.3, width: 0.5 })
        VFX.burst({ position: _pt, color: COLORS.solarWhite, count: 20, speed: 5, life: 0.4, size: 0.06, gravity: 5 })
        addTrauma(0.2)
        AudioBus.playHit()
      }
    } else {
      cs.slamMinVy = Math.min(cs.slamMinVy, PlayerRef.velocity.y)
      if (cs.clock > cs.slamUntil) cs.slamPending = false
    }
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function WeaponSystems() {
  const tracers = useMemo(() => makeTracers(), [])
  const gunFx = useMemo(() => makeGunFx(), [])
  const impacts = useMemo(() => makeImpactQueue(), [])
  const hotLines = useMemo(() => makeHotLines(), [])
  const arc = useMemo(() => makeSwingArc(), [])
  const groupRef = useRef<THREE.Group>(null)

  useFrame((state, rawDt) => {
    const dt = combatTick(state.clock.elapsedTime, rawDt)
    updateRifle(state.camera, dt, tracers, gunFx, impacts, hotLines)
    updateKatana(state.camera, dt, arc)
    updateImpacts(impacts, gunFx, CombatState.clock)
    updateTracers(tracers, dt, state.camera, state.size.height)
    updateHotLines(hotLines, dt)
    updateGunFx(gunFx, dt)
    arc.update(dt, state.camera)
    ImpactFx.update(dt)
  })

  return (
    <group ref={groupRef}>
      {tracers.map((t, i) => (
        <primitive key={i} object={t.group} />
      ))}
      {tracers.map((t, i) => (
        <primitive key={`bolt-${i}`} object={t.head} />
      ))}
      {/* gunplay feedback: 2-frame muzzle light + brass casings + scorches
          (the flash itself is on the weapon, in ViewModel.tsx) */}
      {hotLines.map((l, i) => (
        <primitive key={`line-${i}`} object={l.mesh} />
      ))}
      <primitive object={gunFx.light} />
      <primitive object={gunFx.shells} />
      {gunFx.scorches.map((s, i) => (
        <primitive key={`scorch-${i}`} object={s.mesh} />
      ))}
      {/* swept katana arc + the shared stretched-spark ejecta pool */}
      <primitive object={arc.object} />
      <primitive object={ImpactFx.object} />
    </group>
  )
}

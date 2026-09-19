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
import { COLORS, TIMESCALE, WEAPONS } from '@/game/config'
import { useGameStore } from '@/game/store'
import { ImpactFx, raycastEnemies, resolveEnemyHit, rifleFalloff, RIFLE_RANGE } from './DamageSystem'
import { CombatState, canFight, combatTick } from './state'
import { ammoState, consumeAmmo, startReload } from '@/game/hud/ammoState'

const RIFLE = WEAPONS.rifle
const KATANA = WEAPONS.katana
const DEG = Math.PI / 180
const UP = new THREE.Vector3(0, 1, 0)

/**
 * Grip-space muzzle offset — the barrel tip of the re-authored rifle, which is
 * modelled around a grip origin at (0,0,0) with the bore along -Z
 * (ViewModel.tsx). The view model publishes the real mesh position into
 * `MuzzleWorld` every frame; this constant is only the pre-mount fallback and
 * the local anchor the flash meshes are parented at.
 */
export const MUZZLE_LOCAL = new THREE.Vector3(0, 0.055, -0.62)

// katana tuning (combat.md §2)
const SWING_DUR = [0.22, 0.24, 0.3] as const
const SWING_ARC_DEG = [140, 120, 100] as const
const SWING_RANGE = 2.6
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

// ---------------------------------------------------------------------------
// Tracer pool — travelling bolts, not 1-frame streaks.
//
// [combat-feel R1] The old pool died after 0.09 s, i.e. 36 m of a 120 m
// weapon (weakness C3), so nothing was ever mid-flight when a frame was
// captured. Now: 180 m/s (a bolt crosses the arena in ~0.2 s and is legible
// for a dozen frames), a 14 m segment, life derived from the actual shot
// distance, and retirement only once the TAIL has reached the impact point.
//
// Each bolt is three layers so it reads as a projectile rather than a line:
//   core   tapered cylinder, wide at the head, a thread at the tail
//   halo   one quad rolled about the bolt axis to face the camera, vertex
//          alpha fading down the tail, width clamped to >= 6 px on screen
//   head   additive sprite — the bolt itself, the thing the eye tracks
// ---------------------------------------------------------------------------

const TRACER_COUNT = 28
/** m/s — deliberately sub-sonic-looking so bolts are readable in flight */
const TRACER_SPEED = 180
/** visible bolt length (m) */
const TRACER_SEG = 14
const TRACER_CORE_R = 0.03
const TRACER_HALO_R = 0.13
/** minimum on-screen halo width (px): distant bolts must never sub-pixel out */
const TRACER_MIN_PX = 6

interface Tracer {
  group: THREE.Group
  core: THREE.Mesh
  halo: THREE.Mesh
  head: THREE.Sprite
  coreMat: THREE.MeshBasicMaterial
  haloMat: THREE.MeshBasicMaterial
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

/** halo quad: unit square, pivot at the tail, vertex alpha ramped down the tail */
const tracerHaloGeo = new THREE.PlaneGeometry(1, 1)
tracerHaloGeo.translate(0, 0.5, 0)
tracerHaloGeo.setAttribute(
  'color',
  // PlaneGeometry emits +Y row first: verts 0,1 = head, verts 2,3 = tail
  new THREE.BufferAttribute(
    new Float32Array([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0.04, 1, 1, 1, 0.04]),
    4,
  ),
)

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
    const head = new THREE.Sprite(headMat)
    head.renderOrder = 21
    const group = new THREE.Group()
    group.add(halo, core)
    group.visible = false
    head.visible = false
    return {
      group,
      core,
      halo,
      head,
      coreMat,
      haloMat,
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

    // screen-space width floor so a 100 m bolt still covers ~6 px
    _tracerMid.copy(t.group.position).addScaledVector(t.dir, len * 0.5)
    const camDist = _tracerMid.distanceTo(camera.position)
    const minW = TRACER_MIN_PX * pxScale * camDist
    const haloW = Math.max(TRACER_HALO_R * 2, minW)
    const coreR = Math.max(TRACER_CORE_R, minW * 0.16)

    t.core.scale.set(coreR, len, coreR)
    t.halo.scale.set(haloW, len, 1)

    // roll the halo quad about the bolt axis so it always faces the camera
    _tracerCamLocal
      .copy(camera.position)
      .sub(t.group.position)
      .applyQuaternion(_tracerQInv.copy(t.group.quaternion).invert())
    t.halo.rotation.y = Math.atan2(_tracerCamLocal.x, _tracerCamLocal.z)

    // fade only over the last segment, as the tail runs into the impact point
    const endFade = THREE.MathUtils.clamp((t.dist - tail) / TRACER_SEG, 0, 1)
    t.coreMat.opacity = endFade
    t.haloMat.opacity = 0.7 * endFade

    // bolt head sprite: rides the leading edge until it lands
    if (head < t.dist - 0.01) {
      t.head.visible = true
      t.head.position.copy(t.start).addScaledVector(t.dir, head)
      t.head.scale.setScalar(Math.max(0.3, 9 * pxScale * camDist))
      t.headMat.opacity = 1
    } else {
      t.head.visible = false
    }
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
  const light = new THREE.PointLight('#FFE9C4', 0, 7, 2)
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

const MUZZLE_LIGHT_LIFE = 0.055

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
  fx.light.intensity = 25
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
  // muzzle light: 2 frames of real illumination on the weapon and the walls
  if (fx.lightAge < MUZZLE_LIGHT_LIFE) {
    fx.lightAge += dt
    const t = Math.min(1, fx.lightAge / MUZZLE_LIGHT_LIFE)
    fx.light.intensity = 25 * (1 - t) * (1 - t)
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

/** world-space muzzle position — the rig's barrel tip, or the camera-space
 * fallback offset before the player rig has mounted. */
export function getMuzzleWorld(camera: THREE.Camera, out: THREE.Vector3): THREE.Vector3 {
  if (MuzzleWorld.valid) return out.copy(MuzzleWorld.position)
  return out.copy(MUZZLE_LOCAL).applyMatrix4(camera.matrixWorld)
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

  getMuzzleWorld(camera, _muzzle)

  if (enemyHit && enemyHit.distance < wallDist + 0.01) {
    const dmg = RIFLE.damagePerShot * rifleFalloff(enemyHit.distance)
    // Damage and hit confirmation stay on the trigger frame — the hitmarker
    // must not lag the trigger. Only the world-surface response is deferred.
    resolveEnemyHit(enemyHit.enemy, dmg, {
      point: enemyHit.point,
      crit: enemyHit.crit,
      dir: _dir,
    })
    _end.copy(enemyHit.point)
  } else if (wall) {
    // [combat-feel R1] deferred to bolt arrival (weakness C3) — see the
    // impact queue above. Scorch, sparks and the impact light all fire there.
    _normal.copy(wall.normal)
    scheduleImpact(
      impacts,
      cs.clock,
      wall.distance / TRACER_SPEED,
      true,
      wall.point,
      _normal,
      _dir,
    )
    _end.copy(wall.point)
  } else {
    // explicit miss branch: the bolt still has to DO something at max range,
    // otherwise long shots simply vanish (work order combat-feel #5)
    _end.copy(_dir).multiplyScalar(RIFLE_RANGE).add(_origin)
    _normal.copy(_dir).multiplyScalar(-1)
    scheduleImpact(impacts, cs.clock, RIFLE_RANGE / TRACER_SPEED, false, _end, _normal, _dir)
  }

  spawnTracer(tracers, _muzzle, _end)

  // muzzle flash set: star + white core + 2-frame point light + brass +
  // a short spit of stretched sparks out of the bore
  spawnMuzzleLight(fx, _muzzle)
  spawnShell(fx, camera)
  ImpactFx.sparks(_muzzle, _dir, 4, {
    speed: 9,
    spread: 0.16,
    color: COLORS.solarWhite,
    life: 0.11,
    width: 0.014,
    gravity: 2,
  })
  cs.muzzleFlashAt = cs.clock
  cs.muzzleFlip = !cs.muzzleFlip

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
      // reflect the bolt off the surface so the spray points the right way
      _reflect.copy(im.dir).reflect(im.normal).normalize()
      _reflect.addScaledVector(im.normal, 0.55).normalize()
      ImpactFx.sparks(im.point, _reflect, 8, {
        speed: 8,
        spread: 0.5,
        color: COLORS.solarWhite,
        life: 0.3,
        width: 0.02,
      })
      ImpactFx.sparks(im.point, im.normal, 4, {
        speed: 4.5,
        spread: 0.85,
        color: COLORS.aureate,
        life: 0.38,
        width: 0.024,
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
      VFX.flash({ position: im.point, color: COLORS.solarWhite, intensity: 8, distance: 5, life: 0.09 })
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
    fireShot(camera, tracers, fx, impacts)
  }
  cs.ammo = ammoState.mag
}

// ---------------------------------------------------------------------------
// Katana
// ---------------------------------------------------------------------------

let trailSeq = 0
/** swing time of the last arc sample, so the strip can be sub-sampled */
let lastArcT = 0
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
  AudioBus.playKatana()
  if (airborne && step === 2) {
    cs.slamPending = true
    cs.slamMinVy = 0
    cs.slamUntil = cs.clock + 1.5
  }
}

const _pivot = new THREE.Vector3()

/**
 * World-space blade pose at the current point of a swing.
 *
 * `outTip` is the tip; `outGuard` is the point at the top of the guard, i.e.
 * the inner edge of the swept arc — the arc ribbon needs both, otherwise the
 * "crescent" degenerates into the flat chest-height ring the audit flagged
 * (weakness C2).
 */
function bladePoseWorld(
  camera: THREE.Camera,
  swing: { step: number; t: number; dur: number },
  outTip: THREE.Vector3,
  outGuard: THREE.Vector3 | null,
): THREE.Vector3 {
  const p = Math.min(1, swing.t / swing.dur)
  camera.getWorldDirection(_dir)
  _dir.y = 0
  if (_dir.lengthSq() < 1e-6) _dir.set(0, 0, -1)
  _dir.normalize()
  _right.crossVectors(_dir, UP)
  _pivot.copy(PlayerRef.position)
  _pivot.y += 1.25
  if (swing.step === 0) {
    // Draw Cut — 140° horizontal, right → left. Eased so the blade snaps
    // through the contact window instead of sweeping at a constant rate.
    const e = p * p * (3 - 2 * p)
    const a = THREE.MathUtils.lerp(70, -70, e) * DEG
    outTip
      .copy(_pivot)
      .addScaledVector(_dir, Math.cos(a) * 2.1)
      .addScaledVector(_right, Math.sin(a) * 2.1)
    outTip.y = _pivot.y + 0.15 + Math.sin(p * Math.PI) * 0.12
  } else if (swing.step === 1) {
    // Rising Reversal — diagonal left-low → right-high
    const e = p * p * (3 - 2 * p)
    const a = THREE.MathUtils.lerp(-55, 55, e) * DEG
    outTip
      .copy(_pivot)
      .addScaledVector(_dir, Math.cos(a) * 2.0)
      .addScaledVector(_right, Math.sin(a) * 2.0)
    outTip.y = PlayerRef.position.y + THREE.MathUtils.lerp(0.6, 2.2, e)
  } else {
    // Heaven Splitter — overhead vertical chop, slow lift then a hard drop
    const e = p < 0.3 ? (p / 0.3) * 0.25 : 0.25 + ((p - 0.3) / 0.7) ** 1.6 * 0.75
    outTip.copy(_pivot).addScaledVector(_dir, THREE.MathUtils.lerp(0.8, 1.9, e))
    outTip.y = PlayerRef.position.y + THREE.MathUtils.lerp(2.6, 0.25, e)
  }
  if (outGuard) {
    // the guard rides ~22% of the way out from the hand pivot toward the tip
    outGuard.copy(_pivot).lerp(outTip, 0.22)
  }
  return outTip
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
// steps and reads as a floor decal in the air. This is a real swept surface:
// a triangle strip between the guard and the tip, sampled every frame, white
// at the leading edge and fading to aureate over 0.18 s.
// ---------------------------------------------------------------------------

const ARC_SAMPLES = 18
const ARC_FADE = 0.18

function makeSwingArc() {
  const geo = new THREE.BufferGeometry()
  const pos = new Float32Array(ARC_SAMPLES * 2 * 3)
  const col = new Float32Array(ARC_SAMPLES * 2 * 4)
  const posAttr = new THREE.BufferAttribute(pos, 3)
  const colAttr = new THREE.BufferAttribute(col, 4)
  posAttr.setUsage(THREE.DynamicDrawUsage)
  colAttr.setUsage(THREE.DynamicDrawUsage)
  geo.setAttribute('position', posAttr)
  geo.setAttribute('color', colAttr)
  const idx: number[] = []
  for (let i = 0; i < ARC_SAMPLES - 1; i++) {
    const a = i * 2
    idx.push(a, a + 1, a + 3, a, a + 3, a + 2)
  }
  geo.setIndex(idx)
  geo.setDrawRange(0, 0)
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4) // never cull

  const mat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    vertexColors: true,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.frustumCulled = false
  mesh.renderOrder = 19
  mesh.visible = false

  const ages = new Float32Array(ARC_SAMPLES)
  let count = 0

  const hot = new THREE.Color(COLORS.solarWhite)
  const cool = new THREE.Color(COLORS.aureate)

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

    update(dt: number) {
      if (count === 0) {
        if (mesh.visible) {
          mesh.visible = false
          geo.setDrawRange(0, 0)
        }
        return
      }
      for (let i = 0; i < count; i++) ages[i] = ages[i]! + dt
      trim()
      if (count < 2) {
        mesh.visible = false
        geo.setDrawRange(0, 0)
        return
      }
      for (let i = 0; i < count; i++) {
        const f = 1 - Math.min(1, ages[i]! / ARC_FADE)
        // newest samples are white-hot, older ones cool to aureate
        const w = f * f
        const r = cool.r + (hot.r - cool.r) * w
        const g = cool.g + (hot.g - cool.g) * w
        const b = cool.b + (hot.b - cool.b) * w
        const ci = i * 8
        // inner (guard) edge: dimmer, so the arc has a soft trailing body
        col[ci] = r
        col[ci + 1] = g
        col[ci + 2] = b
        col[ci + 3] = f * 0.22
        // outer (tip) edge: the bright leading line the eye follows
        col[ci + 4] = r
        col[ci + 5] = g
        col[ci + 6] = b
        col[ci + 7] = f * 0.95
      }
      posAttr.needsUpdate = true
      colAttr.needsUpdate = true
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
    swing.t += dt

    // target magnetism lunge (combat.md §2: 16 m/s toward target for swing duration)
    if (swing.targetId !== null) {
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

    if (!swing.resolved && swing.t >= swing.dur * 0.35) {
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
    for (let i = 1; i <= sub; i++) {
      _arcSample.t = lastArcT + (swing.t - lastArcT) * (i / sub)
      bladePoseWorld(camera, _arcSample, _pt, _guard)
      arc.push(_guard, _pt)
    }
    lastArcT = swing.t
    bladePoseWorld(camera, swing, _pt, _guard)
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
  const arc = useMemo(() => makeSwingArc(), [])
  const groupRef = useRef<THREE.Group>(null)

  useFrame((state, rawDt) => {
    const dt = combatTick(state.clock.elapsedTime, rawDt)
    updateRifle(state.camera, dt, tracers, gunFx, impacts)
    updateKatana(state.camera, dt, arc)
    updateImpacts(impacts, gunFx, CombatState.clock)
    updateTracers(tracers, dt, state.camera, state.size.height)
    updateGunFx(gunFx, dt)
    arc.update(dt)
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

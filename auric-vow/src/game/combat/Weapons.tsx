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
import { raycastEnemies, resolveEnemyHit, rifleFalloff, RIFLE_RANGE } from './DamageSystem'
import { CombatState, canFight, combatTick } from './state'
import { ammoState, consumeAmmo, startReload } from '@/game/hud/ammoState'

const RIFLE = WEAPONS.rifle
const KATANA = WEAPONS.katana
const DEG = Math.PI / 180
const UP = new THREE.Vector3(0, 1, 0)

/** camera-space muzzle offset — matches WeaponViewModel rifle muzzle tip */
export const MUZZLE_LOCAL = new THREE.Vector3(0.24, -0.145, -0.88)

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

// ---------------------------------------------------------------------------
// Tracer pool — fat additive bolt segments (fix1: the old 1px THREE.Line
// tracers were invisible at range → "one thin beam" critic FAIL). Each tracer
// is a nested cylinder pair (white-hot core + wide gold halo), toneMapped:false
// additive, so it survives tone mapping and feeds bloom. Head segment travels
// 400 m/s, 0.09s life (combat.md §1.1).
// ---------------------------------------------------------------------------

const TRACER_COUNT = 24
const TRACER_SPEED = 400
const TRACER_LIFE = 0.09
const TRACER_SEG = 8
const TRACER_CORE_R = 0.035
const TRACER_HALO_R = 0.1

interface Tracer {
  group: THREE.Group
  core: THREE.Mesh
  halo: THREE.Mesh
  coreMat: THREE.MeshBasicMaterial
  haloMat: THREE.MeshBasicMaterial
  active: boolean
  start: THREE.Vector3
  dir: THREE.Vector3
  dist: number
  travel: number
  life: number
}

const tracerGeo = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true)
tracerGeo.translate(0, 0.5, 0) // pivot at base: scale.y = segment length

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
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    })
    const core = new THREE.Mesh(tracerGeo, coreMat)
    const halo = new THREE.Mesh(tracerGeo, haloMat)
    const group = new THREE.Group()
    group.add(halo, core)
    group.visible = false
    return {
      group,
      core,
      halo,
      coreMat,
      haloMat,
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
  t.life = TRACER_LIFE
  t.group.visible = true
}

function updateTracers(pool: Tracer[], dt: number) {
  for (const t of pool) {
    if (!t.active) continue
    t.travel += TRACER_SPEED * dt
    t.life -= dt
    const head = Math.min(t.travel, t.dist)
    const tail = Math.max(0, head - TRACER_SEG)
    if (t.life <= 0 || tail >= t.dist) {
      t.active = false
      t.group.visible = false
      continue
    }
    const len = Math.max(0.05, head - tail)
    t.group.position.copy(t.start).addScaledVector(t.dir, tail)
    t.core.scale.set(TRACER_CORE_R, len, TRACER_CORE_R)
    t.halo.scale.set(TRACER_HALO_R, len, TRACER_HALO_R)
    const fade = Math.min(1, t.life / TRACER_LIFE)
    t.coreMat.opacity = fade
    t.haloMat.opacity = fade * 0.55
  }
}

// ---------------------------------------------------------------------------
// Gunplay feedback pools (fix2) — muzzle star sprite, brass shell casings,
// scorch decals. All pooled, zero runtime allocation after construction.
// ---------------------------------------------------------------------------

/** 128² 4-point star muzzle texture (white-on-black, additive). */
let muzzleStarTex: THREE.CanvasTexture | null = null
function getMuzzleStarTexture(): THREE.CanvasTexture {
  if (muzzleStarTex) return muzzleStarTex
  const size = 128
  const c = document.createElement('canvas')
  c.width = size
  c.height = size
  const ctx = c.getContext('2d')!
  const cx = size / 2
  const core = ctx.createRadialGradient(cx, cx, 0, cx, cx, size * 0.22)
  core.addColorStop(0, 'rgba(255,255,255,1)')
  core.addColorStop(0.4, 'rgba(255,230,180,0.8)')
  core.addColorStop(1, 'rgba(255,184,53,0)')
  ctx.fillStyle = core
  ctx.fillRect(0, 0, size, size)
  ctx.globalCompositeOperation = 'lighter'
  for (let k = 0; k < 4; k++) {
    ctx.save()
    ctx.translate(cx, cx)
    ctx.rotate((k * Math.PI) / 2 + Math.PI / 4)
    const spike = ctx.createLinearGradient(0, 0, size * 0.5, 0)
    spike.addColorStop(0, 'rgba(255,244,214,0.95)')
    spike.addColorStop(1, 'rgba(255,184,53,0)')
    ctx.fillStyle = spike
    ctx.beginPath()
    ctx.moveTo(0, -size * 0.035)
    ctx.lineTo(size * 0.5, 0)
    ctx.lineTo(0, size * 0.035)
    ctx.closePath()
    ctx.fill()
    ctx.restore()
  }
  muzzleStarTex = new THREE.CanvasTexture(c)
  muzzleStarTex.colorSpace = THREE.SRGBColorSpace
  return muzzleStarTex
}

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

// ---- brass shell casings: instanced quads, gravity, 0.8 s life, pool 24 ----
const SHELL_COUNT = 24
const SHELL_LIFE = 0.8
const SHELL_GRAVITY = 12

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
  /** camera-facing muzzle star sprite (3-piece muzzle flash, part 1) */
  star: THREE.Sprite
  starMat: THREE.SpriteMaterial
  starAge: number
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
  const starMat = new THREE.SpriteMaterial({
    map: getMuzzleStarTexture(),
    color: COLORS.solarWhite,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  })
  const star = new THREE.Sprite(starMat)
  star.visible = false
  star.renderOrder = 23

  const shellGeo = new THREE.PlaneGeometry(0.024, 0.07)
  const shellMat = new THREE.MeshBasicMaterial({
    color: 0xc9962e, // brushed brass
    side: THREE.DoubleSide,
    toneMapped: false,
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

  return { star, starMat, starAge: 1e9, shells, shellState, shellDummy, scorches }
}

const STAR_LIFE = 0.06

/** 3-piece muzzle flash, part 1: camera-facing star sprite pop at the muzzle */
function spawnMuzzleStar(fx: GunFx, muzzle: THREE.Vector3) {
  fx.star.visible = true
  fx.star.position.copy(muzzle)
  fx.star.material.rotation = Math.random() * Math.PI * 2
  fx.star.scale.setScalar(0.42 + Math.random() * 0.18)
  fx.starMat.opacity = 1
  fx.starAge = 0
}

/** 3-piece muzzle flash, part 3: eject a brass casing right-up-back */
function spawnShell(fx: GunFx, camera: THREE.Camera, muzzle: THREE.Vector3) {
  const s = fx.shellState.find((x) => !x.active)
  if (!s) return
  camera.getWorldDirection(_dir)
  _right.crossVectors(_dir, UP)
  if (_right.lengthSq() < 1e-6) _right.set(1, 0, 0)
  _right.normalize()
  s.active = true
  s.life = SHELL_LIFE
  s.pos.copy(muzzle)
  s.vel
    .copy(_right)
    .multiplyScalar(1.6 + Math.random() * 1.2)
    .addScaledVector(UP, 2.2 + Math.random() * 1.1)
    .addScaledVector(_dir, -0.4 - Math.random() * 0.5)
  s.axis.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize()
  s.spin = 18 + Math.random() * 22
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
  // muzzle star: fast pop, gone in 60 ms
  if (fx.star.visible) {
    fx.starAge += dt
    const t = fx.starAge / STAR_LIFE
    if (t >= 1) {
      fx.star.visible = false
      fx.starMat.opacity = 0
    } else {
      fx.starMat.opacity = 1 - t
      const s = fx.star.scale.x * (1 + dt * 6)
      fx.star.scale.setScalar(s)
    }
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

/** world-space muzzle position (camera-space MUZZLE_LOCAL) */
export function getMuzzleWorld(camera: THREE.Camera, out: THREE.Vector3): THREE.Vector3 {
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

function fireShot(camera: THREE.Camera, tracers: Tracer[], fx: GunFx) {
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
    resolveEnemyHit(enemyHit.enemy, dmg, { point: enemyHit.point, crit: enemyHit.crit })
    _end.copy(enemyHit.point)
    // tracer endpoint impact (fix2): gold spark spray + short-lived scorch
    // flash on flesh (a stuck decal would swim on a moving enemy)
    VFX.burst({
      position: enemyHit.point,
      color: COLORS.aureate,
      count: 12,
      speed: 5.5,
      life: 0.28,
      size: 0.055,
      gravity: 4,
    })
    VFX.flash({ position: enemyHit.point, color: COLORS.aureate, intensity: 7, distance: 4, life: 0.09 })
  } else if (wall) {
    // wall impact: bigger gold spark burst + pop flash (fix1)
    VFX.burst({
      position: wall.point,
      color: COLORS.aureate,
      count: 14,
      speed: 5,
      life: 0.3,
      size: 0.06,
      gravity: 4,
    })
    VFX.burst({
      position: wall.point,
      color: COLORS.solarWhite,
      count: 5,
      speed: 7,
      life: 0.18,
      size: 0.05,
      gravity: 0,
    })
    VFX.flash({ position: wall.point, color: COLORS.aureate, intensity: 10, distance: 6, life: 0.08 })
    // scorch decal stuck to the hit surface, ~6 s char fade (fix2)
    spawnScorch(fx, wall.point, wall.normal)
    _end.copy(wall.point)
  } else {
    _end.copy(_dir).multiplyScalar(RIFLE_RANGE).add(_origin)
  }

  spawnTracer(tracers, _muzzle, _end)

  // muzzle flash 3-piece set (fix2): camera-facing star sprite + point-light
  // flash via VFX + ejecting brass casing (+ spark spit, star flip in view model)
  spawnMuzzleStar(fx, _muzzle)
  VFX.flash({ position: _muzzle, color: COLORS.aureate, intensity: 26, distance: 8, life: 0.06 })
  spawnShell(fx, camera, _muzzle)
  VFX.burst({ position: _muzzle, color: COLORS.solarWhite, count: 4, speed: 6, life: 0.15, size: 0.04, gravity: 2 })
  cs.muzzleFlashAt = cs.clock
  cs.muzzleFlip = !cs.muzzleFlip

  // recoil: view-model spring kick + camera trauma + deterministic pitch kick
  cs.recoil = Math.min(1.5, cs.recoil + 1)
  addTrauma(0.03) // combat.md §5 (buffed fix2: 0.02 → 0.03)
  CamRef.pitch = THREE.MathUtils.clamp(
    CamRef.pitch + 0.008,
    -MOVE.cam.pitchLimit,
    MOVE.cam.pitchLimit,
  )
  AudioBus.playRifle()
}

function updateRifle(camera: THREE.Camera, dt: number, tracers: Tracer[], fx: GunFx) {
  const cs = CombatState
  cs.aiming = canFight() && Input.held('aim')
  cs.fireCooldown -= dt
  cs.recoil = Math.max(0, cs.recoil - 10 * dt) // spring recovery 10/s
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
    canFight() &&
    Input.held('fire') &&
    cs.fireCooldown <= 0 &&
    consumeAmmo() // false → mag went dry between frames; next pass reloads
  ) {
    fireShot(camera, tracers, fx)
  }
  cs.ammo = ammoState.mag
}

// ---------------------------------------------------------------------------
// Katana
// ---------------------------------------------------------------------------

let trailSeq = 0

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
  AudioBus.playKatana()
  if (airborne && step === 2) {
    cs.slamPending = true
    cs.slamMinVy = 0
    cs.slamUntil = cs.clock + 1.5
  }
}

/** world-space blade-tip position along the swing arc (drives VFX ribbon) */
export function bladeTipWorld(
  camera: THREE.Camera,
  swing: { step: number; t: number; dur: number },
  out: THREE.Vector3,
): THREE.Vector3 {
  const p = Math.min(1, swing.t / swing.dur)
  camera.getWorldDirection(_dir)
  _dir.y = 0
  if (_dir.lengthSq() < 1e-6) _dir.set(0, 0, -1)
  _dir.normalize()
  _right.crossVectors(_dir, UP)
  _pt.copy(PlayerRef.position)
  _pt.y += 1.25
  if (swing.step === 0) {
    // Draw Cut — 140° horizontal, right → left
    const a = THREE.MathUtils.lerp(70, -70, p) * DEG
    out
      .copy(_pt)
      .addScaledVector(_dir, Math.cos(a) * 2.1)
      .addScaledVector(_right, Math.sin(a) * 2.1)
    out.y = _pt.y + 0.15
  } else if (swing.step === 1) {
    // Rising Reversal — diagonal left-low → right-high
    const a = THREE.MathUtils.lerp(-55, 55, p) * DEG
    out
      .copy(_pt)
      .addScaledVector(_dir, Math.cos(a) * 2.0)
      .addScaledVector(_right, Math.sin(a) * 2.0)
    out.y = PlayerRef.position.y + THREE.MathUtils.lerp(0.6, 2.2, p)
  } else {
    // Heaven Splitter — overhead vertical chop
    out.copy(_pt).addScaledVector(_dir, THREE.MathUtils.lerp(0.8, 1.9, p))
    out.y = PlayerRef.position.y + THREE.MathUtils.lerp(2.6, 0.25, p)
  }
  return out
}

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
    resolveEnemyHit(e, KATANA.comboDamage[swing.step], { point: _pt, stagger: 30, knockback: kb })
    // white-gold impact flash at contact (combat.md §2.1)
    VFX.flash({ position: _pt, color: COLORS.solarWhite, intensity: 12, distance: 5, life: 0.08 })
  }
  if (hits > 0) {
    // hitstop: 60 ms, 90 ms on finisher (combat.md §5)
    useGameStore
      .getState()
      .setTimeScale(TIMESCALE.hitstopKatana, swing.step === 2 ? 0.09 : TIMESCALE.hitstopDurationSec)
    addTrauma(0.15)
  }
  // arc shockwave visual crescent (approximated with an expanding ring at chest)
  _pt.copy(origin)
  _pt.y += 1.3
  VFX.ring({ position: _pt, color: COLORS.aureate, maxRadius: SWING_RANGE, life: 0.15, width: 0.4 })
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

function updateKatana(camera: THREE.Camera, dt: number) {
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

    // golden ribbon trail from the blade tip (16 samples ≈ per-frame pushes)
    bladeTipWorld(camera, swing, _pt)
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
  const groupRef = useRef<THREE.Group>(null)

  useFrame((state, rawDt) => {
    const dt = combatTick(state.clock.elapsedTime, rawDt)
    updateRifle(state.camera, dt, tracers, gunFx)
    updateKatana(state.camera, dt)
    updateTracers(tracers, dt)
    updateGunFx(gunFx, dt)
  })

  return (
    <group ref={groupRef}>
      {tracers.map((t, i) => (
        <primitive key={i} object={t.group} />
      ))}
      {/* fix2 gunplay feedback: muzzle star + brass casings + scorch decals */}
      <primitive object={gunFx.star} />
      <primitive object={gunFx.shells} />
      {gunFx.scorches.map((s, i) => (
        <primitive key={`scorch-${i}`} object={s.mesh} />
      ))}
    </group>
  )
}

/**
 * AURIC VOW — combat/Abilities.tsx
 * The four abilities of Vessel KAIRO. Spec: combat.md §3 + design.md §4.
 *
 *   Q — Gilt Dash:       14 m blink, 0.3s i-frames, 60 dmg pass-through,
 *                        afterimage ghosts + streak ribbon + gold spray.
 *   E — Sunspike Volley: 0.35s windup, 7 homing golden javelins, 45 dmg each.
 *   1 — Aegis Halo:      5s barrier, +100 decaying overshield, +30% speed,
 *                        30 dmg / 4 m cast shock pulse, rotating glyph halo.
 *   4 — Auric Requiem:   4-layer ult (fix2): ≤0.15s screen flash → 0.4s
 *                        rooted charge (60 motes spiral INWARD, 0.25× time)
 *                        → detonation (deforming glyph torus shockwave 0→12 m
 *                        in 0.35s + 120-particle gold vortex, 250→120 dmg,
 *                        stagger 100, heavy knockback) → 3s aftermath (glowing
 *                        glyph floor decal + 40 lingering embers + faint ring).
 *
 * All cooldown/energy enforcement goes through the store (spendEnergy);
 * HUD reads cooldowns via getCombatHudSnapshot() / onCombatEvent().
 */
import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { Input } from '@/game/Input'
import { AudioBus } from '@/game/AudioBus'
import { VFX } from '@/game/vfx/VFXBus'
import { PlayerRef } from '@/game/player/PlayerRef'
import { addTrauma } from '@/game/player/CameraRig'
import { EnemyRegistry } from '@/game/enemies/EnemyRegistry'
import { raycastLevel } from '@/game/world/Colliders'
import { ABILITIES, COLORS, TIMESCALE } from '@/game/config'
import { useGameStore } from '@/game/store'
import { getGlyphSpriteTexture } from '@/game/textures'
import { resolveEnemyHit } from './DamageSystem'
import { CombatState, canFight, combatTick, emitCombat, type AbilityId, ABILITY_IDS } from './state'
import { triggerCooldown, triggerActive, setOvershield } from '@/game/hud/abilityState'

const DEG = Math.PI / 180
const UP = new THREE.Vector3(0, 1, 0)

/** soft radial glow sprite texture (canvas, lazy — fix1 javelin heads) */
let glowTex: THREE.CanvasTexture | null = null
function getGlowTexture(): THREE.CanvasTexture {
  if (glowTex) return glowTex
  const size = 128
  const c = document.createElement('canvas')
  c.width = size
  c.height = size
  const ctx = c.getContext('2d')!
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.25, 'rgba(255,244,220,0.85)')
  g.addColorStop(0.6, 'rgba(255,184,53,0.35)')
  g.addColorStop(1, 'rgba(255,184,53,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  glowTex = new THREE.CanvasTexture(c)
  glowTex.colorSpace = THREE.SRGBColorSpace
  return glowTex
}

// ---- A1 Gilt Dash (combat.md §3.1) ----
const DASH_SPEED = 30
const DASH_DUR = 0.45
const DASH_IFRAMES = 0.3
const DASH_DMG = 60
const DASH_SWEEP_R = 1.2
const GHOST_COUNT = 3
const GHOST_INTERVAL = 0.06
const GHOST_FADE = 0.4

// ---- A2 Sunspike Volley (§3.2) ----
const JAVELIN_COUNT = 7
const JAVELIN_DMG = 45
const JAVELIN_SPEED = 35
const JAVELIN_LIFE = 3
const JAVELIN_HOMING_RATE = 120 * DEG // rad/s steer cap
const JAVELIN_SEEK_RADIUS = 8
const JAVELIN_FAN_DEG = 30
const VOLLEY_WINDUP = 0.35
const VOLLEY_SPAWN_INTERVAL = 0.03

// ---- A3 Aegis Halo (§3.3) ----
const AEGIS_DURATION = 5
const AEGIS_OVERSHIELD = 100
const AEGIS_PULSE_DMG = 30
const AEGIS_PULSE_RADIUS = 4
const AEGIS_SPEED_MULT = 1.3

// ---- A4 Auric Requiem (§3.4) — 4-layer structure (fix2) ----
// (a) ≤0.15s screen flash, (b) 0.4s inward mote spiral, (c) deforming torus
// shockwave + 120-particle gold vortex, (d) 3s glyph floor decal + embers
// + persistent faint ring.
const REQUIEM_CHARGE = 0.4
const REQUIEM_RADIUS = 12
const REQUIEM_DMG_CENTER = 250
const REQUIEM_DMG_EDGE = 120
const REQUIEM_AFTERGLOW = 3.0
const REQUIEM_SHOCKWAVE_DUR = 0.35
const REQUIEM_SCREEN_FLASH = 0.14
const REQUIEM_PILLARS = 8
const REQUIEM_PILLAR_RADIUS = 10
const REQUIEM_MOTES = 60

// scratch
const _dir = new THREE.Vector3()
const _right = new THREE.Vector3()
const _pt = new THREE.Vector3()
const _pt2 = new THREE.Vector3()
const _to = new THREE.Vector3()
const _desired = new THREE.Vector3()
const _prev = new THREE.Vector3()

// ---------------------------------------------------------------------------
// Cast gating
// ---------------------------------------------------------------------------

function tryCast(id: AbilityId): boolean {
  const cs = CombatState
  const spec = ABILITIES[id]
  const blocked = cs.clock < cs.cooldownReadyAt[id] || cs.requiemPhase === 1
  if (blocked || !useGameStore.getState().spendEnergy(spec.cost)) {
    emitCombat({ type: 'denied', id }) // HUD: icon shake + dull red edge flash
    AudioBus.playUIClick()
    return false
  }
  cs.cooldownReadyAt[id] = cs.clock + spec.cooldownSec
  triggerCooldown(ABILITY_IDS.indexOf(id), spec.cooldownSec) // HUD diamond sweep
  emitCombat({ type: 'cast', id })
  return true
}

// ---------------------------------------------------------------------------
// A1 — Gilt Dash
// ---------------------------------------------------------------------------

function castDash(camera: THREE.Camera) {
  const cs = CombatState
  camera.getWorldDirection(_dir)
  // flatten pitch to ±20° (§3.1)
  const horizLen = Math.hypot(_dir.x, _dir.z)
  if (horizLen < 1e-5) return
  const pitch = THREE.MathUtils.clamp(Math.atan2(_dir.y, horizLen), -20 * DEG, 20 * DEG)
  const hx = _dir.x / horizLen
  const hz = _dir.z / horizLen
  cs.dashDir.set(hx * Math.cos(pitch), Math.sin(pitch), hz * Math.cos(pitch)).normalize()

  cs.dashing = true
  cs.dashUntil = cs.clock + DASH_DUR
  cs.invulnerableUntil = cs.clock + DASH_IFRAMES
  cs.dashHits.clear()
  cs.ghostsToSpawn = GHOST_COUNT
  cs.nextGhostAt = cs.clock
  cs.dashTrail = VFX.trail('gilt-dash')

  _pt.copy(PlayerRef.position)
  _pt.y += 1
  // Screen-presence package (fix1): big light flash + expanding ring +
  // ≥100 gold spray particles (44 + 40 + 30) with slight upward drift (§3.1)
  VFX.flash({ position: _pt, color: COLORS.aureate, intensity: 30, distance: 15, life: 0.18 })
  VFX.ring({ position: PlayerRef.position, color: COLORS.aureate, maxRadius: 3, life: 0.35, width: 0.35 })
  VFX.burst({ position: _pt, color: COLORS.aureate, count: 44, speed: 3, life: 0.4, size: 0.07, gravity: -1.5 })
  VFX.burst({ position: _pt, color: COLORS.solarWhite, count: 40, speed: 4.5, life: 0.35, size: 0.06, gravity: -1 })
  VFX.burst({ position: _pt, color: COLORS.aureate, count: 30, speed: 2, life: 0.5, size: 0.09, gravity: -0.5 })
  addTrauma(0.12) // a push, not a shake — dash stays clean (§3.1)
  AudioBus.playWhoosh()
  AudioBus.playAbility() // choir stab approximation (220/277/330 detuned sines)
  emitCombat({ type: 'dash' }) // movement agent: refresh double jump / FOV +10 kick
}

function updateDash(
  ghostRefs: (THREE.Group | null)[],
  ghostMats: THREE.MeshBasicMaterial[][],
  ghostSpawnAt: number[],
) {
  const cs = CombatState
  if (!cs.dashing) {
    updateGhosts(ghostRefs, ghostMats, ghostSpawnAt)
    return
  }
  // motion: velocity override at 30 m/s along dash dir (PlayerRef integration)
  PlayerRef.velocity.copy(cs.dashDir).multiplyScalar(DASH_SPEED)

  _pt.copy(PlayerRef.position)
  _pt.y += 1.0
  cs.dashTrail?.push(_pt) // streak ribbon along the path

  // afterimage ghosts at 0.06s intervals
  if (cs.ghostsToSpawn > 0 && cs.clock >= cs.nextGhostAt) {
    const idx = GHOST_COUNT - cs.ghostsToSpawn
    const g = ghostRefs[idx]
    if (g) {
      g.position.copy(PlayerRef.position)
      g.visible = true
      ghostSpawnAt[idx] = cs.clock
    }
    cs.ghostsToSpawn--
    cs.nextGhostAt = cs.clock + GHOST_INTERVAL
  }
  updateGhosts(ghostRefs, ghostMats, ghostSpawnAt)

  // capsule sweep damage — radius 1.2 m around the dash path point
  for (const e of EnemyRegistry.list()) {
    if (!e.alive || cs.dashHits.has(e.id)) continue
    _to.copy(e.position)
    _to.y += e.height * 0.5
    _to.sub(_pt)
    if (_to.length() > DASH_SWEEP_R + e.radius) continue
    cs.dashHits.add(e.id)
    _pt2.copy(e.position)
    _pt2.y += e.height * 0.5
    resolveEnemyHit(e, DASH_DMG, { point: _pt2, ability: true, stagger: 25 })
    // white flash + teal-to-gold crackle (§3.1)
    VFX.flash({ position: _pt2, color: COLORS.solarWhite, intensity: 8, distance: 4, life: 0.1 })
    VFX.burst({ position: _pt2, color: COLORS.aureate, count: 8, speed: 3.5, life: 0.3, size: 0.05, gravity: 1 })
  }

  if (cs.clock >= cs.dashUntil) {
    cs.dashing = false
    cs.dashTrail?.end()
    cs.dashTrail = null
  }
}

function updateGhosts(
  ghostRefs: (THREE.Group | null)[],
  ghostMats: THREE.MeshBasicMaterial[][],
  ghostSpawnAt: number[],
) {
  const cs = CombatState
  for (let i = 0; i < GHOST_COUNT; i++) {
    const g = ghostRefs[i]
    if (!g || !g.visible) continue
    const age = cs.clock - ghostSpawnAt[i]
    if (age >= GHOST_FADE) {
      g.visible = false
      continue
    }
    const o = 0.9 * (1 - age / GHOST_FADE) // brighter afterimages (fix1)
    for (const m of ghostMats[i]) m.opacity = o
  }
}

// ---------------------------------------------------------------------------
// A2 — Sunspike Volley
// ---------------------------------------------------------------------------

function castVolley() {
  const cs = CombatState
  cs.volleyActive = true
  cs.volleyWindupUntil = cs.clock + VOLLEY_WINDUP
  cs.volleyNextSpawnAt = cs.clock
  cs.volleySpawned = 0
  cs.volleyLaunched = false
  AudioBus.playAbility()
}

/** arc anchor behind the shoulders for javelin i (recomputed while winding up) */
function javelinAnchor(camera: THREE.Camera, i: number, out: THREE.Vector3) {
  camera.getWorldDirection(_dir)
  _dir.y = 0
  if (_dir.lengthSq() < 1e-6) _dir.set(0, 0, -1)
  _dir.normalize()
  _right.crossVectors(_dir, UP)
  out.copy(PlayerRef.position)
  out.y += 1.7 + Math.sin((i / (JAVELIN_COUNT - 1)) * Math.PI) * 0.25
  out.addScaledVector(_dir, -0.35)
  out.addScaledVector(_right, (i - (JAVELIN_COUNT - 1) / 2) * 0.28)
  return out
}

function javelinBurst(pos: THREE.Vector3) {
  // per-javelin burst (§3.2, buffed fix1): 30 sparks + 1.6 m ring + hot flash
  VFX.burst({ position: pos, color: COLORS.aureate, count: 30, speed: 7, life: 0.35, size: 0.08, gravity: 2 })
  VFX.burst({ position: pos, color: COLORS.solarWhite, count: 10, speed: 9, life: 0.2, size: 0.06, gravity: 0 })
  VFX.ring({ position: pos, color: COLORS.aureate, maxRadius: 1.6, life: 0.3, width: 0.22 })
  VFX.flash({ position: pos, color: COLORS.solarWhite, intensity: 32, distance: 15, life: 0.12 })
  addTrauma(0.1)
  AudioBus.playHit()
}

function updateVolley(camera: THREE.Camera, dt: number, javelinRefs: (THREE.Group | null)[]) {
  const cs = CombatState
  if (!cs.volleyActive) return

  // --- windup: materialize one javelin per 30 ms, hovering in an arc ---
  if (!cs.volleyLaunched) {
    while (cs.volleySpawned < JAVELIN_COUNT && cs.clock >= cs.volleyNextSpawnAt) {
      const j = cs.javelins[cs.volleySpawned]
      j.active = true
      j.flying = false
      j.life = JAVELIN_LIFE
      javelinAnchor(camera, cs.volleySpawned, j.pos)
      j.vel.set(0, 0, 0)
      cs.volleySpawned++
      cs.volleyNextSpawnAt = cs.clock + VOLLEY_SPAWN_INTERVAL
      AudioBus.playUIClick() // ascending chime-note approximation
    }
    // anchors track the player for the rest of the windup
    for (let i = 0; i < cs.volleySpawned; i++) {
      const j = cs.javelins[i]
      if (!j.flying) javelinAnchor(camera, i, j.pos)
    }
    // --- launch: 30° fan toward camera aim ---
    if (cs.clock >= cs.volleyWindupUntil && cs.volleySpawned >= JAVELIN_COUNT) {
      camera.getWorldDirection(_dir)
      for (let i = 0; i < JAVELIN_COUNT; i++) {
        const j = cs.javelins[i]
        const off = (-JAVELIN_FAN_DEG / 2 + (JAVELIN_FAN_DEG * i) / (JAVELIN_COUNT - 1)) * DEG
        const cos = Math.cos(off)
        const sin = Math.sin(off)
        j.vel.set(_dir.x * cos - _dir.z * sin, _dir.y, _dir.x * sin + _dir.z * cos).normalize()
        j.vel.multiplyScalar(JAVELIN_SPEED)
        j.flying = true
      }
      cs.volleyLaunched = true
      AudioBus.playWhoosh()
      addTrauma(0.15) // a push, not a shake (§3.2)
      // launch screen-presence (fix1): flash + ring + ≥100-particle fan burst
      _pt.copy(PlayerRef.position)
      _pt.y += 1.6
      VFX.flash({ position: _pt, color: COLORS.solarWhite, intensity: 30, distance: 15, life: 0.2 })
      VFX.ring({ position: PlayerRef.position, color: COLORS.aureate, maxRadius: 2.5, life: 0.35, width: 0.3 })
      VFX.burst({ position: _pt, color: COLORS.aureate, count: 60, speed: 6, life: 0.5, size: 0.07, gravity: 1 })
      VFX.burst({ position: _pt, color: COLORS.solarWhite, count: 40, speed: 8, life: 0.35, size: 0.06, gravity: 0 })
    }
  }

  // --- flight: homing, wall/enemy collision ---
  let anyActive = false
  for (const j of cs.javelins) {
    if (!j.active) continue
    anyActive = true
    if (!j.flying) continue

    j.life -= dt
    _prev.copy(j.pos)

    // light homing: steer ≤120°/s toward nearest enemy within 8 m
    let target: (ReturnType<typeof EnemyRegistry.list>)[number] | null = null
    let targetD = JAVELIN_SEEK_RADIUS
    for (const e of EnemyRegistry.list()) {
      if (!e.alive) continue
      _to.copy(e.position)
      _to.y += e.height * 0.5
      const d = _to.distanceTo(j.pos)
      if (d < targetD) {
        targetD = d
        target = e
      }
    }
    if (target) {
      _desired.copy(target.position)
      _desired.y += target.height * 0.5
      _desired.sub(j.pos).normalize()
      _dir.copy(j.vel).normalize()
      const ang = _dir.angleTo(_desired)
      if (ang > 1e-4) {
        const t = Math.min(1, (JAVELIN_HOMING_RATE * dt) / ang)
        _dir.lerp(_desired, t).normalize()
        j.vel.copy(_dir).multiplyScalar(JAVELIN_SPEED)
      }
    }

    const stepLen = j.vel.length() * dt
    _dir.copy(j.vel).normalize()
    j.pos.addScaledVector(_dir, stepLen)

    // wall burst
    const wall = raycastLevel(_prev, _dir, stepLen + 0.05)
    if (wall) {
      javelinBurst(wall.point)
      j.active = false
      continue
    }

    // enemy hit
    let hit = false
    for (const e of EnemyRegistry.list()) {
      if (!e.alive) continue
      _to.copy(e.position)
      _to.y += e.height * 0.5
      if (_to.distanceTo(j.pos) > e.radius + 0.3) continue
      _pt2.copy(j.pos)
      resolveEnemyHit(e, JAVELIN_DMG, { point: _pt2, ability: true, stagger: 15 })
      javelinBurst(_pt2)
      j.active = false
      hit = true
      break
    }
    if (hit) continue

    if (j.life <= 0) {
      _pt2.copy(j.pos)
      javelinBurst(_pt2)
      j.active = false
    }
  }

  // --- sync meshes ---
  for (let i = 0; i < JAVELIN_COUNT; i++) {
    const g = javelinRefs[i]
    const j = cs.javelins[i]
    if (!g || !j) continue
    g.visible = j.active
    if (!j.active) continue
    g.position.copy(j.pos)
    if (j.flying) {
      _pt.copy(j.pos).add(j.vel)
      g.lookAt(_pt)
    } else {
      camera.getWorldDirection(_dir)
      _pt.copy(j.pos).add(_dir)
      g.lookAt(_pt)
    }
  }

  if (cs.volleyLaunched && !anyActive) cs.volleyActive = false
}

// ---------------------------------------------------------------------------
// A3 — Aegis Halo
// ---------------------------------------------------------------------------

function castAegis() {
  const cs = CombatState
  cs.aegisUntil = cs.clock + AEGIS_DURATION
  cs.overshield = AEGIS_OVERSHIELD
  cs.speedMult = AEGIS_SPEED_MULT
  cs.nextRippleAt = cs.clock
  triggerActive(2, AEGIS_DURATION) // HUD: rotating-dash border + radial fill
  setOvershield(AEGIS_OVERSHIELD)

  // cast shock pulse: 30 dmg / 4 m / light stagger (§3.3)
  _pt.copy(PlayerRef.position)
  for (const e of EnemyRegistry.list()) {
    if (!e.alive) continue
    _to.copy(e.position).sub(_pt)
    _to.y = 0
    const d = _to.length()
    if (d > AEGIS_PULSE_RADIUS + e.radius) continue
    _pt2.copy(e.position)
    _pt2.y += e.height * 0.5
    const kb = d > 1e-4 ? _to.clone().divideScalar(d).multiplyScalar(4).setY(1.5) : undefined
    resolveEnemyHit(e, AEGIS_PULSE_DMG, { point: _pt2, ability: true, stagger: 40, knockback: kb })
  }

  // expanding ground ring + ≥100 radial sparks + big flash (§3.3, buffed fix1)
  VFX.ring({ position: _pt, color: COLORS.aureate, maxRadius: AEGIS_PULSE_RADIUS, life: 0.4, width: 0.6 })
  VFX.ring({ position: _pt, color: COLORS.solarWhite, maxRadius: AEGIS_PULSE_RADIUS * 0.6, life: 0.3, width: 0.4 })
  _pt.y += 1.2
  VFX.burst({ position: _pt, color: COLORS.aureate, count: 40, speed: 6, life: 0.5, size: 0.07, gravity: 2 })
  VFX.burst({ position: _pt, color: COLORS.solarWhite, count: 40, speed: 8, life: 0.4, size: 0.06, gravity: 1 })
  VFX.burst({ position: _pt, color: COLORS.aureate, count: 30, speed: 3.5, life: 0.7, size: 0.09, gravity: -0.5 })
  VFX.flash({ position: _pt, color: COLORS.aureate, intensity: 32, distance: 15, life: 0.2 })
  AudioBus.playAbility() // deep-bell approximation
  addTrauma(0.25)
}

function updateAegis(
  dt: number,
  haloRef: THREE.Group | null,
  glyphRefs: (THREE.Mesh | null)[],
  shellRef: THREE.Mesh | null,
) {
  const cs = CombatState
  const active = cs.clock < cs.aegisUntil

  // overshield break VFX (queued by the damage intercept)
  if (cs.overshieldBreakPending) {
    cs.overshieldBreakPending = false
    _pt.copy(PlayerRef.position)
    _pt.y += 1.2
    // shard burst — 40 gold glass shards + big flash (§3.3, buffed fix1)
    VFX.burst({ position: _pt, color: COLORS.solarWhite, count: 40, speed: 8, life: 0.4, size: 0.08, gravity: 6 })
    VFX.flash({ position: _pt, color: COLORS.solarWhite, intensity: 30, distance: 15, life: 0.14 })
    AudioBus.playShieldBreak()
    emitCombat({ type: 'overshield-break' })
  }

  if (!active) {
    if (cs.speedMult !== 1) cs.speedMult = 1
    if (haloRef) haloRef.visible = false
    if (shellRef) shellRef.visible = false
    return
  }

  // overshield decays with duration (§3.3)
  const remaining = cs.aegisUntil - cs.clock
  cs.overshield = Math.min(cs.overshield, AEGIS_OVERSHIELD * (remaining / AEGIS_DURATION))

  // underfoot ripple ring every 0.5 s
  if (cs.clock >= cs.nextRippleAt) {
    cs.nextRippleAt += 0.5
    VFX.ring({ position: PlayerRef.position, color: COLORS.solarWhite, maxRadius: 1.6, life: 0.5, width: 0.2 })
  }

  // rotating double ring above the head + orbiting glyphs
  if (haloRef) {
    haloRef.visible = true
    haloRef.position.copy(PlayerRef.position)
    haloRef.position.y += 2.15
    haloRef.rotation.y += dt * 1.2
    for (let i = 0; i < glyphRefs.length; i++) {
      const g = glyphRefs[i]
      if (!g) continue
      const a = cs.clock * 0.9 + (i / glyphRefs.length) * Math.PI * 2
      g.position.set(Math.cos(a) * 0.95, Math.sin(cs.clock * 2 + i) * 0.07, Math.sin(a) * 0.95)
      g.rotation.y = -a + Math.PI / 2
    }
  }
  // additive gold shell (second-shell rim approximation, §3.3)
  if (shellRef) {
    shellRef.visible = true
    shellRef.position.copy(PlayerRef.position)
    shellRef.position.y += 0.95
  }
}

// ---------------------------------------------------------------------------
// A4 — Auric Requiem
// ---------------------------------------------------------------------------

interface RequiemFx {
  /** deforming torus shockwave with scrolling glyph texture (detonation) */
  torus: THREE.Mesh
  torusMat: THREE.ShaderMaterial
  motes: THREE.Points
  moteAttr: THREE.BufferAttribute
  moteSeeds: Float32Array // per mote: startRadius, baseAngle, yOff, swirlDir
  /** full-screen additive white-gold overlay at detonation (§3.4, fix1) */
  screenFlash: THREE.Mesh
  screenFlashMat: THREE.MeshBasicMaterial
  /** aftermath: fading gold radial glyph disc on the ground (3s) */
  decal: THREE.Mesh
  decalMat: THREE.MeshBasicMaterial
  /** aftermath: persistent faint ring at the blast edge (3s) */
  faintRing: THREE.Mesh
  faintRingMat: THREE.MeshBasicMaterial
}

function castRequiem(fx: RequiemFx) {
  const cs = CombatState
  // hard-cancel any dash so the rooted charge isn't fought by dash velocity
  if (cs.dashing) {
    cs.dashing = false
    cs.dashTrail?.end()
    cs.dashTrail = null
  }
  cs.requiemPhase = 1
  cs.requiemT = 0
  cs.requiemOrigin.copy(PlayerRef.position)
  // 1.2 s of 0.25× global time-dilation covering charge + detonation (§3.4)
  useGameStore.getState().setTimeScale(TIMESCALE.slowmoUlt, TIMESCALE.slowmoUltDurationSec)
  AudioBus.playAbility() // reversed choir swell approximation
  fx.motes.visible = true
  fx.torus.visible = false
  fx.decal.visible = false
  fx.faintRing.visible = false
}

function detonateRequiem(fx: RequiemFx) {
  const cs = CombatState
  const origin = cs.requiemOrigin

  // radial damage: 250 center → 120 at edge, linear (§3.4); heavy stagger
  for (const e of EnemyRegistry.list()) {
    if (!e.alive) continue
    _to.copy(e.position).sub(origin)
    _to.y = 0
    const d = _to.length()
    if (d > REQUIEM_RADIUS + e.radius) continue
    const f = THREE.MathUtils.clamp(d / REQUIEM_RADIUS, 0, 1)
    const dmg = THREE.MathUtils.lerp(REQUIEM_DMG_CENTER, REQUIEM_DMG_EDGE, f)
    _pt2.copy(e.position)
    _pt2.y += e.height * 0.5
    // fix2: BIG knockback so survivors are visibly hurled out of the nova
    // (8→14 horizontal, 3→6 launch) and kills dissolve mid-flight
    const kb = d > 1e-4 ? _to.clone().divideScalar(d).multiplyScalar(14).setY(6) : undefined
    resolveEnemyHit(e, dmg, { point: _pt2, ability: true, stagger: 100, knockback: kb })
  }

  _pt.copy(origin)
  _pt.y += 1.2
  // (c) DETONATION — blinding flash + 120-particle gold vortex (tangential
  // swirl field) + the deforming torus shockwave mesh (see updateRequiem)
  VFX.flash({ position: _pt, color: COLORS.solarWhite, intensity: 60, distance: 40, life: 0.12 })
  VFX.flash({ position: _pt, color: COLORS.aureate, intensity: 45, distance: 30, life: 0.4 }) // lingering glow (fix1)
  VFX.ring({ position: origin, color: COLORS.solarWhite, maxRadius: REQUIEM_RADIUS, life: 0.35, width: 1.2 })
  VFX.burst({
    position: _pt,
    color: COLORS.aureate,
    count: 120,
    speed: 9,
    life: 0.9,
    size: 0.1,
    gravity: 0.6,
    swirl: 11, // gold vortex — particles orbit the blast axis as they fly out
  })
  // (d) AFTERMATH — 40 lingering embers drifting up over the scorched decal
  VFX.burst({ position: _pt, color: COLORS.solarWhite, count: 40, speed: 1.2, life: 2.6, size: 0.07, gravity: -0.4, swirl: 2.5 })

  addTrauma(0.7)
  AudioBus.playUltimate() // cathedral organ hit + sub-bass drop

  fx.motes.visible = false
  // torus shockwave: expands 0 → 12 m in 0.35 s (uProgress driven per-frame)
  fx.torus.visible = true
  fx.torus.position.copy(origin)
  fx.torus.position.y += 0.25
  fx.torusMat.uniforms.uProgress!.value = 0
  fx.torusMat.uniforms.uOpacity!.value = 1
  fx.torusMat.uniforms.uTime!.value = 0
  // glowing glyph floor decal (3 s fade) + persistent faint ring at the edge
  fx.decal.visible = true
  fx.decal.position.copy(origin)
  fx.decal.position.y += 0.07
  fx.decal.rotation.z = Math.random() * Math.PI * 2
  fx.decalMat.opacity = 0.9
  fx.faintRing.visible = true
  fx.faintRing.position.copy(origin)
  fx.faintRing.position.y += 0.09
  fx.faintRingMat.opacity = 0.4
  // (a) full-screen white-gold flash — 0.85 → 0 over 0.14 s (≤0.15 s, fix2)
  fx.screenFlash.visible = true
  fx.screenFlashMat.opacity = 0.85

  cs.requiemPhase = 2
  cs.requiemT = 0
}

function updateRequiem(
  dt: number,
  camera: THREE.Camera,
  fx: RequiemFx,
  pillarRefs: (THREE.Mesh | null)[],
  pillarMats: THREE.MeshBasicMaterial[],
) {
  const cs = CombatState
  if (cs.requiemPhase === 0) {
    for (const p of pillarRefs) if (p) p.visible = false
    if (fx.screenFlash.visible) {
      fx.screenFlash.visible = false
      fx.screenFlashMat.opacity = 0
    }
    if (fx.decal.visible) {
      fx.decal.visible = false
      fx.decalMat.opacity = 0
    }
    if (fx.faintRing.visible) {
      fx.faintRing.visible = false
      fx.faintRingMat.opacity = 0
    }
    return
  }
  cs.requiemT += dt

  // pillars ring the cast point; cylindrical-billboard toward the player
  for (let i = 0; i < REQUIEM_PILLARS; i++) {
    const p = pillarRefs[i]
    if (!p) continue
    const a = (i / REQUIEM_PILLARS) * Math.PI * 2
    p.position.set(
      cs.requiemOrigin.x + Math.cos(a) * REQUIEM_PILLAR_RADIUS,
      cs.requiemOrigin.y + 10,
      cs.requiemOrigin.z + Math.sin(a) * REQUIEM_PILLAR_RADIUS,
    )
    p.rotation.y = -a + Math.PI / 2
  }

  if (cs.requiemPhase === 1) {
    // rooted during the 0.4 s charge (§3.4 — vulnerable, high risk/reward)
    PlayerRef.velocity.x = 0
    PlayerRef.velocity.z = 0

    // pillars fade in to 0.55 (fix1: brighter, must dominate the arena edge)
    const fade = Math.min(1, cs.requiemT / REQUIEM_CHARGE) * 0.55
    for (let i = 0; i < REQUIEM_PILLARS; i++) {
      const p = pillarRefs[i]
      if (!p) continue
      p.visible = true
      pillarMats[i].opacity = fade
    }

    // 60 gold motes spiral INTO the player
    const p = Math.min(1, cs.requiemT / REQUIEM_CHARGE)
    _pt.copy(cs.requiemOrigin)
    _pt.y += 1.2
    for (let i = 0; i < REQUIEM_MOTES; i++) {
      const s = i * 4
      const r0 = fx.moteSeeds[s]!
      const ang = fx.moteSeeds[s + 1]! + p * Math.PI * 4 * fx.moteSeeds[s + 3]!
      const y0 = fx.moteSeeds[s + 2]!
      const r = r0 * (1 - p)
      fx.moteAttr.setXYZ(
        i,
        _pt.x + Math.cos(ang) * r,
        _pt.y + y0 * (1 - p),
        _pt.z + Math.sin(ang) * r,
      )
    }
    fx.moteAttr.needsUpdate = true

    if (cs.requiemT >= REQUIEM_CHARGE) detonateRequiem(fx)
  } else {
    // ---- (c) detonation: deforming torus shockwave 0 → 12 m in 0.35 s ----
    const t = cs.requiemT
    const expand = Math.min(1, t / REQUIEM_SHOCKWAVE_DUR)
    fx.torusMat.uniforms.uProgress!.value = expand
    fx.torusMat.uniforms.uTime!.value = t
    fx.torusMat.uniforms.uOpacity!.value = Math.max(0, 1 - t / 0.7)
    if (fx.torus.visible) {
      // ease-out expansion; slight overshoot pop at the front
      const eased = 1 - (1 - expand) * (1 - expand)
      const s = Math.max(0.001, THREE.MathUtils.lerp(0.6, REQUIEM_RADIUS, eased))
      fx.torus.scale.set(s, s, s)
      if (t > 0.75) fx.torus.visible = false
    }

    // ---- (d) aftermath: glyph floor decal + faint ring fade over 3 s ----
    if (fx.decal.visible) {
      const fade = Math.max(0, 1 - t / REQUIEM_AFTERGLOW)
      fx.decalMat.opacity = 0.9 * fade * fade
      fx.decal.rotation.z += dt * 0.15 // slow ceremonial spin
      if (fade <= 0) fx.decal.visible = false
    }
    if (fx.faintRing.visible) {
      const fade = Math.max(0, 1 - t / REQUIEM_AFTERGLOW)
      fx.faintRingMat.opacity = 0.4 * fade
      if (fade <= 0) fx.faintRing.visible = false
    }

    // (a) full-screen white-gold overlay: 0.85 → 0 over 0.14 s (≤0.15 s)
    if (fx.screenFlash.visible) {
      const ft = t / REQUIEM_SCREEN_FLASH
      if (ft >= 1) {
        fx.screenFlash.visible = false
        fx.screenFlashMat.opacity = 0
      } else {
        const persp = camera as THREE.PerspectiveCamera
        const dist = 1.5
        camera.getWorldDirection(_dir)
        fx.screenFlash.position.copy(camera.position).addScaledVector(_dir, dist)
        fx.screenFlash.quaternion.copy(camera.quaternion)
        const h = 2 * dist * Math.tan(THREE.MathUtils.degToRad(persp.fov ?? 70) / 2) * 1.15
        const w = h * (persp.aspect ?? 16 / 9)
        fx.screenFlash.scale.set(w, h, 1)
        fx.screenFlashMat.opacity = 0.85 * (1 - ft) * (1 - ft)
      }
    }

    // pillars fade out
    const fade = Math.max(0, 0.55 * (1 - t / 0.8))
    for (let i = 0; i < REQUIEM_PILLARS; i++) {
      const p = pillarRefs[i]
      if (!p) continue
      pillarMats[i].opacity = fade
      if (fade <= 0) p.visible = false
    }

    if (cs.requiemT >= REQUIEM_AFTERGLOW) cs.requiemPhase = 0
  }
}

/** deterministic mote seed table (module-level so render stays pure) */
function makeMoteSeeds(): Float32Array {
  const seeds = new Float32Array(REQUIEM_MOTES * 4)
  let seed = 0x9e3779b9
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 0xffffffff
  }
  for (let i = 0; i < REQUIEM_MOTES; i++) {
    seeds[i * 4] = 4 + rand() * 3 // start radius
    seeds[i * 4 + 1] = rand() * Math.PI * 2 // base angle
    seeds[i * 4 + 2] = (rand() - 0.3) * 2.5 // y offset
    seeds[i * 4 + 3] = rand() < 0.5 ? 1 : -1 // swirl direction
  }
  return seeds
}

// ---------------------------------------------------------------------------
// Requiem torus shockwave shader (fix2 §3.4c) — a unit-radius torus, scaled
// 0.6 → 12 m over 0.35 s, whose tube deforms (radial wobble grows with
// uProgress) while the canvas glyph rune scrolls around the ring (uv.x).
// ---------------------------------------------------------------------------

const NOVA_VERT = /* glsl */ `
uniform float uProgress;
uniform float uTime;
varying vec2 vUv;
varying float vBand;
void main() {
  vUv = uv;
  // angle around the main ring
  float ang = atan(position.z, position.x);
  // deforming shockwave: radial ripple racing around the ring, amplitude
  // grows as the front expands so the torus reads as tearing outward
  float wob = sin(ang * 9.0 - uTime * 22.0) * 0.5
            + sin(ang * 17.0 + uTime * 13.0) * 0.3;
  vec3 p = position + normal * wob * (0.05 + uProgress * 0.16);
  vBand = 0.5 + 0.5 * wob;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`

const NOVA_FRAG = /* glsl */ `
uniform float uProgress;
uniform float uOpacity;
uniform float uTime;
uniform sampler2D uGlyph;
varying vec2 vUv;
varying float vBand;
void main() {
  // scrolling glyph runes around the ring (uv.x = around, uv.y = tube)
  vec2 guv = vec2(fract(vUv.x * 10.0 - uTime * 2.6), vUv.y);
  float glyph = texture2D(uGlyph, guv).r;
  vec3 gold = vec3(1.0, 0.72, 0.21);   // #FFB835
  vec3 white = vec3(1.0, 0.953, 0.84); // #FFF3D6
  // hot leading edge early, glyph-etched gold body after
  float heat = 1.0 - uProgress * 0.55;
  vec3 col = mix(gold, white, clamp(heat * (0.35 + vBand * 0.5), 0.0, 1.0));
  float a = (0.55 + glyph * 0.85) * uOpacity;
  // overbright so the shockwave survives tone mapping + feeds bloom
  gl_FragColor = vec4(col * (1.5 + glyph * 1.2 + vBand * 0.6), a);
}
`

// ---------------------------------------------------------------------------
// Component — input edge handling + per-frame ability state machines + meshes
// ---------------------------------------------------------------------------

export function AbilitySystems() {
  // javelin pool state (module CombatState holds logic; refs hold meshes)
  if (CombatState.javelins.length === 0) {
    for (let i = 0; i < JAVELIN_COUNT; i++) {
      CombatState.javelins.push({
        active: false,
        flying: false,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        life: 0,
      })
    }
  }

  const javelinRefs = useRef<(THREE.Group | null)[]>([])
  const ghostRefs = useRef<(THREE.Group | null)[]>([])
  const ghostSpawnAt = useRef<number[]>(Array.from({ length: GHOST_COUNT }, () => -1))
  const haloRef = useRef<THREE.Group>(null)
  const shellRef = useRef<THREE.Mesh>(null)
  const glyphRefs = useRef<(THREE.Mesh | null)[]>([])
  const pillarRefs = useRef<(THREE.Mesh | null)[]>([])
  const prevRemaining = useRef<Record<AbilityId, number>>({ A1: 0, A2: 0, A3: 0, A4: 0 })

  const ghostMats = useMemo(
    () =>
      Array.from({ length: GHOST_COUNT }, () => [
        new THREE.MeshBasicMaterial({
          color: COLORS.aureate,
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          toneMapped: false, // fix1: keep ghosts hot through tone mapping
        }),
        new THREE.MeshBasicMaterial({
          color: COLORS.solarWhite,
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          toneMapped: false,
        }),
      ]),
    [],
  )

  const pillarMats = useMemo(
    () =>
      Array.from({ length: REQUIEM_PILLARS }, () =>
        new THREE.MeshBasicMaterial({
          color: COLORS.aureate,
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
          toneMapped: false, // fix1: pillars must stay hot through tone mapping
        }),
      ),
    [],
  )

  const glyphTex = useMemo(() => getGlyphSpriteTexture(), [])

  // requiem torus shockwave + converging motes + aftermath decal, built imperatively
  const requiemFx = useMemo<RequiemFx>(() => {
    const torusMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: {
        uProgress: { value: 0 },
        uOpacity: { value: 0 },
        uTime: { value: 0 },
        uGlyph: { value: glyphTex },
      },
      vertexShader: NOVA_VERT,
      fragmentShader: NOVA_FRAG,
    })
    // unit ring radius, fat tube — scaled 0.6 → 12 m at detonation
    const torus = new THREE.Mesh(new THREE.TorusGeometry(1, 0.055, 12, 96), torusMat)
    torus.rotation.x = -Math.PI / 2 // lie flat on the ground plane
    torus.visible = false
    torus.frustumCulled = false
    torus.renderOrder = 21

    const moteGeo = new THREE.BufferGeometry()
    const moteAttr = new THREE.BufferAttribute(new Float32Array(REQUIEM_MOTES * 3), 3)
    moteGeo.setAttribute('position', moteAttr)
    const moteSeeds = makeMoteSeeds()
    const motes = new THREE.Points(
      moteGeo,
      new THREE.PointsMaterial({
        color: COLORS.aureate,
        size: 0.14, // fix1: 0.09 → 0.14 so motes read at range
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        sizeAttenuation: true,
        toneMapped: false,
      }),
    )
    motes.visible = false
    motes.frustumCulled = false

    // aftermath decal: fading gold radial glyph disc scorched into the floor
    const decalMat = new THREE.MeshBasicMaterial({
      map: glyphTex,
      color: COLORS.aureate,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    })
    const decal = new THREE.Mesh(new THREE.CircleGeometry(REQUIEM_RADIUS * 0.45, 48), decalMat)
    decal.rotation.x = -Math.PI / 2
    decal.visible = false
    decal.frustumCulled = false
    decal.renderOrder = 18

    // persistent faint ring at the blast edge (3 s fade)
    const faintRingMat = new THREE.MeshBasicMaterial({
      color: COLORS.aureate,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    })
    const faintRing = new THREE.Mesh(
      new THREE.RingGeometry(REQUIEM_RADIUS * 0.96, REQUIEM_RADIUS, 96),
      faintRingMat,
    )
    faintRing.rotation.x = -Math.PI / 2
    faintRing.visible = false
    faintRing.frustumCulled = false
    faintRing.renderOrder = 18

    // full-screen detonation overlay (fix1): camera-locked additive quad
    const screenFlashMat = new THREE.MeshBasicMaterial({
      color: COLORS.solarWhite,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      toneMapped: false,
    })
    const screenFlash = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), screenFlashMat)
    screenFlash.visible = false
    screenFlash.frustumCulled = false
    screenFlash.renderOrder = 40

    return {
      torus,
      torusMat,
      motes,
      moteAttr,
      moteSeeds,
      screenFlash,
      screenFlashMat,
      decal,
      decalMat,
      faintRing,
      faintRingMat,
    }
  }, [glyphTex])

  useFrame((state, rawDt) => {
    const dt = combatTick(state.clock.elapsedTime, rawDt)
    const cs = CombatState

    // input edges
    if (canFight()) {
      if (Input.pressed('ability1') && tryCast('A1')) castDash(state.camera)
      if (Input.pressed('ability2') && tryCast('A2')) castVolley()
      if (Input.pressed('ability3') && tryCast('A3')) castAegis()
      if (Input.pressed('ability4') && tryCast('A4')) castRequiem(requiemFx)
    }

    // cooldown-ready pings for the HUD (§4)
    for (const id of ABILITY_IDS) {
      const remaining = Math.max(0, cs.cooldownReadyAt[id] - cs.clock)
      if (prevRemaining.current[id] > 0 && remaining <= 0) emitCombat({ type: 'ready', id })
      prevRemaining.current[id] = remaining
    }

    updateDash(ghostRefs.current, ghostMats, ghostSpawnAt.current)
    updateVolley(state.camera, dt, javelinRefs.current)
    updateAegis(dt, haloRef.current, glyphRefs.current, shellRef.current)
    updateRequiem(dt, state.camera, requiemFx, pillarRefs.current, pillarMats)

    // keep the HUD overshield bar in sync (the damage intercept in state.ts
    // drains cs.overshield from outside this module)
    setOvershield(cs.overshield)
  })

  return (
    <group>
      {/* ---- sunspike javelins: FAT additive white core + gold halo + glow head (fix1) ---- */}
      {Array.from({ length: JAVELIN_COUNT }, (_, i) => (
        <group
          key={`javelin-${i}`}
          ref={(g) => {
            javelinRefs.current[i] = g
          }}
          visible={false}
        >
          <mesh rotation-x={Math.PI / 2}>
            <coneGeometry args={[0.09, 0.75, 6]} />
            <meshBasicMaterial
              color={COLORS.solarWhite}
              transparent
              opacity={1}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
              toneMapped={false}
            />
          </mesh>
          <mesh rotation-x={Math.PI / 2} scale={2.1}>
            <coneGeometry args={[0.09, 0.75, 6]} />
            <meshBasicMaterial
              color={COLORS.aureate}
              transparent
              opacity={0.45}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
              toneMapped={false}
            />
          </mesh>
          {/* camera-facing additive glow head — reads at 10–20 m */}
          <sprite position={[0, 0, 0.3]} scale={[0.85, 0.85, 1]}>
            <spriteMaterial
              map={getGlowTexture()}
              color={COLORS.solarWhite}
              transparent
              opacity={0.95}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
              toneMapped={false}
            />
          </sprite>
        </group>
      ))}

      {/* ---- gilt dash afterimage ghosts (additive gold player silhouettes) ---- */}
      {ghostMats.map((mats, i) => (
        <group
          key={`ghost-${i}`}
          ref={(g) => {
            ghostRefs.current[i] = g
          }}
          visible={false}
        >
          <mesh position={[0, 0.95, 0]} material={mats[0]}>
            <capsuleGeometry args={[0.32, 1.1, 4, 8]} />
          </mesh>
          <mesh position={[0, 1.72, 0]} material={mats[1]}>
            <boxGeometry args={[0.26, 0.28, 0.28]} />
          </mesh>
        </group>
      ))}

      {/* ---- aegis halo: LARGE double ring + 6 orbiting glyph sprites (fix1) ---- */}
      <group ref={haloRef} visible={false}>
        <mesh rotation-x={Math.PI / 2}>
          <torusGeometry args={[0.62, 0.035, 8, 40]} />
          <meshBasicMaterial
            color={COLORS.solarWhite}
            transparent
            opacity={0.9}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
        <mesh rotation-x={Math.PI / 2}>
          <torusGeometry args={[0.8, 0.02, 8, 40]} />
          <meshBasicMaterial
            color={COLORS.aureate}
            transparent
            opacity={0.75}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
        {Array.from({ length: 6 }, (_, i) => (
          <mesh
            key={`glyph-${i}`}
            ref={(m) => {
              glyphRefs.current[i] = m
            }}
          >
            <planeGeometry args={[0.3, 0.3]} />
            <meshBasicMaterial
              map={glyphTex}
              color={COLORS.aureate}
              transparent
              opacity={0.8}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
              side={THREE.DoubleSide}
              toneMapped={false}
            />
          </mesh>
        ))}
      </group>

      {/* ---- aegis body shell (additive gold second-shell rim, brightened fix1) ---- */}
      <mesh ref={shellRef} visible={false}>
        <capsuleGeometry args={[0.47, 1.15, 4, 12]} />
        <meshBasicMaterial
          color={COLORS.aureate}
          transparent
          opacity={0.3}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>

      {/* ---- requiem: 8 vertical light pillars + motes + torus shockwave + aftermath ---- */}
      {pillarMats.map((mat, i) => (
        <mesh
          key={`pillar-${i}`}
          ref={(m) => {
            pillarRefs.current[i] = m
          }}
          material={mat}
          visible={false}
          frustumCulled={false}
        >
          <planeGeometry args={[3, 22]} />
        </mesh>
      ))}
      <primitive object={requiemFx.motes} />
      <primitive object={requiemFx.torus} />
      <primitive object={requiemFx.decal} />
      <primitive object={requiemFx.faintRing} />
      <primitive object={requiemFx.screenFlash} />
    </group>
  )
}

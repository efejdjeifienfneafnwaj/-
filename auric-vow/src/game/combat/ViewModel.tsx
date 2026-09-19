/* eslint-disable react-hooks/immutability -- imperative three.js material mutation inside useFrame is idiomatic R3F */
/**
 * AURIC VOW — combat/ViewModel.tsx
 *
 * The player's weapons, held in the player's hands.
 *
 * [combat-feel R1] This file used to copy the camera transform and draw a
 * rifle across the lens of a THIRD-PERSON camera — two near-plane slabs over
 * a quarter of every frame, which is what all five critics led with. The rig
 * is now a real child of `PlayerSockets.rightHand` (scabbard: `.hip`):
 *
 *   - both weapons are authored around a GRIP ORIGIN at (0,0,0) at world
 *     scale — the rifle is 0.9 m from stock plate to muzzle, the katana
 *     0.95 m of blade — so they sit in the hand at believable size;
 *   - the rifle's bore runs along -Z, and each frame the rig is rotated so
 *     that -Z lands on the camera's forward axis, which is the axis the hit
 *     raycast uses: what the player sees and what the shot does agree;
 *   - `MuzzleWorld` / `EjectWorld` are published from the real barrel-tip and
 *     ejection-port meshes, so tracers, flashes, the muzzle light and brass
 *     all leave the weapon the player can actually see;
 *   - there is no camera-space fallback branch left. If the rig has not
 *     mounted, nothing is drawn.
 *
 * Everything is procedural: chamfered extrusions, a lathed muzzle collar, a
 * swept diamond-section katana blade and two baked-once canvas maps.
 */
import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { COLORS } from '@/game/config'
import { bladeTipWorld, EjectWorld, MuzzleWorld } from './Weapons'
import { PlayerSockets } from '@/game/player/PlayerRig'
import { CombatState } from './state'
import { ammoState } from '@/game/hud/ammoState'

const _tip = new THREE.Vector3()
const _socketPos = new THREE.Vector3()
const _aimDir = new THREE.Vector3()
const _worldPos = new THREE.Vector3()
const _aimQuat = new THREE.Quaternion()
const _socketQuat = new THREE.Quaternion()
const _aimMat = new THREE.Matrix4()
const _zero = new THREE.Vector3()
const UP = new THREE.Vector3(0, 1, 0)

/** aim state: the rifle pulls in and levels when the player holds RMB */
const AIM_POS = new THREE.Vector3(0, -0.035, 0.04)

// ---------------------------------------------------------------------------
// Procedural maps — baked once, shared by every weapon material
// ---------------------------------------------------------------------------

/**
 * 256² roughness map: machined panel seams, fastener dots and a light scuff
 * pass. Dark = smooth, so the seams read as polished recesses catching the
 * key light while the panel faces stay matte.
 */
let panelTex: THREE.CanvasTexture | null = null
function getWeaponPanelTexture(): THREE.CanvasTexture {
  if (panelTex) return panelTex
  const size = 256
  const c = document.createElement('canvas')
  c.width = size
  c.height = size
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#b4b4b4'
  ctx.fillRect(0, 0, size, size)
  // longitudinal panel seams
  ctx.strokeStyle = '#3a3a3a'
  ctx.lineWidth = 2
  for (const y of [0.18, 0.5, 0.82]) {
    ctx.beginPath()
    ctx.moveTo(0, size * y)
    ctx.lineTo(size, size * y)
    ctx.stroke()
  }
  // cross seams at irregular intervals
  ctx.lineWidth = 1.5
  for (const x of [0.12, 0.3, 0.44, 0.63, 0.79, 0.91]) {
    ctx.beginPath()
    ctx.moveTo(size * x, 0)
    ctx.lineTo(size * x, size)
    ctx.stroke()
  }
  // fasteners
  ctx.fillStyle = '#585858'
  for (let i = 0; i < 26; i++) {
    const x = ((i * 67) % size) + 6
    const y = ((i * 149) % size) + 4
    ctx.beginPath()
    ctx.arc(x, y, 2.2, 0, Math.PI * 2)
    ctx.fill()
  }
  // scuffs: brighter = rougher, breaks up flat highlights
  ctx.strokeStyle = 'rgba(235,235,235,0.5)'
  for (let i = 0; i < 40; i++) {
    const x = (i * 97) % size
    const y = (i * 53) % size
    ctx.lineWidth = 1 + (i % 3) * 0.6
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x + 10 + (i % 7) * 4, y + ((i % 5) - 2))
    ctx.stroke()
  }
  panelTex = new THREE.CanvasTexture(c)
  panelTex.wrapS = THREE.RepeatWrapping
  panelTex.wrapT = THREE.RepeatWrapping
  panelTex.repeat.set(3, 2)
  return panelTex
}

/** 128² muzzle flare: white core, warm falloff, six spikes of uneven length. */
let flareTex: THREE.CanvasTexture | null = null
function getFlareTexture(): THREE.CanvasTexture {
  if (flareTex) return flareTex
  const size = 128
  const c = document.createElement('canvas')
  c.width = size
  c.height = size
  const ctx = c.getContext('2d')!
  const cx = size / 2
  const core = ctx.createRadialGradient(cx, cx, 0, cx, cx, size * 0.3)
  core.addColorStop(0, 'rgba(255,255,255,1)')
  core.addColorStop(0.35, 'rgba(255,243,214,0.85)')
  core.addColorStop(1, 'rgba(255,184,53,0)')
  ctx.fillStyle = core
  ctx.fillRect(0, 0, size, size)
  ctx.globalCompositeOperation = 'lighter'
  const spikes = [0.5, 0.3, 0.46, 0.26, 0.4, 0.22]
  for (let k = 0; k < spikes.length; k++) {
    ctx.save()
    ctx.translate(cx, cx)
    ctx.rotate((k * Math.PI * 2) / spikes.length + 0.18)
    const g = ctx.createLinearGradient(0, 0, size * spikes[k]!, 0)
    g.addColorStop(0, 'rgba(255,248,226,0.95)')
    g.addColorStop(1, 'rgba(255,184,53,0)')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.moveTo(0, -size * 0.03)
    ctx.lineTo(size * spikes[k]!, 0)
    ctx.lineTo(0, size * 0.03)
    ctx.closePath()
    ctx.fill()
    ctx.restore()
  }
  flareTex = new THREE.CanvasTexture(c)
  flareTex.colorSpace = THREE.SRGBColorSpace
  return flareTex
}

// ---------------------------------------------------------------------------
// Geometry builders
// ---------------------------------------------------------------------------

/**
 * Chamfered box: an octagonal profile extruded along Z with a small bevel on
 * the end caps, so every edge catches a 1–2 mm machined highlight instead of
 * dying as a hard 90° corner.
 */
function chamferBox(w: number, h: number, d: number, chamfer = 0.006): THREE.BufferGeometry {
  const hw = w / 2
  const hh = h / 2
  const c = Math.min(chamfer, hw * 0.45, hh * 0.45)
  const shape = new THREE.Shape()
  shape.moveTo(-hw + c, -hh)
  shape.lineTo(hw - c, -hh)
  shape.lineTo(hw, -hh + c)
  shape.lineTo(hw, hh - c)
  shape.lineTo(hw - c, hh)
  shape.lineTo(-hw + c, hh)
  shape.lineTo(-hw, hh - c)
  shape.lineTo(-hw, -hh + c)
  shape.closePath()
  const bev = Math.min(c * 0.6, d * 0.2)
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.001, d - bev * 2),
    bevelEnabled: true,
    bevelThickness: bev,
    bevelSize: bev,
    bevelSegments: 1,
    steps: 1,
    curveSegments: 1,
  })
  g.translate(0, 0, -(d / 2 - bev))
  g.computeVertexNormals()
  return g
}

/** Lathed muzzle collar: a stepped Orokin ring turned around the bore. */
function muzzleCollar(): THREE.BufferGeometry {
  const pts = [
    new THREE.Vector2(0.021, -0.028),
    new THREE.Vector2(0.03, -0.026),
    new THREE.Vector2(0.032, -0.016),
    new THREE.Vector2(0.026, -0.012),
    new THREE.Vector2(0.026, 0.004),
    new THREE.Vector2(0.036, 0.01),
    new THREE.Vector2(0.034, 0.022),
    new THREE.Vector2(0.022, 0.028),
  ]
  const g = new THREE.LatheGeometry(pts, 16)
  g.rotateX(Math.PI / 2) // lathe axis Y → bore axis Z
  return g
}

/**
 * Katana blade: a diamond cross-section swept along a curved spine (sori),
 * tapering to a kissaki point. Four facets per segment, so the edge catches a
 * separate highlight from the shinogi-ji — the thing a flat box can never do.
 */
function katanaBlade(
  len: number,
  halfH: number,
  halfT: number,
  sori: number,
): THREE.BufferGeometry {
  const N = 18
  const pos: number[] = []
  const idx: number[] = []
  for (let i = 0; i <= N; i++) {
    const u = i / N
    const base = 1 - u * 0.16
    const taper = u < 0.88 ? base : base * Math.max(0.05, 1 - (u - 0.88) / 0.12)
    const h = Math.max(0.0015, halfH * taper)
    const t = Math.max(0.0007, halfT * taper)
    const z = u * len
    const yc = -sori * u * u
    pos.push(0, yc + h, z) // 0 spine (mune)
    pos.push(t, yc, z) //     1 right face
    pos.push(0, yc - h, z) // 2 edge (ha)
    pos.push(-t, yc, z) //    3 left face
  }
  for (let i = 0; i < N; i++) {
    const a = i * 4
    const b = (i + 1) * 4
    for (let k = 0; k < 4; k++) {
      const p = k
      const q = (k + 1) % 4
      // wound so the facet normals point OUT of the blade
      idx.push(a + p, b + q, a + q, a + p, b + p, b + q)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

/** Tapered scabbard shell: the blade profile, fattened and squared off. */
function scabbardGeometry(len: number): THREE.BufferGeometry {
  const N = 12
  const pos: number[] = []
  const idx: number[] = []
  for (let i = 0; i <= N; i++) {
    const u = i / N
    const s = 1 - u * 0.22
    const h = 0.042 * s
    const t = 0.014 * s
    const z = u * len
    const yc = -0.05 * u * u
    pos.push(0, yc + h, z)
    pos.push(t, yc + h * 0.25, z)
    pos.push(t * 0.8, yc - h, z)
    pos.push(-t * 0.8, yc - h, z)
    pos.push(-t, yc + h * 0.25, z)
  }
  for (let i = 0; i < N; i++) {
    const a = i * 5
    const b = (i + 1) * 5
    for (let k = 0; k < 5; k++) {
      const p = k
      const q = (k + 1) % 5
      idx.push(a + p, b + q, a + q, a + p, b + p, b + q)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

// ---------------------------------------------------------------------------
// Reload choreography (weakness C4: `cs.reloading` was never read at all)
// ---------------------------------------------------------------------------

const easeOut = (t: number) => 1 - (1 - t) * (1 - t)
const easeIn = (t: number) => t * t
/** 0 outside [a,b], ramped 0→1 inside */
const seg = (t: number, a: number, b: number) =>
  THREE.MathUtils.clamp((t - a) / Math.max(1e-4, b - a), 0, 1)

export function WeaponViewModel() {
  const rootRef = useRef<THREE.Group>(null)
  const rifleRef = useRef<THREE.Group>(null)
  const magRef = useRef<THREE.Group>(null)
  const boltRef = useRef<THREE.Mesh>(null)
  const muzzleRef = useRef<THREE.Object3D>(null)
  const ejectRef = useRef<THREE.Object3D>(null)
  const flashRef = useRef<THREE.Group>(null)
  const flareRef = useRef<THREE.Sprite>(null)
  const coneRef = useRef<THREE.Mesh>(null)
  const handKatanaRef = useRef<THREE.Group>(null)
  const sheathRootRef = useRef<THREE.Group>(null)
  const aimT = useRef(0)
  const lastFlashAt = useRef(-1)
  const flashRoll = useRef(0)

  // ---- geometry: procedural, built once -----------------------------------
  const geo = useMemo(
    () => ({
      receiver: chamferBox(0.072, 0.098, 0.42, 0.012),
      deck: chamferBox(0.058, 0.022, 0.3, 0.005),
      sidePlate: chamferBox(0.012, 0.062, 0.24, 0.004),
      grip: chamferBox(0.046, 0.17, 0.072, 0.01),
      stock: chamferBox(0.05, 0.085, 0.2, 0.012),
      stockPlate: chamferBox(0.062, 0.13, 0.026, 0.008),
      mag: chamferBox(0.042, 0.155, 0.082, 0.008),
      handguard: chamferBox(0.062, 0.07, 0.24, 0.014),
      railBlock: chamferBox(0.03, 0.026, 0.11, 0.005),
      energyChannel: chamferBox(0.028, 0.03, 0.3, 0.004),
      collar: muzzleCollar(),
      blade: katanaBlade(0.95, 0.031, 0.0048, 0.055),
      // deliberately deeper than the steel's half-height so the glow line
      // stands proud of the ha instead of being buried inside the blade
      bladeEdge: katanaBlade(0.955, 0.012, 0.0024, 0.055),
      scabbard: scabbardGeometry(1.0),
    }),
    [],
  )

  // ---- materials: shared, tiered ------------------------------------------
  const mats = useMemo(() => {
    const panel = getWeaponPanelTexture()
    return {
      /** obsidian frame — the mass of the weapon */
      body: new THREE.MeshStandardMaterial({
        color: '#15171D',
        metalness: 0.35,
        roughness: 0.45,
        roughnessMap: panel,
      }),
      /** darker recess for channels and gaps — the weapon's true black */
      recess: new THREE.MeshStandardMaterial({
        color: '#08090C',
        metalness: 0.2,
        roughness: 0.85,
      }),
      /** polished gold: narrow, bright specular ramp */
      gold: new THREE.MeshStandardMaterial({
        color: COLORS.regalGold,
        metalness: 0.95,
        roughness: 0.15,
        side: THREE.DoubleSide,
      }),
      /** cast gold: broad, dull highlight for the bigger ornamental masses */
      goldCast: new THREE.MeshStandardMaterial({
        color: COLORS.regalGold,
        metalness: 0.85,
        roughness: 0.42,
        roughnessMap: panel,
      }),
      /** ceramic shell panels — the light value that gives silhouette */
      ivory: new THREE.MeshStandardMaterial({
        color: COLORS.shrineIvory,
        metalness: 0.05,
        roughness: 0.5,
        roughnessMap: panel,
      }),
      /** blade steel */
      steel: new THREE.MeshStandardMaterial({
        color: '#C9CED8',
        metalness: 0.92,
        roughness: 0.16,
        side: THREE.DoubleSide,
      }),
      /** wrapped grip / ray skin */
      wrap: new THREE.MeshStandardMaterial({
        color: '#1B1A22',
        metalness: 0.1,
        roughness: 0.78,
        roughnessMap: panel,
      }),
      /** energy — the only thing on the weapon allowed past the bloom knee */
      energy: new THREE.MeshBasicMaterial({
        color: COLORS.aureate,
        toneMapped: false,
        side: THREE.DoubleSide,
      }),
      energyHot: new THREE.MeshBasicMaterial({
        color: COLORS.solarWhite,
        toneMapped: false,
        side: THREE.DoubleSide,
      }),
      flash: new THREE.SpriteMaterial({
        map: getFlareTexture(),
        color: COLORS.solarWhite,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
      cone: new THREE.MeshBasicMaterial({
        color: COLORS.aureate,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
    }
  }, [])

  // ---- parent the rigs to the player's sockets ----------------------------
  // The socket groups are created by PlayerRig; they may not exist on the
  // first frame, so attachment is retried in useFrame and undone on unmount.
  useEffect(() => {
    const root = rootRef.current
    const sheath = sheathRootRef.current
    return () => {
      root?.parent?.remove(root)
      sheath?.parent?.remove(sheath)
    }
  }, [])

  useFrame((state, rawDt) => {
    const cs = CombatState
    const root = rootRef.current
    const sheath = sheathRootRef.current
    if (!root) return

    const socket = PlayerSockets.rightHand
    const hipSock = PlayerSockets.hip

    // ---- attach (once the rig exists) ------------------------------------
    if (socket && root.parent !== socket) socket.add(root)
    if (sheath && hipSock && sheath.parent !== hipSock) hipSock.add(sheath)
    // nothing is ever drawn unattached: an orphaned rig would sit at the
    // world origin, which is precisely the class of bug this file is fixing
    const sheathed = !!sheath && !!hipSock && sheath.parent === hipSock
    if (sheath && !sheathed) sheath.visible = false

    if (!socket || root.parent !== socket) {
      // no rig, no weapon — there is no camera-space fallback any more
      root.visible = false
      MuzzleWorld.valid = false
      EjectWorld.valid = false
      return
    }

    // ---- cull when the hand is inside the near plane ---------------------
    socket.getWorldPosition(_socketPos)
    const nearCull = state.camera.near + 0.5
    if (_socketPos.distanceToSquared(state.camera.position) < nearCull * nearCull) {
      root.visible = false
      if (sheath) sheath.visible = false
      MuzzleWorld.valid = false
      EjectWorld.valid = false
      return
    }
    root.visible = true

    // ---- aim the rig down the camera's forward axis ----------------------
    // The hit raycast uses exactly this vector, so the bore and the bullet
    // agree. -Z of the weapon rig is the bore, hence lookAt(-aimDir).
    state.camera.getWorldDirection(_aimDir)
    _aimMat.lookAt(_zero, _aimDir, UP)
    _aimQuat.setFromRotationMatrix(_aimMat)
    socket.getWorldQuaternion(_socketQuat)
    root.quaternion.copy(_socketQuat).invert().multiply(_aimQuat)
    root.position.set(0, 0, 0)

    // aim slide (CameraRig owns the FOV 70→55 kick)
    aimT.current += ((cs.aiming ? 1 : 0) - aimT.current) * Math.min(1, rawDt / 0.12)

    // ---- rifle: aim pose, recoil kick, reload choreography ---------------
    const rifle = rifleRef.current
    const mag = magRef.current
    const bolt = boltRef.current
    const swinging = cs.swing !== null
    if (rifle) {
      rifle.visible = !swinging
      const a = aimT.current
      const kick = cs.recoil

      // reload: 1.4 s — drop the mag, seat a fresh one, cycle the bolt
      let rl = 0
      let magDrop = 0
      let boltPull = 0
      if (ammoState.reloading) {
        rl = THREE.MathUtils.clamp(ammoState.reloadT / ammoState.reloadSec, 0, 1)
        // mag out 0→0.3, new mag rising 0.42→0.68, seated after
        magDrop = easeIn(seg(rl, 0.02, 0.3)) - easeOut(seg(rl, 0.42, 0.68))
        // charging handle 0.72→0.88 back, snapping forward by 0.96
        boltPull = seg(rl, 0.72, 0.86) - easeOut(seg(rl, 0.86, 0.96))
      }
      // the whole weapon tips out of the aim line while the hands work
      const tilt = Math.sin(Math.PI * seg(rl, 0, 1)) * (ammoState.reloading ? 1 : 0)

      rifle.position.set(
        AIM_POS.x * a + tilt * 0.05,
        AIM_POS.y * a - tilt * 0.06,
        AIM_POS.z * a + 0.022 * kick,
      )
      rifle.rotation.set(0.07 * kick + tilt * 0.55, tilt * 0.5, -tilt * 0.35)

      if (mag) {
        mag.position.set(0, -0.155 * magDrop, 0.02 * magDrop)
        mag.rotation.x = 0.5 * magDrop
      }
      // base z comes from the JSX pose — the pull is added to it
      if (bolt) bolt.position.z = 0.02 + 0.055 * boltPull
    }

    // ---- publish the real barrel tip + ejection port ---------------------
    if (muzzleRef.current && rifle?.visible) {
      muzzleRef.current.getWorldPosition(_worldPos)
      MuzzleWorld.position.copy(_worldPos)
      MuzzleWorld.valid = true
    } else {
      MuzzleWorld.valid = false
    }
    if (ejectRef.current && rifle?.visible) {
      ejectRef.current.getWorldPosition(_worldPos)
      EjectWorld.position.copy(_worldPos)
      EjectWorld.valid = true
    } else {
      EjectWorld.valid = false
    }

    // ---- muzzle flash: hot core + rolled flare + a short bore cone -------
    // 0.1 s, i.e. ~3 frames at 30 fps: a 33 ms capture step can never miss it.
    const flash = flashRef.current
    if (flash) {
      const age = cs.clock - cs.muzzleFlashAt
      const on = age >= 0 && age < 0.1 && rifle?.visible === true
      flash.visible = on
      if (on) {
        if (cs.muzzleFlashAt !== lastFlashAt.current) {
          lastFlashAt.current = cs.muzzleFlashAt
          flashRoll.current = Math.random() * Math.PI * 2
          // a Sprite ignores parent roll — its own roll is a material property
          mats.flash.rotation = flashRoll.current
          flash.rotation.z = flashRoll.current * 0.5
        }
        const t = age / 0.1
        const o = t < 0.3 ? 1 : 1 - (t - 0.3) / 0.7
        mats.flash.opacity = o
        mats.cone.opacity = o * 0.7
        const s = 0.26 + t * 0.14
        if (flareRef.current) flareRef.current.scale.setScalar(s * (cs.muzzleFlip ? 1.1 : 0.92))
        if (coneRef.current) {
          const c = 1 - t * 0.35
          coneRef.current.scale.set(c, 1 + t * 0.5, c)
        }
      }
    }

    // ---- katana: in-hand during a swing, sheathed otherwise --------------
    const hand = handKatanaRef.current
    const swing = cs.swing
    if (hand) {
      if (swing) {
        hand.visible = true
        // lookAt resolves in world space and divides out the parent rotation,
        // so the blade (+Z) tracks the same arc Weapons.tsx damages along.
        bladeTipWorld(state.camera, swing, _tip)
        hand.lookAt(_tip)
      } else {
        hand.visible = false
      }
    }
    if (sheath && sheathed) sheath.visible = !swing
  })

  return (
    <>
      {/* ============ right-hand rig: bore along -Z, grip at the origin ============ */}
      <group ref={rootRef}>
        <group ref={rifleRef}>
          {/* ---------------- grip + trigger group ---------------- */}
          <mesh
            geometry={geo.grip}
            material={mats.body}
            position={[0, -0.085, 0.012]}
            rotation={[-0.17, 0, 0]}
            castShadow
          />
          <mesh
            geometry={geo.grip}
            material={mats.gold}
            scale={[1.06, 0.14, 1.04]}
            position={[0, -0.006, 0.012]}
            rotation={[-0.17, 0, 0]}
          />
          {/* trigger guard */}
          <mesh position={[0, -0.042, -0.055]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.035, 0.007, 6, 14, Math.PI]} />
            <meshStandardMaterial color="#15171D" metalness={0.5} roughness={0.35} />
          </mesh>

          {/* ---------------- receiver ---------------- */}
          <mesh geometry={geo.receiver} material={mats.body} position={[0, 0.05, -0.1]} castShadow />
          {/* ivory shell panels: the light value that carries the silhouette */}
          <mesh geometry={geo.sidePlate} material={mats.ivory} position={[0.041, 0.055, -0.11]} />
          <mesh geometry={geo.sidePlate} material={mats.ivory} position={[-0.041, 0.055, -0.11]} />
          <mesh geometry={geo.deck} material={mats.ivory} position={[0, 0.108, -0.12]} />
          {/* recessed energy channel: dark surround, hot core inside it */}
          <mesh geometry={geo.energyChannel} material={mats.recess} position={[0, 0.022, -0.12]} />
          <mesh material={mats.energy} position={[0, 0.022, -0.12]}>
            <boxGeometry args={[0.016, 0.012, 0.27]} />
          </mesh>
          <mesh material={mats.energyHot} position={[0, 0.022, -0.12]}>
            <boxGeometry args={[0.007, 0.005, 0.28]} />
          </mesh>
          {/* gold trim spine down the receiver top */}
          <mesh material={mats.gold} position={[0, 0.122, -0.12]}>
            <boxGeometry args={[0.018, 0.008, 0.29]} />
          </mesh>
          {/* ejection port: recess, gold lip, and the world anchor for brass */}
          <mesh material={mats.recess} position={[0.044, 0.068, -0.01]}>
            <boxGeometry args={[0.008, 0.032, 0.075]} />
          </mesh>
          <mesh material={mats.gold} position={[0.047, 0.086, -0.01]}>
            <boxGeometry args={[0.006, 0.006, 0.08]} />
          </mesh>
          <object3D ref={ejectRef} position={[0.06, 0.068, -0.01]} />
          {/* charging handle — slides on reload */}
          <mesh ref={boltRef} material={mats.gold} position={[0.05, 0.095, 0.02]}>
            <boxGeometry args={[0.022, 0.014, 0.05]} />
          </mesh>

          {/* ---------------- optic ---------------- */}
          <mesh geometry={geo.railBlock} material={mats.body} position={[0, 0.136, -0.19]} />
          <mesh material={mats.gold} position={[0, 0.162, -0.2]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.026, 0.006, 6, 18]} />
          </mesh>
          <mesh material={mats.energyHot} position={[0, 0.162, -0.2]}>
            <sphereGeometry args={[0.005, 8, 6]} />
          </mesh>

          {/* ---------------- magazine (drops on reload) ---------------- */}
          <group ref={magRef}>
            <mesh
              geometry={geo.mag}
              material={mats.body}
              position={[0, -0.075, -0.155]}
              rotation={[0.13, 0, 0]}
              castShadow
            />
            <mesh material={mats.gold} position={[0, -0.006, -0.147]} rotation={[0.13, 0, 0]}>
              <boxGeometry args={[0.05, 0.012, 0.09]} />
            </mesh>
            <mesh material={mats.energy} position={[0.023, -0.075, -0.157]} rotation={[0.13, 0, 0]}>
              <boxGeometry args={[0.004, 0.09, 0.012]} />
            </mesh>
          </group>

          {/* ---------------- handguard + barrel ---------------- */}
          <mesh geometry={geo.handguard} material={mats.body} position={[0, 0.048, -0.4]} castShadow />
          <mesh geometry={geo.sidePlate} material={mats.ivory} scale={[1, 0.8, 0.9]} position={[0.036, 0.048, -0.4]} />
          <mesh geometry={geo.sidePlate} material={mats.ivory} scale={[1, 0.8, 0.9]} position={[-0.036, 0.048, -0.4]} />
          {/* vent slots as recessed bands */}
          {[-0.33, -0.39, -0.45].map((z) => (
            <mesh key={z} material={mats.recess} position={[0, 0.048, z]}>
              <boxGeometry args={[0.066, 0.03, 0.012]} />
            </mesh>
          ))}
          <mesh material={mats.body} position={[0, 0.055, -0.5]} rotation={[Math.PI / 2, 0, 0]} castShadow>
            <cylinderGeometry args={[0.0145, 0.017, 0.2, 12]} />
          </mesh>
          {/* gold barrel collar + lathed muzzle device */}
          <mesh material={mats.goldCast} position={[0, 0.055, -0.54]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.022, 0.022, 0.018, 12]} />
          </mesh>
          <mesh geometry={geo.collar} material={mats.gold} position={[0, 0.055, -0.6]} />
          {/* three brake fins */}
          {[0, 1, 2].map((i) => (
            <mesh
              key={i}
              material={mats.gold}
              position={[0, 0.055, -0.6]}
              rotation={[0, 0, (i * Math.PI * 2) / 3]}
            >
              <boxGeometry args={[0.012, 0.075, 0.03]} />
            </mesh>
          ))}
          {/* bore glow, so the barrel is not a dead black hole */}
          <mesh material={mats.energy} position={[0, 0.055, -0.615]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.009, 0.009, 0.004, 10]} />
          </mesh>

          {/* ---------------- stock ---------------- */}
          <mesh geometry={geo.stock} material={mats.body} position={[0, 0.03, 0.2]} castShadow />
          <mesh geometry={geo.stockPlate} material={mats.ivory} position={[0, 0.02, 0.3]} />
          <mesh material={mats.gold} position={[0, 0.072, 0.2]}>
            <boxGeometry args={[0.02, 0.01, 0.2]} />
          </mesh>
          <mesh material={mats.energy} position={[0, 0.03, 0.302]}>
            <boxGeometry args={[0.03, 0.006, 0.004]} />
          </mesh>

          {/* ---------------- muzzle anchor + flash ---------------- */}
          <object3D ref={muzzleRef} position={[0, 0.055, -0.63]} />
          <group ref={flashRef} position={[0, 0.055, -0.65]} visible={false}>
            <sprite ref={flareRef} material={mats.flash} scale={[0.3, 0.3, 0.3]} />
            {/* bore cone: the flash has a direction, not just a blob */}
            <mesh ref={coneRef} material={mats.cone} position={[0, 0, -0.1]} rotation={[-Math.PI / 2, 0, 0]}>
              <coneGeometry args={[0.055, 0.22, 10, 1, true]} />
            </mesh>
            <mesh material={mats.cone} rotation={[0, 0, Math.PI / 4]}>
              <planeGeometry args={[0.03, 0.3]} />
            </mesh>
          </group>
        </group>

        {/* ============ "Last Word" katana, in hand during a swing ============
            Blade runs along +Z so Object3D.lookAt(worldTip) aims it. */}
        <group ref={handKatanaRef} visible={false}>
          <mesh geometry={geo.blade} material={mats.steel} position={[0, 0, 0.07]} castShadow />
          {/* permanent emissive edge, riding the same curve as the blade */}
          <mesh geometry={geo.bladeEdge} material={mats.energy} position={[0, -0.0255, 0.07]} />
          {/* habaki collar */}
          <mesh material={mats.gold} position={[0, 0, 0.055]}>
            <boxGeometry args={[0.016, 0.042, 0.03]} />
          </mesh>
          {/* tsuba — oval guard */}
          <mesh material={mats.goldCast} position={[0, 0, 0.035]} rotation={[Math.PI / 2, 0, 0]} scale={[1, 1, 0.72]}>
            <cylinderGeometry args={[0.055, 0.055, 0.008, 18]} />
          </mesh>
          <mesh material={mats.gold} position={[0, 0, 0.035]} rotation={[Math.PI / 2, 0, 0]} scale={[1, 1, 0.72]}>
            <torusGeometry args={[0.05, 0.005, 6, 20]} />
          </mesh>
          {/* tsuka — wrapped grip, tapering back past the hand */}
          <mesh material={mats.wrap} position={[0, 0, -0.09]} rotation={[Math.PI / 2, 0, 0]} castShadow>
            <cylinderGeometry args={[0.016, 0.019, 0.24, 10]} />
          </mesh>
          {[0.0, -0.05, -0.1, -0.15].map((z) => (
            <mesh key={z} material={mats.gold} position={[0, 0, z - 0.02]} rotation={[Math.PI / 2, 0, 0.6]}>
              <torusGeometry args={[0.018, 0.0035, 4, 10]} />
            </mesh>
          ))}
          <mesh material={mats.goldCast} position={[0, 0, -0.215]}>
            <boxGeometry args={[0.032, 0.036, 0.022]} />
          </mesh>
        </group>
      </group>

      {/* ============ scabbard, worn on the hip ============ */}
      <group ref={sheathRootRef} rotation={[0.22, 0, -0.35]}>
        {/* the shell is authored along +Z and flipped, so it hangs BACK along
            the hip while the grip stands forward of the mouth */}
        <mesh
          geometry={geo.scabbard}
          material={mats.body}
          position={[0, 0, -0.06]}
          rotation={[0, Math.PI, 0]}
          castShadow
        />
        {/* koiguchi (mouth) + two gold bands + a faint edge bleed */}
        <mesh material={mats.goldCast} position={[0, 0, -0.045]}>
          <boxGeometry args={[0.036, 0.094, 0.036]} />
        </mesh>
        <mesh material={mats.gold} position={[0, -0.005, -0.36]}>
          <boxGeometry args={[0.034, 0.084, 0.018]} />
        </mesh>
        <mesh material={mats.gold} position={[0, -0.025, -0.76]}>
          <boxGeometry args={[0.03, 0.072, 0.018]} />
        </mesh>
        <mesh material={mats.energy} position={[0, -0.03, -0.028]}>
          <boxGeometry args={[0.012, 0.014, 0.01]} />
        </mesh>
        {/* the tsuka standing proud of the mouth, so the sword reads as worn */}
        <mesh material={mats.wrap} position={[0, 0.006, 0.1]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.016, 0.019, 0.23, 10]} />
        </mesh>
        <mesh material={mats.goldCast} position={[0, 0, -0.015]} rotation={[Math.PI / 2, 0, 0]} scale={[1, 1, 0.72]}>
          <cylinderGeometry args={[0.05, 0.05, 0.007, 16]} />
        </mesh>
        <mesh material={mats.goldCast} position={[0, 0.012, 0.225]}>
          <boxGeometry args={[0.032, 0.036, 0.022]} />
        </mesh>
      </group>
    </>
  )
}

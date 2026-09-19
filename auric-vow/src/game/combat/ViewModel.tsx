/* eslint-disable react-hooks/immutability -- imperative three.js material mutation inside useFrame is idiomatic R3F */
/**
 * AURIC VOW — combat/ViewModel.tsx
 * (design.md §1.3 — fully procedural):
 *   - "Vow" rifle: obsidian body, gold trim, emissive aureate energy strip,
 *     procedural recoil kick (muzzle world-offset 0.02 m, spring recovery
 *     10/s), alternating 4-point muzzle-flash star quads (combat.md §1.1).
 *   - "Last Word" katana: sheathed at the hip when idle (faint emissive
 *     edge, §2.1); during a combo swing it appears in-hand and tracks the
 *     world-space blade-tip arc from Weapons.bladeTipWorld.
 *
 * All children live in CAMERA space: the root group copies the camera's
 * world transform each frame. MUZZLE_LOCAL (Weapons.tsx) is the shared
 * camera-space muzzle position used for tracer/flash spawn.
 */
import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { COLORS } from '@/game/config'
import { bladeTipWorld, MUZZLE_LOCAL, MuzzleWorld } from './Weapons'
import { PlayerSockets } from '@/game/player/PlayerRig'
import { CombatState } from './state'

const _tip = new THREE.Vector3()
const _socketPos = new THREE.Vector3()
const _aimDir = new THREE.Vector3()
const _lookTarget = new THREE.Vector3()
const _muzzleWorld = new THREE.Vector3()

/** aim delta: rifle slides from hip offset toward screen center on RMB */
const AIM_DELTA = new THREE.Vector3(-0.14, 0.05, -0.05)

export function WeaponViewModel() {
  const groupRef = useRef<THREE.Group>(null)
  const rifleRef = useRef<THREE.Group>(null)
  const flashARef = useRef<THREE.Mesh>(null)
  const flashBRef = useRef<THREE.Mesh>(null)
  const handKatanaRef = useRef<THREE.Group>(null)
  const sheathKatanaRef = useRef<THREE.Group>(null)
  const aimT = useRef(0)

  const flashMats = useMemo(
    () =>
      [0, 1].map(
        () =>
          new THREE.MeshBasicMaterial({
            color: COLORS.solarWhite,
            transparent: true,
            opacity: 0,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide,
            toneMapped: false,
          }),
      ),
    [],
  )

  useFrame((state, rawDt) => {
    const cs = CombatState
    const g = groupRef.current
    if (!g) return

    // The camera is third-person, so the weapons live in the character's hands,
    // not at the lens. Anchor the rig at the right-hand socket and aim it down
    // the camera's forward axis, which is also what the hit raycast uses — so
    // what the player sees and what the shot does agree. Falls back to the old
    // camera-space placement only if the rig has not mounted yet.
    const socket = PlayerSockets.rightHand
    if (socket) {
      socket.getWorldPosition(_socketPos)
      state.camera.getWorldDirection(_aimDir)
      _lookTarget.copy(_socketPos).add(_aimDir)
      g.position.copy(_socketPos)
      g.up.set(0, 1, 0)
      g.lookAt(_lookTarget)
      // the weapon meshes are authored in camera space (grip near the origin,
      // barrel toward -Z); lookAt points +Z at the target, so flip to match.
      g.rotateY(Math.PI)
      g.position.addScaledVector(_aimDir, 0.12)
    } else {
      g.position.copy(state.camera.position)
      g.quaternion.copy(state.camera.quaternion)
    }

    // aim slide (CameraRig owns the FOV 70→55 kick)
    aimT.current += ((cs.aiming ? 1 : 0) - aimT.current) * Math.min(1, rawDt / 0.12)

    // ---- rifle: aim slide + recoil kick (spring recovery handled on state) ----
    const rifle = rifleRef.current
    if (rifle) {
      rifle.position.set(
        AIM_DELTA.x * aimT.current,
        AIM_DELTA.y * aimT.current,
        AIM_DELTA.z * aimT.current + 0.02 * cs.recoil,
      )
      rifle.rotation.x = 0.06 * cs.recoil
    }

    // publish the visual muzzle tip so tracers and flashes leave the barrel
    if (flashARef.current) {
      flashARef.current.getWorldPosition(_muzzleWorld)
      MuzzleWorld.position.copy(_muzzleWorld)
      MuzzleWorld.valid = true
    }

    // ---- muzzle flash star: 0.05 s life, two alternating orientations ----
    const flashAge = cs.clock - cs.muzzleFlashAt
    const flashOn = flashAge >= 0 && flashAge < 0.05
    const flashA = flashARef.current
    const flashB = flashBRef.current
    if (flashA && flashB) {
      flashA.visible = flashOn && cs.muzzleFlip
      flashB.visible = flashOn && !cs.muzzleFlip
      if (flashOn) {
        const o = 1 - flashAge / 0.05
        flashMats[0].opacity = o
        flashMats[1].opacity = o * 0.75
      }
    }

    // ---- scabbard: rides the hip socket in world space ----
    const hipSock = PlayerSockets.hip
    if (hipSock && sheathKatanaRef.current) {
      hipSock.getWorldPosition(_socketPos)
      sheathKatanaRef.current.parent?.worldToLocal(_socketPos)
      sheathKatanaRef.current.position.copy(_socketPos)
    }

    // ---- katana: in-hand tracking the world arc during a swing ----
    const hand = handKatanaRef.current
    const sheath = sheathKatanaRef.current
    const swing = cs.swing
    if (hand && sheath) {
      if (swing) {
        hand.visible = true
        sheath.visible = false
        bladeTipWorld(state.camera, swing, _tip)
        hand.lookAt(_tip) // blade extends along +Z → tip
      } else {
        hand.visible = false
        sheath.visible = true
      }
    }
  })

  return (
    <group ref={groupRef}>
      {/* ================= "Vow" rifle ================= */}
      <group ref={rifleRef}>
        {/* receiver — deep relic obsidian */}
        <mesh position={[0.24, -0.16, -0.42]}>
          <boxGeometry args={[0.07, 0.1, 0.5]} />
          <meshStandardMaterial color={COLORS.deepRelic} metalness={0.6} roughness={0.15} />
        </mesh>
        {/* barrel */}
        <mesh position={[0.24, -0.145, -0.72]} rotation-x={Math.PI / 2}>
          <cylinderGeometry args={[0.018, 0.022, 0.28, 8]} />
          <meshStandardMaterial color={COLORS.deepRelic} metalness={0.7} roughness={0.2} />
        </mesh>
        {/* gold trim spine */}
        <mesh position={[0.24, -0.105, -0.42]}>
          <boxGeometry args={[0.02, 0.015, 0.46]} />
          <meshStandardMaterial color={COLORS.regalGold} metalness={0.9} roughness={0.25} />
        </mesh>
        {/* emissive aureate energy strip (blooms) */}
        <mesh position={[0.24, -0.16, -0.42]}>
          <boxGeometry args={[0.075, 0.012, 0.34]} />
          <meshBasicMaterial color={COLORS.aureate} toneMapped={false} />
        </mesh>
        {/* stock + grip */}
        <mesh position={[0.24, -0.19, -0.16]} rotation-x={0.35}>
          <boxGeometry args={[0.055, 0.14, 0.09]} />
          <meshStandardMaterial color={COLORS.deepRelic} metalness={0.6} roughness={0.2} />
        </mesh>
        {/* muzzle brake ring */}
        <mesh position={[0.24, -0.145, -0.85]} rotation-x={Math.PI / 2}>
          <torusGeometry args={[0.028, 0.008, 6, 12]} />
          <meshStandardMaterial color={COLORS.regalGold} metalness={0.9} roughness={0.25} />
        </mesh>

        {/* muzzle flash — 4-point star: two crossed quads × 2 orientations,
            scale 0.35 m (§1.1), gold core/edge */}
        <mesh ref={flashARef} visible={false} material={flashMats[0]} position={MUZZLE_LOCAL}>
          <planeGeometry args={[0.35, 0.35]} />
        </mesh>
        <mesh
          ref={flashBRef}
          visible={false}
          material={flashMats[1]}
          position={MUZZLE_LOCAL}
          rotation-z={Math.PI / 4}
        >
          <planeGeometry args={[0.26, 0.26]} />
        </mesh>
      </group>

      {/* ================= "Last Word" katana (in hand, swinging) =================
          Blade extends along +Z so Object3D.lookAt(worldTip) points it correctly. */}
      <group ref={handKatanaRef} visible={false} position={[0.18, -0.12, -0.35]}>
        {/* blade — steel core + permanent emissive aureate edge (§2.1) */}
        <mesh position={[0, 0, 0.62]}>
          <boxGeometry args={[0.006, 0.05, 1.05]} />
          <meshStandardMaterial color="#C8CCD6" metalness={0.85} roughness={0.2} />
        </mesh>
        <mesh position={[0, -0.028, 0.62]}>
          <boxGeometry args={[0.004, 0.012, 1.05]} />
          <meshBasicMaterial color={COLORS.aureate} toneMapped={false} />
        </mesh>
        {/* guard + grip */}
        <mesh position={[0, 0, 0.1]} rotation-x={Math.PI / 2}>
          <torusGeometry args={[0.055, 0.012, 6, 16]} />
          <meshStandardMaterial color={COLORS.regalGold} metalness={0.9} roughness={0.25} />
        </mesh>
        <mesh position={[0, 0, -0.03]} rotation-x={Math.PI / 2}>
          <cylinderGeometry args={[0.016, 0.018, 0.24, 8]} />
          <meshStandardMaterial color={COLORS.deepRelic} metalness={0.6} roughness={0.25} />
        </mesh>
      </group>

      {/* ================= katana sheathed at the hip (idle) ================= */}
      <group ref={sheathKatanaRef} position={[-0.3, -0.34, 0.08]} rotation={[0.35, 0.25, 1.15]}>
        {/* scabbard */}
        <mesh position={[0, 0, -0.5]}>
          <boxGeometry args={[0.03, 0.07, 1.05]} />
          <meshStandardMaterial color={COLORS.deepRelic} metalness={0.6} roughness={0.2} />
        </mesh>
        {/* faint emissive edge bleeding from the scabbard mouth */}
        <mesh position={[0, -0.04, -0.1]}>
          <boxGeometry args={[0.012, 0.01, 0.2]} />
          <meshBasicMaterial color={COLORS.aureate} toneMapped={false} />
        </mesh>
        {/* guard + grip */}
        <mesh position={[0, 0, 0.03]} rotation-x={Math.PI / 2}>
          <torusGeometry args={[0.055, 0.012, 6, 16]} />
          <meshStandardMaterial color={COLORS.regalGold} metalness={0.9} roughness={0.25} />
        </mesh>
        <mesh position={[0, 0, 0.16]} rotation-x={Math.PI / 2}>
          <cylinderGeometry args={[0.016, 0.018, 0.24, 8]} />
          <meshStandardMaterial color={COLORS.deepRelic} metalness={0.6} roughness={0.25} />
        </mesh>
      </group>
    </group>
  )
}

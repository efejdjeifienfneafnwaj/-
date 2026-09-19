/**
 * AURIC VOW — player/PlayerRef.ts
 * Live-mutated player singleton. PlayerController writes every frame;
 * enemies / combat / VFX / HUD read it directly (no react state, no re-renders).
 * See design.md §1.3 and movement.md §9.
 */
import * as THREE from 'three'

export type PlayerState =
  | 'run'
  | 'sprint'
  | 'slide'
  | 'wallrunL'
  | 'wallrunR'
  | 'air'
  | 'glide'
  | 'lunge'
  | 'dead'

export interface PlayerRefShape {
  /** feet position (capsule bottom-center), world space */
  position: THREE.Vector3
  /** current velocity, m/s */
  velocity: THREE.Vector3
  isGrounded: boolean
  state: PlayerState
  /** outward normal of the wall being run on (zero when not wall-running) */
  wallNormal: THREE.Vector3
  /** capsule radius (m) */
  radius: number
  /** capsule height (m) — squashes to 1.0 during slide, tracked live */
  height: number
}

/** Global player singleton — mutated live by PlayerController. */
export const PlayerRef: PlayerRefShape = {
  position: new THREE.Vector3(0, 2, 0),
  velocity: new THREE.Vector3(),
  isGrounded: false,
  state: 'air',
  wallNormal: new THREE.Vector3(),
  radius: 0.45,
  height: 1.8,
}

/**
 * Secondary animation/feel data channel (also mutated by the controller).
 * Read by PlayerRig, CameraRig and any VFX hooks. Kept separate so the
 * PlayerRef contract above stays exactly as specified.
 */
export interface PlayerAnimShape {
  /** horizontal speed m/s (cached) */
  speed: number
  /** world-space horizontal acceleration this frame (for spine lean) */
  accel: THREE.Vector3
  /** yaw the body is currently facing (rad) */
  moveYaw: number
  /** locomotion gait phase (rad), advanced by speed / strideLength */
  gaitPhase: number
  /** 0..1 crouch/slide squash amount (eased) */
  crouch: number
  /** fall speed (m/s, positive) at the moment of landing; decays to 0 */
  landImpact: number
  /** landing recovery timer (s) — >0 while recovering from a hard landing */
  landTimer: number
  /** one-shot FOV pulse pool (deg) — consumed & decayed by CameraRig */
  fovPulse: number
  /** lunge progress 0..1 while state==='lunge' (drives the tuck spin) */
  lungeT: number
  /** afterimage streak timer (s) — >0 while lunge ghosts should render */
  afterimageT: number
  /** wall-jump roll snap timer (s) — camera roll eases fast while >0 */
  rollSnapT: number
  /** wall side: -1 left, +1 right, 0 none */
  wallSide: number
  /** recent world transform history (position + facing yaw) for afterimages */
  history: { pos: THREE.Vector3; yaw: number; roll: number }[]
  /** ring-buffer write cursor for history (newest slot = historyIdx-1) */
  historyIdx: number
}

export const PlayerAnim: PlayerAnimShape = {
  speed: 0,
  accel: new THREE.Vector3(),
  moveYaw: 0,
  gaitPhase: 0,
  crouch: 0,
  landImpact: 0,
  landTimer: 0,
  fovPulse: 0,
  lungeT: 0,
  afterimageT: 0,
  rollSnapT: 0,
  wallSide: 0,
  history: [],
  historyIdx: 0,
}

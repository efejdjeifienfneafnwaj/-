/**
 * AURIC VOW — player/movementConfig.ts
 * Movement/parkour tuning constants from movement.md §1–§10.
 * (config.ts holds global game stats; these movement-specific values live
 * here per task scope — do NOT edit config.ts.)
 */
import { PLAYER, AIM } from '../config'

const DEG = Math.PI / 180

export const MOVE = {
  // §1 locomotion core
  walkSpeed: PLAYER.baseMoveSpeed, // 7
  sprintSpeed: PLAYER.sprintSpeed, // 11
  aimMoveMult: AIM.aimMoveSpeedMult, // 0.6
  groundAccel: 60,
  groundDecel: 40,
  airAccel: 18,
  airSpeedCapBonus: 2, // air accel capped at current max horiz speed +2
  airControl: 0.65,
  gravity: 24,
  terminalFall: 30,
  turnRate: 12, // velocity lerp 1-exp(-12*dt)
  groundSnap: 0.15, // grounded if hit within halfHeight + this
  coyoteTime: 0.12,
  jumpBuffer: 0.15,
  walkableSlopeDeg: 50,

  // capsule (task spec: radius 0.45, height 1.8)
  radius: 0.45,
  standHeight: 1.8,
  crouchHeight: 1.0,

  // §2 jump
  jumpVel: 9.5,
  doubleJumpVel: 8.5,
  jumpCutMult: 0.5,

  // §3 slide
  slide: {
    triggerMinSpeed: 8,
    boostMult: 1.25,
    boostMin: 10,
    boostMax: 14,
    friction: 6,
    slopeAccelFactor: 0.5, // g·sin(θ)·0.5 on down-slopes
    minSpeed: 3,
    maxDuration: 1.6,
    steerRate: 20 * DEG,
    hopSpeedMult: 1.05,
    hopSpeedBonus: 0.5,
    cancelKeepSpeed: 0.7, // fire/slash cancel
    camDrop: 0.5,
    camDropRate: 35, // ~0.08s ease
  },

  // §4 wall-run
  wallrun: {
    rayDist: 0.8,
    maxNormalY: 0.25,
    minSpeed: 6,
    tangentDot: 0.5,
    duration: 1.8,
    entryMinSpeed: 8,
    accel: 1,
    maxSpeed: 12,
    gravityMult: 0.15, // 3.6 m/s² effective
    endMinSpeed: 4,
    jumpNormal: 7.5,
    jumpUp: 8.5,
    jumpTangent: 4,
    restickCooldown: 0.3,
    restickDot: 0.9, // "same wall" test
    switchWindow: 0.2,
    stickAccel: 4, // gentle pull toward the wall (auto-stick)
    camRoll: 14 * DEG,
    rollLerp: 8,
    torsoTilt: 20 * DEG,
  },

  // §5 glide
  glide: {
    fallClamp: 3.5,
    fallLerp: 6,
    forwardPush: 4,
    steerMult: 1.2,
    divePitch: 40 * DEG, // pitch camera down beyond this to dive
    diveFall: 12,
    diveBoost: 6,
    camPullback: 0.8,
    bobHz: 0.6,
    bobAmp: 0.05,
  },

  // §6 bullet lunge
  lunge: {
    speed: 18,
    maxPitch: 30 * DEG, // clamp look dir to ±30° from horizontal
    duration: 0.35,
    gravityMult: 0.25,
    cooldown: 0.8,
    slideHopWindow: 0.25,
    fovKick: 12,
  },

  // §8 camera rig
  cam: {
    offsetNormal: { right: 0.55, up: 0.45, back: 3.2 },
    offsetAim: { right: 0.7, up: 0.35, back: 1.6 },
    followRate: 14, // position lerp 1-exp(-14*dt)
    boomMargin: 0.25,
    boomMin: 0.5,
    lookSensitivity: 0.0022, // rad/px
    pitchLimit: 1.35, // ~77°
    baseFov: AIM.baseFov, // 70
    aimFov: AIM.aimFov, // 55
    aimLerpRate: 10,
    fovKickDecay: 6, // exp(-6*dt)
    fovKicks: { sprint: 5, slide: 8, wallrun: 6, glide: 5, lunge: 12, doubleJump: 4, wallJump: 6 },
    slideRoll: -3 * DEG,
    strafeLean: 2 * DEG,
    traumaDecay: 1.2,
    shakeAmp: 0.05, // rad at trauma 1 (amplitude = trauma² · this)
    headHeight: 1.55,
    landingDipMax: 0.18, // camera dip on hard landing
  },

  // landing recovery
  landing: {
    hardFallSpeed: 12, // |vy| above this triggers recovery
    recoveryTime: 0.15,
    recoveryAccelMult: 0.4,
  },

  killZ: -40,
} as const

/** §10 — procedural animation tuning (PlayerRig) */
export const ANIM = {
  strideLength: 2.2, // gait phase += speed/stride·dt
  legSwing: 0.45, // rad
  armSwingMult: 0.6,
  bobAmp: 0.04,
  leanPitchPerAccel: 0.02, // max ±0.25 rad (~12° spec says 12° ≈ 0.21)
  leanPitchMax: 0.21,
  leanRollPerStrafeAccel: 0.015,
  cameraRollInfluence: 0.3,
  springStiffness: 120,
  springDamping: 18,
  aimYawMax: 35 * DEG,
  jumpTuckHip: 35 * DEG,
  slideTorsoLeanBack: 25 * DEG,
  glideTorsoPitch: 70 * DEG,
  wallrunLegAmp: 0.5, // m-scale exaggeration → rad swing below
  scarf: {
    segments: 12,
    segmentLength: 0.09,
    gravity: 2,
    drag: 0.85, // velocity-inherit drag
    constraintIters: 2,
    width: 0.07,
    tipWidth: 0.02,
  },
} as const

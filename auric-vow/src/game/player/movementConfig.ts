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
    offsetNormal: { right: 0.62, up: 0.42, back: 3.45 },
    offsetAim: { right: 0.76, up: 0.34, back: 1.85 },
    followRate: 14, // position lerp 1-exp(-14*dt)
    boomMargin: 0.28,
    /** never closer than this to the head — above the 0.54 m shoulder span */
    boomMin: 1.25,
    /** boom is swept as a sphere of this radius so thin geometry can't cut the
        near plane (5 probe rays: axis + 4 rim offsets) */
    boomRadius: 0.26,
    /** rig dither/opacity fade window: full at fadeStart, floor at fadeEnd */
    fadeStart: 1.7,
    fadeEnd: 0.9,
    fadeMin: 0.1,
    /** ultimate (auric requiem) camera state: long boom + drop so the frame
        silhouettes against the nova */
    ult: { back: 6.0, drop: 1.0, right: 0.15, rate: 3.2, fov: 7 },
    /** wall-run: bias the shoulder offset to the free side and push off the wall */
    wallrunSideBias: 1.35,
    wallrunNormalPush: 0.45,
    /** positional shake (m) at trauma 1, on top of the rotational component */
    shakePosAmp: 0.075,
    /** directional positional kick decay (1/s) */
    kickDecay: 9,
    /** FOV punch on a hard landing (deg) */
    landFovPunch: 5,
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
  /** stride (m) per FULL gait cycle at walk speed — phase advances by
      2π·speed/stride·dt so one cycle really is one stride (was missing the 2π) */
  strideLength: 1.85,
  /** stride opens up toward this at full sprint */
  strideLengthSprint: 2.9,
  legSwing: 0.52, // rad
  armSwingMult: 0.62,
  bobAmp: 0.045,
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
    segmentLength: 0.095,
    gravity: 6, // was 2 — the scarf hung like a wet rope
    drag: 0.7, // was 0.85 (velocity-inherit drag)
    constraintIters: 2,
    width: 0.14, // was 0.07 — reads at silhouette distance
    tipWidth: 0.04,
    /** last N segments carry the emissive material group */
    emissiveSegments: 4,
    /** ribbon[1] is deliberately NOT a mirror of ribbon[0] */
    asymSegLen: 1.18,
    asymGravity: 1.25,
    asymDrag: 0.78,
    /** per-segment twist (rad) per m/s of local segment speed */
    twistPerSpeed: 0.05,
    twistMax: 0.9,
  },

  /** idle: asymmetric weight shift + slow breath */
  idle: {
    breathHz: 0.4,
    breathAmp: 0.014,
    swayHz: 0.17,
    weightRoll: 0.045, // torso roll onto the loaded leg
    blendSpeed: 1.3, // idle authority fades out by this horizontal speed
  },

  /** air pose blend: ascend ↔ fall mixed by v.y over ±this */
  airBlendVy: 5.5,

  /** landing absorb (driven from impact speed, recovered on the springs) */
  landing: {
    absorbTime: 0.24,
    minImpact: 4.5,
    fullImpact: 22,
    bodyDrop: 0.35,
    kneeBend: 1.3,
    torsoPitch: 0.3,
  },

  /** additive aim/look layer — head leads the torso by ~80 ms */
  look: {
    headYawMax: 0.6,
    headPitchMax: 0.5,
    headStiffness: 200,
    torsoStiffness: 120,
    chestTwistMax: 0.25,
  },

  /** lunge afterimages: pooled clones of the real rig subtree */
  ghosts: {
    count: 3,
    frameGap: 3, // history samples between ghosts (~0.05 s @60fps)
    maxOpacity: 0.34, // clamped so the additive stack can't clip to white
  },
} as const

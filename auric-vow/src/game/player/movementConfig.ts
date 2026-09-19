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
    /** never closer than this to the head — above the 0.54 m shoulder span.
     *  [player-frame R2] 1.25 → 1.8: at 1.25 m the frame filled half the plate
     *  and the proximity fade turned the armour into an x-ray. */
    boomMin: 1.8,
    /** [player-frame R2] ABSOLUTE floor. `boomMin` above is a soft target: when
     *  geometry does not allow it, the boom lifts over the head and re-sweeps
     *  rather than forcing its way through the wall (which is how the r2
     *  wall-run capture ended up inside the slab). */
    boomHardMin: 0.55,
    /** boom is swept as a sphere of this radius so thin geometry can't cut the
        near plane (5 probe rays: axis + 4 rim offsets) */
    boomRadius: 0.32,
    /** rig dither/opacity fade window: full at fadeStart, floor at fadeEnd */
    /** [player-frame R2] window pulled inside the new boomMin so the fade is a
     *  last resort; fadeMin 0.1 → 0 because a 10%-opacity frame reads as an
     *  x-ray of its own internals, which is worse than no frame at all. */
    fadeStart: 1.55,
    fadeEnd: 0.85,
    fadeMin: 0.0,
    /** ultimate (auric requiem) camera state: long boom + drop so the frame
        silhouettes against the nova */
    ult: { back: 6.0, drop: 1.0, right: 0.15, rate: 3.2, fov: 7 },
    /** wall-run: bias the shoulder offset to the free side and push off the wall */
    wallrunSideBias: 1.45,
    wallrunNormalPush: 1.6,
    /**
     * [player-frame R2] dedicated wall-run camera state. The r2 capture had the
     * camera buried in the slab: the boom is now pushed hard off the wall, the
     * minimum boom is raised above the shoulder span, the eye lifts, and the
     * view yaws INTO the run direction so the frame is read three-quarter
     * against the wall instead of pressed flat into it.
     */
    wallrun: {
      /** boom floor while wall-running (overrides cam.boomMin) */
      boomMin: 1.95,
      /** extra boom length along the run */
      back: 0.55,
      /** eye lift (m) */
      up: 0.3,
      /** view yaw into the run direction (rad) */
      yaw: 18 * DEG,
      /** blend rate for the whole state */
      rate: 6.5,
    },
    /**
     * [player-frame R2] melee swing camera: dolly out + pitch up so the swing
     * plane is read edge-on from outside instead of down the blade.
     */
    swing: { back: 0.8, pitch: 6 * DEG, rate: 13, decay: 6 },
    /** [player-frame R2] FOV punch while the gilt dash is active (deg) */
    dashFov: 9,
    /** [player-frame R2] landing: positional dip and the weight-transfer hold */
    landing: { dipRate: 22, recoverRate: 9, kickMax: 0.26 },
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
  /**
   * [player-frame R2] syandana solver. The r2 capture showed the scarf as two
   * metre-wide flat planks sweeping the whole frame: the verlet inertia term
   * was not dt-normalised and 2 constraint iterations could not propagate the
   * anchor's 0.18 m/frame sprint motion down a 12-link chain, so the ribbon
   * stretched to many times its authored 1.14 m. It now integrates on a FIXED
   * 1/60 substep with a hard per-segment stretch clamp.
   */
  scarf: {
    segments: 28,
    segmentLength: 0.045, // 28 × 0.045 = 1.26 m authored length
    gravity: 7.5,
    /** verlet inertia retention PER FIXED STEP (not per frame) */
    drag: 0.945,
    constraintIters: 7,
    /** fixed integration step (s) — the whole point of the r2 fix */
    fixedStep: 1 / 60,
    /** never run more than this many substeps in one frame (spiral guard) */
    maxSubsteps: 3,
    /** hard clamp: no link may exceed this multiple of its rest length.
     *  Measured: at an 11 m/s sprint the chain sits on this clamp along its
     *  whole length, so it is what bounds the on-screen size of the scarf. */
    maxStretch: 1.2,
    /** body-collision radius as a fraction of the PHYSICS capsule radius. The
     *  capsule is 0.45 m; colliding the scarf against that pushed every point
     *  0.45 m off the spine while the root stayed pinned at the nape, which
     *  stretched the first links into the planks the r2 capture shows. */
    bodyRadiusMult: 0.5,
    /** segments this close to the nape are exempt from body collision — they
     *  live inside the torso volume by construction */
    collideSkip: 5,
    /** anchor teleport (m/frame) above which the whole chain is re-seeded */
    reseedDist: 2.0,
    width: 0.13,
    tipWidth: 0.03,
    /** width taper exponent along the chain: pow(1 - i/SEGS, taperPow) */
    taperPow: 1.6,
    /** camera-facing half-width floor when a segment is viewed END-ON. The
     *  billboard width is scaled by |sin(tangent, view)|, so a ribbon pointing
     *  at the camera collapses to a line instead of widening into a plank. */
    endOnFloor: 0.12,
    /** vertex alpha at the two cloth edges (centre stays 1) — feathers the
     *  silhouette without making the cloth read as gauze */
    edgeAlpha: 0.35,
    /** near-plane fade window (m from camera) */
    nearFadeStart: 1.1,
    nearFadeEnd: 0.42,
    /** last N segments carry the emissive material group */
    emissiveSegments: 9,
    /** ribbon[1] is deliberately NOT a mirror of ribbon[0] */
    asymSegLen: 1.16,
    asymGravity: 1.22,
    asymDrag: 0.955,
    /** per-segment twist (rad) per m/s of local segment speed */
    twistPerSpeed: 0.035,
    twistMax: 0.7,
    /** turbulence: amplitude (m/s²) and rate (Hz) of the cross-wind term */
    windAmp: 2.6,
    windHz: 0.37,
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

  /**
   * [player-frame R2] three AUTHORED air poses sequenced on time-since-ground
   * with minimum holds and smoothstep crossfades, replacing the linear ±5.5
   * m/s blend (which sat on one averaged pose for most of a jump).
   *   launch — tuck: knees to chest, arms swept down and back
   *   apex   — spread: limbs opened, chest up, the readable silhouette beat
   *   fall   — trail: legs trail, one arm leads, body angled off camera axis
   */
  air: {
    /** minimum time each pose is held before the next can take over (s) */
    minHold: 0.12,
    /** crossfade time between poses (s) */
    crossfade: 0.13,
    /** |v.y| under this counts as apex */
    apexVy: 2.6,
    /** yaw/roll off the camera axis so the air pose is never a flat plank */
    yawOff: 25 * (Math.PI / 180),
    rollOff: 15 * (Math.PI / 180),
  },

  /** landing absorb (driven from impact speed, recovered on the springs) */
  landing: {
    absorbTime: 0.24,
    minImpact: 4.5,
    fullImpact: 22,
    bodyDrop: 0.35,
    kneeBend: 1.3,
    torsoPitch: 0.3,
    /** [player-frame R2] weight pose: hips shift over the lead leg, the
     *  trailing arm counterweights and one hand drops toward the deck */
    hipShift: 0.09,
    armSpread: 0.55,
    handDrop: 0.85,
    /** yaw the shoulders open on a hard landing (rad at full impact) */
    shoulderYaw: 0.22,
  },

  /**
   * [player-frame R2] slide: the r2 capture read as a standing figure. The rig
   * ROOT drops (not just the pelvis), the body rotates so the lead shin is
   * floor-parallel, and the trailing hand is planted on the deck.
   */
  slide: {
    rootDrop: 0.42,
    bodyPitch: 55 * (Math.PI / 180),
    leadHip: -1.35,
    leadKnee: 0.12,
    trailHip: 0.62,
    trailKnee: 1.45,
    handHip: 1.35,
    handSpread: 0.62,
    handElbow: 0.28,
    torsoLeanBack: 0.34,
  },

  /**
   * [player-frame R2] the frame's emissive is authored in THREE layers so it
   * survives the new bloom knee (1.0): a core ABOVE white (nothing below 1.0
   * blooms at all any more), a saturated mid band, and a wide soft falloff.
   * One route only — nape → spine → sacrum, forking to the shoulder cowls,
   * outer forearms and outer shins.
   */
  energy: {
    /** hot core, multiplied ABOVE white so it crosses the 1.0 bloom knee */
    coreBoost: 2.85,
    /** saturated mid band */
    midBoost: 1.28,
    /** wide additive falloff shell */
    falloffBoost: 0.42,
    falloffOpacity: 0.36,
    /** breathing pulse (Hz, ± fraction) on the whole route */
    pulseHz: 0.33,
    pulseAmp: 0.14,
    /** multiplier while the ultimate is charging/afterglowing */
    ultBoost: 1.75,
    /** multiplier while the gilt dash is active */
    dashBoost: 1.35,
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

/**
 * [player-frame R2] the single exported colour vocabulary for the frame's
 * emissive route. PlayerRig builds its core / mid / falloff materials from
 * these, so the whole character glows as one system and the ultimate/dash
 * states can drive it from one place.
 */
export const PLAYER_ENERGY = {
  /** hot core (authored above white by ANIM.energy.coreBoost) */
  core: '#FFF3D6',
  /** saturated mid band */
  mid: '#FFB835',
  /** wide falloff halo */
  halo: '#FF9A2E',
  /** ultimate override — the route shifts white-hot while A4 is up */
  ult: '#FFE9B8',
} as const

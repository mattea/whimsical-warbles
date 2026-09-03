/**
 * `DuckLink` backed by baked motion.
 *
 * Joint motion is replayed from clips recorded off the real policies, and the
 * world position is integrated from the velocity those recordings *achieved* --
 * not from the velocity that was asked for. The two differ a lot: the shipped
 * walking policy holds its stance below about vx 0.25 and delivers roughly 40%
 * of the command above it. Driving the root from the command is what makes a
 * robot skate across the floor with its legs out of sync.
 *
 * What this cannot do, by construction: fall over, be pushed, or kick a ball
 * that reacts. There is no physics here, only a recording. `health` reports
 * `'playback'` so the UI can say so rather than imply otherwise.
 */

import {
  blendBob,
  blendGaits,
  blendVelocity,
  pickGaits,
  sampleClip,
  sampleOnce,
  samplePath,
  sampleQuat,
  sampleQuatOnce,
  type ClipSet,
} from './clips';
import { quatMul } from './fk';
import {
  CONTROL_DT,
  type BodyPose,
  type DuckLink,
  type DuckState,
  type HeadPose,
  type Skill,
  type Twist,
} from './link';
import { JOINT_COUNT, type DuckTree, type Quat, type Vec3 } from './tree';

/** Joint slots the head command owns: neck_pitch, head_pitch, head_yaw, head_roll. */
const HEAD_SLOTS = [5, 6, 7, 8] as const;

/** How fast a released command decays, so stopping is not a jolt. */
const COMMAND_SMOOTHING = 12;

/** Below this the pugglenaut is standing, not stepping. */
const MOVING_EPSILON = 1e-3;

/** Seconds spent easing out of a finished skill back into the live pose. */
const SKILL_BLEND_OUT = 0.3;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function createClipLink(tree: DuckTree, clips: ClipSet): DuckLink {
  const listeners = new Set<(s: DuckState) => void>();

  // What was asked for, and the smoothed value actually driven.
  let wanted: Twist = { vx: 0, vy: 0, vyaw: 0 };
  let twist: Twist = { vx: 0, vy: 0, vyaw: 0 };
  let head: HeadPose | null = null;
  let body: BodyPose = { z: 0, roll: 0, pitch: 0 };
  let mouthOpen = 0;

  let phase = 0;
  let yaw = 0;
  let lastYaw = 0;
  const pos: Vec3 = [0, 0, tree.trunkHeight];

  let skill: Skill | null = null;
  let skillElapsed = 0;
  let skillStart: Vec3 = [0, 0, 0];
  let skillYaw = 0;
  /** Requested while seated: runs once the stand-up finishes. */
  let pending: Skill | null = null;

  /**
   * True from when `sit` finishes until `stand` finishes. A seated pugglenaut
   * holds the seat rather than springing back upright: on the real robot the
   * sit is a posture the sitstand policy maintains, not a one-shot animation.
   */
  let seated = false;

  /** Weight of the pose a finished skill left behind, easing 1 -> 0. */
  let blendOut = 0;
  const holdJoints = new Float32Array(JOINT_COUNT);
  let holdTilt: Quat = [1, 0, 0, 0];
  let holdZ = tree.trunkHeight;

  const joints = new Float32Array(JOINT_COUNT);
  const gyro: Vec3 = [0, 0, 0];
  const gravity: Vec3 = [0, 0, -1];
  const velocity: Vec3 = [0, 0, 0];
  const pathAt: Vec3 = [0, 0, 0];
  /** Trunk roll/pitch from the clip, with heading excluded. */
  let tilt: Quat = [1, 0, 0, 0];

  function emit(): void {
    const half = yaw / 2;
    const heading: Quat = [Math.cos(half), 0, 0, Math.sin(half)];

    // The commanded body lean rides on top of the recorded tilt, so `pose()`
    // still moves the trunk even though no clip was baked leaning.
    const cr = Math.cos(body.roll / 2);
    const sr = Math.sin(body.roll / 2);
    const cp = Math.cos(body.pitch / 2);
    const sp = Math.sin(body.pitch / 2);
    const lean: Quat = [cr * cp, sr * cp, cr * sp, -sr * sp];
    const oriented = quatMul(tilt, lean);
    // Heading is integrated from the achieved turn rate; roll and pitch come
    // from the recording. Composing them is what makes a roulade actually roll.
    const quat = quatMul(heading, oriented);

    // Projected gravity, read off the same orientation the renderer uses --
    // so during a roll the telemetry swings the way a real IMU would.
    const [w, x, y, z] = oriented;
    gravity[0] = -2 * (x * z - w * y);
    gravity[1] = -2 * (y * z + w * x);
    gravity[2] = -(1 - 2 * (x * x + y * y));

    const state: DuckState = {
      joints,
      root: { pos: [pos[0], pos[1], pos[2]], quat },
      gyro,
      gravity,
      health: 'playback',
      activeSkill: skill,
      seated,
      mouth: mouthOpen,
    };
    for (const cb of listeners) cb(state);
  }

  function beginSkill(s: Skill): void {
    skill = s;
    skillElapsed = 0;
    skillStart = [pos[0], pos[1], pos[2]];
    skillYaw = yaw;
    blendOut = 0;
    wanted = { vx: 0, vy: 0, vyaw: 0 };
    twist = { vx: 0, vy: 0, vyaw: 0 };
  }

  /** Remember the pose a finished skill left behind, so handing back can ease. */
  function holdPose(): void {
    holdJoints.set(joints);
    holdTilt = [tilt[0], tilt[1], tilt[2], tilt[3]];
    holdZ = pos[2];
    blendOut = 1;
  }

  /** Play the active skill for this tick. Returns false once it has finished. */
  function tickSkill(step: number): boolean {
    const clip = skill ? clips.skills.get(skill) : undefined;
    if (!clip) {
      skill = null;
      return false;
    }

    skillElapsed += step;
    if (skillElapsed >= clip.duration) {
      const finished = skill;
      skill = null;
      skillElapsed = 0;
      if (finished === 'sit') seated = true;
      else if (finished === 'stand') seated = false;
      holdPose();
      if (pending) {
        const next = pending;
        pending = null;
        beginSkill(next);
        return true;
      }
      return false;
    }

    // Clamped, not wrapped: a skill is a one-shot, and wrapping would blend its
    // final instant back towards the pose it started from.
    const p = clamp(skillElapsed / clip.duration, 0, 1);
    sampleOnce(clip.joints, clip.frames, p, joints);
    sampleQuatOnce(clip.tilt, clip.frames, p, tilt);

    // The recorded trunk path, replayed under whatever heading the skill began
    // with. This is what carries a roulade half a metre forward. The height is
    // absolute -- the simulation's own trunk height, not an offset from a
    // standing pose -- which is what keeps the feet on the floor through a roll
    // and lets the stand-up begin from a seated robot without a special case.
    samplePath(clip.rootPath, clip.frames, p, pathAt);
    const c = Math.cos(skillYaw);
    const s = Math.sin(skillYaw);
    pos[0] = skillStart[0] + pathAt[0] * c - pathAt[1] * s;
    pos[1] = skillStart[1] + pathAt[0] * s + pathAt[1] * c;
    pos[2] = pathAt[2];

    gyro[0] = 0;
    gyro[1] = 0;
    gyro[2] = 0;
    return true;
  }

  /** Hold the seat: the last frame of the sit clip, indefinitely. */
  function holdSeat(): void {
    const sit = clips.skills.get('sit');
    if (!sit) return;
    sampleOnce(sit.joints, sit.frames, 1, joints);
    sampleQuatOnce(sit.tilt, sit.frames, 1, tilt);
    samplePath(sit.rootPath, sit.frames, 1, pathAt);
    pos[2] = pathAt[2];
  }

  function tick(dt: number): void {
    const step = dt > 0 ? dt : CONTROL_DT;

    if (skill && tickSkill(step)) {
      emit();
      return;
    }

    // A seated pugglenaut stays seated. Driving is unavailable until it stands,
    // which is how the real robot behaves.
    if (seated) {
      holdSeat();
      gyro[0] = 0;
      gyro[1] = 0;
      gyro[2] = 0;
      blendOut = Math.max(0, blendOut - step / SKILL_BLEND_OUT);
      emit();
      return;
    }

    // Ease the command so releasing a key does not snap the gait.
    const k = Math.min(1, COMMAND_SMOOTHING * step);
    twist = {
      vx: twist.vx + (wanted.vx - twist.vx) * k,
      vy: twist.vy + (wanted.vy - twist.vy) * k,
      vyaw: twist.vyaw + (wanted.vyaw - twist.vyaw) * k,
    };

    const cmd: Vec3 = [twist.vx, twist.vy, twist.vyaw];
    blendVelocity(clips.gaits, cmd, velocity);

    // Advance the gait cycle only when actually going somewhere. Keyed off the
    // ACHIEVED speed, so a command inside the policy's dead zone holds a stance
    // instead of miming a walk on the spot.
    const speed = Math.hypot(velocity[0], velocity[1]) + Math.abs(velocity[2]) * 0.05;
    const nearest = pickGaits(clips.gaits, cmd)[0];
    if (speed > MOVING_EPSILON) phase = (phase + step / nearest.gait.cycleTime) % 1;

    blendGaits(clips.gaits, cmd, phase, joints);
    // Tilt is taken from the single nearest gait rather than blended: averaging
    // quaternions across four clips is not a rotation, and a walking lean is
    // small enough that the nearest one is right.
    sampleQuat(nearest.gait.tilt, nearest.gait.frames, phase, tilt);

    // Integrate the root from what the recording achieved, in the body frame.
    yaw += velocity[2] * step;
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    pos[0] += (velocity[0] * c - velocity[1] * s) * step;
    pos[1] += (velocity[0] * s + velocity[1] * c) * step;
    pos[2] = tree.trunkHeight + blendBob(clips.gaits, cmd, phase) + body.z;

    // Ease out of the pose a skill left behind, rather than snapping to stand.
    if (blendOut > 0) {
      blendOut = Math.max(0, blendOut - step / SKILL_BLEND_OUT);
      const t = blendOut;
      for (let j = 0; j < JOINT_COUNT; j++) {
        joints[j] = joints[j] * (1 - t) + holdJoints[j] * t;
      }
      pos[2] = pos[2] * (1 - t) + holdZ * t;
      let dot = 0;
      for (let i = 0; i < 4; i++) dot += tilt[i] * holdTilt[i];
      const sign = dot < 0 ? -1 : 1;
      const mixed: number[] = [];
      let norm = 0;
      for (let i = 0; i < 4; i++) {
        const v = tilt[i] * (1 - t) + sign * holdTilt[i] * t;
        mixed.push(v);
        norm += v * v;
      }
      norm = Math.sqrt(norm) || 1;
      tilt = [mixed[0] / norm, mixed[1] / norm, mixed[2] / norm, mixed[3] / norm];
    }

    // Head targets ride over the blended pose. obs.rs is explicit that head
    // targets are a command rather than something added on top of the policy
    // output; the clips were baked with a zero head command, so writing these
    // four slots is the whole of it, with nothing double-applied.
    if (head) {
      const values = [head.neck, head.pitch, head.yaw, head.roll];
      HEAD_SLOTS.forEach((slot, i) => {
        joints[slot] = values[i];
      });
    }

    // Keep every angle inside the servo travel the model declares.
    for (let j = 0; j < JOINT_COUNT; j++) {
      const [lo, hi] = tree.jointLimits[j];
      joints[j] = clamp(joints[j], lo, hi);
    }

    // Yaw rate is genuinely measured here. Roll and pitch rates are not: with
    // no physics there is nothing to measure, so they stay zero rather than
    // being invented.
    gyro[0] = 0;
    gyro[1] = 0;
    gyro[2] = (yaw - lastYaw) / step;
    lastYaw = yaw;

    emit();
  }

  return {
    move(t: Twist) {
      if (skill || seated) return;
      wanted = { vx: t.vx, vy: t.vy, vyaw: t.vyaw };
    },
    head(p: HeadPose) {
      head = { ...p };
    },
    do(s: Skill) {
      if (skill) return;
      if (!clips.skills.has(s)) return;

      // Sit and stand are a pair, not two independent buttons: you can only sit
      // while standing, and only stand while seated.
      if (s === 'sit' && seated) return;
      if (s === 'stand' && !seated) return;

      // Anything else asked for while seated stands up first, then runs -- the
      // real runtime refuses outright ("press Y to stand up first"), which is
      // the same rule with a friendlier answer.
      if (seated && s !== 'stand') {
        pending = s;
        beginSkill('stand');
        return;
      }

      beginSkill(s);
    },
    pose(b: BodyPose) {
      body = { ...b };
    },
    mouth(open: number) {
      mouthOpen = clamp(open, 0, 1);
    },
    stop() {
      wanted = { vx: 0, vy: 0, vyaw: 0 };
      twist = { vx: 0, vy: 0, vyaw: 0 };
    },
    subscribe(cb) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    tick,
    dispose() {
      listeners.clear();
    },
  };
}

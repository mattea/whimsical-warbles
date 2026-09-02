/**
 * `DuckLink` backed by baked motion.
 *
 * Joint motion is replayed from clips recorded off the real policies; world
 * position and heading are integrated from the command being held. So the
 * pugglenaut goes where you point it while its legs do what the trained gait
 * actually does.
 *
 * What this cannot do, by construction: fall over, be pushed, or kick a ball
 * that reacts. There is no physics here, only a recording. `health` reports
 * `'playback'` so the UI can say so rather than imply otherwise.
 */

import { blendBob, blendGaits, sampleClip, type ClipSet } from './clips';
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

/** Every baked gait is one 0.6 s cycle, so phase advances at this rate. */
const CYCLE_TIME = 0.6;

/** How fast a released command decays, so stopping is not a jolt. */
const COMMAND_SMOOTHING = 12;

/** Below this speed the pugglenaut is standing, not stepping. */
const MOVING_EPSILON = 1e-3;

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

  const joints = new Float32Array(JOINT_COUNT);
  const gyro: Vec3 = [0, 0, 0];
  const gravity: Vec3 = [0, 0, -1];

  function emit(): void {
    const half = yaw / 2;
    const quat: Quat = [Math.cos(half), 0, 0, Math.sin(half)];
    const state: DuckState = {
      joints,
      root: { pos: [pos[0], pos[1], pos[2]], quat },
      gyro,
      gravity,
      health: 'playback',
      activeSkill: skill,
      mouth: mouthOpen,
    };
    for (const cb of listeners) cb(state);
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
      skill = null;
      skillElapsed = 0;
      return false;
    }

    // A skill owns the whole body and does not travel.
    const p = clamp(skillElapsed / clip.duration, 0, 0.999999);
    sampleClip(clip.joints, clip.frames, p, joints);
    pos[2] = tree.trunkHeight + clip.rootDz[Math.min(clip.frames - 1, Math.floor(p * clip.frames))];
    gyro[0] = 0;
    gyro[1] = 0;
    gyro[2] = 0;
    return true;
  }

  function tick(dt: number): void {
    const step = dt > 0 ? dt : CONTROL_DT;

    if (skill && tickSkill(step)) {
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

    // Only advance the gait cycle when actually going somewhere -- a parked
    // pugglenaut should hold its stance, as the real robot does when the
    // sticks are released.
    const speed = Math.hypot(twist.vx, twist.vy) + Math.abs(twist.vyaw) * 0.1;
    if (speed > MOVING_EPSILON) phase = (phase + step / CYCLE_TIME) % 1;

    const cmd: Vec3 = [twist.vx, twist.vy, twist.vyaw];
    blendGaits(clips.gaits, cmd, phase, joints);

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

    // Integrate the root from the command, in the pugglenaut's own frame.
    yaw += twist.vyaw * step;
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    pos[0] += (twist.vx * c - twist.vy * s) * step;
    pos[1] += (twist.vx * s + twist.vy * c) * step;
    pos[2] = tree.trunkHeight + blendBob(clips.gaits, cmd, phase) + body.z;

    // Yaw rate is genuinely measured here. Roll and pitch rates are not: with
    // no physics there is nothing to measure, so they stay zero rather than
    // being invented.
    gyro[0] = 0;
    gyro[1] = 0;
    gyro[2] = (yaw - lastYaw) / step;
    lastYaw = yaw;

    // Projected gravity for an upright trunk carrying the commanded lean.
    gravity[0] = Math.sin(body.pitch);
    gravity[1] = -Math.sin(body.roll);
    gravity[2] = -Math.cos(body.pitch) * Math.cos(body.roll);

    emit();
  }

  return {
    move(t: Twist) {
      if (skill) return;
      wanted = { vx: t.vx, vy: t.vy, vyaw: t.vyaw };
    },
    head(p: HeadPose) {
      head = { ...p };
    },
    do(s: Skill) {
      if (skill) return;
      if (!clips.skills.has(s)) return;
      skill = s;
      skillElapsed = 0;
      wanted = { vx: 0, vy: 0, vyaw: 0 };
      twist = { vx: 0, vy: 0, vyaw: 0 };
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

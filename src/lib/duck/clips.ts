/**
 * Baked Microduck motion: decoding, sampling, and phase-locked blending.
 *
 * All pure functions over plain arrays -- no WebGL, no timers -- so the part
 * of the lab most likely to look subtly wrong is the part that is fully
 * testable headlessly.
 *
 * Clips are produced by `scripts/bake-duck-motion.py`.
 */

import { JOINT_COUNT, type Quat, type Vec3 } from './tree';

export interface Gait {
  /** The twist that was commanded when this was recorded. */
  cmd: Vec3;
  /**
   * The body-frame velocity the robot ACTUALLY reached, m/s and rad/s.
   *
   * Not the same thing as `cmd`, and the difference is large: the shipped
   * walking policy holds its stance below roughly vx 0.25, and above it
   * delivers about 40% of what was asked. Driving the world position from the
   * command rather than from this is what makes a robot skate.
   */
  vel: Vec3;
  frames: number;
  /** frames * JOINT_COUNT absolute angles, row-major per frame. */
  joints: Float32Array;
  /** frames vertical offsets, metres, mean-centred. */
  rootDz: Float32Array;
  /** frames * 4 trunk orientations (w, x, y, z), heading removed. */
  tilt: Float32Array;
  cycleTime: number;
}

export interface SkillClip {
  name: string;
  frames: number;
  joints: Float32Array;
  /** frames * 3 trunk displacement from the start, in the starting body frame. */
  rootPath: Float32Array;
  tilt: Float32Array;
  duration: number;
}

export interface ClipSet {
  gaits: Gait[];
  skills: Map<string, SkillClip>;
}

interface RawClip {
  cmd?: number[];
  vel?: number[];
  name?: string;
  frames: number;
  joints: number[];
  rootDz?: number[];
  rootPath?: number[];
  tilt: number[];
  cycleTime?: number;
  duration?: number;
}

interface RawClipSet {
  quantScale: number;
  gaits: RawClip[];
  skills: RawClip[];
}

function dequantize(values: number[], scale: number): Float32Array {
  const out = new Float32Array(values.length);
  for (let i = 0; i < values.length; i++) out[i] = values[i] / scale;
  return out;
}

export function decodeClips(json: unknown): ClipSet {
  const raw = json as RawClipSet;
  const scale = raw.quantScale;

  const gaits: Gait[] = raw.gaits.map((c) => ({
    cmd: c.cmd as Vec3,
    vel: c.vel as Vec3,
    frames: c.frames,
    joints: dequantize(c.joints, scale),
    rootDz: dequantize(c.rootDz as number[], scale),
    tilt: dequantize(c.tilt, scale),
    cycleTime: c.cycleTime as number,
  }));

  const skills = new Map<string, SkillClip>();
  for (const c of raw.skills) {
    skills.set(c.name as string, {
      name: c.name as string,
      frames: c.frames,
      joints: dequantize(c.joints, scale),
      rootPath: dequantize(c.rootPath as number[], scale),
      tilt: dequantize(c.tilt, scale),
      duration: c.duration as number,
    });
  }

  return { gaits, skills };
}

/**
 * Sample a looping joint track at `phase` in [0, 1), linearly interpolating
 * and wrapping the last frame back to the first.
 */
export function sampleClip(
  joints: Float32Array,
  frames: number,
  phase: number,
  out: Float32Array,
): void {
  const wrapped = phase - Math.floor(phase);
  const t = wrapped * frames;
  const f0 = Math.floor(t) % frames;
  const f1 = (f0 + 1) % frames;
  const frac = t - Math.floor(t);

  const a = f0 * JOINT_COUNT;
  const b = f1 * JOINT_COUNT;
  for (let j = 0; j < JOINT_COUNT; j++) {
    out[j] = joints[a + j] + (joints[b + j] - joints[a + j]) * frac;
  }
}

/**
 * Sample a ONE-SHOT joint track, clamping at both ends.
 *
 * `sampleClip` wraps, because a gait cycle is a loop. A skill is not: wrapping
 * makes the last instant of a clip interpolate back towards its first frame,
 * which is a pose from before the skill happened. That is subtle at 50 Hz and
 * catastrophic when a skill's final pose is held -- holding the end of the sit
 * this way produced the standing leg pose at the seated trunk height, putting
 * the feet six centimetres through the floor.
 */
export function sampleOnce(
  joints: Float32Array,
  frames: number,
  progress: number,
  out: Float32Array,
): void {
  const t = Math.max(0, Math.min(1, progress)) * (frames - 1);
  const f0 = Math.floor(t);
  const f1 = Math.min(frames - 1, f0 + 1);
  const frac = t - f0;
  const a = f0 * JOINT_COUNT;
  const b = f1 * JOINT_COUNT;
  for (let j = 0; j < JOINT_COUNT; j++) {
    out[j] = joints[a + j] + (joints[b + j] - joints[a + j]) * frac;
  }
}

/** Sample a ONE-SHOT quaternion track, clamping at both ends. See `sampleOnce`. */
export function sampleQuatOnce(
  tilt: Float32Array,
  frames: number,
  progress: number,
  out: Quat,
): void {
  const t = Math.max(0, Math.min(1, progress)) * (frames - 1);
  const f0 = Math.floor(t);
  const f1 = Math.min(frames - 1, f0 + 1);
  const frac = t - f0;
  const a = f0 * 4;
  const b = f1 * 4;
  let dot = 0;
  for (let k = 0; k < 4; k++) dot += tilt[a + k] * tilt[b + k];
  const sign = dot < 0 ? -1 : 1;
  let norm = 0;
  for (let k = 0; k < 4; k++) {
    const v = tilt[a + k] + (sign * tilt[b + k] - tilt[a + k]) * frac;
    out[k] = v;
    norm += v * v;
  }
  norm = Math.sqrt(norm);
  if (norm > 1e-8) for (let k = 0; k < 4; k++) out[k] /= norm;
  else {
    out[0] = 1;
    out[1] = out[2] = out[3] = 0;
  }
}

/**
 * Sample a looping quaternion track at `phase`, normalized-lerp between the
 * bracketing frames. At 50 Hz consecutive orientations are close enough that
 * nlerp and slerp are visually identical, and nlerp cannot divide by zero.
 */
export function sampleQuat(
  tilt: Float32Array,
  frames: number,
  phase: number,
  out: Quat,
): void {
  const wrapped = phase - Math.floor(phase);
  const t = wrapped * frames;
  const f0 = Math.floor(t) % frames;
  const f1 = (f0 + 1) % frames;
  const frac = t - Math.floor(t);

  const a = f0 * 4;
  const b = f1 * 4;
  // Take the shorter arc: q and -q are the same rotation.
  let dot = 0;
  for (let k = 0; k < 4; k++) dot += tilt[a + k] * tilt[b + k];
  const sign = dot < 0 ? -1 : 1;

  let norm = 0;
  for (let k = 0; k < 4; k++) {
    const v = tilt[a + k] + (sign * tilt[b + k] - tilt[a + k]) * frac;
    out[k] = v;
    norm += v * v;
  }
  norm = Math.sqrt(norm);
  if (norm > 1e-8) for (let k = 0; k < 4; k++) out[k] /= norm;
  else {
    out[0] = 1;
    out[1] = out[2] = out[3] = 0;
  }
}

/**
 * Normalizing scales per command axis, so a turn does not dominate distance.
 * The middle axis is unused -- the shipped policy cannot strafe, so no clip is
 * baked with a lateral command.
 */
const CMD_SCALE: Vec3 = [0.4, 0.3, 2.0];

/** How many neighbours a blend draws on. */
const NEIGHBOURS = 4;

/**
 * The clips nearest a command, with blend weights summing to one.
 *
 * Inverse-square-distance weighting over the nearest grid points. An exact
 * grid hit short-circuits to a single clip, so a held command replays one
 * recording rather than a blend of itself.
 */
export function pickGaits(gaits: Gait[], cmd: Vec3): { gait: Gait; weight: number }[] {
  const distances = gaits.map((gait) => {
    let d2 = 0;
    for (let k = 0; k < 3; k++) {
      const d = (gait.cmd[k] - cmd[k]) / CMD_SCALE[k];
      d2 += d * d;
    }
    return { gait, dist: Math.sqrt(d2) };
  });

  const exact = distances.find((d) => d.dist < 1e-6);
  if (exact) return [{ gait: exact.gait, weight: 1 }];

  distances.sort((a, b) => a.dist - b.dist);
  const near = distances.slice(0, NEIGHBOURS);
  const weights = near.map((n) => 1 / (n.dist * n.dist));
  const total = weights.reduce((s, w) => s + w, 0);

  return near.map((n, i) => ({ gait: n.gait, weight: weights[i] / total }));
}

/**
 * Blend the nearest gaits at a shared phase into `out`.
 *
 * Sampling every clip at the *same* phase is what stops feet teleporting
 * mid-stride: the clips agree about where in the gait cycle they are, so the
 * blend interpolates between comparable poses rather than between a stance
 * leg and a swing leg.
 */
export function blendGaits(
  gaits: Gait[],
  cmd: Vec3,
  phase: number,
  out: Float32Array,
): void {
  out.fill(0);
  const scratch = new Float32Array(JOINT_COUNT);

  for (const { gait, weight } of pickGaits(gaits, cmd)) {
    sampleClip(gait.joints, gait.frames, phase, scratch);
    for (let j = 0; j < JOINT_COUNT; j++) out[j] += scratch[j] * weight;
  }
}

/**
 * The velocity the pugglenaut will actually travel at for a command, blended
 * over the same neighbours as the pose.
 *
 * Feeding this back into the root integration is what keeps the feet planted:
 * the ground moves under the robot at the speed its legs are actually cycling.
 */
export function blendVelocity(gaits: Gait[], cmd: Vec3, out: Vec3): void {
  out[0] = 0;
  out[1] = 0;
  out[2] = 0;
  for (const { gait, weight } of pickGaits(gaits, cmd)) {
    out[0] += gait.vel[0] * weight;
    out[1] += gait.vel[1] * weight;
    out[2] += gait.vel[2] * weight;
  }
}

/** Sample a skill's trunk displacement, in the frame it started in. */
export function samplePath(
  path: Float32Array,
  frames: number,
  progress: number,
  out: Vec3,
): void {
  const t = Math.max(0, Math.min(0.999999, progress)) * (frames - 1);
  const f0 = Math.floor(t);
  const f1 = Math.min(frames - 1, f0 + 1);
  const frac = t - f0;
  for (let k = 0; k < 3; k++) {
    const a = path[f0 * 3 + k];
    out[k] = a + (path[f1 * 3 + k] - a) * frac;
  }
}

/** Vertical bob at a phase, blended over the same neighbours as the pose. */
export function blendBob(gaits: Gait[], cmd: Vec3, phase: number): number {
  const wrapped = phase - Math.floor(phase);
  let total = 0;
  for (const { gait, weight } of pickGaits(gaits, cmd)) {
    const f = Math.min(gait.frames - 1, Math.floor(wrapped * gait.frames));
    total += gait.rootDz[f] * weight;
  }
  return total;
}

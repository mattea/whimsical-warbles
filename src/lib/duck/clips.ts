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
  cmd: Vec3;
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
  rootDz: Float32Array;
  tilt: Float32Array;
  duration: number;
}

export interface ClipSet {
  gaits: Gait[];
  skills: Map<string, SkillClip>;
}

interface RawClip {
  cmd?: number[];
  name?: string;
  frames: number;
  joints: number[];
  rootDz: number[];
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
    frames: c.frames,
    joints: dequantize(c.joints, scale),
    rootDz: dequantize(c.rootDz, scale),
    tilt: dequantize(c.tilt, scale),
    cycleTime: c.cycleTime as number,
  }));

  const skills = new Map<string, SkillClip>();
  for (const c of raw.skills) {
    skills.set(c.name as string, {
      name: c.name as string,
      frames: c.frames,
      joints: dequantize(c.joints, scale),
      rootDz: dequantize(c.rootDz, scale),
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

/** Normalizing scales per command axis, so vyaw does not dominate distance. */
const CMD_SCALE: Vec3 = [0.3, 0.1, 1.0];

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

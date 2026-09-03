import { describe, expect, it } from 'vitest';
import clipsJson from '../../../public/duck/clips.json';
import { JOINT_COUNT } from './tree';
import {
  blendGaits,
  blendVelocity,
  decodeClips,
  pickGaits,
  sampleClip,
  sampleOnce,
} from './clips';

const clips = decodeClips(clipsJson);

describe('decodeClips', () => {
  it('decodes 12 gaits and 6 skills', () => {
    // 4 forward speeds x 3 turn rates. No lateral axis: the shipped walking
    // policy cannot strafe, so no clip is baked with one.
    expect(clips.gaits).toHaveLength(12);
    expect([...clips.skills.keys()].sort()).toEqual([
      'ground_pick',
      'kick_left',
      'kick_right',
      'roulade',
      'sit',
      'stand',
    ]);
  });

  it('sizes every joint track to frames * 14', () => {
    for (const g of clips.gaits) expect(g.joints).toHaveLength(g.frames * JOINT_COUNT);
    for (const s of clips.skills.values()) {
      expect(s.joints).toHaveLength(s.frames * JOINT_COUNT);
    }
  });

  it('dequantizes into plausible radians', () => {
    for (const g of clips.gaits) {
      for (const v of g.joints) expect(Math.abs(v)).toBeLessThan(3.2);
    }
  });

  it('includes a standing-still gait', () => {
    expect(clips.gaits.some((g) => g.cmd.every((v) => v === 0))).toBe(true);
  });

  it('records an achieved velocity that is not the commanded one', () => {
    const standing = clips.gaits.find((g) => g.cmd.every((v) => v === 0))!;
    expect(Math.hypot(...standing.vel)).toBeLessThan(0.02);

    const fast = clips.gaits.find((g) => g.cmd[0] === 0.4 && g.cmd[2] === 0)!;
    // The policy delivers well under what it is asked for -- that gap is the
    // whole reason the root is driven from `vel` rather than `cmd`.
    expect(fast.vel[0]).toBeGreaterThan(0.1);
    expect(fast.vel[0]).toBeLessThan(fast.cmd[0]);
  });

  it('turns in both directions', () => {
    const left = clips.gaits.find((g) => g.cmd[0] === 0 && g.cmd[2] === 2)!;
    const right = clips.gaits.find((g) => g.cmd[0] === 0 && g.cmd[2] === -2)!;
    expect(left.vel[2]).toBeGreaterThan(0.5);
    expect(right.vel[2]).toBeLessThan(-0.5);
  });

  it('captures a whole gait cycle per clip', () => {
    // Detected by autocorrelation, so lengths differ; a clip that failed to
    // find its period would loop with a visible hitch.
    const lengths = new Set(clips.gaits.map((g) => g.frames));
    expect(lengths.size).toBeGreaterThan(1);
    for (const g of clips.gaits) {
      expect(g.frames).toBeGreaterThanOrEqual(12);
      expect(g.frames).toBeLessThanOrEqual(90);
    }
  });
});

describe('sampleClip', () => {
  const frames = 4;
  const joints = new Float32Array(frames * JOINT_COUNT);
  // Joint 0 ramps 0, 1, 2, 3 across the four frames; the rest stay zero.
  for (let f = 0; f < frames; f++) joints[f * JOINT_COUNT] = f;
  const out = new Float32Array(JOINT_COUNT);

  it('returns exact frames at exact phases', () => {
    sampleClip(joints, frames, 0, out);
    expect(out[0]).toBeCloseTo(0, 6);
    sampleClip(joints, frames, 0.5, out);
    expect(out[0]).toBeCloseTo(2, 6);
  });

  it('interpolates between frames', () => {
    sampleClip(joints, frames, 0.125, out); // halfway between frame 0 and 1
    expect(out[0]).toBeCloseTo(0.5, 6);
  });

  it('wraps the last frame back to the first', () => {
    sampleClip(joints, frames, 0.875, out); // halfway between frame 3 and 0
    expect(out[0]).toBeCloseTo(1.5, 6);
  });

  it('handles phase at or beyond 1', () => {
    const a = new Float32Array(JOINT_COUNT);
    const b = new Float32Array(JOINT_COUNT);
    sampleClip(joints, frames, 0.25, a);
    sampleClip(joints, frames, 1.25, b);
    expect(b[0]).toBeCloseTo(a[0], 6);
  });
});

describe('pickGaits', () => {
  it('returns weights summing to one', () => {
    for (const cmd of [
      [0, 0, 0],
      [0.3, 0, 0],
      [0.07, -0.05, 0.4],
    ] as const) {
      const picked = pickGaits(clips.gaits, [...cmd]);
      const total = picked.reduce((s, p) => s + p.weight, 0);
      expect(total).toBeCloseTo(1, 6);
      for (const p of picked) expect(p.weight).toBeGreaterThan(0);
    }
  });

  it('picks a single clip when the command sits on a grid point', () => {
    const picked = pickGaits(clips.gaits, [0.4, 0, 0]);
    expect(picked).toHaveLength(1);
    expect(picked[0].gait.cmd).toEqual([0.4, 0, 0]);
  });
});

describe('blendGaits', () => {
  it('reproduces a grid-point clip exactly', () => {
    const gait = clips.gaits.find((g) => g.cmd.every((v) => v === 0))!;
    const out = new Float32Array(JOINT_COUNT);
    const want = new Float32Array(JOINT_COUNT);
    blendGaits(clips.gaits, [0, 0, 0], 0.25, out);
    sampleClip(gait.joints, gait.frames, 0.25, want);
    for (let j = 0; j < JOINT_COUNT; j++) expect(out[j]).toBeCloseTo(want[j], 5);
  });

  it('stays finite and bounded for off-grid commands', () => {
    const out = new Float32Array(JOINT_COUNT);
    for (let i = 0; i <= 10; i++) {
      blendGaits(clips.gaits, [0.05 * i - 0.15, 0, -0.3 * i], i / 11, out);
      for (const v of out) {
        expect(Number.isFinite(v)).toBe(true);
        expect(Math.abs(v)).toBeLessThan(3.2);
      }
    }
  });

  it('produces real leg motion when walking and none when standing', () => {
    // left_hip_pitch is slot 2. This is the difference between a waddle and a
    // statue sliding across the floor.
    const swing = (cmd: [number, number, number]) => {
      const out = new Float32Array(JOINT_COUNT);
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = 0; i < 30; i++) {
        blendGaits(clips.gaits, cmd, i / 30, out);
        lo = Math.min(lo, out[2]);
        hi = Math.max(hi, out[2]);
      }
      return hi - lo;
    };
    expect(swing([0, 0, 0])).toBeLessThan(0.02);
    expect(swing([0.4, 0, 0])).toBeGreaterThan(0.1);
  });
});

describe('blendVelocity', () => {
  it('is zero for a parked command', () => {
    const v: [number, number, number] = [0, 0, 0];
    blendVelocity(clips.gaits, [0, 0, 0], v);
    expect(Math.hypot(...v)).toBeLessThan(0.02);
  });

  it('reports real forward speed when driving', () => {
    const v: [number, number, number] = [0, 0, 0];
    blendVelocity(clips.gaits, [0.4, 0, 0], v);
    expect(v[0]).toBeGreaterThan(0.1);
  });

  it('reports a negative turn rate for a right-hand command', () => {
    const v: [number, number, number] = [0, 0, 0];
    blendVelocity(clips.gaits, [0, 0, -2], v);
    expect(v[2]).toBeLessThan(-0.5);
  });
});

describe('sampleOnce', () => {
  const frames = 4;
  const joints = new Float32Array(frames * JOINT_COUNT);
  for (let f = 0; f < frames; f++) joints[f * JOINT_COUNT] = f;
  const out = new Float32Array(JOINT_COUNT);

  it('ends on the last frame instead of wrapping to the first', () => {
    // The bug this exists to prevent: `sampleClip` wraps, because a gait is a
    // loop. Using it for a one-shot made the end of the sit blend back towards
    // the standing pose it began from, which held the seated trunk at seated
    // height with standing legs -- six centimetres of leg through the floor.
    sampleOnce(joints, frames, 1, out);
    expect(out[0]).toBeCloseTo(frames - 1, 6);
    sampleClip(joints, frames, 0.999999, out);
    expect(out[0]).toBeLessThan(0.01); // wraps back to frame 0, as designed
  });

  it('clamps outside 0..1 rather than wrapping', () => {
    sampleOnce(joints, frames, 1.5, out);
    expect(out[0]).toBeCloseTo(frames - 1, 6);
    sampleOnce(joints, frames, -0.5, out);
    expect(out[0]).toBeCloseTo(0, 6);
  });

  it('interpolates in between', () => {
    sampleOnce(joints, frames, 0.5, out);
    expect(out[0]).toBeCloseTo(1.5, 6);
  });
});

describe('skill clips', () => {
  it('are trimmed to the part that actually moves', () => {
    // Captured over a fixed window, but the kicks finish in half a second and
    // then hold; untrimmed they froze the console for the remaining 2.5 s.
    for (const name of ['kick_left', 'kick_right', 'sit', 'stand']) {
      expect(clips.skills.get(name)!.duration, name).toBeLessThan(2.0);
    }
    for (const [name, clip] of clips.skills) {
      expect(clip.duration, name).toBeGreaterThan(0.5);
    }
  });

  it('record an absolute trunk height, not an offset', () => {
    // Every skill's path z should be a plausible standing-ish trunk height,
    // which an offset-from-start encoding would not be (it starts at zero).
    for (const [name, clip] of clips.skills) {
      const first = clip.rootPath[2];
      expect(first, name).toBeGreaterThan(0.02);
      expect(first, name).toBeLessThan(0.2);
    }
  });

  it('start the stand-up from a seated trunk height', () => {
    const stand = clips.skills.get('stand')!;
    const sit = clips.skills.get('sit')!;
    const sitEnd = sit.rootPath[(sit.frames - 1) * 3 + 2];
    // The rise is baked as a continuation of the sit, so it must begin near
    // where the sit left off rather than at standing height.
    expect(stand.rootPath[2]).toBeCloseTo(sitEnd, 2);
    expect(stand.rootPath[(stand.frames - 1) * 3 + 2]).toBeGreaterThan(sitEnd + 0.03);
  });
});

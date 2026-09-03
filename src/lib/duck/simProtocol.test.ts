import { describe, expect, it } from 'vitest';
import type { Skill } from './link';
import {
  decodeStateFrame,
  encodeStateFrame,
  POLICY_SLOTS,
  skillCode,
  skillFromCode,
  SKILL_CODES,
  STATE_FRAME_LEN,
  STATE_SLOT,
} from './simProtocol';

function emptyTarget() {
  return {
    joints: new Float32Array(14),
    pos: [0, 0, 0],
    quat: [0, 0, 0, 0],
    gyro: [0, 0, 0],
    gravity: [0, 0, 0],
  };
}

const SAMPLE = {
  joints: Float32Array.from({ length: 14 }, (_, i) => (i + 1) * 0.0625),
  pos: [0.25, -0.5, 0.1162],
  quat: [0.5, 0.5, -0.5, 0.5],
  gyro: [0.125, -0.25, 2],
  gravity: [0.0625, -0.125, -0.9921875],
  mouth: 0.5,
  seated: true,
  skill: 'roulade' as Skill | null,
  recovering: true,
  controlHz: 50,
  realtime: 1,
};

describe('state frame layout', () => {
  it('has a slot for every field and no overlaps', () => {
    // Widths in declaration order. If a field is widened without moving the
    // ones after it, this is what notices.
    const widths: [keyof typeof STATE_SLOT, number][] = [
      ['joints', 14],
      ['pos', 3],
      ['quat', 4],
      ['gyro', 3],
      ['gravity', 3],
      ['mouth', 1],
      ['seated', 1],
      ['skill', 1],
      ['recovering', 1],
      ['controlHz', 1],
      ['realtime', 1],
    ];
    let at = 0;
    for (const [name, width] of widths) {
      expect(STATE_SLOT[name], name).toBe(at);
      at += width;
    }
    expect(at).toBe(STATE_FRAME_LEN);
  });
});

describe('encodeStateFrame / decodeStateFrame', () => {
  it('round-trips every field', () => {
    const frame = encodeStateFrame(new Float32Array(STATE_FRAME_LEN), SAMPLE);
    const into = emptyTarget();
    const extra = decodeStateFrame(frame, into);

    // Every sample value is exact in float32, so this is an equality test.
    expect(Array.from(into.joints)).toEqual(Array.from(SAMPLE.joints));
    expect(into.pos).toEqual([0.25, -0.5, Math.fround(0.1162)]);
    expect(into.quat).toEqual(SAMPLE.quat);
    expect(into.gyro).toEqual(SAMPLE.gyro);
    expect(into.gravity).toEqual(SAMPLE.gravity);
    expect(extra).toEqual({
      mouth: 0.5,
      seated: true,
      skill: 'roulade',
      recovering: true,
      controlHz: 50,
      realtime: 1,
    });
  });

  it('round-trips the null skill and the cleared flags', () => {
    const frame = encodeStateFrame(new Float32Array(STATE_FRAME_LEN), {
      ...SAMPLE,
      skill: null,
      seated: false,
      recovering: false,
    });
    const extra = decodeStateFrame(frame, emptyTarget());
    expect(extra.skill).toBeNull();
    expect(extra.seated).toBe(false);
    expect(extra.recovering).toBe(false);
  });

  it('reuses the buffer it is given rather than allocating', () => {
    const frame = new Float32Array(STATE_FRAME_LEN);
    expect(encodeStateFrame(frame, SAMPLE)).toBe(frame);
  });

  it('refuses a frame of the wrong width from either side', () => {
    expect(() => encodeStateFrame(new Float32Array(STATE_FRAME_LEN - 1), SAMPLE)).toThrow(
      /expected 33/,
    );
    expect(() => decodeStateFrame(new Float32Array(2), emptyTarget())).toThrow(/expected 33/);
  });
});

describe('skill codes', () => {
  it('round-trips every skill', () => {
    for (const s of SKILL_CODES) expect(skillFromCode(skillCode(s))).toBe(s);
  });

  it('maps no-skill to -1 and back', () => {
    expect(skillCode(null)).toBe(-1);
    expect(skillFromCode(-1)).toBeNull();
  });

  it('reads an unknown code as no skill rather than throwing mid-tick', () => {
    expect(skillFromCode(99)).toBeNull();
  });

  it('covers exactly the Skill union', () => {
    // Written out so adding a skill to link.ts without giving it a code fails
    // here, where it is cheap, rather than silently transmitting -1.
    expect([...SKILL_CODES].sort()).toEqual(
      ['ground_pick', 'kick_left', 'kick_right', 'roulade', 'sit', 'stand'].sort(),
    );
  });
});

describe('policy slots', () => {
  it('lists exactly the seven shipped policies', () => {
    expect(POLICY_SLOTS).toHaveLength(7);
    expect(new Set(POLICY_SLOTS).size).toBe(7);
  });
});

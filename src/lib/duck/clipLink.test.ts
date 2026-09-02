import { describe, expect, it } from 'vitest';
import clipsJson from '../../../public/duck/clips.json';
import treeJson from '../../../public/duck/tree.json';
import { decodeClips } from './clips';
import { createClipLink } from './clipLink';
import { CONTROL_DT, type DuckLink, type DuckState } from './link';
import { JOINT_COUNT, loadTree } from './tree';

const tree = loadTree(treeJson);
const clips = decodeClips(clipsJson);

/** A link plus a always-current snapshot of its last emitted state. */
function harness() {
  const link = createClipLink(tree, clips);
  const seen = { state: null as DuckState | null, count: 0 };
  const off = link.subscribe((s) => {
    seen.state = s;
    seen.count++;
  });
  return { link, seen, off };
}

/** Advance `seconds` of simulated time in exact control ticks. */
function advance(link: DuckLink, seconds: number): void {
  const ticks = Math.round(seconds / CONTROL_DT);
  for (let i = 0; i < ticks; i++) link.tick(CONTROL_DT);
}

describe('createClipLink', () => {
  it('reports playback health and 14 joints', () => {
    const { link, seen } = harness();
    link.tick(CONTROL_DT);
    expect(seen.state!.health).toBe('playback');
    expect(seen.state!.joints).toHaveLength(JOINT_COUNT);
  });

  it('starts at the origin and stays there with no command', () => {
    const { link, seen } = harness();
    advance(link, 2);
    expect(seen.state!.root.pos[0]).toBeCloseTo(0, 3);
    expect(seen.state!.root.pos[1]).toBeCloseTo(0, 3);
  });

  it('parks the trunk at its standing height', () => {
    const { link, seen } = harness();
    advance(link, 1);
    expect(seen.state!.root.pos[2]).toBeCloseTo(tree.trunkHeight, 2);
  });

  it('integrates forward travel from a held command', () => {
    const { link, seen } = harness();
    link.move({ vx: 0.15, vy: 0, vyaw: 0 });
    advance(link, 2);
    // 0.15 m/s for 2 s, less the command-smoothing ramp-in.
    expect(seen.state!.root.pos[0]).toBeGreaterThan(0.25);
    expect(seen.state!.root.pos[0]).toBeLessThan(0.31);
  });

  it('turns in place on a yaw command without translating', () => {
    const { link, seen } = harness();
    link.move({ vx: 0, vy: 0, vyaw: 1.0 });
    advance(link, 1);
    const [w, , , z] = seen.state!.root.quat;
    expect(Math.abs(2 * Math.atan2(z, w))).toBeGreaterThan(0.8);
    expect(Math.hypot(seen.state!.root.pos[0], seen.state!.root.pos[1])).toBeLessThan(0.02);
  });

  it('drives along its heading after turning', () => {
    const { link, seen } = harness();
    link.move({ vx: 0, vy: 0, vyaw: 1.0 });
    advance(link, Math.PI / 2); // ~90 degrees
    link.move({ vx: 0.3, vy: 0, vyaw: 0 });
    advance(link, 1);
    // Heading is +90 degrees, so travel is along +Y, not +X.
    expect(seen.state!.root.pos[1]).toBeGreaterThan(0.2);
    expect(Math.abs(seen.state!.root.pos[0])).toBeLessThan(0.1);
  });

  it('stop() halts travel', () => {
    const { link, seen } = harness();
    link.move({ vx: 0.3, vy: 0, vyaw: 0 });
    advance(link, 1);
    const parked = seen.state!.root.pos[0];
    link.stop();
    advance(link, 1);
    expect(seen.state!.root.pos[0]).toBeCloseTo(parked, 2);
  });

  it('runs a skill once and hands back', () => {
    const { link, seen } = harness();
    link.do('kick_left');
    link.tick(CONTROL_DT);
    expect(seen.state!.activeSkill).toBe('kick_left');
    advance(link, clips.skills.get('kick_left')!.duration + 0.2);
    expect(seen.state!.activeSkill).toBe(null);
  });

  it('ignores a velocity command while a skill is running', () => {
    const { link, seen } = harness();
    link.do('roulade');
    link.move({ vx: 0.3, vy: 0, vyaw: 0 });
    advance(link, 0.5);
    expect(seen.state!.activeSkill).toBe('roulade');
    expect(seen.state!.root.pos[0]).toBeCloseTo(0, 3);
  });

  it('does not interrupt a running skill with another', () => {
    const { link, seen } = harness();
    link.do('roulade');
    link.tick(CONTROL_DT);
    link.do('kick_left');
    link.tick(CONTROL_DT);
    expect(seen.state!.activeSkill).toBe('roulade');
  });

  it('ignores an unknown skill', () => {
    const { link, seen } = harness();
    link.do('somersault' as never);
    link.tick(CONTROL_DT);
    expect(seen.state!.activeSkill).toBe(null);
  });

  it('applies head commands over the blended pose', () => {
    const { link, seen } = harness();
    link.tick(CONTROL_DT);
    const before = seen.state!.joints[7]; // head_yaw
    link.head({ neck: 0, pitch: 0, yaw: 0.5, roll: 0 });
    link.tick(CONTROL_DT);
    expect(seen.state!.joints[7]).not.toBeCloseTo(before, 3);
    expect(seen.state!.joints[7]).toBeCloseTo(0.5, 3);
  });

  it('clamps mouth to 0..1', () => {
    const { link, seen } = harness();
    link.mouth(3);
    link.tick(CONTROL_DT);
    expect(seen.state!.mouth).toBe(1);
    link.mouth(-2);
    link.tick(CONTROL_DT);
    expect(seen.state!.mouth).toBe(0);
  });

  it('reports gravity as near-vertical when level', () => {
    const { link, seen } = harness();
    link.tick(CONTROL_DT);
    expect(seen.state!.gravity[2]).toBeCloseTo(-1, 3);
  });

  it('reports a yaw rate matching the command', () => {
    const { link, seen } = harness();
    link.move({ vx: 0, vy: 0, vyaw: 1.0 });
    advance(link, 1);
    expect(seen.state!.gyro[2]).toBeCloseTo(1.0, 1);
  });

  it('keeps every joint finite and in range across a long drive', () => {
    const { link, seen } = harness();
    for (let i = 0; i < 500; i++) {
      link.move({ vx: 0.3 * Math.sin(i / 40), vy: 0, vyaw: Math.cos(i / 30) });
      link.tick(CONTROL_DT);
      for (let j = 0; j < JOINT_COUNT; j++) {
        expect(Number.isFinite(seen.state!.joints[j])).toBe(true);
        const [lo, hi] = tree.jointLimits[j];
        expect(seen.state!.joints[j]).toBeGreaterThanOrEqual(lo - 1e-3);
        expect(seen.state!.joints[j]).toBeLessThanOrEqual(hi + 1e-3);
      }
    }
  });

  it('unsubscribe stops delivery', () => {
    const { link, seen, off } = harness();
    link.tick(CONTROL_DT);
    const before = seen.count;
    off();
    link.tick(CONTROL_DT);
    expect(seen.count).toBe(before);
  });

  it('steps the gait when driving and holds still when parked', () => {
    // The difference between waddling and gliding. left_hip_pitch is slot 2.
    const swing = (vx: number) => {
      const { link, seen } = harness();
      link.move({ vx, vy: 0, vyaw: 0 });
      advance(link, 1); // let the command smoothing settle
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = 0; i < 40; i++) {
        link.tick(CONTROL_DT);
        lo = Math.min(lo, seen.state!.joints[2]);
        hi = Math.max(hi, seen.state!.joints[2]);
      }
      return hi - lo;
    };
    expect(swing(0)).toBeLessThan(0.02);
    expect(swing(0.3)).toBeGreaterThan(0.1);
  });
});

describe('trunk orientation', () => {
  /** Pitch angle, degrees, from the emitted root quaternion. */
  const pitchOf = (q: readonly number[]) => {
    const [w, x, y, z] = q;
    return (Math.asin(Math.max(-1, Math.min(1, 2 * (w * y - z * x)))) * 180) / Math.PI;
  };

  it('keeps the trunk upright when standing', () => {
    const { link, seen } = harness();
    advance(link, 1);
    expect(Math.abs(pitchOf(seen.state!.root.quat))).toBeLessThan(5);
    expect(seen.state!.gravity[2]).toBeCloseTo(-1, 2);
  });

  it('actually rolls the trunk through a roulade', () => {
    const { link, seen } = harness();
    link.do('roulade');
    let extreme = 0;
    const ticks = Math.round(clips.skills.get('roulade')!.duration / CONTROL_DT);
    for (let i = 0; i < ticks; i++) {
      link.tick(CONTROL_DT);
      extreme = Math.max(extreme, Math.abs(pitchOf(seen.state!.root.quat)));
    }
    // A forward roll takes the trunk past horizontal, not a shuffle in place.
    expect(extreme).toBeGreaterThan(60);
  });

  it('swings projected gravity during the roll, as an IMU would', () => {
    const { link, seen } = harness();
    link.do('roulade');
    let minZ = Infinity;
    const ticks = Math.round(clips.skills.get('roulade')!.duration / CONTROL_DT);
    for (let i = 0; i < ticks; i++) {
      link.tick(CONTROL_DT);
      minZ = Math.min(minZ, seen.state!.gravity[2]);
    }
    // Upright reads -1; rolled onto its head reads well above that.
    expect(minZ).toBeLessThan(-0.9);
    expect(seen.state!.gravity[2]).toBeGreaterThan(-1.01);
  });

  it('emits unit quaternions throughout a roll', () => {
    const { link, seen } = harness();
    link.do('roulade');
    const ticks = Math.round(clips.skills.get('roulade')!.duration / CONTROL_DT);
    for (let i = 0; i < ticks; i++) {
      link.tick(CONTROL_DT);
      const n = Math.hypot(...seen.state!.root.quat);
      expect(n).toBeCloseTo(1, 5);
    }
  });

  it('leans the trunk on a body-pose command', () => {
    const { link, seen } = harness();
    advance(link, 0.5);
    const level = pitchOf(seen.state!.root.quat);
    link.pose({ z: 0, roll: 0, pitch: 0.3 });
    link.tick(CONTROL_DT);
    expect(pitchOf(seen.state!.root.quat) - level).toBeGreaterThan(10);
  });
});

import { describe, expect, it } from 'vitest';
import treeJson from '../../../public/duck/tree.json';
import clipsJson from '../../../public/duck/clips.json';
import { decodeClips } from './clips';
import { createClipLink } from './clipLink';
import { CONTROL_DT } from './link';
import { loadTree } from './tree';
import {
  ARRIVE_RADIUS,
  angleDelta,
  steerToward,
  yawOf,
  HEADING_DEADBAND,
  TURN_FIRST,
} from './steer';
import type { Vec3 } from './tree';

describe('angleDelta', () => {
  it('takes the short way round', () => {
    expect(angleDelta(0, 0.5)).toBeCloseTo(0.5, 6);
    expect(angleDelta(0, -0.5)).toBeCloseTo(-0.5, 6);
    // Across the wrap: 170 degrees to -170 is +20, not -340.
    expect(angleDelta((170 * Math.PI) / 180, (-170 * Math.PI) / 180)).toBeCloseTo(
      (20 * Math.PI) / 180,
      6,
    );
  });
});

describe('yawOf', () => {
  it('reads a yaw-only quaternion', () => {
    for (const angle of [0, 0.7, -1.2, 3.0]) {
      const h = angle / 2;
      expect(yawOf([Math.cos(h), 0, 0, Math.sin(h)])).toBeCloseTo(angle, 6);
    }
  });
});

describe('steerToward', () => {
  const origin: Vec3 = [0, 0, 0.12];

  it('reports arrival inside the radius and commands nothing', () => {
    const r = steerToward(origin, 0, [ARRIVE_RADIUS * 0.5, 0, 0]);
    expect(r.arrived).toBe(true);
    expect(r.twist).toEqual({ vx: 0, vy: 0, vyaw: 0 });
  });

  it('walks straight at a target dead ahead', () => {
    const r = steerToward(origin, 0, [1, 0, 0]);
    expect(r.arrived).toBe(false);
    expect(r.twist.vx).toBeGreaterThan(0.3);
    expect(r.twist.vyaw).toBe(0);
    expect(r.distance).toBeCloseTo(1, 6);
  });

  it('turns in place when badly misaligned, rather than arcing', () => {
    const r = steerToward(origin, 0, [0, 1, 0]); // 90 degrees to the left
    expect(r.twist.vx).toBe(0);
    expect(r.twist.vyaw).toBeGreaterThan(0);
  });

  it('turns the short way', () => {
    // Target behind and slightly right: it should turn right, not left.
    const r = steerToward(origin, 0, [-1, -0.2, 0]);
    expect(r.twist.vyaw).toBeLessThan(0);
  });

  it('commands turns only past the policy dead zone, never inside it', () => {
    // The whole reason this is bang-bang. A proportional law would emit tiny
    // yaw commands the shipped policy ignores completely, and the robot would
    // stand still while the controller believed it was steering.
    for (const err of [0.2, 0.6, 1.5, 3.0]) {
      const r = steerToward(origin, 0, [Math.cos(err), Math.sin(err), 0]);
      expect(Math.abs(r.twist.vyaw)).toBeGreaterThanOrEqual(1.5);
    }
    // Inside the deadband it stops correcting instead of dithering.
    const straight = steerToward(origin, 0, [Math.cos(HEADING_DEADBAND / 2), Math.sin(HEADING_DEADBAND / 2), 0]);
    expect(straight.twist.vyaw).toBe(0);
  });

  it('never commands a forward speed the policy would ignore', () => {
    for (const d of [0.1, 0.2, 0.5, 2]) {
      const r = steerToward(origin, 0, [d, 0, 0]);
      if (r.twist.vx > 0) expect(r.twist.vx).toBeGreaterThanOrEqual(0.25);
    }
  });

  it('eases off near the target', () => {
    const far = steerToward(origin, 0, [2, 0, 0]).twist.vx;
    const near = steerToward(origin, 0, [0.15, 0, 0]).twist.vx;
    expect(near).toBeLessThan(far);
    expect(near).toBeGreaterThan(0);
  });

  it('turns first past the threshold and walks below it', () => {
    const beyond = steerToward(origin, 0, [Math.cos(TURN_FIRST + 0.1), Math.sin(TURN_FIRST + 0.1), 0]);
    const within = steerToward(origin, 0, [Math.cos(TURN_FIRST - 0.1), Math.sin(TURN_FIRST - 0.1), 0]);
    expect(beyond.twist.vx).toBe(0);
    expect(within.twist.vx).toBeGreaterThan(0);
  });
});

describe('steering the actual playback backend', () => {
  const tree = loadTree(treeJson);
  const clips = decodeClips(clipsJson);

  /** Drive the real link with the real controller until it arrives or gives up. */
  function walkTo(target: Vec3, seconds = 30) {
    const link = createClipLink(tree, clips);
    let state: { root: { pos: Vec3; quat: readonly number[] } } | null = null;
    link.subscribe((s) => {
      state = s as never;
    });
    link.tick(CONTROL_DT);
    let arrived = false;
    const ticks = Math.round(seconds / CONTROL_DT);
    for (let i = 0; i < ticks && !arrived; i++) {
      const pos = state!.root.pos;
      const r = steerToward(pos, yawOf(state!.root.quat), target);
      arrived = r.arrived;
      link.move(r.twist);
      link.tick(CONTROL_DT);
    }
    return { arrived, pos: state!.root.pos };
  }

  it('reaches a spot straight ahead', () => {
    const { arrived, pos } = walkTo([1, 0, 0.12]);
    expect(arrived).toBe(true);
    expect(Math.hypot(pos[0] - 1, pos[1])).toBeLessThanOrEqual(ARRIVE_RADIUS + 0.02);
  });

  it('reaches a spot it has to turn towards', () => {
    const { arrived, pos } = walkTo([0.6, 0.9, 0.12]);
    expect(arrived).toBe(true);
    expect(Math.hypot(pos[0] - 0.6, pos[1] - 0.9)).toBeLessThanOrEqual(ARRIVE_RADIUS + 0.02);
  });

  it('reaches a spot directly behind it', () => {
    // The hardest case for a robot that cannot strafe: it must turn most of a
    // half-circle before it can make any progress at all.
    const { arrived, pos } = walkTo([-0.8, -0.1, 0.12]);
    expect(arrived).toBe(true);
    expect(Math.hypot(pos[0] + 0.8, pos[1] + 0.1)).toBeLessThanOrEqual(ARRIVE_RADIUS + 0.02);
  });

  it('settles instead of circling the target forever', () => {
    // Overshoot then orbit is the classic failure of a bang-bang approach.
    const link = createClipLink(tree, clips);
    let state: { root: { pos: Vec3; quat: readonly number[] } } | null = null;
    link.subscribe((s) => {
      state = s as never;
    });
    link.tick(CONTROL_DT);
    const target: Vec3 = [0.5, 0.5, 0.12];
    let arrivedAt = -1;
    for (let i = 0; i < 1500; i++) {
      const r = steerToward(state!.root.pos, yawOf(state!.root.quat), target);
      if (r.arrived && arrivedAt < 0) arrivedAt = i;
      link.move(r.twist);
      link.tick(CONTROL_DT);
    }
    expect(arrivedAt).toBeGreaterThan(0);
    // Still parked where it arrived, not orbiting.
    expect(Math.hypot(state!.root.pos[0] - 0.5, state!.root.pos[1] - 0.5)).toBeLessThan(0.15);
  });
});

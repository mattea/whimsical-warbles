import { describe, expect, it } from 'vitest';
import manifest from '../../../public/duck/policies/manifest.json';
import { CONTROL_DT, type Skill, type Twist } from './link';
import { STANDING_ACTION_SCALE, WALKING_ACTION_SCALE } from './observation';
import {
  actionScaleForSlot,
  createFallMonitor,
  createSimController,
  FALL_TICKS,
  FALL_UPRIGHT,
  GROUND_PICK_END_PHASE,
  GROUND_PICK_PERIOD,
  locomotionSlot,
  projectedGravityFromQuat,
  RISE_TICKS,
  RISE_UPRIGHT,
  SKILL_DURATION,
  SKILL_POLICY,
  skillTwist,
  uprightFromGravity,
} from './simControl';
import { POLICY_SLOTS, type PolicySlot } from './simProtocol';
import type { Vec3 } from './tree';

const ALL: PolicySlot[] = [...POLICY_SLOTS];

function grav(quat: number[]): Vec3 {
  return projectedGravityFromQuat(quat, [0, 0, 0]);
}

describe('projectedGravityFromQuat', () => {
  it('reads straight down when the trunk is level', () => {
    expect(grav([1, 0, 0, 0])).toEqual([-0, -0, -1]);
  });

  it('is unchanged by heading -- gravity cannot see yaw', () => {
    const half = Math.PI / 4;
    const yawed = grav([Math.cos(half), 0, 0, Math.sin(half)]);
    yawed.forEach((v, i) => expect(v).toBeCloseTo([0, 0, -1][i], 12));
  });

  it('swings to the side when the trunk pitches 90 degrees', () => {
    // Pitch about +y by 90 deg: the trunk's own -z now points along world +x,
    // so gravity reads along the trunk's x axis.
    const half = Math.PI / 4;
    const g = grav([Math.cos(half), 0, Math.sin(half), 0]);
    expect(g[0]).toBeCloseTo(1, 12);
    expect(g[1]).toBeCloseTo(0, 12);
    expect(g[2]).toBeCloseTo(0, 12);
  });

  it('inverts when the trunk is upside down', () => {
    const g = grav([0, 1, 0, 0]); // 180 deg about x
    expect(g[2]).toBeCloseTo(1, 12);
    expect(uprightFromGravity(g)).toBeCloseTo(-1, 12);
  });

  it('agrees with the sign convention the console reads', () => {
    expect(uprightFromGravity([0, 0, -1])).toBe(1);
  });
});

describe('skill command encodings', () => {
  // Table-driven on purpose: these are copied from control.rs and are the part
  // of the simulator that cannot be derived from anything else on this side.
  const cases: [Skill, number, Twist][] = [
    ['kick_left', 0, { vx: 0, vy: 0, vyaw: 0 }],
    ['kick_left', 1.5, { vx: 0, vy: 0, vyaw: 0 }],
    ['kick_right', 0, { vx: 0, vy: 0, vyaw: 0 }],
    ['roulade', 2.9, { vx: 0, vy: 0, vyaw: 0 }],
    // The sit/stand policy's *standing* command is all-zero; sitting is the
    // one that carries a value. Upstream flags this as easy to get backwards.
    ['sit', 0, { vx: 1, vy: 0, vyaw: 0 }],
    ['sit', 1.9, { vx: 1, vy: 0, vyaw: 0 }],
    ['stand', 0, { vx: 0, vy: 0, vyaw: 0 }],
    ['ground_pick', 0, { vx: 1, vy: 0, vyaw: 0 }],
  ];

  it.each(cases)('%s at t=%s', (skill, elapsed, expected) => {
    const t = skillTwist(skill, elapsed);
    expect(t.vx).toBeCloseTo(expected.vx, 12);
    expect(t.vy).toBeCloseTo(expected.vy, 12);
    expect(t.vyaw).toBeCloseTo(expected.vyaw, 12);
  });

  it('walks the ground pick round a unit circle at dt/4 per tick', () => {
    // One control tick is 0.02 s, so phase advances 0.005 -- a four second
    // period. Quarter turn at one second.
    const q = skillTwist('ground_pick', GROUND_PICK_PERIOD / 4);
    expect(q.vx).toBeCloseTo(0, 12);
    expect(q.vy).toBeCloseTo(1, 12);
    for (const t of [0, 0.4, 1.3, 2.7]) {
      const c = skillTwist('ground_pick', t);
      expect(Math.hypot(c.vx, c.vy)).toBeCloseTo(1, 12);
      expect(c.vyaw).toBe(0);
    }
  });

  it('freezes the ground pick at phase 0.7, which is where its duration comes from', () => {
    expect(SKILL_DURATION.ground_pick).toBeCloseTo(
      GROUND_PICK_END_PHASE * GROUND_PICK_PERIOD,
      12,
    );
    const end = skillTwist('ground_pick', SKILL_DURATION.ground_pick);
    const past = skillTwist('ground_pick', 99);
    expect(past).toEqual(end);
    const angle = 2 * Math.PI * GROUND_PICK_END_PHASE;
    expect(end.vx).toBeCloseTo(Math.cos(angle), 12);
    expect(end.vy).toBeCloseTo(Math.sin(angle), 12);
  });

  it('sends every skill to a policy the manifest actually ships', () => {
    for (const [skill, slot] of Object.entries(SKILL_POLICY)) {
      expect(manifest.policies, skill).toHaveProperty(slot);
    }
    expect(SKILL_POLICY.sit).toBe('sitstand');
    expect(SKILL_POLICY.stand).toBe('sitstand');
  });
});

describe('action scale', () => {
  it('gives the standing policy its own scale and everything else 0.9', () => {
    expect(actionScaleForSlot('stand')).toBe(STANDING_ACTION_SCALE);
    for (const slot of ALL) {
      if (slot === 'stand') continue;
      expect(actionScaleForSlot(slot), slot).toBe(WALKING_ACTION_SCALE);
    }
  });

  it('agrees with the slot a live command selects', () => {
    expect(locomotionSlot({ vx: 0, vy: 0, vyaw: 0 })).toBe('stand');
    expect(locomotionSlot({ vx: 0.4, vy: 0, vyaw: 0 })).toBe('walk');
    // Right at the dead zone the standing policy still has it.
    expect(locomotionSlot({ vx: 0.05, vy: 0, vyaw: 0 })).toBe('stand');
    expect(locomotionSlot({ vx: 0.051, vy: 0, vyaw: 0 })).toBe('walk');
  });
});

describe('fall monitor', () => {
  const feed = (m: ReturnType<typeof createFallMonitor>, value: number, n: number) => {
    let last = m.recovering;
    for (let i = 0; i < n; i++) last = m.update(value);
    return last;
  };

  it('ignores a fall shorter than the hold', () => {
    const m = createFallMonitor();
    expect(feed(m, 0.1, FALL_TICKS - 1)).toBe(false);
    expect(feed(m, 1, 1)).toBe(false);
  });

  it('takes over once the fall is sustained', () => {
    const m = createFallMonitor();
    expect(feed(m, 0.1, FALL_TICKS)).toBe(true);
    expect(m.recovering).toBe(true);
  });

  it('will not be tripped by a stumble that keeps interrupting itself', () => {
    // Alternating below/above the threshold for far longer than the hold.
    const m = createFallMonitor();
    for (let i = 0; i < 200; i++) m.update(i % 2 === 0 ? 0.1 : 1);
    expect(m.recovering).toBe(false);
  });

  it('will not be tripped by walking or by a ground pick bow', () => {
    // Both measured off the real loop: ten seconds of walking bottoms out at
    // 0.998, and the deepest point of the ground pick is 0.829.
    const m = createFallMonitor();
    for (let i = 0; i < 500; i++) m.update(0.998);
    for (let i = 0; i < 140; i++) m.update(0.829);
    expect(m.recovering).toBe(false);
  });

  it('holds on through the whole climb and releases only at the top', () => {
    const m = createFallMonitor();
    feed(m, 0.05, FALL_TICKS);
    // Halfway up is not up. This is the state the sit/stand policy sags into.
    expect(feed(m, 0.45, 200)).toBe(true);
    expect(feed(m, RISE_UPRIGHT + 0.05, RISE_TICKS - 1)).toBe(true);
    expect(feed(m, 1, 1)).toBe(false);
  });

  it('restarts the rise count if it wobbles on the way up', () => {
    const m = createFallMonitor();
    feed(m, 0.05, FALL_TICKS);
    feed(m, 1, RISE_TICKS - 1);
    expect(feed(m, 0.5, 1)).toBe(true);
    expect(feed(m, 1, RISE_TICKS - 1)).toBe(true);
    expect(feed(m, 1, 1)).toBe(false);
  });

  it('honours the documented thresholds', () => {
    expect(FALL_UPRIGHT).toBe(0.55);
    expect(RISE_UPRIGHT).toBe(0.9);
    const m = createFallMonitor();
    // Exactly at the threshold is not a fall; the comparison is strict.
    expect(feed(m, FALL_UPRIGHT, 100)).toBe(false);
  });

  it('can be suspended and reset', () => {
    const m = createFallMonitor();
    feed(m, 0.05, FALL_TICKS);
    m.suspend();
    expect(m.recovering).toBe(false);
    feed(m, 0.05, FALL_TICKS - 1);
    m.reset();
    expect(feed(m, 0.05, FALL_TICKS - 1)).toBe(false);
  });

  it('takes its thresholds from the caller when asked', () => {
    const m = createFallMonitor({ fallUpright: 0.9, fallTicks: 2 });
    expect(feed(m, 0.8, 2)).toBe(true);
  });
});

describe('controller', () => {
  const make = (available: PolicySlot[] = ALL) => createSimController({ available });

  it('stands when nothing is asked of it', () => {
    const p = make().plan(1);
    expect(p.slot).toBe('stand');
    expect(p.twist).toEqual({ vx: 0, vy: 0, vyaw: 0 });
    expect(p.actionScale).toBe(STANDING_ACTION_SCALE);
  });

  it('walks on a live command, passing the twist straight through', () => {
    const c = make();
    c.move({ vx: 0.4, vy: 0, vyaw: -2 });
    const p = c.plan(1);
    expect(p.slot).toBe('walk');
    expect(p.twist).toEqual({ vx: 0.4, vy: 0, vyaw: -2 });
    expect(p.actionScale).toBe(WALKING_ACTION_SCALE);
  });

  it('zeroes the command it hands the standing policy', () => {
    const c = make();
    c.move({ vx: 0.01, vy: 0.01, vyaw: 0 });
    const p = c.plan(1);
    expect(p.slot).toBe('stand');
    expect(p.twist).toEqual({ vx: 0, vy: 0, vyaw: 0 });
  });

  it('falls back to standing if the walking policy is missing', () => {
    const c = make(['stand']);
    c.move({ vx: 0.4, vy: 0, vyaw: 0 });
    expect(c.plan(1).slot).toBe('stand');
  });

  it('refuses a skill whose policy has not been fetched, and runs it once it has', () => {
    const c = make(['walk', 'stand']);
    expect(c.do('roulade')).toBe(false);
    expect(c.plan(1).skill).toBeNull();
    c.provide('roulade');
    expect(c.has('roulade')).toBe(true);
    expect(c.do('roulade')).toBe(true);
    expect(c.plan(1).slot).toBe('roulade');
  });

  it('runs a skill for its documented duration then hands back', () => {
    const c = make();
    c.do('kick_left');
    const ticks = Math.round(SKILL_DURATION.kick_left / CONTROL_DT);
    for (let i = 0; i < ticks; i++) {
      const p = c.plan(1);
      expect(p.skill, `tick ${i}`).toBe('kick_left');
      expect(p.slot).toBe('kick_left');
    }
    expect(c.plan(1).skill).toBeNull();
  });

  it('drops the drive command when a skill starts', () => {
    const c = make();
    c.move({ vx: 0.4, vy: 0, vyaw: 0 });
    c.do('kick_right');
    for (let i = 0; i < Math.round(SKILL_DURATION.kick_right / CONTROL_DT) + 1; i++) c.plan(1);
    expect(c.plan(1).slot).toBe('stand');
  });

  it('refuses a second skill while one is running', () => {
    const c = make();
    expect(c.do('roulade')).toBe(true);
    expect(c.do('kick_left')).toBe(false);
    expect(c.plan(1).skill).toBe('roulade');
  });

  it('holds the seat with the sitting command after the sit finishes', () => {
    const c = make();
    c.do('sit');
    for (let i = 0; i < Math.round(SKILL_DURATION.sit / CONTROL_DT); i++) c.plan(1);
    const p = c.plan(1);
    expect(p.seated).toBe(true);
    expect(p.skill).toBeNull();
    expect(p.slot).toBe('sitstand');
    expect(p.twist).toEqual({ vx: 1, vy: 0, vyaw: 0 });
  });

  it('will not drive while seated, and will not sit twice', () => {
    const c = make();
    c.do('sit');
    for (let i = 0; i < Math.round(SKILL_DURATION.sit / CONTROL_DT) + 1; i++) c.plan(1);
    c.move({ vx: 0.4, vy: 0, vyaw: 0 });
    expect(c.plan(1).slot).toBe('sitstand');
    expect(c.do('sit')).toBe(false);
  });

  it('stands up on the zero command, then goes back to the balance policy', () => {
    const c = make();
    c.do('sit');
    for (let i = 0; i < Math.round(SKILL_DURATION.sit / CONTROL_DT) + 1; i++) c.plan(1);
    expect(c.do('stand')).toBe(true);
    const first = c.plan(1);
    expect(first.slot).toBe('sitstand');
    expect(first.twist).toEqual({ vx: 0, vy: 0, vyaw: 0 });
    for (let i = 0; i < Math.round(SKILL_DURATION.stand / CONTROL_DT); i++) c.plan(1);
    const after = c.plan(1);
    expect(after.seated).toBe(false);
    expect(after.slot).toBe('stand');
  });

  it('stands up first when a skill is asked for from the seat', () => {
    const c = make();
    c.do('sit');
    for (let i = 0; i < Math.round(SKILL_DURATION.sit / CONTROL_DT) + 1; i++) c.plan(1);
    expect(c.do('kick_left')).toBe(true);
    expect(c.plan(1).skill).toBe('stand');
    for (let i = 0; i < Math.round(SKILL_DURATION.stand / CONTROL_DT); i++) c.plan(1);
    expect(c.plan(1).skill).toBe('kick_left');
  });

  it('does not let the fall monitor rescue a roulade', () => {
    const c = make();
    c.do('roulade');
    // Measured mid-roll: upright reaches -0.975. Every tick of it is inverted
    // here, which is worse than the real thing.
    for (let i = 0; i < Math.round(SKILL_DURATION.roulade / CONTROL_DT); i++) {
      const p = c.plan(-1);
      expect(p.recovering).toBe(false);
      expect(p.slot).toBe('roulade');
    }
  });

  it('takes over with the standing policy once it is down', () => {
    const c = make();
    c.move({ vx: 0.4, vy: 0, vyaw: 0 });
    for (let i = 0; i < FALL_TICKS - 1; i++) expect(c.plan(-0.83).recovering).toBe(false);
    const p = c.plan(-0.83);
    expect(p.recovering).toBe(true);
    expect(p.slot).toBe('stand');
    expect(p.twist).toEqual({ vx: 0, vy: 0, vyaw: 0 });
    expect(p.actionScale).toBe(STANDING_ACTION_SCALE);
  });

  it('suppresses driving while recovering and resumes it afterwards', () => {
    const c = make();
    c.move({ vx: 0.4, vy: 0, vyaw: 0 });
    for (let i = 0; i < FALL_TICKS; i++) c.plan(-0.83);
    // A key held down through the tumble is remembered, not acted on.
    c.move({ vx: 0.4, vy: 0, vyaw: 0 });
    const down = c.plan(-0.83);
    expect(down.slot).toBe('stand');
    expect(down.twist).toEqual({ vx: 0, vy: 0, vyaw: 0 });
    for (let i = 0; i < RISE_TICKS; i++) c.plan(1);
    expect(c.plan(1).slot).toBe('walk');
  });

  it('refuses a skill while recovering', () => {
    const c = make();
    for (let i = 0; i < FALL_TICKS; i++) c.plan(-0.83);
    expect(c.do('kick_left')).toBe(false);
    expect(c.plan(-0.83).skill).toBeNull();
    for (let i = 0; i < RISE_TICKS; i++) c.plan(1);
    expect(c.do('kick_left')).toBe(true);
  });

  it('stops driving on stop() even mid-recovery', () => {
    const c = make();
    c.move({ vx: 0.4, vy: 0, vyaw: 0 });
    for (let i = 0; i < FALL_TICKS; i++) c.plan(-0.83);
    c.stop();
    for (let i = 0; i < RISE_TICKS; i++) c.plan(1);
    expect(c.plan(1).slot).toBe('stand');
  });

  it('drops the head and body commands while recovering', () => {
    const c = make();
    c.head({ neck: 0.3, pitch: 0.2, yaw: 0.1, roll: 0 });
    c.pose({ z: 0.02, roll: 0.1, pitch: 0 });
    for (let i = 0; i < FALL_TICKS; i++) c.plan(-0.83);
    const p = c.plan(-0.83);
    expect(p.head).toEqual({ neck: 0, pitch: 0, yaw: 0, roll: 0 });
    expect(p.body).toEqual({ z: 0, roll: 0, pitch: 0 });
  });

  it('passes head and body straight through the rest of the time', () => {
    const c = make();
    c.head({ neck: 0.3, pitch: 0.2, yaw: 0.1, roll: -0.1 });
    c.pose({ z: 0.02, roll: 0.1, pitch: -0.05 });
    const p = c.plan(1);
    expect(p.head).toEqual({ neck: 0.3, pitch: 0.2, yaw: 0.1, roll: -0.1 });
    expect(p.body).toEqual({ z: 0.02, roll: 0.1, pitch: -0.05 });
  });

  it('clears everything on reset', () => {
    const c = make();
    c.do('sit');
    for (let i = 0; i < Math.round(SKILL_DURATION.sit / CONTROL_DT) + 1; i++) c.plan(1);
    c.head({ neck: 1, pitch: 0, yaw: 0, roll: 0 });
    c.reset();
    const p = c.plan(1);
    expect(p.seated).toBe(false);
    expect(p.skill).toBeNull();
    expect(p.slot).toBe('stand');
    expect(p.head.neck).toBe(0);
    // A policy fetched before the reset is still loaded; only the state clears.
    expect(c.has('roulade')).toBe(true);
  });

  it('stops on stop()', () => {
    const c = make();
    c.move({ vx: 0.4, vy: 0, vyaw: 0 });
    c.stop();
    expect(c.plan(1).slot).toBe('stand');
  });
});

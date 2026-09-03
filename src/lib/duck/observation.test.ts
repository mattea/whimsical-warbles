import { describe, expect, it } from 'vitest';
import treeJson from '../../../public/duck/tree.json';
import golden from './obs-golden.json';
import { loadTree, JOINT_COUNT } from './tree';
import {
  ACTION_LEN,
  OBS_LEN,
  STANDING_ACTION_SCALE,
  STANDING_THRESHOLD,
  WALKING_ACTION_SCALE,
  actionScaleFor,
  buildObservation,
  jointTargets,
  twistMagnitude,
  type ObservationInput,
} from './observation';

const tree = loadTree(treeJson);

/** Distinguishable values throughout, so a block that moves shows up as an index. */
function input(over: Partial<ObservationInput> = {}): ObservationInput {
  return {
    gyro: [1, 2, 3],
    gravity: [4, 5, 6],
    jointPos: tree.homePose.slice(),
    jointVel: new Array(JOINT_COUNT).fill(0),
    prevAction: new Array(JOINT_COUNT).fill(0),
    twist: { vx: 0.1, vy: 0.2, vyaw: 0.3 },
    head: { neck: 0.4, pitch: 0.5, yaw: 0.6, roll: 0.7 },
    body: { z: 0.8, roll: 0.9, pitch: 1.0 },
    ...over,
  };
}

describe('buildObservation', () => {
  it('is 61 wide, matching every alpha policy graph', () => {
    expect(OBS_LEN).toBe(61);
    expect(ACTION_LEN).toBe(JOINT_COUNT);
    expect(buildObservation(input(), tree.homePose)).toHaveLength(OBS_LEN);
  });

  it('lands every block at its documented offset', () => {
    const jointPos = tree.homePose.slice();
    jointPos[0] += 0.25;
    const prevAction = new Array(JOINT_COUNT).fill(0);
    prevAction[0] = -0.5;
    prevAction[JOINT_COUNT - 1] = 0.75;

    const d = buildObservation(input({ jointPos, prevAction }), tree.homePose);

    expect([...d.slice(0, 3)]).toEqual([1, 2, 3]);
    expect([...d.slice(3, 6)]).toEqual([4, 5, 6]);
    expect(d[6]).toBeCloseTo(0.25, 6);
    expect(d[20]).toBe(0);
    expect(d[34]).toBe(-0.5);
    expect(d[47]).toBe(0.75);
    // Compared loosely: the buffer is float32, so 0.1 comes back as 0.10000000149.
    [0.1, 0.2, 0.3].forEach((v, i) => expect(d[48 + i]).toBeCloseTo(v, 6));
    [0.4, 0.5, 0.6, 0.7].forEach((v, i) => expect(d[51 + i]).toBeCloseTo(v, 6));
  });

  it('holds body x, y and yaw at zero whatever the caller supplies', () => {
    // Unbound in training, so an all-zero encoding is nominal and not a stub.
    const d = buildObservation(input(), tree.homePose);
    expect(d[55]).toBe(0);
    expect(d[56]).toBe(0);
    expect(d[60]).toBe(0);
  });

  it('orders the body block z, roll, pitch', () => {
    const d = buildObservation(input(), tree.homePose);
    expect(d[57]).toBeCloseTo(0.8, 6);
    expect(d[58]).toBeCloseTo(0.9, 6);
    expect(d[59]).toBeCloseTo(1.0, 6);
  });

  it('reads the home pose as fourteen zeroes', () => {
    const d = buildObservation(input(), tree.homePose);
    for (let i = 6; i < 20; i++) {
      expect(Math.abs(d[i]), `joint slot ${i - 6}`).toBeLessThan(1e-6);
    }
  });

  it('rejects a wrong-width joint vector rather than zero-filling the tail', () => {
    expect(() => buildObservation(input({ jointPos: [0, 0, 0] }), tree.homePose)).toThrow();
    expect(() => buildObservation(input({ jointVel: [] }), tree.homePose)).toThrow();
    expect(() =>
      buildObservation(input({ prevAction: new Array(13).fill(0) }), tree.homePose),
    ).toThrow();
    expect(() => buildObservation(input(), tree.homePose.slice(0, 13))).toThrow();
  });

  it('writes into a caller-supplied buffer, so the control loop can avoid allocating', () => {
    const out = new Float32Array(OBS_LEN);
    expect(buildObservation(input(), tree.homePose, out)).toBe(out);
    expect(out[0]).toBe(1);
  });
});

describe('jointTargets', () => {
  it('is home pose plus scaled action', () => {
    const action = new Array(JOINT_COUNT).fill(0).map((_, i) => (i + 1) / 100);
    const targets = jointTargets(action, tree.homePose, WALKING_ACTION_SCALE);
    for (let i = 0; i < JOINT_COUNT; i++) {
      expect(targets[i]).toBeCloseTo(tree.homePose[i] + 0.9 * action[i], 6);
    }
  });

  it('returns the home pose for a zero action', () => {
    const targets = jointTargets(new Array(JOINT_COUNT).fill(0), tree.homePose, 1);
    for (let i = 0; i < JOINT_COUNT; i++) {
      expect(targets[i]).toBeCloseTo(tree.homePose[i], 6);
    }
  });

  it('rejects a wrong-width action', () => {
    expect(() => jointTargets([0, 0], tree.homePose, 1)).toThrow();
  });
});

describe('actionScaleFor', () => {
  it('uses the walking scale above the standing threshold', () => {
    expect(WALKING_ACTION_SCALE).toBe(0.9);
    expect(STANDING_ACTION_SCALE).toBe(1);
    expect(actionScaleFor({ vx: 0.3, vy: 0, vyaw: 0 })).toBe(WALKING_ACTION_SCALE);
  });

  it('uses the standing scale at rest', () => {
    expect(actionScaleFor({ vx: 0, vy: 0, vyaw: 0 })).toBe(STANDING_ACTION_SCALE);
    expect(actionScaleFor({ vx: STANDING_THRESHOLD, vy: 0, vyaw: 0 })).toBe(
      STANDING_ACTION_SCALE,
    );
  });

  it('measures magnitude on the twist alone, not the head or body', () => {
    expect(twistMagnitude({ vx: 3, vy: 4, vyaw: 0 })).toBeCloseTo(5, 12);
    expect(twistMagnitude({ vx: 0, vy: 0, vyaw: 0 })).toBe(0);
  });
});

/**
 * The fixture is `scripts/bake-duck-motion.py`'s own observation, built in
 * Python from the same states, and it is the only check here that could catch a
 * whole block being in the wrong place *and* agreeing with a hand-written test
 * that made the same mistake. Twenty cases: the home pose, an all-zero input,
 * eight random joint poses at random attitudes, and ten snapshots of the walking
 * policy mid-stride with the previous action that went with them.
 */
describe('buildObservation against the Python bake', () => {
  const homePose = golden.homePose;

  it('reproduces every slot of every golden case', () => {
    expect(golden.cases.length).toBeGreaterThanOrEqual(20);

    for (const [c, kase] of golden.cases.entries()) {
      const [vx, vy, vyaw] = kase.twist;
      const [neck, pitch, yaw, roll] = kase.head;
      const [z, bodyRoll, bodyPitch] = kase.body;
      const obs = buildObservation(
        {
          gyro: kase.gyro,
          gravity: kase.gravity,
          jointPos: kase.jointPos,
          jointVel: kase.jointVel,
          prevAction: kase.prevAction,
          twist: { vx, vy, vyaw },
          head: { neck, pitch, yaw, roll },
          body: { z, roll: bodyRoll, pitch: bodyPitch },
        },
        homePose,
      );

      for (let i = 0; i < OBS_LEN; i++) {
        expect(obs[i], `case ${c} slot ${i}`).toBeCloseTo(kase.obs[i], 6);
      }
    }
  });

  it('agrees with tree.json about the home pose it was baked against', () => {
    // Both come from DEFAULT_POSITION in duck-control/src/model.rs. If they
    // drifted apart, fourteen observation slots would carry a constant offset.
    expect(homePose).toEqual(tree.homePose);
  });
});

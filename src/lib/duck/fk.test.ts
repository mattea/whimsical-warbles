import { describe, expect, it } from 'vitest';
import treeJson from '../../../public/duck/tree.json';
import golden from './fk-golden.json';
import { loadTree, JOINT_COUNT } from './tree';
import { forwardKinematics } from './fk';

const tree = loadTree(treeJson);

describe('tree.json', () => {
  it('has 15 bodies and 14 joints', () => {
    expect(tree.bodies).toHaveLength(15);
    expect(tree.jointNames).toHaveLength(JOINT_COUNT);
  });

  it('assigns every policy slot exactly once', () => {
    const slots = tree.bodies
      .map((b) => b.jointIndex)
      .filter((i) => i >= 0)
      .sort((a, b) => a - b);
    expect(slots).toEqual([...Array(JOINT_COUNT).keys()]);
  });

  it('lists parents before children', () => {
    tree.bodies.forEach((b, i) => expect(b.parent).toBeLessThan(i));
  });
});

describe('forwardKinematics', () => {
  it('matches MuJoCo on every golden case', () => {
    for (const [c, kase] of golden.cases.entries()) {
      const got = forwardKinematics(tree, kase.joints);
      expect(got).toHaveLength(kase.xpos.length);

      for (let b = 0; b < got.length; b++) {
        const name = tree.bodies[b].name;
        for (let k = 0; k < 3; k++) {
          expect(got[b].pos[k], `case ${c} body ${name} pos[${k}]`).toBeCloseTo(
            kase.xpos[b][k],
            6,
          );
        }
        // A quaternion and its negation are the same rotation.
        const dot = got[b].quat.reduce((s, v, k) => s + v * kase.xquat[b][k], 0);
        const sign = dot < 0 ? -1 : 1;
        for (let k = 0; k < 4; k++) {
          expect(sign * got[b].quat[k], `case ${c} body ${name} quat[${k}]`).toBeCloseTo(
            kase.xquat[b][k],
            6,
          );
        }
      }
    }
  });

  it('rejects a wrong-width joint vector', () => {
    expect(() => forwardKinematics(tree, new Float32Array(13))).toThrow();
  });
});

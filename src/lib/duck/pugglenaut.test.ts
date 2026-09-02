import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import treeJson from '../../../public/duck/tree.json';
import { forwardKinematics } from './fk';
import { createPugglenaut, PALETTE } from './pugglenaut';
import { JOINT_COUNT, loadTree } from './tree';

const tree = loadTree(treeJson);
const IDENTITY_ROOT = {
  pos: [0, 0, 0] as [number, number, number],
  quat: [1, 0, 0, 0] as [number, number, number, number],
};

describe('createPugglenaut', () => {
  it('creates one group per body', () => {
    const rig = createPugglenaut(tree);
    const named = tree.bodies.map((b) => rig.root.getObjectByName(`link:${b.name}`));
    expect(named.every(Boolean)).toBe(true);
    rig.dispose();
  });

  it('places link groups exactly where FK says', () => {
    const rig = createPugglenaut(tree);
    const joints = new Float32Array(tree.homePose);
    rig.apply(joints, IDENTITY_ROOT, 0, 0);

    const want = forwardKinematics(tree, joints);
    tree.bodies.forEach((body, i) => {
      const group = rig.root.getObjectByName(`link:${body.name}`)!;
      const world = group.getWorldPosition(new THREE.Vector3());
      expect(world.x, `${body.name}.x`).toBeCloseTo(want[i].pos[0], 5);
      expect(world.y, `${body.name}.y`).toBeCloseTo(want[i].pos[1], 5);
      expect(world.z, `${body.name}.z`).toBeCloseTo(want[i].pos[2], 5);
    });
    rig.dispose();
  });

  it('agrees with FK on orientation too', () => {
    const rig = createPugglenaut(tree);
    // A pose that exercises every joint, not just the home stance.
    const joints = new Float32Array(
      tree.jointLimits.map(([lo, hi], j) => lo + ((hi - lo) * ((j * 7) % 11)) / 11),
    );
    rig.apply(joints, IDENTITY_ROOT, 0, 0);

    const want = forwardKinematics(tree, joints);
    tree.bodies.forEach((body, i) => {
      const group = rig.root.getObjectByName(`link:${body.name}`)!;
      const q = group.getWorldQuaternion(new THREE.Quaternion());
      // three is (x, y, z, w); the tree is (w, x, y, z).
      const got = [q.w, q.x, q.y, q.z];
      const dot = got.reduce((s, v, k) => s + v * want[i].quat[k], 0);
      const sign = dot < 0 ? -1 : 1;
      for (let k = 0; k < 4; k++) {
        expect(sign * got[k], `${body.name}.quat[${k}]`).toBeCloseTo(want[i].quat[k], 5);
      }
    });
    rig.dispose();
  });

  it('honours the root transform', () => {
    const rig = createPugglenaut(tree);
    const joints = new Float32Array(tree.homePose);
    // Quarter turn about Z, lifted to standing height.
    const half = Math.PI / 4;
    rig.apply(joints, { pos: [0.5, -0.25, 0.12], quat: [Math.cos(half), 0, 0, Math.sin(half)] }, 0, 0);
    const trunk = rig.root.getObjectByName('link:trunk_base')!;
    const world = trunk.getWorldPosition(new THREE.Vector3());
    expect(world.x).toBeCloseTo(0.5, 5);
    expect(world.y).toBeCloseTo(-0.25, 5);
    expect(world.z).toBeCloseTo(0.12, 5);
  });

  it('uses the established mascot palette', () => {
    expect(PALETTE.body).toBe(0xcbb27a);
    expect(PALETTE.bodyStroke).toBe(0x8f7a45);
    expect(PALETTE.bill).toBe(0x3a3140);
    expect(PALETTE.eye).toBe(0x20202a);
    expect(PALETTE.catchlight).toBe(0xf7f4ea);
    expect(PALETTE.flame).toBe(0xffcf33);
  });

  it('rejects a wrong-width joint vector', () => {
    const rig = createPugglenaut(tree);
    expect(() => rig.apply(new Float32Array(JOINT_COUNT - 1), IDENTITY_ROOT, 0, 0)).toThrow();
    rig.dispose();
  });

  it('opens the bill with the mouth command', () => {
    const rig = createPugglenaut(tree);
    const joints = new Float32Array(tree.homePose);
    const lower = () => rig.root.getObjectByName('lowerBill')!.rotation.y;
    rig.apply(joints, IDENTITY_ROOT, 0, 0);
    const closed = lower();
    rig.apply(joints, IDENTITY_ROOT, 1, 0);
    const open = lower();
    // -5 deg closed to +30 deg open, per microduck's model.rs.
    expect(closed).toBeCloseTo((-5 * Math.PI) / 180, 5);
    expect(open).toBeCloseTo((30 * Math.PI) / 180, 5);
    rig.dispose();
  });

  it('stands about a quarter of a metre tall', () => {
    const rig = createPugglenaut(tree);
    rig.apply(new Float32Array(tree.homePose), { pos: [0, 0, tree.trunkHeight], quat: [1, 0, 0, 0] }, 0, 0);
    const box = rig.boundingBox();
    const height = box.max.z - box.min.z;
    expect(height).toBeGreaterThan(0.15);
    expect(height).toBeLessThan(0.4);
    rig.dispose();
  });

  it('stands with its feet on the floor', () => {
    const rig = createPugglenaut(tree);
    rig.apply(new Float32Array(tree.homePose), { pos: [0, 0, tree.trunkHeight], quat: [1, 0, 0, 0] }, 0, 0);
    const box = rig.boundingBox();
    // Within a couple of centimetres of z = 0 -- not floating, not sunk.
    expect(Math.abs(box.min.z)).toBeLessThan(0.03);
    rig.dispose();
  });
});

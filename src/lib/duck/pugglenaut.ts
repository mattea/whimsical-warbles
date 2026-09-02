/**
 * The pugglenaut, as Three.js primitives on Microduck's skeleton.
 *
 * The skeleton is the robot's, exactly -- link offsets come from `tree.json`
 * and must not be edited, because a baked joint angle is only meaningful on
 * the tree it was recorded on. The *skin* is ours: the site's baby-platypus
 * astronaut, built from the same stacked-ellipse vocabulary the 2D mascot uses
 * in `BoopMascot.tsx` and `favicon.svg`.
 *
 * Procedural rather than a mesh asset: zero bytes to download, colours that
 * follow the site's themes, and a primitive count that survives stereo XR.
 */

import * as THREE from 'three';
import { JOINT_COUNT, type DuckTree, type Quat, type Vec3 } from './tree';

/** The mascot's established colours. Do not invent new ones here. */
export const PALETTE = {
  body: 0xcbb27a,
  bodyStroke: 0x8f7a45,
  bill: 0x3a3140,
  helmet: 0xffffff,
  helmetRim: 0xffffff,
  eye: 0x20202a,
  catchlight: 0xf7f4ea,
  flame: 0xffcf33,
} as const;

/**
 * Mouth travel. Microduck joint 9, excluded from every policy and driven
 * directly by `robot.mouth` (microduck/duck-control/src/model.rs).
 */
const MOUTH_CLOSED = (-5 * Math.PI) / 180;
const MOUTH_OPEN = (30 * Math.PI) / 180;

export interface Rig {
  root: THREE.Group;
  apply(
    joints: ArrayLike<number>,
    root: { pos: Vec3; quat: Quat },
    mouth: number,
    phase: number,
  ): void;
  boundingBox(): THREE.Box3;
  setTheme(dark: boolean): void;
  dispose(): void;
}

function ellipsoid(
  material: THREE.Material,
  radius: number,
  scale: [number, number, number],
  pos: [number, number, number],
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 16, 12), material);
  mesh.scale.set(...scale);
  mesh.position.set(...pos);
  return mesh;
}

function capsule(
  material: THREE.Material,
  radius: number,
  length: number,
  pos: [number, number, number],
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(radius, length, 4, 8), material);
  mesh.position.set(...pos);
  return mesh;
}

export function createPugglenaut(tree: DuckTree): Rig {
  const materials: THREE.Material[] = [];

  function track<T extends THREE.Material>(m: T): T {
    materials.push(m);
    return m;
  }

  const bodyMat = track(
    new THREE.MeshStandardMaterial({ color: PALETTE.body, roughness: 0.65, metalness: 0.05 }),
  );
  const strokeMat = track(
    new THREE.MeshStandardMaterial({ color: PALETTE.bodyStroke, roughness: 0.7 }),
  );
  const billMat = track(new THREE.MeshStandardMaterial({ color: PALETTE.bill, roughness: 0.5 }));
  const eyeMat = track(new THREE.MeshStandardMaterial({ color: PALETTE.eye, roughness: 0.2 }));
  const catchMat = track(new THREE.MeshBasicMaterial({ color: PALETTE.catchlight }));
  const helmetMat = track(
    new THREE.MeshPhysicalMaterial({
      color: PALETTE.helmet,
      transparent: true,
      opacity: 0.16,
      roughness: 0.05,
      metalness: 0,
      side: THREE.DoubleSide,
    }),
  );
  const rimMat = track(
    new THREE.MeshBasicMaterial({ color: PALETTE.helmetRim, transparent: true, opacity: 0.85 }),
  );
  const flameMat = track(new THREE.MeshBasicMaterial({ color: PALETTE.flame }));

  const root = new THREE.Group();
  root.name = 'pugglenaut';

  // One group per body, parented to mirror the tree so Three.js composes the
  // transforms and FK output can be written straight in as local values.
  const groups: THREE.Group[] = [];
  tree.bodies.forEach((body) => {
    const group = new THREE.Group();
    group.name = `link:${body.name}`;
    groups.push(group);
    if (body.parent < 0) root.add(group);
    else groups[body.parent].add(group);
  });

  const byName = (n: string) => groups[tree.bodies.findIndex((b) => b.name === n)];

  // --- Trunk: the platypus body, the pack, the jetpack and the tail. ---
  const trunk = byName('trunk_base');
  trunk.add(ellipsoid(bodyMat, 0.045, [1.15, 0.9, 0.85], [0.004, 0, 0.012]));
  trunk.add(ellipsoid(strokeMat, 0.026, [1.0, 0.8, 0.6], [-0.026, 0, 0.004]));

  const jet = new THREE.Group();
  jet.position.set(-0.038, 0, 0);
  jet.add(capsule(strokeMat, 0.011, 0.03, [0, 0, 0.01]));
  const flame = ellipsoid(flameMat, 0.009, [1, 1, 1.8], [0, 0, -0.026]);
  flame.name = 'flame';
  jet.add(flame);
  trunk.add(jet);

  // Tail: a flat paddle that sways off gait phase. Decorative, not a joint.
  const tail = new THREE.Group();
  tail.name = 'tail';
  tail.position.set(-0.05, 0, -0.004);
  tail.add(ellipsoid(strokeMat, 0.022, [1.3, 1.0, 0.28], [-0.018, 0, 0]));
  trunk.add(tail);

  // --- Head: bill, eyes, helmet. Parented to the last head link. ---
  const head = byName('jaw_soft');
  head.add(ellipsoid(bodyMat, 0.027, [1.0, 0.95, 0.85], [0, 0, 0]));

  const bill = new THREE.Group();
  bill.name = 'bill';
  bill.position.set(0.022, 0, -0.004);
  bill.add(ellipsoid(billMat, 0.017, [1.25, 1.0, 0.34], [0.006, 0, 0]));
  const lowerBill = new THREE.Group();
  lowerBill.name = 'lowerBill';
  lowerBill.add(ellipsoid(billMat, 0.015, [1.2, 0.92, 0.26], [0.006, 0, -0.004]));
  bill.add(lowerBill);
  head.add(bill);

  for (const side of [1, -1]) {
    head.add(ellipsoid(eyeMat, 0.0055, [1, 1, 1], [0.012, 0.013 * side, 0.014]));
    head.add(ellipsoid(catchMat, 0.0018, [1, 1, 1], [0.016, 0.0155 * side, 0.017]));
  }

  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.042, 24, 18), helmetMat);
  helmet.position.set(0.006, 0, 0.006);
  head.add(helmet);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.0415, 0.0016, 6, 28), rimMat);
  rim.position.copy(helmet.position);
  rim.rotation.x = Math.PI / 2;
  head.add(rim);

  // --- Legs: a capsule per link, plus webbed feet. ---
  for (const side of ['left', 'right'] as const) {
    byName(side === 'left' ? 'upper_leg_left' : 'upper_leg_right').add(
      capsule(bodyMat, 0.01, 0.026, [0, 0.014, 0]),
    );
    byName(side === 'left' ? 'leg' : 'leg_2').add(capsule(bodyMat, 0.009, 0.024, [0, 0.016, 0]));
    byName(side === 'left' ? 'ankle_left' : 'ankle_right').add(
      ellipsoid(billMat, 0.019, [1.35, 0.85, 0.22], [0.012, 0, -0.012]),
    );
  }

  const box = new THREE.Box3();
  const scratchQuat = new THREE.Quaternion();
  const jointQuat = new THREE.Quaternion();
  const zAxis = new THREE.Vector3(0, 0, 1);

  function apply(
    joints: ArrayLike<number>,
    rootPose: { pos: Vec3; quat: Quat },
    mouth: number,
    phase: number,
  ): void {
    if (joints.length !== JOINT_COUNT) {
      throw new Error(`expected ${JOINT_COUNT} joint angles, got ${joints.length}`);
    }

    // Place the whole rig. The trunk carries a freejoint, so this transform is
    // its world pose outright -- `bodies[0].pos` is a keyframe hint, not an
    // offset, and must not be added here.
    root.position.set(rootPose.pos[0], rootPose.pos[1], rootPose.pos[2]);
    root.quaternion.set(rootPose.quat[1], rootPose.quat[2], rootPose.quat[3], rootPose.quat[0]);

    // Write each body's LOCAL transform; Three.js composes the chain. The
    // rotation is body.quat then Rz(angle), matching `fk.ts` exactly.
    tree.bodies.forEach((body, i) => {
      const group = groups[i];
      if (body.parent < 0) {
        group.position.set(0, 0, 0);
        group.quaternion.identity();
        return;
      }
      group.position.set(body.pos[0], body.pos[1], body.pos[2]);
      scratchQuat.set(body.quat[1], body.quat[2], body.quat[3], body.quat[0]);
      if (body.jointIndex >= 0) {
        jointQuat.setFromAxisAngle(zAxis, joints[body.jointIndex]);
        scratchQuat.multiply(jointQuat);
      }
      group.quaternion.copy(scratchQuat);
    });

    // The mouth is a real robot joint, driven by robot.mouth rather than any
    // policy -- so the bill opens over the servo's actual -5..+30 degrees.
    const open = mouth < 0 ? 0 : mouth > 1 ? 1 : mouth;
    lowerBill.rotation.y = MOUTH_CLOSED + open * (MOUTH_OPEN - MOUTH_CLOSED);

    // Decorative: tail sway and flame flicker follow gait phase.
    tail.rotation.z = Math.sin(phase * Math.PI * 2) * 0.22;
    flame.scale.set(1, 1, 1.8 * (1 + Math.sin(phase * Math.PI * 6) * 0.18));

    root.updateMatrixWorld(true);
  }

  return {
    root,
    apply,
    boundingBox() {
      return box.setFromObject(root);
    },
    setTheme(dark: boolean) {
      // Themes only shift the suit's contrast; the mascot keeps its colours.
      strokeMat.color.setHex(dark ? 0x6f5d34 : PALETTE.bodyStroke);
      rimMat.opacity = dark ? 0.95 : 0.85;
    },
    dispose() {
      for (const m of materials) m.dispose();
      root.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
      });
    },
  };
}

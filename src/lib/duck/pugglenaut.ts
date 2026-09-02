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
 *
 * **The skin is authored in world space at the home pose**, then converted
 * into each link's local frame by `attach`. This matters: onshape-to-robot
 * gives every link an arbitrarily rotated frame (hence the 0.707 quaternions
 * throughout `tree.json`), so a hand-written local offset like `[0, 0.014, 0]`
 * points in an essentially random direction. Authoring in world coordinates
 * means "the bill points forward" is written as forward and stays forward.
 *
 * Limb segments are derived rather than authored: the vector from a link to
 * its child *is* the bone, so `bone()` reads it off the tree. The proportions
 * cannot drift from the robot's because they are never typed in.
 */

import * as THREE from 'three';
import { forwardKinematics } from './fk';
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

/** Three's capsules and cylinders run along +Y. */
const UP_Y = new THREE.Vector3(0, 1, 0);

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
      opacity: 0.12,
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

  const indexOf = (name: string) => tree.bodies.findIndex((b) => b.name === name);

  // Where every link sits, in world space, at the home pose. This is the frame
  // the skin is authored against.
  const homeFk = forwardKinematics(tree, new Float32Array(tree.homePose));
  const home = homeFk.map((t) => ({
    pos: new THREE.Vector3(...t.pos),
    quat: new THREE.Quaternion(t.quat[1], t.quat[2], t.quat[3], t.quat[0]),
  }));

  const geometries: THREE.BufferGeometry[] = [];

  /**
   * Attach `obj` to a link so that, at the home pose, it lands at `worldPos`
   * with orientation `worldQuat`.
   */
  function attach(
    link: number,
    obj: THREE.Object3D,
    worldPos: THREE.Vector3,
    worldQuat?: THREE.Quaternion,
  ): void {
    const inv = home[link].quat.clone().invert();
    obj.position.copy(worldPos.clone().sub(home[link].pos).applyQuaternion(inv));
    obj.quaternion.copy(worldQuat ? inv.clone().multiply(worldQuat) : inv);
    groups[link].add(obj);
  }

  function v(x: number, y: number, z: number) {
    return new THREE.Vector3(x, y, z);
  }

  /** An ellipsoid, authored in world space at the home pose. */
  function blob(
    link: number,
    material: THREE.Material,
    at: THREE.Vector3,
    radii: [number, number, number],
  ): THREE.Mesh {
    const geo = new THREE.SphereGeometry(1, 16, 12);
    geometries.push(geo);
    const mesh = new THREE.Mesh(geo, material);
    // Scale in world axes, so the ellipsoid's radii mean what they say. The
    // link's own rotation is undone by `attach`, so scale composes cleanly.
    mesh.scale.set(...radii);
    attach(link, mesh, at);
    return mesh;
  }

  /**
   * The limb segment from a link to its child, as a capsule.
   *
   * Read off the tree rather than typed in, so it cannot disagree with the
   * skeleton. Attached to the *parent* link, which is correct: a child's
   * offset from its parent is fixed, and only the child's own rotation
   * changes with its joint.
   */
  function bone(parent: number, child: number, radius: number, material: THREE.Material): void {
    const a = home[parent].pos;
    const b = home[child].pos;
    const length = a.distanceTo(b);
    const geo = new THREE.CapsuleGeometry(radius, Math.max(0.002, length - radius), 4, 10);
    geometries.push(geo);
    const mesh = new THREE.Mesh(geo, material);
    const dir = b.clone().sub(a).normalize();
    attach(
      parent,
      mesh,
      a.clone().add(b).multiplyScalar(0.5),
      new THREE.Quaternion().setFromUnitVectors(UP_Y, dir),
    );
  }

  const TRUNK = indexOf('trunk_base');
  const HEAD = indexOf('jaw_soft');
  const NECK = indexOf('neck');

  // --- Torso. Spans the hips up to the neck root, which is 3.2 cm up. ---
  blob(TRUNK, bodyMat, v(0.002, 0, 0.006), [0.040, 0.034, 0.040]);
  blob(TRUNK, strokeMat, v(-0.028, 0, 0.004), [0.020, 0.026, 0.028]); // life-support pack

  // Jetpack and flame, behind. Decoration, not a robot part.
  const jet = new THREE.Group();
  const jetGeo = new THREE.CapsuleGeometry(0.010, 0.024, 4, 8);
  geometries.push(jetGeo);
  jet.add(new THREE.Mesh(jetGeo, strokeMat));
  attach(TRUNK, jet, v(-0.046, 0, 0.008), new THREE.Quaternion().setFromUnitVectors(UP_Y, v(0, 0, 1)));

  const flameGeo = new THREE.ConeGeometry(0.009, 0.026, 10);
  geometries.push(flameGeo);
  const flame = new THREE.Mesh(flameGeo, flameMat);
  flame.name = 'flame';
  // Cone points +Y by default; aim it down.
  attach(TRUNK, flame, v(-0.046, 0, -0.020), new THREE.Quaternion().setFromUnitVectors(UP_Y, v(0, 0, -1)));

  // Tail: a flat paddle that sways off gait phase. Decorative, not a joint.
  const tail = new THREE.Group();
  tail.name = 'tail';
  attach(TRUNK, tail, v(-0.040, 0, -0.014));
  const tailGeo = new THREE.SphereGeometry(1, 12, 8);
  geometries.push(tailGeo);
  const tailBlade = new THREE.Mesh(tailGeo, strokeMat);
  tailBlade.scale.set(0.030, 0.017, 0.007);
  tailBlade.position.set(-0.026, 0, -0.004);
  tail.add(tailBlade);

  // --- Neck: drawn straight and centred, though the real linkage zigzags
  // sideways around its servos. This is styling over a mechanism. ---
  const neckGeo = new THREE.CapsuleGeometry(0.013, 0.050, 4, 10);
  geometries.push(neckGeo);
  const neck = new THREE.Mesh(neckGeo, bodyMat);
  attach(NECK, neck, v(0.008, 0, 0.070), new THREE.Quaternion().setFromUnitVectors(UP_Y, v(0, 0, 1)));

  // --- Head, at jaw_soft: 11.3 cm above the trunk on the real robot. ---
  const headAt = home[HEAD].pos.clone();
  blob(HEAD, bodyMat, headAt.clone().add(v(-0.002, 0, 0.002)), [0.027, 0.024, 0.023]);

  // Bill: a platypus has one, which is most of why this transfer works.
  const bill = new THREE.Group();
  bill.name = 'bill';
  attach(HEAD, bill, headAt.clone().add(v(0.026, 0, -0.005)));
  const upperGeo = new THREE.SphereGeometry(1, 14, 10);
  geometries.push(upperGeo);
  const upper = new THREE.Mesh(upperGeo, billMat);
  upper.scale.set(0.025, 0.018, 0.006);
  bill.add(upper);

  const lowerBill = new THREE.Group();
  lowerBill.name = 'lowerBill';
  const lowerGeo = new THREE.SphereGeometry(1, 14, 10);
  geometries.push(lowerGeo);
  const lower = new THREE.Mesh(lowerGeo, billMat);
  lower.scale.set(0.022, 0.016, 0.005);
  lower.position.set(0.002, 0, -0.008);
  lowerBill.add(lower);
  bill.add(lowerBill);

  // Eyes, peering out of the visor.
  for (const side of [1, -1]) {
    blob(HEAD, eyeMat, headAt.clone().add(v(0.014, 0.012 * side, 0.014)), [0.005, 0.005, 0.005]);
    blob(
      HEAD,
      catchMat,
      headAt.clone().add(v(0.018, 0.014 * side, 0.017)),
      [0.0018, 0.0018, 0.0018],
    );
  }

  // Helmet: the translucent bubble, big enough that the bill sits inside it.
  const helmetGeo = new THREE.SphereGeometry(0.040, 24, 18);
  geometries.push(helmetGeo);
  attach(HEAD, new THREE.Mesh(helmetGeo, helmetMat), headAt.clone().add(v(0.004, 0, 0.004)));
  // The collar where the helmet meets the suit. In 2D this is the helmet's
  // stroke; in 3D a ring around the head's equator reads as a belt, so it
  // belongs at the base instead.
  const rimGeo = new THREE.TorusGeometry(0.0335, 0.0022, 8, 30);
  geometries.push(rimGeo);
  attach(HEAD, new THREE.Mesh(rimGeo, rimMat), headAt.clone().add(v(0.004, 0, -0.021)));

  // A glint arc high on the visor, the 2D mascot's highlight.
  const glintGeo = new THREE.TorusGeometry(0.0335, 0.0013, 6, 24, Math.PI / 2.4);
  geometries.push(glintGeo);
  attach(
    HEAD,
    new THREE.Mesh(glintGeo, rimMat),
    headAt.clone().add(v(0.004, 0, 0.004)),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, Math.PI / 1.6)),
  );

  // --- Legs: one capsule per bone, straight off the tree. ---
  for (const chain of [
    ['yaw2roll', 'hip_l', 'upper_leg_left', 'leg', 'ankle_left'],
    ['bearing_roll', 'hip_l_2', 'upper_leg_right', 'leg_2', 'ankle_right'],
  ]) {
    const idx = chain.map(indexOf);
    bone(TRUNK, idx[0], 0.012, strokeMat); // hip yoke
    bone(idx[0], idx[1], 0.011, bodyMat);
    bone(idx[1], idx[2], 0.011, bodyMat); // thigh
    bone(idx[2], idx[3], 0.010, bodyMat); // shin
    bone(idx[3], idx[4], 0.009, bodyMat); // ankle
  }

  // Webbed feet. Sized so the sole lands on z = 0 when the trunk stands at
  // `trunkHeight` -- the ankles sit 9.5 cm below the trunk, leaving 2.5 cm.
  for (const ankleName of ['ankle_left', 'ankle_right']) {
    const ankle = indexOf(ankleName);
    const at = home[ankle].pos.clone();
    blob(ankle, billMat, v(at.x + 0.008, at.y, -tree.trunkHeight + 0.008), [0.026, 0.016, 0.008]);
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
    flame.scale.setScalar(1 + Math.sin(phase * Math.PI * 6) * 0.18);

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
      for (const g of geometries) g.dispose();
    },
  };
}

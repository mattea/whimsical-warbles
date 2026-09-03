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
  function bone(
    parent: number,
    child: number,
    radius: number,
    material: THREE.Material,
    inset = 0,
  ): void {
    // `inset` pulls the drawn segment toward the midline. The real robot stands
    // with its ankles 11.6 cm apart, which on a 25 cm body reads as a very wide
    // straddle; drawing the visible leg inboard narrows the stance without
    // touching a single joint. Skin only, like hiding the neck.
    const pull = (v: THREE.Vector3) =>
      inset === 0 ? v.clone() : v.clone().setY(v.y - Math.sign(v.y) * Math.min(inset, Math.abs(v.y)));
    const a = pull(home[parent].pos);
    const b = pull(home[child].pos);
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
  const NECK_PITCH = indexOf('neck_pitch');
  const headAt = home[HEAD].pos.clone();

  /**
   * How far inboard the visible legs are drawn. See `bone`.
   */
  const LEG_INSET = 0.014;

  // Measured off the robot's own collision geometry at the home pose, with the
  // trunk origin at zero. Every number below is placed against these rather
  // than guessed, which is what the earlier eyeballed version got wrong:
  //
  //   soles        bottom z -0.1172, x -0.020..+0.034   (0.0226 below the ankle)
  //   shin         z -0.098..-0.045
  //   hips         z -0.029..-0.008
  //   trunk body   z -0.044..+0.039
  //   head + bill  z  0.095.. 0.154, x -0.048..+0.075
  //
  // `jaw_soft` sits at z 0.1126 and the ankles at z -0.0946, so the standing
  // column is 21 cm of robot with 11 cm of it above the trunk origin.
  const SOLE_BELOW_ANKLE = 0.0226;

  // --- Torso ---------------------------------------------------------------
  //
  // Three stacked ellipsoids that overlap into one tapered body: widest at the
  // hips, narrowing to the shoulders. A platypus has no neck to speak of, so
  // this spans the entire standing column and the neck servos and thighs
  // articulate away inside it, out of sight. The joints still move exactly as
  // recorded; only what you can see changes.
  //
  // The previous version bolted a separate belly blob onto the front, which
  // read as a paunch hanging off rather than part of the animal. These three
  // share an axis and overlap by design.
  // Neighbouring radii stay within about 5 mm of each other and the spheres
  // overlap by more than half their extent, which is what makes the union read
  // as one tapered animal instead of three stacked balls.
  blob(TRUNK, bodyMat, v(0.002, 0, -0.012), [0.043, 0.041, 0.040]);
  blob(TRUNK, bodyMat, v(0.002, 0, 0.024), [0.044, 0.042, 0.043]);
  blob(TRUNK, bodyMat, v(0.000, 0, 0.056), [0.039, 0.037, 0.038]);

  // A suit indicator on the chest, in the mascot's accent colour. This is what
  // is left of the jetpack: the old pack-and-flame sat on the back where it
  // collided with the tail and read as a stray brown circle with something
  // yellow poking out of it.
  blob(TRUNK, flameMat, v(0.044, 0, 0.034), [0.005, 0.005, 0.005]);

  // Tail: wide, flat, low and angled down off the back. Placed against the
  // lower torso's rear wall (x -0.040 at that height) so it is attached rather
  // than trailing behind in mid-air.
  const tail = new THREE.Group();
  tail.name = 'tail';
  attach(
    TRUNK,
    tail,
    v(-0.034, 0, -0.024),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -0.38, 0)),
  );
  const tailGeo = new THREE.SphereGeometry(1, 14, 10);
  geometries.push(tailGeo);
  const tailBlade = new THREE.Mesh(tailGeo, strokeMat);
  tailBlade.scale.set(0.030, 0.023, 0.007);
  tailBlade.position.set(-0.026, 0, 0);
  tail.add(tailBlade);

  // --- Neck bridge ---------------------------------------------------------
  //
  // Parented to `neck_pitch` rather than the trunk, so it swings partway with
  // the head. Without it the head separates from the body during a ground pick,
  // when the neck chain folds the head down to the floor and the torso does not
  // follow. It cannot close the gap completely -- a rigid capsule is not a
  // deforming neck -- but it turns a detached head into a stretched one.
  const neckGeo = new THREE.CapsuleGeometry(0.023, 0.030, 4, 10);
  geometries.push(neckGeo);
  attach(
    NECK_PITCH,
    new THREE.Mesh(neckGeo, bodyMat),
    v(-0.002, 0, 0.090),
    new THREE.Quaternion().setFromUnitVectors(UP_Y, v(0, 0, 1)),
  );

  // --- Head ----------------------------------------------------------------
  blob(HEAD, bodyMat, headAt.clone(), [0.030, 0.028, 0.027]);

  // Bill: a platypus has one, which is most of why this transfer works. The
  // real bill reaches x +0.075; this stops at +0.045 so the helmet can contain
  // it without swallowing the torso.
  const bill = new THREE.Group();
  bill.name = 'bill';
  attach(HEAD, bill, headAt.clone().add(v(0.030, 0, -0.008)));
  const upperGeo = new THREE.SphereGeometry(1, 14, 10);
  geometries.push(upperGeo);
  const upper = new THREE.Mesh(upperGeo, billMat);
  upper.scale.set(0.024, 0.019, 0.0055);
  bill.add(upper);

  const lowerBill = new THREE.Group();
  lowerBill.name = 'lowerBill';
  const lowerGeo = new THREE.SphereGeometry(1, 14, 10);
  geometries.push(lowerGeo);
  const lower = new THREE.Mesh(lowerGeo, billMat);
  lower.scale.set(0.021, 0.017, 0.005);
  lower.position.set(0.002, 0, -0.007);
  lowerBill.add(lower);
  bill.add(lowerBill);

  // Eyes, peering out of the visor.
  for (const side of [1, -1]) {
    blob(HEAD, eyeMat, headAt.clone().add(v(0.016, 0.015 * side, 0.012)), [0.005, 0.005, 0.005]);
    blob(
      HEAD,
      catchMat,
      headAt.clone().add(v(0.020, 0.017 * side, 0.015)),
      [0.0018, 0.0018, 0.0018],
    );
  }

  // Helmet: sized to contain the bill, which is what the 2D mascot does -- the
  // bill sits inside the visor rather than poking through it. Radius 0.046
  // about a centre 0.010 forward of the head puts the front of the bubble at
  // x +0.047, just clear of the bill tip at +0.045.
  const HELMET_R = 0.046;
  const helmetAt = headAt.clone().add(v(0.010, 0, 0.005));
  const helmetGeo = new THREE.SphereGeometry(HELMET_R, 24, 18);
  geometries.push(helmetGeo);
  attach(HEAD, new THREE.Mesh(helmetGeo, helmetMat), helmetAt);

  // The collar where the helmet meets the suit. Its radius is solved from the
  // sphere rather than picked, so the ring sits exactly on the helmet at the
  // height it passes into the torso -- which is also what hides that junction.
  const COLLAR_DROP = 0.039;
  const collarR = Math.sqrt(Math.max(0, HELMET_R * HELMET_R - COLLAR_DROP * COLLAR_DROP));
  const rimGeo = new THREE.TorusGeometry(collarR, 0.0018, 8, 30);
  geometries.push(rimGeo);
  attach(HEAD, new THREE.Mesh(rimGeo, rimMat), helmetAt.clone().add(v(0, 0, -COLLAR_DROP)));

  // A glint arc high on the visor, the 2D mascot's highlight.
  const glintGeo = new THREE.TorusGeometry(HELMET_R * 0.86, 0.0013, 6, 24, Math.PI / 2.4);
  geometries.push(glintGeo);
  attach(
    HEAD,
    new THREE.Mesh(glintGeo, rimMat),
    helmetAt,
    new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, Math.PI / 1.6)),
  );

  // --- Legs ----------------------------------------------------------------
  //
  // Thigh and shin are both drawn, pulled inboard, with the thigh sitting
  // inside the torso so the leg reads as emerging from the body rather than
  // floating below it. Only the shin and foot are really visible, which is what
  // gives a platypus its stubby-legged stance.
  for (const [thigh, knee, ankle] of [
    ['upper_leg_left', 'leg', 'ankle_left'],
    ['upper_leg_right', 'leg_2', 'ankle_right'],
  ]) {
    bone(indexOf(thigh), indexOf(knee), 0.014, bodyMat, LEG_INSET);
    bone(indexOf(knee), indexOf(ankle), 0.013, bodyMat, LEG_INSET);
  }

  // Webbed feet. The sole sits exactly the measured 22.6 mm below the ankle, so
  // the feet meet the floor in every pose rather than only the standing one --
  // guessing this a few millimetres deep is what put them through the floor
  // while seated.
  const FOOT_HALF_HEIGHT = 0.008;
  for (const ankleName of ['ankle_left', 'ankle_right']) {
    const ankle = indexOf(ankleName);
    const at = home[ankle].pos.clone();
    const y = at.y - Math.sign(at.y) * LEG_INSET;
    blob(
      ankle,
      billMat,
      v(at.x + 0.007, y, at.z - SOLE_BELOW_ANKLE + FOOT_HALF_HEIGHT),
      [0.028, 0.017, FOOT_HALF_HEIGHT],
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

    // Decorative: the tail sways with the gait. Labelled as decoration because
    // it is not policy output -- the robot has no tail joint.
    tail.rotation.z = Math.sin(phase * Math.PI * 2) * 0.20;

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

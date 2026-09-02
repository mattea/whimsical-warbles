/**
 * Forward kinematics for the Microduck tree.
 *
 * Every joint's axis in the MJCF is local Z -- onshape-to-robot bakes each
 * joint's orientation into its body quaternion instead. So a body's local
 * rotation is `body.quat * Rz(angle)`, in that order.
 *
 * The trunk is placed at the origin with identity rotation. It carries a
 * freejoint, so MuJoCo takes its world pose from `qpos` rather than from
 * `body_pos`; callers compose the live root transform themselves.
 *
 * Verified against MuJoCo's own `mj_kinematics` output by `fk.test.ts`.
 */

import { JOINT_COUNT, type DuckTree, type Quat, type Vec3 } from './tree';

export interface BodyTransform {
  pos: Vec3;
  quat: Quat;
}

export function quatMul(a: Quat, b: Quat): Quat {
  const [aw, ax, ay, az] = a;
  const [bw, bx, by, bz] = b;
  return [
    aw * bw - ax * bx - ay * by - az * bz,
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
  ];
}

export function quatRotate(q: Quat, v: Vec3): Vec3 {
  const [w, x, y, z] = q;
  // t = 2 * (q_vec x v)
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  return [
    v[0] + w * tx + (y * tz - z * ty),
    v[1] + w * ty + (z * tx - x * tz),
    v[2] + w * tz + (x * ty - y * tx),
  ];
}

/** Rotation of `angle` radians about local Z. */
export function quatFromAxisZ(angle: number): Quat {
  const h = angle / 2;
  return [Math.cos(h), 0, 0, Math.sin(h)];
}

/**
 * World transforms for every body, given the 14 joint angles, with the trunk
 * at the origin.
 */
export function forwardKinematics(
  tree: DuckTree,
  joints: ArrayLike<number>,
): BodyTransform[] {
  if (joints.length !== JOINT_COUNT) {
    throw new Error(`expected ${JOINT_COUNT} joint angles, got ${joints.length}`);
  }

  const out: BodyTransform[] = [];
  for (const body of tree.bodies) {
    let localQuat = body.quat;
    if (body.jointIndex >= 0) {
      localQuat = quatMul(localQuat, quatFromAxisZ(joints[body.jointIndex]));
    }

    if (body.parent < 0) {
      // Freejoint body: the root transform is the caller's, not body.pos.
      out.push({ pos: [0, 0, 0], quat: [1, 0, 0, 0] });
      continue;
    }

    const parent = out[body.parent];
    const offset = quatRotate(parent.quat, body.pos);
    out.push({
      pos: [
        parent.pos[0] + offset[0],
        parent.pos[1] + offset[1],
        parent.pos[2] + offset[2],
      ],
      quat: quatMul(parent.quat, localQuat),
    });
  }
  return out;
}

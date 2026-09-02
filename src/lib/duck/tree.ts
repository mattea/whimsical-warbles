/**
 * The Microduck kinematic tree, as data.
 *
 * Every number here is emitted by `scripts/bake-duck-motion.py` from
 * microduck_rl's `robot_walk.xml` -- never hand-written. A wrong offset does
 * not fail loudly, it produces a plausible pugglenaut that walks wrong.
 */

export type Vec3 = [number, number, number];
/** MuJoCo order: w, x, y, z. */
export type Quat = [number, number, number, number];

/** Joints a policy drives. The mouth is not one of them. */
export const JOINT_COUNT = 14;

export interface DuckBody {
  name: string;
  /** Index into `DuckTree.bodies`, or -1 for the trunk. Always < own index. */
  parent: number;
  pos: Vec3;
  quat: Quat;
  /** Policy action slot 0-13, or -1 if this body carries no joint. */
  jointIndex: number;
}

export interface DuckTree {
  jointNames: string[];
  homePose: number[];
  jointLimits: [number, number][];
  bodies: DuckBody[];
  /**
   * Nominal standing height of the trunk, metres.
   *
   * Not a fixed offset: the trunk carries a freejoint, so its world pose comes
   * from the root transform, not from `bodies[0].pos`. This is the height the
   * playback backend parks it at.
   */
  trunkHeight: number;
  controlDt: number;
  actionScale: number;
}

export function loadTree(json: unknown): DuckTree {
  const t = json as DuckTree;
  if (t.jointNames.length !== JOINT_COUNT) {
    throw new Error(`tree has ${t.jointNames.length} joints, expected ${JOINT_COUNT}`);
  }
  return t;
}

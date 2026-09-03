/**
 * The 61-slot observation the Microduck policies see, and the joint targets
 * their output becomes.
 *
 * This is the highest-risk file in the duck code, for the reason
 * `microduck/duck-control/src/obs.rs` states about its own copy: it is a flat
 * array whose every index must match what the policy was trained against, and
 * a wrong offset does not fail loudly. It produces a plausible-looking robot
 * that falls over, and the symptom reads as a tuning or timing problem rather
 * than an indexing one. So the layout is written out index by index below,
 * mirrors the upstream table line for line, and is pinned from both ends: by
 * `observation.test.ts`'s offset assertions and by `obs-golden.json`, which is
 * this vector as computed in Python by `scripts/bake-duck-motion.py`.
 *
 * ```text
 * index   width  contents
 * 0..3        3  gyro, trunk frame, rad/s
 * 3..6        3  projected gravity, trunk frame, unit vector
 * 6..20      14  joint position minus home pose
 * 20..34     14  joint velocity
 * 34..48     14  previous action, raw policy output before scaling
 * 48..51      3  twist: vx, vy, vyaw
 * 51..55      4  head: neck_pitch, head_pitch, head_yaw, head_roll
 * 55..57      2  body x, y   -- always zero, unbound in training
 * 57          1  body z
 * 58          1  body roll
 * 59          1  body pitch
 * 60          1  body yaw    -- always zero, unbound in training
 * ```
 *
 * Three things upstream flags as easy to get wrong, kept here for the same
 * reason it keeps them:
 *
 * 1. Body x, y and yaw are hardcoded zero. They are unbound in the training
 *    environment, so an all-zero body command is the *nominal* encoding, not a
 *    placeholder standing in for something better.
 * 2. Head targets ride in the command block. They are not added on top of the
 *    policy output as well -- doing both bends the head twice.
 * 3. The body block is ordered `z, roll, pitch`, not `z, pitch, roll`.
 *
 * One difference from upstream worth stating, because it is the kind of thing
 * that becomes an off-by-one: `obs.rs` works over the robot's 15 joints and
 * skips the mouth at index 9 on the way in and out. Everything on this side --
 * `tree.json`, `DuckState.joints`, these functions -- is already 14 wide and in
 * policy order, because `bake-duck-motion.py` dropped the mouth when it emitted
 * the tree. So there is no mouth to skip here, and no `joint_of` mapping.
 * Nothing in this file may be handed a 15-wide array.
 */

import type { BodyPose, HeadPose, Twist } from './link';
import { JOINT_COUNT, type Vec3 } from './tree';

/** Total width of the observation. Every alpha policy is `obs[1,61]`. */
export const OBS_LEN = 61;

/** Actions a policy returns: the robot's 15 joints minus the mouth. */
export const ACTION_LEN = JOINT_COUNT;

/**
 * Where each block starts. Exported so a caller reading telemetry out of a
 * raw observation cannot disagree with the writer about the offsets.
 */
export const OBS_OFFSET = {
  gyro: 0,
  gravity: 3,
  jointPos: 6,
  jointVel: 20,
  prevAction: 34,
  twist: 48,
  head: 51,
  body: 55,
} as const;

/**
 * Scales raw policy output before it becomes a joint offset.
 * `robotd/src/control.rs`, `Tuning::default`: `action_scale: 0.9`.
 */
export const WALKING_ACTION_SCALE = 0.9;

/**
 * The standing policy is trained to be applied whole.
 * `robotd/src/control.rs`, `Tuning::default`: `standing_action_scale: 1.0`.
 */
export const STANDING_ACTION_SCALE = 1.0;

/**
 * Below this velocity magnitude the standing policy takes over, and with it the
 * standing action scale. `duck-control/src/policy.rs`,
 * `DEFAULT_STANDING_THRESHOLD`.
 */
export const STANDING_THRESHOLD = 0.05;

/**
 * What the robot senses, in the frames the observation wants it.
 *
 * `jointPos` is absolute; the policy sees it relative to the home pose, because
 * that is what it was trained on. `prevAction` is the previous *policy output*,
 * raw, before action scaling.
 */
export interface ObservationInput {
  /** Angular velocity, trunk frame, rad/s. */
  gyro: Vec3 | ArrayLike<number>;
  /** Projected gravity, trunk frame, unit vector. */
  gravity: Vec3 | ArrayLike<number>;
  /** 14 absolute joint angles, radians, policy order. */
  jointPos: ArrayLike<number>;
  /** 14 joint velocities, rad/s, policy order. */
  jointVel: ArrayLike<number>;
  /** The previous 14 policy outputs, unscaled. */
  prevAction: ArrayLike<number>;
  twist: Twist;
  head: HeadPose;
  /** Standing body pose offsets. Zero is the nominal stance. */
  body?: BodyPose;
}

/**
 * Reject a block whose width is wrong, rather than filling its tail with zeros.
 *
 * Upstream gets this from the type system: its blocks are fixed-size arrays, so
 * a mismatch does not compile. TypeScript cannot check the length of an
 * `ArrayLike`, so the same guarantee has to be bought at runtime. It is worth
 * buying. A short source would leave the tail at zero, and a zero in the joint
 * position block is a joint sitting exactly at its home pose -- the policy would
 * then act on a plausible robot that does not exist.
 */
function checkWidth(name: string, values: ArrayLike<number>, expected: number): void {
  if (values.length !== expected) {
    throw new Error(`${name} has ${values.length} values, expected ${expected}`);
  }
}

/**
 * Assemble the observation.
 *
 * Pass `out` to reuse a buffer: this runs 50 times a second on the control
 * clock, and that path should not be visiting the allocator.
 *
 * Written as `Float32Array` because that is what the policy is fed -- the ONNX
 * graph declares `float32`, so rounding to single precision happens either way,
 * and doing it here means the value a test compares is the value the policy saw.
 */
export function buildObservation(
  input: ObservationInput,
  homePose: ArrayLike<number>,
  out?: Float32Array,
): Float32Array {
  checkWidth('gyro', input.gyro, 3);
  checkWidth('gravity', input.gravity, 3);
  checkWidth('jointPos', input.jointPos, ACTION_LEN);
  checkWidth('jointVel', input.jointVel, ACTION_LEN);
  checkWidth('prevAction', input.prevAction, ACTION_LEN);
  checkWidth('homePose', homePose, ACTION_LEN);

  const obs = out ?? new Float32Array(OBS_LEN);
  if (obs.length !== OBS_LEN) {
    throw new Error(`output buffer is ${obs.length} wide, expected ${OBS_LEN}`);
  }

  for (let i = 0; i < 3; i++) {
    obs[OBS_OFFSET.gyro + i] = input.gyro[i];
    obs[OBS_OFFSET.gravity + i] = input.gravity[i];
  }
  for (let i = 0; i < ACTION_LEN; i++) {
    obs[OBS_OFFSET.jointPos + i] = input.jointPos[i] - homePose[i];
    obs[OBS_OFFSET.jointVel + i] = input.jointVel[i];
    obs[OBS_OFFSET.prevAction + i] = input.prevAction[i];
  }

  // Written in one literal, in the table's order, because this block is the one
  // with no second source of truth: it should be checkable against the docs by
  // eye. The three zeros are the unbound axes, not gaps waiting to be filled.
  const body = input.body ?? { z: 0, roll: 0, pitch: 0 };
  const command = [
    input.twist.vx,
    input.twist.vy,
    input.twist.vyaw,
    input.head.neck,
    input.head.pitch,
    input.head.yaw,
    input.head.roll,
    0, // body x -- unbound in training
    0, // body y -- unbound
    body.z,
    body.roll,
    body.pitch,
    0, // body yaw -- unbound
  ];
  for (let i = 0; i < command.length; i++) obs[OBS_OFFSET.twist + i] = command[i];

  return obs;
}

/**
 * The joint angles a policy output asks for.
 *
 * `robotd/src/control.rs` is five lines and this is the one that matters:
 * `targets[joint] = DEFAULT_POSITION[joint] + scale * offsets[joint]`. The
 * policy emits offsets from the home pose, never absolute angles, which is why
 * feeding its output straight to a renderer produces a robot folded in half.
 *
 * The low-pass filters upstream applies afterwards (0.5 on the head, 0.7 on the
 * legs, both trained values) are not here: they are a property of the control
 * loop that owns the previous target, not of one step, so they belong to
 * whatever drives this.
 */
export function jointTargets(
  action: ArrayLike<number>,
  homePose: ArrayLike<number>,
  actionScale: number,
  out?: Float32Array,
): Float32Array {
  checkWidth('action', action, ACTION_LEN);
  checkWidth('homePose', homePose, ACTION_LEN);

  const targets = out ?? new Float32Array(ACTION_LEN);
  if (targets.length !== ACTION_LEN) {
    throw new Error(`output buffer is ${targets.length} wide, expected ${ACTION_LEN}`);
  }
  for (let i = 0; i < ACTION_LEN; i++) {
    targets[i] = homePose[i] + actionScale * action[i];
  }
  return targets;
}

/**
 * Magnitude of the velocity command, which is what selects walking versus
 * standing.
 *
 * The twist alone, deliberately: head and body movement must not make the robot
 * think it is walking. `Command::twist_magnitude` in `obs.rs`.
 */
export function twistMagnitude(twist: Twist): number {
  return Math.hypot(twist.vx, twist.vy, twist.vyaw);
}

/**
 * Which action scale a twist selects.
 *
 * Separate from picking the network because upstream needs the same answer for
 * both and asking twice must not be able to disagree -- see `will_stand` in
 * `duck-control/src/policy.rs`, which exists for exactly that reason.
 */
export function actionScaleFor(twist: Twist): number {
  return twistMagnitude(twist) <= STANDING_THRESHOLD
    ? STANDING_ACTION_SCALE
    : WALKING_ACTION_SCALE;
}

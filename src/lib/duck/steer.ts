/**
 * Walking to a spot on the floor.
 *
 * Tapping where you want the pugglenaut to go is a much better fit for a phone
 * than four arrow buttons, and in AR it is the only control that does not
 * involve covering the thing you are looking at with your thumb.
 *
 * The controller is deliberately bang-bang rather than proportional, and that
 * is not laziness. The shipped walking policy has a dead zone: it holds its
 * stance below roughly `vx` 0.25 and will not turn at all below about `vyaw`
 * 1.5. A proportional law would spend the entire approach issuing commands
 * inside that dead zone, and the robot would stand still while the controller
 * insisted it was steering. So the commands are either off or past the
 * threshold, and the *duration* rather than the magnitude does the regulating.
 */

import type { Twist } from './link';
import type { Vec3 } from './tree';

/** Within this of the target, it has arrived. */
export const ARRIVE_RADIUS = 0.07;

/**
 * Slow down inside this radius, so it does not overshoot and turn back.
 * Still above the policy's threshold -- below that it would simply stop.
 */
export const APPROACH_RADIUS = 0.28;

/** Heading error above which it turns instead of walking. */
export const TURN_FIRST = 0.55;

/** Heading error below which it stops correcting. Inside the policy's deadband. */
export const HEADING_DEADBAND = 0.12;

const DRIVE_FAST = 0.4;
const DRIVE_SLOW = 0.25;
const TURN_RATE = 2.0;

/** Shortest signed angle from `a` to `b`, in radians. */
export function angleDelta(a: number, b: number): number {
  return Math.atan2(Math.sin(b - a), Math.cos(b - a));
}

/** Heading, in radians, from a yaw-only quaternion. */
export function yawOf(quat: readonly number[]): number {
  const [w, x, y, z] = quat;
  return Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
}

export interface SteerResult {
  twist: Twist;
  /** True once it is close enough that the target should be dropped. */
  arrived: boolean;
  /** Metres still to go, for a UI that wants to say. */
  distance: number;
}

/**
 * The command that walks `from` (facing `yaw`) towards `target`.
 *
 * Turns in place while badly misaligned, then walks, easing off near the end.
 * Only the x and y of `target` matter; the floor is the floor.
 */
export function steerToward(from: Vec3, yaw: number, target: Vec3): SteerResult {
  const dx = target[0] - from[0];
  const dy = target[1] - from[1];
  const distance = Math.hypot(dx, dy);

  if (distance <= ARRIVE_RADIUS) {
    return { twist: { vx: 0, vy: 0, vyaw: 0 }, arrived: true, distance };
  }

  const error = angleDelta(yaw, Math.atan2(dy, dx));
  const magnitude = Math.abs(error);

  // Past the deadband, turn at the rate the policy actually responds to.
  const vyaw = magnitude > HEADING_DEADBAND ? Math.sign(error) * TURN_RATE : 0;

  // Facing far enough off, turn on the spot first. Walking through a large
  // heading error traces a long arc and, on a small floor, into furniture.
  const vx =
    magnitude > TURN_FIRST ? 0 : distance < APPROACH_RADIUS ? DRIVE_SLOW : DRIVE_FAST;

  return { twist: { vx, vy: 0, vyaw }, arrived: false, distance };
}

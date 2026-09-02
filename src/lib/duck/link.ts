/**
 * The one contract between the console and whatever is moving the pugglenaut.
 *
 * Named after the methods Microduck's own WebRTC console permits over its
 * datachannel (`microduck/docs/design/webrtc-console.md`): move, head, look,
 * pose, mouth, do, sound, enable, init, relax, stop, subscribe. Keeping that
 * vocabulary means the console written against baked clips can later drive a
 * simulation, or real hardware, unchanged.
 */

import type { Quat, Vec3 } from './tree';

export type Skill =
  | 'ground_pick'
  | 'roulade'
  | 'kick_left'
  | 'kick_right'
  | 'sit'
  | 'stand';

export interface Twist {
  /** Forward, m/s. */
  vx: number;
  /** Left, m/s. */
  vy: number;
  /** Yaw rate, rad/s. */
  vyaw: number;
}

export interface HeadPose {
  neck: number;
  pitch: number;
  yaw: number;
  roll: number;
}

export interface BodyPose {
  z: number;
  roll: number;
  pitch: number;
}

export interface DuckState {
  /** 14 absolute joint angles, radians, in policy action order. */
  joints: Float32Array;
  root: { pos: Vec3; quat: Quat };
  /** Observation slots 0..3 -- angular velocity, trunk frame, rad/s. */
  gyro: Vec3;
  /** Observation slots 3..6 -- projected gravity, trunk frame, unit vector. */
  gravity: Vec3;
  /** Which backend is driving. Surfaced in the UI rather than hidden. */
  health: 'playback' | 'live' | 'real';
  activeSkill: Skill | null;
  /** 0 closed, 1 fully open. */
  mouth: number;
}

export interface DuckLink {
  move(t: Twist): void;
  head(p: HeadPose): void;
  do(s: Skill): void;
  pose(b: BodyPose): void;
  mouth(open: number): void;
  stop(): void;
  subscribe(cb: (s: DuckState) => void): () => void;
  /** Advance one control step. The host owns the clock. */
  tick(dt: number): void;
  dispose(): void;
}

/** The robot's real control rate. */
export const CONTROL_HZ = 50;
export const CONTROL_DT = 1 / CONTROL_HZ;

/**
 * The wire between the main thread and the physics worker.
 *
 * MuJoCo's `mj_loadXML` takes about half a second on this model and one
 * control tick costs roughly 0.7 ms, so the simulation cannot live on the
 * thread that also has to render at 90 Hz. It lives in a worker, and this file
 * is the only thing both sides are allowed to know about each other. Keeping
 * the types here rather than in either implementation is what makes the
 * protocol testable without a worker, a wasm binary, or a browser.
 *
 * Two conventions worth stating up front, because both are load-bearing:
 *
 * 1. **State is a flat `Float32Array`, not an object.** It is posted 50 times a
 *    second. A structured clone of a nested object with three arrays in it
 *    would allocate on both sides of every tick; one typed array transfers with
 *    no copy at all. The layout is written out field by field in `STATE_SLOT`
 *    and pinned by a round-trip test, for the same reason `observation.ts`
 *    writes its own layout out: a flat array with a wrong offset does not fail
 *    loudly.
 * 2. **Buffers come back.** A transferred buffer is gone from the sender, so
 *    the receiver posts it back with `recycle` and the worker reuses it. If one
 *    is late the worker allocates a fresh one rather than skipping the frame --
 *    a dropped buffer must never be able to stall the simulation permanently.
 */

import type { BodyPose, HeadPose, Skill, Twist } from './link';

/**
 * Which trained network is driving.
 *
 * These are the slots in `public/duck/policies/manifest.json`, which are the
 * ONNX files Microduck ships. Note that `'stand'` here is the standing *balance*
 * policy -- the one that holds a stance and rights a fallen robot -- while the
 * `'stand'` member of `Skill` means "get up off the seat", which is the
 * `'sitstand'` policy run with a zero command. Upstream names them that way and
 * renaming on this side would only make the two harder to reconcile.
 */
export type PolicySlot =
  | 'walk'
  | 'stand'
  | 'sitstand'
  | 'ground_pick'
  | 'kick_left'
  | 'kick_right'
  | 'roulade';

/** Every slot, in manifest order. Exported so callers can iterate exhaustively. */
export const POLICY_SLOTS: PolicySlot[] = [
  'walk',
  'stand',
  'sitstand',
  'ground_pick',
  'kick_left',
  'kick_right',
  'roulade',
];

/**
 * The MJCF and its meshes, as bytes, ready to be written into the worker's
 * in-memory filesystem.
 *
 * Fetched on the main thread rather than in the worker so the console can show
 * one progress state for the whole download, and so the worker has no opinion
 * about URLs or base paths.
 *
 * `files` is keyed by path relative to the sim root, forward slashes, no
 * leading slash -- `'scene.xml'`, `'assets/sole_left.msh'`. The MJCF references
 * its meshes by relative filename, so that layout has to be mirrored exactly
 * inside MEMFS or the load fails on a missing asset.
 */
export interface SimAssets {
  /** Key in `files` of the scene to load. */
  entry: string;
  files: Record<string, ArrayBuffer>;
}

/** Skill codes, so an active skill survives the trip as one float. */
export const SKILL_CODES: Skill[] = [
  'ground_pick',
  'roulade',
  'kick_left',
  'kick_right',
  'sit',
  'stand',
];

/** Skill to its wire code, or -1 for "no skill running". */
export function skillCode(skill: Skill | null): number {
  return skill === null ? -1 : SKILL_CODES.indexOf(skill);
}

/** Inverse of `skillCode`. Anything unrecognised reads as no skill. */
export function skillFromCode(code: number): Skill | null {
  return SKILL_CODES[code] ?? null;
}

/**
 * Where each value sits in the state frame.
 *
 * Named rather than positional because the encoder and the decoder are in
 * different files on different threads, and nothing but this table stops them
 * disagreeing.
 */
export const STATE_SLOT = {
  /** 14 absolute joint angles, radians, policy order -- `data.qpos[7..21]`. */
  joints: 0,
  /** Trunk world position, metres -- `data.qpos[0..3]`. */
  pos: 14,
  /** Trunk orientation, MuJoCo w,x,y,z -- `data.qpos[3..7]`. */
  quat: 17,
  /** Trunk angular velocity, rad/s -- `data.qvel[3..6]`. */
  gyro: 21,
  /** Projected gravity in the trunk frame, unit vector. */
  gravity: 24,
  /** Bill opening, 0..1. Not a policy joint; passed straight through. */
  mouth: 27,
  /** 1 while holding the seat. */
  seated: 28,
  /** `skillCode` of the running skill, or -1. */
  skill: 29,
  /** 1 while the fall monitor has taken the controls. */
  recovering: 30,
  /** Control ticks actually achieved per second, measured over a window. */
  controlHz: 31,
  /** Simulated seconds per wall-clock second. 1 is real time. */
  realtime: 32,
} as const;

/** Width of one state frame, in float32s. */
export const STATE_FRAME_LEN = 33;

/** Everything one state frame carries, unpacked. */
export interface SimStateFields {
  joints: ArrayLike<number>;
  pos: ArrayLike<number>;
  quat: ArrayLike<number>;
  gyro: ArrayLike<number>;
  gravity: ArrayLike<number>;
  mouth: number;
  seated: boolean;
  skill: Skill | null;
  recovering: boolean;
  controlHz: number;
  realtime: number;
}

/** The subset of a frame that has nowhere to live in `DuckState`. */
export interface SimTelemetry {
  recovering: boolean;
  controlHz: number;
  realtime: number;
}

/**
 * Pack a frame. Writes into `frame` and returns it, so the hot path can hand
 * in a pooled buffer.
 */
export function encodeStateFrame(frame: Float32Array, s: SimStateFields): Float32Array {
  if (frame.length !== STATE_FRAME_LEN) {
    throw new Error(`state frame is ${frame.length} wide, expected ${STATE_FRAME_LEN}`);
  }
  for (let i = 0; i < 14; i++) frame[STATE_SLOT.joints + i] = s.joints[i];
  for (let i = 0; i < 3; i++) {
    frame[STATE_SLOT.pos + i] = s.pos[i];
    frame[STATE_SLOT.gyro + i] = s.gyro[i];
    frame[STATE_SLOT.gravity + i] = s.gravity[i];
  }
  for (let i = 0; i < 4; i++) frame[STATE_SLOT.quat + i] = s.quat[i];
  frame[STATE_SLOT.mouth] = s.mouth;
  frame[STATE_SLOT.seated] = s.seated ? 1 : 0;
  frame[STATE_SLOT.skill] = skillCode(s.skill);
  frame[STATE_SLOT.recovering] = s.recovering ? 1 : 0;
  frame[STATE_SLOT.controlHz] = s.controlHz;
  frame[STATE_SLOT.realtime] = s.realtime;
  return frame;
}

/**
 * Unpack a frame into caller-owned arrays.
 *
 * Takes the destination arrays rather than allocating, because the main thread
 * reuses one `DuckState` across every tick and copying into it is the whole
 * point of doing this with a flat buffer.
 */
export function decodeStateFrame(
  frame: Float32Array,
  into: {
    joints: Float32Array;
    pos: number[];
    quat: number[];
    gyro: number[];
    gravity: number[];
  },
): { mouth: number; seated: boolean; skill: Skill | null } & SimTelemetry {
  if (frame.length !== STATE_FRAME_LEN) {
    throw new Error(`state frame is ${frame.length} wide, expected ${STATE_FRAME_LEN}`);
  }
  for (let i = 0; i < 14; i++) into.joints[i] = frame[STATE_SLOT.joints + i];
  for (let i = 0; i < 3; i++) {
    into.pos[i] = frame[STATE_SLOT.pos + i];
    into.gyro[i] = frame[STATE_SLOT.gyro + i];
    into.gravity[i] = frame[STATE_SLOT.gravity + i];
  }
  for (let i = 0; i < 4; i++) into.quat[i] = frame[STATE_SLOT.quat + i];
  return {
    mouth: frame[STATE_SLOT.mouth],
    seated: frame[STATE_SLOT.seated] !== 0,
    skill: skillFromCode(frame[STATE_SLOT.skill]),
    recovering: frame[STATE_SLOT.recovering] !== 0,
    controlHz: frame[STATE_SLOT.controlHz],
    realtime: frame[STATE_SLOT.realtime],
  };
}

/** Main thread to worker. */
export type SimRequest =
  | {
      type: 'init';
      assets: SimAssets;
      /** Policy blobs to decode before reporting ready. `walk` and `stand`. */
      weights: Partial<Record<PolicySlot, ArrayBuffer>>;
      /** 14 home-pose angles from `tree.json`. */
      homePose: number[];
    }
  | { type: 'command'; twist: Twist; head: HeadPose; body: BodyPose; mouth: number }
  | { type: 'do'; skill: Skill }
  | { type: 'loadPolicy'; slot: PolicySlot; weights: ArrayBuffer }
  /** Add a velocity impulse to the trunk's free joint, in world axes. */
  | { type: 'push'; impulse: [number, number, number] }
  | { type: 'reset' }
  /**
   * Stop or restart the control clock.
   *
   * The console powers down as well as up, and a paused simulation has to
   * actually stop: this site's rule is that nothing animated runs unless it
   * was asked for, and 50 Hz of physics behind a still poster would break it.
   */
  | { type: 'pause'; paused: boolean }
  | { type: 'recycle'; buffer: ArrayBuffer }
  | { type: 'dispose' };

/** Worker to main thread. */
export type SimResponse =
  | { type: 'ready'; engine: string; loadMs: number; slots: PolicySlot[] }
  | { type: 'state'; buffer: ArrayBuffer }
  | { type: 'policyLoaded'; slot: PolicySlot }
  /** `fatal` means the simulation has stopped and will not restart. */
  | { type: 'error'; message: string; fatal: boolean };

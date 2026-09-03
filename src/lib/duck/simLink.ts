/**
 * `DuckLink` backed by real physics.
 *
 * The pugglenaut on the other side of this object is not replaying anything.
 * MuJoCo is integrating the actual Microduck model at 0.002 s, the shipped
 * policies are choosing its joint targets fifty times a second, and the floor
 * is a real contact surface. So it can be pushed over -- and it can get back
 * up, which the playback backend cannot do by construction.
 *
 * Everything expensive happens in `simWorker.ts`. This side is a mailbox: it
 * posts commands, keeps the last state frame the worker sent, and hands that
 * frame to whoever subscribed. `tick` is deliberately a no-op, because the
 * worker owns the control clock -- a simulation cannot be driven from a
 * `requestAnimationFrame` callback that stops when the tab is hidden and then
 * arrives with a second of backlog.
 *
 * The two extra affordances the simulation makes possible -- `push` and
 * `reset` -- are extra methods on the returned object rather than additions to
 * `DuckLink`. The interface is the contract the console shares with the
 * playback and (eventually) hardware backends, and neither of those can honour
 * a boop.
 */

import {
  type BodyPose,
  type DuckLink,
  type DuckState,
  type HeadPose,
  type Skill,
  type Twist,
} from './link';
import { SKILL_POLICY } from './simControl';
import {
  decodeStateFrame,
  STATE_FRAME_LEN,
  type PolicySlot,
  type SimAssets,
  type SimRequest,
  type SimResponse,
  type SimTelemetry,
} from './simProtocol';
import { JOINT_COUNT, type Quat, type Vec3 } from './tree';

/**
 * The slice of `Worker` this link uses.
 *
 * Narrowed so the tests can drive a plain object: standing up a real worker in
 * vitest would mean standing up wasm in vitest, and then the tests would be
 * testing MuJoCo rather than this file.
 */
export interface SimWorkerLike {
  postMessage(message: SimRequest, transfer?: Transferable[]): void;
  addEventListener(type: 'message', listener: (event: { data: SimResponse }) => void): void;
  terminate(): void;
}

/**
 * A worker's `error` event, which the interface above deliberately does not
 * describe.
 *
 * It has to be listened for: a worker that fails to *load* -- a bad URL, a
 * syntax error, a module import the browser refuses -- never sends a message,
 * so the ready promise would hang forever with the button stuck on "loading".
 * But typing it as a second `addEventListener` overload would make the
 * overloads non-optional together, and then every test double would have to
 * implement an event it can never fire. So it is reached through a cast, at
 * one call site, guarded by an optional call.
 */
interface ErrorCapable {
  addEventListener?(type: 'error', listener: (event: { message?: string }) => void): void;
}

/** What the worker reports once the model is compiled and the loop is running. */
export interface SimReady {
  /** `mj_versionString()`. The npm package says 3.1.16; the engine says 3.5.1. */
  engine: string;
  /** Wall-clock milliseconds spent instantiating wasm and compiling the MJCF. */
  loadMs: number;
  slots: PolicySlot[];
}

/**
 * The default boop: 2.5 m/s straight into the trunk's free joint, along world
 * +y.
 *
 * World frame rather than body frame, and always the same direction, because
 * that is what a hand reaching in from the side of a desk does. The magnitude
 * is the one this was tuned against: it reliably puts the pugglenaut on the
 * floor without launching it across the room.
 *
 * Measured against the balance policy, which is what runs when it is standing
 * still and is much harder to topple than the walking one: 2.5 m/s takes
 * upright from +1.00 to about -0.9, and it recovers unaided.
 */
export const DEFAULT_BOOP: Vec3 = [0, 2.5, 0];

export interface SimLinkOptions {
  worker: SimWorkerLike;
  /** 14 home-pose angles, from `tree.json`. */
  homePose: number[];
  /**
   * The MJCF and its meshes. Ownership passes to the link: the buffers are
   * transferred to the worker and are detached here afterwards.
   */
  assets: SimAssets;
  /** Policies to have ready before the first tick. Normally walk and stand. */
  weights: Partial<Record<PolicySlot, ArrayBuffer>>;
  /** Fetch a policy that was not eager. Called at most once per slot. */
  fetchPolicy?: (slot: PolicySlot) => Promise<ArrayBuffer>;
  /** Non-fatal problems included. `fatal` means the simulation has stopped. */
  onError?: (message: string, fatal: boolean) => void;
}

export interface SimLink extends DuckLink {
  /** Boop the trunk over. Emergent, and not reproducible -- see `simWorker.ts`. */
  push(impulse?: Vec3): void;
  /** Back to the STAND keyframe, with the controller's state cleared. */
  reset(): void;
  /** Stop or restart the worker's control clock. Powering down means this. */
  setPaused(paused: boolean): void;
  /** Resolves when the worker has the model compiled and the loop running. */
  ready(): Promise<SimReady>;
  /** The parts of a state frame `DuckState` has nowhere to put. */
  telemetry(): SimTelemetry;
  /** Slots being fetched right now, for a "loading the roulade" hint. */
  loading(): PolicySlot[];
}

export function createSimLink(options: SimLinkOptions): SimLink {
  const { worker, onError } = options;
  const listeners = new Set<(s: DuckState) => void>();
  const fetchPolicy = options.fetchPolicy;

  // One state object, mutated in place and handed out by reference -- the same
  // contract `clipLink` has, and the reason the console copies before storing.
  const joints = new Float32Array(JOINT_COUNT);
  const pos: Vec3 = [0, 0, 0];
  const quat: Quat = [1, 0, 0, 0];
  const gyro: Vec3 = [0, 0, 0];
  const gravity: Vec3 = [0, 0, -1];
  const state: DuckState = {
    joints,
    root: { pos, quat },
    gyro,
    gravity,
    health: 'live',
    activeSkill: null,
    seated: false,
    mouth: 0,
  };
  const target = { joints, pos, quat, gyro, gravity };

  let telemetry: SimTelemetry = { recovering: false, controlHz: 0, realtime: 0 };
  /** Has any state frame arrived? Until one has, there is nothing to publish. */
  let live = false;
  let disposed = false;

  // What the console has asked for. Held here as well as in the worker so a
  // change to any one field can be posted as a whole `command`.
  let twist: Twist = { vx: 0, vy: 0, vyaw: 0 };
  let head: HeadPose = { neck: 0, pitch: 0, yaw: 0, roll: 0 };
  let body: BodyPose = { z: 0, roll: 0, pitch: 0 };
  let mouthOpen = 0;

  const loaded = new Set<PolicySlot>();
  const fetching = new Map<PolicySlot, Promise<void>>();

  let resolveReady: (r: SimReady) => void = () => undefined;
  let rejectReady: (e: Error) => void = () => undefined;
  let settled = false;
  const readyPromise = new Promise<SimReady>((resolve, reject) => {
    resolveReady = (r) => {
      settled = true;
      resolve(r);
    };
    rejectReady = (e) => {
      settled = true;
      reject(e);
    };
  });

  function post(message: SimRequest, transfer?: Transferable[]): void {
    if (disposed) return;
    worker.postMessage(message, transfer);
  }

  function sendCommand(): void {
    post({ type: 'command', twist, head, body, mouth: mouthOpen });
  }

  worker.addEventListener('message', (event) => {
    const message = event.data;
    switch (message.type) {
      case 'ready':
        for (const slot of message.slots) loaded.add(slot);
        resolveReady({ engine: message.engine, loadMs: message.loadMs, slots: message.slots });
        break;

      case 'state': {
        const frame = new Float32Array(message.buffer);
        if (frame.length !== STATE_FRAME_LEN) return;
        const extra = decodeStateFrame(frame, target);
        state.activeSkill = extra.skill;
        state.seated = extra.seated;
        state.mouth = extra.mouth;
        telemetry = {
          recovering: extra.recovering,
          controlHz: extra.controlHz,
          realtime: extra.realtime,
        };
        live = true;
        for (const cb of listeners) cb(state);
        // Give the buffer straight back, so the worker's pool stays full and
        // the 50 Hz path never has to allocate. Decoding above copied
        // everything out of it, so it is safe to let go of here.
        post({ type: 'recycle', buffer: message.buffer }, [message.buffer]);
        break;
      }

      case 'policyLoaded':
        loaded.add(message.slot);
        fetching.delete(message.slot);
        break;

      case 'error':
        // A failure before the model compiled is the one the console has to
        // hear about as a rejection; everything later is a notification.
        if (message.fatal && !settled) rejectReady(new Error(message.message));
        onError?.(message.message, message.fatal);
        break;
    }
  });

  (worker as unknown as ErrorCapable).addEventListener?.('error', (event) => {
    const message = event.message ?? 'the physics worker failed to load';
    if (!settled) rejectReady(new Error(message));
    onError?.(message, true);
  });

  // Sent immediately: the worker cannot do anything else until it has these,
  // and the buffers are transferred rather than cloned -- the model is 741 KB
  // and each policy is 773 KB, which is not worth copying twice.
  const transfer: Transferable[] = [
    ...Object.values(options.assets.files),
    ...Object.values(options.weights).filter((b): b is ArrayBuffer => b !== undefined),
  ];
  post(
    {
      type: 'init',
      assets: options.assets,
      weights: options.weights,
      homePose: options.homePose,
    },
    transfer,
  );

  /** Make sure a policy is in the worker before something asks it to run. */
  function ensurePolicy(slot: PolicySlot): Promise<void> {
    if (loaded.has(slot)) return Promise.resolve();
    const already = fetching.get(slot);
    if (already) return already;
    if (!fetchPolicy) {
      const message = `no loader for the ${slot} policy`;
      onError?.(message, false);
      return Promise.reject(new Error(message));
    }

    const job = fetchPolicy(slot)
      .then((buffer) => {
        // Marked loaded on the way out rather than on `policyLoaded` coming
        // back: the worker handles messages in order, so anything posted after
        // this is guaranteed to see the weights.
        loaded.add(slot);
        post({ type: 'loadPolicy', slot, weights: buffer }, [buffer]);
      })
      .catch((err: unknown) => {
        fetching.delete(slot);
        const message = err instanceof Error ? err.message : `could not load ${slot}`;
        onError?.(message, false);
        throw err;
      });
    fetching.set(slot, job);
    return job;
  }

  return {
    move(t: Twist) {
      twist = { vx: t.vx, vy: t.vy, vyaw: t.vyaw };
      sendCommand();
    },
    head(p: HeadPose) {
      head = { ...p };
      sendCommand();
    },
    pose(b: BodyPose) {
      body = { ...b };
      sendCommand();
    },
    mouth(open: number) {
      mouthOpen = open < 0 ? 0 : open > 1 ? 1 : open;
      sendCommand();
    },
    do(s: Skill) {
      const slot = SKILL_POLICY[s];
      if (loaded.has(slot)) {
        post({ type: 'do', skill: s });
        return;
      }
      // Five of the seven policies are 773 KB each and are not downloaded
      // until someone actually asks for that trick. The button therefore has
      // a fetch behind it the first time it is pressed.
      void ensurePolicy(slot).then(
        () => post({ type: 'do', skill: s }),
        () => undefined,
      );
    },
    stop() {
      twist = { vx: 0, vy: 0, vyaw: 0 };
      sendCommand();
    },
    subscribe(cb) {
      listeners.add(cb);
      // A subscriber arriving mid-flight gets the current state at once rather
      // than a blank frame for up to 20 ms.
      if (live) cb(state);
      return () => {
        listeners.delete(cb);
      };
    },
    tick(dt: number) {
      // Nothing. The worker runs its own clock at the robot's real rate, which
      // is the whole reason it is in a worker.
      void dt;
    },
    dispose() {
      if (disposed) return;
      post({ type: 'dispose' });
      disposed = true;
      listeners.clear();
      worker.terminate();
      if (!settled) rejectReady(new Error('the simulator was disposed before it started'));
    },

    push(impulse: Vec3 = DEFAULT_BOOP) {
      post({ type: 'push', impulse: [impulse[0], impulse[1], impulse[2]] });
    },
    reset() {
      twist = { vx: 0, vy: 0, vyaw: 0 };
      post({ type: 'reset' });
      sendCommand();
    },
    setPaused(paused: boolean) {
      post({ type: 'pause', paused });
    },
    ready() {
      return readyPromise;
    },
    telemetry() {
      return telemetry;
    },
    loading() {
      return [...fetching.keys()];
    },
  };
}

/**
 * Files an MJCF refers to: other MJCFs it includes, and its collision meshes.
 *
 * Parsed rather than listed, so adding a mesh to `robot_reduced.xml` cannot
 * leave the loader fetching eight of nine files and the compile failing on the
 * ninth. A regex is enough here and `DOMParser` is not: this runs before the
 * worker exists and the input is our own committed asset, not user content.
 */
export function parseMjcfRefs(xml: string): {
  includes: string[];
  meshdir: string;
  meshes: string[];
} {
  const includes = [...xml.matchAll(/<include\s+file="([^"]+)"/g)].map((m) => m[1]);
  const dir = /<compiler[^>]*\smeshdir="([^"]*)"/.exec(xml);
  const meshes = [...xml.matchAll(/<mesh\s+[^>]*file="([^"]+)"/g)].map((m) => m[1]);
  return { includes, meshdir: dir ? dir[1] : '', meshes };
}

/**
 * Fetch the scene, everything it includes, and every mesh those declare.
 *
 * Returns paths relative to the sim root with forward slashes, which is exactly
 * the layout the worker mirrors into MEMFS -- the MJCF resolves its meshes by
 * relative filename, so that has to match the real directory tree.
 */
export async function loadSimAssets(
  base: string,
  fetcher: (url: string) => Promise<ArrayBuffer> = defaultFetch,
): Promise<SimAssets> {
  const files: Record<string, ArrayBuffer> = {};
  const decoder = new TextDecoder();
  const queue = ['scene.xml'];
  const seen = new Set<string>();

  while (queue.length > 0) {
    const path = queue.shift() as string;
    if (seen.has(path)) continue;
    seen.add(path);
    const bytes = await fetcher(`${base}/${path}`);
    files[path] = bytes;

    const refs = parseMjcfRefs(decoder.decode(bytes));
    // Includes are resolved against the including file's directory, which for
    // this model is always the root.
    for (const include of refs.includes) queue.push(joinPath(dirname(path), include));
    const meshRoot = joinPath(dirname(path), refs.meshdir);
    await Promise.all(
      refs.meshes.map(async (mesh) => {
        const at = joinPath(meshRoot, mesh);
        if (files[at]) return;
        files[at] = await fetcher(`${base}/${at}`);
      }),
    );
  }

  return { entry: 'scene.xml', files };
}

function dirname(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash < 0 ? '' : path.slice(0, slash);
}

function joinPath(dir: string, name: string): string {
  if (!dir) return name;
  if (!name) return dir;
  return `${dir}/${name}`;
}

async function defaultFetch(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status} ${res.statusText}`);
  return res.arrayBuffer();
}

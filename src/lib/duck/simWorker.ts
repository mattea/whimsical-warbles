/**
 * MuJoCo, the shipped policies, and the 50 Hz control loop -- off the main
 * thread.
 *
 * This is the whole of the live backend. It owns the model, the data, the
 * policy weights and the clock; the main thread owns nothing but a `postMessage`
 * channel and whatever the last state frame said.
 *
 * **Why a worker.** `mj_loadXML` on this model measures 517 ms, which is a
 * frozen tab if it happens on the main thread, and one control tick -- ten
 * `mj_step` at 0.002 plus a 198k-parameter forward pass -- costs about 0.65 ms.
 * That is roughly 30x real time single-threaded, so the simulation is never the
 * bottleneck, but it must not be sharing a thread with a renderer trying to
 * hold 90 Hz in a headset.
 *
 * **Why single-threaded wasm.** The package also ships a pthreads build. It
 * needs COOP/COEP headers, which this site is served without, and at 30x real
 * time there is nothing to buy.
 *
 * **Falls are not reproducible.** Contact resolution and floating-point
 * ordering make the exact tumble diverge between runs -- the same shove from
 * the same keyframe lands the pugglenaut somewhere slightly different every
 * time. That is a property of the physics, not a defect here, and nothing in
 * this file or its tests should ever assume a frame-identical replay. What is
 * stable is the *behaviour*: it goes down, and the standing policy brings it
 * back up. Everything that can be pinned by a test lives in `simControl.ts`
 * instead, which is why that file is pure.
 */

import factory, { type MainModule, type MjData, type MjModel } from 'mujoco';
import { CONTROL_DT, CONTROL_HZ } from './link';
import { decodePolicyWeights, runPolicyNetwork, type PolicyWeights } from './mlp';
import { ACTION_LEN, buildObservation, OBS_LEN } from './observation';
import {
  actionScaleForSlot,
  createSimController,
  projectedGravityFromQuat,
  uprightFromGravity,
  type ControlPlan,
  type SimController,
} from './simControl';
import {
  encodeStateFrame,
  STATE_FRAME_LEN,
  type PolicySlot,
  type SimRequest,
  type SimResponse,
} from './simProtocol';
import type { Vec3 } from './tree';

/**
 * Where the model is mounted inside MEMFS. The MJCF references its meshes by
 * relative filename, so the layout under here has to mirror `public/duck/sim`
 * exactly or the compile fails on a missing asset.
 */
const ROOT = '/duck';

/** Free joint layout: 3 position, 4 quaternion, then the hinges. */
const QPOS_JOINTS = 7;
/** Free joint DOFs: 3 linear, 3 angular, then the hinges. */
const QVEL_JOINTS = 6;

/**
 * Most control ticks we will ever run to catch up in one pump.
 *
 * Without a cap, a tab that was backgrounded for a minute comes back with
 * three thousand ticks of backlog and locks the worker solid while it chases
 * them. Past the cap the backlog is abandoned and `realtime` reports the
 * shortfall rather than the loop pretending it kept up.
 */
const MAX_CATCHUP_TICKS = 4;

/** How often the achieved rate is recomputed, milliseconds. */
const RATE_WINDOW_MS = 500;

/**
 * The worker's own globals, narrowed to what is used.
 *
 * Declared rather than pulled in from `lib.webworker`: this file is compiled
 * with the same DOM-flavoured config as the rest of the site, and adding a
 * second global scope to that would change types for everything else.
 */
interface WorkerScope {
  postMessage(message: SimResponse, transfer?: Transferable[]): void;
  addEventListener(type: 'message', listener: (event: { data: SimRequest }) => void): void;
}
const ctx = globalThis as unknown as WorkerScope;

function fail(message: string, fatal: boolean): void {
  ctx.postMessage({ type: 'error', message, fatal });
}

/** Everything that exists only once MuJoCo has loaded and compiled the model. */
interface Loaded {
  mj: MainModule;
  model: MjModel;
  data: MjData;
  /** Body id of `trunk_base`, whose `xquat` is the orientation sensor. */
  trunkBody: number;
  /** Keyframe id of `STAND`, which is also where `reset` goes. */
  standKey: number;
  /** `CONTROL_DT / model.opt.timestep`, derived rather than assumed. Ten. */
  stepsPerTick: number;
}

let sim: Loaded | null = null;
let controller: SimController | null = null;
let homePose: number[] = [];
const weights = new Map<PolicySlot, PolicyWeights>();
/** Slots already complained about, so a missing policy is one message, not 50/s. */
const reportedMissing = new Set<PolicySlot>();

// Hot-path buffers. Everything the tick touches is allocated once, here.
const obs = new Float32Array(OBS_LEN);
const action = new Float32Array(ACTION_LEN);
const prevAction = new Float32Array(ACTION_LEN);
const jointPos = new Float64Array(ACTION_LEN);
const jointVel = new Float64Array(ACTION_LEN);
const gyro: Vec3 = [0, 0, 0];
const gravity: Vec3 = [0, 0, -1];

/** Bill opening. Not a policy joint -- carried through for the renderer. */
let mouth = 0;

/**
 * What the last tick decided.
 *
 * Latched rather than re-derived when the frame is packed: the controller's
 * `plan` advances a skill clock, so asking it twice in one tick could get two
 * different answers.
 */
let lastPlan: ControlPlan | null = null;

/**
 * Recycled state frames.
 *
 * Posting a frame transfers its buffer away, so it comes back through
 * `recycle`. If the main thread is late the pool runs dry and a fresh buffer is
 * allocated: 132 bytes is a cheaper price than a simulation that goes silent
 * because one message was dropped.
 */
const pool: ArrayBuffer[] = [
  new ArrayBuffer(STATE_FRAME_LEN * 4),
  new ArrayBuffer(STATE_FRAME_LEN * 4),
];

/** Measured rate, reported in every frame so the console can show the truth. */
let controlHz = CONTROL_HZ;
let windowTicks = 0;
let windowStart = 0;

let timer: ReturnType<typeof setTimeout> | null = null;
/** Wall-clock time the next control tick is due, in `performance.now()` terms. */
let nextAt = 0;

/** Create the directories a set of relative paths implies, ignoring repeats. */
function mkdirp(mj: MainModule, path: string): void {
  const parts = path.split('/').filter(Boolean);
  let at = '';
  for (const part of parts) {
    at += `/${part}`;
    try {
      mj.FS.mkdir(at);
    } catch {
      // Already there. MEMFS throws EEXIST rather than returning a code, and
      // there is no stat helper worth the import for this.
    }
  }
}

function loadWeights(slot: PolicySlot, buffer: ArrayBuffer): void {
  weights.set(slot, decodePolicyWeights(buffer));
  controller?.provide(slot);
  ctx.postMessage({ type: 'policyLoaded', slot });
}

function resetToStand(): void {
  if (!sim) return;
  sim.mj.mj_resetDataKeyframe(sim.model, sim.data, sim.standKey);
  // The keyframe sets qpos and ctrl but leaves the derived quantities stale,
  // and `xquat` is read before the first step -- so settle them now or the
  // very first observation sees an all-zero trunk orientation.
  sim.mj.mj_forward(sim.model, sim.data);
  prevAction.fill(0);
}

/** One control tick: sense, decide, act, then ten physics steps. */
function step(): void {
  if (!sim || !controller) return;
  const { mj, model, data, trunkBody, stepsPerTick } = sim;

  // The accessors return a fresh view over the same wasm heap on every read,
  // so they are fetched once per tick rather than once per element.
  const qpos = data.qpos as Float64Array;
  const qvel = data.qvel as Float64Array;
  const xquat = data.xquat as Float64Array;

  projectedGravityFromQuat(xquat.subarray(trunkBody * 4, trunkBody * 4 + 4), gravity);
  for (let i = 0; i < 3; i++) gyro[i] = qvel[3 + i];
  for (let i = 0; i < ACTION_LEN; i++) {
    jointPos[i] = qpos[QPOS_JOINTS + i];
    jointVel[i] = qvel[QVEL_JOINTS + i];
  }

  const plan = controller.plan(uprightFromGravity(gravity), CONTROL_DT);
  lastPlan = plan;
  // A plan can only name a slot the controller was told about, so a miss here
  // means the two disagree. Say so -- once, not fifty times a second -- and
  // carry on standing rather than freezing every joint at its last target.
  let policy = weights.get(plan.slot);
  if (!policy) {
    if (!reportedMissing.has(plan.slot)) {
      reportedMissing.add(plan.slot);
      fail(`no weights loaded for the ${plan.slot} policy; standing instead`, false);
    }
    policy = weights.get('stand');
    if (!policy) return;
    plan.slot = 'stand';
    plan.actionScale = actionScaleForSlot('stand');
  }

  buildObservation(
    {
      gyro,
      gravity,
      jointPos,
      jointVel,
      prevAction,
      twist: plan.twist,
      head: plan.head,
      body: plan.body,
    },
    homePose,
    obs,
  );
  runPolicyNetwork(policy, obs, action);

  const ctrl = data.ctrl as Float64Array;
  for (let i = 0; i < ACTION_LEN; i++) {
    ctrl[i] = homePose[i] + plan.actionScale * action[i];
    // The observation wants the raw output, before scaling.
    prevAction[i] = action[i];
  }

  for (let i = 0; i < stepsPerTick; i++) mj.mj_step(model, data);

  // A diverged solver poisons every downstream number, including the ones the
  // renderer reads. Catch it here and go back to the keyframe.
  if (!Number.isFinite(data.qpos[2])) {
    fail('the solver diverged; returning to the standing keyframe', false);
    resetToStand();
    controller.reset();
  }
}

/** Post the current state, reusing a recycled buffer when one is back. */
function emit(): void {
  if (!sim || !lastPlan) return;
  const qpos = sim.data.qpos as Float64Array;

  const buffer = pool.pop() ?? new ArrayBuffer(STATE_FRAME_LEN * 4);
  const frame = new Float32Array(buffer);
  encodeStateFrame(frame, {
    joints: qpos.subarray(QPOS_JOINTS, QPOS_JOINTS + ACTION_LEN),
    pos: qpos.subarray(0, 3),
    quat: qpos.subarray(3, 7),
    gyro,
    gravity,
    mouth,
    seated: lastPlan.seated,
    skill: lastPlan.skill,
    recovering: lastPlan.recovering,
    controlHz,
    realtime: controlHz / CONTROL_HZ,
  });
  ctx.postMessage({ type: 'state', buffer }, [buffer]);
}

/**
 * Drive the clock.
 *
 * A self-scheduling `setTimeout` rather than `setInterval`: the interval
 * version drifts and, worse, queues up callbacks it could not run, which is the
 * same backlog spiral `MAX_CATCHUP_TICKS` exists to prevent.
 */
function pump(): void {
  if (!sim) return;
  let ran = 0;
  try {
    while (ran < MAX_CATCHUP_TICKS && performance.now() >= nextAt) {
      step();
      nextAt += CONTROL_DT * 1000;
      ran++;
      windowTicks++;
    }
  } catch (err) {
    stop();
    fail(err instanceof Error ? err.message : 'the simulation stopped', true);
    return;
  }

  const now = performance.now();
  // Still behind after the cap: give up the backlog. The loop then runs slower
  // than real time, which `realtime` reports honestly instead of hiding.
  if (nextAt < now) nextAt = now;

  if (now - windowStart >= RATE_WINDOW_MS) {
    controlHz = (windowTicks * 1000) / (now - windowStart);
    windowTicks = 0;
    windowStart = now;
  }

  // One frame per pump, not per tick: during a catch-up burst only the newest
  // state is worth anything, and the renderer interpolates anyway.
  if (ran > 0) emit();

  timer = setTimeout(pump, Math.max(0, nextAt - performance.now()));
}

function stop(): void {
  if (timer !== null) clearTimeout(timer);
  timer = null;
}

async function init(message: Extract<SimRequest, { type: 'init' }>): Promise<void> {
  if (sim) return;
  const started = performance.now();
  const mj = await factory();

  for (const [path, bytes] of Object.entries(message.assets.files)) {
    const slash = path.lastIndexOf('/');
    mkdirp(mj, slash < 0 ? ROOT : `${ROOT}/${path.slice(0, slash)}`);
    mj.FS.writeFile(`${ROOT}/${path}`, new Uint8Array(bytes));
  }

  // A path, not the XML itself. The README says otherwise and is wrong, and
  // `MjVFS` is no help either -- it only feeds `mj_loadBinary`.
  const model = mj.MjModel.mj_loadXML(`${ROOT}/${message.assets.entry}`);
  const data = new mj.MjData(model);

  const trunkBody = mj.mj_name2id(model, mj.mjtObj.mjOBJ_BODY.value, 'trunk_base');
  const standKey = mj.mj_name2id(model, mj.mjtObj.mjOBJ_KEY.value, 'STAND');
  if (trunkBody < 0 || standKey < 0) {
    throw new Error('the scene is missing trunk_base or the STAND keyframe');
  }

  const timestep = model.opt.timestep as number;
  const stepsPerTick = Math.max(1, Math.round(CONTROL_DT / timestep));

  sim = { mj, model, data, trunkBody, standKey, stepsPerTick };
  homePose = message.homePose;
  resetToStand();

  controller = createSimController({ available: [] });
  for (const [slot, buffer] of Object.entries(message.weights)) {
    if (buffer) loadWeights(slot as PolicySlot, buffer);
  }

  ctx.postMessage({
    type: 'ready',
    engine: mj.mj_versionString(),
    loadMs: performance.now() - started,
    slots: [...weights.keys()],
  });

  nextAt = performance.now();
  windowStart = nextAt;
  windowTicks = 0;
  pump();
}

ctx.addEventListener('message', (event) => {
  const message = event.data;
  try {
    switch (message.type) {
      case 'init':
        void init(message).catch((err: unknown) => {
          stop();
          fail(err instanceof Error ? err.message : 'the simulator would not start', true);
        });
        break;

      case 'command':
        controller?.move(message.twist);
        controller?.head(message.head);
        controller?.pose(message.body);
        mouth = message.mouth;
        break;

      case 'do':
        controller?.do(message.skill);
        break;

      case 'loadPolicy':
        loadWeights(message.slot, message.weights);
        break;

      case 'push': {
        if (!sim) break;
        // Straight into the free joint's linear velocity. A force would be
        // more principled, but a velocity step is what the shove was tuned
        // against and it is the same thing a hand does to a 25 cm robot.
        const qvel = sim.data.qvel as Float64Array;
        for (let i = 0; i < 3; i++) qvel[i] += message.impulse[i];
        break;
      }

      case 'reset':
        resetToStand();
        controller?.reset();
        break;

      case 'pause':
        if (message.paused) {
          stop();
        } else if (sim && timer === null) {
          // Restart the clock from now rather than from where it stopped, so
          // resuming does not present a minute of backlog to catch up on.
          nextAt = performance.now();
          windowStart = nextAt;
          windowTicks = 0;
          pump();
        }
        break;

      case 'recycle':
        // Only take it back if it is the right size; a stray buffer would
        // desynchronise every frame after it.
        if (message.buffer.byteLength === STATE_FRAME_LEN * 4 && pool.length < 4) {
          pool.push(message.buffer);
        }
        break;

      case 'dispose':
        stop();
        // Embind handles are not garbage collected. Without these the model
        // and its data stay in the wasm heap for the life of the page.
        sim?.data.delete();
        sim?.model.delete();
        sim = null;
        controller = null;
        lastPlan = null;
        weights.clear();
        break;
    }
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err), false);
  }
});

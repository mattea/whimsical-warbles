/**
 * The shipped Microduck ONNX policies, run in the browser.
 *
 * Microduck ships nine trained policies in `microduck/policies/`, about 790 KB
 * each, and every one of them is `obs[1,61] -> actions[1,14]`. So this wrapper
 * is deliberately thin: build the observation with `observation.ts`, hand it
 * here, get fourteen offsets back, turn them into joint targets with
 * `jointTargets`. There is no per-policy special case, because upstream has
 * none -- a skill is a session choice plus a command-block encoding, never a new
 * contract.
 *
 * **The graph is validated at load, not at inference**, following
 * `microduck/duck-control/src/policy.rs`, which explains why: a bundle with the
 * wrong observation width must fail while the robot is standing still and the
 * caller can be told the reason, not sixty ticks later mid-stride. The concrete
 * mistake this guards is loading one of the 51-D or 54-D legacy policies, which
 * predate the alpha layout. Feeding a 61-slot observation to one of those, or a
 * 51-slot observation to an alpha one, does not read as an indexing error. It
 * reads as a robot that needs tuning. So the error names both widths.
 *
 * `onnxruntime-web` is imported dynamically. The package is large on disk and
 * pulls in a wasm binary, and nothing on this site should pay for that until
 * someone explicitly asks for a live simulation -- the same opt-in rule `/lab`
 * already applies to `three`.
 *
 * What that costs, measured rather than guessed, on onnxruntime-web 1.29.0:
 *
 * - Importing this file costs nothing but this file. The dynamic import lands
 *   in its own chunk: 403 KB raw, 110 KB gzipped, fetched on the first
 *   `loadPolicy` and never before.
 * - The runtime then fetches a wasm binary the bundler never sees. The default
 *   `onnxruntime-web` entry point asks for `ort-wasm-simd-threaded.jsep.wasm`,
 *   which is 27.8 MB raw and 6.2 MB gzipped, because it carries the WebGPU
 *   execution provider. The `onnxruntime-web/wasm` subpath asks for
 *   `ort-wasm-simd-threaded.wasm` instead: 14.0 MB raw, 3.4 MB gzipped. A
 *   fourteen-joint MLP has nothing to gain from a GPU, so whoever wires this
 *   into a page should take the smaller one.
 * - That wasm resolves relative to the loading module, so it has to be copied
 *   into `public/` or pointed at with `ort.env.wasm.wasmPaths`. Left to the
 *   page: it is a serving decision, not a policy one, and setting it from here
 *   would mean a library mutating global runtime state.
 */

import { ACTION_LEN, OBS_LEN } from './observation';

/**
 * Where a policy comes from: a URL, or the bytes of one already in hand.
 *
 * Both because the two callers differ. A page fetches `/duck/policies/*.onnx`
 * by URL; a test reads a file off disk and passes the bytes, with no server to
 * fetch from.
 */
export type PolicySource = string | Uint8Array | ArrayBuffer;

/**
 * The slice of an inference session this module needs.
 *
 * Narrower than `onnxruntime-web`'s `InferenceSession` on purpose. It is what
 * makes the validation above testable without loading ort: `policy.test.ts`
 * injects a plain object, and the wasm runtime is exercised once, by the golden
 * test, rather than by every case.
 */
export interface PolicySession {
  /**
   * Trailing dimension the graph declares for its input, or `null` if it does
   * not commit to one.
   *
   * Only the trailing dimension, because the leading one is the batch and is
   * often dynamic. That is the one that encodes the contract -- the same reason
   * `check_width` upstream looks at the last dimension and nothing else.
   */
  readonly obsWidth: number | null;
  /** The same, for the output. */
  readonly actionWidth: number | null;
  run(obs: Float32Array): Promise<Float32Array>;
  release(): Promise<void>;
}

export type SessionFactory = (source: PolicySource) => Promise<PolicySession>;

export interface LoadPolicyOptions {
  /**
   * Open the graph. Defaults to `createOrtSession`, which is the only thing in
   * this module that touches `onnxruntime-web`.
   */
  createSession?: SessionFactory;
  /**
   * Run one throwaway inference at load. On by default.
   *
   * The first inference is always an outlier -- lazy initialisation, cold
   * pages, first-touch faults -- and paying that on tick one of a 50 Hz loop
   * looks exactly like a control loop that missed its deadline. It also proves
   * the runtime is actually usable, which with a lazily-loaded wasm module is
   * not known until something has been run through it.
   */
  warmUp?: boolean;
}

export interface DuckPolicy {
  /** What was loaded, as given. Carried so errors can name it. */
  readonly source: string;
  readonly obsWidth: number | null;
  readonly actionWidth: number | null;
  /**
   * One inference. Pass `out` to reuse a buffer on the control clock.
   */
  infer(obs: Float32Array, out?: Float32Array): Promise<Float32Array>;
  dispose(): Promise<void>;
}

/** A short name for a source, for error messages. */
function describeSource(source: PolicySource): string {
  return typeof source === 'string' ? source : `<${source.byteLength} bytes>`;
}

/**
 * Load, validate and warm up a policy.
 *
 * @param source URL of the `.onnx`, or its bytes.
 */
export async function loadPolicy(
  source: PolicySource,
  options: LoadPolicyOptions = {},
): Promise<DuckPolicy> {
  const name = describeSource(source);
  const create = options.createSession ?? createOrtSession;
  const session = await create(source);

  // A session that fails validation still holds a wasm arena and, in a browser,
  // possibly a worker. Releasing it before throwing means a caller that retries
  // with the right file does not accumulate dead runtimes.
  const reject = async (message: string): Promise<never> => {
    await session.release().catch(() => {});
    throw new Error(`${name}: ${message}`);
  };

  if (session.obsWidth !== null && session.obsWidth !== OBS_LEN) {
    await reject(
      `observation width is ${session.obsWidth}, expected ${OBS_LEN}. ` +
        'This is not an alpha Microduck policy -- the 51-D and 54-D graphs are ' +
        'v1 history and were trained against a different observation layout.',
    );
  }
  if (session.actionWidth !== null && session.actionWidth !== ACTION_LEN) {
    await reject(`action count is ${session.actionWidth}, expected ${ACTION_LEN}`);
  }

  let released = false;

  async function run(obs: Float32Array): Promise<Float32Array> {
    if (released) {
      throw new Error(`${name}: policy was disposed`);
    }
    if (obs.length !== OBS_LEN) {
      throw new Error(`${name}: observation is ${obs.length} wide, expected ${OBS_LEN}`);
    }
    const action = await session.run(obs);
    if (action.length !== ACTION_LEN) {
      // Reachable when the graph declared no trailing dimension, so nothing was
      // checkable at load. A short action would otherwise leave joints at zero
      // -- which, after `jointTargets`, is the home pose, and looks deliberate.
      throw new Error(
        `${name}: returned ${action.length} actions, expected ${ACTION_LEN}`,
      );
    }
    return action;
  }

  if (options.warmUp !== false) {
    // A zeroed observation is not a valid robot state. That is fine: its output
    // is discarded, and the point is to pay the first-call cost here.
    try {
      await run(new Float32Array(OBS_LEN));
    } catch (error) {
      await session.release().catch(() => {});
      throw error;
    }
  }

  return {
    source: name,
    obsWidth: session.obsWidth,
    actionWidth: session.actionWidth,
    async infer(obs, out) {
      const action = await run(obs);
      if (!out) return action;
      if (out.length !== ACTION_LEN) {
        throw new Error(`${name}: output buffer is ${out.length} wide, expected ${ACTION_LEN}`);
      }
      out.set(action);
      return out;
    },
    async dispose() {
      if (released) return;
      released = true;
      await session.release();
    },
  };
}

/**
 * Open a graph with `onnxruntime-web`.
 *
 * The import is dynamic so the wasm runtime is fetched only when a policy is
 * actually loaded, and so `policy.ts` can be imported by code that never runs
 * one.
 *
 * `intraOpNumThreads: 1` matches upstream's `INTRA_THREADS`, and for a browser
 * it is the honest default anyway: multi-threaded wasm needs `SharedArrayBuffer`,
 * which needs cross-origin isolation headers this site does not send. These
 * networks are small enough that a thread pool costs more in synchronisation
 * than it recovers.
 */
export const createOrtSession: SessionFactory = async (source) => {
  const ort = await import('onnxruntime-web');

  const options = {
    graphOptimizationLevel: 'all',
    intraOpNumThreads: 1,
  } as const;

  // `create` is overloaded per source kind rather than taking a union, so the
  // branch here is for the type checker; both arms do the same thing.
  const bytes = typeof source === 'string' || source instanceof Uint8Array
    ? source
    : new Uint8Array(source);
  const session =
    typeof bytes === 'string'
      ? await ort.InferenceSession.create(bytes, options)
      : await ort.InferenceSession.create(bytes, options);

  const inputName = session.inputNames[0];
  const outputName = session.outputNames[0];

  return {
    obsWidth: trailingDim(session.inputMetadata),
    actionWidth: trailingDim(session.outputMetadata),

    async run(obs) {
      // A fresh copy per call: `Tensor` keeps a reference to the array it is
      // given, and 244 bytes at 50 Hz is not worth the aliasing hazard of
      // handing the runtime a buffer the caller is still writing into.
      const tensor = new ort.Tensor('float32', Float32Array.from(obs), [1, OBS_LEN]);
      const outputs = await session.run({ [inputName]: tensor });
      const value = outputs[outputName];
      if (!value || !(value.data instanceof Float32Array)) {
        throw new Error(`output "${outputName}" is not a float32 tensor`);
      }
      return value.data;
    },

    release: () => session.release(),
  };
};

/**
 * The trailing dimension of a graph's first tensor outlet, if it has one.
 *
 * `null` for a non-tensor outlet, an undeclared shape, or a symbolic dimension
 * -- ort reports those as strings. In every one of those cases there is nothing
 * to compare against, and the warm-up inference is what catches a mismatch.
 */
function trailingDim(
  metadata: readonly { isTensor: boolean; shape?: readonly (number | string)[] }[],
): number | null {
  const first = metadata?.[0];
  if (!first?.isTensor || !first.shape?.length) return null;
  const last = first.shape[first.shape.length - 1];
  return typeof last === 'number' ? last : null;
}

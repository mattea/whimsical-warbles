/**
 * The Microduck policy network, evaluated directly.
 *
 * Every shipped policy is the same small graph: an observation normalizer baked
 * into the export, then a four-layer MLP with ELU activations.
 *
 *     x = (obs - mean) / std
 *     x = elu(W0 x + b0)    61 -> 512
 *     x = elu(W2 x + b2)   512 -> 256
 *     x = elu(W4 x + b4)   256 -> 128
 *     a =     W6 x + b6    128 -> 14
 *
 * Nine ONNX nodes and 197,896 parameters. Running that through
 * `onnxruntime-web` would mean downloading a 14 MB wasm (3.4 MB gzipped) to
 * perform four matrix multiplies, so the weights are extracted by
 * `scripts/bake-policy-weights.py` into a flat float32 blob and multiplied out
 * here instead. Same arithmetic, none of the runtime.
 *
 * That trade is only defensible because it is checked rather than assumed:
 * `mlp.test.ts` runs this against `policy-golden.json`, which real
 * `onnxruntime` produced from the same graph, and the two agree to better than
 * 1e-4 on every output. `policy.ts` keeps the onnxruntime path as the oracle
 * that fixture comes from; it is a development dependency, not shipped.
 *
 * The bake refuses any graph that is not this exact node sequence, so a
 * retrained policy with a different architecture fails loudly there rather
 * than being mis-evaluated here.
 */

import { ACTION_LEN, OBS_LEN } from './observation';

/** Widths of the four `Gemm` layers, in order. */
const LAYER_SHAPES: [number, number][] = [
  [OBS_LEN, 512],
  [512, 256],
  [256, 128],
  [128, ACTION_LEN],
];

/**
 * Parameters in one policy: the normalizer's mean and standard deviation, then
 * each layer's weight matrix and bias.
 */
export const POLICY_PARAM_COUNT =
  2 * OBS_LEN + LAYER_SHAPES.reduce((sum, [i, o]) => sum + i * o + o, 0);

export interface PolicyLayer {
  inputs: number;
  outputs: number;
  /** Row-major, `outputs` rows of `inputs` values — ONNX `Gemm` transB order. */
  weight: Float32Array;
  bias: Float32Array;
}

export interface PolicyWeights {
  mean: Float32Array;
  std: Float32Array;
  layers: PolicyLayer[];
  /** Scratch buffers, one per layer output, so stepping allocates nothing. */
  scratch: Float32Array[];
}

/**
 * Read a `*.bin` produced by `scripts/bake-policy-weights.py`.
 *
 * The blob is little-endian float32 in the order the script's `BLOB_ORDER`
 * documents; the two must change together, which is why both name the layout
 * explicitly rather than relying on an implicit convention.
 */
export function decodePolicyWeights(buffer: ArrayBuffer): PolicyWeights {
  const expected = POLICY_PARAM_COUNT * 4;
  if (buffer.byteLength !== expected) {
    throw new Error(
      `policy weights are ${buffer.byteLength} bytes, expected ${expected} ` +
        `(${POLICY_PARAM_COUNT} float32 parameters)`,
    );
  }

  const all = new Float32Array(buffer);
  let at = 0;
  const take = (n: number) => {
    const slice = all.subarray(at, at + n);
    at += n;
    return slice;
  };

  const mean = take(OBS_LEN);
  const std = take(OBS_LEN);
  const layers: PolicyLayer[] = LAYER_SHAPES.map(([inputs, outputs]) => ({
    inputs,
    outputs,
    weight: take(inputs * outputs),
    bias: take(outputs),
  }));

  return {
    mean,
    std,
    layers,
    scratch: layers.map((l) => new Float32Array(l.outputs)),
  };
}

/**
 * ELU, exactly as ONNX defines it with the default alpha of 1.
 *
 * `expm1` rather than `exp(x) - 1` because the latter loses precision for the
 * small-magnitude negatives that dominate here.
 */
function elu(x: number): number {
  return x >= 0 ? x : Math.expm1(x);
}

/**
 * Run the network. Writes `ACTION_LEN` values into `out` and allocates nothing.
 *
 * `obs` is not modified: the normalizer is folded into the first layer's
 * accumulation rather than applied in place, because the caller reuses its
 * observation buffer across ticks and previous-action feedback would otherwise
 * read normalized values.
 */
export function runPolicyNetwork(
  weights: PolicyWeights,
  obs: Float32Array,
  out: Float32Array,
): void {
  if (obs.length !== OBS_LEN) {
    throw new Error(`expected an observation of ${OBS_LEN} values, got ${obs.length}`);
  }
  if (out.length !== ACTION_LEN) {
    throw new Error(`expected an output of ${ACTION_LEN} values, got ${out.length}`);
  }

  const { mean, std, layers, scratch } = weights;

  // First layer, normalizing on the way in.
  const first = layers[0];
  const firstOut = scratch[0];
  for (let o = 0; o < first.outputs; o++) {
    const row = o * first.inputs;
    let sum = first.bias[o];
    for (let i = 0; i < first.inputs; i++) {
      sum += first.weight[row + i] * ((obs[i] - mean[i]) / std[i]);
    }
    firstOut[o] = elu(sum);
  }

  // Hidden layers.
  for (let l = 1; l < layers.length - 1; l++) {
    const layer = layers[l];
    const input = scratch[l - 1];
    const output = scratch[l];
    for (let o = 0; o < layer.outputs; o++) {
      const row = o * layer.inputs;
      let sum = layer.bias[o];
      for (let i = 0; i < layer.inputs; i++) sum += layer.weight[row + i] * input[i];
      output[o] = elu(sum);
    }
  }

  // Output layer: no activation.
  const last = layers[layers.length - 1];
  const input = scratch[layers.length - 2];
  for (let o = 0; o < last.outputs; o++) {
    const row = o * last.inputs;
    let sum = last.bias[o];
    for (let i = 0; i < last.inputs; i++) sum += last.weight[row + i] * input[i];
    out[o] = sum;
  }
}

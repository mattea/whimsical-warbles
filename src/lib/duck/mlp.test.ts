import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import golden from './policy-golden.json';
import { ACTION_LEN, OBS_LEN } from './observation';
import { decodePolicyWeights, runPolicyNetwork, POLICY_PARAM_COUNT } from './mlp';

/**
 * The whole point of this file: the hand-rolled forward pass has to agree with
 * a real inference runtime, or shipping it instead of onnxruntime is not a
 * saving but a silent behaviour change.
 *
 * `policy-golden.json` was produced by desktop `onnxruntime` running
 * `alpha_walking.onnx`. The weights come from the same graph via
 * `scripts/bake-policy-weights.py`.
 */

const weights = decodePolicyWeights(
  new Uint8Array(readFileSync('public/duck/policies/walk.bin')).buffer,
);

describe('decodePolicyWeights', () => {
  it('reads the expected parameter count', () => {
    expect(POLICY_PARAM_COUNT).toBe(197896);
  });

  it('lays out every block at the right width', () => {
    expect(weights.mean).toHaveLength(OBS_LEN);
    expect(weights.std).toHaveLength(OBS_LEN);
    expect(weights.layers).toHaveLength(4);
    expect(weights.layers.map((l) => [l.inputs, l.outputs])).toEqual([
      [61, 512],
      [512, 256],
      [256, 128],
      [128, 14],
    ]);
    for (const layer of weights.layers) {
      expect(layer.weight).toHaveLength(layer.inputs * layer.outputs);
      expect(layer.bias).toHaveLength(layer.outputs);
    }
  });

  it('rejects a blob of the wrong size', () => {
    expect(() => decodePolicyWeights(new ArrayBuffer(16))).toThrow(/expected/i);
  });

  it('has a normalizer that never divides by zero', () => {
    for (const s of weights.std) {
      expect(Number.isFinite(s)).toBe(true);
      expect(Math.abs(s)).toBeGreaterThan(0);
    }
  });
});

describe('runPolicyNetwork', () => {
  it('matches onnxruntime on every golden case', () => {
    expect(golden.policy).toBe('alpha_walking.onnx');
    expect(golden.cases.length).toBeGreaterThanOrEqual(8);

    const out = new Float32Array(ACTION_LEN);
    for (const [c, kase] of golden.cases.entries()) {
      runPolicyNetwork(weights, Float32Array.from(kase.obs), out);
      for (let j = 0; j < ACTION_LEN; j++) {
        expect(out[j], `case ${c} action[${j}]`).toBeCloseTo(kase.action[j], 4);
      }
    }
  });

  it('agrees to well under a thousandth of a radian', () => {
    // Reported so a regression shows up as a number rather than a pass/fail.
    const out = new Float32Array(ACTION_LEN);
    let worst = 0;
    for (const kase of golden.cases) {
      runPolicyNetwork(weights, Float32Array.from(kase.obs), out);
      for (let j = 0; j < ACTION_LEN; j++) {
        worst = Math.max(worst, Math.abs(out[j] - kase.action[j]));
      }
    }
    expect(worst).toBeLessThan(1e-4);
  });

  it('is deterministic', () => {
    const a = new Float32Array(ACTION_LEN);
    const b = new Float32Array(ACTION_LEN);
    const obs = Float32Array.from(golden.cases[0].obs);
    runPolicyNetwork(weights, obs, a);
    runPolicyNetwork(weights, obs, b);
    expect([...a]).toEqual([...b]);
  });

  it('does not mutate the observation it is given', () => {
    const obs = Float32Array.from(golden.cases[1].obs);
    const before = [...obs];
    runPolicyNetwork(weights, obs, new Float32Array(ACTION_LEN));
    expect([...obs]).toEqual(before);
  });

  it('rejects a wrong-width observation', () => {
    expect(() =>
      runPolicyNetwork(weights, new Float32Array(OBS_LEN - 1), new Float32Array(ACTION_LEN)),
    ).toThrow(/61/);
  });

  it('produces finite actions for extreme observations', () => {
    const out = new Float32Array(ACTION_LEN);
    for (const fill of [0, 1, -1, 10, -10]) {
      runPolicyNetwork(weights, new Float32Array(OBS_LEN).fill(fill), out);
      for (const v of out) expect(Number.isFinite(v)).toBe(true);
    }
  });
});

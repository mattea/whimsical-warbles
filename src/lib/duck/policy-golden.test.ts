/**
 * The real runtime, on the real graph, against Python's answers.
 *
 * `policy.test.ts` covers the wrapper with an injected session, which is fast
 * and proves the validation. It cannot prove the thing that actually matters
 * here: that `onnxruntime-web` in a browser returns what `onnxruntime` on a
 * desktop returned when the clips were baked. If the two disagree, every
 * conclusion drawn from the baked motion stops applying to the live simulator.
 *
 * So this test loads `alpha_walking.onnx` -- the same file the bake ran, copied
 * beside its fixture by `scripts/bake-duck-motion.py` -- and holds it to the
 * actions Python got from the same observations.
 *
 * It is slow by the standards of the rest of the suite: the wasm runtime has to
 * start. That is the cost of it being real.
 */

import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import golden from './policy-golden.json';
import { ACTION_LEN, OBS_LEN } from './observation';
import { loadPolicy, type DuckPolicy } from './policy';

/** Long enough for a cold wasm start on a loaded machine. */
const TIMEOUT = 60_000;

let policy: DuckPolicy;

beforeAll(async () => {
  const bytes = await readFile(new URL(`./${golden.policy}`, import.meta.url));
  // From bytes rather than a path: there is no server here, and passing the
  // buffer is also what the browser will do once the fetch is cached.
  policy = await loadPolicy(new Uint8Array(bytes));
}, TIMEOUT);

afterAll(async () => {
  await policy?.dispose();
});

describe(`${golden.policy} under onnxruntime-web`, () => {
  it('declares the observation and action widths the site assumes', () => {
    expect(policy.obsWidth).toBe(OBS_LEN);
    expect(policy.actionWidth).toBe(ACTION_LEN);
  });

  it('reproduces the actions Python got, to four decimals', async () => {
    expect(golden.cases.length).toBeGreaterThanOrEqual(8);

    for (const [c, kase] of golden.cases.entries()) {
      const action = await policy.infer(Float32Array.from(kase.obs));
      expect(action).toHaveLength(ACTION_LEN);
      for (let i = 0; i < ACTION_LEN; i++) {
        expect(action[i], `case ${c} action ${i}`).toBeCloseTo(kase.action[i], 4);
      }
    }
  }, TIMEOUT);

  it('is deterministic across calls, so a control loop is reproducible', async () => {
    const obs = Float32Array.from(golden.cases[0].obs);
    const first = Float32Array.from(await policy.infer(obs));
    const second = await policy.infer(obs);
    expect([...second]).toEqual([...first]);
  }, TIMEOUT);
});

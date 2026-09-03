import { describe, expect, it, vi } from 'vitest';
import { ACTION_LEN, OBS_LEN } from './observation';
import { loadPolicy, type PolicySession } from './policy';

/**
 * A stand-in for a loaded graph.
 *
 * The whole point of the injectable factory is that the validation below can be
 * tested without pulling in onnxruntime-web, whose wasm takes seconds to start
 * and would make these cases slow enough to stop being run.
 */
function fakeSession(over: Partial<PolicySession> = {}): PolicySession {
  return {
    obsWidth: OBS_LEN,
    actionWidth: ACTION_LEN,
    run: async () => new Float32Array(ACTION_LEN),
    release: async () => {},
    ...over,
  };
}

function loadFake(over: Partial<PolicySession> = {}) {
  return loadPolicy('alpha_walking.onnx', { createSession: async () => fakeSession(over) });
}

describe('loadPolicy', () => {
  it('accepts a graph declaring obs[1,61] -> actions[1,14]', async () => {
    const policy = await loadFake();
    expect(policy.obsWidth).toBe(OBS_LEN);
    expect(policy.actionWidth).toBe(ACTION_LEN);
  });

  it('refuses a 51-D policy, naming both widths', async () => {
    // The legacy width, and the mistake this check exists for: a wrong-policy
    // bundle otherwise reads as a tuning problem rather than an indexing one.
    const load = loadFake({ obsWidth: 51 });
    await expect(load).rejects.toThrow(/51/);
    await expect(load).rejects.toThrow(/61/);
    await expect(load).rejects.toThrow(/alpha_walking\.onnx/);
  });

  it('refuses a graph with the wrong action count, naming both widths', async () => {
    const load = loadFake({ actionWidth: 15 });
    await expect(load).rejects.toThrow(/15/);
    await expect(load).rejects.toThrow(/14/);
  });

  it('releases the session when validation fails, rather than leaking wasm', async () => {
    const release = vi.fn(async () => {});
    await expect(
      loadPolicy('bad.onnx', {
        createSession: async () => fakeSession({ obsWidth: 51, release }),
      }),
    ).rejects.toThrow();
    expect(release).toHaveBeenCalledOnce();
  });

  it('warms up with a zeroed observation, so tick one is not the slow one', async () => {
    const run = vi.fn(async () => new Float32Array(ACTION_LEN));
    await loadFake({ run });
    expect(run).toHaveBeenCalledOnce();
    const [obs] = run.mock.calls[0] as unknown as [Float32Array];
    expect(obs).toHaveLength(OBS_LEN);
    expect([...obs].every((v) => v === 0)).toBe(true);
  });

  it('can skip the warm-up when the caller does not want to pay for it', async () => {
    const run = vi.fn(async () => new Float32Array(ACTION_LEN));
    await loadPolicy('x.onnx', {
      createSession: async () => fakeSession({ run }),
      warmUp: false,
    });
    expect(run).not.toHaveBeenCalled();
  });

  it('catches a wrong action count at warm-up when the graph declares none', async () => {
    // A dynamic or symbolic trailing dimension leaves nothing to check at load,
    // so the warm-up inference is the only thing standing between a wrong
    // bundle and a silently mis-scattered action.
    await expect(
      loadFake({
        obsWidth: null,
        actionWidth: null,
        run: async () => new Float32Array(51),
      }),
    ).rejects.toThrow(/51.*14|14.*51/);
  });
});

describe('DuckPolicy.infer', () => {
  it('returns the graph output', async () => {
    const action = new Float32Array(ACTION_LEN);
    action[3] = 0.5;
    const policy = await loadFake({ run: async () => action });
    const got = await policy.infer(new Float32Array(OBS_LEN));
    expect(got[3]).toBe(0.5);
  });

  it('writes into a caller-supplied buffer', async () => {
    const policy = await loadFake({
      run: async () => Float32Array.from({ length: ACTION_LEN }, (_, i) => i),
    });
    const out = new Float32Array(ACTION_LEN);
    expect(await policy.infer(new Float32Array(OBS_LEN), out)).toBe(out);
    expect(out[13]).toBe(13);
  });

  it('rejects a wrong-width observation instead of letting the runtime guess', async () => {
    const policy = await loadFake();
    await expect(policy.infer(new Float32Array(51))).rejects.toThrow(/51/);
  });

  it('rejects a wrong-width action from the graph', async () => {
    // The warm-up answers correctly and the next call does not, which is the
    // only way a short action can reach an already-validated session.
    let width = ACTION_LEN;
    const policy = await loadFake({ run: async () => new Float32Array(width) });
    width = 13;
    await expect(policy.infer(new Float32Array(OBS_LEN))).rejects.toThrow(/13/);
  });

  it('disposes the session', async () => {
    const release = vi.fn(async () => {});
    const policy = await loadFake({ release });
    await policy.dispose();
    expect(release).toHaveBeenCalledOnce();
    await expect(policy.infer(new Float32Array(OBS_LEN))).rejects.toThrow(/dispose/i);
  });
});

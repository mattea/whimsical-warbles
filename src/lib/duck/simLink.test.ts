import { describe, expect, it, vi } from 'vitest';
import type { DuckState } from './link';
import {
  createSimLink,
  DEFAULT_SHOVE,
  loadSimAssets,
  parseMjcfRefs,
  type SimLink,
  type SimWorkerLike,
} from './simLink';
import {
  encodeStateFrame,
  STATE_FRAME_LEN,
  type PolicySlot,
  type SimRequest,
  type SimResponse,
} from './simProtocol';

/**
 * A worker that never loads wasm.
 *
 * Everything the link does is message passing, so the tests drive the wire
 * directly. Standing up the real worker here would mean standing up MuJoCo in
 * vitest, and the tests would then be measuring the physics engine.
 */
function fakeWorker() {
  const sent: SimRequest[] = [];
  const transfers: (Transferable[] | undefined)[] = [];
  let listener: ((event: { data: SimResponse }) => void) | null = null;
  let terminated = false;

  const worker: SimWorkerLike = {
    postMessage(message, transfer) {
      sent.push(message);
      transfers.push(transfer);
    },
    addEventListener(_type, cb) {
      listener = cb;
    },
    terminate() {
      terminated = true;
    },
  };

  return {
    worker,
    sent,
    transfers,
    get terminated() {
      return terminated;
    },
    reply(message: SimResponse) {
      listener?.({ data: message });
    },
    last<T extends SimRequest['type']>(type: T) {
      const found = [...sent].reverse().find((m) => m.type === type);
      return found as Extract<SimRequest, { type: T }> | undefined;
    },
    all(type: SimRequest['type']) {
      return sent.filter((m) => m.type === type);
    },
  };
}

const HOME = Array.from({ length: 14 }, (_, i) => i * 0.01);

function stateFrame(over: Partial<Parameters<typeof encodeStateFrame>[1]> = {}): ArrayBuffer {
  const frame = encodeStateFrame(new Float32Array(STATE_FRAME_LEN), {
    joints: Float32Array.from({ length: 14 }, (_, i) => i * 0.25),
    pos: [1, 2, 0.1162],
    quat: [1, 0, 0, 0],
    gyro: [0.5, 0, -0.5],
    gravity: [0, 0, -1],
    mouth: 0,
    seated: false,
    skill: null,
    recovering: false,
    controlHz: 50,
    realtime: 1,
    ...over,
  });
  return frame.buffer as ArrayBuffer;
}

function makeLink(over: Partial<Parameters<typeof createSimLink>[0]> = {}) {
  const fake = fakeWorker();
  const link = createSimLink({
    worker: fake.worker,
    homePose: HOME,
    assets: { entry: 'scene.xml', files: { 'scene.xml': new ArrayBuffer(8) } },
    weights: { walk: new ArrayBuffer(4), stand: new ArrayBuffer(4) },
    ...over,
  });
  return { fake, link };
}

/** Get the worker as far as "ready", which is where most tests start. */
function boot(over: Partial<Parameters<typeof createSimLink>[0]> = {}) {
  const made = makeLink(over);
  made.fake.reply({ type: 'ready', engine: '3.5.1', loadMs: 517, slots: ['walk', 'stand'] });
  return made;
}

describe('startup', () => {
  it('posts init immediately, transferring the assets and the weights', () => {
    const { fake } = makeLink();
    const init = fake.last('init');
    expect(init?.assets.entry).toBe('scene.xml');
    expect(init?.homePose).toEqual(HOME);
    // Three big buffers: one asset file and two policies. Copying 2.3 MB
    // twice is exactly what transferring exists to avoid.
    expect(fake.transfers[0]).toHaveLength(3);
  });

  it('resolves ready with what the worker reported', async () => {
    const { fake, link } = makeLink();
    fake.reply({ type: 'ready', engine: '3.5.1', loadMs: 517, slots: ['walk', 'stand'] });
    await expect(link.ready()).resolves.toEqual({
      engine: '3.5.1',
      loadMs: 517,
      slots: ['walk', 'stand'],
    });
  });

  it('rejects ready on a fatal error before the model compiled', async () => {
    const { fake, link } = makeLink();
    fake.reply({ type: 'error', message: 'wasm would not instantiate', fatal: true });
    await expect(link.ready()).rejects.toThrow(/wasm would not instantiate/);
  });

  it('does not reject ready for a problem after it started', async () => {
    const { fake, link } = boot();
    fake.reply({ type: 'error', message: 'the solver diverged', fatal: false });
    await expect(link.ready()).resolves.toBeDefined();
  });

  it('reports errors to the caller, fatal or not', () => {
    const onError = vi.fn();
    const { fake } = boot({ onError });
    fake.reply({ type: 'error', message: 'nope', fatal: false });
    expect(onError).toHaveBeenCalledWith('nope', false);
  });
});

describe('state', () => {
  it('publishes a decoded frame to subscribers and says it is live', () => {
    const { fake, link } = boot();
    const seen: DuckState[] = [];
    link.subscribe((s) => seen.push(s));
    fake.reply({ type: 'state', buffer: stateFrame() });

    expect(seen).toHaveLength(1);
    expect(seen[0].health).toBe('live');
    expect(seen[0].root.pos[2]).toBeCloseTo(0.1162, 6);
    expect(seen[0].gravity).toEqual([0, 0, -1]);
    expect(Array.from(seen[0].joints)).toEqual(
      Array.from({ length: 14 }, (_, i) => i * 0.25),
    );
  });

  it('carries seated and the active skill, as the clip backend does', () => {
    const { fake, link } = boot();
    let latest: DuckState | null = null;
    link.subscribe((s) => {
      latest = s;
    });
    fake.reply({ type: 'state', buffer: stateFrame({ seated: true, skill: 'roulade' }) });
    expect(latest!.seated).toBe(true);
    expect(latest!.activeSkill).toBe('roulade');
  });

  it('reuses one state object rather than allocating per frame', () => {
    const { fake, link } = boot();
    const seen: DuckState[] = [];
    link.subscribe((s) => seen.push(s));
    fake.reply({ type: 'state', buffer: stateFrame() });
    fake.reply({ type: 'state', buffer: stateFrame({ pos: [9, 9, 9] }) });
    expect(seen[0]).toBe(seen[1]);
    expect(seen[0].root.pos[0]).toBe(9);
  });

  it('gives the buffer back so the worker pool does not run dry', () => {
    const { fake, link } = boot();
    link.subscribe(() => undefined);
    fake.reply({ type: 'state', buffer: stateFrame() });
    const recycled = fake.all('recycle');
    expect(recycled).toHaveLength(1);
    // Transferred back, not cloned -- otherwise recycling is pointless.
    expect(fake.transfers[fake.transfers.length - 1]).toHaveLength(1);
  });

  it('ignores a frame of the wrong width instead of throwing on the wire', () => {
    const { fake, link } = boot();
    const seen: DuckState[] = [];
    link.subscribe((s) => seen.push(s));
    expect(() => fake.reply({ type: 'state', buffer: new ArrayBuffer(8) })).not.toThrow();
    expect(seen).toHaveLength(0);
  });

  it('hands a late subscriber the current state at once', () => {
    const { fake, link } = boot();
    fake.reply({ type: 'state', buffer: stateFrame() });
    const seen: DuckState[] = [];
    link.subscribe((s) => seen.push(s));
    expect(seen).toHaveLength(1);
  });

  it('gives a new subscriber nothing before the first frame', () => {
    const { link } = boot();
    const seen: DuckState[] = [];
    link.subscribe((s) => seen.push(s));
    expect(seen).toHaveLength(0);
  });

  it('unsubscribes', () => {
    const { fake, link } = boot();
    const seen: DuckState[] = [];
    const off = link.subscribe((s) => seen.push(s));
    off();
    fake.reply({ type: 'state', buffer: stateFrame() });
    expect(seen).toHaveLength(0);
  });

  it('exposes the telemetry DuckState has nowhere to put', () => {
    const { fake, link } = boot();
    expect(link.telemetry()).toEqual({ recovering: false, controlHz: 0, realtime: 0 });
    fake.reply({
      type: 'state',
      buffer: stateFrame({ recovering: true, controlHz: 48.5, realtime: 0.97 }),
    });
    const t = link.telemetry();
    expect(t.recovering).toBe(true);
    expect(t.controlHz).toBeCloseTo(48.5, 4);
    expect(t.realtime).toBeCloseTo(0.97, 6);
  });
});

describe('commands', () => {
  it('posts the whole command whenever any part of it changes', () => {
    const { fake, link } = boot();
    link.move({ vx: 0.4, vy: 0, vyaw: -2 });
    link.head({ neck: 0.1, pitch: 0.2, yaw: 0.3, roll: 0.4 });
    link.mouth(0.5);
    link.pose({ z: 0.01, roll: 0, pitch: 0.02 });
    const last = fake.last('command');
    expect(last).toEqual({
      type: 'command',
      twist: { vx: 0.4, vy: 0, vyaw: -2 },
      head: { neck: 0.1, pitch: 0.2, yaw: 0.3, roll: 0.4 },
      body: { z: 0.01, roll: 0, pitch: 0.02 },
      mouth: 0.5,
    });
  });

  it('clamps the bill', () => {
    const { fake, link } = boot();
    link.mouth(5);
    expect(fake.last('command')?.mouth).toBe(1);
    link.mouth(-5);
    expect(fake.last('command')?.mouth).toBe(0);
  });

  it('zeroes the twist on stop', () => {
    const { fake, link } = boot();
    link.move({ vx: 0.4, vy: 0, vyaw: 0 });
    link.stop();
    expect(fake.last('command')?.twist).toEqual({ vx: 0, vy: 0, vyaw: 0 });
  });

  it('does not advance anything on tick -- the worker owns the clock', () => {
    const { fake, link } = boot();
    const before = fake.sent.length;
    link.tick(0.02);
    link.tick(0.02);
    expect(fake.sent.length).toBe(before);
  });
});

describe('shove and reset', () => {
  it('shoves with the tuned impulse by default', () => {
    const { fake, link } = boot();
    link.push();
    expect(fake.last('push')?.impulse).toEqual(DEFAULT_SHOVE);
  });

  it('takes a caller-supplied impulse', () => {
    const { fake, link } = boot();
    link.push([1, -1, 0.5]);
    expect(fake.last('push')?.impulse).toEqual([1, -1, 0.5]);
  });

  it('drops the drive command when reset, so it does not walk out of the keyframe', () => {
    const { fake, link } = boot();
    link.move({ vx: 0.4, vy: 0, vyaw: 0 });
    link.reset();
    expect(fake.last('reset')).toBeDefined();
    expect(fake.last('command')?.twist).toEqual({ vx: 0, vy: 0, vyaw: 0 });
  });
});

describe('policy bookkeeping', () => {
  it('does not run a skill whose policy is not there yet', () => {
    // Every skill needs a lazy policy: the two eager slots, walk and stand,
    // are locomotion, and no skill maps to either.
    const { fake, link } = boot();
    link.do('stand');
    expect(fake.last('do')).toBeUndefined();
  });

  it('fetches a lazy policy once, then runs the skill', async () => {
    const fetchPolicy = vi.fn(async (_slot: PolicySlot) => new ArrayBuffer(4));
    const { fake, link } = boot({ fetchPolicy });
    link.do('roulade');
    await vi.waitFor(() => expect(fake.last('do')).toBeDefined());

    expect(fetchPolicy).toHaveBeenCalledWith('roulade');
    // Order matters: the worker handles messages in order, so the weights must
    // be posted before the request to run them.
    const types = fake.sent.map((m) => m.type);
    expect(types.indexOf('loadPolicy')).toBeLessThan(types.indexOf('do'));
    expect(fake.last('do')?.skill).toBe('roulade');
  });

  it('fetches each policy only once, however often the button is pressed', async () => {
    const fetchPolicy = vi.fn(async (_slot: PolicySlot) => new ArrayBuffer(4));
    const { fake, link } = boot({ fetchPolicy });
    link.do('kick_left');
    link.do('kick_left');
    await vi.waitFor(() => expect(fake.all('do')).toHaveLength(2));
    link.do('kick_left');
    expect(fetchPolicy).toHaveBeenCalledTimes(1);
    expect(fake.all('loadPolicy')).toHaveLength(1);
  });

  it('sends sit and stand to the one sit/stand policy', async () => {
    const fetchPolicy = vi.fn(async (_slot: PolicySlot) => new ArrayBuffer(4));
    const { fake, link } = boot({ fetchPolicy });
    link.do('sit');
    await vi.waitFor(() => expect(fake.last('do')).toBeDefined());
    link.do('stand');
    await vi.waitFor(() => expect(fake.all('do')).toHaveLength(2));
    expect(fetchPolicy).toHaveBeenCalledTimes(1);
    expect(fetchPolicy).toHaveBeenCalledWith('sitstand');
  });

  it('reports what it is fetching and stops once it has it', async () => {
    let release: (b: ArrayBuffer) => void = () => undefined;
    const fetchPolicy = () => new Promise<ArrayBuffer>((r) => (release = r));
    const { fake, link } = boot({ fetchPolicy });
    link.do('roulade');
    expect(link.loading()).toEqual(['roulade']);
    release(new ArrayBuffer(4));
    await vi.waitFor(() => expect(fake.last('do')).toBeDefined());
    fake.reply({ type: 'policyLoaded', slot: 'roulade' });
    expect(link.loading()).toEqual([]);
  });

  it('surfaces a failed policy fetch and does not run the skill', async () => {
    const onError = vi.fn();
    const fetchPolicy = () => Promise.reject(new Error('404'));
    const { fake, link } = boot({ fetchPolicy, onError });
    link.do('roulade');
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith('404', false));
    expect(fake.last('do')).toBeUndefined();
    // The failure is forgotten, so pressing the button again retries.
    expect(link.loading()).toEqual([]);
  });

  it('does nothing for a lazy skill when no loader was given', async () => {
    const onError = vi.fn();
    const { fake, link } = boot({ onError });
    link.do('roulade');
    await vi.waitFor(() => expect(onError).toHaveBeenCalled());
    expect(onError.mock.calls[0][0]).toMatch(/no loader for the roulade policy/);
    expect(fake.last('do')).toBeUndefined();
  });

  it('treats a policy the worker announces as already loaded', () => {
    const fetchPolicy = vi.fn(async (_slot: PolicySlot) => new ArrayBuffer(4));
    const { fake, link } = boot({ fetchPolicy });
    fake.reply({ type: 'policyLoaded', slot: 'roulade' });
    link.do('roulade');
    expect(fetchPolicy).not.toHaveBeenCalled();
    expect(fake.last('do')?.skill).toBe('roulade');
  });
});

describe('dispose', () => {
  it('tells the worker to free its embind handles, then terminates it', () => {
    const { fake, link } = boot();
    link.dispose();
    expect(fake.last('dispose')).toBeDefined();
    expect(fake.terminated).toBe(true);
  });

  it('goes quiet afterwards', () => {
    const { fake, link } = boot();
    link.dispose();
    const after = fake.sent.length;
    link.move({ vx: 1, vy: 0, vyaw: 0 });
    link.push();
    link.dispose();
    expect(fake.sent.length).toBe(after);
  });

  it('rejects a ready that never arrived', async () => {
    const { link } = makeLink();
    const pending = link.ready();
    link.dispose();
    await expect(pending).rejects.toThrow(/disposed/);
  });
});

describe('parseMjcfRefs', () => {
  it('finds includes, the mesh directory and every mesh', () => {
    const refs = parseMjcfRefs(`
      <mujoco model="scene">
        <include file="robot_reduced.xml" />
        <compiler angle="radian" meshdir="assets" autolimits="true" />
        <asset>
          <mesh file="leg.msh" />
          <mesh name="sole" file="sole_left.msh" />
        </asset>
      </mujoco>`);
    expect(refs.includes).toEqual(['robot_reduced.xml']);
    expect(refs.meshdir).toBe('assets');
    expect(refs.meshes).toEqual(['leg.msh', 'sole_left.msh']);
  });

  it('copes with a scene that declares no meshes and no meshdir', () => {
    const refs = parseMjcfRefs('<mujoco><compiler angle="radian" /></mujoco>');
    expect(refs).toEqual({ includes: [], meshdir: '', meshes: [] });
  });
});

describe('loadSimAssets', () => {
  const SCENE = '<mujoco><include file="robot_reduced.xml" /></mujoco>';
  const ROBOT = '<mujoco><compiler meshdir="assets" /><mesh file="leg.msh" /></mujoco>';

  function fetcherFor(files: Record<string, string>) {
    const asked: string[] = [];
    const encoder = new TextEncoder();
    return {
      asked,
      fetcher: async (url: string) => {
        asked.push(url);
        const name = url.replace('/duck/sim/', '');
        if (!(name in files)) throw new Error(`${url}: 404`);
        return encoder.encode(files[name]).buffer as ArrayBuffer;
      },
    };
  }

  it('follows the include and mirrors the real directory layout', async () => {
    const { fetcher, asked } = fetcherFor({
      'scene.xml': SCENE,
      'robot_reduced.xml': ROBOT,
      'assets/leg.msh': 'binary',
    });
    const assets = await loadSimAssets('/duck/sim', fetcher);
    expect(assets.entry).toBe('scene.xml');
    // Mesh paths keep the meshdir prefix, because the MJCF resolves them
    // relative to it and MEMFS has to look the same as the real tree.
    expect(Object.keys(assets.files).sort()).toEqual([
      'assets/leg.msh',
      'robot_reduced.xml',
      'scene.xml',
    ]);
    expect(asked).toContain('/duck/sim/assets/leg.msh');
  });

  it('does not fetch the same file twice', async () => {
    const { fetcher, asked } = fetcherFor({
      'scene.xml': '<mujoco><include file="a.xml" /><include file="a.xml" /></mujoco>',
      'a.xml': '<mujoco><compiler meshdir="assets" /><mesh file="m.msh" /></mujoco>',
      'assets/m.msh': 'x',
    });
    await loadSimAssets('/duck/sim', fetcher);
    expect(asked.filter((u) => u.endsWith('a.xml'))).toHaveLength(1);
  });

  it('fails loudly on a missing mesh rather than compiling without it', async () => {
    const { fetcher } = fetcherFor({ 'scene.xml': SCENE, 'robot_reduced.xml': ROBOT });
    await expect(loadSimAssets('/duck/sim', fetcher)).rejects.toThrow(/404/);
  });
});

describe('the DuckLink contract', () => {
  it('implements every method the console can call', () => {
    const { link } = boot();
    const required: (keyof SimLink)[] = [
      'move',
      'head',
      'do',
      'pose',
      'mouth',
      'stop',
      'subscribe',
      'tick',
      'dispose',
      'push',
      'reset',
      'ready',
      'telemetry',
      'loading',
    ];
    for (const name of required) expect(typeof link[name], name).toBe('function');
  });
});

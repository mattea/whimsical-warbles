import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import '../styles/lab.css';
import treeJson from '../../public/duck/tree.json';
import { decodeClips } from '../lib/duck/clips';
import { createClipLink } from '../lib/duck/clipLink';
import type { DuckLink, DuckState, Skill } from '../lib/duck/link';
import { createSimLink, loadSimAssets, type SimLink } from '../lib/duck/simLink';
import type { PolicySlot, SimTelemetry } from '../lib/duck/simProtocol';
import { spawnSimWorker } from '../lib/duck/simWorkerClient';
import { loadTree } from '../lib/duck/tree';
import LabScene from './LabScene';

/**
 * The Waddle Lab console.
 *
 * Input mirrors Microduck's own gamepad table (docs/robot/cheatsheet.md) so
 * muscle memory carries over to the real robot: the left stick drives, the
 * right stick turns, A ground-picks, X rolls, the bumpers kick, D-pad-down
 * sits.
 *
 * Inert until powered on. Three.js is not work this page should do for a
 * visitor who only came to read.
 */

/**
 * Skill keys follow microduck_rl's own `infer_policy.py` bindings -- G ground
 * pick, R roulade, K/L kicks -- so the keyboard matches upstream.
 *
 * Sit and stand are one control rather than two, because they are one policy
 * driven by a posture flag: you can only sit while standing and only stand
 * while seated.
 */
const SKILLS: { id: Skill; label: string; key: string; hint: string }[] = [
  { id: 'ground_pick', label: 'Ground pick', key: 'G', hint: 'beak to the floor and back' },
  { id: 'roulade', label: 'Roulade', key: 'R', hint: 'a forward roll over the head' },
  { id: 'kick_left', label: 'Kick L', key: 'K', hint: 'left-leg kick' },
  { id: 'kick_right', label: 'Kick R', key: 'L', hint: 'right-leg kick' },
];

const DRIVE_KEYS = ['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'];

/**
 * Drive magnitudes chosen from what the shipped policy actually responds to.
 * Below vx 0.25 it holds its stance and below vyaw ~1.5 it will not turn, so a
 * gentler keypress would simply do nothing. Strafing is absent because the
 * policy cannot do it -- a lateral command produces no motion at all.
 */
const DRIVE_VX = 0.4;
const DRIVE_VX_BACK = -0.4;
const DRIVE_VYAW = 2.0;

/** Where the baked assets live, honouring Astro's configured base path. */
const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');
const CLIPS_URL = `${BASE}/duck/clips.json`;
const SIM_DIR = `${BASE}/duck/sim`;
const POLICY_DIR = `${BASE}/duck/policies`;

/**
 * The two locomotion policies, downloaded with the model because the simulator
 * cannot take its first step without them. The other five are 773 KB each and
 * wait until someone presses the button that needs them.
 */
const EAGER_POLICIES: PolicySlot[] = ['walk', 'stand'];

/**
 * What live mode costs, measured off a production build and stated before the
 * download starts rather than after it.
 *
 * Compressed, which is what a visitor actually pays: MuJoCo's wasm is 8.6 MB
 * raw and 2.1 MB gzipped, the two eager policies are 1.5 MB raw and barely
 * compress at all because they are float32 weights, and the MJCF plus its nine
 * collision meshes are 741 KB raw and 350 KB gzipped.
 */
const LIVE_COST = 'about 4 MB: a 2.1 MB physics engine, 1.4 MB of trained weights and 350 KB of robot model';

/** The boop, keyed. Nothing else in the lab uses X. */
const BOOP_KEY = 'x';

export default function LabConsole() {
  // The tree is 4 KB and the rig needs it up front, so it rides in the bundle.
  // The clips are 140 KB and are fetched on power-up instead -- inlining them
  // would ship them to every visitor who merely scrolled past.
  const tree = useMemo(() => loadTree(treeJson), []);

  const [clip, setClip] = useState<DuckLink | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [fps, setFps] = useState(0);
  const [immersive, setImmersive] = useState(false);
  const [state, setState] = useState<DuckState | null>(null);

  // Live physics. Kept alongside the playback backend rather than replacing
  // it: switching modes should not throw away a simulation that took half a
  // second to compile, and playback has to keep working for everyone who
  // never opts in.
  const [mode, setMode] = useState<'playback' | 'live'>('playback');
  const [sim, setSim] = useState<SimLink | null>(null);
  const [simLoading, setSimLoading] = useState(false);
  const [simError, setSimError] = useState<string | null>(null);
  const [telemetry, setTelemetry] = useState<SimTelemetry | null>(null);
  const live = mode === 'live' && sim !== null;
  const link: DuckLink | null = live ? sim : clip;

  const held = useRef(new Set<string>());
  /** The DOM overlay handed to an AR session, so the pad shows over the camera. */
  const padRef = useRef<HTMLDivElement | null>(null);
  // Read inside the gamepad poll, which must not re-subscribe on every change.
  const seatedRef = useRef(false);
  seatedRef.current = state?.seated ?? false;

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  /** Fetch and decode the clips, then build the link. Idempotent. */
  const powerUp = useCallback(async () => {
    if (clip) {
      setRunning(true);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(CLIPS_URL);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const built = createClipLink(tree, decodeClips(await res.json()));
      setClip(built);
      setRunning(true);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'could not load the motion data');
    } finally {
      setLoading(false);
    }
  }, [clip, tree]);

  /** One policy blob, by slot. */
  const fetchPolicy = useCallback(async (slot: PolicySlot) => {
    const res = await fetch(`${POLICY_DIR}/${slot}.bin`);
    if (!res.ok) throw new Error(`${slot} policy: ${res.status} ${res.statusText}`);
    return res.arrayBuffer();
  }, []);

  /**
   * Download MuJoCo, the model and the two locomotion policies, then start the
   * physics worker. Only ever runs when someone presses the button.
   */
  const goLive = useCallback(async () => {
    if (sim) {
      setMode('live');
      return;
    }
    setSimLoading(true);
    setSimError(null);
    // Constructed before the fetches, because building it is what starts the
    // 2.1 MB wasm download -- the long pole -- and the model and weights can
    // come down alongside it. Held here so a failure anywhere below can still
    // shut it down rather than leaving a worker running with no owner.
    let worker: Worker | null = null;
    let built: SimLink | null = null;
    try {
      worker = spawnSimWorker();
      const [assets, ...blobs] = await Promise.all([
        loadSimAssets(SIM_DIR),
        ...EAGER_POLICIES.map(fetchPolicy),
      ]);
      const weights: Partial<Record<PolicySlot, ArrayBuffer>> = {};
      EAGER_POLICIES.forEach((slot, i) => {
        weights[slot] = blobs[i];
      });

      built = createSimLink({
        worker,
        homePose: tree.homePose,
        assets,
        weights,
        fetchPolicy,
        // Non-fatal problems -- a diverged solver, a policy that would not
        // download -- are shown rather than swallowed, but they do not knock
        // the page back to playback.
        onError: (message) => setSimError(message),
      });
      await built.ready();
      setSim(built);
      setSimError(null);
      setMode('live');
    } catch (err) {
      setSimError(err instanceof Error ? err.message : 'the simulator would not start');
      // `dispose` terminates the worker, so only kill it directly when the
      // link never got as far as owning it.
      if (built) built.dispose();
      else worker?.terminate();
    } finally {
      setSimLoading(false);
    }
  }, [sim, tree, fetchPolicy]);

  // Sample state for the readout at a human rate rather than re-rendering at
  // 50 Hz. The link mutates its arrays in place, so copy before storing.
  useEffect(() => {
    if (!link) return;
    let latest: DuckState | null = null;
    const off = link.subscribe((s) => {
      latest = s;
    });
    const id = window.setInterval(() => {
      if (!latest) return;
      setState({
        ...latest,
        joints: Float32Array.from(latest.joints),
        root: { pos: [...latest.root.pos], quat: [...latest.root.quat] },
        gyro: [...latest.gyro],
        gravity: [...latest.gravity],
      });
      if (live && sim) setTelemetry(sim.telemetry());
    }, 100);
    return () => {
      off();
      window.clearInterval(id);
    };
  }, [link, live, sim]);

  // Disposal is per backend and only on unmount: switching modes must not
  // throw away the other one. Each of these runs its cleanup once, because
  // each state goes from null to a link and never changes again.
  useEffect(() => () => clip?.dispose(), [clip]);
  useEffect(() => () => sim?.dispose(), [sim]);

  // Powering down has to actually stop the physics, not merely stop drawing
  // it: the worker drives its own clock, so nothing else would. Paused while
  // in playback too -- keeping a compiled simulation warm is worth a message,
  // stepping it in the background is not.
  useEffect(() => {
    sim?.setPaused(!(running && live));
  }, [sim, running, live]);

  const pushCommand = useCallback(() => {
    if (!link) return;
    const keys = held.current;
    const fwd = keys.has('w') || keys.has('arrowup');
    const back = keys.has('s') || keys.has('arrowdown');
    const left = keys.has('a') || keys.has('arrowleft');
    const right = keys.has('d') || keys.has('arrowright');
    link.move({
      vx: (fwd ? DRIVE_VX : 0) + (back ? DRIVE_VX_BACK : 0),
      vy: 0,
      vyaw: (left ? DRIVE_VYAW : 0) + (right ? -DRIVE_VYAW : 0),
    });
  }, [link]);

  /**
   * On-screen driving, for anything without a keyboard.
   *
   * These press the same tokens the keyboard does into the same held-key set,
   * so `pushCommand` composes them identically -- there is one definition of
   * what "forward and turning left at once" means, not two. The map is keyed by
   * pointer id so two thumbs work: holding forward while turning is the whole
   * point of a drive pad.
   */
  const touchPointers = useRef(new Map<number, string>());

  const touchStart = useCallback(
    (token: string) => (e: React.PointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      // Capture keeps the press alive if the finger slides off the button, but
      // it is not essential and it throws when the id is not an active pointer.
      // Letting that escape would abandon the rest of this handler and leave
      // the key unpressed -- which is exactly how turning silently stopped
      // working while driving forward still did.
      try {
        e.currentTarget.setPointerCapture?.(e.pointerId);
      } catch {
        /* no capture; the pointerup listener still clears the key */
      }
      touchPointers.current.set(e.pointerId, token);
      held.current.add(token);
      pushCommand();
    },
    [pushCommand],
  );

  const touchEnd = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      const token = touchPointers.current.get(e.pointerId);
      if (!token) return;
      touchPointers.current.delete(e.pointerId);
      // Only clear the token if no other finger is still holding it.
      if (![...touchPointers.current.values()].includes(token)) held.current.delete(token);
      pushCommand();
    },
    [pushCommand],
  );

  // A pointer lost mid-drag must not leave the pugglenaut driving forever.
  useEffect(() => {
    if (running) return;
    touchPointers.current.clear();
  }, [running]);

  /**
   * Stop taps on the pad from also counting as an XR `select`.
   *
   * In an AR session with a DOM overlay, a tap on the overlay raises
   * `beforexrselect` and then, unless that is cancelled, `select` on the
   * session too. The lab uses `select` to place the pugglenaut, so without this
   * every press of "forward" would also pick it up and put it down again.
   */
  useEffect(() => {
    const pad = padRef.current;
    if (!pad) return;
    const swallow = (e: Event) => e.preventDefault();
    pad.addEventListener('beforexrselect', swallow);
    return () => pad.removeEventListener('beforexrselect', swallow);
  }, []);

  useEffect(() => {
    if (!running || !link) return;
    // Bound locally so the nested handlers capture a non-null link.
    const duck = link;

    const skillFor = (k: string) => SKILLS.find((s) => s.key.toLowerCase() === k)?.id;

    function down(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (DRIVE_KEYS.includes(k)) {
        e.preventDefault();
        held.current.add(k);
        pushCommand();
        return;
      }
      if (k === 'c') {
        e.preventDefault();
        duck.do(seatedRef.current ? 'stand' : 'sit');
        return;
      }
      const skill = skillFor(k);
      if (skill) {
        e.preventDefault();
        duck.do(skill);
        return;
      }
      if (k === BOOP_KEY && live && sim) {
        e.preventDefault();
        sim.push();
        return;
      }
      if (k === ' ') {
        e.preventDefault();
        duck.mouth(1);
      }
    }

    function up(e: KeyboardEvent) {
      const k = e.key.toLowerCase();
      if (held.current.delete(k)) pushCommand();
      if (k === ' ') duck.mouth(0);
    }

    // Releasing focus should not leave the pugglenaut driving into the wall.
    function blur() {
      held.current.clear();
      duck.stop();
    }

    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
      held.current.clear();
      duck.stop();
    };
  }, [running, link, pushCommand, live, sim]);

  // Real gamepads, mapped the way the robot maps them.
  useEffect(() => {
    if (!running || !link) return;
    const duck = link;
    let raf = 0;
    const pressed = new Set<number>();

    function poll() {
      raf = requestAnimationFrame(poll);
      const pad = navigator.getGamepads?.().find(Boolean);
      if (!pad) return;

      const dead = (v: number) => (Math.abs(v) < 0.15 ? 0 : v);
      duck.move({
        vx: -dead(pad.axes[1] ?? 0) * DRIVE_VX,
        vy: 0,
        vyaw: -dead(pad.axes[2] ?? 0) * DRIVE_VYAW,
      });

      const map: [number, Skill][] = [
        [0, 'ground_pick'],
        [2, 'roulade'],
        [4, 'kick_left'],
        [5, 'kick_right'],
        [13, seatedRef.current ? 'stand' : 'sit'],
      ];
      for (const [button, skill] of map) {
        if (pad.buttons[button]?.pressed) {
          if (!pressed.has(button)) {
            pressed.add(button);
            duck.do(skill);
          }
        } else {
          pressed.delete(button);
        }
      }
    }
    raf = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(raf);
  }, [running, link]);

  const fmt = (v: number) => (v >= 0 ? `+${v.toFixed(2)}` : v.toFixed(2));

  // Observation slot 5, negated: +1 standing, 0 on its side, -1 upside down.
  // Shown because it is the number the fall detector actually watches.
  const upright = state ? -state.gravity[2] : null;
  const fetching = live && sim ? sim.loading() : [];

  return (
    <div className={immersive ? 'lab is-immersive' : 'lab'}>
      <div className="lab-stage">
        {running && link ? (
          <LabScene
            link={link}
            tree={tree}
            running={running}
            reducedMotion={reduced}
            onFps={setFps}
            overlayRoot={padRef}
            onImmersive={setImmersive}
          />
        ) : (
          <div className="lab-poster">
            <p className="lab-poster-title">Waddle Lab</p>
            <p className="lab-poster-sub">
              {loadError
                ? `The motion data would not load (${loadError}).`
                : loading
                  ? 'Loading the gait\u2026'
                  : 'A pugglenaut walking on a real robot\u2019s gait. Nothing runs until you say so.'}
            </p>
          </div>
        )}

        <div className="lab-badge" data-mode={state?.health ?? 'playback'}>
          {state?.health === 'live' ? 'SIM: LIVE' : 'SIM: PLAYBACK'}
          {running && fps > 0 ? ` · ${fps} fps` : ''}
        </div>

        {/* The drive pad. Always rendered so an AR session has an overlay root
            to hand over, but only visible where there is no keyboard -- a
            coarse pointer, or an XR session. */}
        <div className="lab-pad" ref={padRef} hidden={!running}>
          <button
            type="button"
            className="lab-pad-key lab-pad-fwd"
            aria-label="Walk forward"
            onPointerDown={touchStart('w')}
            onPointerUp={touchEnd}
            onPointerCancel={touchEnd}
            onLostPointerCapture={touchEnd}
          >
            ▲
          </button>
          <button
            type="button"
            className="lab-pad-key lab-pad-left"
            aria-label="Turn left"
            onPointerDown={touchStart('a')}
            onPointerUp={touchEnd}
            onPointerCancel={touchEnd}
            onLostPointerCapture={touchEnd}
          >
            ◀
          </button>
          <button
            type="button"
            className="lab-pad-key lab-pad-right"
            aria-label="Turn right"
            onPointerDown={touchStart('d')}
            onPointerUp={touchEnd}
            onPointerCancel={touchEnd}
            onLostPointerCapture={touchEnd}
          >
            ▶
          </button>
          <button
            type="button"
            className="lab-pad-key lab-pad-back"
            aria-label="Walk backward"
            onPointerDown={touchStart('s')}
            onPointerUp={touchEnd}
            onPointerCancel={touchEnd}
            onLostPointerCapture={touchEnd}
          >
            ▼
          </button>
          {live ? (
            <button
              type="button"
              className="lab-pad-key lab-pad-boop"
              aria-label="Boop it over"
              onPointerDown={(e) => {
                e.preventDefault();
                sim?.push();
              }}
            >
              boop
            </button>
          ) : null}
        </div>
      </div>

      <div className="lab-controls">
        <button
          type="button"
          className="lab-power"
          aria-pressed={running}
          disabled={loading}
          onClick={() => {
            if (running) {
              link?.stop();
              setRunning(false);
            } else {
              void powerUp();
            }
          }}
        >
          {running ? '■ Power down' : loading ? '… Loading' : '▶ Power up'}
        </button>

        <button
          type="button"
          className="lab-skill"
          disabled={!running || !link}
          title="Sit and stand are one policy driven by a posture flag"
          onClick={() => link?.do(state?.seated ? 'stand' : 'sit')}
        >
          {state?.seated ? 'Stand up' : 'Sit down'} <kbd>C</kbd>
        </button>

        {SKILLS.map((s) => (
          <button
            key={s.id}
            type="button"
            className="lab-skill"
            disabled={!running || !link}
            title={s.hint}
            onClick={() => link?.do(s.id)}
          >
            {s.label} <kbd>{s.key}</kbd>
          </button>
        ))}

        <button
          type="button"
          className="lab-skill"
          disabled={!live}
          title="Adds 2.5 m/s sideways to the trunk in the physics engine. It falls over for real, then the stand-up policy takes over."
          onClick={() => sim?.push()}
        >
          Boop it over <kbd>X</kbd>
        </button>

        <button
          type="button"
          className="lab-skill"
          disabled={!live}
          title="Back to the standing keyframe"
          onClick={() => sim?.reset()}
        >
          Reset
        </button>
      </div>

      {/* The mode switch. Live is opt-in and says what it costs before it
          starts downloading, not after. */}
      <div className="lab-modes">
        <div className="lab-mode-buttons" role="group" aria-label="Simulation backend">
          <button
            type="button"
            className="lab-mode"
            aria-pressed={!live}
            disabled={simLoading}
            onClick={() => setMode('playback')}
          >
            Playback
          </button>
          <button
            type="button"
            className="lab-mode"
            aria-pressed={live}
            disabled={!running || simLoading}
            title={sim ? 'Real physics, already loaded' : `Downloads ${LIVE_COST}`}
            onClick={() => void goLive()}
          >
            {simLoading ? '\u2026 Loading physics' : 'Live physics'}
          </button>
        </div>
        <p className="lab-mode-hint">
          {simError ? (
            <strong>Live physics: {simError}</strong>
          ) : simLoading ? (
            <>Downloading MuJoCo and the trained weights, then compiling the robot model\u2026</>
          ) : live ? (
            <>
              MuJoCo is integrating the real Microduck model at 500 Hz in a worker, and the
              shipped policies are choosing its joint targets fifty times a second. It can be
              knocked over, and it can get back up.
              {fetching.length > 0 ? ` Fetching the ${fetching.join(', ')} policy\u2026` : ''}
            </>
          ) : (
            <>
              Live physics runs MuJoCo in your browser and downloads {LIVE_COST}. Nothing is
              fetched until you press it.
            </>
          )}
        </p>
      </div>

      <p className="lab-howto">
        <kbd>W</kbd>/<kbd>S</kbd> forward and back, <kbd>A</kbd>/<kbd>D</kbd> to
        turn (arrow keys do the same), <kbd>Space</kbd> for the bill
        {live ? (
          <>
            , <kbd>X</kbd> to boop it over
          </>
        ) : null}
        . A gamepad works too. There is no sideways: the shipped walking policy
        cannot strafe, so that command would do nothing.
      </p>

      <dl className="lab-telemetry">
        <div>
          <dt>gyro</dt>
          <dd>{state ? state.gyro.map(fmt).join('  ') : '—'}</dd>
        </div>
        <div>
          <dt>gravity</dt>
          <dd>{state ? state.gravity.map(fmt).join('  ') : '—'}</dd>
        </div>
        <div>
          <dt>position</dt>
          <dd>{state ? state.root.pos.map(fmt).join('  ') : '—'}</dd>
        </div>
        <div>
          <dt>upright</dt>
          <dd>{upright === null ? '\u2014' : fmt(upright)}</dd>
        </div>
        <div>
          <dt>skill</dt>
          <dd>
            {telemetry?.recovering && live
              ? 'recovering'
              : (state?.activeSkill ?? (state?.seated ? 'seated' : 'idle'))}
          </dd>
        </div>
        {live ? (
          <div>
            <dt>control</dt>
            <dd>
              {telemetry
                ? `${telemetry.controlHz.toFixed(1)} Hz  ${telemetry.realtime.toFixed(2)}x`
                : '\u2014'}
            </dd>
          </div>
        ) : null}
      </dl>

      <p className="lab-note">
        {live ? (
          <>
            This is not a recording. MuJoCo is stepping the real{' '}
            <strong>Microduck</strong> model &mdash; the same MJCF Pollen Robotics trains
            against &mdash; and the policies choosing its joint targets are the ones that
            ship on the robot. Falls are emergent, so no two are the same: contact and
            floating-point ordering send every tumble somewhere slightly different. When
            it goes down, the walking policy cannot right itself, so the console hands
            over to the standing policy, which can.
          </>
        ) : (
          <>
            Joint motion is recorded from the ONNX policies that ship on Pollen
            Robotics&rsquo; <strong>Microduck</strong>, replayed on that robot&rsquo;s exact
            skeleton, and the ground moves under it at the speed those recordings
            actually reached &mdash; which is well under what you ask for. In playback
            mode there is no physics, so the pugglenaut cannot fall over &mdash; switch to
            live and it can.
          </>
        )}
      </p>
    </div>
  );
}

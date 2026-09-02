import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import '../styles/lab.css';
import clipsJson from '../../public/duck/clips.json';
import treeJson from '../../public/duck/tree.json';
import { decodeClips } from '../lib/duck/clips';
import { createClipLink } from '../lib/duck/clipLink';
import type { DuckState, Skill } from '../lib/duck/link';
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
 * pick, R roulade, K/L kicks -- so the keyboard matches upstream. Sit and
 * stand get C/V because WASD already owns the letters nearer them.
 */
const SKILLS: { id: Skill; label: string; key: string }[] = [
  { id: 'ground_pick', label: 'Ground pick', key: 'G' },
  { id: 'roulade', label: 'Roulade', key: 'R' },
  { id: 'kick_left', label: 'Kick L', key: 'K' },
  { id: 'kick_right', label: 'Kick R', key: 'L' },
  { id: 'sit', label: 'Sit', key: 'C' },
  { id: 'stand', label: 'Stand', key: 'V' },
];

const DRIVE_KEYS = ['w', 'a', 's', 'd', 'arrowleft', 'arrowright'];

const DRIVE_VX = 0.3;
const DRIVE_VY = 0.1;
const DRIVE_VYAW = 1.0;

export default function LabConsole() {
  const tree = useMemo(() => loadTree(treeJson), []);
  const clips = useMemo(() => decodeClips(clipsJson), []);
  const link = useMemo(() => createClipLink(tree, clips), [tree, clips]);

  const [running, setRunning] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [fps, setFps] = useState(0);
  const [state, setState] = useState<DuckState | null>(null);
  const held = useRef(new Set<string>());

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // Sample state for the readout at a human rate rather than re-rendering at
  // 50 Hz. The link mutates its arrays in place, so copy before storing.
  useEffect(() => {
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
    }, 100);
    return () => {
      off();
      window.clearInterval(id);
    };
  }, [link]);

  useEffect(() => () => link.dispose(), [link]);

  const pushCommand = useCallback(() => {
    const keys = held.current;
    const vx = (keys.has('w') ? DRIVE_VX : 0) + (keys.has('s') ? -DRIVE_VX / 2 : 0);
    const vy = (keys.has('a') ? DRIVE_VY : 0) + (keys.has('d') ? -DRIVE_VY : 0);
    const vyaw =
      (keys.has('arrowleft') ? DRIVE_VYAW : 0) + (keys.has('arrowright') ? -DRIVE_VYAW : 0);
    link.move({ vx, vy, vyaw });
  }, [link]);

  useEffect(() => {
    if (!running) return;

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
      const skill = skillFor(k);
      if (skill) {
        e.preventDefault();
        link.do(skill);
        return;
      }
      if (k === ' ') {
        e.preventDefault();
        link.mouth(1);
      }
    }

    function up(e: KeyboardEvent) {
      const k = e.key.toLowerCase();
      if (held.current.delete(k)) pushCommand();
      if (k === ' ') link.mouth(0);
    }

    // Releasing focus should not leave the pugglenaut driving into the wall.
    function blur() {
      held.current.clear();
      link.stop();
    }

    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
      held.current.clear();
      link.stop();
    };
  }, [running, link, pushCommand]);

  // Real gamepads, mapped the way the robot maps them.
  useEffect(() => {
    if (!running) return;
    let raf = 0;
    const pressed = new Set<number>();

    function poll() {
      raf = requestAnimationFrame(poll);
      const pad = navigator.getGamepads?.().find(Boolean);
      if (!pad) return;

      const dead = (v: number) => (Math.abs(v) < 0.15 ? 0 : v);
      link.move({
        vx: -dead(pad.axes[1] ?? 0) * DRIVE_VX,
        vy: -dead(pad.axes[0] ?? 0) * DRIVE_VY,
        vyaw: -dead(pad.axes[2] ?? 0) * DRIVE_VYAW,
      });

      const map: [number, Skill][] = [
        [0, 'ground_pick'],
        [2, 'roulade'],
        [4, 'kick_left'],
        [5, 'kick_right'],
        [13, 'sit'],
      ];
      for (const [button, skill] of map) {
        if (pad.buttons[button]?.pressed) {
          if (!pressed.has(button)) {
            pressed.add(button);
            link.do(skill);
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

  return (
    <div className="lab">
      <div className="lab-stage">
        {running ? (
          <LabScene
            link={link}
            tree={tree}
            running={running}
            reducedMotion={reduced}
            onFps={setFps}
          />
        ) : (
          <div className="lab-poster">
            <p className="lab-poster-title">Waddle Lab</p>
            <p className="lab-poster-sub">
              A pugglenaut walking on a real robot&rsquo;s gait. Nothing runs until you
              say so.
            </p>
          </div>
        )}

        <div className="lab-badge" data-mode={state?.health ?? 'playback'}>
          {state?.health === 'live' ? 'SIM: LIVE' : 'SIM: PLAYBACK'}
          {running && fps > 0 ? ` · ${fps} fps` : ''}
        </div>
      </div>

      <div className="lab-controls">
        <button
          type="button"
          className="lab-power"
          aria-pressed={running}
          onClick={() => setRunning((r) => !r)}
        >
          {running ? '■ Power down' : '▶ Power up'}
        </button>

        {SKILLS.map((s) => (
          <button
            key={s.id}
            type="button"
            className="lab-skill"
            disabled={!running}
            onClick={() => link.do(s.id)}
          >
            {s.label} <kbd>{s.key}</kbd>
          </button>
        ))}
      </div>

      <p className="lab-howto">
        <kbd>W</kbd>
        <kbd>A</kbd>
        <kbd>S</kbd>
        <kbd>D</kbd> to drive, <kbd>←</kbd>
        <kbd>→</kbd> to turn, <kbd>Space</kbd> for the bill. A gamepad works too,
        mapped the way the real robot maps it.
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
          <dt>skill</dt>
          <dd>{state?.activeSkill ?? 'idle'}</dd>
        </div>
      </dl>

      <p className="lab-note">
        Joint motion is recorded from the ONNX policies that ship on Pollen
        Robotics&rsquo; <strong>Microduck</strong>, replayed on that robot&rsquo;s exact
        skeleton. In playback mode there is no physics, so the pugglenaut cannot
        fall over &mdash; that arrives with the live simulator.
      </p>
    </div>
  );
}

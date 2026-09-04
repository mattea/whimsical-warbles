import { useEffect, useRef, useState } from 'react';
import { Dialog } from '@retropolis/ui';
import { applyTheme, type Theme } from '../lib/theme';
import {
  runBootSequence,
  setSky,
  setBubbles,
  barrelRoll,
} from '../lib/effects';

/**
 * A fake terminal that is secretly the site's command center. It's an opt-in
 * overlay (opened from the ControlDeck or the backtick key), never shown by
 * default. Beyond being a toy, it's the keyboard path through the site and the
 * discoverable home of the effect commands and easter eggs.
 */

interface Line {
  kind: 'in' | 'out' | 'err' | 'sys';
  text: string;
}

const BANNER: Line[] = [
  { kind: 'sys', text: 'PUGGLENAUT MISSION CONTROL — type `help` for commands.' },
];

const ROUTES: Record<string, string> = {
  home: '/',
  logbook: '/logbook',
  links: '/links',
  charts: '/links',
  now: '/now',
  colophon: '/colophon',
  ship: '/colophon',
  game: '/game',
  arcade: '/game',
  drift: '/game',
  snake: '/game/snake',
  oracle: '/oracle',
  fortune: '/oracle',
  doodle: '/doodle',
  paint: '/doodle',
  guestbook: '/guestbook',
  contact: '/contact',
};

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function MissionControl({ open, onClose }: Props) {
  const [lines, setLines] = useState<Line[]>(BANNER);
  const [value, setValue] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [histPos, setHistPos] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      // Focus after the dialog paints.
      const t = window.setTimeout(() => inputRef.current?.focus(), 40);
      return () => window.clearTimeout(t);
    }
  }, [open]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  function print(...out: Line[]) {
    setLines((prev) => [...prev, ...out]);
  }

  function navigate(path: string) {
    print({ kind: 'out', text: `→ course laid in for ${path}` });
    window.setTimeout(() => {
      window.location.href = path;
    }, 240);
  }

  function run(raw: string) {
    const input = raw.trim();
    print({ kind: 'in', text: input });
    if (!input) return;

    setHistory((h) => [...h, input]);
    setHistPos(-1);

    const [cmd, ...args] = input.toLowerCase().split(/\s+/);
    const arg = args[0];

    switch (cmd) {
      case 'help':
        print(
          { kind: 'out', text: 'navigation : home · logbook · guestbook · links · now · colophon' },
          { kind: 'out', text: 'toys       : arcade · drift · snake · oracle · doodle · contact' },
          { kind: 'out', text: 'theme      : theme paper | crt | sketch' },
          { kind: 'out', text: 'effects    : boot · sky on|off · bubbles on|off · screensaver on|off' },
          { kind: 'out', text: 'effects    : companion on|off · roll' },
          { kind: 'out', text: 'misc       : whoami · clear · close' },
        );
        break;
      case 'clear':
        setLines(BANNER);
        break;
      case 'close':
      case 'exit':
        onClose();
        break;
      case 'whoami':
      case 'about':
        print(
          { kind: 'out', text: 'pugglenaut — a baby platypus, in space.' },
          { kind: 'out', text: 'this site is Astro + the Retropolis design system.' },
        );
        break;
      case 'theme': {
        const map: Record<string, Theme> = { paper: 'light', light: 'light', crt: 'crt', sketch: 'sketch' };
        const next = arg ? map[arg] : undefined;
        if (!next) {
          print({ kind: 'err', text: 'usage: theme paper | crt | sketch' });
        } else {
          applyTheme(next);
          print({ kind: 'out', text: `theme set to ${arg}.` });
        }
        break;
      }
      case 'boot':
        onClose();
        window.setTimeout(() => runBootSequence(), 120);
        break;
      case 'sky': {
        if (arg !== 'on' && arg !== 'off') {
          print({ kind: 'err', text: 'usage: sky on | off' });
        } else {
          setSky(arg === 'on');
          print({ kind: 'out', text: `time-aware sky ${arg}.` });
        }
        break;
      }
      case 'bubbles': {
        if (arg !== 'on' && arg !== 'off') {
          print({ kind: 'err', text: 'usage: bubbles on | off' });
        } else {
          setBubbles(arg === 'on');
          print({ kind: 'out', text: `bubble trail ${arg}.` });
        }
        break;
      }
      case 'screensaver': {
        if (arg !== 'on' && arg !== 'off') {
          print({ kind: 'err', text: 'usage: screensaver on | off' });
        } else {
          const on = arg === 'on';
          try {
            localStorage.setItem('pugglenaut-screensaver', on ? 'on' : 'off');
          } catch {
            /* storage may be unavailable */
          }
          window.dispatchEvent(new CustomEvent('pugglenaut:screensaver', { detail: { on } }));
          print({ kind: 'out', text: `screensaver ${arg}. ${on ? '(previews now; returns after ~30s idle)' : ''}`.trim() });
        }
        break;
      }
      case 'companion': {
        if (arg !== 'on' && arg !== 'off') {
          print({ kind: 'err', text: 'usage: companion on | off' });
        } else {
          const on = arg === 'on';
          try {
            localStorage.setItem('pugglenaut-companion', on ? 'on' : 'off');
          } catch {
            /* storage may be unavailable */
          }
          window.dispatchEvent(new CustomEvent('pugglenaut:companion', { detail: { on } }));
          print({ kind: 'out', text: `cursor companion ${arg}. ${on ? '(needs a mouse)' : ''}`.trim() });
        }
        break;
      }
      // Hidden: unlocks the Cosmic Radio genre pack (EDM, dubstep, DnB, rock,
      // classical, chiptune, lo-fi, synthwave) and swaps the station chips for
      // a full dropdown. Deliberately absent from `help`.
      case 'sensory-overload':
      case 'sensory': {
        const on = arg !== 'off';
        try {
          localStorage.setItem('pugglenaut-radio-pack', on ? 'on' : 'off');
        } catch {
          /* storage may be unavailable */
        }
        window.dispatchEvent(new CustomEvent('pugglenaut:radiopack', { detail: { on } }));
        if (on) {
          print(
            { kind: 'sys', text: '*** SENSORY OVERLOAD ENGAGED ***' },
            { kind: 'out', text: 'cosmic radio: 9 extra stations patched into the dial.' },
            { kind: 'out', text: 'edm · dubstep · drum&bass · rock · classical · chiptune ×2 · lo-fi · synthwave' },
            { kind: 'out', text: 'head to the home page and open the dropdown. (`sensory-overload off` to undo)' },
          );
        } else {
          print({ kind: 'out', text: 'sensory overload disengaged — back to the classic four.' });
        }
        break;
      }
      case 'roll':
        barrelRoll();
        print({ kind: 'out', text: '…doing a barrel roll. 🌀' });
        break;
      default:
        if (cmd in ROUTES) {
          navigate(ROUTES[cmd]);
        } else {
          print({ kind: 'err', text: `unknown command: ${cmd} — try \`help\`` });
        }
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === '`') {
      // Backtick toggles the console shut too (matches how it opens it) — no
      // command needs a backtick, so this never eats real input.
      e.preventDefault();
      onClose();
    } else if (e.key === 'Enter') {
      run(value);
      setValue('');
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!history.length) return;
      const pos = histPos < 0 ? history.length - 1 : Math.max(0, histPos - 1);
      setHistPos(pos);
      setValue(history[pos]);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (histPos < 0) return;
      const pos = histPos + 1;
      if (pos >= history.length) {
        setHistPos(-1);
        setValue('');
      } else {
        setHistPos(pos);
        setValue(history[pos]);
      }
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="mission-control.exe" icon="rocket">
      <div className="console">
        <div className="console-scroll" ref={scrollRef} aria-live="polite">
          {lines.map((l, i) => (
            <div key={i} className={`console-line console-${l.kind}`}>
              {l.kind === 'in' ? <span className="console-prompt">&gt;</span> : null}
              {l.text}
            </div>
          ))}
        </div>
        <label className="console-input">
          <span className="console-prompt" aria-hidden="true">&gt;</span>
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={onKeyDown}
            spellCheck={false}
            autoComplete="off"
            aria-label="Console command"
            placeholder="type a command…"
          />
        </label>
      </div>
    </Dialog>
  );
}

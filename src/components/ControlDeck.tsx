import { useEffect, useState } from 'react';
import { IconButton, Tooltip, Toast } from '@retropolis/ui';
import ThemeToggle from './ThemeToggle';
import MissionControl from './MissionControl';
import {
  isSkyOn,
  setSky,
  isBubblesOn,
  setBubbles,
  barrelRoll,
  runBootSequence,
  initKonami,
  prefersReducedMotion,
} from '../lib/effects';

/**
 * The ship's control deck — the one hydrated island in the site header. It
 * gathers the theme lab and every opt-in "delight" behind clearly-labeled
 * icons so the page itself stays calm by default:
 *   ▸ Paper / CRT / Sketch theme lab
 *   ▸ boot sequence (power)     — plays a skippable POST screen
 *   ▸ time-aware sky (clock)    — tints the page to the local hour
 *   ▸ bubble trail (sparkle)    — bubbles follow the cursor
 *   ▸ mission control (console) — a keyboard command center
 * Persisted toggles (sky, bubbles) are restored on mount. The Konami code is
 * always listening but only ever fires on the exact sequence.
 */
export default function ControlDeck() {
  const [skyOn, setSkyOn] = useState(false);
  const [bubblesOn, setBubblesOn] = useState(false);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // Restore persisted effect state, wire the Konami code and the backtick
  // shortcut. Runs once on the client.
  useEffect(() => {
    if (isSkyOn()) {
      setSky(true);
      setSkyOn(true);
    }
    if (isBubblesOn() && !prefersReducedMotion()) {
      setBubbles(true);
      setBubblesOn(true);
    }

    const cleanupKonami = initKonami(() => {
      barrelRoll();
      flash('↑↑↓↓←→←→ B A — the puggle does a spacewalk. 🚀');
    });

    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
      if (e.key === '`' && !typing) {
        e.preventDefault();
        setConsoleOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      cleanupKonami();
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  let toastTimer: number | undefined;
  function flash(msg: string) {
    window.clearTimeout(toastTimer);
    setToast(msg);
    toastTimer = window.setTimeout(() => setToast(null), 3200);
  }

  function toggleSky() {
    const next = !skyOn;
    setSky(next);
    setSkyOn(next);
  }

  function toggleBubbles() {
    if (prefersReducedMotion() && !bubblesOn) {
      flash('Bubble trail stays off while reduced-motion is on.');
      return;
    }
    const next = !bubblesOn;
    setBubbles(next);
    setBubblesOn(next);
  }

  function launchBoot() {
    runBootSequence();
  }

  return (
    <div className="control-deck cluster" style={{ gap: 8 }}>
      <ThemeToggle />
      <span className="control-deck-sep" aria-hidden="true" />
      <div className="cluster" style={{ gap: 4 }}>
        <Tooltip content="Run boot sequence" side="bottom">
          <IconButton icon="play" label="Run boot sequence" size="sm" variant="secondary" onClick={launchBoot} />
        </Tooltip>
        <Tooltip content="Time-aware sky" side="bottom">
          <IconButton
            icon="clock"
            label="Toggle time-aware sky"
            size="sm"
            variant={skyOn ? 'primary' : 'secondary'}
            aria-pressed={skyOn}
            onClick={toggleSky}
          />
        </Tooltip>
        <Tooltip content="Bubble trail" side="bottom">
          <IconButton
            icon="sparkle"
            label="Toggle bubble trail"
            size="sm"
            variant={bubblesOn ? 'primary' : 'secondary'}
            aria-pressed={bubblesOn}
            onClick={toggleBubbles}
          />
        </Tooltip>
        <Tooltip content="Mission control (`)" side="bottom">
          <IconButton
            icon="chat"
            label="Open mission control console"
            size="sm"
            variant="secondary"
            onClick={() => setConsoleOpen(true)}
          />
        </Tooltip>
      </div>

      <MissionControl open={consoleOpen} onClose={() => setConsoleOpen(false)} />

      {toast ? (
        <div className="control-deck-toast">
          <Toast tone="success" title="Cheat code" icon="rocket" onClose={() => setToast(null)}>
            {toast}
          </Toast>
        </div>
      ) : null}
    </div>
  );
}

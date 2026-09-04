import { useCallback, useEffect, useState } from 'react';
import { Button, HitCounter, Badge } from '@retropolis/ui';

/**
 * The launch bay — a tiny interactive island that also proves the React +
 * design-system hydration path works.
 *
 * The tally persists to localStorage under `pugglenaut-launches`, the same way
 * the boop counter does, so your launches survive a refresh instead of snapping
 * back to the seed every time the island mounts. It starts at LAUNCH_SEED so a
 * first visit reads like a well-used odometer rather than an empty one.
 *
 * This count is deliberately per-browser: the button is mashable, and pointing
 * a mashable button at the shared backend counter would mean a write per click.
 * The global, backend-backed tally is the visitor counter at the foot of the
 * page.
 */

const STORAGE_KEY = 'pugglenaut-launches';
const LAUNCH_SEED = 41;

function readCount(): number {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw == null) return LAUNCH_SEED;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 ? n : LAUNCH_SEED;
  } catch {
    return LAUNCH_SEED;
  }
}

function writeCount(n: number): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(n));
  } catch {
    /* storage may be unavailable (private mode) — launching still works */
  }
}

export default function LaunchControl() {
  // Start from the seed so the server HTML and the first paint agree; the
  // stored value swaps in right after mount (same trick as the boop counter).
  const [count, setCount] = useState(LAUNCH_SEED);

  useEffect(() => {
    setCount(readCount());
  }, []);

  const launch = useCallback(() => {
    setCount((prev) => {
      const next = prev + 1;
      writeCount(next);
      return next;
    });
  }, []);

  return (
    <div className="cluster" style={{ justifyContent: 'space-between' }}>
      <HitCounter count={count} label="pugglenauts launched" />
      <div className="cluster">
        <Badge tone="lime" blink>
          live
        </Badge>
        <Button variant="sunshine" icon="rocket" onClick={launch}>
          Launch another
        </Button>
      </div>
    </div>
  );
}

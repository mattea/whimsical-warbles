import { useEffect, useState } from 'react';
import { Progress } from '@retropolis/ui';
import { prefersReducedMotion } from '../lib/effects';

/**
 * Purely decorative ship telemetry — a few gauges that drift within safe bounds
 * so the console feels alive. Contained inside its Window, so it's never
 * jarring; under reduced-motion the needles simply hold still. Initial values
 * are fixed so server and first client render match.
 */
interface Gauge {
  key: string;
  label: string;
  tone: 'teal' | 'sunshine' | 'magenta';
  start: number;
  min: number;
  max: number;
}

const GAUGES: Gauge[] = [
  { key: 'o2', label: 'Oxygen', tone: 'teal', start: 96, min: 92, max: 99 },
  { key: 'snacks', label: 'Snack reserves', tone: 'sunshine', start: 88, min: 74, max: 95 },
  { key: 'vibes', label: 'Cosmic vibes', tone: 'magenta', start: 82, min: 70, max: 100 },
];

export default function PuggleTelemetry() {
  const [values, setValues] = useState<Record<string, number>>(
    Object.fromEntries(GAUGES.map((g) => [g.key, g.start])),
  );

  useEffect(() => {
    if (prefersReducedMotion()) return;
    const id = window.setInterval(() => {
      setValues((prev) => {
        const next: Record<string, number> = {};
        for (const g of GAUGES) {
          const drift = (Math.random() - 0.5) * 6;
          next[g.key] = Math.round(Math.min(g.max, Math.max(g.min, prev[g.key] + drift)));
        }
        return next;
      });
    }, 1400);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div className="telemetry stack" style={{ gap: 12 }}>
      {GAUGES.map((g) => (
        <div key={g.key} className="telemetry-row">
          <span className="telemetry-label">{g.label}</span>
          <Progress value={values[g.key]} tone={g.tone} showValue />
        </div>
      ))}
    </div>
  );
}

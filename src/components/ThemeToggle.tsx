import { useEffect, useState } from 'react';
import { Button } from '@retropolis/ui';
import { THEMES, applyTheme, currentTheme, type Theme } from '../lib/theme';

/**
 * The theme lab: a segmented control that switches between the three Retropolis
 * looks (Paper / CRT / Sketch) by toggling `data-rp-theme` on <html>. The
 * initial theme is applied pre-paint by the inline script in Base.astro; this
 * control reflects and updates it. `light` is the render default on both server
 * and first client paint so hydration matches; the effect then syncs to
 * whatever the pre-paint script actually set.
 */
export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('light');

  useEffect(() => {
    setTheme(currentTheme());
  }, []);

  function choose(next: Theme) {
    applyTheme(next);
    setTheme(next);
  }

  return (
    <div className="cluster theme-lab" role="group" aria-label="Color theme" style={{ gap: 4 }}>
      {THEMES.map((t) => (
        <Button
          key={t.id}
          size="sm"
          icon={t.icon}
          variant={theme === t.id ? 'primary' : 'ghost'}
          aria-pressed={theme === t.id}
          onClick={() => choose(t.id)}
        >
          {t.label}
        </Button>
      ))}
    </div>
  );
}

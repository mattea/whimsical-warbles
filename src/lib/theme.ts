/**
 * Theme lab — the site ships three Retropolis looks. "Paper" is the light
 * default; "CRT" is the dark phosphor terminal; "Sketch" is the hand-drawn
 * pencil theme. All three are just a `data-rp-theme` value on <html> that the
 * Retropolis stylesheet reads (Paper = the attribute absent). The pre-paint
 * script in Base.astro sets the initial value; this module reflects and updates
 * it from the React side.
 */

import type { IconName } from '@retropolis/ui';

export type Theme = 'light' | 'crt' | 'sketch';

export const THEME_KEY = 'pugglenaut-theme';

export interface ThemeMeta {
  id: Theme;
  /** Playful label, in keeping with "Paper" / "CRT". */
  label: string;
  icon: IconName;
}

/** Ordered for the segmented control. */
export const THEMES: ThemeMeta[] = [
  { id: 'light', label: 'Paper', icon: 'sun' },
  { id: 'crt', label: 'CRT', icon: 'moon' },
  { id: 'sketch', label: 'Sketch', icon: 'pencil' },
];

export function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (theme === 'light') root.removeAttribute('data-rp-theme');
  else root.setAttribute('data-rp-theme', theme);
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* storage unavailable — the toggle still works for this session */
  }
}

export function currentTheme(): Theme {
  if (typeof document === 'undefined') return 'light';
  const attr = document.documentElement.getAttribute('data-rp-theme');
  return attr === 'crt' || attr === 'sketch' ? attr : 'light';
}

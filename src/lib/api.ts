/**
 * Client for the Pugglenaut backend (a Cloudflare Worker — see `backend/`).
 *
 * The base URL comes from the PUBLIC_API_BASE build-time env var. When it is
 * empty (the default), `apiEnabled` is false and every feature falls back to a
 * static/local experience, so the site works fully before any backend exists.
 * Set PUBLIC_API_BASE (a repo Variable, wired through deploy.yml) to the
 * deployed Worker URL to switch the live features on.
 *
 * This module only ever runs in the browser (inside `client:*` islands): all
 * calls use fetch and degrade gracefully on any network/parse error.
 */

const RAW_BASE = (import.meta.env.PUBLIC_API_BASE ?? '').trim();
export const API_BASE = RAW_BASE.replace(/\/+$/, '');
export const apiEnabled = API_BASE.length > 0;

export interface GuestbookEntry {
  id: string;
  name: string;
  message: string;
  createdAt: string; // ISO 8601
}

export interface StatusInfo {
  online: boolean;
  note: string;
  updatedAt: string; // ISO 8601
}

export interface HighScore {
  id: string;
  name: string;
  score: number;
  createdAt: string; // ISO 8601
}

/** Shared anti-spam fields every public form includes. */
export interface HoneypotFields {
  /** Honeypot — must stay empty. Real users never see the field. */
  website?: string;
  /** ms epoch when the form was first shown, to reject instant bot submits. */
  startedAt: number;
}

class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  if (!apiEnabled) throw new ApiError('Backend not configured', 0);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
      signal: controller.signal,
    });
    const body = res.status === 204 ? null : await res.json().catch(() => null);
    if (!res.ok) {
      const msg = (body && (body as { error?: string }).error) || `Request failed (${res.status})`;
      throw new ApiError(msg, res.status);
    }
    return body as T;
  } finally {
    clearTimeout(timer);
  }
}

/* ---- Guestbook ---------------------------------------------------------- */

export function getGuestbook(): Promise<GuestbookEntry[]> {
  return request<GuestbookEntry[]>('/api/guestbook');
}

export function postGuestbook(input: {
  name: string;
  message: string;
} & HoneypotFields): Promise<GuestbookEntry> {
  return request<GuestbookEntry>('/api/guestbook', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/* ---- Hit counter -------------------------------------------------------- */

/** Increment the counter for a page key and return the new total. */
export function hitCounter(page: string): Promise<{ count: number }> {
  return request<{ count: number }>(`/api/counter/${encodeURIComponent(page)}`, {
    method: 'POST',
  });
}

/** Read a counter without incrementing. */
export function getCounter(page: string): Promise<{ count: number }> {
  return request<{ count: number }>(`/api/counter/${encodeURIComponent(page)}`);
}

/* ---- Contact ------------------------------------------------------------ */

export function postContact(input: {
  name: string;
  email: string;
  message: string;
} & HoneypotFields): Promise<void> {
  return request<void>('/api/contact', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/* ---- Status beacon ------------------------------------------------------ */

export function getStatus(): Promise<StatusInfo> {
  return request<StatusInfo>('/api/status');
}

/* ---- Game leaderboard --------------------------------------------------- */

export function getHighScores(): Promise<HighScore[]> {
  return request<HighScore[]>('/api/highscores');
}

export function postHighScore(input: {
  name: string;
  score: number;
} & HoneypotFields): Promise<HighScore[]> {
  return request<HighScore[]>('/api/highscores', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

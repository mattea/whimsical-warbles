/**
 * Pugglenaut backend — a single self-contained Cloudflare Worker (modules format).
 *
 * Implements the JSON API consumed by the site frontend. The exact request and
 * response shapes are the contract defined in `src/lib/api.ts`:
 *   - GuestbookEntry { id, name, message, createdAt }
 *   - StatusInfo     { online, note, updatedAt }
 *   - HighScore      { id, name, score, createdAt }
 *   - HoneypotFields { website?, startedAt }  (mixed into POST bodies)
 *
 * Storage:
 *   - D1  (binding `DB`) — durable rows: guestbook, contact, highscores.
 *   - KV  (binding `KV`) — status beacon, hit counters, per-visitor dedupe
 *                          markers, and per-IP rate-limit windows.
 *
 * The Worker has no build step of its own — `wrangler deploy` bundles this
 * TypeScript file directly.
 */

/* -------------------------------------------------------------------------- */
/* Environment bindings                                                       */
/* -------------------------------------------------------------------------- */

export interface Env {
  /** D1 database (durable relational store). */
  DB: D1Database;
  /** KV namespace (status, counters, dedupe + rate-limit markers). */
  KV: KVNamespace;

  /** Comma-separated allowlist of origins permitted by CORS. */
  ALLOWED_ORIGIN: string;

  /** Bearer token gating moderation + status writes. */
  ADMIN_TOKEN: string;

  /* Optional contact-delivery config (all secrets/vars). */
  RESEND_API_KEY?: string;
  CONTACT_TO?: string;
  CONTACT_FROM?: string;
  CONTACT_WEBHOOK?: string;
}

/* -------------------------------------------------------------------------- */
/* Response shapes (mirror src/lib/api.ts exactly)                            */
/* -------------------------------------------------------------------------- */

interface GuestbookEntry {
  id: string;
  name: string;
  message: string;
  createdAt: string;
}

interface StatusInfo {
  online: boolean;
  note: string;
  updatedAt: string;
}

interface HighScore {
  id: string;
  name: string;
  score: number;
  createdAt: string;
}

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

/** Minimum time a form must be on screen before submit (anti-bot). */
const MIN_FORM_MS = 2000;
/** Per-IP guestbook rate limit. */
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_S = 10 * 60; // 10 minutes
/** Counter dedupe marker lifetime (~24h). */
const COUNTER_TTL_S = 24 * 60 * 60;

const STATUS_KEY = 'status';
const DEFAULT_STATUS: Omit<StatusInfo, 'updatedAt'> = {
  online: false,
  note: 'Drifting somewhere in low orbit.',
};

/* -------------------------------------------------------------------------- */
/* Small helpers                                                              */
/* -------------------------------------------------------------------------- */

/** Resolve the CORS headers for a request against the ALLOWED_ORIGIN allowlist. */
function corsHeaders(request: Request, env: Env): Record<string, string> {
  const allowed = (env.ALLOWED_ORIGIN ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  const origin = request.headers.get('Origin') ?? '';
  // Echo the request Origin when it matches the allowlist; otherwise fall back
  // to the first configured origin so browsers still get a valid header.
  const allowOrigin = allowed.includes(origin) ? origin : (allowed[0] ?? '*');
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'content-type, authorization',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

/** JSON response with CORS + status. */
function json(data: unknown, request: Request, env: Env, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...corsHeaders(request, env) },
  });
}

/** Empty (204) response with CORS. */
function noContent(request: Request, env: Env): Response {
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

/** 400 with an { error } body the frontend surfaces. */
function badRequest(message: string, request: Request, env: Env): Response {
  return json({ error: message }, request, env, 400);
}

/** Verify the Authorization: Bearer <ADMIN_TOKEN> header. */
function isAdmin(request: Request, env: Env): boolean {
  const auth = request.headers.get('Authorization') ?? '';
  const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
  return !!m && !!env.ADMIN_TOKEN && m[1] === env.ADMIN_TOKEN;
}

/** Best-effort client IP (Cloudflare provides CF-Connecting-IP). */
function clientIp(request: Request): string {
  return (
    request.headers.get('CF-Connecting-IP') ??
    request.headers.get('X-Forwarded-For')?.split(',')[0].trim() ??
    'unknown'
  );
}

/** Parse a JSON body defensively; returns {} on any failure. */
async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** SHA-256 hex digest of a string (used for opaque KV keys). */
async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Count URL-ish tokens in text (used to throttle link spam). */
function countUrls(text: string): number {
  const matches = text.match(/https?:\/\/|www\./gi);
  return matches ? matches.length : 0;
}

/** Loose email sanity check (not RFC-perfect — just enough to reject junk). */
function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/**
 * Shared honeypot + timing gate for public forms. Returns an error string when
 * the submission should be rejected, or null when it passes.
 */
function honeypotError(website: unknown, startedAt: unknown): string | null {
  // Honeypot: real users never fill `website`.
  if (typeof website === 'string' && website.trim() !== '') return 'Spam detected.';
  // Timing: bots submit instantly.
  const started = typeof startedAt === 'number' ? startedAt : Number(startedAt);
  if (!Number.isFinite(started)) return 'Invalid submission.';
  if (Date.now() - started < MIN_FORM_MS) return 'Submitted too quickly.';
  return null;
}

/* -------------------------------------------------------------------------- */
/* Route handlers                                                             */
/* -------------------------------------------------------------------------- */

/* ---- Guestbook ---------------------------------------------------------- */

async function getGuestbook(request: Request, env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    'SELECT id, name, message, created_at FROM guestbook ORDER BY created_at DESC LIMIT 100',
  ).all<{ id: string; name: string; message: string; created_at: string }>();
  const entries: GuestbookEntry[] = (results ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    message: r.message,
    createdAt: r.created_at,
  }));
  return json(entries, request, env);
}

async function postGuestbook(request: Request, env: Env): Promise<Response> {
  const body = await readJson(request);
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const message = typeof body.message === 'string' ? body.message.trim() : '';

  const spam = honeypotError(body.website, body.startedAt);
  if (spam) return badRequest(spam, request, env);

  if (name.length < 1 || name.length > 40) return badRequest('Name must be 1–40 characters.', request, env);
  if (message.length < 1 || message.length > 500)
    return badRequest('Message must be 1–500 characters.', request, env);
  if (countUrls(message) > 2) return badRequest('Too many links.', request, env);

  // Per-IP rate limit: max RATE_LIMIT_MAX posts per rolling window.
  const ip = clientIp(request);
  const rlKey = `rl:guestbook:${await sha256Hex(ip)}`;
  const current = Number((await env.KV.get(rlKey)) ?? '0');
  if (current >= RATE_LIMIT_MAX) return badRequest('Slow down — try again later.', request, env);
  // Bump the counter, preserving the original window TTL as closely as KV allows.
  await env.KV.put(rlKey, String(current + 1), { expirationTtl: RATE_LIMIT_WINDOW_S });

  const entry: GuestbookEntry = {
    id: crypto.randomUUID(),
    name,
    message,
    createdAt: new Date().toISOString(),
  };
  await env.DB.prepare('INSERT INTO guestbook (id, name, message, created_at) VALUES (?, ?, ?, ?)')
    .bind(entry.id, entry.name, entry.message, entry.createdAt)
    .run();

  return json(entry, request, env, 201);
}

async function deleteGuestbook(id: string, request: Request, env: Env): Promise<Response> {
  if (!isAdmin(request, env)) return json({ error: 'Unauthorized' }, request, env, 401);
  await env.DB.prepare('DELETE FROM guestbook WHERE id = ?').bind(id).run();
  return noContent(request, env);
}

/* ---- Hit counter -------------------------------------------------------- */

function counterKey(page: string): string {
  return `counter:${page}`;
}

async function getCounter(page: string, request: Request, env: Env): Promise<Response> {
  const count = Number((await env.KV.get(counterKey(page))) ?? '0');
  return json({ count }, request, env);
}

async function hitCounter(page: string, request: Request, env: Env): Promise<Response> {
  const key = counterKey(page);
  const count = Number((await env.KV.get(key)) ?? '0');

  // Dedupe per visitor per UTC day: opaque marker keyed by hash(IP + page + date).
  const utcDate = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const marker = `seen:${await sha256Hex(`${clientIp(request)}|${page}|${utcDate}`)}`;
  const alreadyCounted = await env.KV.get(marker);
  if (alreadyCounted) {
    // Already counted today — return the current total unchanged.
    return json({ count }, request, env);
  }

  const next = count + 1;
  await env.KV.put(key, String(next));
  await env.KV.put(marker, '1', { expirationTtl: COUNTER_TTL_S });
  return json({ count: next }, request, env);
}

/* ---- Status beacon ------------------------------------------------------ */

async function getStatus(request: Request, env: Env): Promise<Response> {
  const raw = await env.KV.get(STATUS_KEY);
  if (raw) {
    try {
      return json(JSON.parse(raw) as StatusInfo, request, env);
    } catch {
      /* fall through to default */
    }
  }
  const status: StatusInfo = { ...DEFAULT_STATUS, updatedAt: new Date().toISOString() };
  return json(status, request, env);
}

async function postStatus(request: Request, env: Env): Promise<Response> {
  if (!isAdmin(request, env)) return json({ error: 'Unauthorized' }, request, env, 401);
  const body = await readJson(request);
  const status: StatusInfo = {
    online: Boolean(body.online),
    note: typeof body.note === 'string' ? body.note.slice(0, 280) : DEFAULT_STATUS.note,
    updatedAt: new Date().toISOString(),
  };
  await env.KV.put(STATUS_KEY, JSON.stringify(status));
  return json(status, request, env);
}

/* ---- Contact ------------------------------------------------------------ */

async function postContact(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const body = await readJson(request);
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const message = typeof body.message === 'string' ? body.message.trim() : '';

  const spam = honeypotError(body.website, body.startedAt);
  if (spam) return badRequest(spam, request, env);

  if (name.length < 1 || name.length > 40) return badRequest('Name must be 1–40 characters.', request, env);
  if (!looksLikeEmail(email)) return badRequest('A valid email is required.', request, env);
  if (message.length < 1 || message.length > 1000)
    return badRequest('Message must be 1–1000 characters.', request, env);

  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  await env.DB.prepare('INSERT INTO contact (id, name, email, message, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(id, name, email, message, createdAt)
    .run();

  // Best-effort delivery — never let a delivery failure fail the request.
  ctx.waitUntil(deliverContact({ id, name, email, message, createdAt }, env));

  return noContent(request, env);
}

/** Deliver a contact message via Resend or a generic webhook; swallow errors. */
async function deliverContact(
  msg: { id: string; name: string; email: string; message: string; createdAt: string },
  env: Env,
): Promise<void> {
  try {
    if (env.RESEND_API_KEY && env.CONTACT_TO) {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${env.RESEND_API_KEY}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          from: env.CONTACT_FROM ?? 'Pugglenaut <onboarding@resend.dev>',
          to: [env.CONTACT_TO],
          reply_to: msg.email,
          subject: `New contact from ${msg.name}`,
          text: `From: ${msg.name} <${msg.email}>\nAt: ${msg.createdAt}\n\n${msg.message}`,
        }),
      });
    } else if (env.CONTACT_WEBHOOK) {
      await fetch(env.CONTACT_WEBHOOK, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(msg),
      });
    }
  } catch {
    // Intentionally ignored — the message is already persisted in D1.
  }
}

/* ---- High scores -------------------------------------------------------- */

async function topScores(env: Env): Promise<HighScore[]> {
  const { results } = await env.DB.prepare(
    'SELECT id, name, score, created_at FROM highscores ORDER BY score DESC, created_at ASC LIMIT 10',
  ).all<{ id: string; name: string; score: number; created_at: string }>();
  return (results ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    score: r.score,
    createdAt: r.created_at,
  }));
}

async function getHighScores(request: Request, env: Env): Promise<Response> {
  return json(await topScores(env), request, env);
}

async function postHighScore(request: Request, env: Env): Promise<Response> {
  const body = await readJson(request);
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const score = typeof body.score === 'number' ? body.score : Number(body.score);

  const spam = honeypotError(body.website, body.startedAt);
  if (spam) return badRequest(spam, request, env);

  if (name.length < 1 || name.length > 16) return badRequest('Name must be 1–16 characters.', request, env);
  if (!Number.isInteger(score) || score < 0 || score > 10_000_000)
    return badRequest('Invalid score.', request, env);

  await env.DB.prepare('INSERT INTO highscores (id, name, score, created_at) VALUES (?, ?, ?, ?)')
    .bind(crypto.randomUUID(), name, score, new Date().toISOString())
    .run();

  return json(await topScores(env), request, env);
}

/* -------------------------------------------------------------------------- */
/* Router                                                                     */
/* -------------------------------------------------------------------------- */

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // CORS preflight — answer every OPTIONS with the allow headers.
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, ''); // tolerate trailing slash
    const method = request.method.toUpperCase();

    try {
      /* Guestbook */
      if (path === '/api/guestbook') {
        if (method === 'GET') return await getGuestbook(request, env);
        if (method === 'POST') return await postGuestbook(request, env);
      }
      const gbDelete = /^\/api\/guestbook\/([^/]+)$/.exec(path);
      if (gbDelete && method === 'DELETE') {
        return await deleteGuestbook(decodeURIComponent(gbDelete[1]), request, env);
      }

      /* Counter */
      const counter = /^\/api\/counter\/([^/]+)$/.exec(path);
      if (counter) {
        const page = decodeURIComponent(counter[1]);
        if (method === 'GET') return await getCounter(page, request, env);
        if (method === 'POST') return await hitCounter(page, request, env);
      }

      /* Status */
      if (path === '/api/status') {
        if (method === 'GET') return await getStatus(request, env);
        if (method === 'POST') return await postStatus(request, env);
      }

      /* Contact */
      if (path === '/api/contact' && method === 'POST') {
        return await postContact(request, env, ctx);
      }

      /* High scores */
      if (path === '/api/highscores') {
        if (method === 'GET') return await getHighScores(request, env);
        if (method === 'POST') return await postHighScore(request, env);
      }

      return json({ error: 'Not found' }, request, env, 404);
    } catch (err) {
      // Last-resort guard so a thrown handler never leaks a raw stack trace.
      return json({ error: 'Internal error' }, request, env, 500);
    }
  },
} satisfies ExportedHandler<Env>;

# Pugglenaut backend

A single self-contained Cloudflare Worker implementing the JSON API the site
frontend expects (see `../src/lib/api.ts` for the exact contract). It uses:

- **D1** (binding `DB`) for durable rows: guestbook, contact, high scores.
- **KV** (binding `KV`) for the status beacon, hit counters, per-visitor dedupe
  markers, and per-IP rate-limit windows.

There is no build step — `wrangler deploy` bundles `worker.ts` directly.

> `wrangler` is a local devDependency, not a global — so every command below is
> `npx wrangler …` (or an `npm run` script). Run them from this `backend/`
> folder. Requires Node ≥ 18 and wrangler 4.

## Endpoints

| Method + path                | Purpose                                              | Auth        |
| ---------------------------- | ---------------------------------------------------- | ----------- |
| `GET /api/guestbook`         | Newest 100 entries                                   | —           |
| `POST /api/guestbook`        | Create entry → 201                                   | —           |
| `DELETE /api/guestbook/:id`  | Moderate/delete → 204                                | admin bearer|
| `GET /api/counter/:page`     | Read counter (no increment)                          | —           |
| `POST /api/counter/:page`    | Increment (deduped per visitor/day)                  | —           |
| `GET /api/status`            | Status beacon                                        | —           |
| `POST /api/status`           | Update beacon                                        | admin bearer|
| `POST /api/contact`          | Send a message → 204 (best-effort delivery)          | —           |
| `GET /api/highscores`        | Top 10 scores                                        | —           |
| `POST /api/highscores`       | Submit a score → new top 10                          | —           |

All public forms carry the honeypot fields (`website` must stay empty,
`startedAt` ms-epoch must be ≥ 2000 ms in the past).

## First-time setup (one-time)

The D1 and KV resources for this project already exist and their IDs are
committed in `wrangler.toml`, so on a normal checkout you can skip straight to
**steps 1–2, 5–6** (auth, secrets, deploy). Steps 3–4 are only for standing up
a **fresh** set of resources (a new Cloudflare account, a second environment).

```sh
# 1. Install tooling (from backend/)
npm install

# 2. Authenticate wrangler against your Cloudflare account (opens a browser).
#    Persists locally — you only redo this when the token expires.
npx wrangler login

# 3. (Fresh resources only) Create the D1 database, then copy the printed
#    database_id into wrangler.toml under [[d1_databases]].
npx wrangler d1 create pugglenaut

# 4. (Fresh resources only) Create the KV namespace, then copy the printed
#    id into wrangler.toml under [[kv_namespaces]].
npx wrangler kv namespace create KV

# 5. Apply the schema to the REMOTE (production) D1 — creates the tables +
#    the highscores index. NOTE the --remote flag: without it wrangler writes
#    to a local simulator DB, not the database your deployed Worker uses.
npm run db:init          # = wrangler d1 execute pugglenaut --remote --file schema.sql

# 6. Set the admin token (gates DELETE guestbook + POST status). Use a long
#    random string. Secrets are encrypted at Cloudflare — never put them in
#    wrangler.toml or git.
npx wrangler secret put ADMIN_TOKEN

# 7. (Optional) Contact delivery. Pick ONE path:
#    a) Resend email:
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put CONTACT_TO      # destination inbox
npx wrangler secret put CONTACT_FROM    # optional; a verified Resend sender
#    b) Generic webhook (Slack/Discord/etc.) — used only if Resend is unset:
npx wrangler secret put CONTACT_WEBHOOK

# 8. Deploy
npm run deploy           # = wrangler deploy
```

On your **first ever** Worker deploy, Cloudflare may prompt you to register a
free `*.workers.dev` subdomain — wrangler walks you through it. After deploy it
prints the Worker URL, e.g. `https://pugglenaut-api.<your-subdomain>.workers.dev`.

### A note on the IDs in `wrangler.toml`

The `database_id` and KV `id` are **account-scoped resource identifiers, not
secrets** — they can't be used to reach your data without your Cloudflare auth,
so they're committed here to keep the backend deployable from a clean checkout.
Real secrets (`ADMIN_TOKEN`, `RESEND_API_KEY`, …) are set with
`wrangler secret put`, stored encrypted at Cloudflare, and must never be
committed. (`.dev.vars`, used for local secrets, is gitignored.)

## When do you need to deploy again?

`npm run deploy` re-uploads the Worker. You only need it when the **Worker
itself changes**:

- **Redeploy** after editing `worker.ts` or `wrangler.toml` (new endpoint,
  changed validation, CORS/origin change, new binding, etc.).
- **No redeploy needed** for day-to-day use: creating databases/KV is one-time,
  and all the *data* (guestbook rows, counters, status, scores) lives in
  Cloudflare and persists across deploys. Adding/reading/moderating data is just
  API calls (see the curl snippets) — no deploy.
- **Secrets** (`wrangler secret put …`) apply to the running Worker on their
  own — no full redeploy required.

So after the initial setup, deploys are rare — only when the backend code or its
config actually changes.

### Turn the live features on

Set the site's repo **Variable** `PUBLIC_API_BASE` to the Worker URL (no
trailing slash), then re-run the site's **Deploy to GitHub Pages** workflow. The
frontend reads it at build time — while it is empty, every feature falls back to
a static/local experience.

`[vars] ALLOWED_ORIGIN` in `wrangler.toml` is a comma-separated allowlist of
origins CORS permits; the matching request `Origin` is echoed back (falling back
to the first entry). Change it and redeploy the Worker if you serve the site
from a new origin.

## Handy curl snippets

Flip the status beacon on (no deploy needed):

```sh
curl -X POST https://pugglenaut-api.<sub>.workers.dev/api/status \
  -H "authorization: Bearer $ADMIN_TOKEN" \
  -H "content-type: application/json" \
  -d '{"online":true,"note":"Back on the ground for a bit."}'
```

Delete a guestbook row (moderation; IDs come from `GET /api/guestbook`):

```sh
curl -X DELETE https://pugglenaut-api.<sub>.workers.dev/api/guestbook/<id> \
  -H "authorization: Bearer $ADMIN_TOKEN"
```

Inspect stored contact messages straight from D1 (no delivery needed):

```sh
npx wrangler d1 execute pugglenaut --remote \
  --command "SELECT created_at, name, email, message FROM contact ORDER BY created_at DESC LIMIT 20"
```

## Contact delivery options

`POST /api/contact` always persists the message to D1 first, then delivers
**best-effort** (a delivery failure never fails the HTTP response):

- If `RESEND_API_KEY` **and** `CONTACT_TO` are set → emails via the Resend API
  (`CONTACT_FROM` overrides the default sender; the visitor's address is set as
  `reply_to`).
- Else if `CONTACT_WEBHOOK` is set → POSTs the message JSON to that URL.
- Else → the message is stored only (read it with the D1 query above).

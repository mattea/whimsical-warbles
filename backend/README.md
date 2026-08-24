# Pugglenaut backend

A single self-contained Cloudflare Worker implementing the JSON API the site
frontend expects (see `../src/lib/api.ts` for the exact contract). It uses:

- **D1** (binding `DB`) for durable rows: guestbook, contact, high scores.
- **KV** (binding `KV`) for the status beacon, hit counters, per-visitor dedupe
  markers, and per-IP rate-limit windows.

There is no build step — `wrangler deploy` bundles `worker.ts` directly.

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
`startedAt` ms-epoch must be ≥ 2000ms in the past).

## Deploy — step by step

```sh
# 1. Install tooling
npm install

# 2. Authenticate wrangler against your Cloudflare account
wrangler login

# 3. Create the D1 database, then copy the printed database_id into
#    wrangler.toml (replace REPLACE_WITH_D1_ID).
wrangler d1 create pugglenaut

# 4. Apply the schema (creates tables + the highscores index)
npm run db:init

# 5. Create the KV namespace, then copy the printed id into wrangler.toml
#    (replace REPLACE_WITH_KV_ID).
wrangler kv namespace create KV

# 6. Set the admin token (gates DELETE guestbook + POST status)
wrangler secret put ADMIN_TOKEN

# 7. (Optional) Contact delivery. Pick ONE path:
#    a) Resend email:
wrangler secret put RESEND_API_KEY
wrangler secret put CONTACT_TO      # destination inbox
wrangler secret put CONTACT_FROM    # optional; a verified Resend sender
#    b) Generic webhook (Slack/Discord/etc.) — used only if Resend is unset:
wrangler secret put CONTACT_WEBHOOK

# 8. Deploy
npm run deploy
```

After deploy, wrangler prints the Worker URL, e.g.
`https://pugglenaut-api.<your-subdomain>.workers.dev`.

### Turn the live features on

Set the site's repo **Variable** `PUBLIC_API_BASE` to that Worker URL (no
trailing slash). The frontend reads it at build time — while it is empty every
feature falls back to a static/local experience.

Also confirm `[vars] ALLOWED_ORIGIN` in `wrangler.toml` lists the site's
origin(s). It is a comma-separated allowlist; the matching request `Origin` is
echoed back (falling back to the first entry). Update and re-deploy to change it.

## Handy curl snippets

Flip the status beacon on:

```sh
curl -X POST https://pugglenaut-api.<sub>.workers.dev/api/status \
  -H "authorization: Bearer $ADMIN_TOKEN" \
  -H "content-type: application/json" \
  -d '{"online":true,"note":"Back on the ground for a bit."}'
```

Delete a guestbook row (moderation):

```sh
curl -X DELETE https://pugglenaut-api.<sub>.workers.dev/api/guestbook/<id> \
  -H "authorization: Bearer $ADMIN_TOKEN"
```

## Contact delivery options

`POST /api/contact` always persists the message to D1 first, then delivers
**best-effort** (a delivery failure never fails the HTTP response):

- If `RESEND_API_KEY` **and** `CONTACT_TO` are set → emails via the Resend API
  (`CONTACT_FROM` overrides the default sender; the visitor's address is set as
  `reply_to`).
- Else if `CONTACT_WEBHOOK` is set → POSTs the message JSON to that URL.
- Else → the message is stored only (readable in the D1 `contact` table).

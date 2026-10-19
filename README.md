# Visitor analytics

First-party, consent-based visitor analytics for a Next.js site, with an authenticated admin dashboard.
Stack: Next.js 16 (App Router) · TypeScript · PostgreSQL · Vitest (+ PGlite for real-SQL tests).

## Quick start (local)

Requires Node 20.12+ and Docker.

```bash
npm install
npm run db:up                         # Postgres 17 on localhost:5433
cp .env.example .env.local
npm run hash-password                 # prints ADMIN_PASSWORD_HASH, SESSION_SECRET, CRON_SECRET
#   → paste those three lines into .env.local
npm run db:migrate
npm run dev                           # http://localhost:3000 (server.mjs + Next dev)
```

* Site: `http://localhost:3000`. Accept the consent banner, browse, and click the tagged buttons.
* Dashboard: `http://localhost:3000/admin`.
* Optional demo data: `npm run seed:demo` (40 synthetic visits through the real ingestion path, mock enrichment).
* Tests: `npm test` (no database needed). Typecheck: `npm run typecheck`.

Always start the app with `npm run dev` or `npm start`, which run `server.mjs`. Plain `next dev` / `next start` cannot see the TCP peer address, so IPs are recorded as *unknown* (unless `IP_SOURCE=vercel` on Vercel).

## What is collected

| Category | Fields |
|---|---|
| **Observed by server** | receive time, public IP (resolved per `IP_SOURCE`), User-Agent, Accept-Language, returning-visitor id (cookie, only with consent) |
| **Reported by browser** | page path (sanitized), referrer **origin**, `navigator.languages`, configured time zone, screen size, viewport size, `maxTouchPoints`, `navigator.webdriver`, explicitly tagged click events |
| **Inferred / estimated** | browser, OS, device category (from UA); bot/link-preview classification; country/region/city, ISP, org, ASN and VPN/proxy/Tor/hosting indicators from the IP lookup provider (with source and lookup date) |

Unavailable values are stored as `NULL` and shown as *unknown*. The field guide at `/admin/fields` and the
visitor-facing `/privacy` page are generated from the same definitions (`lib/field-docs.ts`).

**Not collected, by design:** canvas/audio/WebGL/font probing, typed text or input values, session replay,
camera/microphone/geolocation, third-party scripts, cross-site identifiers. Click events record only a
developer-defined name and label:

```html
<button data-analytics-event="plan_select" data-analytics-label="backpacker">Choose</button>
```

## Consent

`ANALYTICS_CONSENT_MODE`:

* `opt-in` (default): nothing is sent or stored until the visitor accepts. Enforced on the **server** too: `/api/collect` drops events without a `va_consent=granted` cookie.
* `opt-out`: anonymous analytics with a notice and no persistent identifier. The returning-visitor cookie is set only after acceptance. Declining or a Global Privacy Control signal (`HONOR_GPC=true`) stops collection.
* `disabled`: collection off entirely.

Visitors can reopen *Privacy choices* from the footer and can delete their own data from `/privacy`. That deletes visits tied to their visitor cookie and current session, then opts them out.

## Client IP and proxies

Forwarded headers are client-controllable, so they are read **only** from proxies you configure:

| `IP_SOURCE` | Behaviour |
|---|---|
| `socket` (default) | TCP peer address from `server.mjs`. All `X-Forwarded-For`/`X-Real-IP`/`CF-Connecting-IP` headers are ignored. Use when nothing sits in front of Node. |
| `trusted-proxies` | If the peer is in `TRUSTED_PROXY_CIDRS`, read `TRUSTED_PROXY_HEADER`. For `x-forwarded-for` the chain is walked right-to-left, skipping trusted hops, and the first untrusted address wins (client-prepended values are ignored). Untrusted peers: headers ignored. |
| `vercel` | Uses Vercel's platform-overwritten `x-real-ip`. Honoured only when `VERCEL=1`. |

`server.mjs` strips any incoming `x-va-peer-*` headers and sets the peer IP together with a per-process random token, which the app verifies before trusting it. `IP_STORAGE=truncated` stores /24 (IPv4) or /48 (IPv6) instead of full IPs. List views always mask IPs.

## IP enrichment

Runs server-side after the response (`after()`), with a timeout and a 24-hour cache. Browsers never contact the provider, and API keys stay server-side.

* `IP_LOOKUP_PROVIDER=ipinfo` + `IP_LOOKUP_API_KEY`: ipinfo.io. VPN/proxy/Tor/hosting flags appear only if your plan returns the `privacy` object; otherwise *unknown*.
* `IP_LOOKUP_PROVIDER=ip-api` + key: ip-api.com Pro (HTTPS). Its single `proxy` flag means "proxy, VPN or Tor"; VPN and Tor stay *unknown*.
* `mock` (default, or any provider without a key): deterministic sample data, labelled **MOCK** everywhere in the dashboard.
* `none`: no lookups.

Private, reserved and documentation ranges are never sent to a real provider. VPN use is never inferred from language or time-zone mismatches.

## Counting, bots and duplicates

* Each event carries a random `eventId` (unique in the DB). Retries reuse it, and duplicates are ignored (`ON CONFLICT DO NOTHING`).
* The tracker keeps a module-level guard on the last tracked URL, so React Strict Mode double effects and re-renders don't double-count. This was verified in dev mode in a real browser.
* Visits that ran the script but self-identify as bots, previewers, headless browsers, HTTP libraries, or report `navigator.webdriver` are flagged and excluded from human totals by default (dashboard *Traffic* filter).
* Crawlers and link previewers (Slack, Discord, Facebook/iMessage, etc.) that fetch pages without running JS are counted by `proxy.ts` as **aggregate** daily counters (agent family + path, with no IP or UA stored).

## Security controls

* Ingestion: JSON schema with unknown keys rejected (`lib/events.ts`), an 8 KB body cap enforced while streaming, at most 20 events per request, cross-site beacons rejected, and a Postgres-backed rate limit per IP (`RATE_LIMIT_EVENTS_PER_MINUTE`, keyed by salted hash). Paths keep only allow-listed query params, and email/token-like path segments are redacted. Referrers are reduced to their origin.
* Dashboard: scrypt password hash, HMAC-signed 8-hour session cookie (`HttpOnly`, `SameSite=Strict`). Authorization is checked server-side in every admin page and API handler. Mutations require same-origin requests, and login is rate-limited (10 per 15 minutes per IP). Rotate `SESSION_SECRET` to revoke all sessions.
* Response headers: `Permissions-Policy` denies camera, microphone and geolocation. Admin pages use `no-store` and `X-Frame-Options: DENY`.

## Retention and deletion

* Default 30 days (`RETENTION_DAYS`), overridable in **Admin → Settings** (1–3650 days).
* Purge runs at most hourly per instance while traffic arrives, on dashboard load, via the daily cron (`vercel.json` → `GET /api/cron/retention` with `Authorization: Bearer $CRON_SECRET`), or with `npm run retention` (for system cron elsewhere).
* Deletion options: delete a single visit, all visits for a visitor id, or everything (typed confirmation).

## Deploy

### Vercel

1. Create a Postgres database (e.g. Neon via the Vercel Marketplace) and set `DATABASE_URL` (with `?sslmode=require`).
2. Set the environment variables: `ADMIN_PASSWORD_HASH`, `SESSION_SECRET`, `CRON_SECRET`, `IP_SOURCE=vercel`, `ANALYTICS_CONSENT_MODE`, and optionally `IP_LOOKUP_PROVIDER` / `IP_LOOKUP_API_KEY`, `RETENTION_DAYS`.
3. Run migrations once against that database: `DATABASE_URL=... npm run db:migrate`.
4. Deploy (`vercel deploy --prod` or Git integration). The cron in `vercel.json` handles retention.
   *If another proxy/CDN (e.g. Cloudflare) sits in front of Vercel, `x-real-ip` will be that proxy's address. Configure it to pass the client IP and adjust accordingly.*

### Any Node host / container / VM

1. Provision Postgres and set `DATABASE_URL` plus the variables above.
2. `npm ci && npm run build && npm run db:migrate && npm start` (`PORT` defaults to 3000).
3. Behind a reverse proxy or load balancer: `IP_SOURCE=trusted-proxies` and `TRUSTED_PROXY_CIDRS=<the proxy's addresses>`. For Cloudflare directly in front, use Cloudflare's published ranges with `TRUSTED_PROXY_HEADER=cf-connecting-ip`.
4. Schedule `npm run retention` daily (or call the cron endpoint with the bearer secret).
5. Serve over HTTPS so cookies get the `Secure` flag.

## Layout

```
server.mjs              custom server: verified TCP peer address
proxy.ts                aggregate crawler / link-preview counters
migrations/             SQL migrations (npm run db:migrate)
lib/                    config, ip, consent, events, collect, enrich, auth, retention, queries, handlers
app/(site)/             demo site + privacy notice (tracker mounted here only)
app/admin/              login + protected dashboard
app/api/                collect, consent, privacy/delete, admin/*, cron/retention
components/analytics/   tracker + consent banner
tests/                  vitest suites (PGlite, real migrations)
```

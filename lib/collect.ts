import { randomUUID } from "node:crypto";
import { classifyAgent } from "./bots";
import type { AppConfig } from "./config";
import { CONSENT_COOKIE, VISITOR_COOKIE, decideCollection, parseConsentCookie, readCookie } from "./consent";
import type { Db } from "./db";
import { enrichVisit } from "./enrich";
import { MAX_BODY_BYTES, readLimitedBody, validatePayload } from "./events";
import { resolveClientIp, truncateIp } from "./ip";
import { consumeRateLimit } from "./ratelimit";
import { maybePurge } from "./retention";
import { sanitizePath, sanitizeReferrerOrigin } from "./sanitize";
import { parseUserAgent } from "./ua";

export type CollectDeps = {
  db: Db;
  config: AppConfig;
  peerIp: string | null;
  /** Runs work after the response is sent (next/server `after` in production). */
  schedule: (task: () => Promise<unknown>) => void;
  now?: Date;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CLOCK_SKEW_MS = 24 * 3_600_000;

function reply(status: number, body: unknown, cookies: string[] = [], extra: Record<string, string> = {}): Response {
  const headers = new Headers({ "content-type": "application/json", "cache-control": "no-store", ...extra });
  for (const c of cookies) headers.append("set-cookie", c);
  return new Response(body === null ? null : JSON.stringify(body), { status, headers });
}

function visitorCookie(id: string, maxAgeDays: number, secure: boolean): string {
  return `${VISITOR_COOKIE}=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeDays * 86400}${secure ? "; Secure" : ""}`;
}
export function clearVisitorCookie(secure: boolean): string {
  return `${VISITOR_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;
}

/** First-party only: reject beacons sent from other sites. */
function isFirstParty(req: Request): boolean {
  const site = req.headers.get("sec-fetch-site");
  if (site === "cross-site") return false;
  const origin = req.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === (req.headers.get("x-forwarded-host") ?? req.headers.get("host"));
  } catch {
    return false;
  }
}

export async function handleCollect(req: Request, deps: CollectDeps): Promise<Response> {
  const { db, config } = deps;
  const now = deps.now ?? new Date();
  const secure = new URL(req.url).protocol === "https:";
  const cookieHeader = req.headers.get("cookie");

  if (req.method !== "POST") return reply(405, { error: "method not allowed" }, [], { allow: "POST" });
  if (!isFirstParty(req)) return reply(403, { error: "cross-site collection is not accepted" });

  // Consent is enforced here, not only in the browser.
  const decision = decideCollection({
    mode: config.consentMode,
    choice: parseConsentCookie(readCookie(cookieHeader, CONSENT_COOKIE)),
    gpc: req.headers.get("sec-gpc") === "1",
    honorGpc: config.honorGpc,
  });
  const existingVid = readCookie(cookieHeader, VISITOR_COOKIE);
  if (!decision.collect) {
    return reply(204, null, existingVid ? [clearVisitorCookie(secure)] : []);
  }

  const ctype = req.headers.get("content-type") ?? "";
  if (!/^(application\/json|text\/plain)\b/i.test(ctype)) return reply(415, { error: "expected application/json" });
  const body = await readLimitedBody(req, MAX_BODY_BYTES);
  if (body === null) return reply(413, { error: `payload exceeds ${MAX_BODY_BYTES} bytes` });
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return reply(400, { error: "invalid JSON" });
  }
  const v = validatePayload(raw);
  if (!v.ok) return reply(v.status, { error: v.error });
  const payload = v.payload;

  const { ip, source: ipSource } = resolveClientIp({ peerIp: deps.peerIp, headers: req.headers, config });

  const limit = await consumeRateLimit(db, {
    bucket: "collect",
    subject: ip ?? `unknown:${deps.peerIp ?? "none"}`,
    limit: config.rateLimitPerMinute,
    cost: payload.events.length,
    salt: config.rateLimitSalt,
    now,
  });
  if (!limit.allowed) return reply(429, { error: "rate limited" }, [], { "retry-after": String(limit.retryAfter) });

  const events = payload.events
    .map((e) => ({ ...e, path: sanitizePath(e.path, config.allowedQueryParams) }))
    .filter((e): e is typeof e & { path: string } => e.path !== null);
  if (events.length === 0) return reply(400, { error: "no valid event paths" });

  const userAgent = req.headers.get("user-agent")?.slice(0, 512) ?? null;
  const agent = classifyAgent(userAgent, { webdriver: payload.env.webdriver });
  const parsed = parseUserAgent(userAgent, req.headers.get("sec-ch-ua-mobile"));

  const cookies: string[] = [];
  let visitorId: string | null = null;
  if (decision.visitorId) {
    visitorId = existingVid && UUID.test(existingVid) ? existingVid : randomUUID();
    cookies.push(visitorCookie(visitorId, config.visitorIdMaxAgeDays, secure));
  } else if (existingVid) {
    cookies.push(clearVisitorCookie(secure));
  }

  const storedIp = ip && config.ipStorage === "truncated" ? truncateIp(ip) : ip;
  const landing = events.find((e) => e.type === "pageview")?.path ?? events[0].path;
  const initialEnrichment = config.ipLookupProvider === "none" ? "disabled" : ip ? "pending" : "skipped-unknown";

  const { visitId, inserted, accepted } = await db.transaction(async (tx) => {
    const visit = await tx.query<{ id: string; inserted: boolean }>(
      `INSERT INTO visits (
         session_id, visitor_id, consent_state, started_at, last_seen_at,
         ip, ip_source, user_agent, accept_language,
         landing_path, referrer_origin, languages, time_zone,
         screen_width, screen_height, viewport_width, viewport_height, max_touch_points, webdriver,
         browser_name, browser_version, os_name, os_version, device_category,
         is_bot, bot_category, bot_reason, enrichment_status)
       VALUES ($1,$2,$3,$4,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)
       ON CONFLICT (session_id) DO UPDATE SET
         last_seen_at = GREATEST(visits.last_seen_at, EXCLUDED.last_seen_at),
         visitor_id = COALESCE(visits.visitor_id, EXCLUDED.visitor_id),
         viewport_width = EXCLUDED.viewport_width,
         viewport_height = EXCLUDED.viewport_height
       RETURNING id, (xmax = 0) AS inserted`,
      [
        payload.sessionId, visitorId, decision.basis, now,
        storedIp, ipSource, userAgent, req.headers.get("accept-language")?.slice(0, 256) ?? null,
        landing, sanitizeReferrerOrigin(payload.referrer), JSON.stringify(payload.env.languages), payload.env.timeZone,
        payload.env.screen?.w ?? null, payload.env.screen?.h ?? null,
        payload.env.viewport?.w ?? null, payload.env.viewport?.h ?? null,
        payload.env.maxTouchPoints, payload.env.webdriver,
        parsed.browserName, parsed.browserVersion, parsed.osName, parsed.osVersion, parsed.deviceCategory,
        agent.isBot, agent.category, agent.reason, initialEnrichment,
      ],
    );
    const { id, inserted } = visit.rows[0];
    let accepted = 0;
    for (const e of events) {
      const clientTs = Math.abs(e.ts - now.getTime()) <= CLOCK_SKEW_MS ? new Date(e.ts) : null;
      // event_id is the idempotency key: retries and duplicate effects are ignored.
      const r = await tx.query(
        `INSERT INTO events (event_id, visit_id, type, name, label, path, occurred_at, received_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (event_id) DO NOTHING`,
        [e.eventId, id, e.type, e.type === "click" ? e.name : null, e.type === "click" ? (e.label ?? null) : null, e.path, clientTs, now],
      );
      accepted += r.rowCount;
    }
    return { visitId: id, inserted, accepted };
  });

  if (inserted && initialEnrichment === "pending") {
    deps.schedule(() => enrichVisit(db, visitId, ip, config));
  }
  deps.schedule(() => maybePurge(db, config));

  return reply(202, { accepted, duplicates: events.length - accepted }, cookies);
}

import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { handleCollect } from "@/lib/collect";
import type { Db } from "@/lib/db";
import { CHROME_UA, collectRequest, payload, resetDb, scheduler, testConfig, testDb, uuid } from "./helpers";

let db: Db;
beforeAll(async () => {
  db = await testDb();
});
beforeEach(() => resetDb(db));

const run = async (req: Request, cfg = {}, peerIp: string | null = "198.51.100.20") => {
  const s = scheduler();
  const res = await handleCollect(req, { db, config: testConfig(cfg), peerIp, schedule: s.schedule });
  await s.flush();
  return res;
};
const count = async (table: string) => (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n;

describe("consent enforcement on the server", () => {
  it("opt-in: stores nothing without a consent cookie, even if the client sends events", async () => {
    const res = await run(collectRequest(payload()));
    expect(res.status).toBe(204);
    expect(await count("visits")).toBe(0);
    expect(await count("events")).toBe(0);
  });

  it("opt-in: stores events and sets an HttpOnly visitor id after consent", async () => {
    const res = await run(collectRequest(payload(), { cookie: "va_consent=granted" }));
    expect(res.status).toBe(202);
    const setCookie = res.headers.getSetCookie().join("\n");
    expect(setCookie).toMatch(/va_vid=[0-9a-f-]{36}; Path=\/; HttpOnly; SameSite=Lax/);
    const v = (await db.query<{ visitor_id: string; consent_state: string }>(`SELECT visitor_id, consent_state FROM visits`)).rows[0];
    expect(v.visitor_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(v.consent_state).toBe("granted");
  });

  it("reuses an existing visitor id so returning visits link up", async () => {
    const vid = "11111111-2222-4333-8444-555555555555";
    await run(collectRequest(payload(), { cookie: `va_consent=granted; va_vid=${vid}` }));
    await run(collectRequest(payload(), { cookie: `va_consent=granted; va_vid=${vid}` }));
    const r = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM visits WHERE visitor_id = $1`, [vid]);
    expect(r.rows[0].n).toBe(2);
  });

  it("declined consent stores nothing and clears any visitor cookie", async () => {
    const res = await run(collectRequest(payload(), { cookie: "va_consent=denied; va_vid=11111111-2222-4333-8444-555555555555" }));
    expect(res.status).toBe(204);
    expect(res.headers.getSetCookie().join()).toMatch(/va_vid=; .*Max-Age=0/);
    expect(await count("visits")).toBe(0);
  });

  it("opt-out mode: anonymous analytics without any persistent identifier", async () => {
    const res = await run(collectRequest(payload()), { ANALYTICS_CONSENT_MODE: "opt-out" });
    expect(res.status).toBe(202);
    expect(res.headers.getSetCookie()).toHaveLength(0);
    const v = (await db.query<{ visitor_id: string | null; consent_state: string }>(`SELECT visitor_id, consent_state FROM visits`)).rows[0];
    expect(v).toEqual({ visitor_id: null, consent_state: "not-required" });
  });

  it("opt-out mode honors Global Privacy Control", async () => {
    const res = await run(collectRequest(payload(), { "sec-gpc": "1" }), { ANALYTICS_CONSENT_MODE: "opt-out" });
    expect(res.status).toBe(204);
    expect(await count("visits")).toBe(0);
  });

  it("disabled mode ignores even consented visitors", async () => {
    const res = await run(collectRequest(payload(), { cookie: "va_consent=granted" }), { ANALYTICS_CONSENT_MODE: "disabled" });
    expect(res.status).toBe(204);
  });
});

describe("ingestion validation and limits", () => {
  const granted = { cookie: "va_consent=granted" };

  it("rejects payloads over 8 KB with 413", async () => {
    const big = payload({ referrer: "https://x.example/" + "a".repeat(9000) });
    expect((await run(collectRequest(big, granted))).status).toBe(413);
  });

  it("rejects bodies that lie about content-length or stream past the limit", async () => {
    const req = new Request("http://localhost:3000/api/collect", {
      method: "POST",
      headers: { "content-type": "application/json", host: "localhost:3000", cookie: "va_consent=granted" },
      body: new ReadableStream({
        start(c) {
          for (let i = 0; i < 10; i++) c.enqueue(new TextEncoder().encode("x".repeat(1024)));
          c.close();
        },
      }),
      // @ts-expect-error node fetch requires duplex for streams
      duplex: "half",
    });
    expect((await run(req)).status).toBe(413);
  });

  it.each([
    ["unknown top-level field", { ...payload(), extra: 1 }],
    ["unknown env field (e.g. a canvas hash)", { ...payload(), env: { ...payload().env, canvasHash: "abc" } }],
    ["bad session id", payload({ sessionId: "not-a-uuid" })],
    ["absolute URL as path", payload({}, [{ type: "pageview", eventId: uuid(), path: "https://evil.example/", ts: Date.now() }])],
    ["free-text click label", payload({}, [{ type: "click", eventId: uuid(), path: "/", ts: Date.now(), name: "signup", label: "<script>alert(1)</script>" }])],
    ["typed-text style event", payload({}, [{ type: "input", eventId: uuid(), path: "/", ts: Date.now(), value: "hunter2" }])],
    ["too many events", payload({}, Array.from({ length: 21 }, () => ({ type: "pageview", eventId: uuid(), path: "/", ts: Date.now() })))],
  ])("rejects %s", async (_name, body) => {
    const res = await run(collectRequest(body, granted));
    expect(res.status).toBe(400);
    expect(await count("events")).toBe(0);
  });

  it("rejects invalid JSON and wrong content types", async () => {
    expect((await run(collectRequest("{nope", granted))).status).toBe(400);
    expect((await run(collectRequest(payload(), { ...granted, "content-type": "application/x-www-form-urlencoded" }))).status).toBe(415);
  });

  it("rejects cross-site beacons", async () => {
    const res = await run(collectRequest(payload(), { ...granted, origin: "https://other-site.example", "sec-fetch-site": "cross-site" }));
    expect(res.status).toBe(403);
  });

  it("rate-limits per client IP", async () => {
    const cfg = { RATE_LIMIT_EVENTS_PER_MINUTE: "3" };
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) statuses.push((await run(collectRequest(payload(), granted), cfg)).status);
    expect(statuses).toEqual([202, 202, 202, 429, 429]);
    // A different client is unaffected.
    expect((await run(collectRequest(payload(), granted), cfg, "198.51.100.99")).status).toBe(202);
  });

  it("strips sensitive query parameters and keeps only the referrer origin", async () => {
    await run(collectRequest(payload(), granted));
    const v = (await db.query<{ landing_path: string; referrer_origin: string }>(`SELECT landing_path, referrer_origin FROM visits`)).rows[0];
    expect(v.landing_path).toBe("/pricing?utm_source=newsletter");
    expect(v.referrer_origin).toBe("https://news.example.com");
  });
});

describe("deduplication", () => {
  it("ignores retried events with the same eventId", async () => {
    const body = payload();
    const first = await run(collectRequest(body, { cookie: "va_consent=granted" }));
    const retry = await run(collectRequest(body, { cookie: "va_consent=granted" }));
    expect(await first.json()).toEqual({ accepted: 1, duplicates: 0 });
    expect(await retry.json()).toEqual({ accepted: 0, duplicates: 1 });
    expect(await count("events")).toBe(1);
    expect(await count("visits")).toBe(1);
  });

  it("rejects duplicate eventIds inside one batch", async () => {
    const id = uuid();
    const body = payload({}, [
      { type: "pageview", eventId: id, path: "/", ts: Date.now() },
      { type: "pageview", eventId: id, path: "/", ts: Date.now() },
    ]);
    expect((await run(collectRequest(body, { cookie: "va_consent=granted" }))).status).toBe(400);
  });
});

describe("observed vs inferred data", () => {
  it("records server-observed IP and UA, inferred device data, and labeled mock enrichment", async () => {
    await run(collectRequest(payload(), { cookie: "va_consent=granted", "x-forwarded-for": "6.6.6.6" }));
    const v = (await db.query<Record<string, unknown>>(`SELECT * FROM visits`)).rows[0];
    expect(v.ip).toBe("198.51.100.20"); // spoofed XFF ignored in default socket mode
    expect(v.ip_source).toBe("socket");
    expect(v.user_agent).toBe(CHROME_UA);
    expect(v.browser_name).toBe("Chrome");
    expect(v.device_category).toBe("desktop");
    expect(v.is_bot).toBe(false);
    expect(v.enrichment_status).toBe("mock");
    expect(v.enrichment_source).toMatch(/mock/);
    expect(v.net_isp).toMatch(/MOCK/);
  });

  it("marks unknown IPs and skips enrichment", async () => {
    await run(collectRequest(payload(), { cookie: "va_consent=granted" }), {}, null);
    const v = (await db.query<Record<string, unknown>>(`SELECT ip, enrichment_status, geo_city FROM visits`)).rows[0];
    expect(v).toEqual({ ip: null, enrichment_status: "skipped-unknown", geo_city: null });
  });

  it("flags link previewers and automation separately from people", async () => {
    await run(collectRequest(payload(), { cookie: "va_consent=granted", "user-agent": "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)" }));
    await run(collectRequest(payload({ env: { ...payload().env, webdriver: true } }), { cookie: "va_consent=granted" }), {}, "198.51.100.30");
    const rows = (await db.query<{ is_bot: boolean; bot_category: string }>(`SELECT is_bot, bot_category FROM visits ORDER BY started_at, bot_category`)).rows;
    expect(rows.map((r) => r.bot_category).sort()).toEqual(["automation", "link-preview"]);
    expect(rows.every((r) => r.is_bot)).toBe(true);
  });

  it("truncates stored IPs when IP_STORAGE=truncated", async () => {
    await run(collectRequest(payload(), { cookie: "va_consent=granted" }), { IP_STORAGE: "truncated" });
    expect((await db.query<{ ip: string }>(`SELECT ip FROM visits`)).rows[0].ip).toBe("198.51.100.0");
  });
});

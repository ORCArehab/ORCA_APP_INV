import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { decideCollection, parseConsentCookie, readCookie } from "@/lib/consent";
import type { Db } from "@/lib/db";
import { handleConsent, handlePrivacyDelete } from "@/lib/handlers";
import { resetDb, testConfig, testDb } from "./helpers";

describe("decideCollection", () => {
  const d = (mode: "opt-in" | "opt-out" | "disabled", choice: "granted" | "denied" | null, gpc = false) =>
    decideCollection({ mode, choice, gpc, honorGpc: true });

  it("opt-in collects nothing until the visitor accepts", () => {
    expect(d("opt-in", null)).toMatchObject({ collect: false, visitorId: false });
    expect(d("opt-in", "granted")).toMatchObject({ collect: true, visitorId: true, basis: "granted" });
    expect(d("opt-in", "denied")).toMatchObject({ collect: false, visitorId: false });
  });

  it("opt-out collects anonymously but never sets a visitor id without acceptance", () => {
    expect(d("opt-out", null)).toMatchObject({ collect: true, visitorId: false, basis: "not-required" });
    expect(d("opt-out", "denied")).toMatchObject({ collect: false });
    expect(d("opt-out", "granted")).toMatchObject({ collect: true, visitorId: true });
  });

  it("GPC opts out in opt-out mode; an explicit acceptance still wins", () => {
    expect(d("opt-out", null, true)).toMatchObject({ collect: false });
    expect(d("opt-out", "granted", true)).toMatchObject({ collect: true });
    expect(decideCollection({ mode: "opt-out", choice: null, gpc: true, honorGpc: false }).collect).toBe(true);
  });

  it("disabled overrides everything", () => {
    expect(d("disabled", "granted")).toMatchObject({ collect: false, visitorId: false });
  });

  it("parses cookies strictly", () => {
    expect(parseConsentCookie("granted")).toBe("granted");
    expect(parseConsentCookie("yes")).toBeNull();
    expect(readCookie("a=1; va_consent=denied; b=2", "va_consent")).toBe("denied");
    expect(readCookie("xva_consent=granted", "va_consent")).toBeNull();
  });
});

describe("consent and privacy endpoints", () => {
  let db: Db;
  beforeAll(async () => {
    db = await testDb();
  });
  beforeEach(() => resetDb(db));

  const req = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    new Request(`http://localhost:3000${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", host: "localhost:3000", origin: "http://localhost:3000", ...headers },
      body: JSON.stringify(body),
    });

  it("stores the choice in a first-party cookie and clears the visitor id on decline", async () => {
    const granted = await handleConsent(req("/api/consent", { choice: "granted" }));
    expect(granted.headers.get("set-cookie")).toMatch(/^va_consent=granted; Path=\/; SameSite=Lax; Max-Age=/);
    const denied = await handleConsent(req("/api/consent", { choice: "denied" }, { cookie: "va_vid=11111111-2222-4333-8444-555555555555" }));
    const cookies = denied.headers.getSetCookie();
    expect(cookies[0]).toMatch(/^va_consent=denied/);
    expect(cookies[1]).toMatch(/^va_vid=; .*Max-Age=0/);
  });

  it("validates the choice and rejects cross-site requests", async () => {
    expect((await handleConsent(req("/api/consent", { choice: "maybe" }))).status).toBe(400);
    expect((await handleConsent(req("/api/consent", { choice: "granted" }, { origin: "https://evil.example" }))).status).toBe(403);
  });

  it("lets a visitor delete their own analytics", async () => {
    const vid = "11111111-2222-4333-8444-555555555555";
    const sid = "22222222-2222-4333-8444-555555555555";
    const insert = (session: string, visitor: string | null) =>
      db.query(`INSERT INTO visits (session_id, visitor_id, consent_state, started_at, last_seen_at, ip_source, landing_path) VALUES ($1, $2, 'granted', now(), now(), 'socket', '/')`, [session, visitor]);
    await insert("33333333-2222-4333-8444-555555555555", vid);
    await insert(sid, null);
    await insert("44444444-2222-4333-8444-555555555555", "99999999-2222-4333-8444-555555555555"); // someone else

    const res = await handlePrivacyDelete(req("/api/privacy/delete", { sessionId: sid }, { cookie: `va_vid=${vid}` }), { db, config: testConfig(), peerIp: null });
    expect(await res.json()).toEqual({ deleted: 2 });
    expect(res.headers.get("set-cookie")).toMatch(/^va_vid=; /);
    expect((await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM visits`)).rows[0].n).toBe(1);
  });
});

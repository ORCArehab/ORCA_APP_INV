import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createSessionToken, hashPassword, verifyPassword, verifySessionToken } from "@/lib/auth";
import type { Db } from "@/lib/db";
import {
  handleAdminDeleteVisit, handleAdminDeleteVisitor, handleAdminGetVisit, handleAdminListVisits, handleAdminPurge,
  handleAdminSettings, handleCronRetention, handleLogin, type Deps,
} from "@/lib/handlers";
import { resetDb, testConfig, testDb } from "./helpers";

const SECRET = "s".repeat(48);
let db: Db;
let deps: Deps;
let visitId: string;

beforeAll(async () => {
  db = await testDb();
  deps = { db, config: testConfig({ SESSION_SECRET: SECRET, ADMIN_PASSWORD_HASH: await hashPassword("correct horse"), CRON_SECRET: "cron-secret-value" }), peerIp: "198.51.100.1" };
});
beforeEach(async () => {
  await resetDb(db);
  const r = await db.query<{ id: string }>(
    `INSERT INTO visits (session_id, visitor_id, consent_state, started_at, last_seen_at, ip, ip_source, landing_path)
     VALUES (gen_random_uuid(), '11111111-2222-4333-8444-555555555555', 'granted', now(), now(), '203.0.113.45', 'socket', '/') RETURNING id`,
  );
  visitId = r.rows[0].id;
});

const BASE = "http://localhost:3000";
const adminReq = (path: string, init: RequestInit & { cookie?: string | null; origin?: string | null } = {}) => {
  const headers = new Headers(init.headers);
  headers.set("host", "localhost:3000");
  if (init.origin !== null) headers.set("origin", init.origin ?? BASE);
  if (init.cookie) headers.set("cookie", init.cookie);
  return new Request(BASE + path, { ...init, headers });
};
const validCookie = () => `va_admin=${createSessionToken(SECRET)}`;
const visitCount = async () => (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM visits`)).rows[0].n;

describe("password hashing and session tokens", () => {
  it("verifies scrypt hashes", async () => {
    const h = await hashPassword("pw-1");
    expect(await verifyPassword("pw-1", h)).toBe(true);
    expect(await verifyPassword("pw-2", h)).toBe(false);
    expect(await verifyPassword("pw-1", "garbage")).toBe(false);
  });
  it("produces hashes that survive dotenv variable expansion (no `$`)", async () => {
    expect(await hashPassword("pw")).toMatch(/^scrypt\.16384\.8\.1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });
  it("rejects tampered, foreign-secret and expired tokens", () => {
    const t = createSessionToken(SECRET);
    expect(verifySessionToken(t, SECRET)).toBe(true);
    expect(verifySessionToken(t, "other".repeat(10))).toBe(false);
    const [v, exp, nonce, sig] = t.split(".");
    expect(verifySessionToken([v, String(Number(exp) + 99999), nonce, sig].join("."), SECRET)).toBe(false);
    expect(verifySessionToken(createSessionToken(SECRET, Date.now() - 9 * 3600_000), SECRET)).toBe(false);
    expect(verifySessionToken("", SECRET)).toBe(false);
  });
});

describe("dashboard API authorization (enforced server-side)", () => {
  const cases: [string, (cookie: string | null) => Promise<Response>][] = [
    ["list visits", (c) => handleAdminListVisits(adminReq("/api/admin/visits", { cookie: c }), deps)],
    ["visit detail", (c) => handleAdminGetVisit(adminReq(`/api/admin/visits/${visitId}`, { cookie: c }), deps, visitId)],
    ["delete visit", (c) => handleAdminDeleteVisit(adminReq(`/api/admin/visits/${visitId}`, { method: "DELETE", cookie: c }), deps, visitId)],
    ["delete visitor", (c) => handleAdminDeleteVisitor(adminReq(`/api/admin/visitors/x`, { method: "DELETE", cookie: c }), deps, "11111111-2222-4333-8444-555555555555")],
    ["settings", (c) => handleAdminSettings(adminReq(`/api/admin/settings`, { method: "POST", cookie: c, body: '{"retentionDays":7}' }), deps)],
    ["purge all", (c) => handleAdminPurge(adminReq(`/api/admin/purge`, { method: "POST", cookie: c, body: '{"scope":"all","confirm":"DELETE ALL"}' }), deps)],
  ];

  it.each(cases)("%s → 401 without a session", async (_n, call) => {
    expect((await call(null)).status).toBe(401);
    expect(await visitCount()).toBe(1);
  });

  it.each(cases)("%s → 401 with a forged session", async (_n, call) => {
    expect((await call("va_admin=v1.9999999999.abc.forgedsignature")).status).toBe(401);
    expect(await visitCount()).toBe(1);
  });

  it("returns 401 for everything when the dashboard is not configured", async () => {
    const unconfigured = { ...deps, config: testConfig({ SESSION_SECRET: SECRET }) };
    const res = await handleAdminListVisits(adminReq("/api/admin/visits", { cookie: validCookie() }), unconfigured);
    expect(res.status).toBe(401);
  });

  it("lists visits with masked IPs only", async () => {
    const res = await handleAdminListVisits(adminReq("/api/admin/visits", { cookie: validCookie() }), deps);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.visits[0].ip_masked).toBe("203.0.•••.•••");
    expect(JSON.stringify(body)).not.toContain("203.0.113.45");
  });

  it("detail view (authorized) includes the full IP", async () => {
    const res = await handleAdminGetVisit(adminReq(`/api/admin/visits/${visitId}`, { cookie: validCookie() }), deps, visitId);
    expect((await res.json()).visit.ip).toBe("203.0.113.45");
  });

  it("blocks cross-origin mutations even with a valid session (CSRF)", async () => {
    const req = adminReq(`/api/admin/visits/${visitId}`, { method: "DELETE", cookie: validCookie(), origin: "https://evil.example" });
    expect((await handleAdminDeleteVisit(req, deps, visitId)).status).toBe(403);
    expect(await visitCount()).toBe(1);
  });

  it("deletes a visit when authorized", async () => {
    const req = adminReq(`/api/admin/visits/${visitId}`, { method: "DELETE", cookie: validCookie() });
    expect(await (await handleAdminDeleteVisit(req, deps, visitId)).json()).toEqual({ deleted: 1 });
    expect(await visitCount()).toBe(0);
  });

  it("delete-all requires explicit confirmation", async () => {
    const noConfirm = adminReq(`/api/admin/purge`, { method: "POST", cookie: validCookie(), body: '{"scope":"all"}' });
    expect((await handleAdminPurge(noConfirm, deps)).status).toBe(400);
    expect(await visitCount()).toBe(1);
  });
});

describe("login", () => {
  const login = (password: string, origin?: string) =>
    handleLogin(
      adminReq("/api/admin/login", { method: "POST", origin, headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ password }).toString() }),
      deps,
    );

  it("issues an HttpOnly SameSite=Strict session for the right password", async () => {
    const res = await login("correct horse");
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/admin");
    expect(res.headers.get("set-cookie")).toMatch(/^va_admin=v1\..*HttpOnly; SameSite=Strict/);
  });

  it("rejects wrong passwords without setting a cookie", async () => {
    const res = await login("wrong");
    expect(res.headers.get("location")).toBe("/admin/login?error=invalid");
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("rate-limits password guessing", async () => {
    const locations: string[] = [];
    for (let i = 0; i < 12; i++) locations.push((await login("wrong")).headers.get("location")!);
    expect(locations.slice(0, 10).every((l) => l.endsWith("invalid"))).toBe(true);
    expect(locations.slice(10).every((l) => l.endsWith("rate"))).toBe(true);
    // Even the right password is refused while limited.
    expect((await login("correct horse")).headers.get("location")).toBe("/admin/login?error=rate");
  });

  it("rejects cross-site login posts", async () => {
    expect((await login("correct horse", "https://evil.example")).status).toBe(403);
  });
});

describe("cron endpoint", () => {
  it("requires the bearer secret", async () => {
    const call = (auth?: string) => handleCronRetention(new Request(`${BASE}/api/cron/retention`, { headers: auth ? { authorization: auth } : {} }), deps);
    expect((await call()).status).toBe(401);
    expect((await call("Bearer wrong")).status).toBe(401);
    expect((await call("Bearer cron-secret-value")).status).toBe(200);
  });
});

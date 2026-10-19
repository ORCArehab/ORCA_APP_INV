import { timingSafeEqual } from "node:crypto";
import {
  authConfigProblem, clearSessionCookie, createSessionToken, isSameOrigin, requireAdmin, sessionCookie, verifyPassword,
} from "./auth";
import { clearVisitorCookie } from "./collect";
import type { AppConfig } from "./config";
import { CONSENT_COOKIE, CONSENT_MAX_AGE_DAYS, VISITOR_COOKIE, readCookie } from "./consent";
import type { Db } from "./db";
import { maskIp, resolveClientIp } from "./ip";
import { deleteAllAnalytics, deleteVisit, deleteVisitor, getVisit, listVisits, parseFilters } from "./queries";
import { consumeRateLimit } from "./ratelimit";
import { purgeExpired, setRetentionDays } from "./retention";

export type Deps = { db: Db; config: AppConfig; peerIp: string | null };

const json = (status: number, body: unknown, cookies: string[] = []) => {
  const headers = new Headers({ "content-type": "application/json", "cache-control": "no-store" });
  for (const c of cookies) headers.append("set-cookie", c);
  return new Response(JSON.stringify(body), { status, headers });
};
const isHttps = (req: Request) => new URL(req.url).protocol === "https:";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  const text = await req.text().catch(() => "");
  if (text.length > 4096) return null;
  try {
    const v = JSON.parse(text || "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

// ---------- visitor-facing ----------

export async function handleConsent(req: Request): Promise<Response> {
  if (!isSameOrigin(req)) return json(403, { error: "cross-origin request rejected" });
  const body = await readJson(req);
  const choice = body?.choice;
  if (choice !== "granted" && choice !== "denied") return json(400, { error: "choice must be 'granted' or 'denied'" });
  const secure = isHttps(req) ? "; Secure" : "";
  const cookies = [`${CONSENT_COOKIE}=${choice}; Path=/; SameSite=Lax; Max-Age=${CONSENT_MAX_AGE_DAYS * 86400}${secure}`];
  if (choice === "denied" && readCookie(req.headers.get("cookie"), VISITOR_COOKIE)) cookies.push(clearVisitorCookie(isHttps(req)));
  return json(200, { choice }, cookies);
}

/** Lets a visitor erase analytics tied to their visitor cookie and/or current session. */
export async function handlePrivacyDelete(req: Request, deps: Deps): Promise<Response> {
  if (!isSameOrigin(req)) return json(403, { error: "cross-origin request rejected" });
  const body = await readJson(req);
  const sessionId = typeof body?.sessionId === "string" && UUID.test(body.sessionId) ? body.sessionId : null;
  const vid = readCookie(req.headers.get("cookie"), VISITOR_COOKIE);
  const visitorId = vid && UUID.test(vid) ? vid : null;
  let deleted = 0;
  if (visitorId) deleted += await deleteVisitor(deps.db, visitorId);
  if (sessionId) deleted += (await deps.db.query(`DELETE FROM visits WHERE session_id = $1`, [sessionId])).rowCount;
  return json(200, { deleted }, visitorId ? [clearVisitorCookie(isHttps(req))] : []);
}

// ---------- admin auth ----------

export async function handleLogin(req: Request, deps: Deps): Promise<Response> {
  const problem = authConfigProblem(deps.config);
  const redirect = (to: string, cookies: string[] = []) => {
    const headers = new Headers({ location: to, "cache-control": "no-store" });
    for (const c of cookies) headers.append("set-cookie", c);
    return new Response(null, { status: 303, headers });
  };
  if (problem) return redirect("/admin/login?error=config");
  if (!isSameOrigin(req)) return json(403, { error: "cross-origin request rejected" });

  const { ip } = resolveClientIp({ peerIp: deps.peerIp, headers: req.headers, config: deps.config });
  const limit = await consumeRateLimit(deps.db, {
    bucket: "login", subject: ip ?? "unknown", limit: 10, windowSeconds: 900, salt: deps.config.rateLimitSalt,
  });
  if (!limit.allowed) return redirect("/admin/login?error=rate");

  let password = "";
  const ctype = req.headers.get("content-type") ?? "";
  if (ctype.includes("application/json")) password = String((await readJson(req))?.password ?? "");
  else password = String((await req.formData().catch(() => null))?.get("password") ?? "");
  if (!password || password.length > 256 || !(await verifyPassword(password, deps.config.adminPasswordHash!))) {
    return redirect("/admin/login?error=invalid");
  }
  return redirect("/admin", [sessionCookie(createSessionToken(deps.config.sessionSecret!), isHttps(req))]);
}

export function handleLogout(req: Request): Response {
  if (!isSameOrigin(req)) return json(403, { error: "cross-origin request rejected" });
  return new Response(null, { status: 303, headers: { location: "/admin/login", "set-cookie": clearSessionCookie(isHttps(req)) } });
}

// ---------- admin API ----------

export async function handleAdminListVisits(req: Request, deps: Deps): Promise<Response> {
  const denied = requireAdmin(req, deps.config);
  if (denied) return denied;
  const url = new URL(req.url);
  const filters = parseFilters(Object.fromEntries(url.searchParams));
  const rows = await listVisits(deps.db, filters, { limit: Number(url.searchParams.get("limit")) || 50, offset: Number(url.searchParams.get("offset")) || 0 });
  // List views never expose full IPs.
  return json(200, { visits: rows.map(({ ip, ...r }) => ({ ...r, ip_masked: maskIp(ip) })) });
}

export async function handleAdminGetVisit(req: Request, deps: Deps, id: string): Promise<Response> {
  const denied = requireAdmin(req, deps.config);
  if (denied) return denied;
  const detail = await getVisit(deps.db, id);
  return detail ? json(200, detail) : json(404, { error: "not found" });
}

export async function handleAdminDeleteVisit(req: Request, deps: Deps, id: string): Promise<Response> {
  const denied = requireAdmin(req, deps.config, { mutation: true });
  if (denied) return denied;
  return json(200, { deleted: await deleteVisit(deps.db, id) });
}

export async function handleAdminDeleteVisitor(req: Request, deps: Deps, visitorId: string): Promise<Response> {
  const denied = requireAdmin(req, deps.config, { mutation: true });
  if (denied) return denied;
  return json(200, { deleted: await deleteVisitor(deps.db, visitorId) });
}

export async function handleAdminSettings(req: Request, deps: Deps): Promise<Response> {
  const denied = requireAdmin(req, deps.config, { mutation: true });
  if (denied) return denied;
  const body = await readJson(req);
  const days = Number(body?.retentionDays);
  try {
    await setRetentionDays(deps.db, days);
  } catch (err) {
    return json(400, { error: (err as Error).message });
  }
  const purge = await purgeExpired(deps.db, deps.config);
  return json(200, { retentionDays: days, purged: purge });
}

export async function handleAdminPurge(req: Request, deps: Deps): Promise<Response> {
  const denied = requireAdmin(req, deps.config, { mutation: true });
  if (denied) return denied;
  const body = await readJson(req);
  if (body?.scope === "all") {
    if (body.confirm !== "DELETE ALL") return json(400, { error: "type DELETE ALL to confirm" });
    return json(200, { deletedVisits: await deleteAllAnalytics(deps.db) });
  }
  return json(200, { purged: await purgeExpired(deps.db, deps.config) });
}

/** Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. */
export async function handleCronRetention(req: Request, deps: Deps): Promise<Response> {
  const secret = deps.config.cronSecret;
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret ?? ""}`);
  if (!secret || given.length !== expected.length || !timingSafeEqual(given, expected)) return json(401, { error: "unauthorized" });
  return json(200, { purged: await purgeExpired(deps.db, deps.config) });
}

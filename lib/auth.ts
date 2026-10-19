import { createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { readCookie } from "./consent";
import type { AppConfig } from "./config";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, keylen: number, opts: { N: number; r: number; p: number; maxmem: number }) => Promise<Buffer>;

export const SESSION_COOKIE = "va_admin";
export const SESSION_TTL_SECONDS = 8 * 60 * 60;
const N = 16384, R = 8, P = 1, KEYLEN = 32;

/**
 * Format: scrypt.N.r.p.salt.hash (base64url). Deliberately free of `$`, which dotenv
 * expansion in Next.js would otherwise mangle.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, KEYLEN, { N, r: R, p: P, maxmem: 64 * 1024 * 1024 });
  return ["scrypt", N, R, P, salt.toString("base64url"), hash.toString("base64url")].join(".");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.trim().split(".");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, salt, hash] = parts;
  const expected = Buffer.from(hash, "base64url");
  if (expected.length < 16 || !(Number(n) >= 1024 && Number(n) <= 1 << 20)) return false;
  const actual = await scrypt(password, Buffer.from(salt, "base64url"), expected.length, {
    N: Number(n), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024,
  });
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function sign(secret: string, data: string): string {
  return createHmac("sha256", secret).update(data).digest("base64url");
}

export function createSessionToken(secret: string, now = Date.now(), ttlSeconds = SESSION_TTL_SECONDS): string {
  const exp = Math.floor(now / 1000) + ttlSeconds;
  const payload = `v1.${exp}.${randomBytes(12).toString("base64url")}`;
  return `${payload}.${sign(secret, payload)}`;
}

export function verifySessionToken(token: string | null | undefined, secret: string | undefined, now = Date.now()): boolean {
  if (!token || !secret) return false;
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") return false;
  const payload = parts.slice(0, 3).join(".");
  const expected = Buffer.from(sign(secret, payload));
  const given = Buffer.from(parts[3]);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return false;
  const exp = Number(parts[1]);
  return Number.isFinite(exp) && exp * 1000 > now;
}

export type AuthConfig = Pick<AppConfig, "adminPasswordHash" | "sessionSecret">;

export function authConfigProblem(config: AuthConfig): string | null {
  if (!config.adminPasswordHash) return "ADMIN_PASSWORD_HASH is not set. Run `npm run hash-password` and add it to your environment.";
  if (!config.sessionSecret || config.sessionSecret.length < 32) return "SESSION_SECRET must be set to at least 32 random characters.";
  return null;
}

export function isAdminRequest(req: Request, config: AuthConfig, now = Date.now()): boolean {
  if (authConfigProblem(config)) return false;
  return verifySessionToken(readCookie(req.headers.get("cookie"), SESSION_COOKIE), config.sessionSecret, now);
}

/** Blocks cross-site form posts / fetches against admin mutations. */
export function isSameOrigin(req: Request): boolean {
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return false;
  const origin = req.headers.get("origin");
  if (!origin) return site === "same-origin" || site === "none";
  try {
    return new URL(origin).host === (req.headers.get("x-forwarded-host") ?? req.headers.get("host"));
  } catch {
    return false;
  }
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

/** Returns an error Response when the request is not an authorized admin request. */
export function requireAdmin(req: Request, config: AuthConfig, opts: { mutation?: boolean } = {}): Response | null {
  if (!isAdminRequest(req, config)) return json(401, { error: "unauthorized" });
  if (opts.mutation && !isSameOrigin(req)) return json(403, { error: "cross-origin request rejected" });
  return null;
}

export function sessionCookie(token: string, secure: boolean): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL_SECONDS}${secure ? "; Secure" : ""}`;
}

export function clearSessionCookie(secure: boolean): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? "; Secure" : ""}`;
}

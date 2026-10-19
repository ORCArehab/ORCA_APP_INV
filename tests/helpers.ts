import { PGlite } from "@electric-sql/pglite";
import { parseConfig, type AppConfig } from "@/lib/config";
import { wrapPglite, type Db } from "@/lib/db";
import { migrate } from "@/lib/migrate";

export async function testDb(): Promise<Db> {
  const db = wrapPglite(new PGlite());
  await migrate(db);
  return db;
}

export function testConfig(overrides: Record<string, string> = {}): AppConfig {
  return parseConfig({
    ANALYTICS_CONSENT_MODE: "opt-in",
    IP_LOOKUP_PROVIDER: "mock",
    SESSION_SECRET: "x".repeat(40),
    RATE_LIMIT_SALT: "test-salt",
    ...overrides,
  });
}

let counter = 0;
export function uuid(): string {
  counter++;
  return `00000000-0000-4000-8000-${counter.toString(16).padStart(12, "0")}`;
}

export function payload(overrides: Record<string, unknown> = {}, events?: unknown[]) {
  return {
    v: 1,
    sessionId: uuid(),
    referrer: "https://news.example.com/article?id=5&token=secret",
    env: { languages: ["en-US", "en"], timeZone: "America/Los_Angeles", screen: { w: 1920, h: 1080 }, viewport: { w: 1280, h: 800 }, maxTouchPoints: 0, webdriver: false },
    events: events ?? [{ type: "pageview", eventId: uuid(), path: "/pricing?utm_source=newsletter&email=a@b.com", ts: Date.now() }],
    ...overrides,
  };
}

export const CHROME_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export function collectRequest(body: unknown, headers: Record<string, string> = {}) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return new Request("http://localhost:3000/api/collect", {
    method: "POST",
    headers: { "content-type": "application/json", host: "localhost:3000", origin: "http://localhost:3000", "user-agent": CHROME_UA, ...headers },
    body: text,
  });
}

/** Collects scheduled background tasks so tests can await them. */
export function scheduler() {
  const tasks: Promise<unknown>[] = [];
  return { schedule: (t: () => Promise<unknown>) => void tasks.push(t()), flush: () => Promise.all(tasks) };
}

export async function resetDb(db: Db) {
  await db.query(`TRUNCATE visits, events, settings, rate_limits, ip_lookup_cache, automated_hits RESTART IDENTITY CASCADE`);
}

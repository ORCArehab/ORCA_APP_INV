import "./env";
/**
 * Sends synthetic demo visits through the real ingestion handler so the dashboard has data.
 * Uses documentation IP ranges and mock enrichment. Do not run against production.
 */
import { randomUUID } from "node:crypto";
import { handleCollect } from "../lib/collect";
import { getConfig } from "../lib/config";
import { getDb } from "../lib/db";

const config = { ...getConfig(), ipLookupProvider: "mock" as const, rateLimitPerMinute: 1_000_000 };
const db = getDb();
const agents = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0",
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/131.0.0.0 Safari/537.36",
];
const pages = ["/", "/privacy", "/?utm_source=newsletter"];
const tasks: Promise<unknown>[] = [];

for (let i = 0; i < 40; i++) {
  const ua = agents[i % agents.length];
  const n = 1 + (i % 4);
  const daysAgo = i % 10;
  const now = new Date(Date.now() - daysAgo * 86_400_000 - i * 60_000);
  const events = Array.from({ length: n }, (_, j) => ({ type: "pageview" as const, eventId: randomUUID(), path: pages[(i + j) % pages.length], ts: now.getTime() }));
  const clicks = i % 3 === 0 ? [{ type: "click" as const, eventId: randomUUID(), path: "/", ts: now.getTime(), name: "cta_click", label: "demo" }] : [];
  const body = {
    v: 1,
    sessionId: randomUUID(),
    referrer: i % 2 ? "https://search.example/?q=trail+maps" : null,
    env: { languages: i % 2 ? ["en-US", "en"] : ["de-DE", "de", "en"], timeZone: i % 2 ? "America/Los_Angeles" : "Europe/Berlin", screen: { w: 1440, h: 900 }, viewport: { w: 1280, h: 760 }, maxTouchPoints: ua.includes("Mobile") ? 5 : 0, webdriver: false },
    events: [...events, ...clicks],
  };
  const req = new Request("http://localhost:3000/api/collect", {
    method: "POST",
    headers: { "content-type": "application/json", host: "localhost:3000", "user-agent": ua, cookie: `va_consent=granted${i % 4 === 0 ? "; va_vid=7d1e4c1a-0000-4000-8000-00000000000" + (i % 8) : ""}` },
    body: JSON.stringify(body),
  });
  const res = await handleCollect(req, { db, config, peerIp: `203.0.113.${(i * 7) % 250}`, now, schedule: (t) => void tasks.push(t()) });
  if (res.status !== 202) console.warn("seed request failed", res.status, await res.text());
}
await db.query(`INSERT INTO automated_hits (day, category, agent, path, hits) VALUES (current_date, 'link-preview', 'Slack', '/', 3), (current_date, 'crawler', 'Google', '/', 5) ON CONFLICT DO NOTHING`);
await Promise.all(tasks);
console.log("Seeded 40 demo visits (mock enrichment).");
process.exit(0);

import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db";
import { getRetentionDays, purgeExpired, setRetentionDays } from "@/lib/retention";
import { resetDb, testConfig, testDb } from "./helpers";

let db: Db;
beforeAll(async () => {
  db = await testDb();
});
beforeEach(() => resetDb(db));

const NOW = new Date("2026-10-19T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

async function visit(startedDaysAgo: number, lastSeenDaysAgo = startedDaysAgo) {
  const r = await db.query<{ id: string }>(
    `INSERT INTO visits (session_id, consent_state, started_at, last_seen_at, ip, ip_source, landing_path)
     VALUES (gen_random_uuid(), 'granted', $1, $2, '203.0.113.1', 'socket', '/') RETURNING id`,
    [daysAgo(startedDaysAgo), daysAgo(lastSeenDaysAgo)],
  );
  return r.rows[0].id;
}
async function event(visitId: string, receivedDaysAgo: number) {
  await db.query(`INSERT INTO events (event_id, visit_id, type, path, received_at) VALUES (gen_random_uuid(), $1, 'pageview', '/', $2)`, [visitId, daysAgo(receivedDaysAgo)]);
}
const n = async (sql: string) => (await db.query<{ n: number }>(sql)).rows[0].n;

describe("retention", () => {
  it("defaults to 30 days", async () => {
    expect(testConfig().retentionDays).toBe(30);
    expect(await getRetentionDays(db, testConfig())).toBe(30);
  });

  it("uses RETENTION_DAYS from the environment", async () => {
    expect(await getRetentionDays(db, testConfig({ RETENTION_DAYS: "90" }))).toBe(90);
  });

  it("dashboard setting overrides the env default and is validated", async () => {
    await setRetentionDays(db, 7);
    expect(await getRetentionDays(db, testConfig())).toBe(7);
    await expect(setRetentionDays(db, 0)).rejects.toThrow(RangeError);
    await expect(setRetentionDays(db, 1.5)).rejects.toThrow(RangeError);
    await expect(setRetentionDays(db, 99999)).rejects.toThrow(RangeError);
  });

  it("purges visits, events, lookups and aggregate hits older than the window", async () => {
    const old = await visit(45);
    await event(old, 45);
    const fresh = await visit(2);
    await event(fresh, 2);
    // A long-lived visit: still active, but its oldest event is past the window.
    const longLived = await visit(40, 1);
    await event(longLived, 40);
    await event(longLived, 1);
    await db.query(`INSERT INTO ip_lookup_cache VALUES ('203.0.113.1', 'ipinfo', '{}', $1)`, [daysAgo(3)]);
    await db.query(`INSERT INTO automated_hits VALUES ($1::date, 'crawler', 'Google', '/', 3), ($2::date, 'crawler', 'Google', '/', 1)`, [
      daysAgo(60).toISOString().slice(0, 10), daysAgo(1).toISOString().slice(0, 10),
    ]);

    const result = await purgeExpired(db, testConfig(), NOW);
    expect(result).toMatchObject({ retentionDays: 30, visits: 1, events: 2, lookups: 1, automated: 1 });

    const remaining = (await db.query<{ id: string }>(`SELECT id FROM visits ORDER BY started_at`)).rows.map((r) => r.id);
    expect(remaining).toEqual([longLived, fresh]);
    expect(await n(`SELECT count(*)::int AS n FROM events`)).toBe(2);
    expect(await n(`SELECT count(*)::int AS n FROM automated_hits`)).toBe(1);
  });

  it("honors a shorter configured window", async () => {
    await visit(10);
    await visit(3);
    await setRetentionDays(db, 7);
    expect((await purgeExpired(db, testConfig(), NOW)).visits).toBe(1);
  });

  it("is idempotent", async () => {
    await visit(45);
    await purgeExpired(db, testConfig(), NOW);
    expect((await purgeExpired(db, testConfig(), NOW)).visits).toBe(0);
  });
});

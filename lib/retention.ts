import type { AppConfig } from "./config";
import type { Db } from "./db";

export const MIN_RETENTION_DAYS = 1;
export const MAX_RETENTION_DAYS = 3650;

export async function getRetentionDays(db: Db, config: Pick<AppConfig, "retentionDays">): Promise<number> {
  const r = await db.query<{ value: unknown }>(`SELECT value FROM settings WHERE key = 'retention_days'`);
  const v = Number(r.rows[0]?.value);
  return Number.isInteger(v) && v >= MIN_RETENTION_DAYS && v <= MAX_RETENTION_DAYS ? v : config.retentionDays;
}

export async function setRetentionDays(db: Db, days: number): Promise<void> {
  if (!Number.isInteger(days) || days < MIN_RETENTION_DAYS || days > MAX_RETENTION_DAYS) {
    throw new RangeError(`Retention must be an integer between ${MIN_RETENTION_DAYS} and ${MAX_RETENTION_DAYS} days`);
  }
  await db.query(
    `INSERT INTO settings (key, value) VALUES ('retention_days', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [JSON.stringify(days)],
  );
}

export type PurgeResult = { retentionDays: number; cutoff: Date; visits: number; events: number; lookups: number; automated: number; rateLimits: number };

/** Deletes everything older than the retention window. Safe to run repeatedly. */
export async function purgeExpired(db: Db, config: Pick<AppConfig, "retentionDays" | "ipLookupCacheHours">, now = new Date()): Promise<PurgeResult> {
  const retentionDays = await getRetentionDays(db, config);
  const cutoff = new Date(now.getTime() - retentionDays * 86_400_000);
  const lookupCutoff = new Date(Math.max(cutoff.getTime(), now.getTime() - config.ipLookupCacheHours * 3_600_000));
  return db.transaction(async (tx) => {
    // Events first so long-running sessions lose their old events too.
    const events = await tx.query(`DELETE FROM events WHERE received_at < $1`, [cutoff]);
    const visits = await tx.query(`DELETE FROM visits WHERE last_seen_at < $1`, [cutoff]);
    const lookups = await tx.query(`DELETE FROM ip_lookup_cache WHERE looked_up_at < $1`, [lookupCutoff]);
    const automated = await tx.query(`DELETE FROM automated_hits WHERE day < $1::date`, [cutoff.toISOString().slice(0, 10)]);
    const rateLimits = await tx.query(`DELETE FROM rate_limits WHERE window_start < $1`, [new Date(now.getTime() - 3_600_000)]);
    await tx.query(
      `INSERT INTO settings (key, value) VALUES ('last_purge_at', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [JSON.stringify(now.toISOString())],
    );
    return {
      retentionDays, cutoff,
      visits: visits.rowCount, events: events.rowCount, lookups: lookups.rowCount,
      automated: automated.rowCount, rateLimits: rateLimits.rowCount,
    };
  });
}

/** Runs purgeExpired at most once per interval per server instance. */
let lastRun = 0;
export function maybePurge(db: Db, config: Pick<AppConfig, "retentionDays" | "ipLookupCacheHours">, intervalMs = 3_600_000): Promise<PurgeResult | null> {
  if (Date.now() - lastRun < intervalMs) return Promise.resolve(null);
  lastRun = Date.now();
  return purgeExpired(db, config).catch((err) => {
    console.error("retention purge failed", err);
    return null;
  });
}

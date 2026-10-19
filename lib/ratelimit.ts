import { createHash } from "node:crypto";
import type { Db } from "./db";

/**
 * Fixed-window rate limiter stored in Postgres so it holds across serverless instances.
 * Keys are salted hashes; raw IPs are never written to this table.
 */
export async function consumeRateLimit(
  db: Db,
  opts: { bucket: string; subject: string; limit: number; cost?: number; windowSeconds?: number; salt: string; now?: Date },
): Promise<{ allowed: boolean; count: number; retryAfter: number }> {
  const windowSeconds = opts.windowSeconds ?? 60;
  const now = opts.now ?? new Date();
  const windowMs = windowSeconds * 1000;
  const windowStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs);
  const key = createHash("sha256").update(`${opts.salt}:${opts.bucket}:${opts.subject}`).digest("hex").slice(0, 40);
  const r = await db.query<{ count: number }>(
    `INSERT INTO rate_limits (key, window_start, count) VALUES ($1, $2, $3)
     ON CONFLICT (key, window_start) DO UPDATE SET count = rate_limits.count + EXCLUDED.count
     RETURNING count`,
    [key, windowStart, opts.cost ?? 1],
  );
  const count = Number(r.rows[0]?.count ?? 0);
  const retryAfter = Math.ceil((windowStart.getTime() + windowMs - now.getTime()) / 1000);
  return { allowed: count <= opts.limit, count, retryAfter };
}

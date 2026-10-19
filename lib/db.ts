import pg from "pg";
import { getConfig } from "./config";

/** Minimal query interface satisfied by node-postgres and by PGlite (used in tests). */
export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[]; rowCount: number }>;
  /** Runs fn on a single connection inside BEGIN/COMMIT. */
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
}

function pgQuery(client: pg.Pool | pg.PoolClient): Db["query"] {
  return async (sql, params) => {
    const r = await client.query(sql, params as unknown[]);
    return { rows: r.rows, rowCount: r.rowCount ?? 0 };
  };
}

export function wrapPg(pool: pg.Pool): Db {
  return {
    query: pgQuery(pool),
    async transaction(fn) {
      const client = await pool.connect();
      const tx: Db = { query: pgQuery(client), transaction: (f) => f(tx) };
      try {
        await client.query("BEGIN");
        const out = await fn(tx);
        await client.query("COMMIT");
        return out;
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
  };
}

type PgliteLike = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[]; affectedRows?: number }>;
  transaction?: <T>(fn: (tx: PgliteLike) => Promise<T>) => Promise<T>;
};

/** Adapter for PGlite (in-process Postgres used by the tests). */
export function wrapPglite(db: PgliteLike): Db {
  const wrapped: Db = {
    async query<T>(sql: string, params?: unknown[]) {
      const r = await db.query(sql, params);
      return { rows: r.rows as T[], rowCount: r.affectedRows ?? r.rows.length };
    },
    transaction(fn) {
      if (!db.transaction) return fn(wrapped);
      return db.transaction((tx) => fn(wrapPglite(tx)));
    },
  };
  return wrapped;
}

const globalForDb = globalThis as unknown as { __vaDb?: Db; __vaPool?: pg.Pool };

export function getDb(): Db {
  if (globalForDb.__vaDb) return globalForDb.__vaDb;
  const url = getConfig().databaseUrl;
  if (!url) throw new Error("DATABASE_URL is not set");
  // TLS is controlled through the connection string (e.g. ?sslmode=require).
  globalForDb.__vaPool = new pg.Pool({ connectionString: url, max: 5 });
  globalForDb.__vaDb = wrapPg(globalForDb.__vaPool);
  return globalForDb.__vaDb;
}

export function setDb(db: Db) {
  globalForDb.__vaDb = db;
}

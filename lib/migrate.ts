import fs from "node:fs/promises";
import path from "node:path";
import type { Db } from "./db";

export async function migrate(db: Db, dir = path.join(process.cwd(), "migrations")): Promise<string[]> {
  await db.query(`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  const done = new Set((await db.query<{ name: string }>(`SELECT name FROM schema_migrations`)).rows.map((r) => r.name));
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  const applied: string[] = [];
  for (const file of files) {
    if (done.has(file)) continue;
    const sql = await fs.readFile(path.join(dir, file), "utf8");
    try {
      await db.transaction(async (tx) => {
        for (const stmt of splitSql(sql)) await tx.query(stmt);
        await tx.query(`INSERT INTO schema_migrations (name) VALUES ($1)`, [file]);
      });
      applied.push(file);
    } catch (err) {
      throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
    }
  }
  return applied;
}

/** Splits a migration file on semicolons that end a line. Migrations avoid function bodies. */
function splitSql(sql: string): string[] {
  return sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(/;\s*$/m)
    .map((s) => s.trim())
    .filter(Boolean);
}

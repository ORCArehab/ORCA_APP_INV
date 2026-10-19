import "./env";
// Prefer the direct (non-pooled) connection for schema changes, e.g. Neon on Vercel.
if (process.env.DATABASE_URL_UNPOOLED) process.env.DATABASE_URL = process.env.DATABASE_URL_UNPOOLED;

import { getDb } from "../lib/db";
import { migrate } from "../lib/migrate";

const applied = await migrate(getDb());
console.log(applied.length ? `Applied: ${applied.join(", ")}` : "Database is up to date.");
process.exit(0);

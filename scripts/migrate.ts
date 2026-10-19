import "./env";
import { getDb } from "../lib/db";
import { migrate } from "../lib/migrate";

const applied = await migrate(getDb());
console.log(applied.length ? `Applied: ${applied.join(", ")}` : "Database is up to date.");
process.exit(0);

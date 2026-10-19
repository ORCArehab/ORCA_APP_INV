import "./env";
import { getConfig } from "../lib/config";
import { getDb } from "../lib/db";
import { purgeExpired } from "../lib/retention";

const r = await purgeExpired(getDb(), getConfig());
console.log(`Retention ${r.retentionDays} days (cutoff ${r.cutoff.toISOString()}): deleted ${r.visits} visits, ${r.events} events, ${r.lookups} cached lookups, ${r.automated} crawler counters.`);
process.exit(0);

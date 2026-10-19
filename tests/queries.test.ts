import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db";
import { getAggregates, getFilterOptions, listVisits, parseFilters } from "@/lib/queries";
import { resetDb, testDb } from "./helpers";

let db: Db;
beforeAll(async () => {
  db = await testDb();
});
beforeEach(() => resetDb(db));

const VID = "11111111-2222-4333-8444-555555555555";
async function visit(o: { visitor?: string | null; minutesAgo: number; languages?: string[] | null; acceptLanguage?: string | null; city?: string | null; region?: string | null; country?: string | null }) {
  await db.query(
    `INSERT INTO visits (session_id, visitor_id, consent_state, started_at, last_seen_at, ip_source, landing_path, languages, accept_language, geo_city, geo_region, geo_country_code)
     VALUES (gen_random_uuid(), $1, 'granted', now() - make_interval(mins => $2), now() - make_interval(mins => $2), 'socket', '/', $3, $4, $5, $6, $7)`,
    [o.visitor ?? null, o.minutesAgo, o.languages ? JSON.stringify(o.languages) : null, o.acceptLanguage ?? null, o.city ?? null, o.region ?? null, o.country ?? null],
  );
}

describe("city, language and returning-visitor reporting", () => {
  beforeEach(async () => {
    await visit({ visitor: VID, minutesAgo: 300, languages: ["fil-PH", "en"], city: "Quezon City", region: "Metro Manila", country: "PH" });
    await visit({ visitor: VID, minutesAgo: 100, languages: ["fil-PH", "en"], city: "Quezon City", region: "Metro Manila", country: "PH" });
    await visit({ visitor: VID, minutesAgo: 10, languages: ["fil-PH", "en"], city: "Makati", region: "Metro Manila", country: "PH" });
    await visit({ minutesAgo: 5, languages: null, acceptLanguage: "de-DE,de;q=0.9", city: "Berlin", region: "Berlin", country: "DE" });
    await visit({ minutesAgo: 1, languages: null, acceptLanguage: null });
  });

  it("numbers each visit within its returning visitor and leaves id-less visits unknown", async () => {
    const rows = await listVisits(db, parseFilters({}));
    expect(rows.map((r) => [r.geo_city, r.primary_language, r.visitor_visit_number, r.visitor_total_visits])).toEqual([
      [null, null, null, null],
      ["Berlin", "de-DE", null, null], // falls back to the Accept-Language header
      ["Makati", "fil-PH", 3, 3],
      ["Quezon City", "fil-PH", 2, 3],
      ["Quezon City", "fil-PH", 1, 3],
    ]);
  });

  it("aggregates cities, languages and returning visits", async () => {
    const a = await getAggregates(db, parseFilters({}));
    expect(a.returningVisits).toBe(2);
    expect(a.topCities[0]).toEqual({ city: "Quezon City", region: "Metro Manila", code: "PH", visits: 2 });
    expect(a.topLanguages).toEqual(expect.arrayContaining([{ language: "fil-PH", visits: 3 }, { language: "de-DE", visits: 1 }, { language: null, visits: 1 }]));
  });

  it("filters by browser language, case-insensitively, including unknown", async () => {
    expect((await listVisits(db, parseFilters({ language: "FIL-ph" }))).length).toBe(3);
    expect((await listVisits(db, parseFilters({ language: "unknown" }))).length).toBe(1);
    expect(parseFilters({ language: "en'; drop table visits;--" }).language).toBeUndefined();
    expect((await getFilterOptions(db)).languages).toEqual(["fil-PH", "de-DE"]);
  });
});

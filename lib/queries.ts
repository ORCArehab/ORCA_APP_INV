import type { Db } from "./db";

export type Filters = {
  from?: string; // YYYY-MM-DD (UTC, inclusive)
  to?: string; // YYYY-MM-DD (UTC, inclusive)
  path?: string;
  country?: string;
  browser?: string;
  device?: string;
  language?: string;
  bots: "exclude" | "include" | "only";
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const LANGUAGE = /^[A-Za-z0-9-]{1,35}$/;

/** First browser-reported language, falling back to the first Accept-Language entry. */
const PRIMARY_LANG = `NULLIF(COALESCE(v.languages->>0, trim(split_part(split_part(v.accept_language, ',', 1), ';', 1))), '')`;
const DEVICES = new Set(["mobile", "tablet", "desktop", "unknown"]);

/** Parses untrusted search params into a safe filter object. */
export function parseFilters(sp: Record<string, string | string[] | undefined>): Filters {
  const one = (k: string) => {
    const v = sp[k];
    const s = Array.isArray(v) ? v[0] : v;
    return s && s.length <= 200 ? s : undefined;
  };
  const bots = one("bots");
  const country = one("country");
  const device = one("device");
  const language = one("language");
  return {
    from: one("from") && DATE.test(one("from")!) ? one("from") : undefined,
    to: one("to") && DATE.test(one("to")!) ? one("to") : undefined,
    path: one("path")?.startsWith("/") ? one("path") : undefined,
    country: country && /^([A-Z]{2}|unknown)$/.test(country) ? country : undefined,
    browser: one("browser"),
    device: device && DEVICES.has(device) ? device : undefined,
    language: language && (language === "unknown" || LANGUAGE.test(language)) ? language : undefined,
    bots: bots === "include" || bots === "only" ? bots : "exclude",
  };
}

/** Builds a WHERE clause over `visits v`. All values are parameterized. */
function visitWhere(f: Filters, params: unknown[]): string {
  const c: string[] = [];
  const p = (v: unknown) => {
    params.push(v);
    return `$${params.length}`;
  };
  if (f.from) c.push(`v.last_seen_at >= ${p(f.from)}::date`);
  if (f.to) c.push(`v.started_at < (${p(f.to)}::date + 1)`);
  if (f.country === "unknown") c.push(`v.geo_country_code IS NULL`);
  else if (f.country) c.push(`v.geo_country_code = ${p(f.country)}`);
  if (f.browser === "unknown") c.push(`v.browser_name IS NULL`);
  else if (f.browser) c.push(`v.browser_name = ${p(f.browser)}`);
  if (f.device) c.push(`v.device_category = ${p(f.device)}`);
  if (f.language === "unknown") c.push(`${PRIMARY_LANG} IS NULL`);
  else if (f.language) c.push(`lower(${PRIMARY_LANG}) = lower(${p(f.language)})`);
  if (f.bots === "exclude") c.push(`NOT v.is_bot`);
  if (f.bots === "only") c.push(`v.is_bot`);
  if (f.path) c.push(`EXISTS (SELECT 1 FROM events pe WHERE pe.visit_id = v.id AND pe.type = 'pageview' AND pe.path = ${p(f.path)})`);
  return c.length ? `WHERE ${c.join(" AND ")}` : "";
}

/** Event-level conditions (date + page) so page-view counts respect the filters precisely. */
function eventWhere(f: Filters, params: unknown[]): string {
  const c: string[] = [];
  const p = (v: unknown) => {
    params.push(v);
    return `$${params.length}`;
  };
  if (f.from) c.push(`e.received_at >= ${p(f.from)}::date`);
  if (f.to) c.push(`e.received_at < (${p(f.to)}::date + 1)`);
  if (f.path) c.push(`e.path = ${p(f.path)}`);
  return c.length ? `AND ${c.join(" AND ")}` : "";
}

export type VisitRow = {
  id: string;
  started_at: Date;
  last_seen_at: Date;
  ip: string | null;
  landing_path: string;
  referrer_origin: string | null;
  geo_country_code: string | null;
  geo_city: string | null;
  geo_region: string | null;
  primary_language: string | null;
  visitor_visit_number: number | null;
  visitor_total_visits: number | null;
  enrichment_status: string;
  browser_name: string | null;
  os_name: string | null;
  device_category: string;
  is_bot: boolean;
  bot_category: string | null;
  visitor_id: string | null;
  pageviews: number;
  clicks: number;
};

export async function listVisits(db: Db, f: Filters, opts: { limit?: number; offset?: number } = {}) {
  const params: unknown[] = [];
  const where = visitWhere(f, params);
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);
  params.push(limit, offset);
  const r = await db.query<VisitRow>(
    `SELECT v.id, v.started_at, v.last_seen_at, v.ip, v.landing_path, v.referrer_origin,
            v.geo_country_code, v.geo_city, v.geo_region, ${PRIMARY_LANG} AS primary_language,
            CASE WHEN v.visitor_id IS NULL THEN NULL ELSE
              (SELECT count(*)::int FROM visits r WHERE r.visitor_id = v.visitor_id AND r.started_at <= v.started_at) END AS visitor_visit_number,
            CASE WHEN v.visitor_id IS NULL THEN NULL ELSE
              (SELECT count(*)::int FROM visits r WHERE r.visitor_id = v.visitor_id) END AS visitor_total_visits,
            v.enrichment_status, v.browser_name, v.os_name,
            v.device_category, v.is_bot, v.bot_category, v.visitor_id,
            (SELECT count(*)::int FROM events e WHERE e.visit_id = v.id AND e.type = 'pageview') AS pageviews,
            (SELECT count(*)::int FROM events e WHERE e.visit_id = v.id AND e.type = 'click') AS clicks
       FROM visits v ${where}
      ORDER BY v.started_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return r.rows;
}

export type Aggregates = {
  visits: number;
  identifiedVisitors: number;
  anonymousVisits: number;
  estimatedVisitors: number;
  pageviews: number;
  clicks: number;
  botVisits: number;
  topPages: { path: string; views: number }[];
  topCountries: { code: string | null; name: string | null; visits: number }[];
  topCities: { city: string | null; region: string | null; code: string | null; visits: number }[];
  topLanguages: { language: string | null; visits: number }[];
  returningVisits: number;
  browsers: { name: string | null; visits: number }[];
  devices: { category: string; visits: number }[];
  daily: { day: string; pageviews: number; visits: number }[];
  topClicks: { name: string; clicks: number }[];
};

export async function getAggregates(db: Db, f: Filters): Promise<Aggregates> {
  const vp: unknown[] = [];
  const vw = visitWhere(f, vp);
  const totals = (
    await db.query<{ visits: number; identified: number; anonymous: number }>(
      `SELECT count(*)::int AS visits,
              count(DISTINCT v.visitor_id)::int AS identified,
              count(*) FILTER (WHERE v.visitor_id IS NULL)::int AS anonymous
         FROM visits v ${vw}`,
      vp,
    )
  ).rows[0];

  const ep: unknown[] = [];
  const evw = visitWhere(f, ep);
  const ew = eventWhere(f, ep);
  const eventTotals = (
    await db.query<{ pageviews: number; clicks: number }>(
      `SELECT count(*) FILTER (WHERE e.type = 'pageview')::int AS pageviews,
              count(*) FILTER (WHERE e.type = 'click')::int AS clicks
         FROM events e JOIN visits v ON v.id = e.visit_id ${evw || "WHERE true"} ${ew}`,
      ep,
    )
  ).rows[0];

  const bp: unknown[] = [];
  const bw = visitWhere({ ...f, bots: "only" }, bp);
  const botVisits = (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM visits v ${bw}`, bp)).rows[0].n;

  const tp: unknown[] = [];
  const tvw = visitWhere(f, tp);
  const tew = eventWhere(f, tp);
  const topPages = (
    await db.query<{ path: string; views: number }>(
      `SELECT e.path, count(*)::int AS views FROM events e JOIN visits v ON v.id = e.visit_id
        ${tvw || "WHERE true"} AND e.type = 'pageview' ${tew}
        GROUP BY e.path ORDER BY views DESC, e.path LIMIT 10`,
      tp,
    )
  ).rows;

  const cp: unknown[] = [];
  const cvw = visitWhere(f, cp);
  const cew = eventWhere(f, cp);
  const topClicks = (
    await db.query<{ name: string; clicks: number }>(
      `SELECT e.name, count(*)::int AS clicks FROM events e JOIN visits v ON v.id = e.visit_id
        ${cvw || "WHERE true"} AND e.type = 'click' ${cew}
        GROUP BY e.name ORDER BY clicks DESC, e.name LIMIT 10`,
      cp,
    )
  ).rows;

  const group = async <T>(select: string, groupBy: string) => {
    const gp: unknown[] = [];
    const gw = visitWhere(f, gp);
    return (await db.query<T>(`SELECT ${select}, count(*)::int AS visits FROM visits v ${gw} GROUP BY ${groupBy} ORDER BY visits DESC LIMIT 10`, gp)).rows;
  };
  const topCountries = await group<{ code: string | null; name: string | null; visits: number }>(
    "v.geo_country_code AS code, max(v.geo_country) AS name", "v.geo_country_code",
  );
  const topCities = await group<{ city: string | null; region: string | null; code: string | null; visits: number }>(
    "v.geo_city AS city, v.geo_region AS region, v.geo_country_code AS code", "v.geo_city, v.geo_region, v.geo_country_code",
  );
  const topLanguages = await group<{ language: string | null; visits: number }>(`${PRIMARY_LANG} AS language`, "1");
  const rp: unknown[] = [];
  const rw = visitWhere(f, rp);
  const returningVisits = (
    await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM visits v ${rw || "WHERE true"} AND v.visitor_id IS NOT NULL
         AND EXISTS (SELECT 1 FROM visits r WHERE r.visitor_id = v.visitor_id AND r.started_at < v.started_at)`,
      rp,
    )
  ).rows[0].n;
  const browsers = await group<{ name: string | null; visits: number }>("v.browser_name AS name", "v.browser_name");
  const devices = await group<{ category: string; visits: number }>("v.device_category AS category", "v.device_category");

  const dp: unknown[] = [];
  const dvw = visitWhere(f, dp);
  const dew = eventWhere(f, dp);
  const daily = (
    await db.query<{ day: string; pageviews: number; visits: number }>(
      `SELECT to_char(date_trunc('day', e.received_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day,
              count(*) FILTER (WHERE e.type = 'pageview')::int AS pageviews,
              count(DISTINCT e.visit_id)::int AS visits
         FROM events e JOIN visits v ON v.id = e.visit_id ${dvw || "WHERE true"} ${dew}
        GROUP BY 1 ORDER BY 1 DESC LIMIT 31`,
      dp,
    )
  ).rows.reverse();

  return {
    visits: totals.visits,
    identifiedVisitors: totals.identified,
    anonymousVisits: totals.anonymous,
    estimatedVisitors: totals.identified + totals.anonymous,
    pageviews: eventTotals.pageviews,
    clicks: eventTotals.clicks,
    botVisits,
    topPages,
    topCountries,
    topCities,
    topLanguages,
    returningVisits,
    browsers,
    devices,
    daily: fillDays(daily),
    topClicks,
  };
}

/** Inserts zero rows for days without events so the time axis has no silent gaps. */
function fillDays(rows: { day: string; pageviews: number; visits: number }[]) {
  if (rows.length < 2) return rows;
  const byDay = new Map(rows.map((r) => [r.day, r]));
  const out: typeof rows = [];
  for (let t = Date.parse(rows[0].day); t <= Date.parse(rows[rows.length - 1].day); t += 86_400_000) {
    const day = new Date(t).toISOString().slice(0, 10);
    out.push(byDay.get(day) ?? { day, pageviews: 0, visits: 0 });
  }
  return out;
}

export async function getFilterOptions(db: Db) {
  const [countries, browsers, paths, languages] = await Promise.all([
    db.query<{ code: string; name: string | null }>(
      `SELECT geo_country_code AS code, max(geo_country) AS name FROM visits WHERE geo_country_code IS NOT NULL GROUP BY 1 ORDER BY 2 NULLS LAST LIMIT 250`,
    ),
    db.query<{ name: string }>(`SELECT DISTINCT browser_name AS name FROM visits WHERE browser_name IS NOT NULL ORDER BY 1 LIMIT 100`),
    db.query<{ path: string }>(`SELECT path FROM events WHERE type = 'pageview' GROUP BY path ORDER BY count(*) DESC LIMIT 100`),
    db.query<{ language: string }>(`SELECT ${PRIMARY_LANG} AS language FROM visits v GROUP BY 1 HAVING ${PRIMARY_LANG} IS NOT NULL ORDER BY count(*) DESC LIMIT 100`),
  ]);
  return {
    countries: countries.rows,
    browsers: browsers.rows.map((r) => r.name),
    paths: paths.rows.map((r) => r.path),
    languages: languages.rows.map((r) => r.language),
  };
}

export type VisitDetail = Record<string, unknown> & { id: string; visitor_id: string | null };

export async function getVisit(db: Db, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const v = await db.query<VisitDetail>(`SELECT * FROM visits WHERE id = $1`, [id]);
  if (!v.rows[0]) return null;
  const events = await db.query<{ id: string; type: string; name: string | null; label: string | null; path: string; occurred_at: Date | null; received_at: Date }>(
    `SELECT id::text, type, name, label, path, occurred_at, received_at FROM events WHERE visit_id = $1 ORDER BY received_at, id`,
    [id],
  );
  const otherVisits = v.rows[0].visitor_id
    ? (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM visits WHERE visitor_id = $1 AND id <> $2`, [v.rows[0].visitor_id, id])).rows[0].n
    : 0;
  return { visit: v.rows[0], events: events.rows, otherVisits };
}

export async function getAutomatedHits(db: Db, f: Filters) {
  const params: unknown[] = [];
  const c: string[] = [];
  if (f.from) { params.push(f.from); c.push(`day >= $${params.length}::date`); }
  if (f.to) { params.push(f.to); c.push(`day <= $${params.length}::date`); }
  const where = c.length ? `WHERE ${c.join(" AND ")}` : "";
  return (
    await db.query<{ category: string; agent: string; hits: number }>(
      `SELECT category, agent, sum(hits)::int AS hits FROM automated_hits ${where} GROUP BY 1, 2 ORDER BY hits DESC LIMIT 20`,
      params,
    )
  ).rows;
}

export async function deleteVisit(db: Db, id: string): Promise<number> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return 0;
  return (await db.query(`DELETE FROM visits WHERE id = $1`, [id])).rowCount;
}

export async function deleteVisitor(db: Db, visitorId: string): Promise<number> {
  if (!/^[0-9a-f-]{36}$/i.test(visitorId)) return 0;
  return (await db.query(`DELETE FROM visits WHERE visitor_id = $1`, [visitorId])).rowCount;
}

export async function deleteAllAnalytics(db: Db): Promise<number> {
  return db.transaction(async (tx) => {
    const n = (await tx.query(`DELETE FROM visits`)).rowCount;
    await tx.query(`DELETE FROM automated_hits`);
    await tx.query(`DELETE FROM ip_lookup_cache`);
    return n;
  });
}

export async function recordAutomatedHit(db: Db, hit: { category: string; agent: string; path: string; day?: string }) {
  await db.query(
    `INSERT INTO automated_hits (day, category, agent, path, hits) VALUES ($1::date, $2, $3, $4, 1)
     ON CONFLICT (day, category, agent, path) DO UPDATE SET hits = automated_hits.hits + 1`,
    [hit.day ?? new Date().toISOString().slice(0, 10), hit.category, hit.agent.slice(0, 64), hit.path.slice(0, 256)],
  );
}

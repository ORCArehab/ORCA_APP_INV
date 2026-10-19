import Link from "next/link";
import { DailyChart } from "@/components/admin/DailyChart";
import { LocalTime, Value } from "@/components/admin/Value";
import { requireAdminPage } from "@/lib/admin-page";
import { getConfig } from "@/lib/config";
import { getDb } from "@/lib/db";
import { maskIp } from "@/lib/ip";
import { getAggregates, getAutomatedHits, getFilterOptions, listVisits, parseFilters, type Filters } from "@/lib/queries";
import { maybePurge } from "@/lib/retention";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 50;

function qs(f: Filters, extra: Record<string, string | number> = {}) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...f, ...extra })) if (v !== undefined && v !== "" && !(k === "bots" && v === "exclude")) p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
}

export default async function Dashboard({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdminPage();
  const sp = await searchParams;
  const filters = parseFilters(sp);
  const page = Math.max(1, Number(sp.page) || 1);
  const db = getDb();
  await maybePurge(db, getConfig());

  const [agg, visits, options, automated] = await Promise.all([
    getAggregates(db, filters),
    listVisits(db, filters, { limit: PAGE_SIZE + 1, offset: (page - 1) * PAGE_SIZE }),
    getFilterOptions(db),
    getAutomatedHits(db, filters),
  ]);
  const hasMore = visits.length > PAGE_SIZE;
  const rows = visits.slice(0, PAGE_SIZE);
  const peopleLabel = filters.bots === "only" ? "automated" : filters.bots === "include" ? "all" : "likely human";

  return (
    <>
      <h1>Overview</h1>
      <form className="filters" method="get" aria-label="Filters">
        <div><label htmlFor="from">From (UTC)</label><input id="from" name="from" type="date" defaultValue={filters.from} /></div>
        <div><label htmlFor="to">To (UTC)</label><input id="to" name="to" type="date" defaultValue={filters.to} /></div>
        <div>
          <label htmlFor="path">Page</label>
          <select id="path" name="path" defaultValue={filters.path ?? ""}>
            <option value="">All pages</option>
            {options.paths.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="country">Country (est.)</label>
          <select id="country" name="country" defaultValue={filters.country ?? ""}>
            <option value="">All</option>
            <option value="unknown">Unknown</option>
            {options.countries.map((c) => <option key={c.code} value={c.code}>{c.name ?? c.code}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="browser">Browser</label>
          <select id="browser" name="browser" defaultValue={filters.browser ?? ""}>
            <option value="">All</option>
            <option value="unknown">Unknown</option>
            {options.browsers.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="device">Device</label>
          <select id="device" name="device" defaultValue={filters.device ?? ""}>
            <option value="">All</option>
            <option value="desktop">Desktop</option>
            <option value="mobile">Mobile</option>
            <option value="tablet">Tablet</option>
            <option value="unknown">Unknown</option>
          </select>
        </div>
        <div>
          <label htmlFor="bots">Traffic</label>
          <select id="bots" name="bots" defaultValue={filters.bots}>
            <option value="exclude">Likely human only</option>
            <option value="include">Include automated</option>
            <option value="only">Automated only</option>
          </select>
        </div>
        <div className="actions">
          <button className="btn btn-primary">Apply</button>
          <Link className="btn" href="/admin">Reset</Link>
        </div>
      </form>

      <div className="stat-grid">
        <div className="stat">
          <div className="stat-label">Estimated visitors</div>
          <div className="stat-value">{agg.estimatedVisitors}</div>
          <div className="stat-note">{agg.identifiedVisitors} returning-visitor ids + {agg.anonymousVisits} visits without an id. Each browser counts separately; one person on two devices counts twice.</div>
        </div>
        <div className="stat">
          <div className="stat-label">Visits ({peopleLabel})</div>
          <div className="stat-value">{agg.visits}</div>
          <div className="stat-note">A visit is one tab session (30 min idle) or one page load without consent for storage.</div>
        </div>
        <div className="stat">
          <div className="stat-label">Page views</div>
          <div className="stat-value">{agg.pageviews}</div>
          <div className="stat-note">Deduplicated by event id; retries and React re-renders are not double-counted.</div>
        </div>
        <div className="stat">
          <div className="stat-label">Click events</div>
          <div className="stat-value">{agg.clicks}</div>
          <div className="stat-note">Only elements tagged with data-analytics-event.</div>
        </div>
        <div className="stat">
          <div className="stat-label">Automated visits</div>
          <div className="stat-value">{agg.botVisits}</div>
          <div className="stat-note">Self-identified bots, previewers and automation that ran the script. Kept out of human totals.</div>
        </div>
      </div>

      <div className="card">
        <h2>Page views per day <span className="muted small">(UTC)</span></h2>
        <DailyChart data={agg.daily} />
      </div>

      <div className="grid-2">
        <SmallTable title="Top pages" head={["Page", "Views"]} rows={agg.topPages.map((r) => [<code key="p">{r.path}</code>, r.views])} />
        <SmallTable
          title="Countries (provider estimate)"
          head={["Country", "Visits"]}
          rows={agg.topCountries.map((r) => [r.code ? `${r.name ?? r.code} (${r.code})` : <span key="u" className="unknown">unknown</span>, r.visits])}
        />
        <SmallTable title="Browsers (from User-Agent)" head={["Browser", "Visits"]} rows={agg.browsers.map((r) => [<Value key="b" v={r.name} />, r.visits])} />
        <SmallTable title="Device category (from User-Agent)" head={["Device", "Visits"]} rows={agg.devices.map((r) => [r.category, r.visits])} />
        <SmallTable title="Click events" head={["Event", "Clicks"]} rows={agg.topClicks.map((r) => [<code key="c">{r.name}</code>, r.clicks])} />
        <SmallTable
          title="Crawlers and link previews (page fetches)"
          note="Counted server-side from User-Agent on page requests. These clients usually do not run JavaScript, so they never appear as visits. No IPs are stored for them."
          head={["Agent", "Type", "Fetches"]}
          rows={automated.map((r) => [r.agent, r.category, r.hits])}
        />
      </div>

      <div className="section-title">
        <h2>Recent visits</h2>
        <span className="muted small">IP addresses are masked here; open a visit to see full details.</span>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Started</th>
              <th>Landing page</th>
              <th>IP (masked)</th>
              <th>Location (est.)</th>
              <th>Browser / OS</th>
              <th>Device</th>
              <th className="num">Views</th>
              <th className="num">Clicks</th>
              <th>Notes</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={10} className="unknown">No visits match these filters.</td></tr>
            )}
            {rows.map((v) => (
              <tr key={v.id}>
                <td style={{ whiteSpace: "nowrap" }}><LocalTime d={v.started_at} /></td>
                <td><code>{v.landing_path}</code>{v.referrer_origin && <div className="small muted">from {v.referrer_origin}</div>}</td>
                <td className="mono">{maskIp(v.ip)}</td>
                <td>
                  {v.geo_country_code ? <>{[v.geo_city, v.geo_country_code].filter(Boolean).join(", ")}</> : <span className="unknown">unknown</span>}
                  {v.enrichment_status === "mock" && <> <span className="badge badge-mock">MOCK</span></>}
                </td>
                <td><Value v={[v.browser_name, v.os_name].filter(Boolean).join(" / ") || null} /></td>
                <td>{v.device_category}</td>
                <td className="num">{v.pageviews}</td>
                <td className="num">{v.clicks}</td>
                <td>
                  {v.is_bot && <span className="badge badge-bot">{v.bot_category}</span>}
                  {v.visitor_id && <span className="badge badge-neutral">has visitor id</span>}
                </td>
                <td><Link href={`/admin/visits/${v.id}`}>Details</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="pager">
        {page > 1 && <Link className="btn btn-sm" href={`/admin${qs(filters, { page: page - 1 })}`}>Newer</Link>}
        {hasMore && <Link className="btn btn-sm" href={`/admin${qs(filters, { page: page + 1 })}`}>Older</Link>}
      </div>
    </>
  );
}

function SmallTable({ title, head, rows, note }: { title: string; head: string[]; rows: React.ReactNode[][]; note?: string }) {
  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      <div style={{ padding: "14px 16px 6px" }}>
        <h3 style={{ margin: 0 }}>{title}</h3>
        {note && <p className="small muted" style={{ margin: "4px 0 0" }}>{note}</p>}
      </div>
      <table>
        <thead>
          <tr>{head.map((h, i) => <th key={h} className={i === head.length - 1 ? "num" : undefined}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={head.length} className="unknown">No data</td></tr>}
          {rows.map((r, i) => (
            <tr key={i}>{r.map((c, j) => <td key={j} className={j === r.length - 1 ? "num" : undefined}>{c}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

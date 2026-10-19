import Link from "next/link";
import { notFound } from "next/navigation";
import { DeleteVisitButton, DeleteVisitorButton } from "@/components/admin/AdminActions";
import { LocalTime, ProvenanceBadge, Value } from "@/components/admin/Value";
import { requireAdminPage } from "@/lib/admin-page";
import { getDb } from "@/lib/db";
import { FIELD_BY_KEY, PROVENANCE, type Provenance } from "@/lib/field-docs";
import { getVisit } from "@/lib/queries";

export const dynamic = "force-dynamic";

type Row = { field: string; value: React.ReactNode };

function Section({ provenance, title, rows, intro }: { provenance: Provenance; title: string; rows: Row[]; intro?: React.ReactNode }) {
  return (
    <section className="detail-section card">
      <header>
        <ProvenanceBadge p={provenance} />
        <h2>{title}</h2>
      </header>
      <p>{intro ?? PROVENANCE[provenance].summary}</p>
      <div className="kv">
        {rows.map((r) => {
          const doc = FIELD_BY_KEY[r.field];
          return [
            <div key={`${r.field}-k`} className="k">{doc?.label ?? r.field}</div>,
            <div key={`${r.field}-v`} className="v">
              {r.value}
              {doc && <span className="hint">{doc.limits}</span>}
            </div>,
          ];
        })}
      </div>
    </section>
  );
}

const dims = (w: unknown, h: unknown) => (w != null && h != null ? `${w} × ${h} CSS px` : null);

function Flag({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <span className="unknown">unknown (not supplied)</span>;
  return value ? <strong>yes (provider estimate)</strong> : <>no (provider estimate)</>;
}

const ENRICHMENT_STATUS: Record<string, string> = {
  ok: "Looked up",
  mock: "MOCK sample data: not a real lookup",
  "skipped-private": "Skipped: private or reserved IP address (no public geolocation)",
  "skipped-unknown": "Skipped: IP address unknown",
  disabled: "IP lookups disabled",
  pending: "Lookup pending",
  error: "Lookup failed; values unknown",
};

export default async function VisitPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminPage();
  const { id } = await params;
  const detail = await getVisit(getDb(), id);
  if (!detail) notFound();
  const { visit: v, events, otherVisits } = detail;
  const languages = Array.isArray(v.languages) ? (v.languages as string[]) : null;
  const touch = v.max_touch_points == null ? null : Number(v.max_touch_points) > 0 ? `yes (${v.max_touch_points} points)` : "no (0 points)";

  return (
    <>
      <p><Link href="/admin">← All visits</Link></p>
      <div className="section-title" style={{ marginTop: 0 }}>
        <h1 style={{ margin: 0 }}>Visit details</h1>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {v.visitor_id && <DeleteVisitorButton visitorId={v.visitor_id} count={otherVisits + 1} />}
          <DeleteVisitButton id={v.id} />
        </div>
      </div>

      <div className="notice notice-info" style={{ marginTop: 12 }}>
        None of these fields establishes who the visitor is or where they physically are. An IP address can be shared by many people, and
        browser settings are only settings. {v.is_bot ? <>This visit was classified as automated: <strong>{String(v.bot_reason)}</strong>.</> : "This visit was not flagged as automated, but bots that imitate browsers cannot be reliably detected."}
      </div>

      <Section
        provenance="observed"
        title="Observed by the server"
        rows={[
          { field: "started_at", value: <><LocalTime d={v.started_at as Date} /> <span className="muted small">(last activity <LocalTime d={v.last_seen_at as Date} />)</span></> },
          { field: "ip", value: <span className="mono"><Value v={v.ip} /></span> },
          { field: "ip_source", value: <code>{String(v.ip_source)}</code> },
          { field: "user_agent", value: <span className="mono small"><Value v={v.user_agent} /></span> },
          { field: "accept_language", value: <Value v={v.accept_language} /> },
          {
            field: "visitor_id",
            value: v.visitor_id ? (
              <><span className="mono small">{v.visitor_id}</span> <span className="muted small">({otherVisits} other visit(s) with this id)</span></>
            ) : (
              <span className="unknown">none: {v.consent_state === "granted" ? "not set" : "no consent for a persistent id"}</span>
            ),
          },
        ]}
      />

      <Section
        provenance="reported"
        title="Reported by the browser"
        rows={[
          { field: "landing_path", value: <code>{String(v.landing_path)}</code> },
          { field: "referrer_origin", value: <Value v={v.referrer_origin} /> },
          { field: "languages", value: <Value v={languages} /> },
          { field: "time_zone", value: <Value v={v.time_zone} /> },
          { field: "screen", value: <Value v={dims(v.screen_width, v.screen_height)} /> },
          { field: "viewport", value: <Value v={dims(v.viewport_width, v.viewport_height)} /> },
          { field: "max_touch_points", value: <Value v={touch} /> },
          { field: "webdriver", value: <Value v={v.webdriver} /> },
        ]}
      />

      <Section
        provenance="inferred"
        title="Inferred from the User-Agent"
        rows={[
          { field: "browser", value: <Value v={[v.browser_name, v.browser_version].filter(Boolean).join(" ") || null} /> },
          { field: "os", value: <Value v={[v.os_name, v.os_version].filter(Boolean).join(" ") || null} /> },
          { field: "device_category", value: String(v.device_category) },
          { field: "is_bot", value: v.is_bot ? <><span className="badge badge-bot">{String(v.bot_category)}</span> {String(v.bot_reason)}</> : "Not flagged" },
        ]}
      />

      <Section
        provenance="inferred"
        title="Estimated from the IP address"
        intro={
          <>
            Source: <strong>{v.enrichment_source ? String(v.enrichment_source) : <span className="unknown">none</span>}</strong>
            {" · "}Looked up: <LocalTime d={(v.enrichment_at as Date) ?? null} />
            {" · "}Status: {ENRICHMENT_STATUS[String(v.enrichment_status)] ?? String(v.enrichment_status)}
            {v.enrichment_error ? <> ({String(v.enrichment_error)})</> : null}
            {v.enrichment_status === "mock" && <> <span className="badge badge-mock">MOCK DATA</span></>}
          </>
        }
        rows={[
          {
            field: "geo",
            value: <Value v={[v.geo_city, v.geo_region, v.geo_country ?? v.geo_country_code].filter(Boolean).join(", ") || null} />,
          },
          {
            field: "network",
            value: (
              <>
                ISP: <Value v={v.net_isp} /><br />
                Organization: <Value v={v.net_org} /><br />
                ASN: <Value v={v.net_asn} />
              </>
            ),
          },
          {
            field: "network_flags",
            value: (
              <>
                VPN: <Flag value={v.net_vpn} /><br />
                Proxy: <Flag value={v.net_proxy} /><br />
                Tor exit: <Flag value={v.net_tor} /><br />
                Hosting / data center: <Flag value={v.net_hosting} />
                {v.enrichment_source === "ip-api.com" && <span className="hint">ip-api.com reports a single flag covering proxy, VPN, or Tor; it is shown as Proxy.</span>}
              </>
            ),
          },
        ]}
      />

      <section className="detail-section">
        <div className="section-title"><h2>Events ({events.length})</h2></div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Received (server)</th><th>Type</th><th>Page</th><th>Event</th><th>Client clock</th></tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id}>
                  <td style={{ whiteSpace: "nowrap" }}><LocalTime d={e.received_at} /></td>
                  <td>{e.type}</td>
                  <td><code>{e.path}</code></td>
                  <td>{e.name ? <><code>{e.name}</code>{e.label && <span className="muted small"> · {e.label}</span>}</> : <span className="muted">—</span>}</td>
                  <td className="small"><LocalTime d={e.occurred_at} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

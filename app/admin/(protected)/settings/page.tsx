import { PurgeButtons, RetentionForm } from "@/components/admin/AdminActions";
import { requireAdminPage } from "@/lib/admin-page";
import { getConfig } from "@/lib/config";
import { getDb } from "@/lib/db";
import { getRetentionDays } from "@/lib/retention";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  await requireAdminPage();
  const config = getConfig();
  const db = getDb();
  const days = await getRetentionDays(db, config);
  const lastPurge = (await db.query<{ value: string }>(`SELECT value FROM settings WHERE key = 'last_purge_at'`)).rows[0]?.value;

  const rows: [string, React.ReactNode][] = [
    ["Consent mode", <code key="c">{config.consentMode}</code>],
    ["Honor Global Privacy Control", config.honorGpc ? "yes" : "no"],
    ["Client IP source", <><code>{config.ipSource}</code>{config.ipSource === "trusted-proxies" && <> · trusted: <code>{config.trustedProxyCidrs.join(", ") || "(none)"}</code> via <code>{config.trustedProxyHeader}</code></>}</>],
    ["IP storage", config.ipStorage === "full" ? "full address (masked in lists)" : "truncated (/24 IPv4, /48 IPv6)"],
    ["IP lookup provider", <>{config.ipLookupProvider}{config.ipLookupProvider === "mock" && <> <span className="badge badge-mock">MOCK</span></>}</>],
    ["Visitor cookie lifetime", `${config.visitorIdMaxAgeDays} days`],
    ["Ingestion rate limit", `${config.rateLimitPerMinute} events / minute / IP`],
    ["Allowed query parameters", <code key="q">{config.allowedQueryParams.join(", ") || "(none)"}</code>],
  ];

  return (
    <div className="narrow">
      <h1>Settings</h1>
      <div className="card">
        <h2>Data retention</h2>
        <p className="muted small">
          Visits, events, IP lookup cache entries and crawler counters older than this are deleted automatically (hourly while the site
          receives traffic, plus the daily cron job). Default from <code>RETENTION_DAYS</code>: {config.retentionDays} days.
        </p>
        <RetentionForm current={days} />
        <p className="small muted" style={{ marginTop: 12, marginBottom: 0 }}>Last purge: {lastPurge ? new Date(lastPurge).toISOString() : "never"}</p>
      </div>
      <div className="card" style={{ marginTop: 16 }}>
        <h2>Delete data</h2>
        <p className="muted small">Individual visits and visitor ids can be deleted from a visit&apos;s detail page.</p>
        <PurgeButtons />
      </div>
      <div className="card" style={{ marginTop: 16 }}>
        <h2>Configuration</h2>
        <p className="muted small">Set through environment variables; see the README.</p>
        <div className="kv">
          {rows.map(([k, v]) => [<div key={`${k}k`} className="k">{k}</div>, <div key={`${k}v`} className="v">{v}</div>])}
        </div>
      </div>
    </div>
  );
}

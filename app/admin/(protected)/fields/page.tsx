import { ProvenanceBadge } from "@/components/admin/Value";
import { requireAdminPage } from "@/lib/admin-page";
import { FIELDS, PROVENANCE, type Provenance } from "@/lib/field-docs";

export default async function FieldGuide() {
  await requireAdminPage();
  const groups: Provenance[] = ["observed", "reported", "inferred"];
  return (
    <div className="narrow">
      <h1>Field guide</h1>
      <p className="muted">
        What each field means and how far to trust it. Fields marked unknown were unavailable, blocked, or not supplied; they are never
        filled with guesses.
      </p>
      {groups.map((g) => (
        <section key={g} className="detail-section card">
          <header><ProvenanceBadge p={g} /><h2>{PROVENANCE[g].label}</h2></header>
          <p>{PROVENANCE[g].summary}</p>
          <div className="kv">
            {FIELDS.filter((f) => f.provenance === g).map((f) => [
              <div key={`${f.key}k`} className="k">{f.label}</div>,
              <div key={`${f.key}v`} className="v">{f.meaning}<span className="hint"><strong>Limitations:</strong> {f.limits}</span></div>,
            ])}
          </div>
        </section>
      ))}
      <section className="detail-section card">
        <h2>Counting rules</h2>
        <ul className="small">
          <li><strong>Page views</strong> are deduplicated by a random event id generated in the browser. Network retries reuse the id, and React Strict Mode&apos;s double effects are filtered client-side.</li>
          <li><strong>Visits</strong> group events by a random session id: per tab for up to 30 idle minutes with consent, otherwise per page load.</li>
          <li><strong>Estimated visitors</strong> = distinct returning-visitor ids + visits without an id. It overcounts people who use several browsers or clear cookies, and undercounts shared browsers.</li>
          <li><strong>Automated traffic</strong> is excluded from human totals by default. Crawlers and link previewers that fetch pages without running JavaScript are counted separately as page fetches.</li>
          <li><strong>Dates</strong> in filters and charts use UTC.</li>
        </ul>
      </section>
    </div>
  );
}

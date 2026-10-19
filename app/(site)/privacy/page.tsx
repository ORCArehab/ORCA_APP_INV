import { DeleteMyData } from "@/components/analytics/DeleteMyData";
import { PrivacyChoicesButton } from "@/components/analytics/AnalyticsProvider";
import { getConfig } from "@/lib/config";
import { getDb } from "@/lib/db";
import { FIELDS, PROVENANCE, type Provenance } from "@/lib/field-docs";
import { getRetentionDays } from "@/lib/retention";

export const metadata = { title: "Privacy notice" };

async function retentionDays() {
  const config = getConfig();
  try {
    return await getRetentionDays(getDb(), config);
  } catch {
    return config.retentionDays;
  }
}

const PROVIDER_TEXT: Record<string, string> = {
  vercel: "Approximate city, region and country are estimated from your IP address by our hosting provider, Vercel, as part of delivering the request. Your IP address is not sent to any other company.",
  ipinfo: "To estimate location and network, our server sends your IP address to IPinfo (ipinfo.io). Your browser never contacts that provider.",
  "ip-api": "To estimate location and network, our server sends your IP address to ip-api.com. Your browser never contacts that provider.",
  mock: "Your IP address is not sent to any location provider (sample data is used instead).",
  none: "Your IP address is not used to estimate location.",
};

export default async function PrivacyPage() {
  const config = getConfig();
  const days = await retentionDays();
  const groups: Provenance[] = ["observed", "reported", "inferred"];

  return (
    <div className="narrow prose">
      <h1>Privacy notice: website analytics</h1>
      <p className="muted">This notice covers the analytics on this website only.</p>

      <h2>Your choice</h2>
      {config.consentMode === "opt-in" && <p>Analytics are <strong>off until you accept</strong>. If you decline, nothing is recorded.</p>}
      {config.consentMode === "opt-out" && (
        <p>
          Analytics are <strong>on by default</strong>: we record every visit as described below without setting a tracking cookie. You
          can opt out at any time, and we treat a Global Privacy Control signal from your browser as an opt-out. A returning-visitor
          cookie is set only if you explicitly accept it.
        </p>
      )}
      {config.consentMode === "disabled" && <p>Analytics are currently <strong>disabled</strong> on this site. Nothing is recorded.</p>}
      <p>You can change your choice at any time: <PrivacyChoicesButton /></p>

      <h2>What we record if analytics are on</h2>
      <p>We label every field by where it comes from, because that determines how much it can be trusted.</p>
      {groups.map((g) => (
        <div key={g}>
          <h3>
            <span className={`badge badge-${g}`}>{PROVENANCE[g].label}</span>
          </h3>
          <p className="muted small">{PROVENANCE[g].summary}</p>
          <ul>
            {FIELDS.filter((f) => f.provenance === g).map((f) => (
              <li key={f.key}>
                <strong>{f.label}</strong>: {f.meaning}
              </li>
            ))}
          </ul>
        </div>
      ))}

      <h2>What this data cannot tell us</h2>
      <ul>
        <li>An IP address can be shared by many people and reassigned. It identifies a network connection, not you.</li>
        <li>City and region come from a database estimate and are often wrong. We never request your precise location.</li>
        <li>Browser language, time zone, and screen size are settings. They do not establish who you are or where you are.</li>
        <li>VPN, proxy, Tor, or hosting labels, when shown, are estimates from our IP lookup provider. We do not guess VPN use from your settings.</li>
      </ul>

      <h2>What we never do</h2>
      <ul>
        <li>No hidden fingerprinting: no canvas, audio, WebGL, or font probing.</li>
        <li>No recording of anything you type, and no session replays.</li>
        <li>No camera, microphone, or location permission requests.</li>
        <li>No third-party trackers or cross-site tracking. Everything is sent only to this website.</li>
      </ul>

      <h2>Who processes it</h2>
      <p>
        Data is stored in this site&apos;s own database. {PROVIDER_TEXT[config.ipLookupProvider]} Only site administrators can view the
        dashboard.
      </p>

      <h2>How long we keep it</h2>
      <p>
        Analytics records are deleted automatically after <strong>{days} days</strong>. The returning-visitor cookie expires after{" "}
        {config.visitorIdMaxAgeDays} days, or immediately if you decline.
      </p>

      <h2>Cookies and storage</h2>
      <ul>
        <li><code>va_consent</code>: remembers your choice (accepted/declined).</li>
        <li><code>va_vid</code>: random returning-visitor id, set only after you accept. HttpOnly, this site only.</li>
        <li><code>va_sid</code> (session storage): groups page views within one tab session after you accept. Cleared when the tab closes.</li>
      </ul>

      <h2>Delete your data</h2>
      <DeleteMyData />
    </div>
  );
}

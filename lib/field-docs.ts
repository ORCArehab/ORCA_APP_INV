/**
 * One source of truth for what each stored field means and how far it can be trusted.
 * Rendered on the visit detail page, the field guide, and the visitor privacy notice.
 */

export type Provenance = "observed" | "reported" | "inferred";

export const PROVENANCE: Record<Provenance, { label: string; summary: string }> = {
  observed: {
    label: "Observed by server",
    summary: "Seen directly by our server on the incoming request. Accurate as a record of the request, but says nothing certain about who sent it.",
  },
  reported: {
    label: "Reported by browser",
    summary: "Sent by the visitor's browser script. Browsers, extensions, privacy tools and automated clients can change or fake any of these values.",
  },
  inferred: {
    label: "Inferred / estimated",
    summary: "Derived from other data by a parser, heuristic or third-party database. Treat as an estimate that can be wrong.",
  },
};

export type FieldDoc = { key: string; label: string; provenance: Provenance; meaning: string; limits: string };

export const FIELDS: FieldDoc[] = [
  { key: "started_at", label: "Visit time", provenance: "observed", meaning: "When the server received the first event of this visit (server clock, shown in your local time).", limits: "Reflects when the beacon arrived, which can lag the actual page load by a moment or, after retries, by seconds." },
  { key: "ip", label: "Public IP address", provenance: "observed", meaning: "The network address the request came from, as seen by the server (or by a trusted proxy you configured).", limits: "Often shared by many people (mobile carriers, CGNAT, offices, schools, VPNs, privacy relays) and reassigned over time. It identifies a network connection at a moment, not a person or a device. Masked in list views." },
  { key: "ip_source", label: "IP determined by", provenance: "observed", meaning: "How the IP was obtained: the direct TCP connection, a header from an explicitly trusted proxy, or the hosting platform.", limits: "If the trusted-proxy configuration is wrong, the IP may be the proxy's address. Untrusted forwarded headers are always ignored." },
  { key: "user_agent", label: "User-Agent", provenance: "observed", meaning: "The User-Agent header the client sent.", limits: "Freely set by the client. Modern browsers also reduce (freeze) parts of it, so versions and OS details are often generic." },
  { key: "accept_language", label: "Accept-Language header", provenance: "observed", meaning: "Language preferences the browser sent with the request.", limits: "A browser setting. It does not indicate nationality, location, or identity." },
  { key: "landing_path", label: "Landing page", provenance: "reported", meaning: "The first page path reported in this visit. Only allow-listed query parameters (e.g. utm_*) are kept; email- and token-like path segments are redacted.", limits: "Reported by the page script." },
  { key: "referrer_origin", label: "Referring origin", provenance: "reported", meaning: "Scheme and host of the page that linked here (from document.referrer). Path and query are discarded.", limits: "Frequently empty: many sites, apps, and browsers suppress or trim referrers. Empty does not mean 'typed directly'." },
  { key: "languages", label: "Browser languages", provenance: "reported", meaning: "navigator.languages: the visitor's preferred languages in order.", limits: "A preference setting. It is not evidence of where someone is or who they are." },
  { key: "time_zone", label: "Configured time zone", provenance: "reported", meaning: "The time zone the device is set to (Intl API).", limits: "A device setting that travellers, remote workers and many devices leave unchanged. It is not a location, and a mismatch with IP location is not evidence of VPN use." },
  { key: "screen", label: "Screen size", provenance: "reported", meaning: "Screen dimensions in CSS pixels.", limits: "Affected by zoom, display scaling, and privacy tools. Very common values; not distinctive." },
  { key: "viewport", label: "Viewport size", provenance: "reported", meaning: "Browser window content area in CSS pixels at the latest event.", limits: "Changes with window resizing and device rotation." },
  { key: "max_touch_points", label: "Touch support", provenance: "reported", meaning: "navigator.maxTouchPoints: how many simultaneous touch points the device reports (0 = no touch).", limits: "Touch-screen laptops report touch; some browsers report 0 for privacy." },
  { key: "webdriver", label: "Automation flag", provenance: "reported", meaning: "navigator.webdriver: true when the browser says it is controlled by automation software.", limits: "Honest automation sets it; evasive bots hide it." },
  { key: "browser", label: "Browser", provenance: "inferred", meaning: "Browser name and major version parsed from the User-Agent.", limits: "Only as accurate as the User-Agent, which can be spoofed or frozen." },
  { key: "os", label: "Operating system", provenance: "inferred", meaning: "OS parsed from the User-Agent.", limits: "Versions are often frozen or generic (e.g. macOS always reports 10.15.7)." },
  { key: "device_category", label: "Device category", provenance: "inferred", meaning: "Mobile, tablet, or desktop, parsed from the User-Agent (and the Sec-CH-UA-Mobile hint).", limits: "iPads commonly report as desktop Macs. 'unknown' when no category can be determined." },
  { key: "is_bot", label: "Automated traffic", provenance: "inferred", meaning: "Heuristic classification as crawler, link previewer, automation tool, or missing User-Agent.", limits: "Catches self-identifying bots only. Bots that imitate browsers are counted as people; rare real browsers may be misclassified." },
  { key: "geo", label: "Approximate location", provenance: "inferred", meaning: "Country, region and city estimated by the IP lookup provider for the IP address.", limits: "City-level estimates are often wrong, sometimes by hundreds of kilometres; they often show where the network operator is registered or routes traffic. Not a physical address, and never precise location." },
  { key: "network", label: "ISP / organization / ASN", provenance: "inferred", meaning: "The network operator the provider associates with the IP.", limits: "Identifies the network, not the person. Corporate, school and cloud networks serve many people." },
  { key: "network_flags", label: "VPN / proxy / Tor / hosting indicators", provenance: "inferred", meaning: "Indicators supplied by the IP lookup provider, shown with the provider name and lookup date. Unknown when the provider (or your plan) does not supply them.", limits: "Provider estimates from their own lists, which lag reality and contain false positives. We never infer VPN use from language or time-zone mismatches." },
  { key: "visitor_id", label: "Returning-visitor id", provenance: "observed", meaning: "A random first-party id stored in a cookie on this site only after the visitor accepted analytics. Links visits from the same browser.", limits: "Per browser, not per person: clearing cookies, private windows, or another device produce a new id. One shared browser can be several people." },
];

export const FIELD_BY_KEY = Object.fromEntries(FIELDS.map((f) => [f.key, f])) as Record<string, FieldDoc>;

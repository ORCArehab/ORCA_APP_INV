import { createHash } from "node:crypto";
import type { AppConfig } from "./config";
import type { Db } from "./db";
import { isNonPublicIp } from "./ip";

/**
 * Server-side IP enrichment. Results are provider *estimates*: IP geolocation databases map
 * address blocks to the registered or routed location of a network, which is often a city
 * where the ISP has infrastructure rather than where the person is. Many people can share
 * one IP (mobile carriers, CGNAT, offices, VPNs).
 */

export type Enrichment = {
  status: "ok" | "mock" | "skipped-private" | "skipped-unknown" | "disabled" | "error";
  source: string | null;
  at: Date;
  error: string | null;
  countryCode: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  isp: string | null;
  org: string | null;
  asn: string | null;
  vpn: boolean | null;
  proxy: boolean | null;
  tor: boolean | null;
  hosting: boolean | null;
};

type Fields = Omit<Enrichment, "status" | "source" | "at" | "error">;

const EMPTY: Fields = {
  countryCode: null, country: null, region: null, city: null, isp: null, org: null, asn: null,
  vpn: null, proxy: null, tor: null, hosting: null,
};

export type FetchLike = (url: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

const countryNames = new Intl.DisplayNames(["en"], { type: "region" });
function countryName(code: string | null): string | null {
  if (!code || !/^[A-Z]{2}$/.test(code)) return null;
  try {
    return countryNames.of(code) ?? null;
  } catch {
    return null;
  }
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, 200) : null);
const flag = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);

/** ipinfo.io response. `privacy` is only present on plans that include it. */
export function mapIpinfo(d: Record<string, unknown>): Fields {
  const org = str(d.org); // e.g. "AS15169 Google LLC"
  const asnMatch = org ? /^(AS\d+)\s+(.*)$/.exec(org) : null;
  const asnObj = (d.asn ?? null) as Record<string, unknown> | null;
  const company = (d.company ?? null) as Record<string, unknown> | null;
  const privacy = (d.privacy ?? null) as Record<string, unknown> | null;
  const code = str(d.country)?.toUpperCase() ?? null;
  return {
    countryCode: code,
    country: countryName(code),
    region: str(d.region),
    city: str(d.city),
    isp: str(company?.name) ?? str(asnObj?.name) ?? (asnMatch ? asnMatch[2] : null),
    org: asnMatch ? asnMatch[2] : org,
    asn: str(asnObj?.asn) ?? (asnMatch ? asnMatch[1] : null),
    vpn: flag(privacy?.vpn),
    proxy: flag(privacy?.proxy),
    tor: flag(privacy?.tor),
    hosting: flag(privacy?.hosting),
  };
}

/** ip-api.com Pro response. Its single `proxy` flag covers "proxy, VPN or Tor exit". */
export function mapIpApi(d: Record<string, unknown>): Fields {
  const code = str(d.countryCode)?.toUpperCase() ?? null;
  const as = str(d.as); // "AS15169 Google LLC"
  return {
    countryCode: code,
    country: str(d.country) ?? countryName(code),
    region: str(d.regionName),
    city: str(d.city),
    isp: str(d.isp),
    org: str(d.org),
    asn: as ? (/^(AS\d+)/.exec(as)?.[1] ?? null) : null,
    vpn: null,
    proxy: flag(d.proxy),
    tor: null,
    hosting: flag(d.hosting),
  };
}

const MOCK_PLACES = [
  { countryCode: "US", region: "Oregon", city: "Portland", isp: "Example Cable Co.", asn: "AS64500" },
  { countryCode: "DE", region: "Hesse", city: "Frankfurt am Main", isp: "Beispiel Telekom", asn: "AS64501" },
  { countryCode: "JP", region: "Tokyo", city: "Tokyo", isp: "Sample Fiber KK", asn: "AS64502" },
  { countryCode: "BR", region: "São Paulo", city: "São Paulo", isp: "Exemplo Net", asn: "AS64503" },
  { countryCode: "PH", region: "Metro Manila", city: "Quezon City", isp: "Halimbawa Telecom", asn: "AS64504" },
  { countryCode: "GB", region: "England", city: "London", isp: "Placeholder Broadband", asn: "AS64505" },
];

/** Deterministic fake data so the dashboard is usable without an API key. Never real. */
export function mockLookup(ip: string): Fields {
  const h = createHash("sha256").update(ip).digest();
  const p = MOCK_PLACES[h[0] % MOCK_PLACES.length];
  const hosting = h[1] % 5 === 0;
  return {
    ...p,
    country: countryName(p.countryCode),
    org: hosting ? "Mock Cloud Hosting (MOCK)" : `${p.isp} (MOCK)`,
    isp: `${p.isp} (MOCK)`,
    vpn: h[2] % 7 === 0,
    proxy: false,
    tor: false,
    hosting,
  };
}

export async function lookupIp(
  ip: string | null,
  config: Pick<AppConfig, "ipLookupProvider" | "ipLookupApiKey" | "ipLookupTimeoutMs">,
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
  now = new Date(),
): Promise<Enrichment> {
  const base = { at: now, error: null };
  const provider = config.ipLookupProvider;
  if (provider === "none") return { ...EMPTY, ...base, status: "disabled", source: null };
  if (!ip) return { ...EMPTY, ...base, status: "skipped-unknown", source: null };
  if (provider === "mock") return { ...mockLookup(ip), ...base, status: "mock", source: "mock (sample data, not a real lookup)" };
  if (isNonPublicIp(ip)) return { ...EMPTY, ...base, status: "skipped-private", source: null };

  const key = encodeURIComponent(config.ipLookupApiKey ?? "");
  const target = encodeURIComponent(ip);
  const url =
    provider === "ipinfo"
      ? `https://ipinfo.io/${target}/json`
      : `https://pro.ip-api.com/json/${target}?key=${key}&fields=status,message,country,countryCode,regionName,city,isp,org,as,proxy,hosting`;
  const headers: Record<string, string> = { accept: "application/json" };
  if (provider === "ipinfo") headers.authorization = `Bearer ${config.ipLookupApiKey}`;

  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(config.ipLookupTimeoutMs), headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as Record<string, unknown>;
    if (provider === "ip-api" && data.status !== "success") throw new Error(String(data.message ?? "lookup failed"));
    const fields = provider === "ipinfo" ? mapIpinfo(data) : mapIpApi(data);
    return { ...fields, ...base, status: "ok", source: provider === "ipinfo" ? "ipinfo.io" : "ip-api.com" };
  } catch (err) {
    return { ...EMPTY, ...base, status: "error", source: provider, error: (err as Error).message.slice(0, 200) };
  }
}

/** Looks up (with a short-lived cache) and writes the result onto the visit row. */
export async function enrichVisit(
  db: Db,
  visitId: string,
  ip: string | null,
  config: AppConfig,
  fetchImpl?: FetchLike,
): Promise<Enrichment> {
  let result: Enrichment | null = null;
  const cacheable = ip && config.ipLookupCacheHours > 0 && config.ipLookupProvider !== "mock" && config.ipLookupProvider !== "none";
  if (cacheable) {
    const cached = await db.query<{ data: Enrichment; looked_up_at: Date }>(
      `SELECT data, looked_up_at FROM ip_lookup_cache
        WHERE ip = $1 AND provider = $2 AND looked_up_at > now() - make_interval(hours => $3)`,
      [ip, config.ipLookupProvider, config.ipLookupCacheHours],
    );
    if (cached.rows[0]) result = { ...cached.rows[0].data, at: new Date(cached.rows[0].looked_up_at) };
  }
  if (!result) {
    result = await lookupIp(ip, config, fetchImpl);
    if (cacheable && result.status === "ok") {
      await db.query(
        `INSERT INTO ip_lookup_cache (ip, provider, data, looked_up_at) VALUES ($1, $2, $3, $4)
         ON CONFLICT (ip) DO UPDATE SET provider = EXCLUDED.provider, data = EXCLUDED.data, looked_up_at = EXCLUDED.looked_up_at`,
        [ip, config.ipLookupProvider, JSON.stringify(result), result.at],
      );
    }
  }
  await db.query(
    `UPDATE visits SET
       enrichment_status = $2, enrichment_source = $3, enrichment_at = $4, enrichment_error = $5,
       geo_country_code = $6, geo_country = $7, geo_region = $8, geo_city = $9,
       net_isp = $10, net_org = $11, net_asn = $12,
       net_vpn = $13, net_proxy = $14, net_tor = $15, net_hosting = $16
     WHERE id = $1`,
    [
      visitId, result.status, result.source, result.at, result.error,
      result.countryCode, result.country, result.region, result.city,
      result.isp, result.org, result.asn,
      result.vpn, result.proxy, result.tor, result.hosting,
    ],
  );
  return result;
}

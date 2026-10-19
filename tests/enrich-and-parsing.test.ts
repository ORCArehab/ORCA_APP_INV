import { describe, expect, it } from "vitest";
import { classifyAgent } from "@/lib/bots";
import { parseConfig } from "@/lib/config";
import { lookupIp, mapIpApi, mapIpinfo, type FetchLike } from "@/lib/enrich";
import { sanitizePath, sanitizeReferrerOrigin } from "@/lib/sanitize";
import { parseUserAgent } from "@/lib/ua";

const cfg = (provider: "mock" | "ipinfo" | "ip-api" | "none") => ({ ipLookupProvider: provider, ipLookupApiKey: "k", ipLookupTimeoutMs: 1000 });
const fakeFetch = (body: unknown, ok = true): FetchLike => async () => ({ ok, status: ok ? 200 : 500, json: async () => body });

describe("IP enrichment", () => {
  it("falls back to clearly-labelled mock data when no API key is configured", () => {
    expect(parseConfig({ IP_LOOKUP_PROVIDER: "ipinfo" }).ipLookupProvider).toBe("mock");
    expect(parseConfig({ IP_LOOKUP_PROVIDER: "ipinfo", IP_LOOKUP_API_KEY: "abc" }).ipLookupProvider).toBe("ipinfo");
  });

  it("mock results are deterministic and marked as mock", async () => {
    const a = await lookupIp("203.0.113.9", cfg("mock"));
    const b = await lookupIp("203.0.113.9", cfg("mock"));
    expect(a.status).toBe("mock");
    expect(a.source).toMatch(/not a real lookup/);
    expect(a.isp).toMatch(/\(MOCK\)/);
    expect(a.city).toBe(b.city);
  });

  it("maps ipinfo responses, including privacy flags only when supplied", () => {
    const withPrivacy = mapIpinfo({ city: "Mountain View", region: "California", country: "US", org: "AS15169 Google LLC", privacy: { vpn: false, proxy: false, tor: false, hosting: true } });
    expect(withPrivacy).toMatchObject({ countryCode: "US", country: "United States", city: "Mountain View", asn: "AS15169", org: "Google LLC", hosting: true, vpn: false });
    const without = mapIpinfo({ city: "Paris", country: "FR", org: "AS3215 Orange S.A." });
    expect(without).toMatchObject({ vpn: null, proxy: null, tor: null, hosting: null });
  });

  it("maps ip-api responses (its proxy flag; VPN/Tor stay unknown)", () => {
    expect(mapIpApi({ country: "Germany", countryCode: "DE", regionName: "Hesse", city: "Frankfurt", isp: "ISP", org: "Org", as: "AS3320 DTAG", proxy: true, hosting: false }))
      .toMatchObject({ countryCode: "DE", asn: "AS3320", proxy: true, vpn: null, tor: null, hosting: false });
  });

  it("records provider errors as unknown instead of guessing", async () => {
    const r = await lookupIp("8.8.8.8", cfg("ipinfo"), fakeFetch({}, false));
    expect(r).toMatchObject({ status: "error", city: null, vpn: null });
    const failed = await lookupIp("8.8.8.8", cfg("ip-api"), fakeFetch({ status: "fail", message: "invalid query" }));
    expect(failed.status).toBe("error");
  });

  it("skips private addresses and unknown IPs for real providers", async () => {
    expect((await lookupIp("10.0.0.1", cfg("ipinfo"), fakeFetch({}))).status).toBe("skipped-private");
    expect((await lookupIp(null, cfg("ipinfo"))).status).toBe("skipped-unknown");
    expect((await lookupIp("8.8.8.8", cfg("none"))).status).toBe("disabled");
  });

  it("sends API keys only to the provider, server-side", async () => {
    let seen: { url: string; headers?: Record<string, string> } | null = null;
    const spy: FetchLike = async (url, init) => {
      seen = { url, headers: init?.headers };
      return { ok: true, status: 200, json: async () => ({ country: "US" }) };
    };
    await lookupIp("8.8.8.8", cfg("ipinfo"), spy);
    expect(seen!.url).toBe("https://ipinfo.io/8.8.8.8/json");
    expect(seen!.headers?.authorization).toBe("Bearer k");
  });
});

describe("URL sanitization", () => {
  const allowed = ["utm_source", "utm_campaign"];
  it("keeps only allow-listed query params and drops fragments", () => {
    expect(sanitizePath("/a?utm_source=x&token=abc&email=me@x.com#frag", allowed)).toBe("/a?utm_source=x");
  });
  it("redacts emails and token-like path segments", () => {
    expect(sanitizePath("/users/jane%40example.com/profile", allowed)).toBe("/users/:email/profile");
    expect(sanitizePath("/reset/eyJhbGciOiJIUzI1NiJ9abc123XYZ", allowed)).toBe("/reset/:token");
    expect(sanitizePath("/blog/how-to-configure-your-website", allowed)).toBe("/blog/how-to-configure-your-website");
  });
  it("rejects non-paths", () => {
    expect(sanitizePath("//evil.example/x", allowed)).toBeNull();
    expect(sanitizePath("https://evil.example/x", allowed)).toBeNull();
  });
  it("keeps only the referrer origin", () => {
    expect(sanitizeReferrerOrigin("https://mail.example.com/inbox?msg=123&session=abc")).toBe("https://mail.example.com");
    expect(sanitizeReferrerOrigin("javascript:alert(1)")).toBeNull();
    expect(sanitizeReferrerOrigin("")).toBeNull();
  });
});

describe("user-agent parsing and bot classification", () => {
  it("infers browser, OS and device category", () => {
    const iphone = parseUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1");
    expect(iphone).toMatchObject({ browserName: "Safari", osName: "iOS", deviceCategory: "mobile" });
    expect(parseUserAgent(null).deviceCategory).toBe("unknown");
  });
  it.each([
    ["facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)", "link-preview"],
    ["Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)", "link-preview"],
    ["Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)", "crawler"],
    ["Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2)", "crawler"],
    ["Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/131.0.0.0 Safari/537.36", "automation"],
    ["curl/8.7.1", "automation"],
    ["", "no-user-agent"],
  ])("%s → %s", (ua, category) => {
    expect(classifyAgent(ua).category).toBe(category);
  });
  it("does not flag ordinary browsers", () => {
    expect(classifyAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0").isBot).toBe(false);
  });
});

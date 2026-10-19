import { describe, expect, it } from "vitest";
import { isNonPublicIp, maskIp, normalizeIp, readVerifiedPeerIp, resolveClientIp, truncateIp } from "@/lib/ip";
import { testConfig } from "./helpers";

const h = (o: Record<string, string>) => new Headers(o);

describe("normalizeIp", () => {
  it("accepts IPv4, IPv6, ports, brackets and IPv4-mapped IPv6", () => {
    expect(normalizeIp("203.0.113.9")).toBe("203.0.113.9");
    expect(normalizeIp("203.0.113.9:4431")).toBe("203.0.113.9");
    expect(normalizeIp("[2001:DB8::1]:443")).toBe("2001:db8::1");
    expect(normalizeIp("::ffff:198.51.100.7")).toBe("198.51.100.7");
    expect(normalizeIp("fe80::1%eth0")).toBe("fe80::1");
  });
  it("rejects garbage", () => {
    for (const v of ["", "unknown", "1.2.3", "999.1.1.1", "<script>", "1.2.3.4, 5.6.7.8", "a".repeat(100)]) expect(normalizeIp(v)).toBeNull();
  });
});

describe("resolveClientIp — socket mode (no proxy)", () => {
  const config = testConfig({ IP_SOURCE: "socket" });
  it("uses the TCP peer and ignores every forwarded header a client can send", () => {
    const r = resolveClientIp({
      peerIp: "198.51.100.20",
      headers: h({ "x-forwarded-for": "1.1.1.1", "x-real-ip": "2.2.2.2", "cf-connecting-ip": "3.3.3.3", "true-client-ip": "4.4.4.4" }),
      config,
    });
    expect(r).toEqual({ ip: "198.51.100.20", source: "socket" });
  });
  it("reports unknown when the peer address is unavailable rather than falling back to headers", () => {
    expect(resolveClientIp({ peerIp: null, headers: h({ "x-forwarded-for": "1.1.1.1" }), config }).ip).toBeNull();
  });
});

describe("resolveClientIp — trusted proxies", () => {
  const config = testConfig({ IP_SOURCE: "trusted-proxies", TRUSTED_PROXY_CIDRS: "10.0.0.0/8, 2001:db8:ffff::/48" });

  it("ignores X-Forwarded-For when the peer is not a trusted proxy (direct spoof attempt)", () => {
    const r = resolveClientIp({ peerIp: "198.51.100.20", headers: h({ "x-forwarded-for": "8.8.8.8" }), config });
    expect(r.ip).toBe("198.51.100.20");
    expect(r.source).toContain("not a trusted proxy");
  });

  it("takes the right-most untrusted hop, so client-prepended values are ignored", () => {
    // Client sent "X-Forwarded-For: 6.6.6.6"; our proxy appended the real client address.
    const r = resolveClientIp({ peerIp: "10.0.0.5", headers: h({ "x-forwarded-for": "6.6.6.6, 198.51.100.77" }), config });
    expect(r).toEqual({ ip: "198.51.100.77", source: "trusted-proxy:x-forwarded-for" });
  });

  it("skips multiple trusted hops", () => {
    const r = resolveClientIp({ peerIp: "10.0.0.5", headers: h({ "x-forwarded-for": "6.6.6.6, 203.0.113.4, 10.1.1.1, 10.2.2.2" }), config });
    expect(r.ip).toBe("203.0.113.4");
  });

  it("supports IPv6 proxies", () => {
    const r = resolveClientIp({ peerIp: "2001:db8:ffff::10", headers: h({ "x-forwarded-for": "2001:db8:1::99" }), config });
    expect(r.ip).toBe("2001:db8:1::99");
  });

  it("treats malformed chains as unknown instead of guessing", () => {
    const r = resolveClientIp({ peerIp: "10.0.0.5", headers: h({ "x-forwarded-for": "1.1.1.1, not-an-ip" }), config });
    expect(r.ip).toBeNull();
  });

  it("falls back to the peer when a trusted proxy sends no header", () => {
    expect(resolveClientIp({ peerIp: "10.0.0.5", headers: h({}), config }).ip).toBe("10.0.0.5");
  });

  it("reads a configured single-value header only from trusted peers", () => {
    const cf = testConfig({ IP_SOURCE: "trusted-proxies", TRUSTED_PROXY_CIDRS: "173.245.48.0/20", TRUSTED_PROXY_HEADER: "CF-Connecting-IP" });
    expect(resolveClientIp({ peerIp: "173.245.48.10", headers: h({ "cf-connecting-ip": "203.0.113.50" }), config: cf }).ip).toBe("203.0.113.50");
    expect(resolveClientIp({ peerIp: "198.51.100.1", headers: h({ "cf-connecting-ip": "203.0.113.50" }), config: cf }).ip).toBe("198.51.100.1");
  });

  it("rejects invalid CIDR configuration loudly", () => {
    const bad = testConfig({ IP_SOURCE: "trusted-proxies", TRUSTED_PROXY_CIDRS: "10.0.0.0/99" });
    expect(() => resolveClientIp({ peerIp: "10.0.0.1", headers: h({}), config: bad })).toThrow();
  });
});

describe("resolveClientIp — vercel mode", () => {
  it("reads Vercel's headers only when actually running on Vercel", () => {
    const off = testConfig({ IP_SOURCE: "vercel" });
    expect(resolveClientIp({ peerIp: null, headers: h({ "x-real-ip": "203.0.113.1" }), config: off }).ip).toBeNull();
    const on = { ...off, runningOnVercel: true };
    expect(resolveClientIp({ peerIp: null, headers: h({ "x-real-ip": "203.0.113.1" }), config: on }).ip).toBe("203.0.113.1");
  });
});

describe("peer verification header from server.mjs", () => {
  it("requires the per-process token", () => {
    const headers = h({ "x-va-peer-ip": "198.51.100.3", "x-va-peer-token": "secret-token" });
    expect(readVerifiedPeerIp(headers, "secret-token")).toBe("198.51.100.3");
    expect(readVerifiedPeerIp(headers, "other-token")).toBeNull();
    expect(readVerifiedPeerIp(h({ "x-va-peer-ip": "198.51.100.3" }), "secret-token")).toBeNull();
    expect(readVerifiedPeerIp(headers, undefined)).toBeNull();
  });
});

describe("masking and truncation", () => {
  it("masks list-view IPs", () => {
    expect(maskIp("203.0.113.45")).toBe("203.0.•••.•••");
    expect(maskIp("2001:db8:abcd:12::1")).toBe("2001:db8:••••:••••::");
    expect(maskIp(null)).toBe("unknown");
  });
  it("truncates stored IPs", () => {
    expect(truncateIp("203.0.113.45")).toBe("203.0.113.0");
    expect(truncateIp("2001:db8:abcd:12::1")).toBe("2001:db8:abcd::");
  });
  it("identifies non-public ranges", () => {
    expect(isNonPublicIp("10.1.2.3")).toBe(true);
    expect(isNonPublicIp("::1")).toBe(true);
    expect(isNonPublicIp("8.8.8.8")).toBe(false);
  });
});

describe("IP_SOURCE default", () => {
  it("uses Vercel headers on Vercel and the socket elsewhere", async () => {
    const { parseConfig } = await import("@/lib/config");
    expect(parseConfig({}).ipSource).toBe("socket");
    expect(parseConfig({ VERCEL: "1" }).ipSource).toBe("vercel");
    expect(parseConfig({ VERCEL: "1", IP_SOURCE: "trusted-proxies" }).ipSource).toBe("trusted-proxies");
  });
});

import net from "node:net";
import type { AppConfig } from "./config";

/**
 * Client IP resolution.
 *
 * Forwarded headers (X-Forwarded-For, X-Real-IP, CF-Connecting-IP, ...) are plain request
 * headers that any client can send. They are only meaningful when a proxy *you operate or
 * configured* wrote them, so we only read them when the TCP peer is a trusted proxy (or, on
 * Vercel, where the platform overwrites them). Everything else is ignored.
 */

export type IpResolution = { ip: string | null; source: string };

export type IpResolutionInput = {
  /** The TCP peer address, verified by server.mjs. null when unavailable. */
  peerIp: string | null;
  headers: Headers;
  config: Pick<AppConfig, "ipSource" | "trustedProxyCidrs" | "trustedProxyHeader" | "runningOnVercel">;
};

/** Returns a canonical IP string, or null if the value is not a bare IP address. */
export function normalizeIp(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let v = raw.trim();
  if (v.length === 0 || v.length > 64) return null;
  // "[2001:db8::1]:443" or "[2001:db8::1]"
  const bracket = /^\[([^\]]+)\](?::\d+)?$/.exec(v);
  if (bracket) v = bracket[1];
  // "203.0.113.5:1234"
  else if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(v)) v = v.slice(0, v.lastIndexOf(":"));
  // Drop IPv6 zone ids ("fe80::1%eth0").
  const zone = v.indexOf("%");
  if (zone !== -1) v = v.slice(0, zone);
  const kind = net.isIP(v);
  if (kind === 0) return null;
  if (kind === 6) {
    const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(v);
    if (mapped) return mapped[1];
    return v.toLowerCase();
  }
  return v;
}

export function buildCidrList(cidrs: string[]): net.BlockList {
  const list = new net.BlockList();
  for (const entry of cidrs) {
    const [addr, prefixRaw] = entry.split("/");
    const ip = normalizeIp(addr);
    if (!ip) throw new Error(`Invalid trusted proxy entry: ${entry}`);
    const type = net.isIPv6(ip) ? "ipv6" : "ipv4";
    const prefix = prefixRaw === undefined ? (type === "ipv6" ? 128 : 32) : Number(prefixRaw);
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > (type === "ipv6" ? 128 : 32)) {
      throw new Error(`Invalid prefix in trusted proxy entry: ${entry}`);
    }
    list.addSubnet(ip, prefix, type);
  }
  return list;
}

function inList(list: net.BlockList, ip: string): boolean {
  return list.check(ip, net.isIPv6(ip) ? "ipv6" : "ipv4");
}

const listCache = new Map<string, net.BlockList>();
function trustedList(cidrs: string[]): net.BlockList {
  const key = cidrs.join(",");
  let list = listCache.get(key);
  if (!list) {
    list = buildCidrList(cidrs);
    listCache.set(key, list);
  }
  return list;
}

export function resolveClientIp({ peerIp, headers, config }: IpResolutionInput): IpResolution {
  const peer = normalizeIp(peerIp);

  if (config.ipSource === "vercel") {
    // Vercel's edge overwrites these headers, so a client cannot inject them. Outside
    // Vercel the same headers are attacker-controlled, so refuse to read them.
    if (!config.runningOnVercel) return { ip: null, source: "unknown (IP_SOURCE=vercel but not running on Vercel)" };
    const real = normalizeIp(headers.get("x-real-ip"));
    if (real) return { ip: real, source: "vercel:x-real-ip" };
    const first = normalizeIp(headers.get("x-forwarded-for")?.split(",")[0]);
    if (first) return { ip: first, source: "vercel:x-forwarded-for" };
    return { ip: null, source: "unknown (no Vercel IP header)" };
  }

  if (!peer) return { ip: null, source: "unknown (peer address unavailable)" };

  if (config.ipSource === "socket") return { ip: peer, source: "socket" };

  // trusted-proxies
  const trusted = trustedList(config.trustedProxyCidrs);
  if (!inList(trusted, peer)) return { ip: peer, source: "socket (peer is not a trusted proxy)" };

  const headerName = config.trustedProxyHeader;
  const raw = headers.get(headerName);
  if (!raw) return { ip: peer, source: `socket (trusted proxy sent no ${headerName})` };

  if (headerName !== "x-forwarded-for") {
    // Single-value headers such as cf-connecting-ip or x-real-ip, set by the trusted proxy.
    const ip = normalizeIp(raw);
    return ip ? { ip, source: `trusted-proxy:${headerName}` } : { ip: null, source: `unknown (malformed ${headerName})` };
  }

  // X-Forwarded-For: each proxy appends the address it received the request from. Walk
  // right-to-left, skipping our own trusted proxies; the first untrusted hop is the client.
  // Anything further left was supplied by the client and cannot be trusted.
  const hops = raw.split(",").map((h) => h.trim());
  for (let i = hops.length - 1; i >= 0; i--) {
    const ip = normalizeIp(hops[i]);
    if (!ip) return { ip: null, source: "unknown (malformed x-forwarded-for)" };
    if (!inList(trusted, ip)) return { ip, source: "trusted-proxy:x-forwarded-for" };
    if (i === 0) return { ip, source: "trusted-proxy:x-forwarded-for (all hops trusted)" };
  }
  return { ip: peer, source: "socket" };
}

const PRIVATE = buildCidrList([
  "0.0.0.0/8", "10.0.0.0/8", "100.64.0.0/10", "127.0.0.0/8", "169.254.0.0/16", "172.16.0.0/12",
  "192.0.0.0/24", "192.0.2.0/24", "192.168.0.0/16", "198.18.0.0/15", "198.51.100.0/24", "203.0.113.0/24",
  "224.0.0.0/4", "240.0.0.0/4",
  "::/128", "::1/128", "fc00::/7", "fe80::/10", "2001:db8::/32", "ff00::/8",
]);

/** Private, loopback, link-local, documentation and multicast ranges have no public geolocation. */
export function isNonPublicIp(ip: string): boolean {
  return inList(PRIVATE, ip);
}

/** Zero the host part: IPv4 → /24, IPv6 → /48. Used when IP_STORAGE=truncated. */
export function truncateIp(ip: string): string {
  if (net.isIPv4(ip)) return ip.split(".").slice(0, 3).concat("0").join(".");
  const groups = expandIpv6(ip).slice(0, 3);
  return `${groups.map((g) => g.replace(/^0+(?=.)/, "")).join(":")}::`;
}

/** Display mask for list views: hides the host portion. */
export function maskIp(ip: string | null): string {
  if (!ip) return "unknown";
  if (net.isIPv4(ip)) return ip.split(".").slice(0, 2).join(".") + ".•••.•••";
  const groups = expandIpv6(ip).slice(0, 2).map((g) => g.replace(/^0+(?=.)/, ""));
  return `${groups.join(":")}:••••:••••::`;
}

function expandIpv6(ip: string): string[] {
  const [head, tail = ""] = ip.split("::");
  const h = head ? head.split(":") : [];
  const t = tail ? tail.split(":") : [];
  const missing = ip.includes("::") ? 8 - h.length - t.length : 0;
  return [...h, ...Array(missing).fill("0"), ...t].map((g) => g.padStart(4, "0"));
}

/** Reads the peer address that server.mjs attached, verifying its per-process token. */
export function readVerifiedPeerIp(headers: Headers, token = process.env.VA_PEER_TOKEN): string | null {
  if (!token) return null;
  if (headers.get("x-va-peer-token") !== token) return null;
  return normalizeIp(headers.get("x-va-peer-ip"));
}

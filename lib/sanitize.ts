/**
 * URL sanitization. Paths and referrers often carry secrets: password-reset tokens, emails,
 * OAuth codes, session ids. We keep only allow-listed query parameters and redact path
 * segments that look like emails or opaque tokens.
 */

const EMAIL = /^[^@/\s]+@[^@/\s]+\.[^@/\s]+$/;
const TOKENISH = /^[A-Za-z0-9_\-.~%=]{24,}$/;
const MAX_PATH = 512;

export function sanitizePath(raw: string, allowedParams: string[]): string | null {
  if (typeof raw !== "string" || !raw.startsWith("/") || raw.startsWith("//")) return null;
  let url: URL;
  try {
    url = new URL(raw, "http://placeholder.invalid");
  } catch {
    return null;
  }
  if (url.host !== "placeholder.invalid") return null;

  const segments = url.pathname.split("/").map((seg) => {
    let decoded = seg;
    try {
      decoded = decodeURIComponent(seg);
    } catch {
      /* keep raw */
    }
    if (EMAIL.test(decoded)) return ":email";
    if (TOKENISH.test(seg) && /\d/.test(seg) && /[A-Za-z]/.test(seg)) return ":token";
    return seg;
  });

  const kept = new URLSearchParams();
  const allowed = new Set(allowedParams.map((p) => p.toLowerCase()));
  for (const [k, v] of url.searchParams) {
    if (allowed.has(k.toLowerCase())) kept.append(k, v.slice(0, 100));
  }
  const qs = kept.toString();
  const out = segments.join("/") + (qs ? `?${qs}` : "");
  return out.slice(0, MAX_PATH);
}

/** Only the origin (scheme + host + port) of a referrer is kept; path and query are dropped. */
export function sanitizeReferrerOrigin(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin.slice(0, 255);
  } catch {
    return null;
  }
}

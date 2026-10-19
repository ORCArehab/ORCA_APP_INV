/** Shared by the browser tracker and the server. Must not import Node modules. */

export type ConsentMode = "opt-in" | "opt-out" | "disabled";
export type ConsentChoice = "granted" | "denied" | null;

export const CONSENT_COOKIE = "va_consent";
export const VISITOR_COOKIE = "va_vid";
export const CONSENT_MAX_AGE_DAYS = 180;

export type CollectionDecision = {
  /** May any analytics event be stored? */
  collect: boolean;
  /** May a persistent first-party visitor id be set/used? */
  visitorId: boolean;
  /** Recorded on the visit: 'granted' or 'not-required'. */
  basis: "granted" | "not-required" | null;
  reason: string;
};

export function decideCollection(input: {
  mode: ConsentMode;
  choice: ConsentChoice;
  gpc: boolean;
  honorGpc: boolean;
}): CollectionDecision {
  const { mode, choice, gpc, honorGpc } = input;
  if (mode === "disabled") return { collect: false, visitorId: false, basis: null, reason: "Analytics disabled by site configuration" };
  if (choice === "denied") return { collect: false, visitorId: false, basis: null, reason: "Visitor declined analytics" };
  if (choice === "granted") return { collect: true, visitorId: true, basis: "granted", reason: "Visitor accepted analytics" };
  if (mode === "opt-in") return { collect: false, visitorId: false, basis: null, reason: "Waiting for consent (opt-in mode)" };
  // opt-out mode, no explicit choice yet
  if (gpc && honorGpc) return { collect: false, visitorId: false, basis: null, reason: "Global Privacy Control signal treated as opt-out" };
  return { collect: true, visitorId: false, basis: "not-required", reason: "Anonymous analytics (opt-out mode); no returning-visitor id without acceptance" };
}

export function parseConsentCookie(value: string | null | undefined): ConsentChoice {
  return value === "granted" || value === "denied" ? value : null;
}

export function readCookie(cookieHeader: string | null | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) {
      try {
        return decodeURIComponent(part.slice(idx + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

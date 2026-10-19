import Bowser from "bowser";

export type ParsedAgent = {
  browserName: string | null;
  browserVersion: string | null;
  osName: string | null;
  osVersion: string | null;
  deviceCategory: "mobile" | "tablet" | "desktop" | "unknown";
};

/** Inferred from the User-Agent string (and the Sec-CH-UA-Mobile hint when present). */
export function parseUserAgent(ua: string | null, chMobile?: string | null): ParsedAgent {
  const empty: ParsedAgent = { browserName: null, browserVersion: null, osName: null, osVersion: null, deviceCategory: "unknown" };
  if (!ua) return empty;
  let r: Bowser.Parser.ParsedResult;
  try {
    r = Bowser.parse(ua);
  } catch {
    return empty;
  }
  const type = r.platform?.type;
  let deviceCategory: ParsedAgent["deviceCategory"] =
    type === "mobile" ? "mobile" : type === "tablet" ? "tablet" : type === "desktop" ? "desktop" : "unknown";
  if (deviceCategory === "unknown" && chMobile === "?1") deviceCategory = "mobile";
  return {
    browserName: r.browser?.name || null,
    browserVersion: r.browser?.version?.split(".")[0] || null,
    osName: r.os?.name || null,
    osVersion: r.os?.versionName || r.os?.version || null,
    deviceCategory,
  };
}

/**
 * Browser side of the analytics. It sends only what the payload schema allows:
 * page paths, developer-tagged clicks, and a handful of standard browser settings.
 * No fingerprinting probes (canvas/audio/fonts/WebGL), no input or keystroke capture,
 * no permission prompts, no third-party requests.
 */

const SESSION_KEY = "va_sid";
const SESSION_IDLE_MS = 30 * 60 * 1000;
const LANG = /^[A-Za-z0-9-]{1,35}$/;
const TZ = /^[A-Za-z0-9_+\-/]{1,64}$/;

let memorySession: string | null = null;
let lastPageKey: string | null = null;

function uuid(): string {
  return crypto.randomUUID();
}

/** With consent, the session survives reloads in this tab (sessionStorage); otherwise it lives in memory only. */
export function getSessionId(persist: boolean): string {
  if (persist) {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      const parsed = raw ? (JSON.parse(raw) as { id: string; t: number }) : null;
      const id = parsed && Date.now() - parsed.t < SESSION_IDLE_MS ? parsed.id : (memorySession ?? uuid());
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({ id, t: Date.now() }));
      memorySession = id;
      return id;
    } catch {
      /* storage blocked: fall through to memory */
    }
  }
  memorySession ??= uuid();
  return memorySession;
}

export function forgetSession() {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
  memorySession = null;
  lastPageKey = null;
}

export function currentSessionId(): string | null {
  return memorySession;
}

const clampDim = (w: number, h: number) =>
  Number.isFinite(w) && Number.isFinite(h) ? { w: Math.max(0, Math.min(20000, Math.round(w))), h: Math.max(0, Math.min(20000, Math.round(h))) } : null;

function environment() {
  let timeZone: string | null = null;
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    timeZone = tz && TZ.test(tz) ? tz : null;
  } catch {
    /* unknown */
  }
  return {
    languages: (navigator.languages ?? []).filter((l) => LANG.test(l)).slice(0, 10),
    timeZone,
    screen: typeof screen !== "undefined" ? clampDim(screen.width, screen.height) : null,
    viewport: clampDim(window.innerWidth, window.innerHeight),
    maxTouchPoints: typeof navigator.maxTouchPoints === "number" ? Math.min(256, navigator.maxTouchPoints) : null,
    webdriver: typeof navigator.webdriver === "boolean" ? navigator.webdriver : null,
  };
}

type OutEvent =
  | { type: "pageview"; eventId: string; path: string; ts: number }
  | { type: "click"; eventId: string; path: string; ts: number; name: string; label?: string };

/** Sends with the same eventIds on retry, so the server's idempotency check drops duplicates. */
async function send(events: OutEvent[], persist: boolean) {
  const body = JSON.stringify({ v: 1, sessionId: getSessionId(persist), referrer: document.referrer || null, env: environment(), events });
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch("/api/collect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        keepalive: true,
        credentials: "same-origin",
      });
      if (res.status < 500) return; // 2xx done; 4xx (validation, consent, rate limit) is not retried
    } catch {
      /* network error: retry */
    }
    await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
  }
}

const currentPath = () => window.location.pathname + window.location.search;

/**
 * Records a page view unless one was already sent for this exact URL. The module-level
 * guard absorbs React Strict Mode's double-invoked effects and re-renders.
 */
export function trackPageview(persist: boolean) {
  const key = currentPath();
  if (key === lastPageKey) return;
  lastPageKey = key;
  void send([{ type: "pageview", eventId: uuid(), path: key, ts: Date.now() }], persist);
}

const NAME = /^[a-z0-9][a-z0-9_.:-]{0,63}$/;
const LABEL = /^[\w .:/#-]{0,80}$/;

/**
 * Only elements explicitly tagged with data-analytics-event are recorded. We send the
 * developer-defined name and optional data-analytics-label — never element text or input values.
 */
export function installClickTracking(persist: () => boolean): () => void {
  const onClick = (ev: MouseEvent) => {
    const target = (ev.target as Element | null)?.closest?.("[data-analytics-event]");
    if (!target) return;
    const name = target.getAttribute("data-analytics-event") ?? "";
    const label = target.getAttribute("data-analytics-label") ?? undefined;
    if (!NAME.test(name) || (label !== undefined && !LABEL.test(label))) return;
    void send([{ type: "click", eventId: uuid(), path: currentPath(), ts: Date.now(), name, ...(label ? { label } : {}) }], persist());
  };
  document.addEventListener("click", onClick, { capture: true });
  return () => document.removeEventListener("click", onClick, { capture: true });
}

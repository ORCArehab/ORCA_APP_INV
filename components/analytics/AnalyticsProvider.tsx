"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { createContext, Suspense, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { decideCollection, type ConsentChoice, type ConsentMode } from "@/lib/consent";
import { currentSessionId, forgetSession, installClickTracking, trackPageview } from "./tracker";

type Ctx = {
  mode: ConsentMode;
  choice: ConsentChoice;
  collecting: boolean;
  setChoice: (c: "granted" | "denied") => Promise<void>;
  openSettings: () => void;
  sessionId: () => string | null;
};

const ConsentContext = createContext<Ctx | null>(null);

export function useConsent(): Ctx {
  const ctx = useContext(ConsentContext);
  if (!ctx) throw new Error("useConsent must be used inside AnalyticsProvider");
  return ctx;
}

export function AnalyticsProvider({ mode, initialChoice, honorGpc, children }: { mode: ConsentMode; initialChoice: ConsentChoice; honorGpc: boolean; children: React.ReactNode }) {
  const [choice, setChoiceState] = useState<ConsentChoice>(initialChoice);
  const [gpc, setGpc] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    setGpc((navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true);
  }, []);

  const decision = decideCollection({ mode, choice, gpc, honorGpc });

  const setChoice = useCallback(async (c: "granted" | "denied") => {
    await fetch("/api/consent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ choice: c }) });
    if (c === "denied") forgetSession();
    setChoiceState(c);
    setSettingsOpen(false);
  }, []);

  const ctx = useMemo<Ctx>(
    () => ({ mode, choice, collecting: decision.collect, setChoice, openSettings: () => setSettingsOpen(true), sessionId: currentSessionId }),
    [mode, choice, decision.collect, setChoice],
  );

  // opt-in asks up front; opt-out shows no banner (choices are on the privacy page).
  const showBanner = (mode === "opt-in" && choice === null) || (mode !== "disabled" && settingsOpen);

  return (
    <ConsentContext.Provider value={ctx}>
      {children}
      {decision.collect && (
        <Suspense fallback={null}>
          <PageviewTracker persist={decision.visitorId} />
        </Suspense>
      )}
      {showBanner && <ConsentBanner mode={mode} choice={choice} gpc={gpc && honorGpc} onChoose={setChoice} onClose={choice !== null ? () => setSettingsOpen(false) : undefined} />}
    </ConsentContext.Provider>
  );
}

function PageviewTracker({ persist }: { persist: boolean }) {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const persistRef = useRef(persist);
  persistRef.current = persist;

  useEffect(() => {
    trackPageview(persist);
  }, [pathname, search, persist]);

  useEffect(() => installClickTracking(() => persistRef.current), []);
  return null;
}

function ConsentBanner({ mode, choice, gpc, onChoose, onClose }: { mode: ConsentMode; choice: ConsentChoice; gpc: boolean; onChoose: (c: "granted" | "denied") => void; onClose?: () => void }) {
  return (
    <div className="consent" role="dialog" aria-labelledby="consent-title" aria-live="polite">
      <div className="consent-body">
        <h2 id="consent-title">Privacy choices</h2>
        {mode === "opt-in" ? (
          <p>
            We would like to use first-party analytics to understand which pages are useful. Nothing is collected unless you accept. If you
            accept, we record the pages you view, clicks on a few labelled buttons, your IP address and approximate location derived from it,
            and basic browser settings, and we set a random cookie to recognize return visits. Data is deleted automatically.
          </p>
        ) : (
          <p>
            We use first-party analytics without cookies to understand which pages are useful. Accept to also let us recognize return visits
            with a random cookie, or decline to turn analytics off entirely.
            {gpc && " Your browser sent a Global Privacy Control signal, so analytics stay off unless you accept."}
          </p>
        )}
        <p className="consent-meta">
          {choice ? `Current choice: ${choice === "granted" ? "accepted" : "declined"}. ` : ""}
          <Link href="/privacy">Read the privacy notice</Link>
        </p>
      </div>
      <div className="consent-actions">
        <button type="button" className="btn" onClick={() => onChoose("denied")}>Decline</button>
        <button type="button" className="btn btn-primary" onClick={() => onChoose("granted")}>Accept analytics</button>
        {onClose && <button type="button" className="btn btn-ghost" onClick={onClose} aria-label="Close privacy choices">Close</button>}
      </div>
    </div>
  );
}

export function PrivacyChoicesButton() {
  const { openSettings, mode } = useConsent();
  if (mode === "disabled") return null;
  return <button type="button" className="link-button" onClick={openSettings}>Privacy choices</button>;
}

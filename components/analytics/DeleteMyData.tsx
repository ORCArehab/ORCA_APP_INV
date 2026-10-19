"use client";

import { useState } from "react";
import { useConsent } from "./AnalyticsProvider";

export function DeleteMyData() {
  const { sessionId, setChoice } = useConsent();
  const [state, setState] = useState<"idle" | "working" | "done" | "error">("idle");
  const [deleted, setDeleted] = useState(0);

  async function run() {
    setState("working");
    try {
      const res = await fetch("/api/privacy/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: sessionId() }),
      });
      if (!res.ok) throw new Error();
      setDeleted((await res.json()).deleted);
      await setChoice("denied");
      setState("done");
    } catch {
      setState("error");
    }
  }

  return (
    <div className="card">
      <h3>Delete my analytics data</h3>
      <p className="muted small">
        Deletes visits linked to this browser&apos;s returning-visitor cookie and the current session, then turns analytics off. Data from
        other browsers or devices cannot be linked to you and is removed automatically when it expires.
      </p>
      <button type="button" className="btn btn-danger" onClick={run} disabled={state === "working"}>
        {state === "working" ? "Deleting…" : "Delete and opt out"}
      </button>
      {state === "done" && <p className="small" role="status" style={{ marginTop: 10 }}>Done. {deleted} visit record(s) deleted; analytics are now off.</p>}
      {state === "error" && <p className="small" role="alert" style={{ marginTop: 10, color: "var(--danger)" }}>Something went wrong. Please try again.</p>}
    </div>
  );
}

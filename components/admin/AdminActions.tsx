"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

async function call(url: string, init: RequestInit) {
  const res = await fetch(url, { ...init, headers: { "content-type": "application/json" } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body;
}

export function DeleteVisitButton({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-danger btn-sm"
      disabled={busy}
      onClick={async () => {
        if (!confirm("Delete this visit and all of its events? This cannot be undone.")) return;
        setBusy(true);
        try {
          await call(`/api/admin/visits/${id}`, { method: "DELETE" });
          router.push("/admin");
          router.refresh();
        } catch (e) {
          alert((e as Error).message);
          setBusy(false);
        }
      }}
    >
      Delete visit
    </button>
  );
}

export function DeleteVisitorButton({ visitorId, count }: { visitorId: string; count: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-danger btn-sm"
      disabled={busy}
      onClick={async () => {
        if (!confirm(`Delete all ${count} visit(s) linked to this returning-visitor id?`)) return;
        setBusy(true);
        try {
          await call(`/api/admin/visitors/${visitorId}`, { method: "DELETE" });
          router.push("/admin");
          router.refresh();
        } catch (e) {
          alert((e as Error).message);
          setBusy(false);
        }
      }}
    >
      Delete all {count} visits from this visitor id
    </button>
  );
}

export function RetentionForm({ current }: { current: number }) {
  const router = useRouter();
  const [days, setDays] = useState(String(current));
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setMsg(null);
        try {
          const r = await call("/api/admin/settings", { method: "POST", body: JSON.stringify({ retentionDays: Number(days) }) });
          setMsg(`Saved. Retention is ${r.retentionDays} days; ${r.purged.visits} expired visit(s) purged.`);
          router.refresh();
        } catch (err) {
          setMsg((err as Error).message);
        }
      }}
      style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}
    >
      <div style={{ width: 160 }}>
        <label htmlFor="days">Retention (days)</label>
        <input id="days" type="number" min={1} max={3650} step={1} value={days} onChange={(e) => setDays(e.target.value)} required />
      </div>
      <button className="btn btn-primary">Save</button>
      {msg && <p className="small" role="status" style={{ width: "100%", margin: 0 }}>{msg}</p>}
    </form>
  );
}

export function PurgeButtons() {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
      <button
        type="button"
        className="btn"
        onClick={async () => {
          const r = await call("/api/admin/purge", { method: "POST", body: JSON.stringify({ scope: "expired" }) });
          setMsg(`Purged ${r.purged.visits} expired visit(s) and ${r.purged.events} event(s).`);
          router.refresh();
        }}
      >
        Purge expired now
      </button>
      <button
        type="button"
        className="btn btn-danger"
        onClick={async () => {
          const confirmText = prompt("This deletes ALL analytics records. Type DELETE ALL to confirm.");
          if (confirmText === null) return;
          try {
            const r = await call("/api/admin/purge", { method: "POST", body: JSON.stringify({ scope: "all", confirm: confirmText }) });
            setMsg(`Deleted ${r.deletedVisits} visit(s).`);
            router.refresh();
          } catch (e) {
            setMsg((e as Error).message);
          }
        }}
      >
        Delete all analytics data
      </button>
      {msg && <p className="small" role="status" style={{ margin: 0 }}>{msg}</p>}
    </div>
  );
}

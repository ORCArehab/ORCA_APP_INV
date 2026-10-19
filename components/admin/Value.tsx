/** Renders a value or a consistent "unknown" marker. */
export function Value({ v, suffix }: { v: unknown; suffix?: string }) {
  if (v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0)) return <span className="unknown">unknown</span>;
  if (typeof v === "boolean") return <>{v ? "yes" : "no"}</>;
  if (v instanceof Date) return <>{v.toISOString()}</>;
  if (Array.isArray(v)) return <>{v.join(", ")}</>;
  return <>{String(v)}{suffix}</>;
}

export function ProvenanceBadge({ p }: { p: "observed" | "reported" | "inferred" }) {
  const label = p === "observed" ? "Observed" : p === "reported" ? "Browser-reported" : "Inferred";
  return <span className={`badge badge-${p}`}>{label}</span>;
}

export function LocalTime({ d }: { d: Date | string | null }) {
  if (!d) return <span className="unknown">unknown</span>;
  const date = new Date(d);
  return (
    <time dateTime={date.toISOString()} title={date.toISOString()}>
      {date.toISOString().replace("T", " ").slice(0, 19)} UTC
    </time>
  );
}

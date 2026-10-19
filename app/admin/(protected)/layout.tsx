import Link from "next/link";
import { requireAdminPage } from "@/lib/admin-page";
import { getConfig } from "@/lib/config";

export const metadata = { title: "Analytics", robots: { index: false } };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdminPage();
  const config = getConfig();
  return (
    <>
      <header className="site-header">
        <div className="container">
          <Link href="/admin" className="brand">Visitor analytics</Link>
          <nav className="site-nav" aria-label="Admin">
            <Link href="/admin">Overview</Link>
            <Link href="/admin/fields">Field guide</Link>
            <Link href="/admin/settings">Settings</Link>
            <form method="post" action="/api/admin/logout" style={{ display: "inline" }}>
              <button className="link-button" style={{ color: "var(--text-2)", textDecoration: "none" }}>Sign out</button>
            </form>
          </nav>
        </div>
      </header>
      <main className="container" style={{ padding: "24px 16px 80px" }}>
        {config.ipLookupProvider === "mock" && (
          <div className="notice notice-warn" style={{ marginBottom: 16 }}>
            <span className="badge badge-mock">MOCK DATA</span> IP enrichment is using generated sample data because no lookup API key is
            configured. Locations, ISPs and VPN/hosting indicators shown here are <strong>not real</strong>. Set{" "}
            <code>IP_LOOKUP_PROVIDER</code> and <code>IP_LOOKUP_API_KEY</code> to use a real provider.
          </div>
        )}
        {children}
      </main>
    </>
  );
}

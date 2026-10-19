import Link from "next/link";
import { cookies } from "next/headers";
import { AnalyticsProvider, PrivacyChoicesButton } from "@/components/analytics/AnalyticsProvider";
import { getConfig } from "@/lib/config";
import { CONSENT_COOKIE, parseConsentCookie } from "@/lib/consent";

export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const config = getConfig();
  const choice = parseConsentCookie((await cookies()).get(CONSENT_COOKIE)?.value);
  return (
    <AnalyticsProvider mode={config.consentMode} initialChoice={choice} honorGpc={config.honorGpc}>
      <header className="site-header">
        <div className="container">
          <Link href="/" className="brand">Northwind Trail Co.</Link>
          <nav className="site-nav" aria-label="Main">
            <Link href="/pricing">Pricing</Link>
            <Link href="/docs">Guides</Link>
            <Link href="/privacy">Privacy</Link>
          </nav>
        </div>
      </header>
      <main className="site-main">
        <div className="container">{children}</div>
      </main>
      <footer className="site-footer">
        <div className="container">
          <span>© Northwind Trail Co. (demo)</span>
          <Link href="/privacy">Privacy notice</Link>
          <PrivacyChoicesButton />
        </div>
      </footer>
    </AnalyticsProvider>
  );
}

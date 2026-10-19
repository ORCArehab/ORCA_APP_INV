import { cookies } from "next/headers";
import { AnalyticsProvider } from "@/components/analytics/AnalyticsProvider";
import { getConfig } from "@/lib/config";
import { CONSENT_COOKIE, parseConsentCookie } from "@/lib/consent";

export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const config = getConfig();
  const choice = parseConsentCookie((await cookies()).get(CONSENT_COOKIE)?.value);
  return (
    <AnalyticsProvider mode={config.consentMode} initialChoice={choice} honorGpc={config.honorGpc}>
      <main className="plain-main">{children}</main>
    </AnalyticsProvider>
  );
}

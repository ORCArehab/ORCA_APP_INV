import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Northwind Trail Co.", template: "%s · Northwind Trail Co." },
  description: "Demo site instrumented with consent-based, first-party visitor analytics.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

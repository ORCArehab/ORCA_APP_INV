import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  turbopack: { root: import.meta.dirname },
  serverExternalPackages: ["pg"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Analytics never needs these capabilities.
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
        ],
      },
      { source: "/admin/:path*", headers: [{ key: "X-Frame-Options", value: "DENY" }, { key: "Cache-Control", value: "no-store" }] },
    ];
  },
};

export default nextConfig;

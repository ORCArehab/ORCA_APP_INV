import { z } from "zod";

const bool = (def: boolean) =>
  z
    .enum(["true", "false", "1", "0"])
    .optional()
    .transform((v) => (v === undefined ? def : v === "true" || v === "1"));

const list = z
  .string()
  .optional()
  .transform((v) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : []));

const EnvSchema = z.object({
  DATABASE_URL: z.string().optional(),

  // Consent: "opt-in" collects nothing until the visitor accepts (default).
  // "opt-out" collects anonymous analytics with a notice; returning-visitor ids still need acceptance.
  // "disabled" turns collection off entirely.
  ANALYTICS_CONSENT_MODE: z.enum(["opt-in", "opt-out", "disabled"]).default("opt-in"),
  HONOR_GPC: bool(true),
  VISITOR_ID_MAX_AGE_DAYS: z.coerce.number().int().min(1).max(395).default(180),

  // Client IP resolution. See lib/ip.ts.
  IP_SOURCE: z.enum(["socket", "trusted-proxies", "vercel"]).optional(),
  TRUSTED_PROXY_CIDRS: list,
  TRUSTED_PROXY_HEADER: z.string().default("x-forwarded-for"),
  IP_STORAGE: z.enum(["full", "truncated"]).default("full"),

  // IP enrichment
  IP_LOOKUP_PROVIDER: z.enum(["mock", "ipinfo", "ip-api", "none"]).default("mock"),
  IP_LOOKUP_API_KEY: z.string().optional(),
  IP_LOOKUP_TIMEOUT_MS: z.coerce.number().int().min(100).max(10000).default(2000),
  IP_LOOKUP_CACHE_HOURS: z.coerce.number().int().min(0).max(720).default(24),

  RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(30),

  RATE_LIMIT_EVENTS_PER_MINUTE: z.coerce.number().int().min(1).default(120),
  RATE_LIMIT_SALT: z.string().optional(),

  ADMIN_PASSWORD_HASH: z.string().optional(),
  SESSION_SECRET: z.string().optional(),
  CRON_SECRET: z.string().optional(),

  ALLOWED_QUERY_PARAMS: z.string().default("utm_source,utm_medium,utm_campaign,utm_term,utm_content,ref"),
  RECORD_AUTOMATED_HITS: bool(true),
});

export type AppConfig = {
  databaseUrl?: string;
  consentMode: "opt-in" | "opt-out" | "disabled";
  honorGpc: boolean;
  visitorIdMaxAgeDays: number;
  ipSource: "socket" | "trusted-proxies" | "vercel";
  trustedProxyCidrs: string[];
  trustedProxyHeader: string;
  ipStorage: "full" | "truncated";
  ipLookupProvider: "mock" | "ipinfo" | "ip-api" | "none";
  ipLookupApiKey?: string;
  ipLookupTimeoutMs: number;
  ipLookupCacheHours: number;
  retentionDays: number;
  rateLimitPerMinute: number;
  rateLimitSalt: string;
  adminPasswordHash?: string;
  sessionSecret?: string;
  cronSecret?: string;
  allowedQueryParams: string[];
  recordAutomatedHits: boolean;
  runningOnVercel: boolean;
};

export function parseConfig(env: Record<string, string | undefined>): AppConfig {
  const e = EnvSchema.parse(env);
  let provider = e.IP_LOOKUP_PROVIDER;
  // A real provider without its key falls back to clearly-labelled mock data.
  if ((provider === "ipinfo" || provider === "ip-api") && !e.IP_LOOKUP_API_KEY) provider = "mock";
  return {
    databaseUrl: e.DATABASE_URL,
    consentMode: e.ANALYTICS_CONSENT_MODE,
    honorGpc: e.HONOR_GPC,
    visitorIdMaxAgeDays: e.VISITOR_ID_MAX_AGE_DAYS,
    // Default: Vercel's platform headers when deployed there, otherwise the TCP peer.
    ipSource: e.IP_SOURCE ?? (env.VERCEL === "1" ? "vercel" : "socket"),
    trustedProxyCidrs: e.TRUSTED_PROXY_CIDRS,
    trustedProxyHeader: e.TRUSTED_PROXY_HEADER.toLowerCase(),
    ipStorage: e.IP_STORAGE,
    ipLookupProvider: provider,
    ipLookupApiKey: e.IP_LOOKUP_API_KEY,
    ipLookupTimeoutMs: e.IP_LOOKUP_TIMEOUT_MS,
    ipLookupCacheHours: e.IP_LOOKUP_CACHE_HOURS,
    retentionDays: e.RETENTION_DAYS,
    rateLimitPerMinute: e.RATE_LIMIT_EVENTS_PER_MINUTE,
    rateLimitSalt: e.RATE_LIMIT_SALT ?? e.SESSION_SECRET ?? "dev-only-salt",
    adminPasswordHash: e.ADMIN_PASSWORD_HASH,
    sessionSecret: e.SESSION_SECRET,
    cronSecret: e.CRON_SECRET,
    allowedQueryParams: e.ALLOWED_QUERY_PARAMS.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
    recordAutomatedHits: e.RECORD_AUTOMATED_HITS,
    runningOnVercel: env.VERCEL === "1",
  };
}

let cached: AppConfig | undefined;
export function getConfig(): AppConfig {
  cached ??= parseConfig(process.env);
  return cached;
}

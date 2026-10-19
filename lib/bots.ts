/**
 * Heuristic classification of automated clients from the User-Agent (and, for JS beacons,
 * navigator.webdriver). User-Agents can be faked in both directions, so this is an
 * estimate: it catches well-behaved crawlers and link previewers, not evasive bots.
 */

export type AgentClass = {
  isBot: boolean;
  category: "link-preview" | "crawler" | "automation" | "no-user-agent" | null;
  agent: string | null;
  reason: string | null;
};

const LINK_PREVIEW: [RegExp, string][] = [
  [/Slackbot-LinkExpanding|Slack-ImgProxy/i, "Slack"],
  [/facebookexternalhit|Facebot|meta-externalagent/i, "Facebook"],
  [/Twitterbot/i, "Twitter/X"],
  [/Discordbot/i, "Discord"],
  [/WhatsApp/i, "WhatsApp"],
  [/TelegramBot/i, "Telegram"],
  [/LinkedInBot/i, "LinkedIn"],
  [/SkypeUriPreview/i, "Skype"],
  [/redditbot/i, "Reddit"],
  [/Embedly|Iframely|Pinterestbot|vkShare|Mastodon\//i, "Embed service"],
  [/Google-PageRenderer|Google Web Preview/i, "Google preview"],
  [/Applebot.*(?:Preview)|iMessage|com\.apple\.messages/i, "iMessage"],
  [/MicrosoftPreview/i, "Microsoft preview"],
];

const CRAWLER: [RegExp, string][] = [
  [/Googlebot|Google-InspectionTool|AdsBot-Google|Storebot-Google|GoogleOther/i, "Google"],
  [/bingbot|BingPreview|msnbot/i, "Bing"],
  [/DuckDuckBot/i, "DuckDuckGo"],
  [/YandexBot|YandexMobileBot/i, "Yandex"],
  [/Baiduspider/i, "Baidu"],
  [/Applebot/i, "Apple"],
  [/GPTBot|ChatGPT-User|OAI-SearchBot|ClaudeBot|Claude-User|anthropic-ai|PerplexityBot|CCBot|Bytespider|Amazonbot/i, "AI crawler"],
  [/AhrefsBot|SemrushBot|MJ12bot|DotBot|PetalBot|SeznamBot|Uptime|Pingdom|StatusCake|UptimeRobot/i, "SEO/monitoring"],
  [/\b(bot|crawler|spider|crawl|slurp|scraper|fetcher)\b/i, "Generic bot"],
];

const AUTOMATION: [RegExp, string][] = [
  [/HeadlessChrome|PhantomJS|Puppeteer|Playwright|Selenium|Electron\/.*Headless/i, "Headless browser"],
  [/^(curl|Wget|HTTPie|python-requests|python-urllib|aiohttp|Go-http-client|node-fetch|undici|axios|okhttp|Java\/|libwww-perl|Ruby|PostmanRuntime|Insomnia)/i, "HTTP library"],
];

export function classifyAgent(userAgent: string | null | undefined, opts: { webdriver?: boolean | null } = {}): AgentClass {
  const ua = (userAgent ?? "").trim();
  if (!ua) return { isBot: true, category: "no-user-agent", agent: null, reason: "Request had no User-Agent header" };
  for (const [re, name] of LINK_PREVIEW) {
    if (re.test(ua)) return { isBot: true, category: "link-preview", agent: name, reason: `User-Agent matches ${name} link previewer` };
  }
  for (const [re, name] of AUTOMATION) {
    if (re.test(ua)) return { isBot: true, category: "automation", agent: name, reason: `User-Agent matches ${name}` };
  }
  for (const [re, name] of CRAWLER) {
    if (re.test(ua)) return { isBot: true, category: "crawler", agent: name, reason: `User-Agent matches ${name} crawler` };
  }
  if (opts.webdriver === true) {
    return { isBot: true, category: "automation", agent: "WebDriver", reason: "Browser reported navigator.webdriver = true" };
  }
  return { isBot: false, category: null, agent: null, reason: null };
}

import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";
import { classifyAgent } from "@/lib/bots";
import { getConfig } from "@/lib/config";
import { getDb } from "@/lib/db";
import { recordAutomatedHit } from "@/lib/queries";
import { sanitizePath } from "@/lib/sanitize";

/**
 * Counts page fetches by self-identified crawlers and link previewers. They rarely execute
 * JavaScript, so the tracker never sees them. Only aggregate counters are stored (day,
 * category, agent family, path): no IP, no User-Agent string, no identifiers.
 */
export function proxy(request: NextRequest, event: NextFetchEvent) {
  if (request.method === "GET" && getConfig().recordAutomatedHits) {
    const agent = classifyAgent(request.headers.get("user-agent"));
    if (agent.isBot && agent.category) {
      const path = sanitizePath(request.nextUrl.pathname, []) ?? "/";
      event.waitUntil(
        recordAutomatedHit(getDb(), { category: agent.category, agent: agent.agent ?? "unknown", path }).catch((err) =>
          console.error("automated hit not recorded", err),
        ),
      );
    }
  }
  return NextResponse.next();
}

export const config = {
  // Page routes only: skip API, admin, Next internals and files with extensions.
  matcher: ["/((?!api/|admin|_next/|.*\\..*).*)"],
};

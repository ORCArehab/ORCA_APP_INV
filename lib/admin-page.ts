import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, authConfigProblem, verifySessionToken } from "./auth";
import { getConfig } from "./config";

/** Server-side guard for admin pages. Call at the top of every protected page. */
export async function requireAdminPage(): Promise<void> {
  const config = getConfig();
  if (authConfigProblem(config)) redirect("/admin/login?error=config");
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!verifySessionToken(token, config.sessionSecret)) redirect("/admin/login");
}

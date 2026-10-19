import { handleAdminPurge } from "@/lib/handlers";
import { deps } from "@/lib/runtime";

export async function POST(req: Request) {
  return handleAdminPurge(req, deps(req));
}

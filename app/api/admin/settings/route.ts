import { handleAdminSettings } from "@/lib/handlers";
import { deps } from "@/lib/runtime";

export async function POST(req: Request) {
  return handleAdminSettings(req, deps(req));
}

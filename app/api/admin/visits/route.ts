import { handleAdminListVisits } from "@/lib/handlers";
import { deps } from "@/lib/runtime";

export async function GET(req: Request) {
  return handleAdminListVisits(req, deps(req));
}

import { handlePrivacyDelete } from "@/lib/handlers";
import { deps } from "@/lib/runtime";

export async function POST(req: Request) {
  return handlePrivacyDelete(req, deps(req));
}

import { handleCronRetention } from "@/lib/handlers";
import { deps } from "@/lib/runtime";

export async function GET(req: Request) {
  return handleCronRetention(req, deps(req));
}

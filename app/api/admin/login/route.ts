import { handleLogin } from "@/lib/handlers";
import { deps } from "@/lib/runtime";

export async function POST(req: Request) {
  return handleLogin(req, deps(req));
}

import { handleLogout } from "@/lib/handlers";

export async function POST(req: Request) {
  return handleLogout(req);
}

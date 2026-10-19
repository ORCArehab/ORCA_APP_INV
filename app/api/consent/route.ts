import { handleConsent } from "@/lib/handlers";

export async function POST(req: Request) {
  return handleConsent(req);
}

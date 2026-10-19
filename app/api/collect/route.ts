import { handleCollect } from "@/lib/collect";
import { deps, schedule } from "@/lib/runtime";

export async function POST(req: Request) {
  return handleCollect(req, { ...deps(req), schedule });
}

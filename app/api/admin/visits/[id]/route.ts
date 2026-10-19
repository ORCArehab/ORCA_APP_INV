import { handleAdminDeleteVisit, handleAdminGetVisit } from "@/lib/handlers";
import { deps } from "@/lib/runtime";

export async function GET(req: Request, ctx: RouteContext<"/api/admin/visits/[id]">) {
  return handleAdminGetVisit(req, deps(req), (await ctx.params).id);
}

export async function DELETE(req: Request, ctx: RouteContext<"/api/admin/visits/[id]">) {
  return handleAdminDeleteVisit(req, deps(req), (await ctx.params).id);
}

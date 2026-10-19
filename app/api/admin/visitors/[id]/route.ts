import { handleAdminDeleteVisitor } from "@/lib/handlers";
import { deps } from "@/lib/runtime";

export async function DELETE(req: Request, ctx: RouteContext<"/api/admin/visitors/[id]">) {
  return handleAdminDeleteVisitor(req, deps(req), (await ctx.params).id);
}

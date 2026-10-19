import "server-only";
import { after } from "next/server";
import { getConfig } from "./config";
import { getDb } from "./db";
import type { Deps } from "./handlers";
import { readVerifiedPeerIp } from "./ip";

/** Production dependencies for route handlers. */
export function deps(req: Request): Deps {
  return { db: getDb(), config: getConfig(), peerIp: readVerifiedPeerIp(req.headers) };
}

export function schedule(task: () => Promise<unknown>) {
  after(() => task().catch((err) => console.error("background task failed", err)));
}

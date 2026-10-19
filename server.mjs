// Thin wrapper around Next.js that exposes the real TCP peer address to route handlers.
//
// Next.js route handlers cannot see the socket address, and the X-Forwarded-For header Next
// derives is client-controllable. This server strips any incoming x-va-* headers and sets
// x-va-peer-ip from the socket, plus a per-process random token so route handlers can verify
// the header came from here (lib/ip.ts readVerifiedPeerIp). Without this wrapper (for
// example `next start`), the peer address is treated as unknown.
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import next from "next";

const dev = process.argv.includes("--dev");
const port = Number(process.env.PORT ?? 3000);
const hostname = process.env.HOSTNAME ?? "0.0.0.0";

process.env.VA_PEER_TOKEN = randomBytes(32).toString("hex");
const token = process.env.VA_PEER_TOKEN;

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();
await app.prepare();

createServer((req, res) => {
  delete req.headers["x-va-peer-ip"];
  delete req.headers["x-va-peer-token"];
  const peer = req.socket.remoteAddress;
  if (peer) {
    req.headers["x-va-peer-ip"] = peer;
    req.headers["x-va-peer-token"] = token;
  }
  handle(req, res);
}).listen(port, hostname, () => {
  console.log(`> Ready on http://${hostname === "0.0.0.0" ? "localhost" : hostname}:${port} (${dev ? "dev" : "production"})`);
});

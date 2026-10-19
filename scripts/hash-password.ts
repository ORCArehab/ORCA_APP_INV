import { randomBytes } from "node:crypto";
import { hashPassword } from "../lib/auth";

/** Reads a line from the terminal without echoing it. */
function askHidden(question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) {
      let data = "";
      stdin.setEncoding("utf8");
      stdin.on("data", (c) => (data += c));
      stdin.on("end", () => resolve(data.split(/\r?\n/)[0]));
      return;
    }
    process.stdout.write(question);
    let value = "";
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off("data", onData);
          process.stdout.write("\n");
          resolve(value);
          return;
        }
        if (ch === "\u0003") {
          stdin.setRawMode(false);
          process.stdout.write("\n");
          reject(new Error("cancelled"));
          return;
        }
        if (ch === "\u007f" || ch === "\b") value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.on("data", onData);
  });
}

// Passing the password as an argument still works, but it lands in shell history.
let password = process.argv[2];
if (!password) {
  password = await askHidden("Admin password (min 12 characters, input hidden): ");
  if (process.stdin.isTTY && (await askHidden("Repeat password: ")) !== password) {
    console.error("Passwords do not match.");
    process.exit(1);
  }
}
if (password.length < 12) {
  console.error("Password must be at least 12 characters.");
  process.exit(1);
}
const hash = await hashPassword(password);
console.log("\nAdd these to your environment (.env.local or your host's settings):\n");
console.log(`ADMIN_PASSWORD_HASH=${hash}`);
console.log(`SESSION_SECRET=${randomBytes(32).toString("base64url")}`);
console.log(`CRON_SECRET=${randomBytes(24).toString("base64url")}`);
process.exit(0);

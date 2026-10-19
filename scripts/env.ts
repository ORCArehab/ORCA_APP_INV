// Loads .env.local / .env for CLI scripts (Next.js loads them itself for the app).
for (const file of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(file);
  } catch {
    /* file absent: rely on the real environment */
  }
}

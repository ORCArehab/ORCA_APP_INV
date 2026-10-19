import { authConfigProblem } from "@/lib/auth";
import { getConfig } from "@/lib/config";

export const metadata = { title: "Admin sign in", robots: { index: false } };

const MESSAGES: Record<string, string> = {
  invalid: "Incorrect password.",
  rate: "Too many attempts. Try again in 15 minutes.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const problem = authConfigProblem(getConfig());
  return (
    <main className="container" style={{ maxWidth: 400, paddingTop: 96 }}>
      <div className="card">
        <h1 style={{ fontSize: "1.3rem" }}>Analytics dashboard</h1>
        {problem ? (
          <div className="notice notice-warn">
            <strong>Dashboard not configured.</strong> {problem}
          </div>
        ) : (
          <form method="post" action="/api/admin/login">
            <label htmlFor="password">Admin password</label>
            <input id="password" name="password" type="password" autoComplete="current-password" required autoFocus />
            {error && MESSAGES[error] && <p role="alert" className="small" style={{ color: "var(--danger)", margin: "8px 0 0" }}>{MESSAGES[error]}</p>}
            <button className="btn btn-primary" style={{ marginTop: 14, width: "100%", justifyContent: "center" }}>Sign in</button>
          </form>
        )}
      </div>
    </main>
  );
}

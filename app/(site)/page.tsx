import Link from "next/link";

export default function Home() {
  return (
    <>
      <section className="hero">
        <h1>Trail maps that work offline.</h1>
        <p>
          This is a demo website for the visitor analytics system. Browse a few pages, then open the admin dashboard at{" "}
          <code>/admin</code> to see what was recorded and how each field should be interpreted.
        </p>
        <div className="cta-row">
          <Link href="/pricing" className="btn btn-primary" data-analytics-event="cta_click" data-analytics-label="hero-pricing">
            See pricing
          </Link>
          <Link href="/docs" className="btn" data-analytics-event="cta_click" data-analytics-label="hero-guides">
            Read the guides
          </Link>
        </div>
      </section>
      <div className="feature-grid">
        <div className="card"><h3>Offline first</h3><p className="muted">Download regions ahead of time and navigate without signal.</p></div>
        <div className="card"><h3>Elevation profiles</h3><p className="muted">See the climb before you commit to the switchbacks.</p></div>
        <div className="card"><h3>Shared trips</h3><p className="muted">Send a route to friends with one link.</p></div>
      </div>
    </>
  );
}

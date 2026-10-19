import Link from "next/link";

export const metadata = { title: "Guides" };

export default function Docs() {
  return (
    <div className="narrow prose">
      <h1>Guides</h1>
      <p>Getting started with offline trail maps.</p>
      <h2>1. Download a region</h2>
      <p>Open the map, long-press an area, and choose <em>Download</em>.</p>
      <h2>2. Plan a route</h2>
      <p>Tap waypoints to build a route; the elevation profile updates as you go.</p>
      <p>
        <Link href="/docs?utm_source=demo&amp;session_token=should-be-stripped" data-analytics-event="guide_link">
          Reload this page with tracking parameters
        </Link>{" "}
        (only <code>utm_source</code> will be stored; <code>session_token</code> is stripped).
      </p>
    </div>
  );
}

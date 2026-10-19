/** Single-series daily bar chart. Hover/focus a bar for its exact values; the same data is in the table below it. */
export function DailyChart({ data }: { data: { day: string; pageviews: number; visits: number }[] }) {
  if (data.length === 0) return <p className="unknown">No page views in this range.</p>;
  const max = Math.max(1, ...data.map((d) => d.pageviews));
  const ticks = [max, Math.round(max / 2), 0];
  return (
    <figure className="chart" aria-label="Page views per day">
      <div className="chart-plot">
        <div className="chart-axis" aria-hidden>
          {ticks.map((t, i) => <span key={i}>{t}</span>)}
        </div>
        <div className="chart-bars">
          {ticks.map((_, i) => <div key={i} className="chart-grid" style={{ top: `${(i / (ticks.length - 1)) * 100}%` }} aria-hidden />)}
          {data.map((d) => (
            <div key={d.day} className="chart-col" tabIndex={0} aria-label={`${d.day}: ${d.pageviews} page views, ${d.visits} visits`}>
              <div className="chart-bar" style={{ height: `${(d.pageviews / max) * 100}%` }} />
              <div className="chart-tip" role="tooltip">
                <strong>{d.day}</strong>
                <span>{d.pageviews} page views</span>
                <span>{d.visits} visits</span>
              </div>
            </div>
          ))}
        </div>
      </div>
      <figcaption className="chart-x" aria-hidden>
        <span>{data[0].day}</span>
        {data.length > 1 && <span>{data[data.length - 1].day}</span>}
      </figcaption>
    </figure>
  );
}

export const metadata = { title: "Pricing" };

const plans = [
  { name: "Day hiker", price: "$0", note: "Three offline regions" },
  { name: "Backpacker", price: "$4/mo", note: "Unlimited regions, elevation profiles" },
  { name: "Guide", price: "$12/mo", note: "Group trips and route sharing" },
];

export default function Pricing() {
  return (
    <>
      <h1>Pricing</h1>
      <p className="muted">Buttons on this page are tagged with explicit click events (<code>data-analytics-event=&quot;plan_select&quot;</code>).</p>
      <div className="feature-grid">
        {plans.map((p) => (
          <div className="card" key={p.name}>
            <h2>{p.name}</h2>
            <p style={{ fontSize: "1.6rem", fontWeight: 700, margin: "0 0 .25em" }}>{p.price}</p>
            <p className="muted">{p.note}</p>
            <button type="button" className="btn btn-primary" data-analytics-event="plan_select" data-analytics-label={p.name.toLowerCase().replace(/\s+/g, "-")}>
              Choose {p.name}
            </button>
          </div>
        ))}
      </div>
    </>
  );
}

const metrics = [
  { label: 'Books in catalog', value: 'API-backed' },
  { label: 'LiveKit sessions', value: 'Wired' },
  { label: 'Storage mode', value: 'S3-ready' },
  { label: 'Auth', value: 'JWT + Django' },
];

export default function DashboardPage() {
  return (
    <main className="hero">
      <section className="hero-card">
        <span className="eyebrow">Dashboard Stub</span>
        <h1>Foundation views can now move into real product screens.</h1>
        <p>
          This route is a placeholder for M2 work. For M1, it establishes the app-router structure and shared
          styling while the Django backend continues to own the actual business flows.
        </p>
      </section>
      <section className="dashboard-grid">
        {metrics.map((metric) => (
          <article className="metric-card" key={metric.label}>
            <p>{metric.label}</p>
            <strong>{metric.value}</strong>
          </article>
        ))}
      </section>
    </main>
  );
}
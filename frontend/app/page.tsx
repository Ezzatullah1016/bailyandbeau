import Link from 'next/link';
import { apiBaseUrl } from '@/lib/api';

const foundationItems = [
  'Django API and admin already active',
  'Auth endpoints ready for a browser client',
  'LiveKit room and token wiring in backend services',
  'S3-ready storage configuration via environment variables',
  'GitHub Actions CI baseline for backend and frontend checks',
];

export default function HomePage() {
  return (
    <main className="hero">
      <section className="hero-card">
        <span className="eyebrow">M1 Foundation</span>
        <h1>Reading sessions, auth, storage, and frontend setup in one baseline.</h1>
        <p>
          This Next.js scaffold is intentionally thin. It proves the frontend entry points, points at the
          Django API, and gives the project a stable place to add parent and child flows in later milestones.
        </p>
        <div className="actions">
          <Link className="button" href="/login">
            Try login flow
          </Link>
          <Link className="button secondary" href="/dashboard">
            View dashboard stub
          </Link>
        </div>
      </section>

      <section className="hero-grid">
        {foundationItems.map((item) => (
          <article className="panel" key={item}>
            <span className="eyebrow">Ready</span>
            <h2>{item}</h2>
          </article>
        ))}
        <article className="panel">
          <span className="eyebrow">API</span>
          <h2>Backend base URL</h2>
          <p>{apiBaseUrl}</p>
        </article>
      </section>
    </main>
  );
}
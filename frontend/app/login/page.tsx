'use client';

import { FormEvent, useState } from 'react';
import { apiRequest } from '@/lib/api';

type LoginResponse = {
  refresh?: string;
  access?: string;
  detail?: string;
};

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState('Use an existing Django account to verify the frontend handshake.');
  const [statusClassName, setStatusClassName] = useState('status');
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setStatusClassName('status');

    try {
      const payload = await apiRequest<LoginResponse>('/auth/login/', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });

      if (!payload.access) {
        throw new Error(payload.detail || 'Login succeeded but no access token was returned.');
      }

      setStatus('Login request succeeded. JWTs were returned by the Django API.');
      setStatusClassName('status success');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Login failed.';
      setStatus(message);
      setStatusClassName('status error');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="hero">
      <section className="form-card">
        <span className="eyebrow">API Login</span>
        <h1>Connect the Next.js client to Django auth.</h1>
        <p>This page posts to the existing Django JWT login endpoint and confirms the response path.</p>
        <form className="stack" onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="username">Username or email</label>
            <input
              id="username"
              name="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              name="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </div>
          <button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
        <p className={statusClassName}>{status}</p>
      </section>

      <section className="panel">
        <span className="eyebrow">M1 Scope</span>
        <h2>What this proves right now</h2>
        <p>The frontend can target the live Django API without proxy glue or custom edge logic.</p>
        <div className="stack">
          <div>
            <strong>Auth:</strong>
            <p>Uses the existing /api/v1/auth/login/ backend endpoint.</p>
          </div>
          <div>
            <strong>CORS:</strong>
            <p>Backend settings now allow the default local Next.js dev origins.</p>
          </div>
          <div>
            <strong>Expansion path:</strong>
            <p>Session booking, reading rooms, and profile flows can layer onto this shell.</p>
          </div>
        </div>
      </section>
    </main>
  );
}
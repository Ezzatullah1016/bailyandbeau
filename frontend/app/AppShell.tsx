'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const FULLSCREEN_PREFIXES = ['/session', '/invite', '/dashboard', '/onboarding', '/login'];

function AppShellInner({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isFullscreen = FULLSCREEN_PREFIXES.some((prefix) => pathname?.startsWith(prefix));

  if (isFullscreen) {
    // Session / invite pages are full-screen — skip the shell and topbar entirely
    return <>{children}</>;
  }

  return (
    <div className="shell">
      <header className="topbar">
        <Link className="brand" href="/">
          Bailey &amp; Beau
        </Link>
        <nav className="actions">
          <Link className="button secondary" href="/dashboard">
            Dashboard
          </Link>
          <Link className="button" href="/login">
            Login
          </Link>
        </nav>
      </header>
      {children}
    </div>
  );
}

/** `usePathname()` must run under Suspense (Next.js app router). */
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<>{children}</>}>
      <AppShellInner>{children}</AppShellInner>
    </Suspense>
  );
}

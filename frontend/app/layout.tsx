import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'Bailey & Beau',
  description: 'Foundation frontend scaffold for the Bailey & Beau reading platform.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <div className="shell">
          <header className="topbar">
            <Link className="brand" href="/">
              Bailey & Beau
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
      </body>
    </html>
  );
}
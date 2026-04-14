import type { Metadata } from 'next';
import { SessionProvider } from '@/contexts/SessionContext';

export const metadata: Metadata = {
  title: 'Reading Room — Bailey & Beau',
};

/**
 * Full-screen layout for session routes.
 * Intentionally omits the global topbar — reading room is immersive and full-screen.
 */
export default function SessionLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      {children}
    </SessionProvider>
  );
}

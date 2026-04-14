import { SessionProvider } from '@/contexts/SessionContext';

export default function InviteLayout({ children }: { children: React.ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>;
}

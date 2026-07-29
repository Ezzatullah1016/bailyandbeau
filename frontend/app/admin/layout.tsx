'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { fetchMe } from '@/lib/api';

/**
 * Staff gate for every `/admin/*` screen.
 *
 * Without this a signed-in parent who typed the URL got the full admin shell
 * and a wall of failed requests, because the only enforcement was the API
 * returning 403 per call. The server-side check stays authoritative — this
 * exists so the wrong person sees a redirect instead of a broken page.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [state, setState] = useState<'checking' | 'allowed'>('checking');

  useEffect(() => {
    let cancelled = false;
    fetchMe()
      .then((me) => {
        if (cancelled) return;
        if (me.is_staff) {
          setState('allowed');
        } else {
          router.replace('/dashboard');
        }
      })
      .catch(() => {
        // Not signed in, or the token expired: login owns that decision.
        if (!cancelled) router.replace('/login');
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (state === 'checking') {
    return (
      <div className="grid min-h-screen place-items-center bg-[#faf7f6]">
        <p className="font-karla text-sm text-stone-600">Checking your access…</p>
      </div>
    );
  }

  return <>{children}</>;
}

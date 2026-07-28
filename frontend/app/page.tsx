'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * The root path is a redirect, not a page.
 *
 * It used to render the M1 scaffold landing page ("Reading sessions, auth,
 * storage, and frontend setup in one baseline") — an internal status board that
 * also printed the backend base URL, and that customers were never meant to
 * see. Anyone signed out, or bounced here by a failed session lookup, landed on
 * it instead of somewhere useful.
 *
 * Signed in goes to the dashboard, signed out goes to login. `replace` rather
 * than `push`, so Back does not return here.
 */
export default function HomePage() {
  const router = useRouter();

  useEffect(() => {
    const signedIn = Boolean(localStorage.getItem('bb_access_token'));
    router.replace(signedIn ? '/dashboard' : '/login');
  }, [router]);

  return null;
}

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const COOKIE_KEY = 'bb_cookie_consent';

export function CookieBanner() {
  const pathname = usePathname();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem(COOKIE_KEY)) setVisible(true);
  }, []);

  // Inside a live session the banner is docked over the media controls
  // (mic/camera/end), so suppress it there and let the lobby handle consent.
  const inSession = /^\/session\/[^/]+\/(reading-room|activity)/.test(pathname ?? '');

  if (!visible || inSession) return null;

  function accept() {
    localStorage.setItem(COOKIE_KEY, 'accepted');
    setVisible(false);
  }

  function decline() {
    localStorage.setItem(COOKIE_KEY, 'declined');
    setVisible(false);
  }

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-label="Cookie consent"
      className="fixed bottom-0 left-0 right-0 z-[999] bg-[#3d3b62] text-white px-6 py-4 flex flex-col sm:flex-row items-start sm:items-center gap-4 shadow-2xl"
    >
      <p className="text-sm flex-1 font-karla">
        We use essential cookies for authentication and optional analytics cookies to improve the platform.{' '}
        <Link href="/privacy" className="underline hover:text-[#f0c75e]">Privacy Policy</Link>
      </p>
      <div className="flex gap-3 shrink-0">
        <button
          onClick={decline}
          className="font-baloo px-4 py-2 text-sm font-bold border border-white/30 rounded-lg hover:bg-white/10 transition-all"
        >
          Essential only
        </button>
        <button
          onClick={accept}
          className="font-baloo px-4 py-2 text-sm font-bold bg-[#f0c75e] text-[#3d3b62] rounded-lg hover:bg-[#f0c75e]/90 transition-all"
        >
          Accept all
        </button>
      </div>
    </div>
  );
}

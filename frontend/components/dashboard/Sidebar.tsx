'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Icon } from '@/components/ui/Icon';
import { SidebarProfileAvatar, type DashboardMe } from '@/components/dashboard/AccountAvatar';

interface SidebarProps {
  me: DashboardMe | null;
  currentPath: string;
}

export function Sidebar({ me, currentPath }: SidebarProps) {
  const [open, setOpen] = useState(false);
  const displayName = me ? (me.first_name ? `${me.first_name} ${me.last_name}`.trim() : me.username) : '';

  // Close drawer on route change
  useEffect(() => { setOpen(false); }, [currentPath]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open]);

  function handleSignOut() {
    localStorage.removeItem('bb_access_token');
    localStorage.removeItem('bb_refresh_token');
    window.location.href = '/login';
  }

  const navItems = [
    { href: '/dashboard',           icon: 'dashboard',    label: 'Dashboard' },
    { href: '/dashboard/library',   icon: 'auto_stories', label: 'Library' },
    { href: '/dashboard/sessions',  icon: 'history_edu',  label: 'Sessions' },
    { href: '/dashboard/billing',   icon: 'payments',     label: 'Billing' },
    { href: '/dashboard/settings',  icon: 'settings',     label: 'Settings' },
  ];

  const sidebarContent = (
    <div className="flex flex-col h-full">
      <div className="px-6 mb-10 flex items-center justify-between">
        <div>
          <h1 className="font-baloo text-2xl font-bold text-white">Bailey &amp; Beau</h1>
          <p className="font-karla text-[10px] uppercase tracking-widest text-[#eccdca] mt-1">The Living Storybook</p>
        </div>
        {/* Close button — mobile only */}
        <button
          onClick={() => setOpen(false)}
          aria-label="Close menu"
          className="md:hidden p-1 rounded-lg text-white/60 hover:text-white hover:bg-white/10"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <nav className="flex-1 space-y-1 px-2">
        {navItems.map((item) => {
          const active = currentPath === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-karla font-medium transition-all ${
                active
                  ? 'bg-[#764f84] text-white font-bold'
                  : 'text-white/80 hover:text-white hover:bg-[#764f84]/60'
              }`}
            >
              <Icon name={item.icon} className={`w-5 h-5 ${active ? 'text-white' : 'text-white/70'}`} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="px-4 mt-auto pt-8 border-t border-white/10">
        <div className="flex items-center gap-3 p-2 rounded-xl bg-white/5">
          <SidebarProfileAvatar me={me} />
          <div className="flex-1 min-w-0">
            <p className="font-karla text-white text-sm font-medium truncate">{displayName}</p>
            <button
              onClick={handleSignOut}
              className="font-karla text-xs text-white/40 hover:text-white transition-colors"
            >
              Sign Out
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* ── Mobile hamburger button ───────────────────────────────── */}
      <button
        onClick={() => setOpen(true)}
        aria-label="Open menu"
        className="md:hidden fixed top-4 left-4 z-50 p-2 rounded-xl bg-[#3d3b62] text-white shadow-lg"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>

      {/* ── Mobile backdrop ───────────────────────────────────────── */}
      {open && (
        <div
          className="md:hidden fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* ── Mobile drawer ─────────────────────────────────────────── */}
      <aside
        className={`md:hidden fixed left-0 top-0 h-full z-50 w-72 bg-[#3d3b62] overflow-y-auto py-8 shadow-2xl transition-transform duration-300 ${open ? 'translate-x-0' : '-translate-x-full'}`}
        aria-label="Navigation menu"
      >
        {sidebarContent}
      </aside>

      {/* ── Desktop sidebar (always visible ≥ md) ────────────────── */}
      <aside
        className="hidden md:flex h-screen w-64 fixed left-0 top-0 overflow-y-auto bg-[#3d3b62] flex-col py-8 z-50 shadow-2xl"
        aria-label="Navigation menu"
      >
        {sidebarContent}
      </aside>
    </>
  );
}

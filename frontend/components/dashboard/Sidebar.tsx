'use client';

import Link from 'next/link';
import { Icon } from '@/components/ui/Icon';
import { BrandLogo } from '@/components/brand/BrandLogo';

interface MeData {
  id: number;
  username: string;
  email?: string;
  first_name: string;
  last_name: string;
}

interface SidebarProps {
  me: MeData | null;
  currentPath: string;
}

export function Sidebar({ me, currentPath }: SidebarProps) {
  const initials = me
    ? `${me.first_name?.[0] ?? ''}${me.last_name?.[0] ?? ''}`.toUpperCase() || me.username[0].toUpperCase()
    : '?';
  const displayName = me ? (me.first_name ? `${me.first_name} ${me.last_name}`.trim() : me.username) : '';

  function handleSignOut() {
    localStorage.removeItem('bb_access_token');
    localStorage.removeItem('bb_refresh_token');
    window.location.href = '/login';
  }

  const navItems = [
    { href: '/dashboard',           icon: 'dashboard',    label: 'Dashboard' },
    { href: '/dashboard/library',   icon: 'auto_stories', label: 'Library' },
    { href: '/dashboard/sessions',  icon: 'history_edu',  label: 'Sessions' },
    { href: '/dashboard/badges',    icon: 'military_tech',label: 'Badges' },
    { href: '/dashboard/billing',   icon: 'payments',     label: 'Billing' },
    { href: '/dashboard/settings',  icon: 'settings',     label: 'Settings' },
  ];

  return (
    <aside className="h-screen w-64 fixed left-0 top-0 overflow-y-auto bg-[#3d3b62] flex flex-col py-8 z-50 shadow-2xl">
      <div className="px-6 mb-10">
        <h1 className="font-baloo text-2xl font-bold text-white">Bailey &amp; Beau</h1>
        <p className="font-karla text-[10px] uppercase tracking-widest text-[#eccdca] mt-1">The Living Storybook</p>
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
              <Icon name={item.icon} className={`w-5 h-5 ${active ? 'text-white' : 'text-white/70 group-hover:text-white'}`} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="px-4 mt-auto pt-8 border-t border-white/10">
        <div className="flex items-center gap-3 p-2 rounded-xl bg-white/5">
          <div className="h-10 w-10 rounded-full bg-white/10 flex items-center justify-center text-white font-bold text-sm flex-shrink-0 border border-white/20">
            {initials}
          </div>
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
    </aside>
  );
}

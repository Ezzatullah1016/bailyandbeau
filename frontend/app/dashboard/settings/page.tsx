'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Baby, Bell, CheckCircle, Clock, Download, LogOut, Plus, RefreshCw, Save, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { apiRequest, type UserBadgeData } from '@/lib/api';
import { Sidebar } from '@/components/dashboard/Sidebar';
import { HeaderProfileAvatar, dashboardInitials, resolveUserAvatarUrl } from '@/components/dashboard/AccountAvatar';

interface MeData {
  id: number;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  avatar_url?: string;
}

interface ChildProfile {
  id: string;
  display_name: string;
  age_band: string;
  is_active: boolean;
}

interface Reminder {
  id: string;
  title: string;
  frequency: string;
  time_of_day: string;
  next_due: string;
  is_active: boolean;
  child_name: string;
}

interface EntitlementData {
  subscription_status: string;
  plan_code: string;
  sessions_remaining: number;
  pack_sessions_remaining: number;
  renewal_date: string | null;
}

interface RecentSessionRow {
  id: string;
  book_title: string;
  child_name: string;
  status: string;
  room_type: string;
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
}

const AGE_BANDS = ['0-2', '3-5', '6-8', '9-12'];

/** Match `admin_settings.html` form labels */
const labelClass = 'text-[0.65rem] font-bold uppercase tracking-[0.18em] text-slate-500';
const fieldClass = 'flex flex-col gap-1';
const inputClass =
  'w-full rounded-xl border border-stone-200 bg-white px-3.5 py-2 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-[#3b85a6]/30';
const inputDisabledClass =
  'w-full rounded-xl border border-stone-200 bg-stone-50 px-3.5 py-2 text-sm text-slate-600 shadow-sm cursor-not-allowed';
const sectionCardClass = 'scroll-mt-28 rounded-2xl border border-stone-200 bg-white p-6 shadow-sm';

function displayNameFromMe(me: MeData | null): string {
  if (!me) return '';
  const full = `${me.first_name ?? ''} ${me.last_name ?? ''}`.trim();
  return full || me.username;
}

function formatSubscriptionLabel(raw: string | undefined | null): string {
  const s = (raw ?? '').trim();
  if (!s) return 'None';
  return s
    .replace(/_/g, ' ')
    .split(' ')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

function subscriptionPillClass(status: string): string {
  const s = status.toLowerCase();
  if (s.includes('active')) return 'bg-emerald-100 text-emerald-800';
  if (s.includes('trialing')) return 'bg-sky-100 text-sky-800';
  if (s.includes('past_due') || s.includes('unpaid')) return 'bg-amber-100 text-amber-800';
  if (s.includes('canceled') || s.includes('cancelled')) return 'bg-stone-100 text-stone-600';
  if (!s || s === 'none') return 'bg-sky-50 text-sky-700';
  return 'bg-slate-100 text-slate-700';
}

function fmtShort(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function sessionStatusLabel(status: string): string {
  return status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function SectionHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <header className="mb-5 border-b border-stone-100 pb-4">
      <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
      <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>
    </header>
  );
}

function DeleteAccountButton() {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-red-200 bg-white py-2.5 text-sm font-semibold text-red-600 hover:bg-red-50"
      >
        <Trash2 className="h-4 w-4" /> Delete my account
      </button>
    );
  }

  async function confirmDelete() {
    setDeleting(true);
    try {
      await apiRequest('/me/delete/', { method: 'DELETE' });
      localStorage.removeItem('bb_access_token');
      localStorage.removeItem('bb_refresh_token');
      router.replace('/login');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-4 space-y-3">
      <p className="text-sm font-semibold text-red-700">Are you sure? This permanently deletes your account and all data.</p>
      <div className="flex gap-3">
        <button
          type="button"
          onClick={confirmDelete}
          disabled={deleting}
          className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-red-600 py-2 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-60"
        >
          {deleting ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
          {deleting ? 'Deleting…' : 'Yes, delete'}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="flex-1 rounded-xl border border-red-200 bg-white py-2 text-sm font-bold text-red-600 hover:bg-red-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const [me, setMe] = useState<MeData | null>(null);
  const [children, setChildren] = useState<ChildProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [showAddChild, setShowAddChild] = useState(false);
  const [newChildName, setNewChildName] = useState('');
  const [newChildAge, setNewChildAge] = useState('3-5');
  const [addingChild, setAddingChild] = useState(false);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [entitlement, setEntitlement] = useState<EntitlementData | null>(null);
  const [recentSessions, setRecentSessions] = useState<RecentSessionRow[]>([]);
  const [recentBadges, setRecentBadges] = useState<UserBadgeData[]>([]);
  const [activeJump, setActiveJump] = useState('profile');

  const jumpLinks = useMemo(
    () =>
      [
        { id: 'profile', label: 'Profile' },
        { id: 'children', label: 'Child profiles' },
        { id: 'snapshot', label: 'Account snapshot' },
        ...(reminders.length > 0 ? [{ id: 'reminders', label: 'Reading reminders' }] : []),
        { id: 'sign-out', label: 'Sign out' },
      ] as const satisfies readonly { id: string; label: string }[],
    [reminders.length],
  );

  useEffect(() => {
    const token = localStorage.getItem('bb_access_token');
    if (!token) {
      router.replace('/login');
      return;
    }
    Promise.all([
      apiRequest<{ data: MeData }>('/me/').then((r) => {
        setMe(r.data);
        setFirstName(r.data.first_name);
        setLastName(r.data.last_name);
      }),
      apiRequest<{ data: ChildProfile[] }>('/children/').then((r) => setChildren(r.data)),
      apiRequest<{ data: Reminder[] }>('/reminders/')
        .then((r) => setReminders(r.data))
        .catch(() => {}),
      apiRequest<{ data: EntitlementData }>('/billing/entitlement/')
        .then((r) => setEntitlement(r.data))
        .catch(() => setEntitlement(null)),
      apiRequest<{ data: { recent_sessions: RecentSessionRow[] } }>('/dashboard/')
        .then((r) => setRecentSessions(r.data.recent_sessions ?? []))
        .catch(() => setRecentSessions([])),
      apiRequest<{ data: UserBadgeData[] }>('/me/badges/')
        .then((r) => setRecentBadges((r.data ?? []).slice(0, 5)))
        .catch(() => setRecentBadges([])),
    ])
      .catch(() => router.replace('/login'))
      .finally(() => setLoading(false));
  }, [router]);

  useEffect(() => {
    if (loading) return;
    const ids = jumpLinks.map((j) => j.id);
    const obs = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => (b.intersectionRatio ?? 0) - (a.intersectionRatio ?? 0));
        const id = visible[0]?.target?.id;
        if (id && ids.includes(id)) setActiveJump(id);
      },
      { root: null, rootMargin: '-15% 0px -55% 0px', threshold: [0, 0.15, 0.35, 0.55] },
    );
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) obs.observe(el);
    }
    return () => obs.disconnect();
  }, [loading, jumpLinks]);

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const r = await apiRequest<{ data: MeData }>('/me/', {
        method: 'PATCH',
        body: JSON.stringify({ first_name: firstName, last_name: lastName }),
      });
      setMe(r.data);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } finally {
      setSaving(false);
    }
  }

  async function addChild(e: React.FormEvent) {
    e.preventDefault();
    if (!newChildName.trim()) return;
    setAddingChild(true);
    try {
      const r = await apiRequest<{ data: ChildProfile }>('/children/', {
        method: 'POST',
        body: JSON.stringify({ display_name: newChildName.trim(), age_band: newChildAge }),
      });
      setChildren((prev) => [...prev, r.data]);
      setNewChildName('');
      setShowAddChild(false);
    } finally {
      setAddingChild(false);
    }
  }

  async function removeChild(id: string) {
    await apiRequest(`/children/${id}/`, { method: 'DELETE' }).catch(() => {});
    setChildren((prev) => prev.filter((c) => c.id !== id));
  }

  const sessionsLeft =
    (entitlement?.sessions_remaining ?? 0) + (entitlement?.pack_sessions_remaining ?? 0);
  const planLabel =
    entitlement?.plan_code && entitlement.plan_code.trim() !== ''
      ? entitlement.plan_code
      : 'Unassigned';
  const subStatusRaw = entitlement?.subscription_status ?? '';
  const subLabel = formatSubscriptionLabel(subStatusRaw);

  const avatarUrl = resolveUserAvatarUrl(me?.avatar_url);
  const initials = dashboardInitials(me);

  if (loading)
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-stone-50">
        <RefreshCw className="h-10 w-10 animate-spin text-[#764f84]" />
      </div>
    );

  return (
    <>
      <Sidebar me={me} currentPath={pathname} />
      <div className="ml-0 md:ml-64 flex min-w-0 flex-1 flex-col overflow-x-hidden">
        <header className="sticky top-0 z-40 flex h-16 w-full items-center justify-between border-b border-stone-200 bg-stone-50/90 pl-16 pr-8 md:px-8 shadow-sm backdrop-blur-md">
          <span className="text-base font-semibold text-slate-900">Settings</span>
          <HeaderProfileAvatar me={me} />
        </header>
        <main className="min-h-screen bg-stone-50 p-8 font-karla text-slate-900">
          <div className="mb-8">
            <h2 className="text-2xl font-semibold text-slate-900">Settings</h2>
            <p className="mt-1 text-sm text-slate-500">
              Manage your profile, child profiles, and see a snapshot of your account activity.
            </p>
          </div>

          <div className="grid gap-8 lg:grid-cols-[220px_minmax(0,1fr)]">
            <nav className="h-fit rounded-2xl border border-stone-200 bg-white p-3 shadow-sm lg:sticky lg:top-24">
              <p className="mb-2 px-3 text-[10px] font-bold uppercase tracking-widest text-slate-400">Jump to</p>
              <ul className="space-y-0.5 text-sm font-medium">
                {jumpLinks.map((item) => (
                  <li key={item.id}>
                    <a
                      href={`#${item.id}`}
                      onClick={() => setActiveJump(item.id)}
                      className={`block rounded-xl px-4 py-2.5 transition-colors ${
                        activeJump === item.id
                          ? 'bg-[#eccdca]/25 text-[#3d3b62]'
                          : 'text-slate-600 hover:bg-stone-50'
                      }`}
                    >
                      {item.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>

            <div className="space-y-8">
              <section id="profile" className={sectionCardClass}>
                <SectionHeader
                  title="Profile"
                  subtitle="Your name is shown around the app. Username and email are managed by support."
                />
                <form onSubmit={saveProfile} className="mx-auto max-w-md space-y-4">
                  <div className={fieldClass}>
                    <label className={labelClass} htmlFor="settings-first">
                      First name
                    </label>
                    <input
                      id="settings-first"
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      className={inputClass}
                      autoComplete="given-name"
                    />
                  </div>
                  <div className={fieldClass}>
                    <label className={labelClass} htmlFor="settings-last">
                      Last name
                    </label>
                    <input
                      id="settings-last"
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      className={inputClass}
                      autoComplete="family-name"
                    />
                  </div>
                  <div className={fieldClass}>
                    <label className={labelClass}>Username</label>
                    <input value={me?.username ?? ''} disabled className={inputDisabledClass} readOnly />
                  </div>
                  <div className={fieldClass}>
                    <label className={labelClass}>Email</label>
                    <input value={me?.email ?? ''} disabled className={inputDisabledClass} readOnly />
                  </div>
                  <div className="space-y-2 pt-1">
                    <button
                      type="submit"
                      disabled={saving}
                      className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#8b6f62] py-2.5 text-sm font-semibold text-white hover:opacity-95 disabled:opacity-60"
                    >
                      {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                      {saving ? 'Saving…' : 'Save changes'}
                    </button>
                    {saved && (
                      <p className="flex items-center justify-center gap-1 text-center text-sm font-medium text-emerald-600">
                        <CheckCircle className="h-4 w-4" /> Saved
                      </p>
                    )}
                  </div>
                </form>
              </section>

              <section id="children" className={sectionCardClass}>
                <header className="mb-5 flex flex-wrap items-start justify-between gap-3 border-b border-stone-100 pb-4">
                  <div>
                    <h3 className="text-lg font-semibold text-slate-900">Child profiles</h3>
                    <p className="mt-0.5 text-sm text-slate-500">
                      Children appear when starting sessions and earning badges.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowAddChild(true)}
                    className="shrink-0 rounded-xl bg-[#8b6f62] px-4 py-2 text-sm font-semibold text-white hover:opacity-95"
                  >
                    <span className="inline-flex items-center gap-2">
                      <Plus className="h-4 w-4" /> Add child
                    </span>
                  </button>
                </header>

                <div className="mx-auto max-w-md">
                  {children.length === 0 && !showAddChild && (
                    <div className="py-8 text-center text-slate-500">
                      <Baby className="mx-auto mb-2 h-8 w-8 opacity-60" />
                      <p className="text-sm">No child profiles yet.</p>
                    </div>
                  )}

                  <div className="space-y-2">
                    {children.map((child) => (
                      <div
                        key={child.id}
                        className="flex items-center justify-between gap-3 rounded-xl border border-stone-100 bg-stone-50 px-3 py-2 shadow-sm"
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-[#f0c75e] text-sm font-bold text-[#3d3b62]">
                            {child.display_name[0]?.toUpperCase() ?? '?'}
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-slate-900">{child.display_name}</p>
                            <p className="text-xs text-slate-500">Ages {child.age_band}</p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeChild(child.id)}
                          className="text-slate-300 transition-colors hover:text-red-500"
                          aria-label={`Remove ${child.display_name}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                  </div>

                  {showAddChild && (
                    <form onSubmit={addChild} className="mt-4 space-y-4 border-t border-stone-100 pt-5">
                      <div className={fieldClass}>
                        <label className={labelClass}>Child&apos;s name</label>
                        <input
                          value={newChildName}
                          onChange={(e) => setNewChildName(e.target.value)}
                          placeholder="e.g. Lily"
                          className={inputClass}
                        />
                      </div>
                      <div className={fieldClass}>
                        <label className={labelClass}>Age band</label>
                        <select
                          value={newChildAge}
                          onChange={(e) => setNewChildAge(e.target.value)}
                          className={inputClass}
                        >
                          {AGE_BANDS.map((a) => (
                            <option key={a} value={a}>
                              {a} years
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="flex flex-wrap gap-3">
                        <button
                          type="submit"
                          disabled={addingChild || !newChildName.trim()}
                          className="rounded-xl bg-[#8b6f62] px-5 py-2 text-sm font-semibold text-white hover:opacity-95 disabled:opacity-60"
                        >
                          {addingChild ? 'Adding…' : 'Add'}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setShowAddChild(false);
                            setNewChildName('');
                          }}
                          className="rounded-xl border border-stone-200 bg-white px-5 py-2 text-sm font-semibold text-slate-600 shadow-sm hover:bg-stone-50"
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  )}
                </div>
              </section>

              <section id="snapshot" className={sectionCardClass}>
                <SectionHeader
                  title="Account snapshot"
                  subtitle="Plan, sessions remaining, and recent activity—similar to the admin directory detail panel."
                />

                <div className="flex flex-wrap items-start justify-between gap-4 border-b border-stone-100 pb-5">
                  <div className="flex min-w-0 gap-4">
                    <div className="h-14 w-14 flex-shrink-0 overflow-hidden rounded-full border border-stone-200 bg-stone-50 shadow-sm">
                      {avatarUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-sm font-bold text-slate-500">
                          {initials}
                        </div>
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-lg font-semibold text-slate-900">{displayNameFromMe(me)}</p>
                      <p className="truncate text-sm text-slate-500">{me?.email}</p>
                      <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.2em] text-rose-600">Your profile</p>
                    </div>
                  </div>
                  <span
                    className={`inline-flex shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${subscriptionPillClass(subStatusRaw)}`}
                  >
                    {subLabel}
                  </span>
                </div>

                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl bg-stone-50 p-3 shadow-sm">
                    <p className="text-[0.65rem] font-bold uppercase tracking-[0.18em] text-slate-500">Plan</p>
                    <p className="mt-1 text-sm font-semibold text-slate-900">{planLabel}</p>
                  </div>
                  <div className="rounded-xl bg-stone-50 p-3 shadow-sm">
                    <p className="text-[0.65rem] font-bold uppercase tracking-[0.18em] text-slate-500">Sessions left</p>
                    <p className="mt-1 text-sm font-semibold text-slate-900">{sessionsLeft}</p>
                  </div>
                </div>

                <div className="mt-5">
                  <h4 className="text-sm font-semibold text-slate-900">Child profiles</h4>
                  <div className="mt-2 space-y-2">
                    {children.length === 0 ? (
                      <p className="text-sm text-slate-500">No child profiles yet.</p>
                    ) : (
                      children.map((child) => (
                        <div key={child.id} className="rounded-xl bg-stone-50 px-3 py-2 shadow-sm">
                          <p className="font-medium text-slate-900">{child.display_name}</p>
                          <p className="text-xs text-slate-500">Ages {child.age_band}</p>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div className="mt-5">
                  <h4 className="text-sm font-semibold text-slate-900">Recent sessions</h4>
                  <div className="mt-2 space-y-2">
                    {recentSessions.length === 0 ? (
                      <p className="text-sm text-slate-500">No sessions recorded yet.</p>
                    ) : (
                      recentSessions.map((row) => (
                        <div key={row.id} className="rounded-xl bg-stone-50 px-3 py-2 shadow-sm">
                          <p className="font-medium text-slate-900">{row.book_title}</p>
                          <p className="text-xs text-slate-500">
                            {row.child_name} · {sessionStatusLabel(row.status)}
                          </p>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div className="mt-5">
                  <h4 className="text-sm font-semibold text-slate-900">Recent badge awards</h4>
                  <div className="mt-2 space-y-2">
                    {recentBadges.length === 0 ? (
                      <p className="text-sm text-slate-500">No badges awarded yet.</p>
                    ) : (
                      recentBadges.map((b) => (
                        <div key={b.id} className="rounded-xl bg-stone-50 px-3 py-2 shadow-sm">
                          <p className="font-medium text-slate-900">{b.badge_name}</p>
                          <p className="text-xs text-slate-500">
                            {b.child_name} · {fmtShort(b.earned_at)}
                          </p>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </section>

              {reminders.length > 0 && (
                <section id="reminders" className={sectionCardClass}>
                  <header className="mb-5 border-b border-stone-100 pb-4">
                    <h3 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
                      <Bell className="h-5 w-5 text-[#764f84]" />
                      Reading reminders
                    </h3>
                    <p className="mt-0.5 text-sm text-slate-500">Scheduled nudges tied to your children.</p>
                  </header>
                  <div className="space-y-2">
                    {reminders.map((r) => (
                      <div
                        key={r.id}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-stone-100 bg-stone-50 px-3 py-3 shadow-sm"
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-[#764f84]/10">
                            <Bell className="h-4 w-4 text-[#764f84]" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-slate-900">{r.title}</p>
                            <p className="text-xs capitalize text-slate-500">
                              {r.frequency} · {r.child_name}
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="flex items-center justify-end gap-1 text-xs font-semibold text-[#764f84]">
                            <Clock className="h-3 w-3" />
                            {r.time_of_day?.slice(0, 5)}
                          </div>
                          <p className="mt-0.5 text-[10px] text-slate-500">
                            Next:{' '}
                            {r.next_due
                              ? new Date(r.next_due).toLocaleDateString('en-GB', {
                                  day: 'numeric',
                                  month: 'short',
                                })
                              : '—'}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              <section id="sign-out" className={sectionCardClass}>
                <SectionHeader
                  title="Sign out"
                  subtitle="Sign out of your Bailey & Beau account on this device."
                />
                <div className="mx-auto max-w-md space-y-3">
                  <button
                    type="button"
                    onClick={() => {
                      localStorage.removeItem('bb_access_token');
                      localStorage.removeItem('bb_refresh_token');
                      window.location.href = '/login';
                    }}
                    className="flex w-full items-center justify-center gap-2 rounded-xl border border-rose-200 bg-rose-50 py-2.5 text-sm font-semibold text-rose-800 hover:bg-rose-100"
                  >
                    <LogOut className="h-4 w-4" /> Sign out
                  </button>
                  <a
                    href="/api/v1/me/export/"
                    className="flex w-full items-center justify-center gap-2 rounded-xl border border-[#eccdca] bg-white py-2.5 text-sm font-semibold text-[#3d3b62] hover:bg-stone-50"
                  >
                    <Download className="h-4 w-4" /> Export my data
                  </a>
                  <DeleteAccountButton />
                </div>
                <p className="mt-4 text-center text-xs text-stone-400">
                  <Link href="/privacy" className="underline hover:text-[#3d3b62]">Privacy Policy</Link>
                  {' · '}
                  <Link href="/terms" className="underline hover:text-[#3d3b62]">Terms of Service</Link>
                </p>
              </section>
            </div>
          </div>
        </main>
      </div>
    </>
  );
}

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Baby, CheckCircle, LogOut, Plus, RefreshCw, Save, Trash2 } from 'lucide-react';
import { Icon } from '@/components/ui/Icon';
import { apiRequest } from '@/lib/api';

interface MeData { id: number; username: string; email: string; first_name: string; last_name: string; }
interface ChildProfile { id: string; display_name: string; age_band: string; is_active: boolean; }

const AGE_BANDS = ['0-2', '3-5', '6-8', '9-12'];

function Sidebar({ me }: { me: MeData | null }) {
  const initials = me ? (`${me.first_name?.[0] ?? ''}${me.last_name?.[0] ?? ''}`).toUpperCase() || me.username[0].toUpperCase() : '?';
  const displayName = me ? (me.first_name ? `${me.first_name} ${me.last_name}`.trim() : me.username) : '';
  return (
    <aside className="h-screen w-64 fixed left-0 top-0 overflow-y-auto bg-[#2d5016] flex flex-col py-8 z-50">
      <div className="px-6 mb-10">
        <h1 className="font-headline text-2xl italic text-[#feae2c]">Bailey &amp; Beau</h1>
        <p className="text-[10px] uppercase tracking-widest text-[#a8d38a]/60 font-bold mt-1">The Living Storybook</p>
      </div>
      <nav className="flex-1 space-y-1 px-2">
        {[
          { href: '/dashboard',          icon: 'dashboard',    label: 'Dashboard', active: false },
          { href: '/dashboard/library',  icon: 'auto_stories', label: 'Library',   active: false },
          { href: '/dashboard/sessions', icon: 'history_edu',  label: 'Sessions',  active: false },
          { href: '/dashboard/badges',   icon: 'military_tech',label: 'Badges',    active: false },
          { href: '/dashboard/billing',  icon: 'payments',     label: 'Billing',   active: false },
          { href: '/dashboard/settings', icon: 'settings',     label: 'Settings',  active: true  },
        ].map((item) => (
          <Link key={item.href} href={item.href}
            className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all ${item.active ? 'bg-emerald-900/50 text-[#feae2c] font-bold' : 'text-[#a8d38a]/70 hover:text-white hover:bg-emerald-900/40'}`}>
            <Icon name={item.icon} className="w-5 h-5" />
            {item.label}
          </Link>
        ))}
      </nav>
      <div className="px-4 mt-auto pt-8 border-t border-white/5">
        <div className="flex items-center gap-3 p-2 rounded-xl bg-white/5">
          <div className="h-10 w-10 rounded-full bg-[#feae2c] flex items-center justify-center text-[#2d5016] font-bold text-sm shrink-0">{initials}</div>
          <div className="flex-1 min-w-0">
            <p className="text-white text-sm font-medium truncate">{displayName}</p>
            <button onClick={() => { localStorage.removeItem('bb_access_token'); localStorage.removeItem('bb_refresh_token'); window.location.href = '/login'; }}
              className="text-xs text-[#a8d38a]/50 hover:text-[#a8d38a] transition-colors">Sign Out</button>
          </div>
        </div>
      </div>
    </aside>
  );
}

export default function SettingsPage() {
  const router = useRouter();
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

  useEffect(() => {
    const token = localStorage.getItem('bb_access_token');
    if (!token) { router.replace('/login'); return; }
    Promise.all([
      apiRequest<{ data: MeData }>('/me/').then((r) => { setMe(r.data); setFirstName(r.data.first_name); setLastName(r.data.last_name); }),
      apiRequest<{ data: ChildProfile[] }>('/children/').then((r) => setChildren(r.data)),
    ]).catch(() => router.replace('/login')).finally(() => setLoading(false));
  }, [router]);

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const r = await apiRequest<{ data: MeData }>('/me/', { method: 'PATCH', body: JSON.stringify({ first_name: firstName, last_name: lastName }) });
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
      const r = await apiRequest<{ data: ChildProfile }>('/children/', { method: 'POST', body: JSON.stringify({ display_name: newChildName.trim(), age_band: newChildAge }) });
      setChildren((prev) => [...prev, r.data]);
      setNewChildName(''); setShowAddChild(false);
    } finally {
      setAddingChild(false);
    }
  }

  async function removeChild(id: string) {
    await apiRequest(`/children/${id}/`, { method: 'DELETE' }).catch(() => {});
    setChildren((prev) => prev.filter((c) => c.id !== id));
  }

  if (loading) return (
    <div className="h-screen w-screen flex items-center justify-center bg-[#fff9ee]">
      <RefreshCw className="w-10 h-10 text-[#2d5016] animate-spin" />
    </div>
  );

  return (
    <>
      <Sidebar me={me} />
      <header className="flex items-center w-full px-8 h-16 ml-64 sticky top-0 z-40 bg-[#fff9ee]/80 backdrop-blur-xl shadow-sm border-b border-[#c3c9b9]/20">
        <div className="font-headline text-xl font-bold text-[#173901]">Settings</div>
      </header>
      <main className="ml-64 p-8 min-h-screen bg-[#f9f3e9] font-body text-[#1d1b16]">
        <div className="mb-8">
          <h2 className="font-headline text-4xl text-[#173901] font-bold mb-2">Account Settings</h2>
          <p className="text-stone-500">Manage your profile and child profiles</p>
        </div>

        <div className="max-w-2xl space-y-8">
          <div className="bg-white rounded-2xl p-8 shadow-sm border border-[#c3c9b9]/10">
            <h3 className="font-headline text-xl font-bold text-[#173901] mb-6">Profile</h3>
            <form onSubmit={saveProfile} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-[#43493d] mb-2">First Name</label>
                  <input value={firstName} onChange={(e) => setFirstName(e.target.value)}
                    className="w-full px-4 py-3 rounded-xl border border-[#c3c9b9] bg-white text-[#1d1b16] text-sm focus:outline-none focus:ring-2 focus:ring-[#2d5016]" />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-[#43493d] mb-2">Last Name</label>
                  <input value={lastName} onChange={(e) => setLastName(e.target.value)}
                    className="w-full px-4 py-3 rounded-xl border border-[#c3c9b9] bg-white text-[#1d1b16] text-sm focus:outline-none focus:ring-2 focus:ring-[#2d5016]" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-[#43493d] mb-2">Username</label>
                <input value={me?.username ?? ''} disabled
                  className="w-full px-4 py-3 rounded-xl border border-[#c3c9b9] bg-stone-50 text-stone-400 text-sm cursor-not-allowed" />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-[#43493d] mb-2">Email</label>
                <input value={me?.email ?? ''} disabled
                  className="w-full px-4 py-3 rounded-xl border border-[#c3c9b9] bg-stone-50 text-stone-400 text-sm cursor-not-allowed" />
              </div>
              <div className="flex items-center gap-4 pt-2">
                <button type="submit" disabled={saving}
                  className="px-6 py-3 bg-[#173901] text-white font-bold text-sm rounded-xl hover:bg-[#2d5016] transition-all disabled:opacity-60 flex items-center gap-2">
                  {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  {saving ? 'Saving…' : 'Save Changes'}
                </button>
                {saved && (
                  <span className="text-emerald-600 text-sm font-medium flex items-center gap-1">
                    <CheckCircle className="w-4 h-4" /> Saved!
                  </span>
                )}
              </div>
            </form>
          </div>

          <div className="bg-white rounded-2xl p-8 shadow-sm border border-[#c3c9b9]/10">
            <div className="flex justify-between items-center mb-6">
              <h3 className="font-headline text-xl font-bold text-[#173901]">Child Profiles</h3>
              <button onClick={() => setShowAddChild(true)}
                className="flex items-center gap-2 px-4 py-2 bg-[#173901] text-white text-sm font-bold rounded-xl hover:bg-[#2d5016] transition-all">
                <Plus className="w-4 h-4" /> Add Child
              </button>
            </div>

            {children.length === 0 && !showAddChild && (
              <div className="text-center py-8 text-stone-400">
                <Baby className="w-8 h-8 mx-auto mb-2" />
                <p className="text-sm">No child profiles yet</p>
              </div>
            )}

            <div className="space-y-3">
              {children.map((child) => (
                <div key={child.id} className="flex items-center justify-between p-4 rounded-xl bg-[#f9f3e9] border border-[#c3c9b9]/20">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-[#feae2c] flex items-center justify-center text-[#2d5016] font-bold text-sm">
                      {child.display_name[0].toUpperCase()}
                    </div>
                    <div>
                      <p className="font-semibold text-[#1d1b16] text-sm">{child.display_name}</p>
                      <p className="text-xs text-stone-400">Ages {child.age_band}</p>
                    </div>
                  </div>
                  <button onClick={() => removeChild(child.id)} className="text-stone-300 hover:text-red-400 transition-colors">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>

            {showAddChild && (
              <form onSubmit={addChild} className="mt-4 p-4 rounded-xl border-2 border-dashed border-[#a8d38a] bg-[#f0f7e8] space-y-3">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-[#43493d] mb-2">Child&apos;s Name</label>
                  <input value={newChildName} onChange={(e) => setNewChildName(e.target.value)} placeholder="e.g. Lily"
                    className="w-full px-4 py-3 rounded-xl border border-[#c3c9b9] bg-white text-[#1d1b16] text-sm focus:outline-none focus:ring-2 focus:ring-[#2d5016]" />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-[#43493d] mb-2">Age Band</label>
                  <select value={newChildAge} onChange={(e) => setNewChildAge(e.target.value)}
                    className="w-full px-4 py-3 rounded-xl border border-[#c3c9b9] bg-white text-[#1d1b16] text-sm focus:outline-none focus:ring-2 focus:ring-[#2d5016]">
                    {AGE_BANDS.map((a) => <option key={a} value={a}>{a} years</option>)}
                  </select>
                </div>
                <div className="flex gap-3">
                  <button type="submit" disabled={addingChild || !newChildName.trim()}
                    className="px-5 py-2 bg-[#173901] text-white font-bold text-sm rounded-xl hover:bg-[#2d5016] transition-all disabled:opacity-60">
                    {addingChild ? 'Adding…' : 'Add'}
                  </button>
                  <button type="button" onClick={() => { setShowAddChild(false); setNewChildName(''); }}
                    className="px-5 py-2 bg-white text-stone-500 font-bold text-sm rounded-xl border border-[#c3c9b9] hover:bg-stone-50 transition-all">
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </div>

          <div className="bg-white rounded-2xl p-8 shadow-sm border border-red-100">
            <h3 className="font-headline text-xl font-bold text-red-700 mb-4">Sign Out</h3>
            <p className="text-stone-500 text-sm mb-4">Sign out of your Bailey &amp; Beau account on this device.</p>
            <button onClick={() => { localStorage.removeItem('bb_access_token'); localStorage.removeItem('bb_refresh_token'); window.location.href = '/login'; }}
              className="px-6 py-3 bg-red-50 text-red-700 font-bold text-sm rounded-xl hover:bg-red-100 border border-red-200 transition-all flex items-center gap-2">
              <LogOut className="w-4 h-4" /> Sign Out
            </button>
          </div>
        </div>
      </main>
    </>
  );
}

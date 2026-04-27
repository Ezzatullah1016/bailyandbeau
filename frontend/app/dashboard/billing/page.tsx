'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CreditCard, RefreshCw } from 'lucide-react';
import { apiRequest } from '@/lib/api';
import { Sidebar } from '@/components/dashboard/Sidebar';
import { usePathname } from 'next/navigation';

interface Plan { code: string; name: string; price_monthly: number; sessions_per_month: number; description: string; }
interface Entitlement {
  subscription_status: string;
  plan_code: string;
  sessions_remaining: number;
  pack_sessions_remaining: number;
  renewal_date: string | null;
}
interface MeData { id: number; username: string; first_name: string; last_name: string; }

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-emerald-100 text-emerald-800',
  inactive: 'bg-stone-100 text-stone-600',
  trialing: 'bg-blue-100 text-blue-700',
  past_due: 'bg-red-100 text-red-700',
};


export default function BillingPage() {
  const router = useRouter();
  const pathname = usePathname();
  const [me, setMe] = useState<MeData | null>(null);
  const [entitlement, setEntitlement] = useState<Entitlement | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('bb_access_token');
    if (!token) { router.replace('/login'); return; }
    Promise.all([
      apiRequest<{ data: MeData }>('/me/').then((r) => setMe(r.data)),
      apiRequest<{ data: Entitlement }>('/billing/entitlement/').then((r) => setEntitlement(r.data)),
      apiRequest<{ data: Plan[] }>('/billing/plans/').then((r) => setPlans(r.data)).catch(() => {}),
    ]).catch(() => router.replace('/login')).finally(() => setLoading(false));
  }, [router]);

  const totalSessions = (entitlement?.sessions_remaining ?? 0) + (entitlement?.pack_sessions_remaining ?? 0);

  if (loading) return (
    <div className="h-screen w-screen flex items-center justify-center bg-[#f0f9f0]">
      <RefreshCw className="w-10 h-10 text-[#2d5016] animate-spin" />
    </div>
  );

  return (
    <>
      <Sidebar me={me} currentPath={pathname} />
      <header className="flex items-center w-full px-8 h-16 ml-64 sticky top-0 z-40 bg-[#f0f9f0]/80 backdrop-blur-xl shadow-sm border-b border-[#2d5016]/10">
        <div className="font-headline text-xl font-bold text-[#173901]">Billing</div>
      </header>
      <main className="ml-64 p-8 min-h-screen bg-[#f7faf6] font-body text-[#1d1b16]">
        <div className="mb-8">
          <h2 className="font-headline text-4xl text-[#173901] font-bold mb-2">Billing &amp; Subscription</h2>
          <p className="text-stone-500">Manage your plan and session credits</p>
        </div>

        <div className="bg-white rounded-2xl p-8 shadow-sm border border-[#c3c9b9]/10 mb-8">
          <div className="flex items-start justify-between mb-6">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-stone-400 mb-2">Current Plan</p>
              <h3 className="font-headline text-3xl font-bold text-[#173901] capitalize">
                {entitlement?.plan_code?.replace(/-/g, ' ') ?? 'Free'}
              </h3>
            </div>
            {entitlement?.subscription_status && (
              <span className={`px-3 py-1 rounded-full text-xs font-bold capitalize ${STATUS_COLORS[entitlement.subscription_status] ?? 'bg-stone-100 text-stone-600'}`}>
                {entitlement.subscription_status}
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-6">
            <div className="bg-[#f0f9f0] rounded-xl p-5">
              <p className="text-xs font-bold uppercase tracking-wider text-stone-400 mb-2">Sessions Remaining</p>
              <p className="font-headline text-4xl font-bold text-[#173901]">{totalSessions}</p>
              {(entitlement?.pack_sessions_remaining ?? 0) > 0 && (
                <p className="text-xs text-stone-400 mt-1">incl. {entitlement?.pack_sessions_remaining} pack credits</p>
              )}
            </div>
            <div className="bg-[#f0f9f0] rounded-xl p-5">
              <p className="text-xs font-bold uppercase tracking-wider text-stone-400 mb-2">Subscription Sessions</p>
              <p className="font-headline text-4xl font-bold text-[#835500]">{entitlement?.sessions_remaining ?? 0}</p>
            </div>
            <div className="bg-[#f0f9f0] rounded-xl p-5">
              <p className="text-xs font-bold uppercase tracking-wider text-stone-400 mb-2">Renewal Date</p>
              <p className="font-headline text-xl font-bold text-[#173901]">
                {entitlement?.renewal_date ? new Date(entitlement.renewal_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
              </p>
            </div>
          </div>
        </div>

        {plans.length > 0 && (
          <div>
            <h3 className="font-headline text-2xl text-[#173901] font-bold mb-6">Available Plans</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {plans.map((plan) => {
                const isCurrent = plan.code === entitlement?.plan_code;
                return (
                  <div key={plan.code} className={`bg-white rounded-2xl p-6 shadow-sm border-2 transition-all ${isCurrent ? 'border-[#2d5016]' : 'border-[#c3c9b9]/10 hover:border-[#a8d38a]'}`}>
                    {isCurrent && (
                      <span className="inline-block px-3 py-0.5 bg-[#2d5016] text-white text-[10px] font-bold rounded-full uppercase tracking-wider mb-4">Current Plan</span>
                    )}
                    <h4 className="font-headline text-xl font-bold text-[#173901] mb-1">{plan.name}</h4>
                    <p className="text-stone-400 text-sm mb-4">{plan.description}</p>
                    <p className="font-headline text-3xl font-bold text-[#173901] mb-1">
                      £{plan.price_monthly}<span className="text-base font-normal text-stone-400">/mo</span>
                    </p>
                    <p className="text-sm text-stone-500 mb-6">{plan.sessions_per_month} sessions per month</p>
                    <button
                      disabled={isCurrent}
                      className={`w-full py-3 rounded-xl font-bold text-sm transition-all ${isCurrent ? 'bg-stone-100 text-stone-400 cursor-not-allowed' : 'bg-[#173901] text-white hover:bg-[#2d5016]'}`}>
                      {isCurrent ? 'Current Plan' : 'Upgrade'}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {plans.length === 0 && (
          <div className="bg-white rounded-2xl p-8 shadow-sm border border-[#c3c9b9]/10 text-center">
            <CreditCard className="w-10 h-10 text-stone-300 mx-auto mb-4" />
            <p className="text-stone-500 font-medium">Subscription plans coming soon.</p>
            <p className="text-stone-400 text-sm mt-1">Contact us to upgrade your account.</p>
          </div>
        )}
      </main>
    </>
  );
}

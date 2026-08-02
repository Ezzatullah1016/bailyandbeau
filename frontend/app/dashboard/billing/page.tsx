'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CreditCard, RefreshCw } from 'lucide-react';
import { apiRequest } from '@/lib/api';
import { Sidebar } from '@/components/dashboard/Sidebar';
import { usePathname } from 'next/navigation';

interface Plan { code: string; name: string; price_gbp: string; interval: string; sessions_included: number; }
interface Entitlement {
  subscription_status: string;
  plan_code: string;
  sessions_remaining: number;
  pack_sessions_remaining: number | null;
  renewal_date: string | null;
}
interface MeData { id: number; username: string; first_name: string; last_name: string; is_staff?: boolean; }

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
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  async function handleUpgrade(planCode: string) {
    setCheckoutLoading(planCode);
    setCheckoutError(null);
    try {
      const res = await apiRequest<{ data: { checkout_url: string } }>('/billing/checkout-session/', {
        method: 'POST',
        body: JSON.stringify({ plan_code: planCode }),
      });
      window.location.href = res.data.checkout_url;
    } catch {
      setCheckoutError('Failed to start checkout. Please try again.');
      setCheckoutLoading(null);
    }
  }

  if (loading) return (
    <div className="h-screen w-screen flex items-center justify-center bg-[#faf7f6]">
      <RefreshCw className="w-10 h-10 text-[#764f84] animate-spin" />
    </div>
  );

  return (
    <>
      <Sidebar me={me} currentPath={pathname} />
      <div className="ml-0 md:ml-64 flex-1 min-w-0 overflow-x-hidden flex flex-col">
      <header className="flex items-center w-full pl-16 pr-8 md:px-8 h-16 sticky top-0 z-40 bg-[#faf7f6]/80 backdrop-blur-xl shadow-sm border-b border-[#3d3b62]/10">
        <div className="font-baloo text-xl font-bold text-[#3d3b62]">Billing</div>
      </header>
      <main className="p-8 min-h-screen bg-[#faf7f6] font-karla text-[#1d1b16]">
        <div className="mb-8">
          <h2 className="font-baloo text-4xl text-[#3d3b62] font-bold mb-2">Billing &amp; Subscription</h2>
          <p className="text-stone-500">Manage your plan and session credits</p>
        </div>

        <div className="bg-white rounded-2xl p-8 shadow-sm border border-[#eccdca] mb-8">
          <div className="flex items-start justify-between mb-6">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-stone-400 mb-2">Current Plan</p>
              <h3 className="font-baloo text-3xl font-bold text-[#3d3b62] capitalize">
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
            <div className="bg-[#faf7f6] rounded-xl p-5">
              <p className="text-xs font-bold uppercase tracking-wider text-stone-400 mb-2">Sessions Remaining</p>
              <p className="font-baloo text-4xl font-bold text-[#3d3b62]">{totalSessions}</p>
              {(entitlement?.pack_sessions_remaining ?? 0) > 0 && (
                <p className="text-xs text-stone-400 mt-1">incl. {entitlement?.pack_sessions_remaining} pack credits</p>
              )}
            </div>
            <div className="bg-[#faf7f6] rounded-xl p-5">
              <p className="text-xs font-bold uppercase tracking-wider text-stone-400 mb-2">Subscription Sessions</p>
              <p className="font-baloo text-4xl font-bold text-[#c84a71]">{entitlement?.sessions_remaining ?? 0}</p>
            </div>
            <div className="bg-[#faf7f6] rounded-xl p-5">
              <p className="text-xs font-bold uppercase tracking-wider text-stone-400 mb-2">Renewal Date</p>
              <p className="font-baloo text-xl font-bold text-[#3d3b62]">
                {entitlement?.renewal_date ? new Date(entitlement.renewal_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
              </p>
            </div>
          </div>
        </div>

        {plans.length > 0 && (
          <div>
            <h3 className="font-baloo text-2xl text-[#3d3b62] font-bold mb-6">Available Plans</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {plans.map((plan) => {
                const isCurrent = plan.code === entitlement?.plan_code;
                return (
                  <div key={plan.code} className={`bg-white rounded-2xl p-6 shadow-sm border-2 transition-all ${isCurrent ? 'border-[#3d3b62]' : 'border-[#eccdca] hover:border-[#764f84]'}`}>
                    {isCurrent && (
                      <span className="inline-block px-3 py-0.5 bg-[#3d3b62] text-white text-[10px] font-bold rounded-full uppercase tracking-wider mb-4">Current Plan</span>
                    )}
                    <h4 className="font-baloo text-xl font-bold text-[#3d3b62] mb-1">{plan.name}</h4>
                    <p className="text-stone-400 text-sm mb-4">
                      {plan.interval === 'one_off' ? 'One-off session pack' : 'Monthly subscription'}
                    </p>
                    <p className="font-baloo text-3xl font-bold text-[#3d3b62] mb-1">
                      £{plan.price_gbp}
                      <span className="text-base font-normal text-stone-400">
                        {plan.interval === 'one_off' ? ' one-off' : '/mo'}
                      </span>
                    </p>
                    <p className="text-sm text-stone-500 mb-6">
                      {plan.sessions_included} sessions{plan.interval === 'one_off' ? '' : ' per month'}
                    </p>
                    <button
                      disabled={isCurrent || checkoutLoading === plan.code}
                      onClick={() => !isCurrent && handleUpgrade(plan.code)}
                      className={`font-baloo w-full py-3 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 ${isCurrent ? 'bg-stone-100 text-stone-400 cursor-not-allowed' : 'bg-[#3d3b62] text-white hover:bg-[#764f84] active:scale-95'}`}>
                      {checkoutLoading === plan.code ? (
                        <><RefreshCw className="w-4 h-4 animate-spin" /> Loading...</>
                      ) : isCurrent ? 'Current Plan' : 'Upgrade'}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {checkoutError && (
          <div className="mt-4 p-4 bg-red-50 border border-red-200 text-red-700 rounded-xl text-sm">
            {checkoutError}
          </div>
        )}

        {plans.length === 0 && (
          <div className="bg-white rounded-2xl p-8 shadow-sm border border-[#eccdca] text-center">
            <CreditCard className="w-10 h-10 text-stone-300 mx-auto mb-4" />
            <p className="text-stone-500 font-medium">Subscription plans coming soon.</p>
            <p className="text-stone-400 text-sm mt-1">Contact us to upgrade your account.</p>
          </div>
        )}
      </main>
      </div>
    </>
  );
}

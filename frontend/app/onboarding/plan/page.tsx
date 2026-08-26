'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, CheckCircle } from 'lucide-react';
import { apiRequest } from '@/lib/api';

interface BillingPlan {
  code: string; name: string; price_gbp: string;
  interval: string; sessions_included: number;
}

const PLAN_FEATURES: Record<string, string[]> = {
  'monthly-starter': [
    '8 reading sessions / month', 'Full book library access',
    'Shared annotation canvas', 'Session timer & badges', 'Guest invite link',
  ],
  'monthly-plus': [
    '20 reading sessions / month', 'Everything in Starter',
    'Priority support', 'Session recordings (coming soon)', 'Multiple child profiles',
  ],
  'session-pack-5': [
    '5 sessions, never expire', 'Full book library access',
    'Shared annotation canvas', 'Session timer & badges', 'Guest invite link',
  ],
};

const PLAN_BADGE: Record<string, { label: string; color: string }> = {
  'monthly-starter': { label: 'Popular',    color: 'bg-[#764f84] text-white' },
  'monthly-plus':    { label: 'Best Value', color: 'bg-[#c84a71] text-white' },
  'session-pack-5':  { label: 'Flexible',   color: 'bg-[#3b85a6] text-white' },
};

export default function ChoosePlanPage() {
  const router = useRouter();
  const [plans, setPlans] = useState<BillingPlan[]>([]);
  const [selected, setSelected] = useState<string>('monthly-starter');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    apiRequest<{ data: BillingPlan[] }>('/billing/plans/')
      .then((res) => setPlans(res.data))
      .catch(() => {});
  }, []);

  async function handleContinue() {
    setError('');
    setLoading(true);
    try {
      const res = await apiRequest<{ data: { checkout_url: string } }>('/billing/checkout-session/', {
        method: 'POST',
        body: JSON.stringify({ plan_code: selected }),
      });
      window.location.href = res.data.checkout_url;
    } catch (err) {
      /*
       * This used to string-match the error for 'stripe' / '500' / 'not
       * configured' and, on a match, push straight to the next onboarding step —
       * so a payment failure looked exactly like a payment success, and someone
       * arrived in the app believing they had subscribed. A failed checkout is a
       * failure: say so and stay put.
       */
      setError(err instanceof Error ? err.message : 'Could not start checkout.');
    } finally {
      setLoading(false);
    }
  }

  const intervalLabel = (interval: string) =>
    interval === 'one_off' ? 'one-off' : `/${interval}`;

  return (
    <main className="min-h-screen flex flex-col items-center bg-[#faf7f6]">
      <header className="flex justify-center items-center w-full py-8 px-4">
        <div className="font-baloo text-2xl font-bold text-[#3d3b62] tracking-tight">Bailey &amp; Beau</div>
      </header>

      <div className="flex-grow flex items-center justify-center w-full px-4 pb-12">
        <div className="max-w-[860px] w-full bg-white rounded-2xl p-10 md:p-12 shadow-[0_40px_60px_-15px_rgba(61,59,98,0.08)] border border-[#eccdca]">
          <div className="text-center mb-12">
            <h2 className="font-baloo text-5xl md:text-6xl text-[#3d3b62] mb-4 font-bold">
              Choose Your Plan
            </h2>
            <p className="font-karla text-stone-500 text-lg">You can change or cancel at any time.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
            {plans.map((plan) => {
              const isSelected = selected === plan.code;
              const badge = PLAN_BADGE[plan.code];
              const features = PLAN_FEATURES[plan.code] ?? [];
              const isFeatured = plan.code === 'monthly-plus';

              return (
                <button
                  key={plan.code}
                  onClick={() => setSelected(plan.code)}
                  className={`relative flex flex-col p-6 rounded-xl text-left transition-all duration-300 focus:outline-none ${
                    isSelected
                      ? 'border-2 border-[#764f84] bg-white shadow-[0_20px_40px_rgba(118,79,132,0.12)]'
                      : 'border border-[#eccdca] bg-[#faf7f6] hover:bg-white'
                  } ${isFeatured && !isSelected ? 'md:scale-[1.02]' : ''}`}
                >
                  {badge && (
                    <div className="absolute -top-3 right-4">
                      <span className={`inline-block px-3 py-1 text-[10px] font-bold uppercase tracking-widest rounded-full shadow-sm ${badge.color}`}>
                        {badge.label}
                      </span>
                    </div>
                  )}

                  <div className={`absolute top-4 right-4 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${
                    isSelected ? 'border-[#764f84] bg-[#764f84]' : 'border-[#eccdca]'
                  }`}>
                    {isSelected && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
                  </div>

                  <div className="mb-4 pt-1">
                    <h3 className="font-baloo font-bold text-xl text-[#3d3b62] mb-1">{plan.name}</h3>
                    <div className="flex items-baseline gap-1">
                      <span className="font-baloo text-3xl font-bold text-[#3d3b62]">£{plan.price_gbp}</span>
                      <span className="font-karla text-stone-400 text-sm">{intervalLabel(plan.interval)}</span>
                    </div>
                    <p className="font-karla text-xs text-stone-400 mt-1">{plan.sessions_included} sessions included</p>
                  </div>

                  <ul className="flex-grow space-y-3 mb-6">
                    {features.map((f, fi) => (
                      <li key={fi} className="font-karla flex items-start gap-2.5 text-sm text-[#1c1c19]">
                        <CheckCircle className="w-4 h-4 text-[#764f84] shrink-0 mt-0.5" fill="#764f84" color="white" />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>

                  <div className={`font-baloo text-xs font-semibold text-center py-2 rounded-lg transition-all ${
                    isSelected ? 'bg-[#764f84] text-white' : 'bg-[#faf7f6] text-stone-500'
                  }`}>
                    {isSelected ? 'Selected' : 'Select'}
                  </div>
                </button>
              );
            })}

            {plans.length === 0 && [0, 1, 2].map((i) => (
              <div key={i} className="h-64 rounded-xl bg-[#eccdca]/30 animate-pulse" />
            ))}
          </div>

          {error && <p className="font-karla text-sm text-red-600 font-medium text-center mb-4">{error}</p>}

          <div className="flex flex-col items-center gap-3">
            <button
              type="button"
              onClick={handleContinue}
              disabled={loading || plans.length === 0}
              className="font-baloo w-full max-w-sm py-4 bg-[#c84a71] text-white font-bold rounded-xl hover:bg-[#b43f63] active:scale-[0.98] transition-all shadow-lg shadow-[#c84a71]/20 disabled:opacity-60"
            >
              {loading ? 'Starting checkout…' : 'Continue to Payment'}
            </button>
            <button
              type="button"
              onClick={() => router.push('/onboarding/child')}
              className="font-karla text-sm text-stone-400 hover:text-[#3d3b62] underline underline-offset-4 transition-colors"
            >
              Skip for now — I&apos;ll choose later
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}

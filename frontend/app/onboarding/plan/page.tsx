'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiRequest } from '@/lib/api';

interface BillingPlan {
  code: string;
  name: string;
  price_gbp: string;
  interval: string;
  sessions_included: number;
}

const PLAN_FEATURES: Record<string, string[]> = {
  'monthly-starter': [
    '8 reading sessions / month',
    'Full book library access',
    'Shared annotation canvas',
    'Session timer & badges',
    'Guest invite link',
  ],
  'monthly-plus': [
    '20 reading sessions / month',
    'Everything in Starter',
    'Priority support',
    'Session recordings (coming soon)',
    'Multiple child profiles',
  ],
  'session-pack-5': [
    '5 sessions, never expire',
    'Full book library access',
    'Shared annotation canvas',
    'Session timer & badges',
    'Guest invite link',
  ],
};

const PLAN_BADGE: Record<string, { label: string; color: string }> = {
  'monthly-starter': { label: 'Popular', color: 'bg-[#44664a] text-white' },
  'monthly-plus': { label: 'Best Value', color: 'bg-[#7c572d] text-white' },
  'session-pack-5': { label: 'Flexible', color: 'bg-[#524341] text-white' },
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
      // Redirect to Stripe checkout
      window.location.href = res.data.checkout_url;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not start checkout.';
      // If Stripe not configured, skip to child setup
      if (msg.includes('stripe') || msg.includes('Stripe') || msg.includes('500') || msg.includes('not configured')) {
        router.push('/onboarding/child');
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }

  function handleSkip() {
    router.push('/onboarding/child');
  }

  const intervalLabel = (interval: string) =>
    interval === 'one_off' ? 'one-off' : `/${interval}`;

  return (
    <main className="min-h-screen flex flex-col items-center bg-[#FAF7F2]">
      {/* Header */}
      <header className="flex justify-center items-center w-full py-8 px-4">
        <div className="text-2xl font-serif italic text-[#C4847A] tracking-tight">Bailey &amp; Beau</div>
      </header>

      <div className="flex-grow flex items-center justify-center w-full px-4 pb-12">
        <div className="max-w-[860px] w-full bg-white rounded-2xl p-10 md:p-12 shadow-[0_40px_60px_-15px_rgba(28,28,25,0.05)] border border-[#d7c2bf]/10">
          <div className="text-center mb-12">
            <h2 className="font-serif text-5xl md:text-6xl text-[#865047] mb-4 font-medium italic">
              Choose Your Plan
            </h2>
            <p className="text-[#524341]/70 text-lg">You can change or cancel at any time.</p>
          </div>

          {/* Plan grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
            {plans.map((plan, i) => {
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
                      ? 'border-2 border-[#C4847A] bg-white shadow-[0_20px_40px_rgba(196,132,122,0.1)]'
                      : 'border border-[#E0D5C8] bg-[#fcf9f4] hover:bg-[#f6f3ee]'
                  } ${isFeatured && !isSelected ? 'md:scale-[1.02]' : ''}`}
                >
                  {/* Badge */}
                  {badge && (
                    <div className="absolute -top-3 right-4">
                      <span className={`inline-block px-3 py-1 text-[10px] font-bold uppercase tracking-widest rounded-full shadow-sm ${badge.color}`}>
                        {badge.label}
                      </span>
                    </div>
                  )}

                  {/* Selection ring */}
                  <div className={`absolute top-4 right-4 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${
                    isSelected ? 'border-[#C4847A] bg-[#C4847A]' : 'border-[#d7c2bf]'
                  }`}>
                    {isSelected && <span className="material-symbols-outlined text-white text-sm" style={{ fontVariationSettings: "'FILL' 1", fontSize: 14 }}>check</span>}
                  </div>

                  <div className="mb-4 pt-1">
                    <h3 className="font-bold text-xl text-[#1c1c19] mb-1">{plan.name}</h3>
                    <div className="flex items-baseline gap-1">
                      <span className="text-3xl font-bold text-[#1c1c19]">£{plan.price_gbp}</span>
                      <span className="text-[#524341]/60 text-sm">{intervalLabel(plan.interval)}</span>
                    </div>
                    <p className="text-xs text-[#847370] mt-1">{plan.sessions_included} sessions included</p>
                  </div>

                  <ul className="flex-grow space-y-3 mb-6">
                    {features.map((f, fi) => (
                      <li key={fi} className="flex items-start gap-2.5 text-sm text-[#1c1c19]">
                        <span className="material-symbols-outlined text-[#44664a] text-base shrink-0" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>

                  {/* Order indicator */}
                  <div className={`text-xs font-semibold text-center py-2 rounded-lg transition-all ${
                    isSelected ? 'bg-[#C4847A] text-white' : 'bg-[#f0ede9] text-[#524341]'
                  }`}>
                    {isSelected ? 'Selected' : 'Select'}
                  </div>
                </button>
              );
            })}

            {/* Loading skeleton */}
            {plans.length === 0 && [0, 1, 2].map((i) => (
              <div key={i} className="h-64 rounded-xl bg-[#f0ede9] animate-pulse" />
            ))}
          </div>

          {error && <p className="text-sm text-red-600 font-medium text-center mb-4">{error}</p>}

          <div className="flex flex-col items-center gap-3">
            <button
              onClick={handleContinue}
              disabled={loading || plans.length === 0}
              className="w-full max-w-sm py-4 bg-[#C4847A] text-white font-semibold rounded-lg hover:brightness-105 active:scale-[0.98] transition-all shadow-lg shadow-[#C4847A]/20 disabled:opacity-60"
            >
              {loading ? 'Starting checkout…' : 'Continue to Payment'}
            </button>
            <button
              onClick={handleSkip}
              className="text-sm text-[#847370] hover:text-[#524341] underline underline-offset-4 transition-colors"
            >
              Skip for now — I&apos;ll choose later
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}

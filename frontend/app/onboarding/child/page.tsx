'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown } from 'lucide-react';
import { apiRequest } from '@/lib/api';

const AGE_BANDS = [
  { value: '3-5', label: '3–5 years' },
  { value: '6-8', label: '6–8 years' },
  { value: '9-12', label: '9–12 years' },
];

export default function ChildSetupPage() {
  const router = useRouter();
  const [childName, setChildName] = useState('');
  const [ageBand, setAgeBand] = useState('3-5');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await apiRequest('/children/', {
        method: 'POST',
        body: JSON.stringify({ display_name: childName.trim(), age_band: ageBand }),
      });
      router.push('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save child profile.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen flex flex-col bg-[#faf7f6]">
      <div className="fixed top-0 left-0 w-full h-full -z-10 pointer-events-none opacity-50 overflow-hidden">
        <div className="absolute -top-24 -left-24 w-[500px] h-[500px] rounded-full bg-[#764f84]/5 blur-[120px]" />
        <div className="absolute bottom-0 right-0 w-[400px] h-[400px] rounded-full bg-[#3d3b62]/5 blur-[100px]" />
      </div>

      <div className="flex-grow flex flex-col items-center justify-center p-6 md:p-12">
        <div className="w-full max-w-[480px] bg-white rounded-2xl p-10 shadow-[0_20px_50px_rgba(61,59,98,0.08)] relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-[#3d3b62] via-[#764f84] to-[#c84a71]" />

          <div className="flex flex-col items-center mb-8">
            <span className="font-baloo text-2xl font-bold text-[#3d3b62] tracking-tight">Bailey &amp; Beau</span>
          </div>

          <div className="text-center mb-10">
            <h2 className="font-baloo text-3xl md:text-4xl text-[#3d3b62] font-bold mb-3 leading-tight">
              Tell Us About Your Child
            </h2>
            <p className="font-karla text-stone-500 text-sm tracking-wide">
              We&apos;ll personalise their reading experience.
            </p>
          </div>

          <form className="space-y-8" onSubmit={handleSubmit}>
            <div className="space-y-6">
              <div className="space-y-2">
                <label className="font-karla block text-[13px] font-semibold text-[#3d3b62] uppercase tracking-wider pl-1">
                  Child&apos;s First Name
                </label>
                <input
                  className="font-karla w-full h-14 bg-[#faf7f6] border border-[#eccdca] rounded-xl px-5 text-[#1c1c19] placeholder:text-stone-400 focus:ring-2 focus:ring-[#3b85a6] focus:border-[#3b85a6] focus:bg-white transition-all duration-300 outline-none"
                  placeholder="Enter their name"
                  value={childName}
                  onChange={(e) => setChildName(e.target.value)}
                  required
                  autoFocus
                />
              </div>

              <div className="space-y-2">
                <label className="font-karla block text-[13px] font-semibold text-[#3d3b62] uppercase tracking-wider pl-1">
                  Age Range
                </label>
                <div className="relative">
                  <select
                    className="font-karla appearance-none w-full h-14 bg-[#faf7f6] border border-[#eccdca] rounded-xl px-5 text-[#1c1c19] focus:ring-2 focus:ring-[#3b85a6] focus:border-[#3b85a6] focus:bg-white transition-all duration-300 cursor-pointer outline-none"
                    value={ageBand}
                    onChange={(e) => setAgeBand(e.target.value)}
                  >
                    {AGE_BANDS.map((b) => (
                      <option key={b.value} value={b.value}>{b.label}</option>
                    ))}
                  </select>
                  <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-stone-400">
                    <ChevronDown className="w-5 h-5" />
                  </div>
                </div>
              </div>
            </div>

            {error && <p className="text-sm text-red-600 font-medium text-center">{error}</p>}

            <button
              type="submit"
              disabled={loading}
              className="font-baloo w-full h-14 bg-[#c84a71] text-white rounded-xl font-bold text-lg shadow-lg shadow-[#c84a71]/20 hover:bg-[#b43f63] transition-all duration-300 active:scale-[0.98] disabled:opacity-60"
            >
              {loading ? 'Saving…' : 'Continue to Dashboard'}
            </button>

            <div className="flex justify-center items-center gap-3 pt-2">
              <div className="w-2.5 h-2.5 rounded-full bg-[#eccdca]" />
              <div className="w-2.5 h-2.5 rounded-full bg-[#764f84] ring-4 ring-[#764f84]/10" />
            </div>
          </form>
        </div>

        <p className="font-karla mt-12 text-xs uppercase tracking-[0.2em] text-stone-400">
          © 2024 Bailey &amp; Beau. Crafted for digital stories.
        </p>
      </div>
    </main>
  );
}

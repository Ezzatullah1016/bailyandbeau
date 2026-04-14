'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiRequest } from '@/lib/api';

const AVATARS = [
  { emoji: '🐻', bg: '#E8F0E9', label: 'Bear' },
  { emoji: '🦊', bg: '#FCECEB', label: 'Fox' },
  { emoji: '🐧', bg: '#F5EFE6', label: 'Penguin' },
  { emoji: '🦋', bg: '#FEF9ED', label: 'Butterfly' },
  { emoji: '🐳', bg: '#E8F0F5', label: 'Whale' },
  { emoji: '🦁', bg: '#FEF3E8', label: 'Lion' },
  { emoji: '🦄', bg: '#F5EBF5', label: 'Unicorn' },
  { emoji: '🐢', bg: '#EAF3E8', label: 'Turtle' },
];

const AGE_BANDS = [
  { value: '3-5', label: '3–5 years' },
  { value: '6-8', label: '6–8 years' },
  { value: '9-12', label: '9–12 years' },
];

export default function ChildSetupPage() {
  const router = useRouter();
  const [childName, setChildName] = useState('');
  const [ageBand, setAgeBand] = useState('3-5');
  const [avatar, setAvatar] = useState(1); // index
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
    <main className="min-h-screen flex flex-col selection:bg-[#ffdad4]/30 bg-[#FAF7F2]">
      {/* Background blobs */}
      <div className="fixed top-0 left-0 w-full h-full -z-10 pointer-events-none opacity-50 overflow-hidden">
        <div className="absolute -top-24 -left-24 w-[500px] h-[500px] rounded-full bg-[#865047]/5 blur-[120px]" />
        <div className="absolute bottom-0 right-0 w-[400px] h-[400px] rounded-full bg-[#44664a]/5 blur-[100px]" />
      </div>

      <div className="flex-grow flex flex-col items-center justify-center p-6 md:p-12">
        <div className="w-full max-w-[480px] bg-white rounded-2xl p-10 shadow-[0_20px_50px_rgba(28,28,25,0.04)] relative overflow-hidden">
          {/* Top accent bar */}
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-[#865047]/20 via-[#865047] to-[#865047]/20 opacity-30" />

          {/* Logo */}
          <div className="flex flex-col items-center mb-8">
            <span className="text-2xl font-serif italic text-[#C4847A] tracking-tight">Bailey &amp; Beau</span>
          </div>

          {/* Header */}
          <div className="text-center mb-10">
            <h2 className="text-3xl md:text-4xl font-headline italic text-[#1c1c19] mb-3 leading-tight">
              Tell Us About Your Child
            </h2>
            <p className="text-[#524341] text-sm tracking-wide">
              We&apos;ll personalise their reading experience.
            </p>
          </div>

          <form className="space-y-8" onSubmit={handleSubmit}>
            <div className="space-y-6">
              {/* Child name */}
              <div className="space-y-2">
                <label className="block text-[13px] font-semibold text-[#524341] uppercase tracking-wider pl-1">
                  Child&apos;s First Name
                </label>
                <input
                  className="w-full h-14 bg-[#f6f3ee] border-none rounded-xl px-5 text-[#1c1c19] placeholder:text-[#524341]/40 focus:ring-2 focus:ring-[#865047]/20 focus:bg-white transition-all duration-300 outline-none"
                  placeholder="Enter their name"
                  value={childName}
                  onChange={(e) => setChildName(e.target.value)}
                  required
                  autoFocus
                />
              </div>

              {/* Age band */}
              <div className="space-y-2">
                <label className="block text-[13px] font-semibold text-[#524341] uppercase tracking-wider pl-1">
                  Age Range
                </label>
                <div className="relative">
                  <select
                    className="appearance-none w-full h-14 bg-[#f6f3ee] border-none rounded-xl px-5 text-[#1c1c19] focus:ring-2 focus:ring-[#865047]/20 focus:bg-white transition-all duration-300 cursor-pointer outline-none"
                    value={ageBand}
                    onChange={(e) => setAgeBand(e.target.value)}
                  >
                    {AGE_BANDS.map((b) => (
                      <option key={b.value} value={b.value}>{b.label}</option>
                    ))}
                  </select>
                  <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-[#524341]/60">
                    <span className="material-symbols-outlined">expand_more</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Avatar selection */}
            <div className="space-y-4">
              <label className="block text-[13px] font-semibold text-[#524341] uppercase tracking-wider pl-1 text-center">
                Pick an Avatar
              </label>
              <div className="grid grid-cols-4 gap-4 justify-items-center max-w-[360px] mx-auto">
                {AVATARS.map((av, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setAvatar(i)}
                    aria-label={av.label}
                    className="group relative outline-none"
                  >
                    <div
                      className={`w-16 h-16 md:w-20 md:h-20 rounded-full flex items-center justify-center text-3xl shadow-sm transition-all duration-300 group-hover:scale-105 border-4 ${
                        avatar === i
                          ? 'border-[#44664a] ring-2 ring-[#44664a]/20 scale-105'
                          : 'border-transparent ring-2 ring-transparent'
                      }`}
                      style={{ backgroundColor: av.bg }}
                    >
                      {av.emoji}
                    </div>
                    {avatar === i && (
                      <div className="absolute -top-1 -right-1 bg-[#44664a] text-white rounded-full p-0.5 shadow-md">
                        <span className="material-symbols-outlined text-[14px] font-bold" style={{ fontVariationSettings: "'FILL' 1" }}>check</span>
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {error && <p className="text-sm text-red-600 font-medium text-center">{error}</p>}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="w-full h-14 bg-[#C4847A] text-white rounded-lg font-medium text-lg shadow-lg shadow-[#865047]/10 hover:bg-[#865047] transition-all duration-300 active:scale-[0.98] disabled:opacity-60"
            >
              {loading ? 'Saving…' : 'Continue to Dashboard'}
            </button>

            {/* Step dots — step 2 of 2 */}
            <div className="flex justify-center items-center gap-3 pt-2">
              <div className="w-2.5 h-2.5 rounded-full bg-[#865047]/20" />
              <div className="w-2.5 h-2.5 rounded-full bg-[#865047] ring-4 ring-[#865047]/10" />
            </div>
          </form>
        </div>

        <p className="mt-12 text-xs uppercase tracking-[0.2em] text-[#524341]/40 font-body">
          © 2024 Bailey &amp; Beau. Crafted for digital stories.
        </p>
      </div>
    </main>
  );
}

'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff } from 'lucide-react';
import { apiRequest, storeTokens } from '@/lib/api';

type AuthResponse = {
  data: {
    tokens: { access: string; refresh: string };
    user: { id: string; username: string; email: string };
  };
  error?: { message?: string } | null;
};

export default function LoginPage() {
  const router = useRouter();
  const [tab, setTab] = useState<'login' | 'register'>('login');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const [loginUsername, setLoginUsername] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  async function handleLogin(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await apiRequest<AuthResponse>('/auth/login/', {
        method: 'POST',
        body: JSON.stringify({ username: loginUsername.trim(), password: loginPassword }),
      });
      storeTokens(res.data.tokens.access, res.data.tokens.refresh);
      router.push('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed.');
    } finally {
      setLoading(false);
    }
  }

  async function handleRegister(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    const nameParts = fullName.trim().split(' ');
    const firstName = nameParts[0] ?? '';
    const lastName = nameParts.slice(1).join(' ');
    const username = email.split('@')[0].replace(/[^a-zA-Z0-9]/g, '') + Math.floor(Math.random() * 9000 + 1000);
    try {
      const res = await apiRequest<AuthResponse>('/auth/register/', {
        method: 'POST',
        body: JSON.stringify({ username, email, password: regPassword, first_name: firstName, last_name: lastName }),
      });
      storeTokens(res.data.tokens.access, res.data.tokens.refresh);
      router.push('/onboarding/plan');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-4 bg-[#FAF7F2]">
      <div className="fixed -z-10 bottom-0 right-0 w-64 h-64 opacity-20 pointer-events-none">
        <div className="w-full h-full bg-gradient-to-tl from-[#ffdad4]/20 to-transparent rounded-full blur-3xl" />
      </div>
      <div className="fixed -z-10 top-0 left-0 w-80 h-80 opacity-20 pointer-events-none">
        <div className="w-full h-full bg-gradient-to-br from-[#c3e9c5]/20 to-transparent rounded-full blur-3xl" />
      </div>

      <div className="w-full max-w-[480px] bg-white rounded-2xl p-10 shadow-[0_8px_40px_-12px_rgba(28,28,25,0.08)]">
        <div className="flex flex-col items-center mb-8">
          <div className="text-2xl font-serif italic text-[#C4847A] mb-6">Bailey &amp; Beau</div>
          <h1 className="font-headline text-3xl font-bold text-[#1c1c19] text-center mb-2">
            {tab === 'login' ? 'Welcome back' : 'Create Your Account'}
          </h1>
          <p className="font-jost text-[#8B7355] text-center text-sm">
            {tab === 'login' ? 'Sign in to continue reading together.' : 'Start reading together in minutes.'}
          </p>
        </div>

        <div className="flex rounded-lg bg-[#f0ede9] p-1 mb-7">
          {(['login', 'register'] as const).map((t) => (
            <button
              key={t}
              onClick={() => { setTab(t); setError(''); }}
              className={`flex-1 py-2 text-sm font-semibold rounded-md transition-all ${tab === t ? 'bg-white text-[#1c1c19] shadow-sm' : 'text-[#524341] hover:text-[#1c1c19]'}`}
            >
              {t === 'login' ? 'Sign In' : 'Register'}
            </button>
          ))}
        </div>

        {tab === 'login' && (
          <form className="space-y-5" onSubmit={handleLogin}>
            <div className="flex flex-col space-y-1.5">
              <label className="text-sm font-medium text-[#524341] px-1">Username or email</label>
              <input
                className="w-full px-4 py-3 rounded-lg bg-[#ebe8e3] border-none ring-1 ring-inset ring-[#d7c2bf]/30 focus:ring-2 focus:ring-[#C4847A]/40 text-[#1c1c19] placeholder:text-[#847370]/60 transition-all outline-none"
                placeholder="Your username"
                value={loginUsername}
                onChange={(e) => setLoginUsername(e.target.value)}
                required
                autoComplete="username"
              />
            </div>
            <div className="flex flex-col space-y-1.5">
              <label className="text-sm font-medium text-[#524341] px-1">Password</label>
              <div className="relative">
                <input
                  className="w-full px-4 py-3 rounded-lg bg-[#ebe8e3] border-none ring-1 ring-inset ring-[#d7c2bf]/30 focus:ring-2 focus:ring-[#C4847A]/40 text-[#1c1c19] placeholder:text-[#847370]/60 transition-all outline-none"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Your password"
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#847370]/60 hover:text-[#1c1c19] transition-colors"
                >
                  {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            </div>
            {error && <p className="text-sm text-red-600 font-medium">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-4 mt-2 bg-[#C4847A] text-white font-semibold rounded-lg hover:brightness-105 active:scale-[0.98] transition-all shadow-sm disabled:opacity-60"
            >
              {loading ? 'Signing in…' : 'Sign In'}
            </button>
          </form>
        )}

        {tab === 'register' && (
          <form className="space-y-5" onSubmit={handleRegister}>
            <div className="flex flex-col space-y-1.5">
              <label className="text-sm font-medium text-[#524341] px-1">Full Name</label>
              <input
                className="w-full px-4 py-3 rounded-lg bg-[#ebe8e3] border-none ring-1 ring-inset ring-[#d7c2bf]/30 focus:ring-2 focus:ring-[#C4847A]/40 text-[#1c1c19] placeholder:text-[#847370]/60 transition-all outline-none"
                placeholder="Your name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
                autoComplete="name"
              />
            </div>
            <div className="flex flex-col space-y-1.5">
              <label className="text-sm font-medium text-[#524341] px-1">Email Address</label>
              <input
                className="w-full px-4 py-3 rounded-lg bg-[#ebe8e3] border-none ring-1 ring-inset ring-[#d7c2bf]/30 focus:ring-2 focus:ring-[#C4847A]/40 text-[#1c1c19] placeholder:text-[#847370]/60 transition-all outline-none"
                type="email"
                placeholder="you@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </div>
            <div className="flex flex-col space-y-1.5">
              <label className="text-sm font-medium text-[#524341] px-1">Password</label>
              <div className="relative">
                <input
                  className="w-full px-4 py-3 rounded-lg bg-[#ebe8e3] border-none ring-1 ring-inset ring-[#d7c2bf]/30 focus:ring-2 focus:ring-[#C4847A]/40 text-[#1c1c19] placeholder:text-[#847370]/60 transition-all outline-none"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Min. 8 characters"
                  value={regPassword}
                  onChange={(e) => setRegPassword(e.target.value)}
                  required
                  minLength={8}
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#847370]/60 hover:text-[#1c1c19] transition-colors"
                >
                  {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            </div>
            {error && <p className="text-sm text-red-600 font-medium">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-4 mt-2 bg-[#C4847A] text-white font-semibold rounded-lg hover:brightness-105 active:scale-[0.98] transition-all shadow-sm disabled:opacity-60"
            >
              {loading ? 'Creating account…' : 'Create Account'}
            </button>
          </form>
        )}

        <div className="mt-8 text-center text-sm text-[#524341]">
          {tab === 'login' ? (
            <>
              Don&apos;t have an account?{' '}
              <button onClick={() => { setTab('register'); setError(''); }} className="ml-1 text-[#C4847A] font-semibold hover:underline underline-offset-4">
                Sign Up
              </button>
            </>
          ) : (
            <>
              Already have an account?{' '}
              <button onClick={() => { setTab('login'); setError(''); }} className="ml-1 text-[#C4847A] font-semibold hover:underline underline-offset-4">
                Sign In
              </button>
            </>
          )}
        </div>
      </div>
    </main>
  );
}

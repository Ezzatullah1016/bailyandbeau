'use client';

import { useEffect } from 'react';
import { CircleAlert, RefreshCw } from 'lucide-react';

export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('[DashboardError]', error);
  }, [error]);

  return (
    <div className="ml-0 md:ml-64 flex-1 flex flex-col items-center justify-center min-h-screen bg-[#faf7f6] gap-6 p-8 text-center">
      <CircleAlert className="h-12 w-12 text-[#764f84]" aria-hidden />
      <div>
        <h1 className="font-baloo text-2xl font-bold text-[#3d3b62] mb-2">Page error</h1>
        <p className="text-stone-500 text-sm max-w-sm">This page ran into a problem. Your data is safe.</p>
      </div>
      <button
        onClick={reset}
        className="font-baloo flex items-center gap-2 px-6 py-3 bg-[#3d3b62] text-white font-bold text-sm rounded-xl hover:bg-[#764f84] transition-all"
      >
        <RefreshCw className="w-4 h-4" /> Reload
      </button>
      <a href="/dashboard" className="text-sm text-stone-400 underline hover:text-[#3d3b62]">Dashboard home</a>
    </div>
  );
}

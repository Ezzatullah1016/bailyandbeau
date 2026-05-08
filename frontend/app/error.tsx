'use client';

import { useEffect } from 'react';
import { RefreshCw } from 'lucide-react';

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('[GlobalError]', error);
  }, [error]);

  return (
    <div className="h-screen w-screen flex flex-col items-center justify-center bg-[#faf7f6] gap-6 p-8 text-center">
      <div className="text-5xl">😕</div>
      <div>
        <h1 className="font-baloo text-2xl font-bold text-[#3d3b62] mb-2">Something went wrong</h1>
        <p className="text-stone-500 text-sm max-w-sm">An unexpected error occurred. Your session data is safe — please try refreshing.</p>
      </div>
      <button
        onClick={reset}
        className="font-baloo flex items-center gap-2 px-6 py-3 bg-[#3d3b62] text-white font-bold text-sm rounded-xl hover:bg-[#764f84] transition-all"
      >
        <RefreshCw className="w-4 h-4" /> Try Again
      </button>
      <a href="/dashboard" className="text-sm text-stone-400 underline hover:text-[#3d3b62]">Go to Dashboard</a>
    </div>
  );
}

'use client';

import { useEffect } from 'react';
import { RefreshCw } from 'lucide-react';

export default function ReadingRoomError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('[ReadingRoomError]', error);
  }, [error]);

  return (
    <div className="h-screen w-screen flex flex-col items-center justify-center bg-gradient-to-br from-[#3d3b62] to-[#764f84] gap-6 p-8 text-center">
      <div className="text-5xl">📖</div>
      <div>
        <h1 className="font-baloo text-2xl font-bold text-white mb-2">Reading room error</h1>
        <p className="text-white/70 text-sm max-w-sm">The reading room hit an unexpected error. Your session is still active — try rejoining.</p>
      </div>
      <button
        onClick={reset}
        className="font-baloo flex items-center gap-2 px-6 py-3 bg-white text-[#3d3b62] font-bold text-sm rounded-xl hover:bg-stone-100 transition-all"
      >
        <RefreshCw className="w-4 h-4" /> Rejoin Session
      </button>
      <a href="/dashboard" className="text-sm text-white/50 underline hover:text-white">Leave session</a>
    </div>
  );
}

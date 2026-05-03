'use client';

import { useState, useEffect } from 'react';
import { MapPin, X, ChevronRight, RotateCcw } from 'lucide-react';

export interface Hotspot {
  id: string;
  top_pct: number;
  left_pct: number;
  label: string;
  description: string;
}

export interface HotspotConfig {
  image: string;
  hotspots: Hotspot[];
}

export interface HotspotState {
  active_hotspot_id: string | null;
}

interface Props {
  config: HotspotConfig;
  isHost: boolean;
  remoteState?: HotspotState;
  onSync: (state: HotspotState) => void;
  onNext?: () => void;
  onReset?: () => void;
}

export default function HotspotActivity({ config, isHost, remoteState, onSync, onNext, onReset }: Props) {
  const [activeId, setActiveId] = useState<string | null>(null);

  // Load remote state
  useEffect(() => {
    if (remoteState) setActiveId(remoteState.active_hotspot_id);
  }, [remoteState]);

  const handleClick = (id: string) => {
    const next = activeId === id ? null : id;
    setActiveId(next);
    onSync({ active_hotspot_id: next });
  };

  const handleClose = () => {
    setActiveId(null);
    onSync({ active_hotspot_id: null });
  };

  const handleReset = () => {
    setActiveId(null);
    onSync({ active_hotspot_id: null });
    onReset?.();
  };

  const active = config.hotspots.find((h) => h.id === activeId);

  return (
    <div className="flex flex-col h-full bg-[#1A1A1A]">
      {/* Nav controls */}
      {isHost && (
        <div className="flex items-center gap-3 px-6 py-3">
          <button
            onClick={handleReset}
            className="flex items-center gap-2 text-[#e5e2e1] opacity-60 px-3 py-2 hover:bg-[#2a2a2a] rounded-xl transition-all text-xs uppercase"
          >
            <RotateCcw className="w-4 h-4" />
            Reset
          </button>
          {onNext && (
            <button
              onClick={onNext}
              className="flex items-center gap-2 bg-[#2d5016] text-[#a8d38a] rounded-lg px-4 py-2 text-xs uppercase tracking-widest font-bold hover:bg-[#3a6a1e] transition-all ml-auto"
            >
              <ChevronRight className="w-4 h-4" />
              Next Activity
            </button>
          )}
        </div>
      )}

      {/* Main illustration area */}
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="relative w-full h-full max-w-5xl rounded-2xl shadow-inner overflow-hidden bg-white">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={config.image}
            alt="Activity illustration"
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-black/10" />

          {/* Hotspots */}
          {config.hotspots.map((hotspot) => {
            const isActive = hotspot.id === activeId;
            return (
              <div
                key={hotspot.id}
                className="absolute z-10"
                style={{ top: `${hotspot.top_pct}%`, left: `${hotspot.left_pct}%`, transform: 'translate(-50%, -50%)' }}
              >
                {isActive ? (
                  <div className="relative flex flex-col items-center">
                    {/* Tooltip */}
                    <div className="mb-5 w-64 bg-white p-5 rounded-2xl shadow-2xl ring-1 ring-black/5 animate-in fade-in slide-in-from-bottom-4 duration-300">
                      <h3 className="font-headline text-lg text-black font-bold mb-1">{hotspot.label}</h3>
                      <p className="text-sm text-neutral-600 leading-relaxed mb-3">{hotspot.description}</p>
                      <button
                        onClick={handleClose}
                        className="w-full py-1.5 bg-[#2d5016] text-[#a8d38a] rounded-lg font-label text-xs uppercase tracking-widest font-bold hover:opacity-90 transition-opacity"
                      >
                        Close
                      </button>
                      {/* Arrow */}
                      <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-4 h-4 bg-white rotate-45 shadow-sm" />
                    </div>
                    {/* Active marker */}
                    <button
                      onClick={() => handleClick(hotspot.id)}
                      aria-label={`Close ${hotspot.label}`}
                      className="w-10 h-10 rounded-full bg-white flex items-center justify-center shadow-xl ring-4 ring-[#ffb955]/40"
                    >
                      <MapPin className="w-5 h-5 text-[#ffb955] fill-[#ffb955]" />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => handleClick(hotspot.id)}
                    aria-label={`Explore ${hotspot.label}`}
                    className="w-8 h-8 rounded-full bg-[#ffb955] flex items-center justify-center shadow-lg border-2 border-white/50 hotspot-pulse"
                    style={{ animation: 'hotspot-pulse 2s infinite' }}
                  >
                    <span className="w-2.5 h-2.5 rounded-full bg-white/80" />
                  </button>
                )}
              </div>
            );
          })}

          {/* Instruction hint */}
          <div className="absolute bottom-6 left-6 bg-black/60 backdrop-blur-xl px-4 py-2 rounded-full border border-white/10 flex items-center gap-2">
            <MapPin className="w-3 h-3 text-[#ffb955]" />
            <span className="font-label text-[10px] uppercase tracking-widest text-[#e5e2e1]">Tap markers to explore</span>
          </div>
        </div>
      </div>

      {/* Progress bar */}
      <div className="w-full h-1 bg-[#353535]">
        <div
          className="h-full bg-[#ffb955] shadow-[0_0_12px_rgba(255,185,85,0.8)] transition-all duration-500"
          style={{ width: `${config.hotspots.length ? (config.hotspots.filter((h) => h.id !== activeId).length / config.hotspots.length) * 100 : 0}%` }}
        />
      </div>

      <style jsx>{`
        @keyframes hotspot-pulse {
          0% { transform: scale(1); opacity: 0.8; box-shadow: 0 0 0 0 rgba(255,185,85,0.7); }
          70% { transform: scale(1.1); opacity: 1; box-shadow: 0 0 0 15px rgba(255,185,85,0); }
          100% { transform: scale(1); opacity: 0.8; box-shadow: 0 0 0 0 rgba(255,185,85,0); }
        }
        .hotspot-pulse { animation: hotspot-pulse 2s infinite; }
      `}</style>
    </div>
  );
}

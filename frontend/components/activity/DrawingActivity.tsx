'use client';

import { useRef, useState, useCallback } from 'react';
import { Eraser, Trash2, ChevronRight, RotateCcw } from 'lucide-react';
import ActivityCanvas, { ActivityCanvasHandle } from './ActivityCanvas';

export interface DrawingConfig {
  colors: string[];
  outline_image_url?: string;
}

interface Props {
  config: DrawingConfig;
  isHost: boolean;
  /** Called with serialized canvas JSON whenever local state changes */
  onSync: (json: string) => void;
  /** Remote JSON to load (from data channel) */
  remoteState?: string;
  onNext?: () => void;
  onReset?: () => void;
}

const BRUSH_SIZES = [4, 8, 14];
const DEFAULT_COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#a855f7', '#78350f', '#000000'];

export default function DrawingActivity({ config, isHost, onSync, remoteState, onNext, onReset }: Props) {
  const canvasRef = useRef<ActivityCanvasHandle>(null);
  const [color, setColor] = useState(config.colors?.[0] ?? DEFAULT_COLORS[0]);
  const [brushSize, setBrushSize] = useState(BRUSH_SIZES[1]);
  const [tool, setTool] = useState<'pen' | 'eraser'>('pen');

  const colors = config.colors?.length ? config.colors : DEFAULT_COLORS;

  // Load remote state when it changes
  const prevRemoteRef = useRef<string | undefined>(undefined);
  if (remoteState && remoteState !== prevRemoteRef.current) {
    prevRemoteRef.current = remoteState;
    canvasRef.current?.loadRemoteJSON(remoteState);
  }

  const handleClear = useCallback(() => {
    canvasRef.current?.clearCanvas(true);
  }, []);

  return (
    <div className="flex flex-col h-full">
      {/* Canvas area */}
      <div className="flex-1 flex items-center justify-center px-8 pt-4 relative">
        <div className="w-[85%] h-[80%] bg-white rounded-2xl shadow-2xl overflow-hidden relative border-[12px] border-[#2a2a2a]">
          <ActivityCanvas
            ref={canvasRef}
            color={color}
            brushSize={brushSize}
            tool={tool}
            outlineImageUrl={config.outline_image_url}
            onSync={onSync}
          />
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-6 px-8 py-4 mx-auto bg-[#2a2a2a] rounded-2xl shadow-2xl border border-[#43493d]/10 mb-4">
        {/* Color palette */}
        <div className="flex items-center gap-2">
          {colors.map((c) => (
            <button
              key={c}
              aria-label={`Select color ${c}`}
              onClick={() => { setColor(c); setTool('pen'); }}
              className="w-8 h-8 rounded-full cursor-pointer hover:scale-110 transition-transform shadow-inner"
              style={{
                backgroundColor: c,
                boxShadow: color === c && tool === 'pen'
                  ? `0 0 0 2px #fff, 0 0 0 4px ${c}`
                  : undefined,
              }}
            />
          ))}
        </div>

        <div className="w-px h-8 bg-[#43493d]/20" />

        {/* Brush sizes */}
        <div className="flex items-center gap-3">
          {BRUSH_SIZES.map((s) => (
            <button
              key={s}
              aria-label={`Brush size ${s}`}
              onClick={() => { setBrushSize(s); setTool('pen'); }}
              className={`rounded-full transition-all cursor-pointer ${brushSize === s && tool === 'pen' ? 'ring-2 ring-[#a8d38a]/40 bg-[#a8d38a]' : 'bg-[#c3c9b9]'}`}
              style={{ width: s + 6, height: s + 6 }}
            />
          ))}
        </div>

        <div className="w-px h-8 bg-[#43493d]/20" />

        {/* Tools */}
        <div className="flex items-center gap-3">
          <button
            aria-label="Eraser tool"
            onClick={() => setTool('eraser')}
            className={`flex items-center justify-center p-2 rounded-lg transition-all ${tool === 'eraser' ? 'bg-[#a8d38a]/20 text-[#a8d38a]' : 'text-[#c3c9b9] hover:bg-[#353535]'}`}
          >
            <Eraser className="w-5 h-5" />
          </button>
          <button
            aria-label="Clear canvas"
            onClick={handleClear}
            className="text-[#ffb955] font-medium px-4 py-2 rounded-lg hover:bg-[#ffb955]/10 transition-all text-sm uppercase tracking-wider flex items-center gap-1"
          >
            <Trash2 className="w-4 h-4" />
            Clear
          </button>
        </div>

        {isHost && (
          <>
            <div className="w-px h-8 bg-[#43493d]/20" />
            <div className="flex items-center gap-2">
              {onNext && (
                <button
                  onClick={onNext}
                  className="flex items-center gap-2 bg-[#2d5016] text-[#a8d38a] rounded-lg px-4 py-2 text-xs uppercase tracking-wider font-bold transition-all hover:bg-[#3a6a1e]"
                >
                  <ChevronRight className="w-4 h-4" />
                  Next
                </button>
              )}
              {onReset && (
                <button
                  onClick={onReset}
                  className="flex items-center gap-2 text-[#e5e2e1] opacity-60 px-3 py-2 hover:bg-[#2a2a2a] rounded-xl transition-all text-xs uppercase"
                >
                  <RotateCcw className="w-4 h-4" />
                  Reset
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

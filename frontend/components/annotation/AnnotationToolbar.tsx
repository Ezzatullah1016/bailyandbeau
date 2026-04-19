'use client';

import { Eraser, Pencil, Trash2 } from 'lucide-react';

export type AnnotationTool = 'pen' | 'eraser';

const COLORS = [
  { value: '#ef4444', cls: 'bg-red-500',   label: 'Red' },
  { value: '#a3e635', cls: 'bg-lime-400',  label: 'Lime' },
  { value: '#fbbf24', cls: 'bg-amber-400', label: 'Amber' },
  { value: '#60a5fa', cls: 'bg-blue-400',  label: 'Blue' },
] as const;

interface AnnotationToolbarProps {
  tool: AnnotationTool;
  color: string;
  brushSize: number;
  onToolChange: (t: AnnotationTool) => void;
  onColorChange: (c: string) => void;
  onBrushSizeChange: (s: number) => void;
  onClear: () => void;
}

const MIN_BRUSH = 2;
const MAX_BRUSH = 32;

function Tip({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute -top-9 left-1/2 -translate-x-1/2 px-2 py-1 bg-stone-950 text-white text-[10px] font-semibold rounded-md whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-30">
      {children}
      <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-stone-950" />
    </div>
  );
}

export function AnnotationToolbar({
  tool, color, brushSize, onToolChange, onColorChange, onBrushSizeChange, onClear,
}: AnnotationToolbarProps) {
  const brushPct = ((brushSize - MIN_BRUSH) / (MAX_BRUSH - MIN_BRUSH)) * 100;

  return (
    <div className="absolute bottom-12 left-1/2 -translate-x-1/2 bg-stone-900/80 backdrop-blur-xl px-6 py-3 rounded-2xl flex items-center gap-6 shadow-2xl border border-white/5 z-20">
      <div className="flex items-center gap-2">
        <div className="relative group">
          <button
            onClick={() => onToolChange('pen')}
            className={`w-10 h-10 flex items-center justify-center rounded-xl transition-colors ${tool === 'pen' ? 'bg-lime-900/30 text-lime-300' : 'hover:bg-stone-800/50 text-stone-400'}`}
          >
            <Pencil className="w-5 h-5" />
          </button>
          <Tip>Pen</Tip>
        </div>
        <div className="relative group">
          <button
            onClick={() => onToolChange('eraser')}
            className={`w-10 h-10 flex items-center justify-center rounded-xl transition-colors ${tool === 'eraser' ? 'bg-lime-900/30 text-lime-300' : 'hover:bg-stone-800/50 text-stone-400'}`}
          >
            <Eraser className="w-5 h-5" />
          </button>
          <Tip>Eraser</Tip>
        </div>
      </div>

      <div className="h-6 w-[1px] bg-stone-700" />

      <div className="flex items-center gap-2">
        {COLORS.map((c) => (
          <div key={c.value} className="relative group">
            <button
              onClick={() => onColorChange(c.value)}
              className={`w-6 h-6 rounded-full ${c.cls} transition-all ${color === c.value ? 'ring-2 ring-white/60' : 'ring-2 ring-transparent'}`}
            />
            <Tip>{c.label}</Tip>
          </div>
        ))}
      </div>

      <div className="h-6 w-[1px] bg-stone-700" />

      <div className="relative group flex flex-col gap-1 w-32">
        <div className="flex justify-between text-[10px] text-stone-500 uppercase tracking-widest font-bold">
          <span>Brush</span>
          <span>{brushSize}px</span>
        </div>
        <div
          className="h-1.5 bg-stone-800 rounded-full overflow-hidden cursor-pointer relative"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const pct = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
            onBrushSizeChange(Math.round(MIN_BRUSH + pct * (MAX_BRUSH - MIN_BRUSH)));
          }}
        >
          <div className="h-full bg-lime-300 rounded-full pointer-events-none" style={{ width: `${brushPct}%` }} />
        </div>
        <Tip>Brush size</Tip>
      </div>

      <div className="h-6 w-[1px] bg-stone-700" />

      <div className="relative group">
        <button
          onClick={onClear}
          className="w-10 h-10 flex items-center justify-center rounded-xl text-stone-400 hover:text-red-400 hover:bg-red-900/20 transition-colors"
        >
          <Trash2 className="w-5 h-5" />
        </button>
        <Tip>Clear canvas</Tip>
      </div>
    </div>
  );
}

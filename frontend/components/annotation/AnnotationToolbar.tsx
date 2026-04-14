'use client';

export type AnnotationTool = 'pen' | 'eraser';

const COLORS = [
  { value: '#ef4444', cls: 'bg-red-500' },
  { value: '#a3e635', cls: 'bg-lime-400' },
  { value: '#fbbf24', cls: 'bg-amber-400' },
  { value: '#60a5fa', cls: 'bg-blue-400' },
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

export function AnnotationToolbar({
  tool,
  color,
  brushSize,
  onToolChange,
  onColorChange,
  onBrushSizeChange,
  onClear,
}: AnnotationToolbarProps) {
  const brushPct = ((brushSize - MIN_BRUSH) / (MAX_BRUSH - MIN_BRUSH)) * 100;

  return (
    <div className="absolute bottom-12 left-1/2 -translate-x-1/2 bg-stone-900/80 backdrop-blur-xl px-6 py-3 rounded-2xl flex items-center gap-6 shadow-2xl border border-white/5 z-20">
      {/* Tool buttons */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => onToolChange('pen')}
          className={`w-10 h-10 flex items-center justify-center rounded-xl transition-colors ${
            tool === 'pen'
              ? 'bg-lime-900/30 text-lime-300'
              : 'hover:bg-stone-800/50 text-stone-400'
          }`}
          title="Pen"
        >
          <span className="material-symbols-outlined">edit</span>
        </button>
        <button
          onClick={() => onToolChange('eraser')}
          className={`w-10 h-10 flex items-center justify-center rounded-xl transition-colors ${
            tool === 'eraser'
              ? 'bg-lime-900/30 text-lime-300'
              : 'hover:bg-stone-800/50 text-stone-400'
          }`}
          title="Eraser"
        >
          <span className="material-symbols-outlined">auto_fix_high</span>
        </button>
      </div>

      <div className="h-6 w-[1px] bg-stone-700" />

      {/* Color swatches */}
      <div className="flex items-center gap-2">
        {COLORS.map((c) => (
          <button
            key={c.value}
            onClick={() => onColorChange(c.value)}
            className={`w-6 h-6 rounded-full ${c.cls} transition-all ${
              color === c.value ? 'ring-2 ring-white/60' : 'ring-2 ring-transparent'
            }`}
            title={c.value}
          />
        ))}
      </div>

      <div className="h-6 w-[1px] bg-stone-700" />

      {/* Brush size slider */}
      <div className="flex flex-col gap-1 w-32">
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
          <div
            className="h-full bg-lime-300 rounded-full pointer-events-none"
            style={{ width: `${brushPct}%` }}
          />
        </div>
      </div>

      <div className="h-6 w-[1px] bg-stone-700" />

      <button
        onClick={onClear}
        className="text-xs font-bold text-stone-400 hover:text-white transition-colors uppercase tracking-widest"
      >
        Clear Canvas
      </button>
    </div>
  );
}

'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { useDroppable, useDraggable } from '@dnd-kit/core';
import { Check, ChevronRight, RotateCcw, Lightbulb, Plus } from 'lucide-react';

export interface DragDropItem {
  id: string;
  label: string;
  emoji: string;
  correct_zone: string;
}

export interface DragDropZone {
  id: string;
  label: string;
}

export interface DragDropConfig {
  items: DragDropItem[];
  zones: DragDropZone[];
}

export interface DragDropState {
  placements: Record<string, string>; // itemId → zoneId
  wrongAttempts: Record<string, boolean>; // itemId → shaking
}

interface Props {
  config: DragDropConfig;
  isHost: boolean;
  remoteState?: DragDropState;
  onSync: (state: DragDropState) => void;
  onNext?: () => void;
  onReset?: () => void;
}

function DraggableItem({ item, isPlaced }: { item: DragDropItem; isPlaced: boolean }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: item.id });
  return (
    <div ref={setNodeRef} {...listeners} {...attributes}
      aria-grabbed={isDragging}
      className={`relative group cursor-grab active:cursor-grabbing transition-all ${isDragging ? 'opacity-50' : ''} ${isPlaced ? 'opacity-40' : ''}`}
    >
      <div className={`bg-white p-5 rounded-xl border-2 flex flex-col items-center justify-center gap-3 transition-all
        ${isPlaced ? 'border-[#a8d38a] ring-4 ring-[#a8d38a]/20 shadow-xl' : 'border-[#353535]/10 shadow-sm hover:shadow-md hover:-translate-y-1'}`}>
        <div className="w-14 h-14 rounded-full bg-[#131313]/5 flex items-center justify-center">
          <span className="text-3xl">{item.emoji}</span>
        </div>
        <span className="font-bold text-[#131313] text-sm">{item.label}</span>
        {isPlaced && (
          <div className="absolute -top-2.5 -right-2.5 bg-[#a8d38a] text-[#163801] w-7 h-7 rounded-full flex items-center justify-center shadow-lg">
            <Check className="w-4 h-4" strokeWidth={3} />
          </div>
        )}
      </div>
    </div>
  );
}

function DropZone({ zone, occupant, isHinted }: { zone: DragDropZone; occupant?: DragDropItem; isHinted: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: zone.id });
  return (
    <div ref={setNodeRef}
      className={`h-28 border-2 rounded-xl flex items-center px-6 gap-5 transition-all
        ${occupant ? 'border-[#a8d38a]/30 bg-[#a8d38a]/5 border-solid' :
          isOver ? 'border-[#a8d38a] bg-[#a8d38a]/10 border-dashed' :
          isHinted ? 'border-[#ffb955] bg-[#ffb955]/10 border-dashed' :
          'border-[#131313]/20 bg-white/40 border-dashed hover:bg-white/60'}`}
      aria-dropeffect="move"
    >
      <div className={`w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0
        ${occupant ? 'bg-[#a8d38a]/20' : 'border border-dashed border-[#131313]/30'}`}>
        {occupant ? (
          <span className="text-xl">{occupant.emoji}</span>
        ) : (
          <Plus className="w-5 h-5 text-[#131313]/30" />
        )}
      </div>
      <div>
        <p className="font-headline text-lg text-[#131313] italic">{zone.label}</p>
        <p className={`text-xs uppercase tracking-wider font-bold ${occupant ? 'text-[#a8d38a]' : 'opacity-50 text-[#131313]'}`}>
          {occupant ? 'Matched Successfully' : 'Drop matches here'}
        </p>
      </div>
    </div>
  );
}

export default function DragDropActivity({ config, isHost, remoteState, onSync, onNext, onReset }: Props) {
  const [placements, setPlacements] = useState<Record<string, string>>({});
  const [shaking, setShaking] = useState<Record<string, boolean>>({});
  const [hints, setHints] = useState(2);
  const [hintedItems, setHintedItems] = useState<Set<string>>(new Set());
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  // Sync remote state in
  useEffect(() => {
    if (remoteState) {
      setPlacements(remoteState.placements ?? {});
    }
  }, [remoteState]);

  const emitSync = useCallback((p: Record<string, string>) => {
    onSync({ placements: p, wrongAttempts: {} });
  }, [onSync]);

  const handleDragStart = (e: DragStartEvent) => setActiveId(e.active.id as string);

  const handleDragEnd = useCallback((e: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = e;
    if (!over) return;

    const itemId = active.id as string;
    const zoneId = over.id as string;
    const item = config.items.find((i) => i.id === itemId);
    if (!item) return;

    if (item.correct_zone === zoneId) {
      setPlacements((prev) => {
        const next = { ...prev, [itemId]: zoneId };
        emitSync(next);
        return next;
      });
    } else {
      setShaking((prev) => ({ ...prev, [itemId]: true }));
      setTimeout(() => setShaking((prev) => ({ ...prev, [itemId]: false })), 600);
    }
  }, [config.items, emitSync]);

  const handleHint = () => {
    if (hints <= 0) return;
    const unplaced = config.items.find((i) => !placements[i.id]);
    if (unplaced) {
      setHintedItems((prev) => new Set(prev).add(unplaced.correct_zone));
      setHints((h) => h - 1);
    }
  };

  const handleReset = () => {
    setPlacements({});
    setShaking({});
    setHintedItems(new Set());
    setHints(2);
    emitSync({});
    onReset?.();
  };

  const activeItem = config.items.find((i) => i.id === activeId);
  const placedItemIds = new Set(Object.keys(placements));

  return (
    <div className="flex flex-col h-full bg-[#e5e2e1] rounded-2xl p-10 overflow-hidden">
      <header className="mb-8">
        <span className="font-label text-[12px] uppercase tracking-[0.2em] text-[#353535]/60 mb-1 block">Activity</span>
        <h2 className="font-headline text-4xl italic text-[#131313]">Symbol Categorisation</h2>
      </header>

      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div className="flex-1 grid grid-cols-2 gap-12 items-start overflow-y-auto">
          {/* Draggable items */}
          <div className="grid grid-cols-2 gap-5">
            {config.items.map((item) => (
              <div
                key={item.id}
                className={shaking[item.id] ? 'shake-effect' : ''}
                style={shaking[item.id] ? { animation: 'shake 0.5s cubic-bezier(.36,.07,.19,.97) both' } : {}}
              >
                <DraggableItem item={item} isPlaced={placedItemIds.has(item.id)} />
              </div>
            ))}
          </div>

          {/* Drop zones */}
          <div className="flex flex-col gap-4">
            {config.zones.map((zone) => {
              const occupantId = Object.entries(placements).find(([, z]) => z === zone.id)?.[0];
              const occupant = config.items.find((i) => i.id === occupantId);
              return (
                <DropZone
                  key={zone.id}
                  zone={zone}
                  occupant={occupant}
                  isHinted={hintedItems.has(zone.id)}
                />
              );
            })}
          </div>
        </div>

        <DragOverlay>
          {activeItem && (
            <div className="bg-white p-5 rounded-xl border-2 border-[#a8d38a] shadow-2xl flex flex-col items-center gap-3 opacity-90 cursor-grabbing w-32">
              <span className="text-3xl">{activeItem.emoji}</span>
              <span className="font-bold text-[#131313] text-sm">{activeItem.label}</span>
            </div>
          )}
        </DragOverlay>
      </DndContext>

      {/* Footer */}
      <footer className="mt-6 pt-6 flex justify-between items-center border-t border-[#131313]/5">
        <div className="flex gap-3">
          <button
            onClick={handleHint}
            disabled={hints <= 0}
            className="px-5 py-2 rounded-full text-[#131313] font-semibold border border-[#131313]/10 hover:bg-[#131313]/5 transition-colors disabled:opacity-40 flex items-center gap-2 text-sm"
          >
            <Lightbulb className="w-4 h-4" />
            Hint ({hints} left)
          </button>
        </div>
        {isHost && (
          <div className="flex gap-3">
            <button
              onClick={handleReset}
              className="flex items-center gap-2 px-4 py-2 rounded-full border border-[#131313]/10 text-[#131313]/60 hover:bg-[#131313]/5 transition-colors text-sm"
            >
              <RotateCcw className="w-4 h-4" />
              Reset
            </button>
            {onNext && (
              <button
                onClick={onNext}
                className="flex items-center gap-2 bg-[#131313] text-white px-7 py-2.5 rounded-full font-bold shadow-lg hover:opacity-90 transition-opacity text-sm"
              >
                <ChevronRight className="w-4 h-4" />
                Next Activity
              </button>
            )}
          </div>
        )}
      </footer>

      <style jsx>{`
        @keyframes shake {
          10%, 90% { transform: translate3d(-1px, 0, 0); }
          20%, 80% { transform: translate3d(2px, 0, 0); }
          30%, 50%, 70% { transform: translate3d(-4px, 0, 0); }
          40%, 60% { transform: translate3d(4px, 0, 0); }
        }
        .shake-effect { animation: shake 0.5s cubic-bezier(.36,.07,.19,.97) both; }
      `}</style>
    </div>
  );
}

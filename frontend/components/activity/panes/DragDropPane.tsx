'use client';

import { useState } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, RotateCcw, X } from 'lucide-react';

import { usePaneMotion } from './motion';
import type { DropZoneSpec, LabelSpec, PaneProps } from './shared';

export function DragDropPane({ payload, assignments, patchCurrent }: Omit<PaneProps, 'state' | 'role'> & {
  assignments: Record<string, string>;
}) {
  const imageUrl = typeof payload.image_url === 'string' ? payload.image_url : '';
  const labels11 = payload.labels as LabelSpec[] | undefined;

  // ── 1.1: image-anchored zones + draggable/tap-to-place labels ─────────────
  if (imageUrl && Array.isArray(labels11)) {
    const zones11 = (payload.drop_zones as DropZoneSpec[]) ?? [];
    return (
      <ImageDragDrop
        imageUrl={imageUrl}
        labels={labels11}
        zones={zones11}
        assignments={assignments}
        onAssign={(next) => patchCurrent({ assignments: next })}
      />
    );
  }

  // ── 1.0: two-column tap-to-assign (flat string lists) ─────────────────────
  return <LegacyDragDrop payload={payload} assignments={assignments} patchCurrent={patchCurrent} />;
}

function LegacyDragDrop({
  payload,
  assignments,
  patchCurrent,
}: {
  payload: Record<string, unknown>;
  assignments: Record<string, string>;
  patchCurrent: (patch: Record<string, unknown>) => void;
}) {
  const m = usePaneMotion();
  const items = (payload.items as string[]) ?? [];
  const zones = (payload.drop_zones as string[]) ?? [];
  const [picked, setPicked] = useState<string | null>(null);

  function assign(zone: string, item: string) {
    patchCurrent({ assignments: { ...assignments, [zone]: item } });
    setPicked(null);
  }

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div>
        <p className="mb-2 text-xs font-bold uppercase text-brand-purple">Items</p>
        <div className="flex flex-wrap gap-2">
          {items.map((item) => (
            <motion.button
              key={item}
              type="button"
              whileTap={m.press}
              onClick={() => setPicked(picked === item ? null : item)}
              className={`min-h-11 cursor-pointer rounded-xl border-2 px-3 text-sm font-bold transition-colors ${
                picked === item
                  ? 'border-brand-pink bg-brand-pink/15'
                  : 'border-brand-purple/25 bg-white'
              }`}
            >
              {item}
            </motion.button>
          ))}
        </div>
        <p className="mt-2 text-xs text-brand-purple">
          {picked ? `Tap a zone for “${picked}”.` : 'Tap an item, then a drop zone.'}
        </p>
      </div>
      <div>
        <p className="mb-2 text-xs font-bold uppercase text-brand-purple">Drop zones</p>
        <div className="space-y-2">
          {zones.map((zone) => (
            <motion.button
              key={zone}
              type="button"
              disabled={!picked}
              whileTap={picked ? m.press : undefined}
              onClick={() => picked && assign(zone, picked)}
              className="w-full rounded-xl border-2 border-dashed border-brand-teal/50 bg-brand-teal/5 px-4 py-6 text-left disabled:cursor-not-allowed"
            >
              <span className="block text-xs font-bold text-brand-teal">{zone}</span>
              <span className="mt-1 block font-semibold text-brand-navy">
                {assignments[zone] ?? '—'}
              </span>
            </motion.button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── 1.1 image-anchored drag & drop ───────────────────────────────────────────

function DraggableLabel({
  id,
  text,
  picked,
  onPick,
}: {
  id: string;
  text: string;
  picked: boolean;
  onPick: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id });
  return (
    <button
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      type="button"
      onClick={onPick}
      // The DragOverlay renders the travelling copy, so the source only needs
      // to recede. Previously this element *was* the preview, which meant it
      // was clipped by the label row's bounds while dragging.
      className={`min-h-11 cursor-grab touch-none rounded-full border-2 px-4 text-sm font-bold shadow-sm transition-all active:cursor-grabbing ${
        isDragging
          ? 'border-brand-pink/30 bg-white/40 text-brand-pink/40'
          : picked
            ? 'border-brand-pink bg-brand-pink text-white'
            : 'border-brand-pink/60 bg-white text-brand-pink hover:border-brand-pink'
      }`}
    >
      {text}
    </button>
  );
}

type ZoneVerdict = 'unchecked' | 'right' | 'wrong';

function DropZone({
  zone,
  assignedText,
  armed,
  verdict,
  onTap,
}: {
  zone: DropZoneSpec;
  assignedText: string | null;
  /** A label is picked and this zone is a legal target. */
  armed: boolean;
  verdict: ZoneVerdict;
  onTap: () => void;
}) {
  const m = usePaneMotion();
  const { setNodeRef, isOver } = useDroppable({ id: zone.id });

  const skin =
    verdict === 'right'
      ? 'border-brand-teal bg-brand-teal/25 border-solid'
      : verdict === 'wrong'
        ? 'border-brand-pink bg-brand-pink/20 border-solid'
        : isOver
          ? 'border-brand-teal bg-brand-teal/40 border-solid'
          : armed
            ? 'border-brand-teal/80 bg-brand-teal/15'
            : 'border-brand-teal/60 bg-brand-teal/5';

  return (
    <motion.button
      ref={setNodeRef}
      type="button"
      onClick={onTap}
      // Only the hovered zone lifts. The old code lit every zone at once
      // whenever a label was picked, which told the child nothing.
      animate={
        verdict === 'wrong'
          ? m.nudge
          : verdict === 'right'
            ? m.celebrate
            : isOver && !m.reduced
              ? { scale: 1.06 }
              : { scale: 1 }
      }
      transition={m.springSnappy}
      className={`absolute flex cursor-pointer items-center justify-center rounded-xl border-2 border-dashed text-center transition-colors ${skin}`}
      style={{ left: `${zone.x}%`, top: `${zone.y}%`, width: `${zone.w}%`, height: `${zone.h}%` }}
      aria-label={zone.label ?? zone.id}
    >
      <AnimatePresence>
        {assignedText ? (
          <motion.span
            key={assignedText}
            variants={m.popIn}
            initial="hidden"
            animate="show"
            exit="exit"
            className="flex items-center gap-1 rounded-lg bg-white/95 px-2 py-1 text-xs font-bold text-brand-navy shadow-sm"
          >
            {verdict === 'right' ? (
              <Check className="h-3 w-3 text-brand-teal" strokeWidth={3} />
            ) : verdict === 'wrong' ? (
              <X className="h-3 w-3 text-brand-pink" strokeWidth={3} />
            ) : null}
            {assignedText}
          </motion.span>
        ) : null}
      </AnimatePresence>
    </motion.button>
  );
}

function ImageDragDrop({
  imageUrl,
  labels,
  zones,
  assignments,
  onAssign,
}: {
  imageUrl: string;
  labels: LabelSpec[];
  zones: DropZoneSpec[];
  assignments: Record<string, string>;
  onAssign: (next: Record<string, string>) => void;
}) {
  const m = usePaneMotion();
  const [picked, setPicked] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  // Local, not synced: checking is a private "how did I do", and syncing it
  // would let one participant wipe the other's result mid-thought.
  const [checked, setChecked] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 120, tolerance: 6 } }),
  );

  const labelById = Object.fromEntries(labels.map((l) => [l.id, l.text]));
  const usedLabelIds = new Set(Object.values(assignments));
  const availableLabels = labels.filter((l) => !usedLabelIds.has(l.id));

  // `accepts` has been in the schema and the builder all along but was never
  // read at runtime, so nothing could ever be marked right or wrong.
  const gradable = zones.some((z) => typeof z.accepts === 'string' && z.accepts);
  const allPlaced = availableLabels.length === 0;

  function verdictFor(z: DropZoneSpec): ZoneVerdict {
    if (!checked || !z.accepts) return 'unchecked';
    return assignments[z.id] === z.accepts ? 'right' : 'wrong';
  }

  const gradedZones = zones.filter((z) => typeof z.accepts === 'string' && z.accepts);
  const rightCount = gradedZones.filter((z) => assignments[z.id] === z.accepts).length;
  const allRight = checked && rightCount === gradedZones.length;

  /**
   * Checking needs every gradable *zone* filled — not every label used.
   *
   * Gating on "no labels left over" looked equivalent but is not: an author can
   * supply more labels than zones (distractors are a normal quiz device), and
   * dropping a second label on an occupied zone evicts the first back to the
   * tray. Either case left the button dead with nothing on screen explaining
   * why the child could not continue.
   */
  const emptyZones = gradedZones.filter((z) => !assignments[z.id]).length;
  const canCheck = gradedZones.length > 0 && emptyZones === 0;

  function place(zoneId: string, labelId: string) {
    const next: Record<string, string> = {};
    for (const [z, l] of Object.entries(assignments)) {
      if (l !== labelId && z !== zoneId) next[z] = l;
    }
    next[zoneId] = labelId;
    onAssign(next);
    setPicked(null);
    setChecked(false);
  }

  function handleDragEnd(e: DragEndEvent) {
    setDragging(null);
    const labelId = String(e.active.id);
    const zoneId = e.over ? String(e.over.id) : null;
    if (zoneId) place(zoneId, labelId);
  }

  function tryAgain() {
    setChecked(false);
    // Clear only the wrong ones: re-doing correct work is a punishment.
    const kept: Record<string, string> = {};
    for (const z of zones) {
      if (z.accepts && assignments[z.id] === z.accepts) kept[z.id] = assignments[z.id];
    }
    onAssign(kept);
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={(e: DragStartEvent) => setDragging(String(e.active.id))}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setDragging(null)}
    >
      <div className="space-y-4">
        <div className="relative w-full overflow-hidden rounded-2xl border border-brand-purple/20 bg-brand-blush/30">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageUrl} alt="" className="mx-auto block h-auto max-h-[380px] w-full object-contain" />
          <div className="absolute inset-0">
            {zones.map((z) => (
              <DropZone
                key={z.id}
                zone={z}
                assignedText={assignments[z.id] ? labelById[assignments[z.id]] ?? null : null}
                armed={Boolean(picked)}
                verdict={verdictFor(z)}
                onTap={() => picked && place(z.id, picked)}
              />
            ))}
          </div>
        </div>

        <motion.div
          variants={m.stagger}
          initial="hidden"
          animate="show"
          className="flex flex-wrap justify-center gap-2"
        >
          <AnimatePresence mode="popLayout">
            {availableLabels.map((l) => (
              <motion.div
                key={l.id}
                layout={!m.reduced}
                variants={m.popIn}
                initial="hidden"
                animate="show"
                exit="exit"
              >
                <DraggableLabel
                  id={l.id}
                  text={l.text}
                  picked={picked === l.id}
                  onPick={() => setPicked(picked === l.id ? null : l.id)}
                />
              </motion.div>
            ))}
          </AnimatePresence>
        </motion.div>

        <p className="text-center text-xs text-brand-purple">
          {picked
            ? 'Now tap a box on the picture.'
            : gradable && canCheck
              ? 'Every box filled — check your answers when you are ready.'
              : gradable && emptyZones > 0 && emptyZones < gradedZones.length
                ? `${emptyZones} ${emptyZones === 1 ? 'box' : 'boxes'} still empty.`
                : allPlaced
                  ? 'All placed!'
                  : 'Drag a word onto the picture — or tap a word, then a box.'}
        </p>

        {/* Check My Answers — the mockup's control, and the reason `accepts`
            exists in the schema. Only shown when the author supplied answers. */}
        {gradable ? (
          <div className="flex flex-col items-center gap-3">
            <AnimatePresence mode="wait">
              {checked ? (
                <motion.div
                  key="result"
                  variants={m.popIn}
                  initial="hidden"
                  animate="show"
                  exit="exit"
                  className={`flex items-center gap-2 rounded-2xl px-4 py-3 text-sm font-bold ${
                    allRight ? 'bg-brand-teal/15 text-brand-teal' : 'bg-brand-gold/25 text-brand-navy'
                  }`}
                  role="status"
                >
                  {allRight ? <Check className="h-4 w-4" strokeWidth={3} /> : null}
                  {allRight
                    ? 'Every one right — brilliant!'
                    : `${rightCount} of ${gradedZones.length} right — try the others again.`}
                </motion.div>
              ) : null}
            </AnimatePresence>

            <div className="flex items-center gap-2">
              {checked && !allRight ? (
                <motion.button
                  type="button"
                  whileTap={m.press}
                  onClick={tryAgain}
                  className="font-baloo flex min-h-11 cursor-pointer items-center gap-1.5 rounded-xl border-2 border-brand-purple/25 px-4 text-sm font-bold text-brand-navy"
                >
                  <RotateCcw className="h-4 w-4" />
                  Try again
                </motion.button>
              ) : null}
              {!allRight ? (
                <motion.button
                  type="button"
                  whileTap={canCheck ? m.press : undefined}
                  disabled={!canCheck}
                  onClick={() => setChecked(true)}
                  title={
                    canCheck
                      ? undefined
                      : `Fill ${emptyZones} more ${emptyZones === 1 ? 'box' : 'boxes'} first`
                  }
                  className="font-baloo min-h-11 cursor-pointer rounded-xl bg-brand-pink px-6 text-sm font-bold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Check My Answers
                </motion.button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      {/* Travelling copy: rides above the image instead of being clipped. */}
      <DragOverlay dropAnimation={null}>
        {dragging ? (
          <div
            className="min-h-11 rotate-3 rounded-full border-2 border-brand-pink bg-white px-4 py-2 text-sm font-bold text-brand-pink shadow-xl"
            style={{ cursor: 'grabbing' }}
          >
            {labelById[dragging]}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

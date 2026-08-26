'use client';

import { useEffect, useRef, useState } from 'react';
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
import { Check, RotateCcw, Star, X } from 'lucide-react';

import { useRegisterDrawingSurface } from '@/components/session/DrawingSurface';
import { usePaneMotion } from './motion';
import type { DropZoneSpec, LabelSpec, PaneProps } from './shared';

export function DragDropPane({
  payload,
  assignments,
  patchCurrent,
  onCtaChange,
  onComplete,
}: Omit<PaneProps, 'state' | 'role'> & {
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
        onCtaChange={onCtaChange}
        onComplete={onComplete}
      />
    );
  }

  // ── 1.0: two-column tap-to-assign (flat string lists) ─────────────────────
  return (
    <LegacyDragDrop
      payload={payload}
      assignments={assignments}
      patchCurrent={patchCurrent}
      onCtaChange={onCtaChange}
      onComplete={onComplete}
    />
  );
}

function LegacyDragDrop({
  payload,
  assignments,
  patchCurrent,
  onCtaChange,
  onComplete,
}: {
  payload: Record<string, unknown>;
  assignments: Record<string, string>;
  patchCurrent: (patch: Record<string, unknown>) => void;
  onCtaChange?: PaneProps['onCtaChange'];
  onComplete?: PaneProps['onComplete'];
}) {
  const m = usePaneMotion();
  const items = (payload.items as string[]) ?? [];
  const zones = (payload.drop_zones as string[]) ?? [];
  const [picked, setPicked] = useState<string | null>(null);

  /*
   * A 1.0 activity has no `accepts` on its zones, so there is nothing to grade
   * — but it still needs a way to say "done". This branch used to receive no
   * `onCtaChange` at all, which meant the dock kept whatever the *previous*
   * activity had published: a stale button belonging to another screen.
   */
  const allPlaced = items.length > 0 && Object.keys(assignments).length >= items.length;
  useEffect(() => {
    if (!onCtaChange) return;
    onCtaChange({
      label: 'Complete Activity',
      tone: 'gold',
      icon: Check,
      iconTrailing: true,
      disabled: !allPlaced,
      run: () => onComplete?.(),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onCtaChange, onComplete, allPlaced]);

  function assign(zone: string, item: string) {
    patchCurrent({ assignments: { ...assignments, [zone]: item } });
    setPicked(null);
  }

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div>
        <p className="mb-2 text-xs font-bold uppercase" style={{ color: 'var(--room-ink-strong)' }}>Items</p>
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
                  : 'border-white/20 bg-white/10'
              }`}
            >
              {item}
            </motion.button>
          ))}
        </div>
        <p className="mt-2 text-xs" style={{ color: 'var(--room-ink-strong)' }}>
          {picked ? `Tap a zone for “${picked}”.` : 'Tap an item, then a drop zone.'}
        </p>
      </div>
      <div>
        <p className="mb-2 text-xs font-bold uppercase" style={{ color: 'var(--room-ink-strong)' }}>Drop zones</p>
        <div className="space-y-2">
          {zones.map((zone) => (
            <motion.button
              key={zone}
              type="button"
              disabled={!picked}
              whileTap={picked ? m.press : undefined}
              onClick={() => picked && assign(zone, picked)}
              className="w-full cursor-pointer rounded-xl border-2 border-dashed border-brand-teal/50 bg-brand-teal/5 px-4 py-6 text-left transition-opacity disabled:cursor-not-allowed disabled:opacity-45"
            >
              <span className="block text-xs font-bold text-brand-teal">{zone}</span>
              <span className="mt-1 block font-semibold" style={{ color: 'var(--room-ink)' }}>
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

/**
 * The chip palette, cycled by position.
 *
 * The screens give each label its own colour rather than making them all pink.
 * That is not decoration: colour is a second handle on which chip is which
 * while it is mid-drag and its text is under the child's finger.
 */
const CHIP_COLORS = [
  { fill: '#b4476b', edge: 'rgba(255,175,200,0.75)', ink: '#ffe4ec' },
  { fill: '#2f7c99', edge: 'rgba(160,225,245,0.75)', ink: '#dcf4ff' },
  { fill: '#6d4b96', edge: 'rgba(200,175,240,0.75)', ink: '#ece0ff' },
  { fill: '#8a7350', edge: 'rgba(240,215,150,0.75)', ink: '#fff2d4' },
];

function DraggableLabel({
  id,
  text,
  picked,
  colorIndex,
  onPick,
}: {
  id: string;
  text: string;
  picked: boolean;
  colorIndex: number;
  onPick: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id });
  const c = CHIP_COLORS[colorIndex % CHIP_COLORS.length];
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
      style={{
        minHeight: 56,
        borderRadius: 12,
        background: c.fill,
        borderColor: picked ? '#ffffff' : c.edge,
        color: c.ink,
        opacity: isDragging ? 0.4 : 1,
      }}
      className="cursor-grab touch-none border-2 border-dashed px-5 font-karla text-[15px] font-bold shadow-sm transition-all active:cursor-grabbing"
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

  // Dashed white while empty — it has to read as "something goes here" over an
  // arbitrary illustration, and white is the only outline that survives both a
  // bright sky and a dark forest underneath. Graded states go solid brand.
  const skinStyle: React.CSSProperties =
    verdict === 'right'
      ? { borderStyle: 'solid', borderColor: 'var(--c-green)', background: 'rgba(95,211,150,0.30)' }
      : verdict === 'wrong'
        ? { borderStyle: 'solid', borderColor: 'var(--c-pink)', background: 'rgba(228,87,126,0.26)' }
        : isOver
          ? { borderStyle: 'solid', borderColor: '#ffffff', background: 'rgba(255,255,255,0.34)' }
          : armed
            ? { borderColor: 'rgba(255,255,255,0.95)', background: 'rgba(255,255,255,0.20)' }
            : { borderColor: 'rgba(255,255,255,0.75)', background: 'rgba(255,255,255,0.10)' };

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
      className="absolute flex cursor-pointer items-center justify-center border-2 border-dashed text-center transition-colors"
      style={{
        left: `${zone.x}%`,
        top: `${zone.y}%`,
        width: `${zone.w}%`,
        height: `${zone.h}%`,
        borderRadius: 10,
        ...skinStyle,
      }}
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
  onCtaChange,
  onComplete,
}: {
  imageUrl: string;
  labels: LabelSpec[];
  zones: DropZoneSpec[];
  assignments: Record<string, string>;
  onAssign: (next: Record<string, string>) => void;
  onCtaChange?: PaneProps['onCtaChange'];
  onComplete?: PaneProps['onComplete'];
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

  /*
   * "How Did We Do?" lives in the room's dock, per the screens.
   *
   * Once graded it becomes "Try Again" when something is wrong, so the same
   * button carries the whole loop rather than a second one appearing beside it.
   */
  useEffect(() => {
    if (!onCtaChange) return;
    if (!gradable) {
      /*
       * No zone declares what it `accepts`, so there is nothing to mark. This
       * used to publish `null` — leaving the screen with no primary action at
       * all and no way to signal it was finished.
       */
      onCtaChange({
        label: 'Complete Activity',
        tone: 'gold',
        icon: Check,
        iconTrailing: true,
        disabled: !canCheck,
        run: () => onComplete?.(),
      });
      return;
    }
    if (checked && !allRight) {
      onCtaChange({
        label: 'Try Again',
        tone: 'pink',
        icon: RotateCcw,
        run: () => tryAgainRef.current(),
      });
      return;
    }
    if (checked && allRight) {
      // Everything is in its place; the loop is over, so the button finishes.
      onCtaChange({
        label: 'Complete Activity',
        tone: 'gold',
        icon: Check,
        iconTrailing: true,
        run: () => onComplete?.(),
      });
      return;
    }
    onCtaChange({
      label: 'How Did We Do?',
      tone: 'pink',
      icon: Star,
      iconTrailing: true,
      disabled: !canCheck,
      run: () => setChecked(true),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onCtaChange, onComplete, gradable, checked, allRight, canCheck]);

  /**
   * Placement history, for the dock's Undo and Redo.
   *
   * The mockup for this activity shows Undo and Redo and no ink tools at all —
   * moving a chip back is the only reversible thing here. `assignments` is
   * whole-state and synced, so a step is just a previous copy of it; the redo
   * stack stays local, exactly as the drawing pane's does, because redo is a
   * private "I changed my mind" rather than shared truth.
   */
  const [past, setPast] = useState<Record<string, string>[]>([]);
  const [future, setFuture] = useState<Record<string, string>[]>([]);

  /** Record the current state, then move to `next`. */
  function commitAssign(next: Record<string, string>) {
    setPast((p) => [...p, assignments]);
    setFuture([]);
    onAssign(next);
  }

  function undoAssign() {
    if (past.length === 0) return;
    const prev = past[past.length - 1];
    setPast((p) => p.slice(0, -1));
    setFuture((f) => [...f, assignments]);
    // Stepping back past a check has to drop the verdict too, or the child sees
    // green ticks on zones they have just emptied.
    setChecked(false);
    onAssign(prev);
  }

  function redoAssign() {
    if (future.length === 0) return;
    const next = future[future.length - 1];
    setFuture((f) => f.slice(0, -1));
    setPast((p) => [...p, assignments]);
    setChecked(false);
    onAssign(next);
  }

  /*
   * A host Reset republishes the activity's default state, which arrives here as
   * an external change with no history entry behind it. Dropping the stacks when
   * the board comes back empty keeps Reset meaning what it says — a reset you
   * can undo did not reset.
   */
  const assignedCount = Object.keys(assignments).length;
  useEffect(() => {
    if (assignedCount === 0) {
      setPast([]);
      setFuture([]);
    }
  }, [assignedCount]);

  useRegisterDrawingSurface(
    () => ({
      // Nothing to draw on: this activity is chips and zones.
      caps: { pen: false, eraser: false, fill: false, shapes: false, undoRedo: true },
      tool: 'select' as const,
      setTool: () => {},
      undo: undoAssign,
      redo: redoAssign,
      clear: () => commitAssign({}),
      depth: { undo: past.length, redo: future.length },
    }),
    [assignments, past, future],
  );

  function place(zoneId: string, labelId: string) {
    const next: Record<string, string> = {};
    for (const [z, l] of Object.entries(assignments)) {
      if (l !== labelId && z !== zoneId) next[z] = l;
    }
    next[zoneId] = labelId;
    commitAssign(next);
    setPicked(null);
    setChecked(false);
  }

  function handleDragEnd(e: DragEndEvent) {
    setDragging(null);
    const labelId = String(e.active.id);
    const zoneId = e.over ? String(e.over.id) : null;
    if (zoneId) place(zoneId, labelId);
  }

  // The CTA effect above runs before `tryAgain` is defined in source order, and
  // the function closes over `assignments`, so it is reached through a ref that
  // always holds the current version.
  const tryAgainRef = useRef<() => void>(() => {});

  function tryAgain() {
    setChecked(false);
    // Clear only the wrong ones: re-doing correct work is a punishment.
    const kept: Record<string, string> = {};
    for (const z of zones) {
      if (z.accepts && assignments[z.id] === z.accepts) kept[z.id] = assignments[z.id];
    }
    commitAssign(kept);
  }
  tryAgainRef.current = tryAgain;

  return (
    <DndContext
      sensors={sensors}
      onDragStart={(e: DragStartEvent) => setDragging(String(e.active.id))}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setDragging(null)}
    >
      <div className="space-y-4">
        {/* Hugs the image for the same reason as the hotspot frame: the drop
            zones are percentages of this box. */}
        <div
          className="relative mx-auto w-fit overflow-hidden rounded-2xl"
          style={{ border: '1px solid var(--room-chrome-line)', background: 'rgba(0,0,0,0.18)' }}
        >
          {/* Drop zones are positioned as a percentage of this frame, so the
              frame has to *be* the image — letterboxing inside a wider box moved
              every zone off target. Sizing by height keeps the chips below it on
              screen. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageUrl}
            alt=""
            className="mx-auto block h-auto w-auto max-w-full object-contain"
            style={{ maxHeight: 'min(44vh, 360px)' }}
          />
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
                  // Indexed against the authored order, not the filtered one,
                  // so a chip keeps its colour as its neighbours are used up.
                  colorIndex={labels.findIndex((x) => x.id === l.id)}
                  onPick={() => setPicked(picked === l.id ? null : l.id)}
                />
              </motion.div>
            ))}
          </AnimatePresence>
        </motion.div>

        {/* The instruction is the only thing telling a child *how* to play, so
            it takes near-full ink rather than the muted tone — at 13px on the
            dark card, --room-ink-soft rendered close to invisible. */}
        <p
          className="text-center font-karla text-[14px]"
          style={{ color: 'var(--room-ink-strong)' }}
        >
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
                  className="flex items-center gap-2 rounded-2xl px-4 py-3 font-karla text-[14px] font-bold"
                  style={
                    allRight
                      ? { background: 'rgba(95,211,150,0.16)', color: 'var(--c-green)' }
                      : { background: 'rgba(240,199,94,0.20)', color: 'var(--room-accent)' }
                  }
                  role="status"
                >
                  {allRight ? <Check className="h-4 w-4" strokeWidth={3} /> : null}
                  {allRight
                    ? 'Every one right — brilliant!'
                    : `${rightCount} of ${gradedZones.length} right — try the others again.`}
                </motion.div>
              ) : null}
            </AnimatePresence>

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

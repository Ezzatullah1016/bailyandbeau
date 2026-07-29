'use client';

import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { RoomContext } from '@livekit/components-react';
import { Room } from 'livekit-client';
import ActivityRoom from '@/components/activity/ActivityRoom';
import {
  adminCreateActivity,
  adminUpdateActivity,
  adminUploadMedia,
  type ActivityConfigData,
  type BookOption,
} from '@/lib/api';
import type {
  ActivityEnvelope,
  ActivityType,
  DragDropZoneV11,
  QuizQuestionV11,
} from '@/components/activity/types';

type Draft = {
  title: string;
  bookId: string;
  instructions: string;
  imageUrl: string;
  // quiz
  questions: QuizQuestionV11[];
  revealMode: 'instant' | 'host_controlled';
  // drag & drop
  labels: { id: string; text: string }[];
  zones: DragDropZoneV11[];
  // drawing
  palette: string[];
  brushSizes: number[];
  allowEraser: boolean;
  allowSubmit: boolean;
  // hotspot
  hotspots: { id: string; x: number; y: number; w: number; h: number; content: string }[];
  // publishing
  isActive: boolean;
  sortOrder: number;
};

/**
 * Default crayon colours offered to the child in a drawing activity.
 *
 * These stay literal hex strings rather than the `brand-*` Tailwind tokens: the
 * values are serialised into `config.payload.palette` and sent to the server,
 * where a class name would be meaningless. Keep in step with the brand sheet in
 * `app/globals.css`. Green is not a brand colour — it is here because a child's
 * palette without one is a poor palette.
 */
const BRAND_PALETTE = ['#3d3b62', '#c84a71', '#f0c75e', '#3b85a6', '#764f84', '#22c55e'];

function emptyDraft(bookId: string): Draft {
  return {
    title: '',
    bookId,
    instructions: '',
    imageUrl: '',
    questions: [{ id: 'q1', prompt: '', options: ['', ''], correct_index: 0 }],
    revealMode: 'instant',
    labels: [],
    zones: [],
    palette: BRAND_PALETTE,
    brushSizes: [3, 6, 12, 24],
    allowEraser: true,
    allowSubmit: true,
    hotspots: [],
    // New activities start as drafts: publishing is an explicit act, so an
    // unfinished activity can never appear in a live session by accident.
    isActive: false,
    sortOrder: 0,
  };
}

let idCounter = 0;
function nextId(prefix: string) {
  idCounter += 1;
  return `${prefix}${idCounter}`;
}

// Build the schema-1.1 envelope from the draft for a given type.
function buildEnvelope(type: ActivityType, d: Draft): ActivityEnvelope {
  const ui = { title: d.title || 'Activity', instructions: d.instructions };
  let payload: Record<string, unknown> = {};
  if (type === 'quiz') {
    payload = { questions: d.questions, reveal_mode: d.revealMode };
  } else if (type === 'drag_drop') {
    payload = { image_url: d.imageUrl, labels: d.labels, drop_zones: d.zones };
  } else if (type === 'drawing') {
    payload = {
      background_url: d.imageUrl || undefined,
      palette: d.palette,
      brush_sizes: d.brushSizes,
      allow_eraser: d.allowEraser,
      allow_submit: d.allowSubmit,
    };
  } else {
    payload = { image_url: d.imageUrl, display: 'popup', hotspots: d.hotspots };
  }
  return { schema_version: '1.1', activity_type: type, book_id: d.bookId, ui, payload };
}

// Turn the draft into a preview ActivityConfigData for the live renderer.
function previewConfig(type: ActivityType, d: Draft): ActivityConfigData {
  return {
    id: 'preview',
    book: d.bookId,
    title: d.title || 'Preview',
    activity_type: type,
    config: buildEnvelope(type, d),
    sort_order: 0,
    is_active: true,
  };
}

/** Click-on-image helper: returns x/y as a percentage of the rendered image. */
function ImageCanvasEditor({
  imageUrl,
  boxes,
  onAddBox,
}: {
  imageUrl: string;
  boxes: { id: string; x: number; y: number; w: number; h: number }[];
  onAddBox: (x: number, y: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  function handleClick(e: React.MouseEvent) {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    onAddBox(Math.max(0, Math.min(x, 92)), Math.max(0, Math.min(y, 88)));
  }
  return (
    <div ref={ref} onClick={handleClick} className="relative w-full cursor-crosshair rounded-xl overflow-hidden border border-brand-purple/30">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={imageUrl} alt="" className="w-full h-auto block max-h-[360px] object-contain mx-auto select-none pointer-events-none" />
      <div className="absolute inset-0">
        {boxes.map((b) => (
          <div
            key={b.id}
            className="absolute border-2 border-brand-gold bg-brand-gold/25 rounded"
            style={{ left: `${b.x}%`, top: `${b.y}%`, width: `${b.w}%`, height: `${b.h}%` }}
          />
        ))}
      </div>
    </div>
  );
}

export function ActivityBuilder({
  type,
  books,
  existing,
}: {
  type: ActivityType;
  books: BookOption[];
  existing?: ActivityConfigData;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(() => {
    const base = emptyDraft(books[0]?.id ?? '');
    if (!existing) return base;
    const p = existing.config.payload as Record<string, unknown>;
    return {
      ...base,
      title: existing.title,
      bookId: existing.book,
      instructions: existing.config.ui.instructions ?? '',
      imageUrl: (p.image_url as string) ?? (p.background_url as string) ?? '',
      questions: (p.questions as QuizQuestionV11[]) ?? base.questions,
      labels: (p.labels as { id: string; text: string }[]) ?? [],
      zones: (p.drop_zones as DragDropZoneV11[]) ?? [],
      hotspots: (p.hotspots as Draft['hotspots']) ?? [],
      isActive: existing.is_active,
      sortOrder: existing.sort_order ?? 0,
    };
  });
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const patch = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }));

  const preview = useMemo(() => previewConfig(type, draft), [type, draft]);
  // A detached (never-connected) Room satisfies ActivityRoom's useRoomContext
  // so the live preview renders the exact runtime component.
  const previewRoom = useMemo(() => new Room(), []);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const url = await adminUploadMedia(file);
      patch({ imageUrl: url });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setUploading(false);
    }
  }

  /**
   * `publish` decides visibility in the Activity Room. It is sent on update as
   * well as create — without it there was no way to take a live activity back
   * down once it had been published.
   */
  async function handleSave(publish: boolean) {
    setSaving(true);
    setError(null);
    try {
      const envelope = buildEnvelope(type, draft);
      const common = {
        title: draft.title,
        config: envelope,
        sort_order: draft.sortOrder,
        is_active: publish,
      };
      if (existing) {
        await adminUpdateActivity(existing.id, common);
      } else {
        await adminCreateActivity({ ...common, book: draft.bookId, activity_type: type });
      }
      patch({ isActive: publish });
      router.push('/admin/activities');
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Could not save. Check the fields and try again.',
      );
    } finally {
      setSaving(false);
    }
  }

  const needsImage = type !== 'quiz';

  return (
    <div className="grid lg:grid-cols-2 gap-8">
      {/* ── Editor ── */}
      <div className="space-y-5">
        <div>
          <label className="block text-xs font-bold uppercase tracking-wider text-brand-purple mb-1">Book</label>
          <select
            value={draft.bookId}
            onChange={(e) => patch({ bookId: e.target.value })}
            className="w-full px-4 py-2.5 rounded-xl border border-brand-blush bg-white text-sm"
          >
            {books.map((b) => (
              <option key={b.id} value={b.id}>{b.title}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-bold uppercase tracking-wider text-brand-purple mb-1">Activity title</label>
          <input
            value={draft.title}
            onChange={(e) => patch({ title: e.target.value })}
            className="w-full px-4 py-2.5 rounded-xl border border-brand-blush bg-white text-sm"
            placeholder="e.g. Match the Feeling"
          />
        </div>

        <div>
          <label className="block text-xs font-bold uppercase tracking-wider text-brand-purple mb-1">Instructions</label>
          <input
            value={draft.instructions}
            onChange={(e) => patch({ instructions: e.target.value })}
            className="w-full px-4 py-2.5 rounded-xl border border-brand-blush bg-white text-sm"
            placeholder="Shown to the child at the top"
          />
        </div>

        {needsImage && (
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-brand-purple mb-1">
              Illustration {type === 'drawing' ? '(coloring background, optional)' : ''}
            </label>
            <input type="file" accept="image/*" onChange={handleUpload} className="text-sm" />
            {uploading && <p className="text-xs text-brand-purple mt-1">Uploading…</p>}
            {draft.imageUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={draft.imageUrl} alt="" className="mt-2 max-h-32 rounded-lg border border-brand-blush" />
            )}
          </div>
        )}

        {type === 'quiz' && <QuizEditor draft={draft} patch={patch} />}
        {type === 'drag_drop' && <DragDropEditor draft={draft} patch={patch} nextId={nextId} />}
        {type === 'hotspot' && <HotspotEditor draft={draft} patch={patch} nextId={nextId} />}
        {type === 'drawing' && (
          <label className="flex items-center gap-2 text-sm text-brand-navy">
            <input
              type="checkbox"
              checked={draft.allowSubmit}
              onChange={(e) => patch({ allowSubmit: e.target.checked })}
            />
            Let the child submit/save their artwork
          </label>
        )}

        <div>
          <label
            htmlFor="bb-sort-order"
            className="block text-xs font-bold uppercase tracking-wider text-brand-purple mb-1"
          >
            Order in the activity list
          </label>
          <input
            id="bb-sort-order"
            type="number"
            min={0}
            value={draft.sortOrder}
            onChange={(e) => patch({ sortOrder: Number(e.target.value) || 0 })}
            className="w-28 px-4 py-2.5 rounded-xl border border-brand-blush bg-white text-sm"
          />
          <p className="mt-1 text-xs text-stone-500">Lower numbers appear first.</p>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex flex-wrap items-center gap-3 pt-2">
          <button
            type="button"
            onClick={() => handleSave(true)}
            disabled={saving || !draft.title || !draft.bookId}
            className="font-baloo cursor-pointer px-6 py-3 rounded-xl bg-brand-pink text-white font-bold text-sm transition-colors hover:bg-brand-purple disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Publish'}
          </button>
          <button
            type="button"
            onClick={() => handleSave(false)}
            disabled={saving || !draft.title || !draft.bookId}
            className="font-baloo cursor-pointer px-6 py-3 rounded-xl border-2 border-brand-blush text-brand-navy font-bold text-sm transition-colors hover:bg-brand-blush/40 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Save draft
          </button>
          <button
            type="button"
            onClick={() => router.push('/admin/activities')}
            className="font-baloo cursor-pointer px-4 py-3 rounded-xl text-brand-navy/70 font-bold text-sm transition-colors hover:text-brand-navy"
          >
            Cancel
          </button>
          {existing && (
            <span className="text-xs font-bold uppercase tracking-wider text-stone-500">
              Currently {draft.isActive ? 'live' : 'a draft'}
            </span>
          )}
        </div>
        <p className="text-xs text-stone-500">
          Drafts are saved but stay hidden from the Activity Room until published.
        </p>
      </div>

      {/* ── Live preview (real renderer) ── */}
      <div>
        <p className="text-xs font-bold uppercase tracking-wider text-brand-purple mb-2">Preview — exactly what the child sees</p>
        <div className="rounded-2xl border border-brand-purple/20 bg-brand-navy/5 p-3">
          <RoomContext.Provider value={previewRoom}>
            <ActivityRoom
              role="host"
              activities={[preview]}
              open
              variant="stage"
              initialIndex={0}
              onClose={() => {}}
            />
          </RoomContext.Provider>
        </div>
      </div>
    </div>
  );
}

// ── Per-type editors ─────────────────────────────────────────────────────────

function QuizEditor({ draft, patch }: { draft: Draft; patch: (p: Partial<Draft>) => void }) {
  function updateQ(i: number, q: Partial<QuizQuestionV11>) {
    const next = draft.questions.map((qq, idx) => (idx === i ? { ...qq, ...q } : qq));
    patch({ questions: next });
  }
  return (
    <div className="space-y-4">
      {draft.questions.map((q, i) => (
        <div key={q.id} className="rounded-xl border border-brand-blush p-4 space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-xs font-bold text-brand-purple">Question {i + 1}</span>
            {draft.questions.length > 1 && (
              <button
                onClick={() => patch({ questions: draft.questions.filter((_, idx) => idx !== i) })}
                className="text-xs text-red-500 font-bold"
              >
                Remove
              </button>
            )}
          </div>
          <input
            value={q.prompt}
            onChange={(e) => updateQ(i, { prompt: e.target.value })}
            placeholder="Question text"
            className="w-full px-3 py-2 rounded-lg border border-brand-blush text-sm"
          />
          {q.options.map((opt, oi) => (
            <div key={oi} className="flex items-center gap-2">
              <input
                type="radio"
                name={`correct-${q.id}`}
                checked={q.correct_index === oi}
                onChange={() => updateQ(i, { correct_index: oi })}
                title="Mark as correct answer"
              />
              <input
                value={opt}
                onChange={(e) => updateQ(i, { options: q.options.map((o, idx) => (idx === oi ? e.target.value : o)) })}
                placeholder={`Option ${oi + 1}`}
                className="flex-1 px-3 py-1.5 rounded-lg border border-brand-blush text-sm"
              />
              {q.options.length > 2 && (
                <button
                  onClick={() => updateQ(i, { options: q.options.filter((_, idx) => idx !== oi), correct_index: 0 })}
                  className="text-red-400 text-sm"
                >
                  ×
                </button>
              )}
            </div>
          ))}
          {q.options.length < 4 && (
            <button
              onClick={() => updateQ(i, { options: [...q.options, ''] })}
              className="text-xs font-bold text-brand-teal"
            >
              + Add option
            </button>
          )}
        </div>
      ))}
      <button
        onClick={() =>
          patch({ questions: [...draft.questions, { id: nextId('q'), prompt: '', options: ['', ''], correct_index: 0 }] })
        }
        className="text-sm font-bold text-brand-purple"
      >
        + Add question
      </button>
    </div>
  );
}

function DragDropEditor({
  draft,
  patch,
  nextId: mkId,
}: {
  draft: Draft;
  patch: (p: Partial<Draft>) => void;
  nextId: (p: string) => string;
}) {
  return (
    <div className="space-y-3">
      <p className="text-xs font-bold uppercase tracking-wider text-brand-purple">Drop zones — click on the image to place</p>
      {draft.imageUrl ? (
        <ImageCanvasEditor
          imageUrl={draft.imageUrl}
          boxes={draft.zones}
          onAddBox={(x, y) => {
            const id = mkId('z');
            patch({ zones: [...draft.zones, { id, x, y, w: 16, h: 20, label: `Zone ${draft.zones.length + 1}` }] });
          }}
        />
      ) : (
        <p className="text-sm text-stone-500">Upload an illustration first.</p>
      )}

      <p className="text-xs font-bold uppercase tracking-wider text-brand-purple pt-2">Draggable labels</p>
      {draft.labels.map((l, i) => (
        <div key={l.id} className="flex items-center gap-2">
          <input
            value={l.text}
            onChange={(e) => patch({ labels: draft.labels.map((ll, idx) => (idx === i ? { ...ll, text: e.target.value } : ll)) })}
            placeholder="Label text"
            className="flex-1 px-3 py-1.5 rounded-lg border border-brand-blush text-sm"
          />
          <select
            value={draft.zones.find((z) => z.accepts === l.id)?.id ?? ''}
            onChange={(e) => {
              const zoneId = e.target.value;
              patch({
                zones: draft.zones.map((z) =>
                  z.id === zoneId ? { ...z, accepts: l.id } : z.accepts === l.id ? { ...z, accepts: undefined } : z,
                ),
              });
            }}
            className="px-2 py-1.5 rounded-lg border border-brand-blush text-xs"
            title="Correct zone"
          >
            <option value="">Correct zone…</option>
            {draft.zones.map((z) => (
              <option key={z.id} value={z.id}>{z.label ?? z.id}</option>
            ))}
          </select>
          <button onClick={() => patch({ labels: draft.labels.filter((_, idx) => idx !== i) })} className="text-red-400">×</button>
        </div>
      ))}
      <button
        onClick={() => patch({ labels: [...draft.labels, { id: mkId('l'), text: '' }] })}
        className="text-sm font-bold text-brand-teal"
      >
        + Add label
      </button>
    </div>
  );
}

function HotspotEditor({
  draft,
  patch,
  nextId: mkId,
}: {
  draft: Draft;
  patch: (p: Partial<Draft>) => void;
  nextId: (p: string) => string;
}) {
  return (
    <div className="space-y-3">
      <p className="text-xs font-bold uppercase tracking-wider text-brand-purple">Discovery spots — click on the image to place</p>
      {draft.imageUrl ? (
        <ImageCanvasEditor
          imageUrl={draft.imageUrl}
          boxes={draft.hotspots}
          onAddBox={(x, y) => {
            const id = mkId('h');
            patch({ hotspots: [...draft.hotspots, { id, x, y, w: 16, h: 20, content: '' }] });
          }}
        />
      ) : (
        <p className="text-sm text-stone-500">Upload an illustration first.</p>
      )}
      {draft.hotspots.map((h, i) => (
        <div key={h.id} className="flex items-center gap-2">
          <span className="text-xs font-bold text-brand-purple w-6">{i + 1}</span>
          <input
            value={h.content}
            onChange={(e) => patch({ hotspots: draft.hotspots.map((hh, idx) => (idx === i ? { ...hh, content: e.target.value } : hh)) })}
            placeholder="Learning text shown in the popup"
            className="flex-1 px-3 py-1.5 rounded-lg border border-brand-blush text-sm"
          />
          <button onClick={() => patch({ hotspots: draft.hotspots.filter((_, idx) => idx !== i) })} className="text-red-400">×</button>
        </div>
      ))}
    </div>
  );
}

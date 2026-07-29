'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Palette, Puzzle, Search, Star } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import {
  adminListActivities,
  adminDeleteActivity,
  adminUpdateActivity,
  type ActivityConfigData,
} from '@/lib/api';

const TYPES: { type: string; label: string; Icon: LucideIcon }[] = [
  { type: 'quiz', label: 'Story Quest', Icon: Star },
  { type: 'drag_drop', label: 'Place & Play', Icon: Puzzle },
  { type: 'hotspot', label: 'Discovery Spots', Icon: Search },
  { type: 'drawing', label: 'Create Together', Icon: Palette },
];

const TYPE_ICON: Record<string, LucideIcon> = Object.fromEntries(
  TYPES.map((t) => [t.type, t.Icon]),
);

export default function AdminActivitiesPage() {
  const [activities, setActivities] = useState<ActivityConfigData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Ids mid-flight, so a row's toggle disables itself rather than the whole list.
  const [busy, setBusy] = useState<string[]>([]);

  function load() {
    setLoading(true);
    adminListActivities()
      .then(setActivities)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load.'))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
  }, []);

  async function handleDelete(id: string) {
    if (!confirm('Delete this activity? This cannot be undone.')) return;
    setError(null);
    try {
      await adminDeleteActivity(id);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete.');
    }
  }

  /** Publish or unpublish in place — the row updates without a full reload. */
  async function handleToggle(activity: ActivityConfigData) {
    const next = !activity.is_active;
    setBusy((b) => [...b, activity.id]);
    setError(null);
    try {
      await adminUpdateActivity(activity.id, { is_active: next });
      setActivities((list) =>
        list.map((a) => (a.id === activity.id ? { ...a, is_active: next } : a)),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not change the status.');
    } finally {
      setBusy((b) => b.filter((id) => id !== activity.id));
    }
  }

  return (
    <div className="min-h-screen bg-[#faf7f6] font-karla text-[#1d1b16] p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="font-baloo text-3xl font-bold text-brand-navy mb-1">Activities</h1>
        <p className="text-stone-600 mb-6">
          Create an activity, preview it, then publish it to the Activity Room.
        </p>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
          {TYPES.map(({ type, label, Icon }) => (
            <Link
              key={type}
              href={`/admin/activities/new/${type}`}
              className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-brand-blush bg-white p-4 transition-colors hover:border-brand-purple hover:bg-brand-blush/20"
            >
              <Icon className="h-7 w-7 text-brand-purple" aria-hidden />
              <span className="font-baloo text-sm font-bold text-brand-navy text-center">
                New {label}
              </span>
            </Link>
          ))}
        </div>

        {loading && <p className="text-stone-600">Loading…</p>}
        {error && (
          <p role="alert" className="mb-3 text-sm text-red-700">
            {error}
          </p>
        )}

        <div className="space-y-2">
          {activities.map((a) => {
            const Icon = TYPE_ICON[a.activity_type] ?? Star;
            const pending = busy.includes(a.id);
            return (
              <div
                key={a.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brand-blush bg-white px-4 py-3"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <Icon className="h-5 w-5 shrink-0 text-brand-purple" aria-hidden />
                  <div className="min-w-0">
                    <span className="font-baloo font-bold text-brand-navy">{a.title}</span>
                    <span className="ml-2 text-xs uppercase tracking-wide text-stone-500">
                      {a.activity_type.replace('_', ' ')}
                    </span>
                  </div>
                  {/* Dark ink on the brand surfaces: white on gold fails contrast. */}
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide ${
                      a.is_active ? 'bg-brand-teal text-white' : 'bg-brand-gold text-brand-navy'
                    }`}
                  >
                    {a.is_active ? 'Live' : 'Draft'}
                  </span>
                </div>
                {/* min-h-11 + px: these were 20px-tall text links, under the
                    44px minimum tap target and fiddly to hit even with a mouse. */}
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => handleToggle(a)}
                    disabled={pending}
                    className="inline-flex min-h-11 cursor-pointer items-center rounded-lg px-3 text-sm font-bold text-brand-purple transition-colors hover:bg-brand-blush/40 hover:text-brand-navy disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {pending ? '…' : a.is_active ? 'Unpublish' : 'Publish'}
                  </button>
                  <Link
                    href={`/admin/activities/edit/${a.id}`}
                    className="inline-flex min-h-11 cursor-pointer items-center rounded-lg px-3 text-sm font-bold text-brand-teal transition-colors hover:bg-brand-blush/40 hover:text-brand-navy"
                  >
                    Edit
                  </Link>
                  <button
                    type="button"
                    onClick={() => handleDelete(a.id)}
                    className="inline-flex min-h-11 cursor-pointer items-center rounded-lg px-3 text-sm font-bold text-red-600 transition-colors hover:bg-red-50 hover:text-red-800"
                  >
                    Delete
                  </button>
                </div>
              </div>
            );
          })}
          {!loading && activities.length === 0 && (
            <p className="text-stone-600">No activities yet — create one above.</p>
          )}
        </div>
      </div>
    </div>
  );
}

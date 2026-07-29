'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { ActivityBuilder } from '@/components/admin/ActivityBuilder';
import { adminListActivities, listBooks, type ActivityConfigData, type BookOption } from '@/lib/api';
import type { ActivityType } from '@/components/activity/types';

export default function EditActivityPage() {
  const { id } = useParams<{ id: string }>();
  const [books, setBooks] = useState<BookOption[]>([]);
  const [activity, setActivity] = useState<ActivityConfigData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([listBooks(), adminListActivities()])
      .then(([b, acts]) => {
        setBooks(b);
        const found = acts.find((a) => a.id === id) ?? null;
        if (!found) setError('Activity not found.');
        setActivity(found);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load.'))
      .finally(() => setLoading(false));
  }, [id]);

  return (
    <div className="min-h-screen bg-[#faf7f6] font-karla text-[#1d1b16] p-8">
      <div className="max-w-6xl mx-auto">
        <h1 className="font-baloo text-3xl font-bold text-brand-navy mb-6">Edit activity</h1>
        {loading && <p className="text-stone-500">Loading…</p>}
        {error && <p className="text-red-600">{error}</p>}
        {activity && (
          <ActivityBuilder type={activity.activity_type as ActivityType} books={books} existing={activity} />
        )}
      </div>
    </div>
  );
}

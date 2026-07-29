'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { ActivityBuilder } from '@/components/admin/ActivityBuilder';
import { listBooks, type BookOption } from '@/lib/api';
import type { ActivityType } from '@/components/activity/types';

const VALID: ActivityType[] = ['quiz', 'drag_drop', 'hotspot', 'drawing'];

export default function NewActivityPage() {
  const { type } = useParams<{ type: string }>();
  const [books, setBooks] = useState<BookOption[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listBooks().then(setBooks).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (!VALID.includes(type as ActivityType)) {
    return <p className="p-8">Unknown activity type.</p>;
  }

  return (
    <div className="min-h-screen bg-[#faf7f6] font-karla text-[#1d1b16] p-8">
      <div className="max-w-6xl mx-auto">
        <h1 className="font-baloo text-3xl font-bold text-brand-navy mb-6 capitalize">New {type.replace('_', ' ')} activity</h1>
        {loading ? (
          <p className="text-stone-500">Loading books…</p>
        ) : books.length === 0 ? (
          <p className="text-stone-500">No books available. Create a book first.</p>
        ) : (
          <ActivityBuilder type={type as ActivityType} books={books} />
        )}
      </div>
    </div>
  );
}

'use client';

import { useMemo, useState } from 'react';
import type { IncidentRecord } from '@/lib/factnote/types';
import { FactnoteHeader, RecordRow } from './common';
import { FactnoteTabBar } from './TabBar';

type Filter = 'all' | 'positive' | 'conflict' | 'repair' | 'unanalyzed';

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: 'all', label: 'すべて' },
  { id: 'positive', label: '良い出来事' },
  { id: 'conflict', label: '衝突' },
  { id: 'repair', label: '修復' },
  { id: 'unanalyzed', label: '未分析' },
];

/** 記録一覧（依頼書 §18。P0は検索 + 種別フィルタの最小構成）。 */
export function FactnoteRecordsScreen({ records }: { records: IncidentRecord[] }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  const filtered = useMemo(() => {
    const q = query.trim();
    return records.filter((r) => {
      if (filter === 'positive' && !r.isPositiveEvent) return false;
      if (filter === 'conflict' && !r.isConflict) return false;
      if (filter === 'repair' && !r.isRepairAction) return false;
      if (filter === 'unanalyzed' && r.analysis) return false;
      if (q) {
        const haystack = [r.title, r.rawText, r.transcript, r.correctedTranscript, ...r.tags, ...r.emotions]
          .filter(Boolean)
          .join('\n');
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [records, query, filter]);

  return (
    <div className="flex min-h-dvh flex-col pt-safe">
      <FactnoteHeader title="記録" />

      <div className="px-6 pt-4">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="検索"
          aria-label="記録を検索"
          className="h-11 w-full rounded-card border border-border bg-surface px-4 text-[15px] text-text placeholder:text-text-tertiary focus:outline-none focus:ring-1 focus:ring-accent"
        />
        <div className="-mx-6 mt-3 flex gap-2 overflow-x-auto px-6 pb-1">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`h-9 shrink-0 whitespace-nowrap rounded-chip border px-3.5 text-[13px] active:opacity-70 ${
                filter === f.id
                  ? 'border-accent bg-accent text-accent-on'
                  : 'border-border bg-surface text-text'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 pb-4">
        {filtered.length === 0 ? (
          <div className="mt-24 text-center text-[14px] text-text-tertiary">
            {records.length === 0 ? 'まだ記録がありません。' : '条件に合う記録がありません。'}
          </div>
        ) : (
          <ul className="mt-2">
            {filtered.map((r) => (
              <RecordRow key={r.id} record={r} href={`/factnote/records/${r.id}`} />
            ))}
          </ul>
        )}
      </div>
      <FactnoteTabBar />
    </div>
  );
}

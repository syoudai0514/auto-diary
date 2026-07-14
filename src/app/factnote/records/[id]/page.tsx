'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { FactnoteRecordDetailScreen } from '@/components/screens/factnote/RecordDetailScreen';
import { getRecord, listFutureMemos, saveRecord, trashRecord } from '@/lib/factnote/db';
import {
  getFactnoteJob,
  startAnalyzeJob,
  subscribeFactnoteJobs,
} from '@/lib/factnote/jobs';
import { recordToContext, sourceTextOf } from '@/lib/factnote/newRecord';
import { loadFactnoteProfile, profileToPeopleContext } from '@/lib/factnote/profile';
import type { FutureSelfMemo, IncidentRecord } from '@/lib/factnote/types';

export default function FactnoteRecordDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [record, setRecord] = useState<IncidentRecord | null | undefined>(undefined);
  const [pinnedMemos, setPinnedMemos] = useState<FutureSelfMemo[]>([]);
  const [analyzing, setAnalyzing] = useState(false);

  const reload = useCallback(async () => {
    if (!params?.id) return;
    try {
      const r = await getRecord(params.id);
      setRecord(r ?? null);
      setAnalyzing(!!r && !!getFactnoteJob(r.id));
      if (r?.pinnedMemoIds?.length) {
        const memos = await listFutureMemos();
        setPinnedMemos(memos.filter((m) => r.pinnedMemoIds?.includes(m.id)));
      } else {
        setPinnedMemos([]);
      }
    } catch {
      setRecord(null);
    }
  }, [params?.id]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // バックグラウンドジョブの完了・失敗でこの記録を再読み込みする
  useEffect(() => {
    return subscribeFactnoteJobs((event) => {
      if (event.job.recordId !== params?.id) return;
      if (event.type !== 'progress') {
        setAnalyzing(false);
        void reload();
      }
    });
  }, [params?.id, reload]);

  async function analyze() {
    if (!record || !sourceTextOf(record)) return;
    setAnalyzing(true);
    const updated = { ...record, status: 'analyzing' as const, updatedAt: new Date().toISOString() };
    await saveRecord(updated);
    setRecord(updated);
    const profile = await loadFactnoteProfile();
    startAnalyzeJob({
      recordId: record.id,
      context: recordToContext(record),
      peopleContext: profileToPeopleContext(profile),
    });
  }

  if (record === undefined) {
    return (
      <div className="flex min-h-dvh items-center justify-center text-[14px] text-text-tertiary">
        読み込み中…
      </div>
    );
  }

  if (record === null) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-7 text-center">
        <p className="text-[14px] text-text-secondary">記録が見つかりませんでした。</p>
        <button
          onClick={() => router.push('/factnote/records')}
          className="h-11 rounded-full border border-border px-5 text-[14px] active:opacity-70"
        >
          記録一覧へ
        </button>
      </div>
    );
  }

  return (
    <FactnoteRecordDetailScreen
      record={record}
      pinnedMemos={pinnedMemos}
      analyzing={analyzing}
      onAnalyze={sourceTextOf(record) ? () => void analyze() : undefined}
      onUpdate={async (updated) => {
        setRecord(updated);
        await saveRecord(updated);
      }}
      onDelete={async () => {
        await trashRecord(record.id);
        router.push('/factnote/records');
      }}
    />
  );
}

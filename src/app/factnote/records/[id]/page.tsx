'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { FactnoteRecordDetailScreen } from '@/components/screens/factnote/RecordDetailScreen';
import { getRecord, trashRecord } from '@/lib/factnote/db';
import type { IncidentRecord } from '@/lib/factnote/types';

export default function FactnoteRecordDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [record, setRecord] = useState<IncidentRecord | null | undefined>(undefined);

  useEffect(() => {
    if (!params?.id) return;
    getRecord(params.id)
      .then((r) => setRecord(r ?? null))
      .catch(() => setRecord(null));
  }, [params?.id]);

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
      onDelete={async () => {
        await trashRecord(record.id);
        router.push('/factnote/records');
      }}
    />
  );
}

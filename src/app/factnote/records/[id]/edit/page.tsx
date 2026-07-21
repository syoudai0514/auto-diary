'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { FactnoteRecordEditScreen } from '@/components/screens/factnote/RecordEditScreen';
import { maybeAutoBackup } from '@/lib/factnote/autoBackup';
import { getRecord, saveRecord } from '@/lib/factnote/db';
import type { IncidentRecord } from '@/lib/factnote/types';

export default function FactnoteRecordEditPage() {
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
    <FactnoteRecordEditScreen
      record={record}
      onCancel={() => router.push(`/factnote/records/${record.id}`)}
      onSave={async (updated) => {
        // DB上の最新にマージして保存（並行更新の上書き防止）
        const fresh = (await getRecord(updated.id).catch(() => undefined)) ?? record;
        await saveRecord({
          ...fresh,
          title: updated.title,
          occurredAt: updated.occurredAt,
          location: updated.location,
          people: updated.people,
          childrenPresent: updated.childrenPresent,
          childImpactTags: updated.childImpactTags,
          emotions: updated.emotions,
          rawText: updated.rawText,
          correctedTranscript: updated.correctedTranscript,
          updatedAt: new Date().toISOString(),
        });
        void maybeAutoBackup().catch(() => {});
        router.push(`/factnote/records/${updated.id}`);
      }}
    />
  );
}

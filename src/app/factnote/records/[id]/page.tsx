'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { FactnoteRecordDetailScreen } from '@/components/screens/factnote/RecordDetailScreen';
import {
  deleteAttachmentBlob,
  getAttachmentBlob,
  getRecord,
  listFutureMemos,
  newFactnoteId,
  saveAttachmentBlob,
  saveRecord,
  trashRecord,
} from '@/lib/factnote/db';
import { maybeAutoBackup } from '@/lib/factnote/autoBackup';
import { exportRecordAsMarkdown } from '@/lib/factnote/exportData';
import { prepareImageBlob } from '@/lib/factnote/image';
import type { Attachment } from '@/lib/factnote/types';
import {
  getFactnoteJob,
  startAnalyzeJob,
  startTranscribeJob,
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
  const [transcribing, setTranscribing] = useState(false);
  const [jobError, setJobError] = useState<string | null>(null);
  const [attachmentBusy, setAttachmentBusy] = useState(false);

  const reload = useCallback(async () => {
    if (!params?.id) return;
    try {
      const r = await getRecord(params.id);
      setRecord(r ?? null);
      const job = r ? getFactnoteJob(r.id) : undefined;
      setAnalyzing(job?.kind === 'analyze');
      setTranscribing(job?.kind === 'transcribe');
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

  // バックグラウンドジョブの進捗・完了・失敗をこの画面へ反映する
  useEffect(() => {
    return subscribeFactnoteJobs((event) => {
      if (event.job.recordId !== params?.id) return;
      if (event.type === 'progress') return;
      setAnalyzing(false);
      setTranscribing(false);
      if (event.type === 'error') {
        // 失敗を握りつぶさず、画面に表示する
        setJobError(event.message);
      } else {
        setJobError(null);
      }
      void reload();
    });
  }, [params?.id, reload]);

  /** 分類・除外・固定メモなど画面からの部分更新を、DB上の最新へマージして保存する。 */
  const mergeUpdate = useCallback(
    async (updated: IncidentRecord) => {
      setRecord(updated);
      const fresh = await getRecord(updated.id).catch(() => undefined);
      const base = fresh ?? updated;
      await saveRecord({
        ...base,
        isPositiveEvent: updated.isPositiveEvent,
        isConflict: updated.isConflict,
        isRepairAction: updated.isRepairAction,
        excludeFromCarte: updated.excludeFromCarte,
        pinnedMemoIds: updated.pinnedMemoIds,
        updatedAt: new Date().toISOString(),
      });
    },
    [],
  );

  async function analyze() {
    if (!record || !sourceTextOf(record)) return;
    setJobError(null);
    setAnalyzing(true);
    const fresh = (await getRecord(record.id).catch(() => undefined)) ?? record;
    const updated = { ...fresh, status: 'analyzing' as const, updatedAt: new Date().toISOString() };
    await saveRecord(updated);
    setRecord(updated);
    const profile = await loadFactnoteProfile();
    startAnalyzeJob({
      recordId: record.id,
      context: recordToContext(updated),
      peopleContext: profileToPeopleContext(profile),
    });
  }

  /** 保存済みの音声（原本）から文字起こしを再実行する。録音は失われない設計の要。 */
  async function transcribeFromAttachments() {
    if (!record) return;
    // 画像は文字起こし対象ではない。音声・動画のみ
    const audio = record.attachments.filter(
      (a) => a.mimeType.startsWith('audio/') || a.mimeType.startsWith('video/'),
    );
    if (audio.length === 0) return;
    const items: Array<{ blob: Blob; filename: string }> = [];
    for (const att of audio) {
      const blob = await getAttachmentBlob(att.id).catch(() => undefined);
      if (blob) items.push({ blob, filename: att.fileName });
    }
    if (items.length === 0) return;
    setJobError(null);
    setTranscribing(true);
    const fresh = (await getRecord(record.id).catch(() => undefined)) ?? record;
    const updated = {
      ...fresh,
      status: 'transcribing' as const,
      updatedAt: new Date().toISOString(),
    };
    await saveRecord(updated);
    setRecord(updated);
    const profile = await loadFactnoteProfile();
    startTranscribeJob({
      recordId: record.id,
      items,
      peopleContext: profileToPeopleContext(profile),
    });
  }

  /** 画像を縮小・圧縮して添付する（複数、直列。§2-2）。DB最新へマージ保存。 */
  async function addImages(files: FileList) {
    if (!record) return;
    setAttachmentBusy(true);
    try {
      const added: Attachment[] = [];
      for (const file of Array.from(files)) {
        const prepared = await prepareImageBlob(file);
        const attId = newFactnoteId();
        await saveAttachmentBlob(attId, prepared.blob);
        added.push({
          id: attId,
          fileName: prepared.fileName,
          mimeType: prepared.mimeType,
          size: prepared.blob.size,
          createdAt: new Date().toISOString(),
        });
      }
      const fresh = (await getRecord(record.id).catch(() => undefined)) ?? record;
      const updated: IncidentRecord = {
        ...fresh,
        attachments: [...fresh.attachments, ...added],
        updatedAt: new Date().toISOString(),
      };
      await saveRecord(updated);
      setRecord(updated);
      void maybeAutoBackup().catch(() => {});
    } catch {
      setJobError('画像の追加に失敗しました。もう一度お試しください。');
    } finally {
      setAttachmentBusy(false);
    }
  }

  async function removeAttachment(id: string) {
    if (!record) return;
    await deleteAttachmentBlob(id).catch(() => {});
    const fresh = (await getRecord(record.id).catch(() => undefined)) ?? record;
    const updated: IncidentRecord = {
      ...fresh,
      attachments: fresh.attachments.filter((a) => a.id !== id),
      updatedAt: new Date().toISOString(),
    };
    await saveRecord(updated);
    setRecord(updated);
    void maybeAutoBackup().catch(() => {});
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
      transcribing={transcribing}
      analyzeError={jobError}
      onAnalyze={sourceTextOf(record) ? () => void analyze() : undefined}
      onTranscribe={
        record.attachments.some((a) => !a.mimeType.startsWith('image/'))
          ? () => void transcribeFromAttachments()
          : undefined
      }
      onAddImages={(files) => void addImages(files)}
      onRemoveAttachment={(id) => void removeAttachment(id)}
      attachmentBusy={attachmentBusy}
      onExportMarkdown={() => void exportRecordAsMarkdown(record)}
      onUpdate={(updated) => void mergeUpdate(updated)}
      onDelete={async () => {
        await trashRecord(record.id);
        router.push('/factnote/records');
      }}
    />
  );
}

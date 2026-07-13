'use client';

import Link from 'next/link';
import { newFactnoteId, saveFutureMemo, saveMemoLog, saveRecord, getRecord } from '@/lib/factnote/db';
import { nextMorning } from '@/lib/factnote/memoMatch';
import type { FutureMemoDisplayLog, FutureSelfMemo } from '@/lib/factnote/types';
import { formatRecordDate } from './common';

async function log(memo: FutureSelfMemo, action: FutureMemoDisplayLog['action'], recordId?: string) {
  await saveMemoLog({
    id: newFactnoteId(),
    memoId: memo.id,
    recordId,
    displayedAt: new Date().toISOString(),
    action,
  });
}

/**
 * 未来の自分からのメモの表示カード（追加依頼 §19）。
 * AIの助言と混同しないよう、本人が書いたメモであることを明示する。
 */
export function FutureMemoCard({
  memo,
  recordId,
  onClose,
}: {
  memo: FutureSelfMemo;
  /** 表示のきっかけになった記録（固定操作に使う）。 */
  recordId?: string;
  onClose: () => void;
}) {
  return (
    <div className="rounded-card border-2 border-accent bg-surface px-4 py-4" role="note">
      <div className="text-[11px] font-semibold tracking-wide text-accent">未来の自分から</div>
      <h3 className="mt-1 text-[16px] font-bold">{memo.title}</h3>
      <p className="mt-2 whitespace-pre-wrap text-[14px] leading-[1.9]">{memo.body}</p>
      <p className="mt-3 text-[11px] text-text-tertiary">
        これはAIの文章ではなく、{formatRecordDate(memo.createdAt)}にあなた自身が書いたメモです。
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          onClick={async () => {
            await log(memo, 'closed', recordId);
            onClose();
          }}
          className="h-10 rounded-full bg-accent px-4 text-[13px] font-semibold text-accent-on active:opacity-80"
        >
          今は閉じる
        </button>
        <button
          onClick={async () => {
            await saveFutureMemo({ ...memo, remindAt: nextMorning() });
            await log(memo, 'remind_tomorrow', recordId);
            onClose();
          }}
          className="h-10 rounded-full border border-border px-4 text-[13px] active:opacity-70"
        >
          明日の朝に再表示
        </button>
        {recordId && (
          <button
            onClick={async () => {
              const record = await getRecord(recordId);
              if (record) {
                const pinned = new Set(record.pinnedMemoIds ?? []);
                pinned.add(memo.id);
                await saveRecord({
                  ...record,
                  pinnedMemoIds: Array.from(pinned),
                  updatedAt: new Date().toISOString(),
                });
              }
              await log(memo, 'pinned_to_record', recordId);
              onClose();
            }}
            className="h-10 rounded-full border border-border px-4 text-[13px] active:opacity-70"
          >
            この出来事に固定
          </button>
        )}
        <Link
          href={`/factnote/memos/edit?id=${memo.id}`}
          onClick={() => void log(memo, 'edited', recordId)}
          className="flex h-10 items-center rounded-full px-3 text-[13px] text-text-secondary active:opacity-60"
        >
          編集する
        </Link>
      </div>
    </div>
  );
}

/** 表示時に lastShownAt を更新してログを残す（表示元で呼ぶ）。 */
export async function markMemoShown(memo: FutureSelfMemo, recordId?: string): Promise<void> {
  await saveFutureMemo({ ...memo, lastShownAt: new Date().toISOString(), remindAt: undefined });
  await log(memo, 'shown', recordId);
}

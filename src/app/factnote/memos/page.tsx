'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { FactnoteHeader, Badge } from '@/components/screens/factnote/common';
import { deleteFutureMemo, listFutureMemos, listMemoLogs, saveFutureMemo } from '@/lib/factnote/db';
import type { FutureMemoDisplayLog, FutureSelfMemo } from '@/lib/factnote/types';
import { FUTURE_MEMO_TRIGGER_LABELS } from '@/lib/factnote/types';

const ACTION_LABELS: Record<FutureMemoDisplayLog['action'], string> = {
  shown: '表示',
  closed: '閉じた',
  read_again: 'もう一度読んだ',
  remind_tomorrow: '明日の朝に再表示',
  pinned_to_record: '記録に固定',
  edited: '編集',
};

/** 未来の自分からのメモ一覧 + 表示履歴（追加依頼 §28-9/14）。 */
export default function MemosPage() {
  const [memos, setMemos] = useState<FutureSelfMemo[]>([]);
  const [logs, setLogs] = useState<FutureMemoDisplayLog[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const reload = useCallback(() => {
    listFutureMemos().then(setMemos).catch(() => setMemos([]));
    listMemoLogs().then(setLogs).catch(() => setLogs([]));
  }, []);
  useEffect(reload, [reload]);

  const memoTitle = (id: string) => memos.find((m) => m.id === id)?.title ?? '（削除済みのメモ）';

  return (
    <div className="flex min-h-dvh flex-col pt-safe">
      <FactnoteHeader title="未来の自分からのメモ" backHref="/factnote" />
      <div className="flex-1 overflow-y-auto px-6 pb-safe">
        <p className="pt-1 text-[12.5px] leading-relaxed text-text-secondary">
          冷静な時のあなたが、動揺している時のあなたへ残す言葉です。条件に合った時に表示されます。
        </p>

        <Link
          href="/factnote/memos/edit"
          className="mt-4 flex h-12 w-full items-center justify-center rounded-full bg-accent text-[15px] font-semibold text-accent-on shadow-cta active:opacity-90"
        >
          新しいメモを作る
        </Link>

        {memos.length === 0 ? (
          <p className="mt-16 text-center text-[14px] text-text-tertiary">
            まだメモがありません。テンプレートから簡単に作れます。
          </p>
        ) : (
          <ul className="mt-5 space-y-3">
            {memos.map((memo) => (
              <li key={memo.id} className="rounded-card border border-border px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[15px] font-semibold">{memo.title}</div>
                    <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-[12.5px] text-text-secondary">
                      {memo.body}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {!memo.isEnabled && <Badge label="無効" tone="warning" />}
                      <Badge
                        label={
                          memo.source === 'user_written'
                            ? '本人が作成'
                            : memo.source === 'ai_draft_user_edited'
                              ? 'AI下書きを本人が編集'
                              : 'AI下書きのまま承認'
                        }
                      />
                      {memo.triggers.slice(0, 3).map((t) => (
                        <Badge key={t.type} label={FUTURE_MEMO_TRIGGER_LABELS[t.type]} tone="accent" />
                      ))}
                    </div>
                  </div>
                  <label className="flex shrink-0 items-center gap-1 text-[12px] text-text-secondary">
                    <input
                      type="checkbox"
                      checked={memo.isEnabled}
                      onChange={async (e) => {
                        await saveFutureMemo({
                          ...memo,
                          isEnabled: e.target.checked,
                          updatedAt: new Date().toISOString(),
                        });
                        reload();
                      }}
                      className="h-5 w-5 accent-[var(--c-accent)]"
                    />
                    有効
                  </label>
                </div>
                <div className="mt-2 flex gap-3">
                  <Link
                    href={`/factnote/memos/edit?id=${memo.id}`}
                    className="flex min-h-[36px] items-center text-[13px] text-accent active:opacity-60"
                  >
                    編集
                  </Link>
                  {confirmingId === memo.id ? (
                    <>
                      <button
                        onClick={async () => {
                          await deleteFutureMemo(memo.id);
                          setConfirmingId(null);
                          reload();
                        }}
                        className="min-h-[36px] text-[13px] font-semibold text-error active:opacity-60"
                      >
                        完全に削除する
                      </button>
                      <button
                        onClick={() => setConfirmingId(null)}
                        className="min-h-[36px] text-[13px] text-text-tertiary active:opacity-60"
                      >
                        キャンセル
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => setConfirmingId(memo.id)}
                      className="min-h-[36px] text-[13px] text-error active:opacity-60"
                    >
                      削除
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        {logs.length > 0 && (
          <div className="mt-8">
            <button
              onClick={() => setShowLogs(!showLogs)}
              className="min-h-[44px] text-[13px] text-text-secondary active:opacity-60"
              aria-expanded={showLogs}
            >
              表示履歴（{logs.length}件）{showLogs ? 'を閉じる' : 'を見る'}
            </button>
            {showLogs && (
              <ul className="mt-1 space-y-1 text-[12px] text-text-tertiary">
                {logs.slice(0, 30).map((l) => (
                  <li key={l.id}>
                    {new Date(l.displayedAt).toLocaleString('ja-JP')} ・ {memoTitle(l.memoId)} ・{' '}
                    {ACTION_LABELS[l.action]}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

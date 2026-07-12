'use client';

import type { Draft } from '@/lib/drafts';
import { formatDate, formatDuration } from '@/lib/format';
import {
  AlertTriangleIcon,
  ChevronRightIcon,
  KeyboardIcon,
  MicIcon,
  SettingsIcon,
  UploadIcon,
} from '@/components/icons';

export function HomeScreen({
  drafts,
  onOpenSettings,
  onRecord,
  onQuick,
  onPickFiles,
  onResume,
  onDiscard,
}: {
  drafts: Draft[];
  onOpenSettings: () => void;
  onRecord: () => void;
  onQuick: () => void;
  onPickFiles: () => void;
  onResume: (d: Draft) => void;
  onDiscard: (id: string) => void;
}) {
  const [firstDraft, ...restDrafts] = drafts;
  return (
    <div className="flex min-h-dvh flex-col pt-safe">
      <header className="flex items-center justify-between px-6 pt-4">
        <h1 className="text-[24px] font-bold">日記</h1>
        <button
          onClick={onOpenSettings}
          aria-label="設定"
          className="flex h-9 w-9 items-center justify-center rounded-full border border-border text-text active:opacity-60"
        >
          <SettingsIcon width={18} height={18} />
        </button>
      </header>

      {firstDraft && (
        <div className="mx-6 mt-4 flex items-center gap-3 rounded-card bg-warning-soft px-4 py-3">
          <AlertTriangleIcon width={18} height={18} className="shrink-0 text-warning" />
          <span className="flex-1 text-[13.5px] text-text-secondary">
            保存されていない下書きがあります
          </span>
          <button
            onClick={() => onResume(firstDraft)}
            className="text-[14px] font-semibold text-accent active:opacity-60"
          >
            再開
          </button>
          <button
            onClick={() => onDiscard(firstDraft.id)}
            className="text-[14px] text-text-tertiary active:opacity-60"
          >
            破棄
          </button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-6 pt-6">
        <h2 className="mb-1 text-[12px] font-medium text-text-tertiary">最近の記録</h2>
        {drafts.length === 0 ? (
          <div className="mt-24 text-center text-[14px] leading-relaxed text-text-tertiary">
            まだ記録がありません。
            <br />
            下のボタンから話しはじめましょう。
          </div>
        ) : (
          <ul>
            {restDrafts.map((d) => (
              <DraftRow key={d.id} draft={d} onClick={() => onResume(d)} />
            ))}
            {/* firstDraft はバナーに出るが一覧にも表示 */}
            {firstDraft && <DraftRow draft={firstDraft} onClick={() => onResume(firstDraft)} />}
          </ul>
        )}
      </div>

      {/* フッター: 親指到達域 */}
      <div className="sticky bottom-0 mt-auto bg-gradient-to-t from-bg via-bg to-transparent px-6 pb-safe pt-6">
        <div className="flex flex-col items-center gap-2 pb-3">
          <button
            onClick={onQuick}
            className="flex h-11 items-center gap-2 rounded-full border border-border bg-surface px-5 text-[14px] font-medium text-text active:opacity-70"
          >
            <KeyboardIcon width={18} height={18} />
            すぐ話す（キーボード入力）
          </button>
          <button
            onClick={onPickFiles}
            className="flex h-11 items-center gap-2 rounded-full border border-border bg-surface px-5 text-[14px] font-medium text-text active:opacity-70"
          >
            <UploadIcon width={18} height={18} />
            音声ファイルをアップロード
          </button>
          <button
            onClick={onRecord}
            aria-label="録音して日記化"
            className="flex h-[76px] w-[76px] items-center justify-center rounded-[38px] bg-accent text-accent-on shadow-cta transition active:scale-[1.08]"
          >
            <MicIcon width={30} height={30} />
          </button>
          <span className="text-[12px] text-text-tertiary">録音して日記化</span>
        </div>
      </div>
    </div>
  );
}

function DraftRow({ draft, onClick }: { draft: Draft; onClick: () => void }) {
  return (
    <li className="border-b border-border">
      <button
        onClick={onClick}
        className="flex min-h-[44px] w-full items-center gap-3 py-3.5 text-left active:opacity-60"
      >
        <div className="flex-1">
          <div className="text-[12px] text-text-tertiary">
            {formatDate(draft.createdAt)}
            {draft.durationSec ? ` ・ ${formatDuration(draft.durationSec)}` : ''}
          </div>
          <div className="mt-0.5 text-[16px] font-semibold text-text">
            {draft.diary.title || '無題の日記'}
          </div>
        </div>
        <ChevronRightIcon width={20} height={20} className="text-text-tertiary" />
      </button>
    </li>
  );
}

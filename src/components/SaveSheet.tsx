'use client';

import { BookIcon, CopyIcon, ExternalLinkIcon } from './icons';

export type SaveChoice = 'apple' | 'dayone' | 'clipboard' | 'openApp';

/** 「毎回選ぶ」設定時に保存先を選ぶボトムシート。 */
export function SaveSheet({
  open,
  onSelect,
  onClose,
}: {
  open: boolean;
  onSelect: (c: SaveChoice) => void;
  onClose: () => void;
}) {
  if (!open) return null;
  const items: { id: SaveChoice; label: string; icon: React.ReactNode }[] = [
    { id: 'apple', label: 'Appleジャーナルに保存', icon: <BookIcon width={20} height={20} /> },
    { id: 'dayone', label: 'Day Oneに保存', icon: <BookIcon width={20} height={20} /> },
    { id: 'clipboard', label: 'クリップボードにコピー', icon: <CopyIcon width={20} height={20} /> },
    {
      id: 'openApp',
      label: '他の日記アプリを開く（コピー+起動）',
      icon: <ExternalLinkIcon width={20} height={20} />,
    },
  ];
  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end" role="dialog" aria-modal="true">
      <button
        aria-label="閉じる"
        onClick={onClose}
        className="absolute inset-0 bg-black/40"
      />
      <div className="relative z-10 rounded-t-sheet bg-bg px-5 pb-safe pt-3">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-border" />
        <h2 className="mb-3 px-1 text-[15px] font-semibold">保存先を選ぶ</h2>
        <div className="flex flex-col gap-2 pb-4">
          {items.map((it) => (
            <button
              key={it.id}
              onClick={() => onSelect(it.id)}
              className="flex h-14 items-center gap-3 rounded-card border border-border bg-surface px-4 text-left text-[15px] active:opacity-70"
            >
              <span className="text-accent">{it.icon}</span>
              {it.label}
            </button>
          ))}
          <button
            onClick={onClose}
            className="mt-1 flex h-12 items-center justify-center rounded-card text-[15px] text-text-secondary active:opacity-70"
          >
            キャンセル
          </button>
        </div>
      </div>
    </div>
  );
}

'use client';

import { ChevronLeftIcon } from '@/components/icons';

export function QuickScreen({
  value,
  onChange,
  onBack,
  onSubmit,
}: {
  value: string;
  onChange: (v: string) => void;
  onBack: () => void;
  onSubmit: () => void;
}) {
  return (
    <div className="flex min-h-dvh flex-col pt-safe">
      <header className="flex items-center gap-2 px-4 pt-4">
        <button
          onClick={onBack}
          aria-label="戻る"
          className="flex h-11 w-11 items-center justify-center rounded-full active:opacity-60"
        >
          <ChevronLeftIcon />
        </button>
        <h1 className="text-[18px] font-bold">すぐ話す</h1>
      </header>
      <div className="flex-1 px-6 pt-4">
        <p className="mb-3 text-[13px] text-text-secondary">
          キーボードのマイクボタンで音声入力できます。話し終えたら「日記にする」を押してください。
        </p>
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoFocus
          placeholder="今日あったこと、感じたことを話してください…"
          className="h-64 w-full resize-none rounded-card border border-border bg-surface p-4 text-[16px] leading-relaxed text-text outline-none focus:border-accent"
        />
      </div>
      <div className="sticky bottom-0 bg-bg px-6 pb-safe pt-3">
        <button
          onClick={onSubmit}
          disabled={value.trim().length === 0}
          className="mb-3 flex h-14 w-full items-center justify-center rounded-full bg-accent text-[17px] font-bold text-accent-on shadow-cta active:scale-[0.99] disabled:opacity-50"
        >
          日記にする
        </button>
      </div>
    </div>
  );
}

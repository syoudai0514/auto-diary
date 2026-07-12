'use client';

import { formatBytes } from '@/lib/format';
import { ChevronLeftIcon, UploadIcon, XIcon } from '@/components/icons';

export function FilesScreen({
  files,
  onRemove,
  onAddMore,
  onCancel,
  onSubmit,
}: {
  files: File[];
  onRemove: (index: number) => void;
  onAddMore: () => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  return (
    <div className="flex min-h-dvh flex-col pt-safe">
      <header className="flex items-center gap-2 px-4 pt-4">
        <button
          onClick={onCancel}
          aria-label="戻る"
          className="flex h-11 w-11 items-center justify-center rounded-full active:opacity-60"
        >
          <ChevronLeftIcon />
        </button>
        <h1 className="text-[18px] font-bold">音声ファイルから作る</h1>
      </header>
      <div className="flex-1 px-6 pt-4">
        <p className="mb-3 text-[13px] leading-relaxed text-text-secondary">
          選んだ順番につなげて1つの日記にします。ボイスメモなどで録音した音声ファイルを選んでください。
        </p>

        {files.length === 0 ? (
          <div className="mt-16 text-center text-[14px] text-text-tertiary">
            まだファイルが選ばれていません。
          </div>
        ) : (
          <ul className="overflow-hidden rounded-card border border-border bg-surface">
            {files.map((f, i) => (
              <li
                key={`${f.name}-${f.lastModified}-${i}`}
                className={`flex items-center gap-3 px-4 py-3 ${i > 0 ? 'border-t border-border' : ''}`}
              >
                <span className="flex-1 truncate text-[14px] text-text">{f.name}</span>
                <span className="shrink-0 text-[12px] text-text-tertiary">
                  {formatBytes(f.size)}
                </span>
                <button
                  onClick={() => onRemove(i)}
                  aria-label={`${f.name} を削除`}
                  className="flex h-8 w-8 shrink-0 items-center justify-center text-text-tertiary active:opacity-60"
                >
                  <XIcon width={16} height={16} />
                </button>
              </li>
            ))}
          </ul>
        )}

        <button
          onClick={onAddMore}
          className="mt-3 flex h-11 items-center gap-2 rounded-full border border-border bg-surface px-4 text-[14px] font-medium text-text active:opacity-70"
        >
          <UploadIcon width={16} height={16} />
          さらに追加する
        </button>
      </div>
      <div className="sticky bottom-0 bg-bg px-6 pb-safe pt-3">
        <button
          onClick={onSubmit}
          disabled={files.length === 0}
          className="mb-3 flex h-14 w-full items-center justify-center rounded-full bg-accent text-[17px] font-bold text-accent-on shadow-cta active:scale-[0.99] disabled:opacity-50"
        >
          文字起こしして日記にする
        </button>
      </div>
    </div>
  );
}

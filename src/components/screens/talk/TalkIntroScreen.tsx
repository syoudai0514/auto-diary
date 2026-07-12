'use client';

import { ChevronLeftIcon, MicIcon, UploadIcon } from '@/components/icons';

/** ふたりの話し合い分析: 導入・同意画面。 */
export function TalkIntroScreen({
  onRecord,
  onPickFiles,
  onBack,
}: {
  onRecord: () => void;
  onPickFiles: () => void;
  onBack: () => void;
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
        <h1 className="text-[18px] font-bold">ふたりの話し合い分析</h1>
      </header>

      <div className="flex-1 overflow-y-auto px-6 pt-4">
        <p className="text-[14.5px] leading-relaxed text-text-secondary">
          ケンカや話し合いの音声から、AIが第三者として整理します。
        </p>
        <ul className="mt-4 space-y-2.5">
          {[
            'それぞれの言い分と、言葉の奥にある本当の望みを整理',
            'どちらの主張がより妥当か、率直に判定（人格ではなく発言・行動を評価）',
            'すれ違いのポイントと、ふたりそれぞれへの改善のヒント',
            'そのまま口に出せる、仲直りの会話例',
          ].map((t) => (
            <li key={t} className="flex gap-2.5 rounded-card border border-border bg-surface p-3.5">
              <span className="text-accent">✓</span>
              <span className="text-[13.5px] leading-relaxed text-text">{t}</span>
            </li>
          ))}
        </ul>

        <div className="mt-5 rounded-card bg-warning-soft p-4 text-[12.5px] leading-relaxed text-text-secondary">
          <p className="font-semibold text-warning">はじめる前に</p>
          <p className="mt-1">
            録音やアップロードは、<strong>必ず相手の同意を得てから</strong>行ってください。
            会話の音声・内容はサーバーに保存されず、この分析結果もこの画面かぎりで消えます（必要ならコピーして残せます）。
          </p>
        </div>
      </div>

      <div className="sticky bottom-0 bg-gradient-to-t from-bg via-bg to-transparent px-6 pb-safe pt-3">
        <button
          onClick={onRecord}
          className="mb-2 flex h-14 w-full items-center justify-center gap-2 rounded-full bg-accent text-[16px] font-bold text-accent-on shadow-cta active:scale-[0.99]"
        >
          <MicIcon width={20} height={20} />
          いまから録音する
        </button>
        <button
          onClick={onPickFiles}
          className="mb-3 flex h-12 w-full items-center justify-center gap-2 rounded-full border border-border bg-surface text-[14.5px] font-medium text-text active:opacity-70"
        >
          <UploadIcon width={18} height={18} />
          録音済みの音声ファイルを選ぶ
        </button>
      </div>
    </div>
  );
}

'use client';

import { ChevronLeftIcon } from '@/components/icons';

/** 話者付き文字起こしのプレビューと、A/Bが誰かの指定。 */
export function TalkSpeakersScreen({
  transcript,
  speakerA,
  speakerB,
  onChangeSpeakerA,
  onChangeSpeakerB,
  onAnalyze,
  onBack,
}: {
  transcript: string;
  speakerA: string;
  speakerB: string;
  onChangeSpeakerA: (v: string) => void;
  onChangeSpeakerB: (v: string) => void;
  onAnalyze: () => void;
  onBack: () => void;
}) {
  const canAnalyze = speakerA.trim().length > 0 && speakerB.trim().length > 0;
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
        <h1 className="text-[18px] font-bold">話した人を教えてください</h1>
      </header>

      <div className="flex-1 overflow-y-auto px-6 pt-4">
        <p className="mb-3 text-[13px] leading-relaxed text-text-secondary">
          会話を聞き分けて A / B のラベルを付けました。冒頭を確認して、それぞれが誰かを入力してください。
        </p>

        <div className="max-h-56 overflow-y-auto whitespace-pre-wrap rounded-card border border-border bg-surface p-4 text-[13px] leading-relaxed text-text-secondary">
          {transcript}
        </div>

        <div className="mt-5 space-y-3">
          <div>
            <label className="mb-1 block px-1 text-[13px] font-semibold text-text-secondary">
              A はだれ？
            </label>
            <input
              value={speakerA}
              onChange={(e) => onChangeSpeakerA(e.target.value)}
              placeholder="例: 私"
              aria-label="話者Aの名前"
              maxLength={30}
              className="h-12 w-full rounded-card border border-border bg-surface px-4 text-[15px] outline-none focus:border-accent"
            />
          </div>
          <div>
            <label className="mb-1 block px-1 text-[13px] font-semibold text-text-secondary">
              B はだれ？
            </label>
            <input
              value={speakerB}
              onChange={(e) => onChangeSpeakerB(e.target.value)}
              placeholder="例: 妻"
              aria-label="話者Bの名前"
              maxLength={30}
              className="h-12 w-full rounded-card border border-border bg-surface px-4 text-[15px] outline-none focus:border-accent"
            />
          </div>
        </div>
        <div className="h-24" />
      </div>

      <div className="sticky bottom-0 bg-gradient-to-t from-bg via-bg to-transparent px-6 pb-safe pt-3">
        <button
          onClick={onAnalyze}
          disabled={!canAnalyze}
          className="mb-3 flex h-14 w-full items-center justify-center rounded-full bg-accent text-[17px] font-bold text-accent-on shadow-cta active:scale-[0.99] disabled:opacity-50"
        >
          分析する
        </button>
      </div>
    </div>
  );
}

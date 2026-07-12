'use client';

import { formatTimer } from '@/lib/format';
import { Waveform } from '@/components/Waveform';
import {
  AlertTriangleIcon,
  PauseIcon,
  PlayIcon,
  StopIcon,
  XIcon,
} from '@/components/icons';

export function RecordingScreen({
  elapsedMs,
  paused,
  tooLong,
  onPause,
  onResume,
  onStop,
  onCancel,
}: {
  elapsedMs: number;
  paused: boolean;
  tooLong: boolean;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-between pt-safe pb-safe">
      <div className="w-full">
        {tooLong && (
          <div className="mx-6 mt-6 flex items-center gap-2 rounded-card bg-warning-soft px-4 py-3 text-[13px] text-warning">
            <AlertTriangleIcon width={16} height={16} />
            録音が長くなっています。区切って保存すると失敗しにくくなります。
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-6">
        <div className="flex items-center gap-2 text-[15px] font-medium">
          <span
            className={`h-2.5 w-2.5 rounded-full ${
              paused ? 'bg-text-tertiary' : 'animate-pulse-dot bg-recording'
            }`}
          />
          <span className={paused ? 'text-text-tertiary' : 'text-recording'}>
            {paused ? '一時停止中' : '録音中'}
          </span>
        </div>
        <div className="tabular text-[52px] font-bold leading-none">{formatTimer(elapsedMs)}</div>
        <Waveform active={!paused} />
      </div>

      <p className="px-8 text-center text-[12px] text-text-tertiary">
        録音中はこの画面を閉じないでください。
      </p>

      <div className="mb-6 mt-4 flex items-center justify-center gap-7">
        <button
          onClick={onCancel}
          aria-label="キャンセル"
          className="flex h-14 w-14 items-center justify-center rounded-full border border-border bg-surface text-text active:opacity-70"
        >
          <XIcon width={22} height={22} />
        </button>
        <button
          onClick={onStop}
          aria-label="停止して日記化"
          className="flex h-[76px] w-[76px] items-center justify-center rounded-full bg-recording text-white shadow-cta active:scale-[0.97]"
        >
          <StopIcon width={30} height={30} />
        </button>
        {paused ? (
          <button
            onClick={onResume}
            aria-label="再開"
            className="flex h-14 w-14 items-center justify-center rounded-full border border-border bg-surface text-text active:opacity-70"
          >
            <PlayIcon width={22} height={22} />
          </button>
        ) : (
          <button
            onClick={onPause}
            aria-label="一時停止"
            className="flex h-14 w-14 items-center justify-center rounded-full border border-border bg-surface text-text active:opacity-70"
          >
            <PauseIcon width={22} height={22} />
          </button>
        )}
      </div>
    </div>
  );
}

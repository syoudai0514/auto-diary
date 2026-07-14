'use client';

import { AlertTriangleIcon, MicIcon } from '@/components/icons';
import { CenterScreen } from './common';

/** マイク許可が得られなかったときの案内画面。 */
export function PermissionScreen({ onRetry, onBack }: { onRetry: () => void; onBack: () => void }) {
  return (
    <CenterScreen>
      <div className="mb-5 flex h-20 w-20 items-center justify-center rounded-3xl bg-warning-soft text-warning">
        <MicIcon width={34} height={34} />
      </div>
      <h1 className="text-[20px] font-bold">マイクへのアクセスが必要です</h1>
      <p className="mt-2 max-w-[280px] text-[14px] leading-relaxed text-text-secondary">
        録音するにはマイクの許可が必要です。iPhoneの「設定 &gt; Safari &gt; マイク」または
        アプリの権限を確認し、許可してください。
      </p>
      <button
        onClick={onRetry}
        className="mt-7 flex h-13 h-[52px] w-full max-w-[280px] items-center justify-center rounded-full bg-accent text-[16px] font-semibold text-accent-on active:scale-[0.99]"
      >
        もう一度試す
      </button>
      <button onClick={onBack} className="mt-3 min-h-[44px] text-[14px] text-text-secondary">
        あとで
      </button>
    </CenterScreen>
  );
}

/** 文字起こし・生成の進行中画面。secondary はバックグラウンド継続などの任意アクション。 */
export function ProcessingScreen({
  title,
  subtitle,
  onCancel,
  secondaryLabel,
  onSecondary,
  note,
}: {
  title: string;
  subtitle: string;
  onCancel: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
  note?: string;
}) {
  return (
    <CenterScreen>
      <div className="mb-6 h-16 w-16 animate-spin360 rounded-full border-[3px] border-border border-t-accent" />
      <h1 className="text-[18px] font-bold">{title}</h1>
      <p className="mt-2 text-[13.5px] text-text-secondary">{subtitle}</p>
      {onSecondary && secondaryLabel && (
        <button
          onClick={onSecondary}
          className="mt-7 flex h-12 w-full max-w-[280px] items-center justify-center rounded-full border border-border bg-surface text-[14.5px] font-medium text-text active:opacity-70"
        >
          {secondaryLabel}
        </button>
      )}
      {note && (
        <p className="mt-3 max-w-[280px] text-[11.5px] leading-relaxed text-text-tertiary">{note}</p>
      )}
      <button
        onClick={onCancel}
        className={`min-h-[44px] text-[14px] text-text-secondary ${onSecondary ? 'mt-2' : 'mt-8'}`}
      >
        キャンセル
      </button>
    </CenterScreen>
  );
}

/** 録音が短すぎた・無音だったときの画面。 */
export function EmptyScreen({ onRetry, onHome }: { onRetry: () => void; onHome: () => void }) {
  return (
    <CenterScreen>
      <div className="mb-5 flex h-20 w-20 items-center justify-center rounded-3xl bg-surface text-text-tertiary">
        <MicIcon width={34} height={34} />
      </div>
      <h1 className="text-[20px] font-bold">音声が検出されませんでした</h1>
      <p className="mt-2 max-w-[260px] text-[14px] leading-relaxed text-text-secondary">
        うまく録音できなかったようです。もう一度お試しください。
      </p>
      <button
        onClick={onRetry}
        className="mt-7 flex h-[52px] w-full max-w-[280px] items-center justify-center rounded-full bg-accent text-[16px] font-semibold text-accent-on active:scale-[0.99]"
      >
        もう一度録音する
      </button>
      <button onClick={onHome} className="mt-3 min-h-[44px] text-[14px] text-text-secondary">
        ホームへ
      </button>
    </CenterScreen>
  );
}

/** 文字起こし・生成が失敗したときの画面。 */
export function ErrorScreen({
  message,
  canRetry,
  onRetry,
  onBack,
}: {
  message: string;
  canRetry: boolean;
  onRetry: () => void;
  onBack: () => void;
}) {
  return (
    <CenterScreen>
      <div className="mb-5 flex h-20 w-20 items-center justify-center rounded-3xl bg-error-soft text-error">
        <AlertTriangleIcon width={34} height={34} />
      </div>
      <h1 className="text-[20px] font-bold">生成に失敗しました</h1>
      <p className="mt-2 max-w-[280px] text-[14px] leading-relaxed text-text-secondary">
        {message || '通信エラーが発生しました。'}
        {canRetry && (
          <>
            <br />
            文字起こしは保持されています。
          </>
        )}
      </p>
      {canRetry && (
        <button
          onClick={onRetry}
          className="mt-7 flex h-[52px] w-full max-w-[280px] items-center justify-center rounded-full bg-accent text-[16px] font-semibold text-accent-on active:scale-[0.99]"
        >
          再試行
        </button>
      )}
      <button onClick={onBack} className="mt-3 min-h-[44px] text-[14px] text-text-secondary">
        戻る
      </button>
    </CenterScreen>
  );
}

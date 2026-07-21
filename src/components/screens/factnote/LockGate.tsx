'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { FingerprintIcon, LockIcon } from '@/components/icons';
import { FACTNOTE_APP_NAME } from '@/lib/factnote/appConfig';
import {
  getAutoLockMs,
  hasBiometric,
  isLockConfigured,
  isUnlocked,
  lockNow,
  markUnlocked,
  subscribeLock,
  unlockWithBiometric,
  verifyPin,
} from '@/lib/factnote/lock';

/**
 * /factnote 配下すべてをロックで覆うゲート。
 *
 * - ロック未設定なら素通し。
 * - 設定済みなら、解除されるまでロック画面を表示して中身を隠す。
 * - リロード時は必ずロック（解除状態はメモリのみ）。
 * - バックグラウンド復帰時、オートロック時間を超えていたら再ロック。
 */
export function LockGate({ children }: { children: React.ReactNode }) {
  // SSR との不一致を避けるため、マウント後に判定する。
  const [mounted, setMounted] = useState(false);
  const [locked, setLocked] = useState(false);

  const sync = useCallback(() => {
    setLocked(isLockConfigured() && !isUnlocked());
  }, []);

  useEffect(() => {
    setMounted(true);
    sync();
    const unsub = subscribeLock(sync);
    return unsub;
  }, [sync]);

  // バックグラウンド滞在が一定時間を超えたら再ロックする。
  const hiddenAtRef = useRef<number | null>(null);
  useEffect(() => {
    function onVisibility() {
      if (document.visibilityState === 'hidden') {
        hiddenAtRef.current = Date.now();
        return;
      }
      // 復帰
      const hiddenAt = hiddenAtRef.current;
      hiddenAtRef.current = null;
      if (!isLockConfigured() || !isUnlocked()) return;
      const away = hiddenAt === null ? 0 : Date.now() - hiddenAt;
      if (away >= getAutoLockMs()) lockNow();
    }
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  // マウント前・非ロック時は中身をそのまま出す（画面のちらつきを避ける）。
  if (!mounted || !locked) return <>{children}</>;
  return <LockScreen />;
}

function LockScreen() {
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const biometricAvailable = hasBiometric();
  const triedBiometric = useRef(false);

  const tryBiometric = useCallback(async () => {
    setError(null);
    setChecking(true);
    try {
      const ok = await unlockWithBiometric();
      if (!ok) setError('生体認証に失敗しました。PINで解除してください。');
    } catch {
      setError('生体認証を利用できませんでした。PINで解除してください。');
    } finally {
      setChecking(false);
    }
  }, []);

  // 生体認証が登録済みなら、開いた直後に一度だけ自動で試す。
  useEffect(() => {
    if (biometricAvailable && !triedBiometric.current) {
      triedBiometric.current = true;
      void tryBiometric();
    }
  }, [biometricAvailable, tryBiometric]);

  async function submit(value: string) {
    if (checking) return;
    setChecking(true);
    setError(null);
    try {
      if (await verifyPin(value)) {
        markUnlocked();
      } else {
        setError('PINが違います。');
        setPin('');
      }
    } finally {
      setChecking(false);
    }
  }

  function press(digit: string) {
    if (checking) return;
    setError(null);
    setPin((prev) => {
      const next = (prev + digit).slice(0, 8);
      return next;
    });
  }

  function backspace() {
    if (checking) return;
    setError(null);
    setPin((prev) => prev.slice(0, -1));
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-8 pt-safe pb-safe">
      <div className="flex flex-col items-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-surface text-accent">
          <LockIcon width={30} height={30} />
        </div>
        <h1 className="mt-4 text-[18px] font-bold">{FACTNOTE_APP_NAME}</h1>
        <p className="mt-1 text-[13px] text-text-secondary">PINを入力して解除してください</p>
      </div>

      {/* PIN ドット表示 */}
      <div className="mt-7 flex h-4 items-center gap-3" aria-hidden>
        {Array.from({ length: Math.max(4, pin.length) }).map((_, i) => (
          <span
            key={i}
            className={`h-3 w-3 rounded-full ${i < pin.length ? 'bg-accent' : 'border border-border'}`}
          />
        ))}
      </div>

      <p className="mt-3 h-5 text-[12.5px] text-error" role="alert">
        {error ?? ''}
      </p>

      {/* テンキー */}
      <div className="mt-2 grid w-full max-w-[280px] grid-cols-3 gap-3">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <button
            key={d}
            onClick={() => press(d)}
            disabled={checking}
            className="h-16 rounded-2xl bg-surface text-[24px] font-medium text-text active:opacity-60 disabled:opacity-40"
          >
            {d}
          </button>
        ))}
        {biometricAvailable ? (
          <button
            onClick={tryBiometric}
            disabled={checking}
            aria-label="生体認証で解除"
            className="flex h-16 items-center justify-center rounded-2xl text-accent active:opacity-60 disabled:opacity-40"
          >
            <FingerprintIcon width={28} height={28} />
          </button>
        ) : (
          <span />
        )}
        <button
          onClick={() => press('0')}
          disabled={checking}
          className="h-16 rounded-2xl bg-surface text-[24px] font-medium text-text active:opacity-60 disabled:opacity-40"
        >
          0
        </button>
        <button
          onClick={backspace}
          disabled={checking || pin.length === 0}
          aria-label="1文字消す"
          className="flex h-16 items-center justify-center rounded-2xl text-[15px] text-text-secondary active:opacity-60 disabled:opacity-30"
        >
          ⌫
        </button>
      </div>

      <button
        onClick={() => submit(pin)}
        disabled={checking || pin.length < 4}
        className="mt-6 h-12 w-full max-w-[280px] rounded-full bg-accent text-[15px] font-semibold text-accent-on disabled:opacity-40"
      >
        {checking ? '確認中…' : '解除'}
      </button>
    </div>
  );
}

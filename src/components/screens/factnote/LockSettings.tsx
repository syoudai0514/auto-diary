'use client';

import { useEffect, useState } from 'react';
import { CheckIcon, FingerprintIcon, LockIcon } from '@/components/icons';
import {
  AUTOLOCK_OPTIONS,
  getAutoLockMs,
  hasBiometric,
  isBiometricSupported,
  isLockConfigured,
  registerBiometric,
  removeBiometric,
  removeLock,
  setAutoLockMs,
  setPin,
  verifyPin,
} from '@/lib/factnote/lock';
import { Section } from './common';

/**
 * 画面ロック（PIN + 生体認証）の設定 UI。設定画面に埋め込む自己完結コンポーネント。
 */
export function LockSettings() {
  const [configured, setConfigured] = useState(false);
  const [biometricOn, setBiometricOn] = useState(false);
  const [biometricSupported, setBiometricSupported] = useState(false);
  const [autolockMs, setAutolockMsState] = useState(getAutoLockMs());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // 入力欄
  const [pin1, setPin1] = useState('');
  const [pin2, setPin2] = useState('');
  const [current, setCurrent] = useState('');

  function refresh() {
    setConfigured(isLockConfigured());
    setBiometricOn(hasBiometric());
    setAutolockMsState(getAutoLockMs());
  }

  useEffect(() => {
    refresh();
    isBiometricSupported().then(setBiometricSupported);
  }, []);

  async function handleSetPin() {
    setMessage(null);
    if (pin1.length < 4) {
      setMessage('PINは4桁以上にしてください。');
      return;
    }
    if (pin1 !== pin2) {
      setMessage('PINが一致しません。');
      return;
    }
    // 変更時は現在のPINを確認する。
    if (configured) {
      if (!(await verifyPin(current))) {
        setMessage('現在のPINが違います。');
        return;
      }
    }
    setBusy(true);
    try {
      await setPin(pin1);
      setPin1('');
      setPin2('');
      setCurrent('');
      refresh();
      setMessage(configured ? 'PINを変更しました。' : 'PINを設定しました。次回の起動からロックされます。');
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleBiometric() {
    setMessage(null);
    setBusy(true);
    try {
      if (biometricOn) {
        removeBiometric();
        refresh();
        setMessage('生体認証を解除しました。');
      } else {
        await registerBiometric();
        refresh();
        setMessage('生体認証を登録しました。次回のロック解除で使えます。');
      }
    } catch (e) {
      setMessage(`生体認証の登録に失敗しました。${e instanceof Error ? e.message : ''}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleRemoveLock() {
    setMessage(null);
    if (!(await verifyPin(current))) {
      setMessage('現在のPINが違います。');
      return;
    }
    setBusy(true);
    try {
      removeLock();
      setCurrent('');
      refresh();
      setMessage('ロックを解除しました。');
    } finally {
      setBusy(false);
    }
  }

  function handleAutolock(ms: number) {
    setAutoLockMs(ms);
    setAutolockMsState(ms);
    setMessage('自動ロックの時間を変更しました。');
  }

  const pinInputClass =
    'h-11 w-full rounded-card border border-border bg-bg px-3 text-[15px] tracking-[0.3em] focus:outline-none focus:ring-1 focus:ring-accent';

  return (
    <Section title="画面ロック（PIN・生体認証）">
      <div className="rounded-card border border-border px-4 py-3">
        <div className="flex items-center gap-2 text-[14px]">
          {configured ? (
            <>
              <CheckIcon width={16} height={16} className="text-success" />
              <span>ロック設定済み{biometricOn ? '（生体認証あり）' : ''}</span>
            </>
          ) : (
            <>
              <LockIcon width={16} height={16} className="text-text-tertiary" />
              <span className="text-text-secondary">未設定 — 誰でも記録を開けます</span>
            </>
          )}
        </div>

        {/* PIN 設定・変更 */}
        <div className="mt-3 space-y-2">
          {configured && (
            <input
              type="password"
              inputMode="numeric"
              autoComplete="off"
              value={current}
              onChange={(e) => setCurrent(e.target.value.replace(/\D/g, ''))}
              placeholder="現在のPIN"
              aria-label="現在のPIN"
              className={pinInputClass}
            />
          )}
          <input
            type="password"
            inputMode="numeric"
            autoComplete="off"
            value={pin1}
            onChange={(e) => setPin1(e.target.value.replace(/\D/g, ''))}
            placeholder={configured ? '新しいPIN（4桁以上）' : 'PIN（4桁以上）'}
            aria-label="新しいPIN"
            className={pinInputClass}
          />
          <input
            type="password"
            inputMode="numeric"
            autoComplete="off"
            value={pin2}
            onChange={(e) => setPin2(e.target.value.replace(/\D/g, ''))}
            placeholder="もう一度入力"
            aria-label="新しいPIN（確認）"
            className={pinInputClass}
          />
          <button
            onClick={handleSetPin}
            disabled={busy || !pin1 || !pin2}
            className="h-11 w-full rounded-full bg-accent text-[14px] font-semibold text-accent-on disabled:opacity-40"
          >
            {configured ? 'PINを変更' : 'PINを設定'}
          </button>
        </div>
      </div>

      {/* 生体認証 */}
      {configured && (
        <div className="mt-2 rounded-card border border-border px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-[14px]">
              <FingerprintIcon width={18} height={18} className="text-accent" />
              <span>生体認証（Face ID / Touch ID）</span>
            </div>
            <button
              onClick={handleToggleBiometric}
              disabled={busy || (!biometricSupported && !biometricOn)}
              className={`h-9 shrink-0 rounded-full px-4 text-[13px] font-semibold disabled:opacity-40 ${
                biometricOn
                  ? 'border border-border text-error'
                  : 'bg-accent text-accent-on'
              }`}
            >
              {biometricOn ? '解除' : '登録'}
            </button>
          </div>
          {!biometricSupported && !biometricOn && (
            <p className="mt-2 text-[11.5px] leading-relaxed text-text-tertiary">
              この端末・ブラウザでは生体認証を利用できません。PINで解除してください。
            </p>
          )}
        </div>
      )}

      {/* 自動ロックの時間 */}
      {configured && (
        <div className="mt-2 rounded-card border border-border px-4 py-3">
          <div className="text-[14px]">アプリを離れてから再ロックまで</div>
          <div className="mt-2 flex gap-2">
            {AUTOLOCK_OPTIONS.map((opt) => (
              <button
                key={opt.ms}
                onClick={() => handleAutolock(opt.ms)}
                className={`h-10 flex-1 rounded-full text-[13px] font-medium ${
                  autolockMs === opt.ms
                    ? 'bg-accent text-accent-on'
                    : 'border border-border text-text-secondary'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ロック解除（削除） */}
      {configured && (
        <div className="mt-2 rounded-card border border-border px-4 py-3">
          <div className="text-[14px]">ロックをやめる</div>
          <div className="mt-2 flex gap-2">
            <input
              type="password"
              inputMode="numeric"
              autoComplete="off"
              value={current}
              onChange={(e) => setCurrent(e.target.value.replace(/\D/g, ''))}
              placeholder="現在のPIN"
              aria-label="ロック解除のための現在のPIN"
              className={`${pinInputClass} flex-1`}
            />
            <button
              onClick={handleRemoveLock}
              disabled={busy || !current}
              className="h-11 shrink-0 rounded-full border border-border px-4 text-[13px] text-error disabled:opacity-40"
            >
              解除する
            </button>
          </div>
        </div>
      )}

      {message && (
        <p className="mt-2 rounded-card bg-surface px-4 py-3 text-[13px] text-text-secondary">
          {message}
        </p>
      )}

      <p className="mt-2 text-[11.5px] leading-relaxed text-text-tertiary">
        これは画面をロックする「目隠し」です。記録データそのものは暗号化されません。端末を紛失したときは端末側のロック（画面ロック・iCloud）と併用してください。PINを忘れると解除できなくなるため、控えを安全な場所に保管してください。
      </p>
    </Section>
  );
}

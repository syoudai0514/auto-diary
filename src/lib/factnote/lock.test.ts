import { describe, it, expect, beforeEach } from 'vitest';
import {
  getAutoLockMs,
  isLockConfigured,
  isUnlocked,
  lockNow,
  markUnlocked,
  removeLock,
  setAutoLockMs,
  setPin,
  verifyPin,
} from './lock';

describe('画面ロック（PIN）', () => {
  beforeEach(() => {
    localStorage.clear();
    lockNow();
  });

  it('未設定なら isLockConfigured は false', () => {
    expect(isLockConfigured()).toBe(false);
  });

  it('PIN を設定すると configured になり、正しいPINだけ照合できる', async () => {
    await setPin('1234');
    expect(isLockConfigured()).toBe(true);
    expect(await verifyPin('1234')).toBe(true);
    expect(await verifyPin('0000')).toBe(false);
    expect(await verifyPin('12345')).toBe(false);
  });

  it('PIN は平文で保存されない（ハッシュのみ）', async () => {
    await setPin('1234');
    const raw = localStorage.getItem('factnote-lock-pin') ?? '';
    expect(raw).not.toContain('1234');
    const parsed = JSON.parse(raw);
    expect(parsed.salt).toBeTruthy();
    expect(parsed.hash).toBeTruthy();
    expect(parsed.iterations).toBeGreaterThan(0);
  });

  it('同じPINでもソルトで毎回ハッシュが変わる', async () => {
    await setPin('1234');
    const first = localStorage.getItem('factnote-lock-pin');
    await setPin('1234');
    const second = localStorage.getItem('factnote-lock-pin');
    expect(first).not.toBe(second);
  });

  it('removeLock で設定が消え、解除状態になる', async () => {
    await setPin('1234');
    markUnlocked();
    removeLock();
    expect(isLockConfigured()).toBe(false);
    expect(isUnlocked()).toBe(true);
    expect(await verifyPin('1234')).toBe(false);
  });

  it('セッションのロック状態を切り替えられる', () => {
    expect(isUnlocked()).toBe(false);
    markUnlocked();
    expect(isUnlocked()).toBe(true);
    lockNow();
    expect(isUnlocked()).toBe(false);
  });

  it('オートロック時間は既定値と保存値を返す', () => {
    expect(getAutoLockMs()).toBe(60_000);
    setAutoLockMs(0);
    expect(getAutoLockMs()).toBe(0);
    setAutoLockMs(300_000);
    expect(getAutoLockMs()).toBe(300_000);
  });
});

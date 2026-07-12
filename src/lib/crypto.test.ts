import { describe, it, expect } from 'vitest';
import {
  hashPassword,
  verifyPassword,
  encryptSecret,
  decryptSecret,
  timingSafeEqualString,
} from './crypto';

describe('timingSafeEqualString', () => {
  it('一致する文字列は true', () => {
    expect(timingSafeEqualString('invite-code', 'invite-code')).toBe(true);
  });
  it('不一致（同じ長さ）は false', () => {
    expect(timingSafeEqualString('invite-code', 'invite-cod2')).toBe(false);
  });
  it('長さが異なっても例外を投げず false', () => {
    expect(timingSafeEqualString('short', 'much-longer-string')).toBe(false);
  });
});

describe('パスワードのハッシュ化と照合', () => {
  it('正しいパスワードなら true', async () => {
    const hash = await hashPassword('correct-horse-battery-staple');
    expect(await verifyPassword('correct-horse-battery-staple', hash)).toBe(true);
  });

  it('誤ったパスワードなら false', async () => {
    const hash = await hashPassword('correct-horse-battery-staple');
    expect(await verifyPassword('wrong-password', hash)).toBe(false);
  });

  it('毎回異なるsaltが使われる（同じパスワードでもハッシュが変わる）', async () => {
    const a = await hashPassword('same-password');
    const b = await hashPassword('same-password');
    expect(a).not.toBe(b);
    expect(await verifyPassword('same-password', a)).toBe(true);
    expect(await verifyPassword('same-password', b)).toBe(true);
  });

  it('壊れた形式のハッシュは false を返す（例外を投げない）', async () => {
    expect(await verifyPassword('x', 'not-a-valid-hash')).toBe(false);
    expect(await verifyPassword('x', '')).toBe(false);
  });
});

describe('秘密情報の暗号化・復号（AES-256-GCM）', () => {
  it('暗号化して復号すると元の平文に戻る', () => {
    const plaintext = 'AIzaSyExampleGeminiApiKey1234567890';
    const encrypted = encryptSecret(plaintext);
    expect(decryptSecret(encrypted)).toBe(plaintext);
  });

  it('同じ平文でも毎回異なる暗号文になる（IVがランダムなため）', () => {
    const a = encryptSecret('same-secret');
    const b = encryptSecret('same-secret');
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe('same-secret');
    expect(decryptSecret(b)).toBe('same-secret');
  });

  it('改ざんされた暗号文は復号時に例外を投げる', () => {
    const encrypted = encryptSecret('secret-value');
    const parts = encrypted.split(':');
    // 暗号文本体の最後の文字を変えて改ざんを模擬
    const tamperedData = parts[3].slice(0, -1) + (parts[3].endsWith('A') ? 'B' : 'A');
    const tampered = [parts[0], parts[1], parts[2], tamperedData].join(':');
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it('不正な形式の文字列は例外を投げる', () => {
    expect(() => decryptSecret('not-encrypted-data')).toThrow();
    expect(() => decryptSecret('v2:a:b:c')).toThrow();
  });
});

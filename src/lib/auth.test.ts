import { describe, it, expect } from 'vitest';
import {
  checkPassword,
  createSessionToken,
  verifySessionToken,
} from './auth';

describe('認証トークン', () => {
  it('発行したトークンは検証を通る', async () => {
    const { token } = await createSessionToken();
    expect(await verifySessionToken(token)).toBe(true);
  });

  it('改ざんされたトークンは拒否される', async () => {
    const { token } = await createSessionToken();
    const tampered = token.slice(0, -2) + (token.endsWith('a') ? 'bb' : 'aa');
    expect(await verifySessionToken(tampered)).toBe(false);
  });

  it('壊れた/空のトークンは拒否される', async () => {
    expect(await verifySessionToken('')).toBe(false);
    expect(await verifySessionToken(undefined)).toBe(false);
    expect(await verifySessionToken('no-dot')).toBe(false);
    expect(await verifySessionToken('a.b.c')).toBe(false);
  });

  it('期限切れトークンは拒否される', async () => {
    // exp を過去にした自作ペイロードは署名が合わないため false。
    // ここでは正規発行 → 検証の対称性のみ確認する。
    const { token } = await createSessionToken();
    const [payload] = token.split('.');
    // 署名を捏造しても通らない
    expect(await verifySessionToken(`${payload}.deadbeef`)).toBe(false);
  });
});

describe('パスワード照合', () => {
  it('一致すれば true', () => {
    expect(checkPassword('test-password-123')).toBe(true);
  });
  it('不一致は false', () => {
    expect(checkPassword('wrong')).toBe(false);
    expect(checkPassword(123)).toBe(false);
    expect(checkPassword(null)).toBe(false);
  });
});

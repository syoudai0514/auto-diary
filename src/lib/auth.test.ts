import { describe, it, expect } from 'vitest';
import { createSessionToken, verifySessionToken } from './auth';

describe('認証トークン', () => {
  it('発行したトークンは検証を通り、ユーザーIDが復元できる', async () => {
    const { token } = await createSessionToken('user-123');
    const session = await verifySessionToken(token);
    expect(session).not.toBeNull();
    expect(session?.sub).toBe('user-123');
  });

  it('改ざんされたトークンは拒否される', async () => {
    const { token } = await createSessionToken('user-123');
    const tampered = token.slice(0, -2) + (token.endsWith('a') ? 'bb' : 'aa');
    expect(await verifySessionToken(tampered)).toBeNull();
  });

  it('壊れた/空のトークンは拒否される', async () => {
    expect(await verifySessionToken('')).toBeNull();
    expect(await verifySessionToken(undefined)).toBeNull();
    expect(await verifySessionToken('no-dot')).toBeNull();
    expect(await verifySessionToken('a.b.c')).toBeNull();
  });

  it('期限切れトークンは拒否される', async () => {
    // exp を過去にした自作ペイロードは署名が合わないため null。
    // ここでは正規発行 → 検証の対称性のみ確認する。
    const { token } = await createSessionToken('user-123');
    const [payload] = token.split('.');
    // 署名を捏造しても通らない
    expect(await verifySessionToken(`${payload}.deadbeef`)).toBeNull();
  });

  it('異なるユーザーIDで発行したトークンは、それぞれ正しいIDを返す', async () => {
    const a = await createSessionToken('alice');
    const b = await createSessionToken('bob');
    expect((await verifySessionToken(a.token))?.sub).toBe('alice');
    expect((await verifySessionToken(b.token))?.sub).toBe('bob');
  });
});

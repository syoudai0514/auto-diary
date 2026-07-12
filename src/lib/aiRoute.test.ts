import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';
import { encryptSecret } from './crypto';

const getUserById = vi.fn();
vi.mock('@/lib/userStore', () => ({
  getUserById: (...args: unknown[]) => getUserById(...args),
}));

import { resolveGeminiApiKey, aiErrorResponse } from './aiRoute';

beforeEach(() => {
  getUserById.mockReset();
});

describe('resolveGeminiApiKey', () => {
  it('登録済みのキーを復号して返す', async () => {
    getUserById.mockResolvedValue({
      id: 'u1',
      geminiKeyEncrypted: encryptSecret('AIzaMyRealKey123'),
    });
    const result = await resolveGeminiApiKey('u1');
    expect(result).not.toBeInstanceOf(NextResponse);
    expect((result as { apiKey: string }).apiKey).toBe('AIzaMyRealKey123');
  });

  it('アカウントが存在しなければ 401', async () => {
    getUserById.mockResolvedValue(null);
    const result = await resolveGeminiApiKey('gone');
    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(401);
  });

  it('キー未登録なら 400 no_api_key', async () => {
    getUserById.mockResolvedValue({ id: 'u1', geminiKeyEncrypted: null });
    const result = await resolveGeminiApiKey('u1');
    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(400);
    expect((await (result as NextResponse).json()).error).toBe('no_api_key');
  });

  it('復号に失敗したら 500 key_unreadable（例外を漏らさない）', async () => {
    getUserById.mockResolvedValue({ id: 'u1', geminiKeyEncrypted: 'v1:broken:data:here' });
    const result = await resolveGeminiApiKey('u1');
    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(500);
    expect((await (result as NextResponse).json()).error).toBe('key_unreadable');
  });
});

describe('aiErrorResponse', () => {
  const opts = { tag: 'test', code: 'generation_failed', messageBase: '日記の生成に失敗しました' };

  it('エラーのstatusと理由を反映する', async () => {
    const res = aiErrorResponse(opts, Object.assign(new Error('quota exceeded'), { status: 429 }));
    expect(res.status).toBe(429);
    const data = await res.json();
    expect(data.error).toBe('generation_failed');
    expect(data.message).toBe('日記の生成に失敗しました（quota exceeded）');
  });

  it('statusが無い/範囲外のエラーは 502 になる', async () => {
    const res = aiErrorResponse(opts, new Error('boom'));
    expect(res.status).toBe(502);
  });

  it('理由が取れないエラーは基本メッセージのみ', async () => {
    const res = aiErrorResponse(opts, 'not-an-error-object');
    const data = await res.json();
    expect(data.message).toBe('日記の生成に失敗しました。');
  });
});

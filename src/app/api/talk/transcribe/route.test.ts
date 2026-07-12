// @vitest-environment node
// jsdomのBlobはarrayBuffer()を実装していないため、Node組み込みの実装で検証する。
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSessionToken } from '@/lib/auth';
import { _resetRateLimits } from '@/lib/rateLimit';

let cookieToken: string | undefined;
vi.mock('next/headers', () => ({
  cookies: () => ({
    get: (_name: string) => (cookieToken ? { value: cookieToken } : undefined),
  }),
}));

const generateContent = vi.fn();
vi.mock('@/lib/gemini', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/gemini')>();
  return {
    ...actual,
    getGemini: () => ({ models: { generateContent } }),
    transcribeModel: () => 'gemini-3.1-flash-lite',
    maxAudioBytes: () => 1024, // テスト用に小さく（1KB）
  };
});

let storedUser: { id: string; geminiKeyEncrypted: string | null } | null = {
  id: 'test-user',
  geminiKeyEncrypted: 'v1:fake-encrypted-key',
};
vi.mock('@/lib/userStore', () => ({
  getUserById: (id: string) => Promise.resolve(storedUser?.id === id ? storedUser : null),
}));
vi.mock('@/lib/crypto', () => ({
  decryptSecret: () => 'fake-gemini-key',
}));

import { POST } from './route';

function formReq(file: File | null, ip = `8.8.8.${Math.floor(Math.random() * 250)}`): Request {
  const form = new FormData();
  if (file) form.append('file', file);
  return new Request('http://localhost/api/talk/transcribe', {
    method: 'POST',
    headers: { 'x-forwarded-for': ip },
    body: form,
  });
}

beforeEach(async () => {
  _resetRateLimits();
  generateContent.mockReset();
  generateContent.mockResolvedValue({ text: 'A: 片付けしてよ\nB: 後でやるって' });
  storedUser = { id: 'test-user', geminiKeyEncrypted: 'v1:fake-encrypted-key' };
  cookieToken = (await createSessionToken('test-user')).token;
});

describe('POST /api/talk/transcribe', () => {
  it('認証なしは 401', async () => {
    cookieToken = undefined;
    const res = await POST(formReq(new File(['x'], 'a.webm', { type: 'audio/webm' })));
    expect(res.status).toBe(401);
  });

  it('Gemini APIキー未設定は 400 no_api_key', async () => {
    storedUser = { id: 'test-user', geminiKeyEncrypted: null };
    const res = await POST(formReq(new File([new Uint8Array(10)], 'a.webm', { type: 'audio/webm' })));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('no_api_key');
  });

  it('音声なしは 400', async () => {
    const res = await POST(formReq(null));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('no_audio');
  });

  it('サイズ超過は 413', async () => {
    const big = new File([new Uint8Array(2048)], 'big.webm', { type: 'audio/webm' });
    const res = await POST(formReq(big));
    expect(res.status).toBe(413);
  });

  it('正常時は話者付きテキストを返す', async () => {
    const file = new File([new Uint8Array(10)], 'a.webm', { type: 'audio/webm' });
    const res = await POST(formReq(file));
    expect(res.status).toBe(200);
    expect((await res.json()).text).toContain('A: 片付けしてよ');
  });

  it('プロンプトに話者分離の指示が含まれる', async () => {
    const file = new File([new Uint8Array(10)], 'a.webm', { type: 'audio/webm' });
    await POST(formReq(file));
    const call = generateContent.mock.calls[0][0];
    const textPart = call.contents[0].parts.find((p: { text?: string }) => p.text);
    expect(textPart.text).toContain('「A: 」または「B: 」');
    expect(textPart.text).toContain('2人の人物による会話');
  });

  it('Gemini 失敗時はエラーを返す（本文は含めない）', async () => {
    generateContent.mockRejectedValue(Object.assign(new Error('bad'), { status: 500 }));
    const file = new File([new Uint8Array(10)], 'a.webm', { type: 'audio/webm' });
    const res = await POST(formReq(file));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('transcription_failed');
  });
});

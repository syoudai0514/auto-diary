// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSessionToken } from '@/lib/auth';
import { _resetRateLimits } from '@/lib/rateLimit';

let cookieToken: string | undefined;
vi.mock('next/headers', () => ({
  cookies: () => ({
    get: (_name: string) => (cookieToken ? { value: cookieToken } : undefined),
  }),
}));

const createTranscription = vi.fn();
vi.mock('@/lib/openai', () => ({
  getOpenAI: () => ({ audio: { transcriptions: { create: createTranscription } } }),
  transcribeModel: () => 'gpt-4o-mini-transcribe',
  maxAudioBytes: () => 1024, // テスト用に小さく（1KB）
}));

import { POST } from './route';

function formReq(file: File | null, ip = `9.9.9.${Math.floor(Math.random() * 250)}`): Request {
  const form = new FormData();
  if (file) form.append('file', file);
  return new Request('http://localhost/api/transcribe', {
    method: 'POST',
    headers: { 'x-forwarded-for': ip },
    body: form,
  });
}

beforeEach(async () => {
  _resetRateLimits();
  createTranscription.mockReset();
  createTranscription.mockResolvedValue({ text: '文字起こし結果です' });
  cookieToken = (await createSessionToken()).token;
});

describe('POST /api/transcribe', () => {
  it('認証なしは 401', async () => {
    cookieToken = undefined;
    const file = new File(['x'], 'a.webm', { type: 'audio/webm' });
    const res = await POST(formReq(file));
    expect(res.status).toBe(401);
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
    expect((await res.json()).error).toBe('file_too_large');
  });

  it('正常時はテキストを返す', async () => {
    const file = new File([new Uint8Array(10)], 'a.webm', { type: 'audio/webm' });
    const res = await POST(formReq(file));
    expect(res.status).toBe(200);
    expect((await res.json()).text).toBe('文字起こし結果です');
  });

  it('OpenAI 失敗時はエラーを返す（本文は含めない）', async () => {
    createTranscription.mockRejectedValue(Object.assign(new Error('bad'), { status: 500 }));
    const file = new File([new Uint8Array(10)], 'a.webm', { type: 'audio/webm' });
    const res = await POST(formReq(file));
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toBe('transcription_failed');
    expect(JSON.stringify(data)).not.toContain('文字起こし結果');
  });
});

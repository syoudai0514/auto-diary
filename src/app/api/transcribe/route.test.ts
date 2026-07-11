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

const generateContent = vi.fn();
vi.mock('@/lib/gemini', async (importOriginal) => {
  // guessAudioMimeType / extractText は実装をそのまま使い、修正の効果を実テストで検証する
  const actual = await importOriginal<typeof import('@/lib/gemini')>();
  return {
    ...actual,
    getGemini: () => ({ models: { generateContent } }),
    transcribeModel: () => 'gemini-2.0-flash',
    maxAudioBytes: () => 1024, // テスト用に小さく（1KB）
  };
});

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
  generateContent.mockReset();
  generateContent.mockResolvedValue({ text: '文字起こし結果です' });
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

  it('Gemini がインラインデータとして音声を受け取る', async () => {
    const file = new File([new Uint8Array(10)], 'a.webm', { type: 'audio/webm' });
    await POST(formReq(file));
    expect(generateContent).toHaveBeenCalledTimes(1);
    const call = generateContent.mock.calls[0][0];
    expect(call.model).toBe('gemini-2.0-flash');
    const parts = call.contents[0].parts;
    const inlinePart = parts.find((p: any) => p.inlineData);
    expect(inlinePart.inlineData.mimeType).toBe('audio/webm');
    expect(typeof inlinePart.inlineData.data).toBe('string');
  });

  it('type情報を持たない .m4a ファイルでも拡張子から audio/mp4 と推定する（iOSファイルアプリ対策）', async () => {
    // iOSの「ファイル」アプリ経由（Shortcuts書き出し等）では file.type が空文字になることがある
    const file = new File([new Uint8Array(10)], '2026-07-11_15-51_家庭記録.m4a', { type: '' });
    await POST(formReq(file));
    const call = generateContent.mock.calls[0][0];
    const inlinePart = call.contents[0].parts.find((p: any) => p.inlineData);
    expect(inlinePart.inlineData.mimeType).toBe('audio/mp4');
  });

  it('Gemini 失敗時はエラーを返す（本文は含めない）', async () => {
    generateContent.mockRejectedValue(Object.assign(new Error('bad'), { status: 500 }));
    const file = new File([new Uint8Array(10)], 'a.webm', { type: 'audio/webm' });
    const res = await POST(formReq(file));
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toBe('transcription_failed');
    expect(JSON.stringify(data)).not.toContain('文字起こし結果');
  });
});

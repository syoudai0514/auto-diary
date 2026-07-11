import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSessionToken } from '@/lib/auth';
import { _resetRateLimits } from '@/lib/rateLimit';

// --- モック: cookie（認証） ---
let cookieToken: string | undefined;
vi.mock('next/headers', () => ({
  cookies: () => ({
    get: (_name: string) => (cookieToken ? { value: cookieToken } : undefined),
  }),
}));

// --- モック: Gemini ---
const generateContent = vi.fn();
vi.mock('@/lib/gemini', () => ({
  getGemini: () => ({ models: { generateContent } }),
  chatModel: () => 'gemini-2.0-flash',
  extractText: (r: { text?: string }) => (typeof r.text === 'string' ? r.text : ''),
}));

import { POST } from './route';

const validDiaryJson = JSON.stringify({
  title: 'テスト',
  body: '本文',
  facts: [],
  feelings: [],
  interpretations: [],
  nextActions: [],
  tags: ['x'],
  rawTranscript: 'ignored',
});

function req(body: unknown, ip = `1.2.3.${Math.floor(Math.random() * 250)}`): Request {
  return new Request('http://localhost/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  _resetRateLimits();
  generateContent.mockReset();
  generateContent.mockResolvedValue({ text: validDiaryJson });
  cookieToken = (await createSessionToken()).token;
});

describe('POST /api/generate', () => {
  it('認証なしは 401（多層防御）', async () => {
    cookieToken = undefined;
    const res = await POST(req({ transcript: 'あ', style: 'natural' }));
    expect(res.status).toBe(401);
  });

  it('空の文字起こしは 400', async () => {
    const res = await POST(req({ transcript: '   ', style: 'natural' }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('empty_transcript');
  });

  it('長すぎる入力は 413', async () => {
    const res = await POST(req({ transcript: 'あ'.repeat(20001), style: 'natural' }));
    expect(res.status).toBe(413);
    const data = await res.json();
    expect(data.error).toBe('transcript_too_long');
  });

  it('正常時は diary を返す', async () => {
    const res = await POST(req({ transcript: '今日は歩いた', style: 'natural' }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.diary.title).toBe('テスト');
    // rawTranscript は入力で上書きされる
    expect(data.diary.rawTranscript).toBe('今日は歩いた');
  });

  it('不正な style はデフォルトにフォールバックして生成する', async () => {
    const res = await POST(req({ transcript: '歩いた', style: 'invalid-style' }));
    expect(res.status).toBe(200);
  });

  it('生成が JSON にならない場合は 502', async () => {
    generateContent.mockResolvedValue({ text: '壊れた出力' });
    const res = await POST(req({ transcript: '歩いた', style: 'natural' }));
    expect(res.status).toBe(502);
  });
});

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
vi.mock('@/lib/gemini', () => ({
  getGemini: () => ({ models: { generateContent } }),
  chatModel: () => 'gemini-3.1-flash-lite',
  extractText: (r: { text?: string }) => (typeof r.text === 'string' ? r.text : ''),
}));

import { POST } from './route';

const validCurrentDiary = {
  title: '元のタイトル',
  body: '元の本文',
  facts: [],
  feelings: [],
  interpretations: [],
  nextActions: [],
  tags: ['x'],
  rawTranscript: '元の文字起こし',
};

const revisedDiaryJson = JSON.stringify({
  title: '修正後のタイトル',
  body: '修正後の本文',
  facts: [],
  feelings: [],
  interpretations: [],
  nextActions: [],
  tags: ['x'],
  rawTranscript: 'ignored',
});

function req(body: unknown, ip = `4.4.4.${Math.floor(Math.random() * 250)}`): Request {
  return new Request('http://localhost/api/diary/revise', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  });
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    transcript: '元の文字起こし',
    currentDiary: validCurrentDiary,
    instruction: 'タイトルをもっと具体的にして',
    style: 'natural',
    ...overrides,
  };
}

beforeEach(async () => {
  _resetRateLimits();
  generateContent.mockReset();
  generateContent.mockResolvedValue({ text: revisedDiaryJson });
  cookieToken = (await createSessionToken()).token;
});

describe('POST /api/diary/revise', () => {
  it('認証なしは 401', async () => {
    cookieToken = undefined;
    const res = await POST(req(validBody()));
    expect(res.status).toBe(401);
  });

  it('transcript が空なら 400', async () => {
    const res = await POST(req(validBody({ transcript: '   ' })));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('empty_transcript');
  });

  it('transcript が長すぎると 413', async () => {
    const res = await POST(req(validBody({ transcript: 'あ'.repeat(20001) })));
    expect(res.status).toBe(413);
    expect((await res.json()).error).toBe('transcript_too_long');
  });

  it('instruction が空なら 400', async () => {
    const res = await POST(req(validBody({ instruction: '' })));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('empty_instruction');
  });

  it('instruction が長すぎると 413', async () => {
    const res = await POST(req(validBody({ instruction: 'あ'.repeat(1001) })));
    expect(res.status).toBe(413);
    expect((await res.json()).error).toBe('instruction_too_long');
  });

  it('currentDiary の形が不正なら 400', async () => {
    const res = await POST(req(validBody({ currentDiary: { title: 'onlyTitle' } })));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_diary');
  });

  it('peopleContext が長すぎると 413', async () => {
    const res = await POST(req(validBody({ peopleContext: 'あ'.repeat(1001) })));
    expect(res.status).toBe(413);
    expect((await res.json()).error).toBe('people_context_too_long');
  });

  it('正常時は修正後の diary を返す', async () => {
    const res = await POST(req(validBody()));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.diary.title).toBe('修正後のタイトル');
    // rawTranscript は入力の transcript で上書きされる
    expect(data.diary.rawTranscript).toBe('元の文字起こし');
  });

  it('プロンプトに修正依頼の内容が渡る', async () => {
    await POST(req(validBody({ instruction: 'もっと短くして' })));
    const call = generateContent.mock.calls[0][0];
    const userText = call.contents[0].parts[0].text;
    expect(userText).toContain('もっと短くして');
  });

  it('不正な style はデフォルトにフォールバックする', async () => {
    const res = await POST(req(validBody({ style: 'invalid-style' })));
    expect(res.status).toBe(200);
  });

  it('生成が JSON にならない場合は 502', async () => {
    generateContent.mockResolvedValue({ text: '壊れた出力' });
    const res = await POST(req(validBody()));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe('revision_failed');
  });

  it('Gemini失敗時はエラー理由を含めて返す（本文は含めない）', async () => {
    generateContent.mockRejectedValue(Object.assign(new Error('quota exceeded'), { status: 429 }));
    const res = await POST(req(validBody()));
    expect(res.status).toBe(429);
    const data = await res.json();
    expect(data.message).toContain('quota exceeded');
    expect(JSON.stringify(data)).not.toContain('元の本文');
  });
});

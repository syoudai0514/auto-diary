import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSessionToken } from '@/lib/auth';
import { _resetRateLimits } from '@/lib/rateLimit';
import { sampleAnalysis } from '@/test/fixtures/talkAnalysis';

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

const validJson = JSON.stringify(sampleAnalysis);

function req(body: unknown, ip = `7.7.7.${Math.floor(Math.random() * 250)}`): Request {
  return new Request('http://localhost/api/talk/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  });
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    transcript: 'A: 片付けしてよ\nB: 後でやるって言ったじゃん',
    speakerA: '妻',
    speakerB: '私',
    ...overrides,
  };
}

beforeEach(async () => {
  _resetRateLimits();
  generateContent.mockReset();
  generateContent.mockResolvedValue({ text: validJson });
  storedUser = { id: 'test-user', geminiKeyEncrypted: 'v1:fake-encrypted-key' };
  cookieToken = (await createSessionToken('test-user')).token;
});

describe('POST /api/talk/analyze', () => {
  it('認証なしは 401', async () => {
    cookieToken = undefined;
    const res = await POST(req(validBody()));
    expect(res.status).toBe(401);
  });

  it('Gemini APIキー未設定は 400 no_api_key', async () => {
    storedUser = { id: 'test-user', geminiKeyEncrypted: null };
    const res = await POST(req(validBody()));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('no_api_key');
  });

  it('transcript が空なら 400', async () => {
    const res = await POST(req(validBody({ transcript: '  ' })));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('empty_transcript');
  });

  it('transcript が長すぎると 413', async () => {
    const res = await POST(req(validBody({ transcript: 'あ'.repeat(40001) })));
    expect(res.status).toBe(413);
    expect((await res.json()).error).toBe('transcript_too_long');
  });

  it('話者名が欠けている/長すぎると 400', async () => {
    expect((await POST(req(validBody({ speakerA: '' })))).status).toBe(400);
    expect((await POST(req(validBody({ speakerB: 'あ'.repeat(31) })))).status).toBe(400);
    expect((await POST(req(validBody({ speakerA: undefined })))).status).toBe(400);
  });

  it('正常時は analysis を返す', async () => {
    const res = await POST(req(validBody()));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.analysis.verdict.leansToward).toBe('B');
    expect(data.analysis.sideA.label).toBe('私');
  });

  it('プロンプトに話者名と文字起こしが渡る', async () => {
    await POST(req(validBody()));
    const call = generateContent.mock.calls[0][0];
    const userText = call.contents[0].parts[0].text;
    expect(userText).toContain('話者Aは「妻」');
    expect(userText).toContain('A: 片付けしてよ');
  });

  it('生成が JSON にならない場合は 502', async () => {
    generateContent.mockResolvedValue({ text: '壊れた出力' });
    const res = await POST(req(validBody()));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe('analysis_failed');
  });

  it('Gemini失敗時はエラー理由を含めて返す（会話本文は含めない）', async () => {
    generateContent.mockRejectedValue(Object.assign(new Error('quota exceeded'), { status: 429 }));
    const res = await POST(req(validBody()));
    expect(res.status).toBe(429);
    const data = await res.json();
    expect(data.message).toContain('quota exceeded');
    expect(JSON.stringify(data)).not.toContain('片付けしてよ');
  });
});

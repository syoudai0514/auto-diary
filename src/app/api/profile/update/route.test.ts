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

function req(body: unknown, ip = `3.3.3.${Math.floor(Math.random() * 250)}`): Request {
  return new Request('http://localhost/api/profile/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  _resetRateLimits();
  generateContent.mockReset();
  generateContent.mockResolvedValue({ text: '## 家族構成\n- 妻(ママ)\n- 長男' });
  cookieToken = (await createSessionToken()).token;
});

describe('POST /api/profile/update', () => {
  it('認証なしは 401', async () => {
    cookieToken = undefined;
    const res = await POST(req({ currentMarkdown: '', newInput: '長男が生まれた' }));
    expect(res.status).toBe(401);
  });

  it('newInput が空なら 400', async () => {
    const res = await POST(req({ currentMarkdown: '', newInput: '   ' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('empty_input');
  });

  it('currentMarkdown が長すぎると 413', async () => {
    const res = await POST(req({ currentMarkdown: 'あ'.repeat(8001), newInput: 'x' }));
    expect(res.status).toBe(413);
    expect((await res.json()).error).toBe('markdown_too_long');
  });

  it('newInput が長すぎると 413', async () => {
    const res = await POST(req({ currentMarkdown: '', newInput: 'あ'.repeat(4001) }));
    expect(res.status).toBe(413);
    expect((await res.json()).error).toBe('input_too_long');
  });

  it('正常時は更新後のMarkdownを返す', async () => {
    const res = await POST(req({ currentMarkdown: '## 家族構成\n- 妻(ママ)', newInput: '長男が生まれた' }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.markdown).toBe('## 家族構成\n- 妻(ママ)\n- 長男');
  });

  it('currentMarkdown 未指定でも動作する', async () => {
    const res = await POST(req({ newInput: '私は父です' }));
    expect(res.status).toBe(200);
  });

  it('結果が空文字なら 502', async () => {
    generateContent.mockResolvedValue({ text: '   ' });
    const res = await POST(req({ currentMarkdown: '', newInput: 'x' }));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe('update_failed');
  });

  it('Gemini失敗時はエラー理由を含めて返す（本文は含めない）', async () => {
    generateContent.mockRejectedValue(Object.assign(new Error('quota exceeded'), { status: 429 }));
    const res = await POST(req({ currentMarkdown: '', newInput: '長男が生まれた' }));
    expect(res.status).toBe(429);
    const data = await res.json();
    expect(data.message).toContain('quota exceeded');
    expect(JSON.stringify(data)).not.toContain('長男が生まれた');
  });
});

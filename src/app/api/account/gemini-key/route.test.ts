import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSessionToken } from '@/lib/auth';
import { _resetRateLimits } from '@/lib/rateLimit';

let cookieToken: string | undefined;
vi.mock('next/headers', () => ({
  cookies: () => ({
    get: (_name: string) => (cookieToken ? { value: cookieToken } : undefined),
  }),
}));

const getUserById = vi.fn();
const setUserGeminiKey = vi.fn();
vi.mock('@/lib/userStore', () => ({
  getUserById: (...args: unknown[]) => getUserById(...args),
  setUserGeminiKey: (...args: unknown[]) => setUserGeminiKey(...args),
}));

import { GET, POST } from './route';

function req(body: unknown, ip = `1.2.3.${Math.floor(Math.random() * 250)}`): Request {
  return new Request('http://localhost/api/account/gemini-key', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  _resetRateLimits();
  getUserById.mockReset();
  setUserGeminiKey.mockReset();
  cookieToken = (await createSessionToken('user-1')).token;
});

describe('GET /api/account/gemini-key', () => {
  it('未認証は401', async () => {
    cookieToken = undefined;
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it('キー未設定なら hasKey:false', async () => {
    getUserById.mockResolvedValue({ id: 'user-1', geminiKeyEncrypted: null });
    const res = await GET();
    const data = await res.json();
    expect(data.hasKey).toBe(false);
  });

  it('キー設定済みなら hasKey:true（平文は返さない）', async () => {
    getUserById.mockResolvedValue({ id: 'user-1', geminiKeyEncrypted: 'v1:abc' });
    const res = await GET();
    const data = await res.json();
    expect(data.hasKey).toBe(true);
    expect(JSON.stringify(data)).not.toContain('abc');
  });
});

describe('POST /api/account/gemini-key', () => {
  it('未認証は401', async () => {
    cookieToken = undefined;
    const res = await POST(req({ apiKey: 'AIzaSyExampleKeyThatIsLongEnough' }));
    expect(res.status).toBe(401);
  });

  it('短すぎるキーは400', async () => {
    const res = await POST(req({ apiKey: 'short' }));
    expect(res.status).toBe(400);
    expect(setUserGeminiKey).not.toHaveBeenCalled();
  });

  it('正常に保存できる', async () => {
    const res = await POST(req({ apiKey: 'AIzaSyExampleKeyThatIsLongEnough' }));
    expect(res.status).toBe(200);
    expect(setUserGeminiKey).toHaveBeenCalledTimes(1);
    const [userId, encrypted] = setUserGeminiKey.mock.calls[0];
    expect(userId).toBe('user-1');
    expect(encrypted).not.toContain('AIzaSyExampleKeyThatIsLongEnough'); // 平文のまま保存しない
  });
});

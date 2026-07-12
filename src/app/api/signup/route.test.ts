import { describe, it, expect, vi, beforeEach } from 'vitest';
import { _resetRateLimits } from '@/lib/rateLimit';

vi.mock('next/headers', () => ({
  cookies: () => ({ get: () => undefined }),
}));

const createUser = vi.fn();
vi.mock('@/lib/userStore', () => ({
  createUser: (...args: unknown[]) => createUser(...args),
}));

import { POST } from './route';

function req(body: unknown, ip = `1.2.3.${Math.floor(Math.random() * 250)}`): Request {
  return new Request('http://localhost/api/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  _resetRateLimits();
  createUser.mockReset();
  createUser.mockImplementation(async (username: string, passwordHash: string) => ({
    id: 'new-user-id',
    username,
    passwordHash,
    geminiKeyEncrypted: null,
    createdAt: new Date().toISOString(),
  }));
});

const validBody = { username: 'taro123', password: 'a-long-enough-password', inviteCode: 'test-invite-code' };

describe('POST /api/signup', () => {
  it('招待コードが違うと 401', async () => {
    const res = await POST(req({ ...validBody, inviteCode: 'wrong-code' }));
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toBe('invalid_invite');
    expect(createUser).not.toHaveBeenCalled();
  });

  it('ユーザー名が短すぎる/形式不正なら 400', async () => {
    const res = await POST(req({ ...validBody, username: 'ab' }));
    expect(res.status).toBe(400);
  });

  it('パスワードが短すぎるなら 400', async () => {
    const res = await POST(req({ ...validBody, password: 'short' }));
    expect(res.status).toBe(400);
  });

  it('壊れたJSONは 400', async () => {
    const res = await POST(
      new Request('http://localhost/api/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{not json',
      }),
    );
    expect(res.status).toBe(400);
  });

  it('ユーザー名が既に使われていれば 409', async () => {
    createUser.mockResolvedValue(null);
    const res = await POST(req(validBody));
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.error).toBe('username_taken');
  });

  it('成功すればセッションCookieが発行される', async () => {
    const res = await POST(req(validBody));
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toContain('vd_session=');
  });

  it('招待コード未設定(サーバー側)なら常に401', async () => {
    const saved = process.env.INVITE_CODE;
    delete process.env.INVITE_CODE;
    const res = await POST(req(validBody));
    expect(res.status).toBe(401);
    process.env.INVITE_CODE = saved;
  });
});

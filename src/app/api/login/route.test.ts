import { describe, it, expect, vi, beforeEach } from 'vitest';
import { _resetRateLimits } from '@/lib/rateLimit';
import { hashPassword } from '@/lib/crypto';

vi.mock('next/headers', () => ({
  cookies: () => ({ get: () => undefined }),
}));

const getUserByUsername = vi.fn();
vi.mock('@/lib/userStore', () => ({
  getUserByUsername: (...args: unknown[]) => getUserByUsername(...args),
}));

import { POST } from './route';

function req(body: unknown, ip = `1.2.3.${Math.floor(Math.random() * 250)}`): Request {
  return new Request('http://localhost/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  });
}

let passwordHash: string;

beforeEach(async () => {
  _resetRateLimits();
  passwordHash = await hashPassword('correct-password-123');
  getUserByUsername.mockReset();
  getUserByUsername.mockImplementation(async (username: string) =>
    username === 'taro'
      ? { id: 'user-1', username: 'taro', passwordHash, geminiKeyEncrypted: null, createdAt: '2026-01-01' }
      : null,
  );
});

describe('POST /api/login', () => {
  it('正しいユーザー名・パスワードならセッションCookieが発行される', async () => {
    const res = await POST(req({ username: 'taro', password: 'correct-password-123' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toContain('vd_session=');
  });

  it('存在しないユーザー名は 401', async () => {
    const res = await POST(req({ username: 'nobody', password: 'correct-password-123' }));
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toBe('invalid_password');
  });

  it('パスワードが違えば 401', async () => {
    const res = await POST(req({ username: 'taro', password: 'wrong-password' }));
    expect(res.status).toBe(401);
  });

  it('空のユーザー名/パスワードは 400', async () => {
    const res = await POST(req({ username: '', password: '' }));
    expect(res.status).toBe(400);
  });

  it('壊れたJSONは 400', async () => {
    const res = await POST(
      new Request('http://localhost/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{not json',
      }),
    );
    expect(res.status).toBe(400);
  });
});

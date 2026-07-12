import { NextResponse } from 'next/server';
import {
  SESSION_COOKIE,
  createSessionToken,
  sessionCookieOptions,
} from '@/lib/auth';
import { verifyPassword } from '@/lib/crypto';
import { getUserByUsername } from '@/lib/userStore';
import { clientKey, rateLimitDistributed } from '@/lib/rateLimit';

export const runtime = 'nodejs';

/**
 * ユーザー名とパスワードでログインし、署名付き HttpOnly Cookie を発行する。
 * 総当たり対策として簡易レート制限を掛ける。
 */
export async function POST(req: Request) {
  // ログイン試行のレート制限（総当たり防止）
  const limited = await rateLimitDistributed(`login:${clientKey(req)}`, {
    capacity: 5,
    refillPerSec: 5 / 60, // 1分あたり5回程度
  });
  if (!limited.ok) {
    return NextResponse.json(
      { error: 'too_many_requests' },
      { status: 429, headers: { 'Retry-After': String(limited.retryAfter) } },
    );
  }

  let username: unknown;
  let password: unknown;
  try {
    const body = await req.json();
    username = body?.username;
    password = body?.password;
  } catch {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }

  // 入力サイズ制限（極端に長い入力は拒否）
  if (typeof username !== 'string' || username.length === 0 || username.length > 64) {
    return NextResponse.json({ error: 'invalid' }, { status: 400 });
  }
  if (typeof password !== 'string' || password.length === 0 || password.length > 512) {
    return NextResponse.json({ error: 'invalid' }, { status: 400 });
  }

  const user = await getUserByUsername(username);
  const ok = user ? await verifyPassword(password, user.passwordHash) : false;
  if (!user || !ok) {
    // ユーザー名・パスワードのどちらが誤りかは区別せず返す（列挙攻撃対策）
    return NextResponse.json({ error: 'invalid_password' }, { status: 401 });
  }

  const { token, maxAge } = await createSessionToken(user.id);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(maxAge));
  return res;
}

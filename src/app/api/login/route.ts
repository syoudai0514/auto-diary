import { NextResponse } from 'next/server';
import {
  SESSION_COOKIE,
  checkPassword,
  createSessionToken,
  sessionCookieOptions,
} from '@/lib/auth';
import { clientKey, rateLimit } from '@/lib/rateLimit';

export const runtime = 'nodejs';

/**
 * パスワードでログインし、署名付き HttpOnly Cookie を発行する。
 * 総当たり対策として簡易レート制限を掛ける。
 */
export async function POST(req: Request) {
  // ログイン試行のレート制限（総当たり防止）
  const limited = rateLimit(`login:${clientKey(req)}`, {
    capacity: 5,
    refillPerSec: 5 / 60, // 1分あたり5回程度
  });
  if (!limited.ok) {
    return NextResponse.json(
      { error: 'too_many_requests' },
      { status: 429, headers: { 'Retry-After': String(limited.retryAfter) } },
    );
  }

  let password: unknown;
  try {
    const body = await req.json();
    password = body?.password;
  } catch {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }

  // 入力サイズ制限（極端に長いパスワードは拒否）
  if (typeof password !== 'string' || password.length > 512) {
    return NextResponse.json({ error: 'invalid' }, { status: 400 });
  }

  if (!checkPassword(password)) {
    // パスワード自体はログに出さない
    return NextResponse.json({ error: 'invalid_password' }, { status: 401 });
  }

  const { token, maxAge } = await createSessionToken();
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(maxAge));
  return res;
}

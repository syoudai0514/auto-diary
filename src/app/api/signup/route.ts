import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  SESSION_COOKIE,
  createSessionToken,
  sessionCookieOptions,
} from '@/lib/auth';
import { hashPassword, timingSafeEqualString } from '@/lib/crypto';
import { createUser } from '@/lib/userStore';
import { clientKey, rateLimit } from '@/lib/rateLimit';

export const runtime = 'nodejs';

const SignupSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3)
    .max(32)
    .regex(/^[a-zA-Z0-9_]+$/),
  password: z.string().min(8).max(512),
  inviteCode: z.string().min(1).max(512),
});

/**
 * 招待コードを持つ人だけが、ユーザー名・パスワードで新規アカウントを作成できる。
 * 成功したらそのままログイン状態にする（署名付き HttpOnly Cookie を発行）。
 */
export async function POST(req: Request) {
  // 総当たり・招待コード推測対策のレート制限
  const limited = rateLimit(`signup:${clientKey(req)}`, {
    capacity: 5,
    refillPerSec: 5 / 3600, // 1時間あたり5回程度
  });
  if (!limited.ok) {
    return NextResponse.json(
      { error: 'too_many_requests' },
      { status: 429, headers: { 'Retry-After': String(limited.retryAfter) } },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }

  const parsed = SignupSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid' }, { status: 400 });
  }
  const { username, password, inviteCode } = parsed.data;

  const expectedInvite = process.env.INVITE_CODE;
  if (!expectedInvite || !timingSafeEqualString(inviteCode, expectedInvite)) {
    // 招待コード自体はログに出さない
    return NextResponse.json({ error: 'invalid_invite' }, { status: 401 });
  }

  const passwordHash = await hashPassword(password);
  const user = await createUser(username, passwordHash);
  if (!user) {
    return NextResponse.json({ error: 'username_taken' }, { status: 409 });
  }

  const { token, maxAge } = await createSessionToken(user.id);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(maxAge));
  return res;
}

import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { SESSION_COOKIE, verifySessionToken } from './auth';

export interface AuthResult {
  userId: string;
}

/**
 * API Route 用の認証ガード。
 * middleware でもページ/APIを保護するが、多層防御として各エンドポイントでも検証する。
 * 認証済みなら { userId }、未認証なら 401 レスポンスを返す。
 * 呼び出し側は `if (auth instanceof NextResponse) return auth;` で分岐する。
 */
export async function requireAuth(): Promise<AuthResult | NextResponse> {
  const token = cookies().get(SESSION_COOKIE)?.value;
  const session = await verifySessionToken(token);
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  return { userId: session.sub };
}

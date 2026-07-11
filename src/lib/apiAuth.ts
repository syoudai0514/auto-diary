import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { SESSION_COOKIE, verifySessionToken } from './auth';

/**
 * API Route 用の認証ガード。
 * middleware でもページ/APIを保護するが、多層防御として各エンドポイントでも検証する。
 * 認証済みなら null、未認証なら 401 レスポンスを返す。
 */
export async function requireAuth(): Promise<NextResponse | null> {
  const token = cookies().get(SESSION_COOKIE)?.value;
  const ok = await verifySessionToken(token);
  if (!ok) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  return null;
}

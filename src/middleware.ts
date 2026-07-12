import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/auth';

/**
 * 認証ミドルウェア。ログインページ・ログイン API・PWA アセットを除き、
 * 未認証アクセスをブロックする（ページはログインへリダイレクト、APIは 401）。
 */

const PUBLIC_PATHS = new Set<string>([
  '/login',
  '/api/login',
  '/signup',
  '/api/signup',
  '/manifest.webmanifest',
  '/sw.js',
  '/favicon.ico',
]);

function isPublicAsset(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true;
  if (pathname.startsWith('/icons/')) return true;
  return false;
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (isPublicAsset(pathname)) {
    return NextResponse.next();
  }

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = await verifySessionToken(token);

  if (session) return NextResponse.next();

  // API は 401 を返す
  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // ページはログインへリダイレクト
  const url = req.nextUrl.clone();
  url.pathname = '/login';
  url.searchParams.set('next', pathname);
  return NextResponse.redirect(url);
}

export const config = {
  // _next 静的アセットと画像最適化は除外
  matcher: ['/((?!_next/static|_next/image).*)'],
};

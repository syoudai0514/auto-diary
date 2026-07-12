'use client';

/**
 * ログイン/サインアップ後に戻る `next` クエリパラメータを検証する。
 * `next.startsWith('/')` だけのチェックでは `//evil.example` のような
 * プロトコル相対URLを弾けず、ブラウザはこれを外部サイトへのリダイレクトとして
 * 扱ってしまう（オープンリダイレクト脆弱性）。同一オリジンの絶対パスである
 * ことを確認したうえで、パス部分だけを返す。
 */
export function safeNextPath(next: string | null | undefined): string {
  if (!next) return '/';
  try {
    const resolved = new URL(next, window.location.origin);
    if (resolved.origin !== window.location.origin) return '/';
    return `${resolved.pathname}${resolved.search}${resolved.hash}` || '/';
  } catch {
    return '/';
  }
}

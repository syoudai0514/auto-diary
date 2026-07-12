/**
 * 署名付きセッションクッキーの発行・検証。
 * middleware(Edge) と API Route(Node) の両方で動くよう Web Crypto(subtle) のみを使う。
 * ユーザーIDだけを署名対象に含める（パスワードや API キーは一切クッキーに含めない）。
 * ユーザーの実体（アカウント情報）の解決はここでは行わない（DBアクセスなし、Edge対応を維持するため）。
 */

export const SESSION_COOKIE = 'vd_session';

function getSecret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s) {
    // 本番では必ず設定される想定。開発時の取り違え検知のため明示的に投げる。
    throw new Error('AUTH_SECRET が設定されていません');
  }
  return s;
}

function sessionDays(): number {
  const n = Number(process.env.SESSION_DAYS);
  return Number.isFinite(n) && n > 0 ? n : 30;
}

// --- base64url ヘルパ（Edge/Node 共通） ---------------------------------
function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  const b64 = btoa(bin);
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
  const bin = atob(b64 + pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

const encoder = new TextEncoder();

async function hmac(payloadB64: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(getSecret()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(payloadB64));
  return toBase64Url(new Uint8Array(sig));
}

/** タイミング安全な文字列比較。 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

interface SessionPayload {
  exp: number; // epoch seconds
  iat: number;
  sub: string; // userId
}

/** ログイン/サインアップ成功後に発行するトークン文字列（payload.signature）。 */
export async function createSessionToken(
  userId: string,
): Promise<{ token: string; maxAge: number }> {
  const now = Math.floor(Date.now() / 1000);
  const maxAge = sessionDays() * 24 * 60 * 60;
  const payload: SessionPayload = { iat: now, exp: now + maxAge, sub: userId };
  const payloadB64 = toBase64Url(encoder.encode(JSON.stringify(payload)));
  const sig = await hmac(payloadB64);
  return { token: `${payloadB64}.${sig}`, maxAge };
}

export interface Session {
  sub: string; // userId
}

/** トークンを検証する。有効なら中身（ユーザーID）を返す。無効なら null。 */
export async function verifySessionToken(
  token: string | undefined | null,
): Promise<Session | null> {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, sig] = parts;
  try {
    const expected = await hmac(payloadB64);
    if (!timingSafeEqual(sig, expected)) return null;
    const json = new TextDecoder().decode(fromBase64Url(payloadB64));
    const payload = JSON.parse(json) as SessionPayload;
    const now = Math.floor(Date.now() / 1000);
    if (typeof payload.exp !== 'number' || payload.exp <= now) return null;
    if (typeof payload.sub !== 'string' || !payload.sub) return null;
    return { sub: payload.sub };
  } catch {
    return null;
  }
}

/** Set-Cookie 用の属性を組み立てる。 */
export function sessionCookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge,
  };
}

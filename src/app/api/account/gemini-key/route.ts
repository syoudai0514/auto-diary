import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/apiAuth';
import { clientKey, rateLimitDistributed } from '@/lib/rateLimit';
import { encryptSecret } from '@/lib/crypto';
import { getUserById, setUserGeminiKey } from '@/lib/userStore';

export const runtime = 'nodejs';

const KeySchema = z.object({
  apiKey: z.string().trim().min(10).max(200),
});

/** 自分のGemini APIキーが登録済みかどうかだけを返す（キー自体は絶対に返さない）。 */
export async function GET() {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const user = await getUserById(auth.userId);
  return NextResponse.json({ hasKey: !!user?.geminiKeyEncrypted });
}

/** 自分のGemini APIキーを登録・更新する。暗号化して保存し、平文はどこにも残さない。 */
export async function POST(req: Request) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const limited = await rateLimitDistributed(`account-gemini-key:${clientKey(req)}`, {
    capacity: 5,
    refillPerSec: 5 / 60,
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

  const parsed = KeySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_key' }, { status: 400 });
  }

  const encrypted = encryptSecret(parsed.data.apiKey);
  await setUserGeminiKey(auth.userId, encrypted);
  return NextResponse.json({ ok: true });
}

import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/apiAuth';
import { rateLimit } from '@/lib/rateLimit';
import { chatModel, getGemini } from '@/lib/gemini';
import { aiErrorResponse, resolveGeminiApiKey } from '@/lib/aiRoute';
import { ProfileUpdateError, updateProfile } from '@/lib/updateProfile';

export const runtime = 'nodejs';
// Fluid Compute有効時の上限に合わせる（Gemini応答が遅い場合の余裕を持たせる）
export const maxDuration = 300;

/** 現在のプロフィール(Markdown)の最大長。 */
const MAX_MARKDOWN_CHARS = 8000;
/** 新しい入力（テキスト or 音声の文字起こし）の最大長。 */
const MAX_INPUT_CHARS = 4000;

/**
 * 現在のプロフィール(Markdown)と新しい入力を統合し、更新後のプロフィールを返す。
 * 音声・本文はログに一切出力しない。
 */
export async function POST(req: Request) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { userId } = auth;

  const limited = rateLimit(`profile-update:${userId}`, {
    capacity: 5,
    refillPerSec: 5 / 60,
  });
  if (!limited.ok) {
    return NextResponse.json(
      { error: 'too_many_requests' },
      { status: 429, headers: { 'Retry-After': String(limited.retryAfter) } },
    );
  }

  let currentMarkdown: unknown;
  let newInput: unknown;
  try {
    const body = await req.json();
    currentMarkdown = body?.currentMarkdown;
    newInput = body?.newInput;
  } catch {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }

  if (typeof newInput !== 'string' || newInput.trim().length === 0) {
    return NextResponse.json({ error: 'empty_input' }, { status: 400 });
  }
  if (typeof currentMarkdown !== 'string') currentMarkdown = '';
  if ((currentMarkdown as string).length > MAX_MARKDOWN_CHARS) {
    return NextResponse.json(
      {
        error: 'markdown_too_long',
        message: `プロフィールが長すぎます（上限 ${MAX_MARKDOWN_CHARS} 文字）。整理してから再度お試しください。`,
      },
      { status: 413 },
    );
  }
  if (newInput.length > MAX_INPUT_CHARS) {
    return NextResponse.json(
      {
        error: 'input_too_long',
        message: `追加する情報が長すぎます（上限 ${MAX_INPUT_CHARS} 文字）。`,
      },
      { status: 413 },
    );
  }

  const keyResult = await resolveGeminiApiKey(userId);
  if (keyResult instanceof NextResponse) return keyResult;

  try {
    const markdown = await updateProfile(getGemini(keyResult.apiKey), {
      currentMarkdown: currentMarkdown as string,
      newInput,
      model: chatModel(),
    });
    return NextResponse.json({ markdown });
  } catch (err: unknown) {
    if (err instanceof ProfileUpdateError) {
      console.error('[profile-update] empty result');
      return NextResponse.json(
        { error: 'update_failed', message: 'プロフィールの更新に失敗しました。' },
        { status: 502 },
      );
    }
    return aiErrorResponse(
      { tag: 'profile-update', code: 'update_failed', messageBase: 'プロフィールの更新に失敗しました' },
      err,
    );
  }
}

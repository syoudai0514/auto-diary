import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/apiAuth';
import { clientKey, rateLimit } from '@/lib/rateLimit';
import { chatModel, getGemini } from '@/lib/gemini';
import { DEFAULT_STYLE, isDiaryStyleId } from '@/lib/diary';
import { DiaryGenerationError, generateDiary } from '@/lib/generateDiary';

export const runtime = 'nodejs';
export const maxDuration = 60;

/** 文字起こしテキストの最大長（入力サイズ制限）。 */
const MAX_TRANSCRIPT_CHARS = 20000;

/**
 * 文字起こしテキストから構造化日記を生成して返す。
 */
export async function POST(req: Request) {
  const unauth = await requireAuth();
  if (unauth) return unauth;

  const limited = rateLimit(`generate:${clientKey(req)}`, {
    capacity: 5,
    refillPerSec: 5 / 60,
  });
  if (!limited.ok) {
    return NextResponse.json(
      { error: 'too_many_requests' },
      { status: 429, headers: { 'Retry-After': String(limited.retryAfter) } },
    );
  }

  let transcript: unknown;
  let style: unknown;
  try {
    const body = await req.json();
    transcript = body?.transcript;
    style = body?.style;
  } catch {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }

  if (typeof transcript !== 'string' || transcript.trim().length === 0) {
    return NextResponse.json({ error: 'empty_transcript' }, { status: 400 });
  }
  if (transcript.length > MAX_TRANSCRIPT_CHARS) {
    return NextResponse.json(
      {
        error: 'transcript_too_long',
        message: `テキストが長すぎます（上限 ${MAX_TRANSCRIPT_CHARS} 文字）。`,
      },
      { status: 413 },
    );
  }

  const styleId = isDiaryStyleId(style) ? style : DEFAULT_STYLE;

  try {
    const diary = await generateDiary(getGemini(), {
      transcript,
      style: styleId,
      model: chatModel(),
    });
    return NextResponse.json({ diary });
  } catch (err: unknown) {
    if (err instanceof DiaryGenerationError) {
      console.error('[generate] parse/generation error');
      return NextResponse.json(
        { error: 'generation_failed', message: '日記の生成に失敗しました。' },
        { status: 502 },
      );
    }
    const status = statusFromError(err);
    const reason = errReason(err);
    console.error('[generate] failed:', status, reason || (err instanceof Error ? err.name : 'UnknownError'));
    return NextResponse.json(
      {
        error: 'generation_failed',
        message: reason ? `日記の生成に失敗しました（${reason}）` : '日記の生成に失敗しました。',
      },
      { status },
    );
  }
}

function statusFromError(err: unknown): number {
  if (err && typeof err === 'object' && 'status' in err) {
    const s = Number((err as { status?: unknown }).status);
    if (Number.isFinite(s) && s >= 400 && s < 600) return s;
  }
  return 502;
}

/** Gemini SDK のエラーメッセージ（API側の失敗理由。ユーザーの文字起こし本文は含まれない）。 */
function errReason(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) {
    return String((err as Error).message).slice(0, 300);
  }
  return '';
}

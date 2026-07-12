import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/apiAuth';
import { rateLimit } from '@/lib/rateLimit';
import { chatModel, getGemini } from '@/lib/gemini';
import { decryptSecret } from '@/lib/crypto';
import { getUserById } from '@/lib/userStore';
import { DEFAULT_STYLE, DiarySchema, isDiaryStyleId } from '@/lib/diary';
import { DiaryGenerationError, reviseDiary } from '@/lib/generateDiary';

export const runtime = 'nodejs';
// Fluid Compute有効時の上限に合わせる（Gemini応答が遅い場合の余裕を持たせる）
export const maxDuration = 300;

/** 文字起こしテキストの最大長（入力サイズ制限）。 */
const MAX_TRANSCRIPT_CHARS = 20000;
/** 修正依頼テキストの最大長。 */
const MAX_INSTRUCTION_CHARS = 1000;
/** peopleContext（登場人物の補足情報）の最大長。 */
const MAX_PEOPLE_CONTEXT_CHARS = 1000;

/**
 * 生成済みの日記を、ユーザーからの修正依頼（テキストまたは音声の文字起こし）に
 * 従って書き直す。
 */
export async function POST(req: Request) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { userId } = auth;

  const limited = rateLimit(`revise:${userId}`, {
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
  let currentDiary: unknown;
  let instruction: unknown;
  let style: unknown;
  let peopleContext: unknown;
  try {
    const body = await req.json();
    transcript = body?.transcript;
    currentDiary = body?.currentDiary;
    instruction = body?.instruction;
    style = body?.style;
    peopleContext = body?.peopleContext;
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

  if (typeof instruction !== 'string' || instruction.trim().length === 0) {
    return NextResponse.json({ error: 'empty_instruction' }, { status: 400 });
  }
  if (instruction.length > MAX_INSTRUCTION_CHARS) {
    return NextResponse.json(
      {
        error: 'instruction_too_long',
        message: `修正依頼が長すぎます（上限 ${MAX_INSTRUCTION_CHARS} 文字）。`,
      },
      { status: 413 },
    );
  }

  if (typeof peopleContext === 'string' && peopleContext.length > MAX_PEOPLE_CONTEXT_CHARS) {
    return NextResponse.json(
      {
        error: 'people_context_too_long',
        message: `登場人物の補足情報が長すぎます（上限 ${MAX_PEOPLE_CONTEXT_CHARS} 文字）。`,
      },
      { status: 413 },
    );
  }

  const parsedDiary = DiarySchema.safeParse(currentDiary);
  if (!parsedDiary.success) {
    return NextResponse.json({ error: 'invalid_diary' }, { status: 400 });
  }

  const styleId = isDiaryStyleId(style) ? style : DEFAULT_STYLE;

  const user = await getUserById(userId);
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!user.geminiKeyEncrypted) {
    return NextResponse.json(
      { error: 'no_api_key', message: 'Gemini APIキーが未設定です。設定画面から登録してください。' },
      { status: 400 },
    );
  }

  try {
    const apiKey = decryptSecret(user.geminiKeyEncrypted);
    const diary = await reviseDiary(getGemini(apiKey), {
      transcript,
      currentDiary: parsedDiary.data,
      instruction,
      style: styleId,
      model: chatModel(),
      peopleContext: typeof peopleContext === 'string' ? peopleContext : undefined,
    });
    return NextResponse.json({ diary });
  } catch (err: unknown) {
    if (err instanceof DiaryGenerationError) {
      console.error('[revise] parse/generation error');
      return NextResponse.json(
        { error: 'revision_failed', message: '日記の修正に失敗しました。' },
        { status: 502 },
      );
    }
    const status = statusFromError(err);
    const reason = errReason(err);
    console.error('[revise] failed:', status, reason || (err instanceof Error ? err.name : 'UnknownError'));
    return NextResponse.json(
      {
        error: 'revision_failed',
        message: reason ? `日記の修正に失敗しました（${reason}）` : '日記の修正に失敗しました。',
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

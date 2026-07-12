import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/apiAuth';
import { rateLimitDistributed } from '@/lib/rateLimit';
import { chatModel, getGemini } from '@/lib/gemini';
import { aiErrorResponse, resolveGeminiApiKey } from '@/lib/aiRoute';
import { analyzeTalk, TalkAnalysisError } from '@/lib/analyzeTalk';

export const runtime = 'nodejs';
// Fluid Compute有効時の上限に合わせる（Gemini応答が遅い場合の余裕を持たせる）
export const maxDuration = 300;

/** 話者付き文字起こしの最大長。話し合いは日記より長くなりがちなので余裕を持たせる。 */
const MAX_TRANSCRIPT_CHARS = 40000;
/** 話者名の最大長。 */
const MAX_SPEAKER_CHARS = 30;
/** peopleContext（登場人物の補足情報）の最大長。 */
const MAX_PEOPLE_CONTEXT_CHARS = 1000;

/**
 * 話者付き文字起こしから、ふたりの話し合いの構造化分析を生成して返す。
 * 会話の内容はサーバーに保存せず、ログにも出力しない。
 */
export async function POST(req: Request) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { userId } = auth;

  const limited = await rateLimitDistributed(`talk-analyze:${userId}`, {
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
  let speakerA: unknown;
  let speakerB: unknown;
  let peopleContext: unknown;
  try {
    const body = await req.json();
    transcript = body?.transcript;
    speakerA = body?.speakerA;
    speakerB = body?.speakerB;
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
  if (
    typeof speakerA !== 'string' ||
    speakerA.trim().length === 0 ||
    speakerA.length > MAX_SPEAKER_CHARS ||
    typeof speakerB !== 'string' ||
    speakerB.trim().length === 0 ||
    speakerB.length > MAX_SPEAKER_CHARS
  ) {
    return NextResponse.json({ error: 'invalid_speakers' }, { status: 400 });
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

  const keyResult = await resolveGeminiApiKey(userId);
  if (keyResult instanceof NextResponse) return keyResult;

  try {
    const analysis = await analyzeTalk(getGemini(keyResult.apiKey), {
      transcript,
      speakerA,
      speakerB,
      model: chatModel(),
      peopleContext: typeof peopleContext === 'string' ? peopleContext : undefined,
    });
    return NextResponse.json({ analysis });
  } catch (err: unknown) {
    if (err instanceof TalkAnalysisError) {
      console.error('[talk-analyze] parse/generation error');
      return NextResponse.json(
        { error: 'analysis_failed', message: '話し合いの分析に失敗しました。' },
        { status: 502 },
      );
    }
    return aiErrorResponse(
      { tag: 'talk-analyze', code: 'analysis_failed', messageBase: '話し合いの分析に失敗しました' },
      err,
    );
  }
}

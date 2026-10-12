import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/apiAuth';
import { rateLimitDistributed } from '@/lib/rateLimit';
import { getGemini } from '@/lib/gemini';
import { factnoteModel, withModelFallback } from '@/lib/factnote/modelFallback';
import { aiErrorResponse, resolveGeminiApiKey } from '@/lib/aiRoute';
import { OverallReviewError, runOverallReview } from '@/lib/factnote/overallReview';
import { OVERALL_REVIEW_PROMPT_VERSION } from '@/lib/factnote/prompts/overallReview';
import { buildMockOverallReviewPayload } from '@/lib/factnote/fixtures';
import { isAiMock } from '@/lib/factnote/mock';

export const runtime = 'nodejs';
export const maxDuration = 300;

/** 要約の上限（120件 × 1件あたり数百文字 + 集計ヘッダーを想定）。 */
const MAX_DIGEST_CHARS = 80000;

/**
 * 全体の見解（全記録を通じた総評）。受け取るのはクライアントで作った分析結果の要約と
 * ローカル集計のみで、記録の本文は受け取らない。内容はログに出さない。
 */
export async function POST(req: Request) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { userId } = auth;

  // 重い処理なので一件分析より厳しめ（1分あたり2回）
  const limited = await rateLimitDistributed(`factnote-overall:${userId}`, {
    capacity: 2,
    refillPerSec: 2 / 60,
  });
  if (!limited.ok) {
    return NextResponse.json(
      { error: 'too_many_requests' },
      { status: 429, headers: { 'Retry-After': String(limited.retryAfter) } },
    );
  }

  let digest: unknown;
  let peopleContextRaw: unknown;
  try {
    const body = await req.json();
    digest = body?.digest;
    peopleContextRaw = body?.peopleContext;
  } catch {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }
  if (typeof digest !== 'string' || digest.trim().length === 0) {
    return NextResponse.json({ error: 'empty_digest' }, { status: 400 });
  }
  if (digest.length > MAX_DIGEST_CHARS) {
    return NextResponse.json(
      { error: 'digest_too_long', message: '記録の要約が長すぎます。' },
      { status: 413 },
    );
  }

  if (isAiMock()) {
    return NextResponse.json({
      review: buildMockOverallReviewPayload(),
      aiModel: 'mock',
      promptVersion: OVERALL_REVIEW_PROMPT_VERSION,
    });
  }

  const keyResult = await resolveGeminiApiKey(userId);
  if (keyResult instanceof NextResponse) return keyResult;

  try {
    const model = factnoteModel();
    const gemini = withModelFallback(getGemini(keyResult.apiKey), model);
    const review = await runOverallReview(gemini.ai, {
      digest,
      peopleContext:
        typeof peopleContextRaw === 'string' && peopleContextRaw.trim()
          ? peopleContextRaw.slice(0, 2000)
          : undefined,
      model,
    });
    return NextResponse.json({ review, aiModel: gemini.modelUsed(), promptVersion: OVERALL_REVIEW_PROMPT_VERSION });
  } catch (err: unknown) {
    if (err instanceof OverallReviewError) {
      console.error('[factnote-overall] parse error');
      return NextResponse.json(
        { error: 'overall_failed', message: '全体の見解の生成に失敗しました。もう一度お試しください。' },
        { status: 502 },
      );
    }
    return aiErrorResponse(
      { tag: 'factnote-overall', code: 'overall_failed', messageBase: '全体の見解の生成に失敗しました' },
      err,
    );
  }
}

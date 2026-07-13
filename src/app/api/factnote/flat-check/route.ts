import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/apiAuth';
import { rateLimitDistributed } from '@/lib/rateLimit';
import { chatModel, getGemini } from '@/lib/gemini';
import { aiErrorResponse, resolveGeminiApiKey } from '@/lib/aiRoute';
import { FlatCheckError, runFlatCheck, toFlatCheckAiPart } from '@/lib/factnote/flatCheck';
import { buildMockFlatCheckAiPart } from '@/lib/factnote/fixtures';
import { isAiMock } from '@/lib/factnote/mock';

export const runtime = 'nodejs';
export const maxDuration = 300;

const MAX_SOURCE_CHARS = 40000;
const MAX_STATS_CHARS = 6000;

/**
 * フラットチェック（追加依頼 §9〜§13）。今回の記録テキストと、
 * ローカル集計済みの過去比較・偏り警告を受け取り、AI部分だけを返す。
 * 結果はクライアント側で FlatCheckResult に組み立てて IndexedDB に保存する。
 * 内容はサーバーに保存せず、ログにも出さない。
 */
export async function POST(req: Request) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { userId } = auth;

  const limited = await rateLimitDistributed(`factnote-flatcheck:${userId}`, {
    capacity: 5,
    refillPerSec: 5 / 60,
  });
  if (!limited.ok) {
    return NextResponse.json(
      { error: 'too_many_requests' },
      { status: 429, headers: { 'Retry-After': String(limited.retryAfter) } },
    );
  }

  let sourceText: unknown;
  let analysisSummary: unknown;
  let pastStats: unknown;
  let biasWarnings: unknown;
  try {
    const body = await req.json();
    sourceText = body?.sourceText;
    analysisSummary = body?.analysisSummary;
    pastStats = body?.pastStats;
    biasWarnings = body?.biasWarnings;
  } catch {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }

  if (typeof sourceText !== 'string' || sourceText.trim().length === 0) {
    return NextResponse.json({ error: 'empty_source' }, { status: 400 });
  }
  if (sourceText.length > MAX_SOURCE_CHARS) {
    return NextResponse.json(
      { error: 'source_too_long', message: `テキストが長すぎます（上限 ${MAX_SOURCE_CHARS} 文字）。` },
      { status: 413 },
    );
  }
  const stats = typeof pastStats === 'string' ? pastStats.slice(0, MAX_STATS_CHARS) : '';
  const warnings = Array.isArray(biasWarnings)
    ? biasWarnings.filter((w): w is string => typeof w === 'string').slice(0, 10)
    : [];

  if (isAiMock()) {
    return NextResponse.json({ check: buildMockFlatCheckAiPart() });
  }

  const keyResult = await resolveGeminiApiKey(userId);
  if (keyResult instanceof NextResponse) return keyResult;

  try {
    const model = chatModel();
    const payload = await runFlatCheck(getGemini(keyResult.apiKey), {
      sourceText,
      analysisSummary: typeof analysisSummary === 'string' ? analysisSummary.slice(0, 8000) : undefined,
      pastStats: stats,
      biasWarnings: warnings,
      model,
    });
    return NextResponse.json({ check: toFlatCheckAiPart(payload, { aiModel: model }) });
  } catch (err: unknown) {
    if (err instanceof FlatCheckError) {
      console.error('[factnote-flatcheck] parse/generation error');
      return NextResponse.json(
        { error: 'flatcheck_failed', message: 'フラットチェックに失敗しました。' },
        { status: 502 },
      );
    }
    return aiErrorResponse(
      { tag: 'factnote-flatcheck', code: 'flatcheck_failed', messageBase: 'フラットチェックに失敗しました' },
      err,
    );
  }
}

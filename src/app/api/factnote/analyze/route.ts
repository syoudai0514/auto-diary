import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/apiAuth';
import { rateLimitDistributed } from '@/lib/rateLimit';
import { chatModel, getGemini } from '@/lib/gemini';
import { aiErrorResponse, resolveGeminiApiKey } from '@/lib/aiRoute';
import {
  analyzeIncident,
  IncidentAnalysisError,
  toIncidentAnalysisResult,
} from '@/lib/factnote/analyzeIncident';
import type { IncidentContext } from '@/lib/factnote/prompts/incidentAnalysis';
import { buildMockAnalyzeResult } from '@/lib/factnote/fixtures';
import { isAiMock } from '@/lib/factnote/mock';

export const runtime = 'nodejs';
// Fluid Compute有効時の上限に合わせる（Gemini応答が遅い場合の余裕を持たせる）
export const maxDuration = 300;

/** 分析対象テキストの最大長（talk-analyze と同じ上限）。 */
const MAX_SOURCE_CHARS = 40000;
/** 補足情報の各フィールドの最大長。 */
const MAX_CONTEXT_FIELD_CHARS = 200;

function sanitizeContext(raw: unknown): IncidentContext {
  const body = (raw ?? {}) as Record<string, unknown>;
  const str = (v: unknown) =>
    typeof v === 'string' && v.trim() ? v.trim().slice(0, MAX_CONTEXT_FIELD_CHARS) : undefined;
  const strArray = (v: unknown) =>
    Array.isArray(v)
      ? v
          .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
          .slice(0, 10)
          .map((x) => x.trim().slice(0, MAX_CONTEXT_FIELD_CHARS))
      : undefined;
  return {
    occurredAt: str(body.occurredAt),
    location: str(body.location),
    people: strArray(body.people),
    childrenPresent: str(body.childrenPresent),
    emotions: strArray(body.emotions),
  };
}

/**
 * 出来事の記録から構造化分析を生成して返す（依頼書 §12/§13/§14/§15）。
 * 記録の内容はサーバーに保存せず、ログにも出力しない。
 */
export async function POST(req: Request) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { userId } = auth;

  const limited = await rateLimitDistributed(`factnote-analyze:${userId}`, {
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
  let contextRaw: unknown;
  try {
    const body = await req.json();
    sourceText = body?.sourceText;
    contextRaw = body?.context;
  } catch {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }

  if (typeof sourceText !== 'string' || sourceText.trim().length === 0) {
    return NextResponse.json({ error: 'empty_source' }, { status: 400 });
  }
  if (sourceText.length > MAX_SOURCE_CHARS) {
    return NextResponse.json(
      {
        error: 'source_too_long',
        message: `テキストが長すぎます（上限 ${MAX_SOURCE_CHARS} 文字）。`,
      },
      { status: 413 },
    );
  }

  if (isAiMock()) {
    return NextResponse.json({ result: buildMockAnalyzeResult() });
  }

  const keyResult = await resolveGeminiApiKey(userId);
  if (keyResult instanceof NextResponse) return keyResult;

  try {
    const model = chatModel();
    const payload = await analyzeIncident(getGemini(keyResult.apiKey), {
      sourceText,
      context: sanitizeContext(contextRaw),
      model,
    });
    const result = toIncidentAnalysisResult(payload, { aiModel: model });
    return NextResponse.json({ result });
  } catch (err: unknown) {
    if (err instanceof IncidentAnalysisError) {
      // 内容はログに出さない（種別のみ）
      console.error(`[factnote-analyze] ${err.kind} error`);
      return NextResponse.json(
        {
          error: err.kind === 'truncated' ? 'analysis_truncated' : 'analysis_failed',
          message:
            err.kind === 'truncated'
              ? err.message
              : '分析に失敗しました。しばらくしてから再試行してください。',
        },
        { status: 502 },
      );
    }
    return aiErrorResponse(
      { tag: 'factnote-analyze', code: 'analysis_failed', messageBase: '分析に失敗しました' },
      err,
    );
  }
}

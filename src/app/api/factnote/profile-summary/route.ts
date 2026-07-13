import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/apiAuth';
import { rateLimitDistributed } from '@/lib/rateLimit';
import { chatModel, extractText, getGemini } from '@/lib/gemini';
import { aiErrorResponse, resolveGeminiApiKey } from '@/lib/aiRoute';
import {
  buildObjectiveProfileSystemPrompt,
  buildObjectiveProfileUserPrompt,
  OBJECTIVE_PROFILE_PROMPT_VERSION,
} from '@/lib/factnote/prompts/objectiveProfile';
import { MOCK_PROFILE_SUMMARY } from '@/lib/factnote/fixtures';
import { isAiMock } from '@/lib/factnote/mock';

export const runtime = 'nodejs';
export const maxDuration = 300;

/** ローカル集計テキストの上限（記録本文は送られてこない前提の小さな値）。 */
const MAX_STATS_CHARS = 6000;

/**
 * 客観カルテのAI講評（追加依頼 §8）。受け取るのはローカル集計結果のみで、
 * 記録本文・実名は受け取らない。内容はログに出さない。
 */
export async function POST(req: Request) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { userId } = auth;

  const limited = await rateLimitDistributed(`factnote-profile:${userId}`, {
    capacity: 5,
    refillPerSec: 5 / 60,
  });
  if (!limited.ok) {
    return NextResponse.json(
      { error: 'too_many_requests' },
      { status: 429, headers: { 'Retry-After': String(limited.retryAfter) } },
    );
  }

  let stats: unknown;
  try {
    const body = await req.json();
    stats = body?.stats;
  } catch {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }
  if (typeof stats !== 'string' || stats.trim().length === 0) {
    return NextResponse.json({ error: 'empty_stats' }, { status: 400 });
  }
  if (stats.length > MAX_STATS_CHARS) {
    return NextResponse.json({ error: 'stats_too_long' }, { status: 413 });
  }

  if (isAiMock()) {
    return NextResponse.json({
      summary: MOCK_PROFILE_SUMMARY,
      aiModel: 'mock',
      promptVersion: OBJECTIVE_PROFILE_PROMPT_VERSION,
    });
  }

  const keyResult = await resolveGeminiApiKey(userId);
  if (keyResult instanceof NextResponse) return keyResult;

  try {
    const model = chatModel();
    const ai = getGemini(keyResult.apiKey);
    const response = await ai.models.generateContent({
      model,
      contents: [{ role: 'user', parts: [{ text: buildObjectiveProfileUserPrompt(stats) }] }],
      config: {
        systemInstruction: buildObjectiveProfileSystemPrompt(),
        temperature: 0.4,
        maxOutputTokens: 1024,
      },
    });
    const summary = extractText(response).trim();
    if (!summary) {
      return NextResponse.json(
        { error: 'summary_failed', message: '講評の生成に失敗しました。' },
        { status: 502 },
      );
    }
    return NextResponse.json({
      summary,
      aiModel: model,
      promptVersion: OBJECTIVE_PROFILE_PROMPT_VERSION,
    });
  } catch (err: unknown) {
    return aiErrorResponse(
      { tag: 'factnote-profile', code: 'summary_failed', messageBase: '講評の生成に失敗しました' },
      err,
    );
  }
}

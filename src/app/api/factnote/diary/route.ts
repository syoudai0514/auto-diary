import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/apiAuth';
import { rateLimitDistributed } from '@/lib/rateLimit';
import { chatModel, getGemini } from '@/lib/gemini';
import { aiErrorResponse, resolveGeminiApiKey } from '@/lib/aiRoute';
import {
  FactnoteDiaryError,
  generateFactnoteDiary,
} from '@/lib/factnote/generateFactnoteDiary';
import { isAiMock, mockDiary } from '@/lib/factnote/mock';
import type { DiaryMode } from '@/lib/factnote/types';

export const runtime = 'nodejs';
export const maxDuration = 300;

const MAX_SOURCE_CHARS = 40000;
const MAX_SUMMARY_CHARS = 8000;

const DIARY_MODES: DiaryMode[] = ['factual', 'emotional', 'family', 'short', 'detailed'];

/** 出来事の記録から指定モードの日記を生成して返す（依頼書 §12.10 / §25）。 */
export async function POST(req: Request) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { userId } = auth;

  const limited = await rateLimitDistributed(`factnote-diary:${userId}`, {
    capacity: 5,
    refillPerSec: 5 / 60,
  });
  if (!limited.ok) {
    return NextResponse.json(
      { error: 'too_many_requests' },
      { status: 429, headers: { 'Retry-After': String(limited.retryAfter) } },
    );
  }

  let mode: unknown;
  let sourceText: unknown;
  let analysisSummary: unknown;
  try {
    const body = await req.json();
    mode = body?.mode;
    sourceText = body?.sourceText;
    analysisSummary = body?.analysisSummary;
  } catch {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }

  if (typeof mode !== 'string' || !DIARY_MODES.includes(mode as DiaryMode)) {
    return NextResponse.json({ error: 'invalid_mode' }, { status: 400 });
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
  if (typeof analysisSummary === 'string' && analysisSummary.length > MAX_SUMMARY_CHARS) {
    analysisSummary = analysisSummary.slice(0, MAX_SUMMARY_CHARS);
  }

  if (isAiMock()) {
    return NextResponse.json({ diary: mockDiary(mode as DiaryMode) });
  }

  const keyResult = await resolveGeminiApiKey(userId);
  if (keyResult instanceof NextResponse) return keyResult;

  try {
    const diary = await generateFactnoteDiary(getGemini(keyResult.apiKey), {
      mode: mode as DiaryMode,
      sourceText,
      analysisSummary: typeof analysisSummary === 'string' ? analysisSummary : undefined,
      model: chatModel(),
    });
    return NextResponse.json({ diary });
  } catch (err: unknown) {
    if (err instanceof FactnoteDiaryError) {
      console.error('[factnote-diary] parse/generation error');
      return NextResponse.json(
        { error: 'diary_failed', message: '日記の生成に失敗しました。' },
        { status: 502 },
      );
    }
    return aiErrorResponse(
      { tag: 'factnote-diary', code: 'diary_failed', messageBase: '日記の生成に失敗しました' },
      err,
    );
  }
}

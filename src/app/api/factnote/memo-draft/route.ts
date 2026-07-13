import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/apiAuth';
import { rateLimitDistributed } from '@/lib/rateLimit';
import { chatModel, extractText, getGemini } from '@/lib/gemini';
import { aiErrorResponse, resolveGeminiApiKey } from '@/lib/aiRoute';
import { z } from 'zod';
import { Type } from '@google/genai';
import { safeParseJson } from '@/lib/factnote/jsonExtract';
import {
  buildMemoDraftSystemPrompt,
  buildMemoDraftUserPrompt,
} from '@/lib/factnote/prompts/memoDraft';
import { buildMockMemoDraft } from '@/lib/factnote/fixtures';
import { isAiMock } from '@/lib/factnote/mock';

export const runtime = 'nodejs';
export const maxDuration = 300;

const MAX_PURPOSE_CHARS = 1000;

const DraftSchema = z.object({ title: z.string(), body: z.string() });

const DRAFT_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    title: { type: Type.STRING, description: '「〜と思った時」のような短いタイトル' },
    body: { type: Type.STRING, description: '本人が自分へ語りかける3〜5文の本文' },
  },
  required: ['title', 'body'],
} as const;

/**
 * 未来の自分からのメモ: AI下書き（追加依頼 §20）。
 * 下書きは保存されない — クライアント側でユーザーが確認・編集してから保存する。
 */
export async function POST(req: Request) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { userId } = auth;

  const limited = await rateLimitDistributed(`factnote-memo-draft:${userId}`, {
    capacity: 5,
    refillPerSec: 5 / 60,
  });
  if (!limited.ok) {
    return NextResponse.json(
      { error: 'too_many_requests' },
      { status: 429, headers: { 'Retry-After': String(limited.retryAfter) } },
    );
  }

  let purpose: unknown;
  try {
    const body = await req.json();
    purpose = body?.purpose;
  } catch {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }
  if (typeof purpose !== 'string' || purpose.trim().length === 0) {
    return NextResponse.json({ error: 'empty_purpose' }, { status: 400 });
  }
  if (purpose.length > MAX_PURPOSE_CHARS) {
    return NextResponse.json({ error: 'purpose_too_long' }, { status: 413 });
  }

  if (isAiMock()) {
    return NextResponse.json({ draft: buildMockMemoDraft() });
  }

  const keyResult = await resolveGeminiApiKey(userId);
  if (keyResult instanceof NextResponse) return keyResult;

  try {
    const ai = getGemini(keyResult.apiKey);
    for (let attempt = 0; attempt <= 1; attempt++) {
      const response = await ai.models.generateContent({
        model: chatModel(),
        contents: [{ role: 'user', parts: [{ text: buildMemoDraftUserPrompt(purpose) }] }],
        config: {
          systemInstruction: buildMemoDraftSystemPrompt(),
          temperature: 0.6,
          responseMimeType: 'application/json',
          responseSchema: DRAFT_RESPONSE_SCHEMA,
          maxOutputTokens: 1024,
        },
      });
      const draft = safeParseJson(DraftSchema, extractText(response));
      if (draft && draft.title.trim() && draft.body.trim()) {
        return NextResponse.json({ draft });
      }
    }
    return NextResponse.json(
      { error: 'draft_failed', message: '下書きの生成に失敗しました。' },
      { status: 502 },
    );
  } catch (err: unknown) {
    return aiErrorResponse(
      { tag: 'factnote-memo-draft', code: 'draft_failed', messageBase: '下書きの生成に失敗しました' },
      err,
    );
  }
}

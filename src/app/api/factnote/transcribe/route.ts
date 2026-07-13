import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/apiAuth';
import { rateLimitDistributed } from '@/lib/rateLimit';
import {
  collapseRepeatedLines,
  extractText,
  getGemini,
  guessAudioMimeType,
  maxAudioBytes,
  TRANSCRIBE_MAX_OUTPUT_TOKENS,
  transcribeModel,
} from '@/lib/gemini';
import { aiErrorResponse, resolveGeminiApiKey } from '@/lib/aiRoute';
import { buildFactnoteTranscribePrompt } from '@/lib/factnote/prompts/transcribe';
import { isAiMock, mockTranscript } from '@/lib/factnote/mock';

export const runtime = 'nodejs';
// 文字起こしは時間がかかるため上限を引き上げる（Fluid Compute有効時の上限に合わせる）
export const maxDuration = 300;

/**
 * 事実ノートの音声文字起こし（依頼書 §24）。原文の保全を優先し、
 * 美化・言い換えをしないプロンプトを使う。音声・本文はログに一切出力しない。
 */
export async function POST(req: Request) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { userId } = auth;

  const limited = await rateLimitDistributed(`factnote-transcribe:${userId}`, {
    // 長い音声はチャンク分割で複数回に分けて送られるため余裕を持たせる
    capacity: 6,
    refillPerSec: 6 / 60,
  });
  if (!limited.ok) {
    return NextResponse.json(
      { error: 'too_many_requests' },
      { status: 429, headers: { 'Retry-After': String(limited.retryAfter) } },
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }

  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: 'no_audio' }, { status: 400 });
  }

  const limit = maxAudioBytes();
  if (file.size > limit) {
    return NextResponse.json(
      {
        error: 'file_too_large',
        message: `音声が大きすぎます（上限 ${(limit / 1024 / 1024).toFixed(0)}MB）。録音を短く分けてください。`,
        limit,
        size: file.size,
      },
      { status: 413 },
    );
  }

  if (isAiMock()) {
    return NextResponse.json({ text: mockTranscript() });
  }

  const keyResult = await resolveGeminiApiKey(userId);
  if (keyResult instanceof NextResponse) return keyResult;

  try {
    const arrayBuffer = await file.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString('base64');
    const mimeType = guessAudioMimeType(file.name, file.type);

    const ai = getGemini(keyResult.apiKey);
    const response = await ai.models.generateContent({
      model: transcribeModel(),
      contents: [
        {
          role: 'user',
          parts: [
            { text: buildFactnoteTranscribePrompt() },
            { inlineData: { mimeType, data: base64 } },
          ],
        },
      ],
      config: {
        temperature: 0,
        maxOutputTokens: TRANSCRIBE_MAX_OUTPUT_TOKENS,
      },
    });

    const text = collapseRepeatedLines(extractText(response).trim());
    return NextResponse.json({ text });
  } catch (err: unknown) {
    return aiErrorResponse(
      {
        tag: 'factnote-transcribe',
        code: 'transcription_failed',
        messageBase: '文字起こしに失敗しました',
      },
      err,
    );
  }
}

import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/apiAuth';
import { rateLimit } from '@/lib/rateLimit';
import { extractText, getGemini, guessAudioMimeType, maxAudioBytes, transcribeModel } from '@/lib/gemini';
import { aiErrorResponse, resolveGeminiApiKey } from '@/lib/aiRoute';

export const runtime = 'nodejs';
// 文字起こしは時間がかかるため上限を引き上げる（Fluid Compute有効時の上限に合わせる）
export const maxDuration = 300;

/**
 * 一字一句を正確に書き起こすための指示。
 * 要約・言い換え・脚色をさせず、聞こえたままをテキスト化させる。
 */
const TRANSCRIBE_PROMPT = [
  '添付された音声を、日本語として一字一句正確に文字起こししてください。',
  '要約したり、言い換えたり、内容を追加・省略したりしないでください。',
  '聞き取れない部分があっても、推測で補わないでください。',
  '文字起こしされたテキストのみを出力し、説明や前置きは付けないでください。',
  '音声に発話が含まれない場合は、何も出力しないでください。',
].join('\n');

/**
 * 音声(multipart/form-data の "file")を受け取り、Gemini にインラインデータとして渡し、
 * 日本語の文字起こしテキストを得て返す。音声はサーバー/Vercel 上に永続保存しない。
 * 音声データ・本文はログに一切出力しない。
 */
export async function POST(req: Request) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { userId } = auth;

  const limited = rateLimit(`transcribe:${userId}`, {
    // 複数音声ファイルをまとめてアップロードする用途があるため、単発録音より余裕を持たせる
    capacity: 6,
    refillPerSec: 6 / 60, // 1分あたり6回程度
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
          parts: [{ text: TRANSCRIBE_PROMPT }, { inlineData: { mimeType, data: base64 } }],
        },
      ],
      config: {
        temperature: 0,
      },
    });

    const text = extractText(response).trim();
    return NextResponse.json({ text });
  } catch (err: unknown) {
    return aiErrorResponse(
      { tag: 'transcribe', code: 'transcription_failed', messageBase: '文字起こしに失敗しました' },
      err,
    );
  }
}

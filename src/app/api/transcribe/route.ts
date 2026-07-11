import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/apiAuth';
import { clientKey, rateLimit } from '@/lib/rateLimit';
import { getOpenAI, maxAudioBytes, transcribeModel } from '@/lib/openai';

export const runtime = 'nodejs';
// 文字起こしは時間がかかるため上限を引き上げる
export const maxDuration = 60;

/**
 * 音声(multipart/form-data の "file")を受け取り、OpenAI の文字起こしモデルで
 * 日本語テキストへ変換して返す。音声はサーバー/Vercel 上に永続保存しない。
 * 音声データ・本文はログに一切出力しない。
 */
export async function POST(req: Request) {
  const unauth = await requireAuth();
  if (unauth) return unauth;

  const limited = rateLimit(`transcribe:${clientKey(req)}`, {
    capacity: 3,
    refillPerSec: 3 / 60, // 1分あたり3回程度
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

  try {
    const openai = getOpenAI();
    const result = await openai.audio.transcriptions.create({
      file,
      model: transcribeModel(),
      language: 'ja',
      // 一部モデルは response_format 未対応のため指定しない（デフォルトのtext/jsonで受ける）
    });
    const text = (result as { text?: string }).text ?? '';
    return NextResponse.json({ text });
  } catch (err: unknown) {
    // 本文・音声は出さず、種類だけを記録する
    console.error('[transcribe] failed:', errName(err));
    const status = statusFromError(err);
    return NextResponse.json(
      { error: 'transcription_failed', message: '文字起こしに失敗しました。' },
      { status },
    );
  }
}

function errName(err: unknown): string {
  if (err && typeof err === 'object' && 'name' in err) return String((err as Error).name);
  return 'UnknownError';
}

function statusFromError(err: unknown): number {
  if (err && typeof err === 'object' && 'status' in err) {
    const s = Number((err as { status?: unknown }).status);
    if (Number.isFinite(s) && s >= 400 && s < 600) return s;
  }
  return 502;
}

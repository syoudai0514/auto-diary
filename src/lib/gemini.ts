import { GoogleGenAI } from '@google/genai';

let client: GoogleGenAI | null = null;

/** 遅延初期化した Gemini クライアントを返す。 */
export function getGemini(): GoogleGenAI {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY が設定されていません');
  }
  if (!client) {
    client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  return client;
}

// gemini-2.0-flash 系は 2026-06-01 付けで廃止されたため、既定値は
// 無料枠が広い gemini-3.1-flash-lite にしている（環境変数で変更可）。
const DEFAULT_MODEL = 'gemini-3.1-flash-lite';

export function chatModel(): string {
  return process.env.GEMINI_MODEL || DEFAULT_MODEL;
}

export function transcribeModel(): string {
  return process.env.GEMINI_TRANSCRIBE_MODEL || DEFAULT_MODEL;
}

/**
 * 1リクエストあたりの音声アップロード上限。
 * Vercel のサーバーレス関数はリクエストボディサイズに約4.5MBのプラットフォーム上限が
 * あり、それを超えるとこちらのコードに到達する前にリクエスト自体が拒否される。
 * そのため既定値は安全マージンを取って4MBにしている（それより大きい音声は
 * クライアント側で自動的にチャンク分割してから複数リクエストで送信する）。
 */
export function maxAudioBytes(): number {
  const n = Number(process.env.MAX_AUDIO_BYTES);
  return Number.isFinite(n) && n > 0 ? n : 4 * 1024 * 1024; // 4MB
}

/** GenerateContentResponse からテキストを安全に取り出す（text は undefined になりうる）。 */
export function extractText(response: { text?: string }): string {
  return typeof response.text === 'string' ? response.text : '';
}

/** 拡張子 → MIME タイプ。ブラウザが型を報告できない音声ファイル向けのフォールバック用。 */
const EXT_MIME_MAP: Record<string, string> = {
  m4a: 'audio/mp4',
  mp4: 'audio/mp4',
  mov: 'audio/mp4',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  aac: 'audio/aac',
  caf: 'audio/x-caf',
  aiff: 'audio/aiff',
  aif: 'audio/aiff',
  amr: 'audio/amr',
  flac: 'audio/flac',
  ogg: 'audio/ogg',
  opus: 'audio/opus',
  wma: 'audio/x-ms-wma',
  webm: 'audio/webm',
};

/** ブラウザが返す type が空・汎用的すぎるとみなすか。 */
function isGenericMimeType(type: string | undefined): boolean {
  return !type || type === 'application/octet-stream' || type === 'application/x-empty';
}

/**
 * 音声ファイルの MIME タイプを推定する。
 * iOS の「ファイル」アプリ経由（Shortcuts書き出し等）で選ばれたファイルは
 * ブラウザ側で正しい type を持たないことがあるため、拡張子からも補完する。
 */
export function guessAudioMimeType(filename: string, declaredType: string | undefined): string {
  if (!isGenericMimeType(declaredType)) return declaredType as string;
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  return EXT_MIME_MAP[ext] ?? 'audio/webm';
}

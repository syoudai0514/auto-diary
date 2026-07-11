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

export function chatModel(): string {
  return process.env.GEMINI_MODEL || 'gemini-2.0-flash';
}

export function transcribeModel(): string {
  return process.env.GEMINI_TRANSCRIBE_MODEL || 'gemini-2.0-flash';
}

/**
 * 音声アップロードの上限。Gemini へは base64 のインラインデータとして送るため、
 * 保守的な既定値にしている（無料枠のリクエストサイズ制限に配慮）。
 */
export function maxAudioBytes(): number {
  const n = Number(process.env.MAX_AUDIO_BYTES);
  return Number.isFinite(n) && n > 0 ? n : 15 * 1024 * 1024; // 15MB
}

/** GenerateContentResponse からテキストを安全に取り出す（text は undefined になりうる）。 */
export function extractText(response: { text?: string }): string {
  return typeof response.text === 'string' ? response.text : '';
}

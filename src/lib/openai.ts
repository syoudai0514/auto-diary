import OpenAI from 'openai';

let client: OpenAI | null = null;

/** 遅延初期化した OpenAI クライアントを返す。 */
export function getOpenAI(): OpenAI {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY が設定されていません');
  }
  if (!client) {
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return client;
}

export function chatModel(): string {
  return process.env.OPENAI_MODEL || 'gpt-4o-mini';
}

export function transcribeModel(): string {
  return process.env.TRANSCRIBE_MODEL || 'gpt-4o-mini-transcribe';
}

export function maxAudioBytes(): number {
  const n = Number(process.env.MAX_AUDIO_BYTES);
  return Number.isFinite(n) && n > 0 ? n : 25 * 1024 * 1024; // 25MB
}

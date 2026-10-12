import type { GoogleGenAI } from '@google/genai';

/**
 * 事実ノートが使うGeminiモデルの選択と、混雑時の自動切り替え。
 *
 * - 既定: gemini-3.5-flash-lite（無料枠のFlash-Lite。新しい世代）
 * - 予備: gemini-3.1-flash-lite
 * - 上書き: FACTNOTE_GEMINI_MODEL > GEMINI_MODEL > 既定（既存の音声日記アプリは GEMINI_MODEL のまま）
 *   予備は FACTNOTE_GEMINI_FALLBACK_MODEL（"none" で無効）
 *
 * 無料枠の回数制限(429)・高負荷(503)はモデルごとに別枠で、片方が混んでいても
 * もう片方は空いていることが多い。主モデルが 404（そのキーで使えない）/429/500/503/504
 * で失敗したら、同じリクエストを予備モデルで1回だけ試す。
 */

export const FACTNOTE_DEFAULT_MODEL = 'gemini-3.5-flash-lite';
export const FACTNOTE_FALLBACK_MODEL = 'gemini-3.1-flash-lite';

export function factnoteModel(): string {
  return process.env.FACTNOTE_GEMINI_MODEL || process.env.GEMINI_MODEL || FACTNOTE_DEFAULT_MODEL;
}

/** 予備モデル。主モデルと同じ、または "none" のときは undefined（切り替えなし）。 */
export function factnoteFallbackModel(primary: string = factnoteModel()): string | undefined {
  const fallback = process.env.FACTNOTE_GEMINI_FALLBACK_MODEL || FACTNOTE_FALLBACK_MODEL;
  if (fallback.toLowerCase() === 'none' || fallback === primary) return undefined;
  return fallback;
}

/** モデルを替えれば通る可能性がある失敗か（入力が原因の 400・認証の 401/403 は替えても同じ）。 */
export function isModelSwitchable(err: unknown): boolean {
  if (!err || typeof err !== 'object' || !('status' in err)) return false;
  return [404, 429, 500, 503, 504].includes(Number((err as { status?: unknown }).status));
}

export interface FactnoteAi {
  /** 主モデル→予備モデルの切り替えを組み込んだクライアント（generateContent のみ）。 */
  ai: GoogleGenAI;
  /** 実際に応答したモデル（記録の aiModel に残す）。まだ呼んでいなければ主モデル。 */
  modelUsed: () => string;
}

/**
 * generateContent を「主モデル→（失敗したら）予備モデル」に差し替えたクライアントを返す。
 * 呼び出し側の関数（analyzeIncident など）は変更不要。
 */
export function withModelFallback(
  ai: GoogleGenAI,
  primary: string = factnoteModel(),
  /** 省略 = 環境設定どおりの予備モデル / null = 切り替えなし。 */
  fallbackOption?: string | null,
): FactnoteAi {
  const fallback = fallbackOption === undefined ? factnoteFallbackModel(primary) : (fallbackOption ?? undefined);
  let used = primary;
  const generateContent = async (req: Parameters<GoogleGenAI['models']['generateContent']>[0]) => {
    try {
      const response = await ai.models.generateContent({ ...req, model: primary });
      used = primary;
      return response;
    } catch (err) {
      if (!fallback || !isModelSwitchable(err)) throw err;
      console.warn(`[factnote-model] ${primary} 失敗(${(err as { status?: number }).status}) → ${fallback} に切り替え`);
      const response = await ai.models.generateContent({ ...req, model: fallback });
      used = fallback;
      return response;
    }
  };
  return {
    ai: { models: { generateContent } } as unknown as GoogleGenAI,
    modelUsed: () => used,
  };
}

import type { z } from 'zod';

/**
 * モデル出力の文字列から JSON を頑健に抽出してスキーマ検証する
 * （`safeParseTalkAnalysis` と同じ方式の汎用版。依頼書 §22.3）。
 * ```json フェンスや前後の余分な文字が付いても取り出せるようにする。
 * 失敗時は null を返し、呼び出し側で再試行を判断する。
 */
export function safeParseJson<T extends z.ZodTypeAny>(schema: T, raw: string): z.infer<T> | null {
  const candidates: string[] = [];
  const trimmed = raw.trim();
  candidates.push(trimmed);

  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) candidates.push(fence[1].trim());

  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first !== -1 && last !== -1 && last > first) {
    candidates.push(trimmed.slice(first, last + 1));
  }

  for (const candidate of candidates) {
    try {
      const parsed = schema.safeParse(JSON.parse(candidate));
      if (parsed.success) return parsed.data;
    } catch {
      // 次の候補へ
    }
  }
  return null;
}

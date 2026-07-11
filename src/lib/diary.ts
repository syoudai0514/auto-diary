import { z } from 'zod';

/**
 * AI が生成する構造化日記データのスキーマ。
 * OpenAI の structured output(json_schema) とクライアント側バリデーションの両方で使う。
 */
export const DiarySchema = z.object({
  title: z.string(),
  body: z.string(),
  facts: z.array(z.string()),
  feelings: z.array(z.string()),
  interpretations: z.array(z.string()),
  nextActions: z.array(z.string()),
  tags: z.array(z.string()),
  rawTranscript: z.string(),
});

export type Diary = z.infer<typeof DiarySchema>;

/** 文体プリセット。設定画面で選択し、生成プロンプトに反映する。 */
export const DIARY_STYLES = [
  { id: 'natural', label: '自然な日記' },
  { id: 'factual', label: '事実中心の記録' },
  { id: 'family', label: '家族・子育ての振り返り' },
  { id: 'emotion', label: '感情整理' },
  { id: 'summary', label: '短い要約' },
] as const;

export type DiaryStyleId = (typeof DIARY_STYLES)[number]['id'];

export const DEFAULT_STYLE: DiaryStyleId = 'natural';

export function isDiaryStyleId(v: unknown): v is DiaryStyleId {
  return typeof v === 'string' && DIARY_STYLES.some((s) => s.id === v);
}

/**
 * OpenAI Chat Completions の response_format(json_schema) に渡す JSON Schema。
 * strict モードのため全プロパティを required + additionalProperties:false にする。
 */
export const DIARY_JSON_SCHEMA = {
  name: 'diary',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      title: { type: 'string', description: '日記のタイトル（15文字程度まで）' },
      body: { type: 'string', description: '自然な日記本文。読みやすい段落に分ける' },
      facts: {
        type: 'array',
        items: { type: 'string' },
        description: '実際に起きた出来事（事実のみ）',
      },
      feelings: {
        type: 'array',
        items: { type: 'string' },
        description: '本人が感じたこと（感情）',
      },
      interpretations: {
        type: 'array',
        items: { type: 'string' },
        description: '本人の解釈・考え',
      },
      nextActions: {
        type: 'array',
        items: { type: 'string' },
        description: '今後試したいこと',
      },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: '内容を表すタグ（例: 家族, 仕事）',
      },
      rawTranscript: { type: 'string', description: '元の文字起こしをそのまま格納' },
    },
    required: [
      'title',
      'body',
      'facts',
      'feelings',
      'interpretations',
      'nextActions',
      'tags',
      'rawTranscript',
    ],
  },
} as const;

/**
 * モデル出力の文字列から JSON を頑健に抽出してパースする。
 * ```json フェンスや前後の余分な文字が付いても取り出せるようにする。
 * 失敗時は null を返し、呼び出し側で再試行を判断する。
 */
export function safeParseDiary(raw: string): Diary | null {
  const candidates: string[] = [];
  const trimmed = raw.trim();
  candidates.push(trimmed);

  // ```json ... ``` フェンスを剥がす
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) candidates.push(fence[1].trim());

  // 最初の { から最後の } までを抜き出す
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first !== -1 && last !== -1 && last > first) {
    candidates.push(trimmed.slice(first, last + 1));
  }

  for (const c of candidates) {
    try {
      const parsed = JSON.parse(c);
      const result = DiarySchema.safeParse(parsed);
      if (result.success) return result.data;
      // 一部フィールド欠落でも配列/文字列を補完して受け入れる
      const coerced = coerceDiary(parsed);
      const retry = DiarySchema.safeParse(coerced);
      if (retry.success) return retry.data;
    } catch {
      // 次の候補へ
    }
  }
  return null;
}

/** 欠落しがちな配列/文字列フィールドを安全なデフォルトで埋める。 */
function coerceDiary(obj: unknown): Diary {
  const o = (obj ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  const arr = (v: unknown) =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  return {
    title: str(o.title) || '無題の日記',
    body: str(o.body),
    facts: arr(o.facts),
    feelings: arr(o.feelings),
    interpretations: arr(o.interpretations),
    nextActions: arr(o.nextActions),
    tags: arr(o.tags),
    rawTranscript: str(o.rawTranscript),
  };
}

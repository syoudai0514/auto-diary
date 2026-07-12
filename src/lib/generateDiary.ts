import { Type, type GoogleGenAI } from '@google/genai';
import { buildSystemPrompt, buildUserPrompt } from './prompt';
import { safeParseDiary, type Diary, type DiaryStyleId } from './diary';
import { extractText } from './gemini';

export interface GenerateOptions {
  transcript: string;
  style: DiaryStyleId;
  model: string;
  /** JSON パース失敗時の最大リトライ回数。 */
  maxRetries?: number;
  /** 「自分は父です。妻はママと呼ぶ」など、話者・登場人物を判断するための補足情報（任意）。 */
  peopleContext?: string;
}

export class DiaryGenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DiaryGenerationError';
  }
}

/**
 * Gemini の responseSchema（OpenAPI サブセット、型は大文字の Type enum）に渡すスキーマ。
 * OpenAI 互換 API の json_schema(strict) に相当する構造で、全プロパティを required にする。
 */
export const DIARY_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    title: { type: Type.STRING, description: '日記のタイトル（15文字程度まで）' },
    body: { type: Type.STRING, description: '自然な日記本文。読みやすい段落に分ける' },
    facts: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: '実際に起きた出来事（事実のみ）',
    },
    feelings: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: '本人が感じたこと（感情）',
    },
    interpretations: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: '本人の解釈・考え',
    },
    nextActions: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: '今後試したいこと',
    },
    tags: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: '内容を表すタグ（例: 家族, 仕事）',
    },
    rawTranscript: { type: Type.STRING, description: '元の文字起こしをそのまま格納' },
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
  propertyOrdering: [
    'title',
    'body',
    'facts',
    'feelings',
    'interpretations',
    'nextActions',
    'tags',
    'rawTranscript',
  ],
} as const;

/**
 * 文字起こしから構造化日記を生成する。
 * Gemini の structured output(responseSchema) を使い、万一パースに失敗したら再試行する。
 * ai クライアントは引数で受け取り、テストでモック可能にする。
 */
export async function generateDiary(
  ai: GoogleGenAI,
  { transcript, style, model, maxRetries = 2, peopleContext }: GenerateOptions,
): Promise<Diary> {
  const system = buildSystemPrompt(style, peopleContext);
  const user = buildUserPrompt(transcript);

  let lastError = '';
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const contents = [
      { role: 'user' as const, parts: [{ text: user }] },
      ...(attempt > 0
        ? [
            {
              role: 'user' as const,
              parts: [
                {
                  text: '前回の出力は指定 JSON スキーマとして解釈できませんでした。今度は必ず有効な JSON のみを返してください。',
                },
              ],
            },
          ]
        : []),
    ];

    const response = await ai.models.generateContent({
      model,
      contents,
      config: {
        systemInstruction: system,
        // 事実の捏造を避けるため温度は低め
        temperature: 0.4,
        responseMimeType: 'application/json',
        responseSchema: DIARY_RESPONSE_SCHEMA,
      },
    });

    const content = extractText(response);
    const diary = safeParseDiary(content);
    if (diary) {
      // rawTranscript は必ず元の文字起こしで上書きし、モデルの改変を防ぐ
      return { ...diary, rawTranscript: transcript };
    }
    lastError = 'モデル出力を JSON として解釈できませんでした';
  }

  throw new DiaryGenerationError(lastError || '日記の生成に失敗しました');
}

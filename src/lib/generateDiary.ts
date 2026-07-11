import type OpenAI from 'openai';
import { buildSystemPrompt, buildUserPrompt } from './prompt';
import { DIARY_JSON_SCHEMA, safeParseDiary, type Diary, type DiaryStyleId } from './diary';

export interface GenerateOptions {
  transcript: string;
  style: DiaryStyleId;
  model: string;
  /** JSON パース失敗時の最大リトライ回数。 */
  maxRetries?: number;
}

export class DiaryGenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DiaryGenerationError';
  }
}

/**
 * 文字起こしから構造化日記を生成する。
 * structured output(json_schema) を使い、万一パースに失敗したら再試行する。
 * openai クライアントは引数で受け取り、テストでモック可能にする。
 */
export async function generateDiary(
  openai: OpenAI,
  { transcript, style, model, maxRetries = 2 }: GenerateOptions,
): Promise<Diary> {
  const system = buildSystemPrompt(style);
  const user = buildUserPrompt(transcript);

  let lastError = '';
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const completion = await openai.chat.completions.create({
      model,
      // 事実の捏造を避けるため温度は低め
      temperature: 0.4,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
        ...(attempt > 0
          ? [
              {
                role: 'system' as const,
                content:
                  '前回の出力は指定 JSON スキーマとして解釈できませんでした。今度は必ず有効な JSON のみを返してください。',
              },
            ]
          : []),
      ],
      response_format: {
        type: 'json_schema',
        json_schema: DIARY_JSON_SCHEMA,
      },
    });

    const content = completion.choices?.[0]?.message?.content ?? '';
    const diary = safeParseDiary(content);
    if (diary) {
      // rawTranscript は必ず元の文字起こしで上書きし、モデルの改変を防ぐ
      return { ...diary, rawTranscript: transcript };
    }
    lastError = 'モデル出力を JSON として解釈できませんでした';
  }

  throw new DiaryGenerationError(lastError || '日記の生成に失敗しました');
}

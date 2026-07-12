import { Type, type GoogleGenAI } from '@google/genai';
import { buildTalkAnalysisSystemPrompt, buildTalkAnalysisUserPrompt } from './prompt';
import { safeParseTalkAnalysis, type TalkAnalysis } from './talk';
import { extractText } from './gemini';

export interface AnalyzeTalkOptions {
  /** 話者ラベル（A:/B:）付きの文字起こし。 */
  transcript: string;
  /** 話者Aの表示名（例:「私」）。 */
  speakerA: string;
  /** 話者Bの表示名（例:「妻」）。 */
  speakerB: string;
  model: string;
  /** JSON パース失敗時の最大リトライ回数。 */
  maxRetries?: number;
  peopleContext?: string;
}

export class TalkAnalysisError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TalkAnalysisError';
  }
}

const SIDE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    label: { type: Type.STRING, description: '話者の表示名（指定された名前をそのまま使う）' },
    claims: { type: Type.ARRAY, items: { type: Type.STRING }, description: '主な言い分' },
    feelings: { type: Type.ARRAY, items: { type: Type.STRING }, description: '気持ち' },
    needs: { type: Type.ARRAY, items: { type: Type.STRING }, description: '言葉の奥にある本当の望み' },
  },
  required: ['label', 'claims', 'feelings', 'needs'],
} as const;

const BEHAVIOR_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    behavior: { type: Type.STRING, description: '具体的な発言・行動' },
    assessment: { type: Type.STRING, description: 'その発言・行動の評価（人格評価はしない）' },
  },
  required: ['behavior', 'assessment'],
} as const;

/** Gemini の responseSchema（OpenAPI サブセット）。全プロパティ required。 */
export const TALK_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    title: { type: Type.STRING, description: '話し合いの主題（例: 家事分担についての話し合い）' },
    summary: { type: Type.STRING, description: '何が起きたかの中立な要約' },
    topics: { type: Type.ARRAY, items: { type: Type.STRING }, description: '争点' },
    sideA: SIDE_SCHEMA,
    sideB: SIDE_SCHEMA,
    misunderstandings: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          point: { type: Type.STRING, description: 'すれ違いのポイント' },
          aView: { type: Type.STRING, description: 'Aの見え方' },
          bView: { type: Type.STRING, description: 'Bの見え方' },
          explanation: { type: Type.STRING, description: 'なぜすれ違ったのかの解説' },
        },
        required: ['point', 'aView', 'bView', 'explanation'],
      },
    },
    verdict: {
      type: Type.OBJECT,
      properties: {
        overall: {
          type: Type.STRING,
          description: 'どちらの主張がより妥当か、五分五分かの総合判定と理由（率直に）',
        },
        leansToward: {
          type: Type.STRING,
          description: '"A" / "B" / "even" のいずれか',
        },
        behaviorsA: { type: Type.ARRAY, items: BEHAVIOR_SCHEMA },
        behaviorsB: { type: Type.ARRAY, items: BEHAVIOR_SCHEMA },
      },
      required: ['overall', 'leansToward', 'behaviorsA', 'behaviorsB'],
    },
    adviceA: { type: Type.ARRAY, items: { type: Type.STRING }, description: 'Aへの具体的な改善提案' },
    adviceB: { type: Type.ARRAY, items: { type: Type.STRING }, description: 'Bへの具体的な改善提案' },
    commonGround: { type: Type.ARRAY, items: { type: Type.STRING }, description: 'ふたりに共通する願い' },
    reconciliationScript: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          speaker: { type: Type.STRING },
          line: { type: Type.STRING },
        },
        required: ['speaker', 'line'],
      },
      description: '仲直りの会話例',
    },
    safetyNote: {
      type: Type.STRING,
      description: '暴力・脅迫等の兆候がある場合のみ相談先を促す文言。無ければ空文字',
    },
  },
  required: [
    'title',
    'summary',
    'topics',
    'sideA',
    'sideB',
    'misunderstandings',
    'verdict',
    'adviceA',
    'adviceB',
    'commonGround',
    'reconciliationScript',
    'safetyNote',
  ],
} as const;

/**
 * 話者付き文字起こしから話し合いの構造化分析を生成する。
 * パースに失敗したら最大 maxRetries 回まで再試行する（generateDiary と同じパターン）。
 */
export async function analyzeTalk(
  ai: GoogleGenAI,
  { transcript, speakerA, speakerB, model, maxRetries = 2, peopleContext }: AnalyzeTalkOptions,
): Promise<TalkAnalysis> {
  const system = buildTalkAnalysisSystemPrompt(peopleContext);
  const user = buildTalkAnalysisUserPrompt(transcript, speakerA, speakerB);

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
                  text: '前回の出力は指定 JSON スキーマとして解釈できませんでした。今度は必ず有効な JSON のみを返してください。leansToward は "A" / "B" / "even" のいずれかにしてください。',
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
        responseSchema: TALK_RESPONSE_SCHEMA,
      },
    });

    const analysis = safeParseTalkAnalysis(extractText(response));
    if (analysis) return analysis;
    lastError = 'モデル出力を JSON として解釈できませんでした';
  }

  throw new TalkAnalysisError(lastError || '話し合いの分析に失敗しました');
}

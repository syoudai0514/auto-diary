import { Type, type GoogleGenAI } from '@google/genai';
import { z } from 'zod';
import { extractText, REFLECTIVE_SAFETY_SETTINGS } from '../gemini';
import { safeParseJson } from './jsonExtract';
import {
  buildOverallReviewSystemPrompt,
  buildOverallReviewUserPrompt,
} from './prompts/overallReview';

/**
 * 全体の見解（全記録を通じたAI総評）のサーバー側ロジック。
 * `analyzeIncident.ts` と同じ responseSchema + zod + フェンス抽出 + 1回再生成のパターン。
 * 受け取るのはクライアントで組み立てた要約（記録本文は含まない）。
 */

const SEVERITY = z.enum(['minor', 'moderate', 'serious']).catch('moderate');

const RecurringIssueSchema = z.object({
  text: z.string(),
  suggestion: z.string().catch(''),
  severity: SEVERITY,
  count: z.number().int().nonnegative().catch(1),
  refs: z.array(z.number().int()).catch([]),
});

export const OverallReviewPayloadSchema = z.object({
  userRecurringIssues: z.array(RecurringIssueSchema),
  otherRecurringIssues: z.array(RecurringIssueSchema),
  strengths: z.array(z.string()),
  conflictTriggers: z.array(z.string()),
  interactionCycle: z.string().catch(''),
  childImpact: z.string(),
  safetyConcerns: z.string(),
  responsibilityReason: z.string(),
  responsibilityTendency: z
    .enum(['user_heavier', 'comparable', 'other_heavier', 'depends_on_topic', 'insufficient_data'])
    .catch('insufficient_data'),
  trendReason: z.string(),
  relationshipTrend: z
    .enum(['improving', 'stable', 'worsening', 'fluctuating', 'insufficient_data'])
    .catch('insufficient_data'),
  cannotJudge: z.array(z.string()),
  userFocus: z.array(z.string()),
  requestsToOther: z.array(z.string()),
  overallView: z.string(),
  closingMessage: z.string(),
});

export type OverallReviewPayload = z.infer<typeof OverallReviewPayloadSchema>;

const ISSUES = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      text: { type: Type.STRING, description: '具体的な行動パターン' },
      severity: { type: Type.STRING, description: '"minor" / "moderate" / "serious"' },
      count: { type: Type.INTEGER, description: '該当した記録数' },
      refs: { type: Type.ARRAY, items: { type: Type.INTEGER }, description: '根拠の記録番号（#の数字）' },
      suggestion: { type: Type.STRING, description: 'どう直すとよいか（具体的な行動・言い方）' },
    },
    required: ['text', 'severity', 'count', 'refs', 'suggestion'],
    propertyOrdering: ['text', 'severity', 'count', 'refs', 'suggestion'],
  },
};

const STRINGS = { type: Type.ARRAY, items: { type: Type.STRING } };

/** 生成順: 繰り返しの課題 → 良い面・きっかけ → 傾向の判定 → 総評（総評を最後に書かせる）。 */
const ORDER = [
  'userRecurringIssues',
  'otherRecurringIssues',
  'strengths',
  'conflictTriggers',
  'interactionCycle',
  'childImpact',
  'safetyConcerns',
  'responsibilityReason',
  'responsibilityTendency',
  'trendReason',
  'relationshipTrend',
  'cannotJudge',
  'userFocus',
  'requestsToOther',
  'overallView',
  'closingMessage',
];

export const OVERALL_REVIEW_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    userRecurringIssues: { ...ISSUES, description: '記録者側の繰り返しの課題（重い順・最大5件）' },
    otherRecurringIssues: { ...ISSUES, description: '相手側の繰り返しの課題（重い順・最大5件）' },
    strengths: { ...STRINGS, description: 'うまくいっていること（最大4件）' },
    conflictTriggers: { ...STRINGS, description: '衝突のきっかけ・状況（最大4件）' },
    interactionCycle: {
      type: Type.STRING,
      description: '二人の間で繰り返される悪循環と、断ち切れるポイント。読み取れなければ空文字',
    },
    childImpact: { type: Type.STRING, description: '子どもが同席した衝突の事実。なければ空文字' },
    safetyConcerns: { type: Type.STRING, description: '安全上の懸念と勧める行動。なければ空文字' },
    responsibilityReason: { type: Type.STRING, description: '責任の傾向の理由（重さと繰り返しで）' },
    responsibilityTendency: {
      type: Type.STRING,
      description: '"user_heavier" / "comparable" / "other_heavier" / "depends_on_topic" / "insufficient_data"',
    },
    trendReason: { type: Type.STRING, description: '関係の傾向の理由' },
    relationshipTrend: {
      type: Type.STRING,
      description: '"improving" / "stable" / "worsening" / "fluctuating" / "insufficient_data"',
    },
    cannotJudge: { ...STRINGS, description: '判断できないこと・データの限界（最大4件）' },
    userFocus: { ...STRINGS, description: '記録者が取り組むこと（最大3件）' },
    requestsToOther: { ...STRINGS, description: '相手が直した方がいいこと・求めてよいこと（最大3件）' },
    overallView: { type: Type.STRING, description: '4〜6文の全体の見解。1文目で言い切る' },
    closingMessage: { type: Type.STRING, description: '記録者への短い一言' },
  },
  required: ORDER,
  propertyOrdering: ORDER,
};

export const OVERALL_REVIEW_MAX_OUTPUT_TOKENS = 8192;

export class OverallReviewError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OverallReviewError';
  }
}

export async function runOverallReview(
  ai: GoogleGenAI,
  { digest, peopleContext, model, maxRetries = 1 }: {
    digest: string;
    peopleContext?: string;
    model: string;
    maxRetries?: number;
  },
): Promise<OverallReviewPayload> {
  const system = buildOverallReviewSystemPrompt(peopleContext);
  const user = buildOverallReviewUserPrompt(digest);
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const contents = [
      { role: 'user' as const, parts: [{ text: user }] },
      ...(attempt > 0
        ? [
            {
              role: 'user' as const,
              parts: [{ text: '前回の出力は指定 JSON スキーマとして解釈できませんでした。必ず有効な JSON のみを返してください。' }],
            },
          ]
        : []),
    ];
    const response = await ai.models.generateContent({
      model,
      contents,
      config: {
        systemInstruction: system,
        temperature: 0.3,
        responseMimeType: 'application/json',
        responseSchema: OVERALL_REVIEW_RESPONSE_SCHEMA,
        maxOutputTokens: OVERALL_REVIEW_MAX_OUTPUT_TOKENS,
        safetySettings: REFLECTIVE_SAFETY_SETTINGS,
      },
    });
    const payload = safeParseJson(OverallReviewPayloadSchema, extractText(response));
    if (payload) return payload;
  }
  throw new OverallReviewError('モデル出力を JSON として解釈できませんでした');
}

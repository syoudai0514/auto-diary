import { Type, type GoogleGenAI } from '@google/genai';
import { z } from 'zod';
import { extractText } from '../gemini';
import { safeParseJson } from './jsonExtract';
import {
  buildFlatCheckSystemPrompt,
  buildFlatCheckUserPrompt,
  FLAT_CHECK_PROMPT_VERSION,
} from './prompts/flatCheck';
import type { AggregatedItem, AnalysisItem } from './types';

/**
 * フラットチェックのサーバー側ロジック（`analyzeIncident.ts` と同じ
 * responseSchema + zod + フェンス抽出 + 1回再生成のパターン）。
 * 過去比較・偏り警告はローカル集計済みのものを受け取り、AIには
 * 「今回のテキスト + 集計値」だけを渡す（追加依頼 §26/§27）。
 */

const CONFIDENCE = z.enum(['high', 'medium', 'low']);
const WireItem = z.object({ text: z.string(), confidence: CONFIDENCE });

export const FlatCheckPayloadSchema = z.object({
  conciseConclusion: z.string(),
  userImprovementPoints: z.array(WireItem),
  otherPartyProblemPoints: z.array(WireItem),
  unknowns: z.array(WireItem),
  avoidJudgingFromThisIncident: z.array(WireItem),
  improvingPoints: z.array(WireItem),
  aiMessage: z.string(),
});

export type FlatCheckPayload = z.infer<typeof FlatCheckPayloadSchema>;

const ITEM = {
  type: Type.OBJECT,
  properties: {
    text: { type: Type.STRING },
    confidence: { type: Type.STRING, description: '"high" / "medium" / "low"' },
  },
  required: ['text', 'confidence'],
} as const;

const ITEMS = { type: Type.ARRAY, items: ITEM } as const;

export const FLAT_CHECK_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    conciseConclusion: { type: Type.STRING, description: '2〜5文の率直な最初の結論' },
    userImprovementPoints: { ...ITEMS, description: '今回の自分側の改善点。最大5件・具体的行動' },
    otherPartyProblemPoints: { ...ITEMS, description: '今回の相手側の問題点。最大5件・具体的な発言/行動' },
    unknowns: { ...ITEMS, description: '今回判断できないこと' },
    avoidJudgingFromThisIncident: { ...ITEMS, description: '今回だけでは判断しない方がいいこと' },
    improvingPoints: { ...ITEMS, description: '集計に根拠がある改善点のみ。なければ空配列' },
    aiMessage: { type: Type.STRING, description: '今回受け止めるべき責任の範囲を示す短い一言' },
  },
  required: [
    'conciseConclusion',
    'userImprovementPoints',
    'otherPartyProblemPoints',
    'unknowns',
    'avoidJudgingFromThisIncident',
    'improvingPoints',
    'aiMessage',
  ],
} as const;

export const FLAT_CHECK_MAX_OUTPUT_TOKENS = 8192;

export class FlatCheckError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FlatCheckError';
  }
}

/** ローカル集計をAIへ渡すテキストへ整形する（本文は含めない）。 */
export function pastStatsText(pastComparison: AggregatedItem[], pastRecordCount: number): string {
  if (pastRecordCount === 0) return '';
  const lines = [`対象の過去記録: ${pastRecordCount}件`];
  for (const item of pastComparison) {
    lines.push(`- ${item.label}: ${item.count}件`);
  }
  return lines.join('\n');
}

export interface RunFlatCheckOptions {
  sourceText: string;
  analysisSummary?: string;
  pastStats: string;
  biasWarnings: string[];
  model: string;
  maxRetries?: number;
}

export async function runFlatCheck(
  ai: GoogleGenAI,
  { sourceText, analysisSummary, pastStats, biasWarnings, model, maxRetries = 1 }: RunFlatCheckOptions,
): Promise<FlatCheckPayload> {
  const system = buildFlatCheckSystemPrompt();
  const user = buildFlatCheckUserPrompt({ sourceText, analysisSummary, pastStats, biasWarnings });

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const contents = [
      { role: 'user' as const, parts: [{ text: user }] },
      ...(attempt > 0
        ? [
            {
              role: 'user' as const,
              parts: [
                { text: '前回の出力は指定 JSON スキーマとして解釈できませんでした。必ず有効な JSON のみを返してください。' },
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
        temperature: 0.4,
        responseMimeType: 'application/json',
        responseSchema: FLAT_CHECK_RESPONSE_SCHEMA,
        maxOutputTokens: FLAT_CHECK_MAX_OUTPUT_TOKENS,
      },
    });
    const payload = safeParseJson(FlatCheckPayloadSchema, extractText(response));
    if (payload) return payload;
  }
  throw new FlatCheckError('モデル出力を JSON として解釈できませんでした');
}

export interface FlatCheckAiPart {
  conciseConclusion: string;
  userImprovementPoints: AnalysisItem[];
  otherPartyProblemPoints: AnalysisItem[];
  unknowns: AnalysisItem[];
  avoidJudgingFromThisIncident: AnalysisItem[];
  improvingPoints: AnalysisItem[];
  aiMessage: string;
  aiModel: string;
  promptVersion: string;
}

/** ペイロードにIDとメタ情報を付与する（純粋関数）。最大5件の制限もここで担保。 */
export function toFlatCheckAiPart(
  payload: FlatCheckPayload,
  opts: { aiModel: string; idGen?: () => string },
): FlatCheckAiPart {
  let seq = 0;
  const idGen = opts.idGen ?? (() => `fc${++seq}_${Math.random().toString(36).slice(2, 8)}`);
  const items = (list: Array<{ text: string; confidence: 'high' | 'medium' | 'low' }>, max = 99) =>
    list.slice(0, max).map((it) => ({ id: idGen(), text: it.text, confidence: it.confidence, evidenceIds: [] }));
  return {
    conciseConclusion: payload.conciseConclusion,
    userImprovementPoints: items(payload.userImprovementPoints, 5),
    otherPartyProblemPoints: items(payload.otherPartyProblemPoints, 5),
    unknowns: items(payload.unknowns),
    avoidJudgingFromThisIncident: items(payload.avoidJudgingFromThisIncident),
    improvingPoints: items(payload.improvingPoints),
    aiMessage: payload.aiMessage,
    aiModel: opts.aiModel,
    promptVersion: FLAT_CHECK_PROMPT_VERSION,
  };
}

import { Type, type GoogleGenAI } from '@google/genai';
import { z } from 'zod';
import { extractText } from '../gemini';
import { safeParseJson } from './jsonExtract';
import {
  buildIncidentAnalysisSystemPrompt,
  buildIncidentAnalysisUserPrompt,
  INCIDENT_ANALYSIS_PROMPT_VERSION,
  type IncidentContext,
} from './prompts/incidentAnalysis';
import type { IncidentAnalysis } from './types';

/**
 * 出来事の構造化分析（依頼書 §11 の 4〜12 を1回のGemini呼び出しで生成）。
 * `analyzeTalk` と同じパターン: responseSchema + zod検証 + フェンス抽出 + 再生成。
 */

const CONFIDENCE = z.enum(['high', 'medium', 'low']);

const WireItemSchema = z.object({
  text: z.string(),
  confidence: CONFIDENCE,
});

/** Gemini が返す生の分析ペイロード（ID・メタ情報はサーバー側で付与する）。 */
export const IncidentAnalysisPayloadSchema = z.object({
  title: z.string(),
  conciseView: z.string(),
  verifiedFacts: z.array(WireItemSchema),
  userClaims: z.array(WireItemSchema),
  aiInferences: z.array(WireItemSchema),
  unknowns: z.array(WireItemSchema),
  userImprovementPoints: z.array(WireItemSchema),
  otherPartyProblemPoints: z.array(WireItemSchema),
  balancedConclusion: z.string(),
  nextActions: z.array(z.string()),
  replySuggestions: z.object({
    gentle: z.string(),
    standard: z.string(),
    firm: z.string(),
  }),
  responsibilityBreakdown: z.array(
    z.object({
      topic: z.string(),
      // Gemini の responseSchema は全プロパティ必須のため、該当なしは空文字で受けて変換する
      userSide: z.string(),
      otherSide: z.string(),
      judgment: z.enum([
        'user_improvement',
        'other_improvement',
        'shared_improvement',
        'no_problem',
        'insufficient_evidence',
        'contextual_factor',
      ]),
    }),
  ),
  detectedPatterns: z.array(
    z.object({
      type: z.string(),
      label: z.string(),
      description: z.string(),
      confidence: CONFIDENCE,
    }),
  ),
  positiveActions: z.array(WireItemSchema),
  repairActions: z.array(WireItemSchema),
  safetyFlags: z.array(
    z.object({
      type: z.string(),
      severity: z.enum(['low', 'medium', 'high']),
      description: z.string(),
    }),
  ),
  isPositiveEvent: z.boolean(),
  isConflict: z.boolean(),
  isRepairAction: z.boolean(),
});

export type IncidentAnalysisPayload = z.infer<typeof IncidentAnalysisPayloadSchema>;

const ITEM_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    text: { type: Type.STRING },
    confidence: { type: Type.STRING, description: '"high" / "medium" / "low" のいずれか' },
  },
  required: ['text', 'confidence'],
} as const;

const ITEMS = { type: Type.ARRAY, items: ITEM_SCHEMA } as const;

/** Gemini の responseSchema（OpenAPI サブセット）。全プロパティ required。 */
export const INCIDENT_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    title: { type: Type.STRING, description: '出来事の短いタイトル（名詞句）' },
    conciseView: { type: Type.STRING, description: '2〜4文の率直かつ中立的な最初の見解' },
    verifiedFacts: { ...ITEMS, description: '記録から直接確認できる事実のみ' },
    userClaims: { ...ITEMS, description: 'ユーザーが記憶・主張しているが記録からは確認できない内容' },
    aiInferences: { ...ITEMS, description: 'AIによる推測' },
    unknowns: { ...ITEMS, description: '現時点では判断できないこと' },
    userImprovementPoints: { ...ITEMS, description: 'ユーザー側の改善点（人格でなく具体的行動）' },
    otherPartyProblemPoints: { ...ITEMS, description: '相手側の問題点（人格でなく具体的な発言・行動）' },
    balancedConclusion: { type: Type.STRING, description: '論点ごとに責任を分けたバランスの取れた結論' },
    nextActions: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: '次回の具体的対応。最大3件',
    },
    replySuggestions: {
      type: Type.OBJECT,
      properties: {
        gentle: { type: Type.STRING, description: 'やわらかい返信案' },
        standard: { type: Type.STRING, description: '標準の返信案' },
        firm: { type: Type.STRING, description: '境界線を明確にする返信案' },
      },
      required: ['gentle', 'standard', 'firm'],
    },
    responsibilityBreakdown: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          topic: { type: Type.STRING, description: '論点' },
          userSide: { type: Type.STRING, description: '自分側の評価。該当なしは空文字' },
          otherSide: { type: Type.STRING, description: '相手側の評価。該当なしは空文字' },
          judgment: {
            type: Type.STRING,
            description:
              '"user_improvement" / "other_improvement" / "shared_improvement" / "no_problem" / "insufficient_evidence" / "contextual_factor" のいずれか',
          },
        },
        required: ['topic', 'userSide', 'otherSide', 'judgment'],
      },
    },
    detectedPatterns: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          type: { type: Type.STRING, description: 'パターン識別子（generalization 等）' },
          label: { type: Type.STRING, description: '短い表示名' },
          description: { type: Type.STRING, description: '発言・行動としての説明（診断をしない）' },
          confidence: { type: Type.STRING, description: '"high" / "medium" / "low"' },
        },
        required: ['type', 'label', 'description', 'confidence'],
      },
    },
    positiveActions: { ...ITEMS, description: '良い出来事。該当なしは空配列' },
    repairActions: { ...ITEMS, description: '修復行動の可能性。該当なしは空配列' },
    safetyFlags: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          type: { type: Type.STRING, description: 'violence / self_harm / child_safety / threat / other' },
          severity: { type: Type.STRING, description: '"low" / "medium" / "high"' },
          description: { type: Type.STRING },
        },
        required: ['type', 'severity', 'description'],
      },
      description: '明確な危険の兆候がある場合のみ。なければ空配列',
    },
    isPositiveEvent: { type: Type.BOOLEAN },
    isConflict: { type: Type.BOOLEAN },
    isRepairAction: { type: Type.BOOLEAN },
  },
  required: [
    'title',
    'conciseView',
    'verifiedFacts',
    'userClaims',
    'aiInferences',
    'unknowns',
    'userImprovementPoints',
    'otherPartyProblemPoints',
    'balancedConclusion',
    'nextActions',
    'replySuggestions',
    'responsibilityBreakdown',
    'detectedPatterns',
    'positiveActions',
    'repairActions',
    'safetyFlags',
    'isPositiveEvent',
    'isConflict',
    'isRepairAction',
  ],
} as const;

/**
 * 分析の出力上限。セクションが多いため大きめに確保する。
 * 途中で切れた場合は zod 失敗と区別してユーザーへ伝える（PLAN.md §7-3）。
 */
export const INCIDENT_ANALYSIS_MAX_OUTPUT_TOKENS = 16384;

export class IncidentAnalysisError extends Error {
  /** 'truncated' = 出力上限で途切れた / 'parse' = JSONとして解釈できなかった */
  readonly kind: 'truncated' | 'parse';
  constructor(message: string, kind: 'truncated' | 'parse') {
    super(message);
    this.name = 'IncidentAnalysisError';
    this.kind = kind;
  }
}

interface CandidateInfo {
  finishReason?: string;
}

function finishReasonOf(response: { candidates?: CandidateInfo[] }): string {
  return response.candidates?.[0]?.finishReason ?? '';
}

export interface AnalyzeIncidentOptions {
  /** 分析対象のテキスト（修正済み文字起こし or 原文）。 */
  sourceText: string;
  /** ユーザーが入力した補足情報。 */
  context: IncidentContext;
  model: string;
  maxRetries?: number;
}

/** 出来事の記録から構造化分析ペイロードを生成する。 */
export async function analyzeIncident(
  ai: GoogleGenAI,
  { sourceText, context, model, maxRetries = 1 }: AnalyzeIncidentOptions,
): Promise<IncidentAnalysisPayload> {
  const system = buildIncidentAnalysisSystemPrompt();
  const user = buildIncidentAnalysisUserPrompt(sourceText, context);

  let truncated = false;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const contents = [
      { role: 'user' as const, parts: [{ text: user }] },
      ...(attempt > 0
        ? [
            {
              role: 'user' as const,
              parts: [
                {
                  text: '前回の出力は指定 JSON スキーマとして解釈できませんでした。今度は必ず有効な JSON のみを、各項目を簡潔にして返してください。',
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
        responseSchema: INCIDENT_RESPONSE_SCHEMA,
        maxOutputTokens: INCIDENT_ANALYSIS_MAX_OUTPUT_TOKENS,
      },
    });

    const payload = safeParseJson(IncidentAnalysisPayloadSchema, extractText(response));
    if (payload) return payload;
    truncated = finishReasonOf(response) === 'MAX_TOKENS';
  }

  if (truncated) {
    throw new IncidentAnalysisError(
      '分析結果が長すぎて途中で切れました。記録を短く分けてお試しください。',
      'truncated',
    );
  }
  throw new IncidentAnalysisError('モデル出力を JSON として解釈できませんでした', 'parse');
}

export interface IncidentAnalysisResult {
  analysis: IncidentAnalysis;
  title: string;
  isPositiveEvent: boolean;
  isConflict: boolean;
  isRepairAction: boolean;
}

/**
 * 生ペイロードに ID・メタ情報を付与して `IncidentAnalysis` に組み立てる（純粋関数）。
 * evidenceIds は空で返し、クライアント側で原本の EvidenceItem と紐づける。
 */
export function toIncidentAnalysisResult(
  payload: IncidentAnalysisPayload,
  opts: { aiModel: string; now?: Date; idGen?: () => string },
): IncidentAnalysisResult {
  let seq = 0;
  const idGen = opts.idGen ?? (() => `a${++seq}_${Math.random().toString(36).slice(2, 8)}`);
  const items = (list: Array<{ text: string; confidence: 'high' | 'medium' | 'low' }>) =>
    list.map((it) => ({ id: idGen(), text: it.text, confidence: it.confidence, evidenceIds: [] }));

  const analysis: IncidentAnalysis = {
    conciseView: payload.conciseView,
    verifiedFacts: items(payload.verifiedFacts),
    userClaims: items(payload.userClaims),
    aiInferences: items(payload.aiInferences),
    unknowns: items(payload.unknowns),
    userImprovementPoints: items(payload.userImprovementPoints),
    otherPartyProblemPoints: items(payload.otherPartyProblemPoints),
    balancedConclusion: payload.balancedConclusion,
    nextActions: payload.nextActions.slice(0, 3),
    replySuggestions: payload.replySuggestions,
    responsibilityBreakdown: payload.responsibilityBreakdown.map((row) => ({
      id: idGen(),
      topic: row.topic,
      userSide: row.userSide.trim() || undefined,
      otherSide: row.otherSide.trim() || undefined,
      judgment: row.judgment,
    })),
    detectedPatterns: payload.detectedPatterns.map((p) => ({
      id: idGen(),
      type: p.type,
      label: p.label,
      description: p.description,
      evidenceIds: [],
      confidence: p.confidence,
    })),
    positiveActions: items(payload.positiveActions),
    repairActions: items(payload.repairActions),
    safetyFlags: payload.safetyFlags.map((f) => ({
      id: idGen(),
      type: f.type,
      severity: f.severity,
      description: f.description,
      evidenceIds: [],
    })),
    aiModel: opts.aiModel,
    promptVersion: INCIDENT_ANALYSIS_PROMPT_VERSION,
    generatedAt: (opts.now ?? new Date()).toISOString(),
  };

  return {
    analysis,
    title: payload.title,
    isPositiveEvent: payload.isPositiveEvent,
    isConflict: payload.isConflict,
    isRepairAction: payload.isRepairAction,
  };
}

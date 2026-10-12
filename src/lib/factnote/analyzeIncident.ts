import { Type, type GoogleGenAI } from '@google/genai';
import { z } from 'zod';
import { extractText, REFLECTIVE_SAFETY_SETTINGS } from '../gemini';
import { safeParseJson } from './jsonExtract';
import {
  buildIncidentAnalysisSystemPrompt,
  buildIncidentAnalysisUserPrompt,
  INCIDENT_ANALYSIS_PROMPT_VERSION,
  type IncidentContext,
} from './prompts/incidentAnalysis';
import type { EvidenceBasis, IncidentAnalysis, Severity } from './types';

/**
 * 出来事の構造化分析（依頼書 §11 の 4〜12 を1回のGemini呼び出しで生成）。
 * `analyzeTalk` と同じパターン: responseSchema + zod検証 + フェンス抽出 + 再生成。
 */

const CONFIDENCE = z.enum(['high', 'medium', 'low']);
// 補助的なメタ情報は、想定外の値でも分析全体を捨てずに既定値へ寄せる
const SEVERITY = z.enum(['minor', 'moderate', 'serious']).catch('moderate');
const BASIS = z.enum(['verified', 'user_claim', 'inference']).catch('user_claim');
const ACTOR = z.enum(['user', 'other', 'both', 'unclear']).catch('unclear');

const WireItemSchema = z.object({
  text: z.string(),
  confidence: CONFIDENCE,
});

/** 改善点・問題点（重さと根拠の種類付き）。 */
const WireIssueSchema = WireItemSchema.extend({
  severity: SEVERITY,
  basis: BASIS,
});

export const VerdictSchema = z.object({
  reasoning: z.string(),
  roleReversalCheck: z.string(),
  leaning: z.enum([
    'user_mainly',
    'user_more',
    'comparable',
    'other_more',
    'other_mainly',
    'no_fault',
    'not_applicable',
    'undeterminable',
  ]),
  robustness: z.enum(['firm', 'tentative', 'fragile']).catch('tentative'),
  whatWouldChange: z.string(),
  headline: z.string(),
});

/** Gemini が返す生の分析ペイロード（ID・メタ情報はサーバー側で付与する）。 */
export const IncidentAnalysisPayloadSchema = z.object({
  title: z.string(),
  isConflict: z.boolean(),
  isPositiveEvent: z.boolean(),
  isRepairAction: z.boolean(),
  verifiedFacts: z.array(WireItemSchema),
  userClaims: z.array(WireItemSchema),
  aiInferences: z.array(WireItemSchema),
  unknowns: z.array(WireItemSchema),
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
      severity: SEVERITY,
      basis: BASIS,
    }),
  ),
  userImprovementPoints: z.array(WireIssueSchema),
  otherPartyProblemPoints: z.array(WireIssueSchema),
  detectedPatterns: z.array(
    z.object({
      type: z.string(),
      actor: ACTOR,
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
  verdict: VerdictSchema,
  conciseView: z.string(),
  balancedConclusion: z.string(),
  nextActions: z.array(z.string()),
  replySuggestions: z.object({
    gentle: z.string(),
    standard: z.string(),
    firm: z.string(),
  }),
});

export type IncidentAnalysisPayload = z.infer<typeof IncidentAnalysisPayloadSchema>;

const CONFIDENCE_DESC = '"high" / "medium" / "low" のいずれか';
const SEVERITY_DESC = '"minor"（軽微）/ "moderate"（中程度）/ "serious"（重大）のいずれか';
const BASIS_DESC = '"verified"（記録で確認）/ "user_claim"（記録者の記憶・主張）/ "inference"（推測）のいずれか';

const ITEM_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    text: { type: Type.STRING },
    confidence: { type: Type.STRING, description: CONFIDENCE_DESC },
  },
  required: ['text', 'confidence'],
  propertyOrdering: ['text', 'confidence'],
};

const ITEMS = { type: Type.ARRAY, items: ITEM_SCHEMA };

const ISSUE_ITEMS = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      text: { type: Type.STRING, description: '人格ではなく具体的な発言・行動' },
      severity: { type: Type.STRING, description: SEVERITY_DESC },
      basis: { type: Type.STRING, description: BASIS_DESC },
      confidence: { type: Type.STRING, description: CONFIDENCE_DESC },
    },
    required: ['text', 'severity', 'basis', 'confidence'],
    propertyOrdering: ['text', 'severity', 'basis', 'confidence'],
  },
};

/**
 * 生成順。Gemini は propertyOrdering を指定しないとプロパティを**アルファベット順**に
 * 生成するため、v2 までは balancedConclusion / conciseView が改善点・問題点より先に
 * 書かれ、結論が分析に先行して「両論併記」に寄りやすかった。
 * v3 では「事実 → 論点と重さ → 各側の問題 → 判定 → 見解・結論 → 対応」の順に固定する。
 */
export const INCIDENT_PROPERTY_ORDER = [
  'title',
  'isConflict',
  'isPositiveEvent',
  'isRepairAction',
  'verifiedFacts',
  'userClaims',
  'aiInferences',
  'unknowns',
  'responsibilityBreakdown',
  'userImprovementPoints',
  'otherPartyProblemPoints',
  'detectedPatterns',
  'positiveActions',
  'repairActions',
  'safetyFlags',
  'verdict',
  'conciseView',
  'balancedConclusion',
  'nextActions',
  'replySuggestions',
];

/** Gemini の responseSchema（OpenAPI サブセット）。全プロパティ required。 */
export const INCIDENT_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    title: { type: Type.STRING, description: '出来事の短いタイトル（名詞句）' },
    isConflict: { type: Type.BOOLEAN },
    isPositiveEvent: { type: Type.BOOLEAN },
    isRepairAction: { type: Type.BOOLEAN },
    verifiedFacts: { ...ITEMS, description: '記録から直接確認できる事実のみ' },
    userClaims: { ...ITEMS, description: '記録者が記憶・主張しているが記録からは確認できない内容' },
    aiInferences: { ...ITEMS, description: 'AIによる推測' },
    unknowns: { ...ITEMS, description: '現時点では判断できないこと' },
    responsibilityBreakdown: {
      type: Type.ARRAY,
      description: '論点ごとの整理（発端と反応は別の論点にする）。衝突でなければ空配列',
      items: {
        type: Type.OBJECT,
        properties: {
          topic: { type: Type.STRING, description: '論点' },
          userSide: { type: Type.STRING, description: '記録者側の評価。該当なしは空文字' },
          otherSide: { type: Type.STRING, description: '相手側の評価。該当なしは空文字' },
          severity: { type: Type.STRING, description: `この論点の問題の重さ。${SEVERITY_DESC}` },
          basis: { type: Type.STRING, description: BASIS_DESC },
          judgment: {
            type: Type.STRING,
            description:
              '"user_improvement" / "other_improvement" / "shared_improvement" / "no_problem" / "insufficient_evidence" / "contextual_factor" のいずれか',
          },
        },
        required: ['topic', 'userSide', 'otherSide', 'severity', 'basis', 'judgment'],
        propertyOrdering: ['topic', 'userSide', 'otherSide', 'severity', 'basis', 'judgment'],
      },
    },
    userImprovementPoints: {
      ...ISSUE_ITEMS,
      description: '記録者側の改善点（重い順）。問題がなければ空配列。数を相手側と揃えない',
    },
    otherPartyProblemPoints: {
      ...ISSUE_ITEMS,
      description: '相手側の問題点（重い順）。問題がなければ空配列。数を記録者側と揃えない',
    },
    detectedPatterns: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          type: { type: Type.STRING, description: 'パターン識別子（generalization 等）' },
          actor: { type: Type.STRING, description: '"user"（記録者）/ "other"（相手）/ "both" / "unclear"' },
          label: { type: Type.STRING, description: '短い表示名' },
          description: { type: Type.STRING, description: '発言・行動としての説明（診断をしない）' },
          confidence: { type: Type.STRING, description: CONFIDENCE_DESC },
        },
        required: ['type', 'actor', 'label', 'description', 'confidence'],
        propertyOrdering: ['type', 'actor', 'label', 'description', 'confidence'],
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
        propertyOrdering: ['type', 'severity', 'description'],
      },
      description: '明確な危険の兆候がある場合のみ。なければ空配列',
    },
    verdict: {
      type: Type.OBJECT,
      description: '論点の重さから導く全体の判定',
      properties: {
        reasoning: { type: Type.STRING, description: '件数ではなく重さの比較による理由' },
        roleReversalCheck: { type: Type.STRING, description: '立場を入れ替えても同じ判定になるかの確認結果' },
        leaning: {
          type: Type.STRING,
          description:
            '"user_mainly" / "user_more" / "comparable" / "other_more" / "other_mainly" / "no_fault" / "not_applicable" / "undeterminable" のいずれか',
        },
        robustness: {
          type: Type.STRING,
          description: '"firm"（記録で裏付け）/ "tentative"（一部が記録者の記憶）/ "fragile"（未確認の主張が中心）',
        },
        whatWouldChange: { type: Type.STRING, description: 'どんな事実が分かれば判定が変わりうるか' },
        headline: { type: Type.STRING, description: '判定を1文で率直に言い切る' },
      },
      required: ['reasoning', 'roleReversalCheck', 'leaning', 'robustness', 'whatWouldChange', 'headline'],
      propertyOrdering: ['reasoning', 'roleReversalCheck', 'leaning', 'robustness', 'whatWouldChange', 'headline'],
    },
    conciseView: { type: Type.STRING, description: '判定と矛盾しない2〜4文の率直な見解。1文目で判定を言い切る' },
    balancedConclusion: { type: Type.STRING, description: '論点ごとの結論。片寄っているなら片寄っていると明記する' },
    nextActions: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: '次回の具体的対応。最大3件。重い問題への対応を先に',
    },
    replySuggestions: {
      type: Type.OBJECT,
      properties: {
        gentle: { type: Type.STRING, description: 'やわらかい返信案（衝突でなければ空文字可）' },
        standard: { type: Type.STRING, description: '標準の返信案（衝突でなければ空文字可）' },
        firm: { type: Type.STRING, description: '相手に moderate 以上の言動がある時だけ。なければ空文字' },
      },
      required: ['gentle', 'standard', 'firm'],
      propertyOrdering: ['gentle', 'standard', 'firm'],
    },
  },
  required: INCIDENT_PROPERTY_ORDER,
  propertyOrdering: INCIDENT_PROPERTY_ORDER,
};

/**
 * 分析の出力上限。セクションが多いため大きめに確保する。
 * 途中で切れた場合は zod 失敗と区別してユーザーへ伝える（PLAN.md §7-3）。
 */
export const INCIDENT_ANALYSIS_MAX_OUTPUT_TOKENS = 16384;

export class IncidentAnalysisError extends Error {
  /**
   * 'truncated' = 出力上限で途切れた / 'blocked' = 安全フィルタ等でブロックされた
   * （再試行しても変わらない） / 'parse' = 原因不明でJSONとして解釈できなかった
   */
  readonly kind: 'truncated' | 'blocked' | 'parse';
  constructor(message: string, kind: 'truncated' | 'blocked' | 'parse') {
    super(message);
    this.name = 'IncidentAnalysisError';
    this.kind = kind;
  }
}

/** 再試行しても変わらないブロック系の finishReason / blockReason。 */
const BLOCKED_REASONS = new Set([
  'SAFETY',
  'PROHIBITED_CONTENT',
  'BLOCKLIST',
  'RECITATION',
  'SPII',
  'OTHER',
]);

interface SafetyRatingInfo {
  category?: string;
  probability?: string;
  blocked?: boolean;
}

interface CandidateInfo {
  finishReason?: string;
  safetyRatings?: SafetyRatingInfo[];
}

interface FeedbackInfo {
  candidates?: CandidateInfo[];
  promptFeedback?: { blockReason?: string; safetyRatings?: SafetyRatingInfo[] };
}

function finishReasonOf(response: FeedbackInfo): string {
  return response.candidates?.[0]?.finishReason ?? '';
}

/** ブロックされた（内容が原因で、再試行しても解決しない）応答かどうか。 */
function isBlockedResponse(response: FeedbackInfo): boolean {
  if (response.promptFeedback?.blockReason) return true;
  return BLOCKED_REASONS.has(finishReasonOf(response));
}

/**
 * ブロック理由の診断用サマリ（カテゴリ・確率のみ。本文は一切含まない）。
 * safetySettings 調整の要否を判断するためログにだけ出す。
 */
function blockedDiagnostics(response: FeedbackInfo): string {
  const ratings = response.promptFeedback?.safetyRatings ?? response.candidates?.[0]?.safetyRatings ?? [];
  const flagged = ratings.filter((r) => r.blocked || r.probability === 'HIGH' || r.probability === 'MEDIUM');
  if (flagged.length === 0) return '';
  return flagged.map((r) => `${r.category}=${r.probability}`).join(', ');
}

export interface AnalyzeIncidentOptions {
  /** 分析対象のテキスト（修正済み文字起こし or 原文）。 */
  sourceText: string;
  /** ユーザーが入力した補足情報。 */
  context: IncidentContext;
  /** プロフィール（自分の立場・家族構成）。自分側/相手側の割り当てに使う。 */
  peopleContext?: string;
  model: string;
  maxRetries?: number;
}

/** 出来事の記録から構造化分析ペイロードを生成する。 */
export async function analyzeIncident(
  ai: GoogleGenAI,
  { sourceText, context, peopleContext, model, maxRetries = 1 }: AnalyzeIncidentOptions,
): Promise<IncidentAnalysisPayload> {
  const system = buildIncidentAnalysisSystemPrompt(peopleContext);
  const user = buildIncidentAnalysisUserPrompt(sourceText, context);

  let truncated = false;
  let blocked = false;
  let lastReason = '';
  let lastDiagnostics = '';
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
        // 事実の捏造を避け、一括再分析でも判定がぶれないよう温度は低め
        temperature: 0.2,
        responseMimeType: 'application/json',
        responseSchema: INCIDENT_RESPONSE_SCHEMA,
        maxOutputTokens: INCIDENT_ANALYSIS_MAX_OUTPUT_TOKENS,
        safetySettings: REFLECTIVE_SAFETY_SETTINGS,
      },
    });

    const payload = safeParseJson(IncidentAnalysisPayloadSchema, extractText(response));
    if (payload) return payload;
    truncated = finishReasonOf(response) === 'MAX_TOKENS';
    blocked = isBlockedResponse(response);
    lastReason = response.promptFeedback?.blockReason || finishReasonOf(response) || '';
    lastDiagnostics = blockedDiagnostics(response);
    // ブロックは再試行しても結果が変わらないため、ここで打ち切る（内容はログに出さない）
    if (blocked) break;
  }

  if (truncated) {
    throw new IncidentAnalysisError(
      '分析結果が長すぎて途中で切れました。記録を短く分けてお試しください。',
      'truncated',
    );
  }
  if (blocked) {
    console.error(
      `[factnote-analyze] blocked: ${lastReason || 'unknown'}${lastDiagnostics ? ` (${lastDiagnostics})` : ''}`,
    );
    throw new IncidentAnalysisError(
      '内容が安全フィルタによりブロックされ、分析結果を生成できませんでした。表現を少し和らげるか、固有名詞・詳細な描写を控えて再度お試しください。',
      'blocked',
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

  const issues = (
    list: Array<{
      text: string;
      confidence: 'high' | 'medium' | 'low';
      severity: Severity;
      basis: EvidenceBasis;
    }>,
  ) =>
    list.map((it) => ({
      id: idGen(),
      text: it.text,
      confidence: it.confidence,
      evidenceIds: [],
      severity: it.severity,
      basis: it.basis,
    }));

  const analysis: IncidentAnalysis = {
    verdict: {
      leaning: payload.verdict.leaning,
      headline: payload.verdict.headline,
      reasoning: payload.verdict.reasoning,
      robustness: payload.verdict.robustness,
      whatWouldChange: payload.verdict.whatWouldChange,
      roleReversalCheck: payload.verdict.roleReversalCheck,
    },
    conciseView: payload.conciseView,
    verifiedFacts: items(payload.verifiedFacts),
    userClaims: items(payload.userClaims),
    aiInferences: items(payload.aiInferences),
    unknowns: items(payload.unknowns),
    userImprovementPoints: issues(payload.userImprovementPoints),
    otherPartyProblemPoints: issues(payload.otherPartyProblemPoints),
    balancedConclusion: payload.balancedConclusion,
    nextActions: payload.nextActions.slice(0, 3),
    replySuggestions: {
      gentle: payload.replySuggestions.gentle.trim(),
      standard: payload.replySuggestions.standard.trim(),
      firm: payload.replySuggestions.firm.trim(),
    },
    responsibilityBreakdown: payload.responsibilityBreakdown.map((row) => ({
      id: idGen(),
      topic: row.topic,
      userSide: row.userSide.trim() || undefined,
      otherSide: row.otherSide.trim() || undefined,
      judgment: row.judgment,
      // 問題なし・判断材料不足の論点に重さは意味を持たないので落とす
      severity:
        row.judgment === 'no_problem' || row.judgment === 'insufficient_evidence'
          ? undefined
          : row.severity,
      basis: row.basis,
    })),
    detectedPatterns: payload.detectedPatterns.map((p) => ({
      id: idGen(),
      type: p.type,
      actor: p.actor,
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

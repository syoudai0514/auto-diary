import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import type { GoogleGenAI } from '@google/genai';
import {
  analyzeIncident,
  IncidentAnalysisError,
  IncidentAnalysisPayloadSchema,
  toIncidentAnalysisResult,
  type IncidentAnalysisPayload,
} from './analyzeIncident';
import { safeParseJson } from './jsonExtract';
import { analysisSummaryForDiary } from './generateFactnoteDiary';
import { buildMockAnalysis } from './fixtures';
import { INCIDENT_ANALYSIS_PROMPT_VERSION } from './prompts/incidentAnalysis';

function makePayload(): IncidentAnalysisPayload {
  return {
    title: '荷物の受け取りを忘れた',
    conciseView: '見解。',
    verifiedFacts: [{ text: '事実1', confidence: 'high' }],
    userClaims: [{ text: '主張1', confidence: 'medium' }],
    aiInferences: [{ text: '推測1', confidence: 'low' }],
    unknowns: [{ text: '不明1', confidence: 'low' }],
    userImprovementPoints: [{ text: 'リマインダーを設定する', confidence: 'high' }],
    otherPartyProblemPoints: [{ text: '一般化表現を使った', confidence: 'high' }],
    balancedConclusion: '結論。',
    nextActions: ['対応1', '対応2', '対応3', '対応4'],
    replySuggestions: { gentle: 'g', standard: 's', firm: 'f' },
    responsibilityBreakdown: [
      { topic: '受け取り忘れ', userSide: '改善が必要', otherSide: '', judgment: 'user_improvement' },
    ],
    detectedPatterns: [
      { type: 'generalization', label: '一般化表現', description: '説明', confidence: 'high' },
    ],
    positiveActions: [],
    repairActions: [],
    safetyFlags: [],
    isPositiveEvent: false,
    isConflict: true,
    isRepairAction: false,
  };
}

describe('分析ペイロードの検証と組み立て', () => {
  it('正しいペイロードが zod 検証を通る', () => {
    expect(IncidentAnalysisPayloadSchema.safeParse(makePayload()).success).toBe(true);
  });

  it('confidence が不正なら検証に失敗する', () => {
    const bad = makePayload();
    (bad.verifiedFacts[0] as { confidence: string }).confidence = 'very-high';
    expect(IncidentAnalysisPayloadSchema.safeParse(bad).success).toBe(false);
  });

  it('toIncidentAnalysisResult がID・メタ情報を付与し nextActions を3件に制限する', () => {
    const result = toIncidentAnalysisResult(makePayload(), {
      aiModel: 'gemini-test',
      now: new Date('2026-07-13T00:00:00Z'),
    });
    expect(result.analysis.aiModel).toBe('gemini-test');
    expect(result.analysis.promptVersion).toBe(INCIDENT_ANALYSIS_PROMPT_VERSION);
    expect(result.analysis.generatedAt).toBe('2026-07-13T00:00:00.000Z');
    expect(result.analysis.nextActions).toHaveLength(3);
    expect(result.analysis.verifiedFacts[0].id).toBeTruthy();
    // 空文字の userSide/otherSide は undefined に変換される
    expect(result.analysis.responsibilityBreakdown[0].otherSide).toBeUndefined();
    expect(result.analysis.responsibilityBreakdown[0].userSide).toBe('改善が必要');
    expect(result.title).toBe('荷物の受け取りを忘れた');
    expect(result.isConflict).toBe(true);
  });

  it('IDは項目ごとに一意', () => {
    const result = toIncidentAnalysisResult(makePayload(), { aiModel: 'm' });
    const ids = [
      ...result.analysis.verifiedFacts,
      ...result.analysis.userClaims,
      ...result.analysis.detectedPatterns,
      ...result.analysis.responsibilityBreakdown,
    ].map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

function mockGemini(
  responses: Array<{ text?: string; finishReason?: string; blockReason?: string }>,
): GoogleGenAI {
  let i = 0;
  const generateContent = vi.fn(async (_req: unknown) => {
    const r = responses[Math.min(i, responses.length - 1)];
    i++;
    return {
      text: r.text ?? '',
      candidates: r.finishReason ? [{ finishReason: r.finishReason }] : [],
      promptFeedback: r.blockReason ? { blockReason: r.blockReason } : undefined,
    };
  });
  return { models: { generateContent } } as unknown as GoogleGenAI;
}

const validPayload = JSON.stringify(makePayload());

describe('analyzeIncident', () => {
  it('安全フィルタでブロックされた場合、再試行せず blocked エラーを投げる', async () => {
    const ai = mockGemini([{ text: '', finishReason: 'SAFETY' }, { text: validPayload }]);
    await expect(
      analyzeIncident(ai, {
        sourceText: 'text',
        context: {},
        model: 'm',
        maxRetries: 1,
      }),
    ).rejects.toMatchObject({ kind: 'blocked' } satisfies Partial<IncidentAnalysisError>);
    expect(
      (ai.models.generateContent as unknown as { mock: { calls: unknown[] } }).mock.calls.length,
    ).toBe(1);
  });

  it('promptFeedback.blockReason がある場合も blocked エラーになる', async () => {
    const ai = mockGemini([{ text: '', blockReason: 'SAFETY' }]);
    await expect(
      analyzeIncident(ai, { sourceText: 'text', context: {}, model: 'm' }),
    ).rejects.toMatchObject({ kind: 'blocked' });
  });

  it('MAX_TOKENSで途切れた場合は truncated エラーになる', async () => {
    const ai = mockGemini([{ text: '{"a":1', finishReason: 'MAX_TOKENS' }]);
    await expect(
      analyzeIncident(ai, { sourceText: 'text', context: {}, model: 'm' }),
    ).rejects.toMatchObject({ kind: 'truncated' });
  });

  it('原因不明の解釈失敗は parse エラーになり、再試行する', async () => {
    const ai = mockGemini([{ text: '壊れたJSON' }, { text: '壊れたJSON' }]);
    await expect(
      analyzeIncident(ai, { sourceText: 'text', context: {}, model: 'm', maxRetries: 1 }),
    ).rejects.toMatchObject({ kind: 'parse' });
    expect(
      (ai.models.generateContent as unknown as { mock: { calls: unknown[] } }).mock.calls.length,
    ).toBe(2);
  });

  it('有効なペイロードを返せば成功する', async () => {
    const ai = mockGemini([{ text: validPayload }]);
    const payload = await analyzeIncident(ai, { sourceText: 'text', context: {}, model: 'm' });
    expect(payload.title).toBe('荷物の受け取りを忘れた');
  });
});

describe('safeParseJson（フェンス・前置き耐性）', () => {
  const schema = z.object({ a: z.number() });

  it('素のJSONを解釈できる', () => {
    expect(safeParseJson(schema, '{"a": 1}')).toEqual({ a: 1 });
  });

  it('```json フェンス付きを解釈できる', () => {
    expect(safeParseJson(schema, '説明:\n```json\n{"a": 2}\n```')).toEqual({ a: 2 });
  });

  it('前置き付きの波括弧抽出ができる', () => {
    expect(safeParseJson(schema, 'こちらが結果です {"a": 3} 以上です')).toEqual({ a: 3 });
  });

  it('解釈できなければ null', () => {
    expect(safeParseJson(schema, 'JSONではありません')).toBeNull();
    expect(safeParseJson(schema, '{"a": "文字列"}')).toBeNull();
  });
});

describe('analysisSummaryForDiary', () => {
  it('分析の要点だけを日記プロンプト用テキストにする', () => {
    const summary = analysisSummaryForDiary(buildMockAnalysis());
    expect(summary).toContain('見解:');
    expect(summary).toContain('確認できる事実:');
    expect(summary).toContain('次回の対応:');
    // JSON全体は含まない
    expect(summary).not.toContain('{');
  });
});

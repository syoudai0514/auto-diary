import { describe, it, expect } from 'vitest';
import {
  FlatCheckPayloadSchema,
  pastStatsText,
  toFlatCheckAiPart,
  type FlatCheckPayload,
} from './flatCheck';

function payload(): FlatCheckPayload {
  const it = (text: string) => ({ text, confidence: 'medium' as const });
  return {
    conciseConclusion: '結論。',
    userImprovementPoints: [it('a'), it('b'), it('c'), it('d'), it('e'), it('f'), it('g')],
    otherPartyProblemPoints: [it('x')],
    unknowns: [it('u')],
    avoidJudgingFromThisIncident: [it('j')],
    improvingPoints: [],
    aiMessage: '一言。',
  };
}

describe('フラットチェックの検証と組み立て', () => {
  it('正しいペイロードが zod 検証を通る', () => {
    expect(FlatCheckPayloadSchema.safeParse(payload()).success).toBe(true);
  });

  it('必須フィールド欠落は検証に失敗する', () => {
    const bad = payload() as Record<string, unknown>;
    delete bad.aiMessage;
    expect(FlatCheckPayloadSchema.safeParse(bad).success).toBe(false);
  });

  it('toFlatCheckAiPart は改善点・問題点を最大5件に制限しIDを付与する', () => {
    const part = toFlatCheckAiPart(payload(), { aiModel: 'gemini-test' });
    expect(part.userImprovementPoints).toHaveLength(5);
    expect(part.userImprovementPoints[0].id).toBeTruthy();
    expect(part.aiModel).toBe('gemini-test');
    expect(part.promptVersion).toBe('v1');
  });

  it('pastStatsText は件数付きの集計テキストを作り、過去0件では空を返す', () => {
    expect(pastStatsText([], 0)).toBe('');
    const text = pastStatsText(
      [{ id: 'a', label: '「いつも」の表現', count: 3, recordIds: [], confidence: 'medium' }],
      5,
    );
    expect(text).toContain('対象の過去記録: 5件');
    expect(text).toContain('「いつも」の表現: 3件');
  });
});

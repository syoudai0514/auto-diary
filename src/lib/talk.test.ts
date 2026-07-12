import { describe, it, expect } from 'vitest';
import { safeParseTalkAnalysis, TalkAnalysisSchema, talkAnalysisToText } from './talk';
import { sampleAnalysis } from '@/test/fixtures/talkAnalysis';

describe('TalkAnalysisSchema', () => {
  it('妥当な分析データを受け入れる', () => {
    expect(TalkAnalysisSchema.safeParse(sampleAnalysis).success).toBe(true);
  });

  it('leansToward が A/B/even 以外なら拒否する', () => {
    const bad = { ...sampleAnalysis, verdict: { ...sampleAnalysis.verdict, leansToward: 'C' } };
    expect(TalkAnalysisSchema.safeParse(bad).success).toBe(false);
  });

  it('必須フィールド欠落は拒否する', () => {
    const { verdict: _verdict, ...rest } = sampleAnalysis;
    expect(TalkAnalysisSchema.safeParse(rest).success).toBe(false);
  });
});

describe('safeParseTalkAnalysis', () => {
  it('素のJSONをパースできる', () => {
    const parsed = safeParseTalkAnalysis(JSON.stringify(sampleAnalysis));
    expect(parsed?.verdict.leansToward).toBe('B');
  });

  it('```json フェンス付きでもパースできる', () => {
    const parsed = safeParseTalkAnalysis('```json\n' + JSON.stringify(sampleAnalysis) + '\n```');
    expect(parsed?.title).toBe('家事分担についての話し合い');
  });

  it('前後に余計な文字があってもパースできる', () => {
    const parsed = safeParseTalkAnalysis('結果:\n' + JSON.stringify(sampleAnalysis) + '\n以上');
    expect(parsed?.sideB.label).toBe('妻');
  });

  it('壊れた出力は null を返す', () => {
    expect(safeParseTalkAnalysis('これはJSONではない')).toBeNull();
    expect(safeParseTalkAnalysis('{"title": "だけ"}')).toBeNull();
  });
});

describe('talkAnalysisToText', () => {
  it('主要セクションを含む共有用テキストを生成する', () => {
    const text = talkAnalysisToText(sampleAnalysis);
    expect(text).toContain('【家事分担についての話し合い】');
    expect(text).toContain('■ 率直な判定');
    expect(text).toContain('■ すれ違いポイント');
    expect(text).toContain('■ 仲直りの会話例');
    expect(text).toContain('私「片付けを任せきりにしてごめん。」');
    // safetyNote が空なら「たいせつなお知らせ」は出ない
    expect(text).not.toContain('たいせつなお知らせ');
  });

  it('safetyNote があれば冒頭近くに含める', () => {
    const withNote = { ...sampleAnalysis, safetyNote: '安全を最優先にしてください。' };
    const text = talkAnalysisToText(withNote);
    expect(text).toContain('■ たいせつなお知らせ');
    expect(text).toContain('安全を最優先にしてください。');
  });
});

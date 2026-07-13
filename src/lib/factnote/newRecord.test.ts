import { describe, it, expect } from 'vitest';
import {
  applyAnalysisResult,
  applySupplement,
  childrenToStored,
  createEmptyRecord,
  emptySupplement,
  sourceTextOf,
  supplementToContext,
} from './newRecord';
import { buildMockAnalyzeResult } from './fixtures';

describe('記録作成フローのロジック', () => {
  it('createEmptyRecord は下書き状態の空レコードを作る', () => {
    const r = createEmptyRecord('text');
    expect(r.status).toBe('draft');
    expect(r.sourceType).toBe('text');
    expect(r.diaryVersions).toEqual([]);
    expect(r.id).toBeTruthy();
  });

  it('sourceTextOf は修正済み文字起こしを最優先する', () => {
    const r = createEmptyRecord('voice_recording');
    r.rawText = '原文';
    expect(sourceTextOf(r)).toBe('原文');
    r.transcript = '文字起こし';
    expect(sourceTextOf(r)).toBe('文字起こし');
    r.correctedTranscript = '修正済み';
    expect(sourceTextOf(r)).toBe('修正済み');
  });

  it('childrenToStored は選択肢を childrenPresent とタグに変換する', () => {
    expect(childrenToStored('聞いていた')).toEqual({
      childrenPresent: 'yes',
      childImpactTags: ['聞いていた'],
    });
    expect(childrenToStored('いなかった')).toEqual({ childrenPresent: 'no', childImpactTags: [] });
    expect(childrenToStored('不明')).toEqual({ childrenPresent: 'unknown', childImpactTags: [] });
    expect(childrenToStored('')).toEqual({ childrenPresent: undefined, childImpactTags: [] });
  });

  it('applySupplement は補足情報をレコードへ反映する（原本は変更しない）', () => {
    const r = { ...createEmptyRecord('text'), rawText: '原文' };
    const s = {
      ...emptySupplement(new Date('2026-07-13T18:00:00')),
      location: '自宅',
      people: ['配偶者'],
      children: '同席していた' as const,
      emotions: ['疲労'],
    };
    const updated = applySupplement(r, s);
    expect(updated.location).toBe('自宅');
    expect(updated.people[0].displayName).toBe('配偶者');
    expect(updated.childrenPresent).toBe('yes');
    expect(updated.emotions).toEqual(['疲労']);
    expect(updated.occurredAt).toBeTruthy();
    expect(updated.rawText).toBe('原文');
  });

  it('時刻不明のときは occurredAt を保存しない', () => {
    const s = { ...emptySupplement(), occurredUnknown: true };
    const updated = applySupplement(createEmptyRecord('text'), s);
    expect(updated.occurredAt).toBeUndefined();
    expect(supplementToContext(s).occurredAt).toBeUndefined();
  });

  it('applyAnalysisResult は分析を反映し verifiedFacts を原本に紐づける', () => {
    const r = createEmptyRecord('text');
    r.rawText = '原文';
    r.evidenceItems = [
      { id: 'ev-src', type: 'text', text: '原文', sourceLabel: 'ユーザー入力', confidence: 'high' },
    ];
    const updated = applyAnalysisResult(r, buildMockAnalyzeResult());
    expect(updated.status).toBe('ready');
    expect(updated.title).toBe('荷物の受け取りを忘れた');
    expect(updated.isConflict).toBe(true);
    expect(updated.analysis?.verifiedFacts.every((f) => f.evidenceIds.includes('ev-src'))).toBe(true);
    // 原本は変更されない
    expect(updated.rawText).toBe('原文');
  });

  it('applyAnalysisResult は既存タイトルを上書きしない', () => {
    const r = { ...createEmptyRecord('text'), title: 'ユーザーのタイトル' };
    const updated = applyAnalysisResult(r, buildMockAnalyzeResult());
    expect(updated.title).toBe('ユーザーのタイトル');
  });
});

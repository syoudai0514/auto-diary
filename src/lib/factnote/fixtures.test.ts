import { describe, it, expect } from 'vitest';
import { buildMockAnalysis, buildMockDiary, buildSampleRecords, SAMPLE_ID_PREFIX } from './fixtures';
import { buildExportPayload, exportFileName } from './exportData';
import { FACTNOTE_SCHEMA_VERSION, type DiaryMode } from './types';

describe('サンプルデータとモックAI', () => {
  it('サンプルレコードは10件で、固定プレフィックス付きIDを持つ', () => {
    const records = buildSampleRecords(new Date('2026-07-13T12:00:00Z'));
    expect(records).toHaveLength(10);
    for (const r of records) {
      expect(r.id.startsWith(SAMPLE_ID_PREFIX)).toBe(true);
      expect(r.schemaVersion).toBe(FACTNOTE_SCHEMA_VERSION);
    }
  });

  it('良い出来事・衝突・修復行動の両方が含まれる（依頼書 §33）', () => {
    const records = buildSampleRecords();
    expect(records.some((r) => r.isPositiveEvent)).toBe(true);
    expect(records.some((r) => r.isConflict)).toBe(true);
    expect(records.some((r) => r.isRepairAction)).toBe(true);
  });

  it('分析済みサンプルは分析の全セクションと返信案3種を持つ', () => {
    const analyzed = buildSampleRecords().find((r) => r.analysis);
    expect(analyzed).toBeDefined();
    const a = analyzed!.analysis!;
    expect(a.conciseView.length).toBeGreaterThan(0);
    expect(a.verifiedFacts.length).toBeGreaterThan(0);
    expect(a.unknowns.length).toBeGreaterThan(0);
    expect(a.replySuggestions.gentle).toBeTruthy();
    expect(a.replySuggestions.standard).toBeTruthy();
    expect(a.replySuggestions.firm).toBeTruthy();
    expect(a.nextActions.length).toBeLessThanOrEqual(3);
    expect(a.responsibilityBreakdown.length).toBeGreaterThan(0);
    expect(a.aiModel).toBeTruthy();
    expect(a.promptVersion).toBeTruthy();
  });

  it('モック分析は危険兆候なし（safetyFlags 空）で返る', () => {
    expect(buildMockAnalysis().safetyFlags).toEqual([]);
  });

  it('モック日記は全モードでタイトルと本文を返す', () => {
    const modes: DiaryMode[] = ['factual', 'emotional', 'family', 'short', 'detailed'];
    for (const mode of modes) {
      const d = buildMockDiary(mode);
      expect(d.title.length).toBeGreaterThan(0);
      expect(d.body.length).toBeGreaterThan(0);
    }
  });
});

describe('JSONエクスポート', () => {
  it('エクスポートペイロードに全レコードとメタ情報が入る', () => {
    const records = buildSampleRecords();
    const payload = buildExportPayload(records, new Date('2026-07-13T12:00:00Z'));
    expect(payload.app).toBe('factnote');
    expect(payload.schemaVersion).toBe(FACTNOTE_SCHEMA_VERSION);
    expect(payload.exportedAt).toBe('2026-07-13T12:00:00.000Z');
    expect(payload.recordCount).toBe(10);
    expect(payload.records).toHaveLength(10);
  });

  it('エクスポートファイル名は日時を含む', () => {
    expect(exportFileName(new Date(2026, 6, 13, 9, 5))).toBe('factnote-export-20260713-0905.json');
  });
});

import { describe, it, expect, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { ApiError } from '../api';
import { buildMockAnalysis } from './fixtures';
import { createEmptyRecord } from './newRecord';
import { getRecord, saveRecord } from './db';
import type { IncidentRecord } from './types';

const analyzeMock = vi.fn();
vi.mock('./api', async (orig) => ({
  ...(await orig<typeof import('./api')>()),
  factnoteAnalyzeApi: (...args: unknown[]) => analyzeMock(...args),
}));

const { startBulkReanalysis, subscribeBulkReanalysis, clearBulkReanalysis, cancelBulkReanalysis } = await import(
  './jobs'
);
type BulkState = Parameters<Parameters<typeof subscribeBulkReanalysis>[0]>[0];

function rec(id: string, patch: Partial<IncidentRecord> = {}): IncidentRecord {
  return { ...createEmptyRecord('text'), id, rawText: `本文${id}`, status: 'ready', ...patch };
}

function result(leaning: 'user_more' | 'other_more') {
  const analysis = buildMockAnalysis();
  return {
    analysis: { ...analysis, verdict: { ...analysis.verdict!, leaning } },
    title: 'タイトル',
    isConflict: true,
    isPositiveEvent: false,
    isRepairAction: false,
  };
}

/** 一括再分析が終わる（running 以外になる）まで待つ。 */
function waitForFinish(): Promise<NonNullable<BulkState>> {
  return new Promise((resolve) => {
    const unsub = subscribeBulkReanalysis((s) => {
      if (s && s.status !== 'running' && s.finishedAt) {
        queueMicrotask(() => unsub());
        resolve(s);
      }
    });
  });
}

describe('一括再分析', () => {
  beforeEach(() => {
    (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
    analyzeMock.mockReset();
    clearBulkReanalysis();
  });

  it('1件ずつ直列に分析して保存し、判定の変化と直前の分析を残す', async () => {
    const old = buildMockAnalysis({ verdict: undefined, promptVersion: 'v2' });
    await saveRecord(rec('a', { analysis: old }));
    await saveRecord(rec('b'));
    let inFlight = 0;
    let maxInFlight = 0;
    analyzeMock.mockImplementation(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return result('other_more');
    });

    const done = waitForFinish();
    startBulkReanalysis({ recordIds: ['a', 'b'] });
    const state = await done;

    expect(state.status).toBe('done');
    expect(state.done).toBe(2);
    expect(state.failed).toBe(0);
    expect(maxInFlight).toBe(1);
    expect(state.changes.map((c) => [c.recordId, c.before, c.after])).toEqual([
      ['a', undefined, 'other_more'],
      ['b', undefined, 'other_more'],
    ]);
    const a = await getRecord('a');
    expect(a?.status).toBe('ready');
    expect(a?.analysis?.verdict?.leaning).toBe('other_more');
    expect(a?.previousAnalysis?.promptVersion).toBe('v2');
    // 記録の形式がAIへ渡っている
    expect(analyzeMock.mock.calls[0][1].sourceType).toContain('記録者');
  });

  it('1件の失敗では止めずに続け、失敗した記録の既存の分析は失わない', async () => {
    const old = buildMockAnalysis({ verdict: undefined, promptVersion: 'v2' });
    await saveRecord(rec('a', { analysis: old }));
    await saveRecord(rec('b'));
    analyzeMock
      .mockRejectedValueOnce(new ApiError(502, 'analysis_blocked', 'ブロック'))
      .mockResolvedValueOnce(result('user_more'));

    const done = waitForFinish();
    startBulkReanalysis({ recordIds: ['a', 'b'] });
    const state = await done;

    expect(state.status).toBe('done');
    expect(state.failed).toBe(1);
    const a = await getRecord('a');
    expect(a?.status).toBe('ready');
    expect(a?.analysis?.promptVersion).toBe('v2');
    expect((await getRecord('b'))?.analysis?.verdict?.leaning).toBe('user_more');
  });

  it('APIキー未設定など全件に共通する失敗では中断する', async () => {
    await saveRecord(rec('a'));
    await saveRecord(rec('b'));
    analyzeMock.mockRejectedValue(new ApiError(400, 'no_api_key', 'Gemini APIキーが未設定です。'));

    const done = waitForFinish();
    startBulkReanalysis({ recordIds: ['a', 'b'] });
    const state = await done;

    expect(state.status).toBe('aborted');
    expect(state.message).toContain('APIキー');
    expect(analyzeMock).toHaveBeenCalledTimes(1);
    expect((await getRecord('b'))?.status).toBe('ready');
  });

  it('止めると、実行中の1件を終えたところで止まる', async () => {
    await saveRecord(rec('a'));
    await saveRecord(rec('b'));
    analyzeMock.mockImplementation(async () => {
      cancelBulkReanalysis();
      return result('user_more');
    });

    const done = waitForFinish();
    startBulkReanalysis({ recordIds: ['a', 'b'] });
    const state = await done;

    expect(state.status).toBe('cancelled');
    expect(analyzeMock).toHaveBeenCalledTimes(1);
    expect((await getRecord('a'))?.analysis?.verdict?.leaning).toBe('user_more');
  });
});

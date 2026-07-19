import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { recoverStaleProcessingRecords } from './jobs';
import { getRecord, saveRecord } from './db';
import { createEmptyRecord } from './newRecord';

describe('固まった処理中レコードの復旧', () => {
  beforeEach(() => {
    (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
  });

  it('ジョブが存在しない transcribing/analyzing の記録を draft に戻す（データは保持）', async () => {
    const a = { ...createEmptyRecord('voice_recording'), id: 'a', status: 'transcribing' as const };
    const b = {
      ...createEmptyRecord('text'),
      id: 'b',
      status: 'analyzing' as const,
      rawText: '原文は残る',
    };
    const c = { ...createEmptyRecord('text'), id: 'c', status: 'ready' as const };
    await saveRecord(a);
    await saveRecord(b);
    await saveRecord(c);

    const recovered = await recoverStaleProcessingRecords();
    expect(recovered).toBe(2);
    expect((await getRecord('a'))?.status).toBe('draft');
    const rb = await getRecord('b');
    expect(rb?.status).toBe('draft');
    expect(rb?.rawText).toBe('原文は残る');
    expect((await getRecord('c'))?.status).toBe('ready');
  });

  it('復旧対象がなければ何もしない', async () => {
    await saveRecord({ ...createEmptyRecord('text'), id: 'x', status: 'draft' as const });
    expect(await recoverStaleProcessingRecords()).toBe(0);
  });
});

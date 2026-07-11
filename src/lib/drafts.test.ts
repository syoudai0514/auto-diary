import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import {
  saveDraft,
  getDraft,
  listDrafts,
  deleteDraft,
  newDraftId,
  type Draft,
} from './drafts';
import type { Diary } from './diary';

const diary: Diary = {
  title: 'タイトル',
  body: '本文',
  facts: [],
  feelings: [],
  interpretations: [],
  nextActions: [],
  tags: [],
  rawTranscript: '元テキスト',
};

function makeDraft(id: string, updatedAt: string): Draft {
  return { id, createdAt: updatedAt, updatedAt, diary, durationSec: 60 };
}

describe('下書き（IndexedDB）', () => {
  beforeEach(() => {
    // 各テストで DB をリセット
    (globalThis as any).indexedDB = new IDBFactory();
  });

  it('保存した下書きを取得できる（復元）', async () => {
    const d = makeDraft('a', '2026-07-11T00:00:00.000Z');
    await saveDraft(d);
    const restored = await getDraft('a');
    expect(restored).toBeDefined();
    expect(restored?.diary.title).toBe('タイトル');
    expect(restored?.diary.rawTranscript).toBe('元テキスト');
  });

  it('複数保存すると更新日時の新しい順に並ぶ', async () => {
    await saveDraft(makeDraft('old', '2026-07-10T00:00:00.000Z'));
    await saveDraft(makeDraft('new', '2026-07-11T00:00:00.000Z'));
    const list = await listDrafts();
    expect(list.map((d) => d.id)).toEqual(['new', 'old']);
  });

  it('削除できる（保存後に消える）', async () => {
    await saveDraft(makeDraft('x', '2026-07-11T00:00:00.000Z'));
    await deleteDraft('x');
    expect(await getDraft('x')).toBeUndefined();
    expect(await listDrafts()).toHaveLength(0);
  });

  it('newDraftId は毎回異なる', () => {
    expect(newDraftId()).not.toBe(newDraftId());
  });
});

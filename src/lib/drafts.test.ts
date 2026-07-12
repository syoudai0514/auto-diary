import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import {
  saveDraft,
  getDraft,
  listDrafts,
  deleteDraft,
  newDraftId,
  DEFAULT_DRAFT_RETENTION_MS,
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

/** now からの相対時刻（ミリ秒差）で下書きを作る。過去なら負の値を渡す。 */
function makeDraft(id: string, offsetMs: number): Draft {
  const iso = new Date(Date.now() + offsetMs).toISOString();
  return { id, createdAt: iso, updatedAt: iso, diary, durationSec: 60 };
}

describe('下書き（IndexedDB）', () => {
  beforeEach(() => {
    // 各テストで DB をリセット
    (globalThis as any).indexedDB = new IDBFactory();
  });

  it('保存した下書きを取得できる（復元）', async () => {
    const d = makeDraft('a', -1000);
    await saveDraft(d);
    const restored = await getDraft('a');
    expect(restored).toBeDefined();
    expect(restored?.diary.title).toBe('タイトル');
    expect(restored?.diary.rawTranscript).toBe('元テキスト');
  });

  it('複数保存すると更新日時の新しい順に並ぶ', async () => {
    await saveDraft(makeDraft('old', -60 * 60 * 1000));
    await saveDraft(makeDraft('new', -1000));
    const list = await listDrafts();
    expect(list.map((d) => d.id)).toEqual(['new', 'old']);
  });

  it('削除できる（保存後に消える）', async () => {
    await saveDraft(makeDraft('x', -1000));
    await deleteDraft('x');
    expect(await getDraft('x')).toBeUndefined();
    expect(await listDrafts()).toHaveLength(0);
  });

  it('newDraftId は毎回異なる', () => {
    expect(newDraftId()).not.toBe(newDraftId());
  });

  it('既定の保持期間（約1日）を過ぎていない下書きは一覧に残る', async () => {
    await saveDraft(makeDraft('recent', -(DEFAULT_DRAFT_RETENTION_MS - 60 * 60 * 1000)));
    const list = await listDrafts();
    expect(list.map((d) => d.id)).toEqual(['recent']);
  });

  it('保持期間を過ぎた下書きは一覧から消え、実際にも削除される', async () => {
    await saveDraft(makeDraft('expired', -(DEFAULT_DRAFT_RETENTION_MS + 60 * 60 * 1000)));
    const list = await listDrafts();
    expect(list).toHaveLength(0);
    expect(await getDraft('expired')).toBeUndefined();
  });

  it('maxAgeMs を指定すれば保持期間を変更できる', async () => {
    await saveDraft(makeDraft('a', -5000));
    expect(await listDrafts(10000)).toHaveLength(1);
  });

  it('maxAgeMsより古い下書きは一覧から除外され、削除もされる', async () => {
    await saveDraft(makeDraft('b', -5000));
    expect(await listDrafts(1000)).toHaveLength(0);
    expect(await getDraft('b')).toBeUndefined();
  });
});

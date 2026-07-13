import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import {
  saveRecord,
  getRecord,
  listRecords,
  trashRecord,
  hardDeleteRecord,
  listTrash,
  restoreFromTrash,
  saveAttachmentBlob,
  getAttachmentBlob,
  getMeta,
  setMeta,
  getCachedTranscript,
  setCachedTranscript,
  migrateRecord,
  newFactnoteId,
  TRASH_RETENTION_MS,
} from './db';
import { FACTNOTE_SCHEMA_VERSION, type IncidentRecord } from './types';

function makeRecord(id: string, offsetMs = 0): IncidentRecord {
  const iso = new Date(Date.now() + offsetMs).toISOString();
  return {
    id,
    schemaVersion: FACTNOTE_SCHEMA_VERSION,
    createdAt: iso,
    updatedAt: iso,
    sourceType: 'text',
    rawText: '本文',
    people: [],
    childImpactTags: [],
    emotions: [],
    tags: [],
    attachments: [],
    evidenceItems: [],
    diaryVersions: [],
    status: 'draft',
  };
}

describe('事実ノートのローカル保存（IndexedDB）', () => {
  beforeEach(() => {
    (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
  });

  it('保存したレコードを取得できる', async () => {
    await saveRecord(makeRecord('a'));
    const got = await getRecord('a');
    expect(got?.id).toBe('a');
    expect(got?.rawText).toBe('本文');
  });

  it('一覧は作成日時の新しい順で返る', async () => {
    await saveRecord(makeRecord('old', -60_000));
    await saveRecord(makeRecord('new', 0));
    const list = await listRecords();
    expect(list.map((r) => r.id)).toEqual(['new', 'old']);
  });

  it('ゴミ箱へ移動すると一覧から消え、ゴミ箱一覧に入る', async () => {
    await saveRecord(makeRecord('a'));
    await trashRecord('a');
    expect(await listRecords()).toHaveLength(0);
    const trash = await listTrash();
    expect(trash).toHaveLength(1);
    expect(trash[0].record.id).toBe('a');
  });

  it('ゴミ箱から復元できる', async () => {
    await saveRecord(makeRecord('a'));
    await trashRecord('a');
    const restored = await restoreFromTrash('a');
    expect(restored?.id).toBe('a');
    expect(await listRecords()).toHaveLength(1);
    expect(await listTrash()).toHaveLength(0);
  });

  it('保持期間を過ぎたゴミ箱アイテムは自動的に完全削除される', async () => {
    await saveRecord(makeRecord('a'));
    await trashRecord('a');
    // deletedAt を保持期間より過去に書き換える
    const [item] = await listTrash();
    const expired = {
      ...item,
      deletedAt: new Date(Date.now() - TRASH_RETENTION_MS - 1000).toISOString(),
    };
    // trash ストアへ直接上書き（trashRecord は常に現在日時を付けるため）
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('factnote');
      req.onsuccess = () => {
        const db = req.result;
        const t = db.transaction('trash', 'readwrite');
        t.objectStore('trash').put(expired);
        t.oncomplete = () => {
          db.close();
          resolve();
        };
        t.onerror = () => reject(t.error);
      };
      req.onerror = () => reject(req.error);
    });
    expect(await listTrash()).toHaveLength(0);
  });

  it('完全削除でレコードと添付Blobが消える', async () => {
    const record = makeRecord('a');
    record.attachments = [
      { id: 'att1', fileName: 'a.wav', mimeType: 'audio/wav', size: 3, createdAt: record.createdAt },
    ];
    await saveRecord(record);
    await saveAttachmentBlob('att1', new Blob(['abc']));
    expect(await getAttachmentBlob('att1')).toBeDefined();

    await hardDeleteRecord('a');
    expect(await getRecord('a')).toBeUndefined();
    expect(await getAttachmentBlob('att1')).toBeUndefined();
  });

  it('meta と文字起こしキャッシュを保存・取得できる', async () => {
    await setMeta('lastBackupAt', '2026-07-13T00:00:00.000Z');
    expect(await getMeta<string>('lastBackupAt')).toBe('2026-07-13T00:00:00.000Z');

    await setCachedTranscript('hash123', '文字起こし結果');
    expect(await getCachedTranscript('hash123')).toBe('文字起こし結果');
    expect(await getCachedTranscript('unknown')).toBeUndefined();
  });

  it('migrateRecord は欠けた配列フィールドを補完する', () => {
    const partial = {
      id: 'x',
      schemaVersion: 1,
      createdAt: 'c',
      updatedAt: 'u',
      sourceType: 'text',
      status: 'draft',
    } as unknown as IncidentRecord;
    const migrated = migrateRecord(partial);
    expect(migrated.people).toEqual([]);
    expect(migrated.diaryVersions).toEqual([]);
    expect(migrated.schemaVersion).toBe(FACTNOTE_SCHEMA_VERSION);
  });

  it('newFactnoteId は一意なIDを返す', () => {
    expect(newFactnoteId()).not.toBe(newFactnoteId());
  });
});

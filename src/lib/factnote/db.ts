'use client';

import {
  FACTNOTE_SCHEMA_VERSION,
  type IncidentRecord,
} from './types';

/**
 * 事実ノートのローカル保存層（IndexedDB）。`drafts.ts` の openDB/tx パターンを
 * 複数ストアへ拡張したもの。
 *
 * ストア構成（docs/factnote/PLAN.md §2）:
 * - records:     IncidentRecord（Blob以外の全データ。一覧はここだけ読む）
 * - attachments: { id, blob } — 音声・画像の本体。詳細表示時のみ読む
 * - trash:       削除されたレコード（30日保持。P1で復元UI）
 * - meta:        { key, value } — 文字起こしキャッシュ・バックアップ日時など
 *
 * 将来クラウド同期等へ差し替えられるよう、呼び出し側はこのモジュールの
 * 関数だけを使い、IndexedDB API に直接触れないこと（依頼書 §26）。
 */

const DB_NAME = 'factnote';
const DB_VERSION = 1;

const RECORDS = 'records';
const ATTACHMENTS = 'attachments';
const TRASH = 'trash';
const META = 'meta';

interface AttachmentBlobRow {
  id: string;
  blob: Blob;
}

interface MetaRow {
  key: string;
  value: unknown;
}

export interface TrashedRecord {
  record: IncidentRecord;
  /** ゴミ箱へ移動した日時（ISO）。30日で完全削除。 */
  deletedAt: string;
  id: string;
}

/** ゴミ箱の保持期間（依頼書 §27）。 */
export const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      // version 1: 全ストアを新規作成。以降の変更は oldVersion で分岐を足す。
      if (!db.objectStoreNames.contains(RECORDS)) {
        db.createObjectStore(RECORDS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(ATTACHMENTS)) {
        db.createObjectStore(ATTACHMENTS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(TRASH)) {
        db.createObjectStore(TRASH, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(META)) {
        db.createObjectStore(META, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(
  storeName: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDB().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(storeName, mode);
        const store = t.objectStore(storeName);
        const request = fn(store);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        t.oncomplete = () => db.close();
      }),
  );
}

export function newFactnoteId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `fn_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

// ---------------------------------------------------------------------------
// マイグレーション

/**
 * 読み出したレコードを現行スキーマへ前方マイグレーションする。
 * v1 のみの現在は、欠けている配列フィールドの補完だけを行う（防御的）。
 */
export function migrateRecord(raw: IncidentRecord): IncidentRecord {
  return {
    ...raw,
    schemaVersion: FACTNOTE_SCHEMA_VERSION,
    people: raw.people ?? [],
    childImpactTags: raw.childImpactTags ?? [],
    emotions: raw.emotions ?? [],
    tags: raw.tags ?? [],
    attachments: raw.attachments ?? [],
    evidenceItems: raw.evidenceItems ?? [],
    diaryVersions: raw.diaryVersions ?? [],
  };
}

// ---------------------------------------------------------------------------
// records

export async function saveRecord(record: IncidentRecord): Promise<void> {
  await tx(RECORDS, 'readwrite', (store) => store.put(record));
}

export async function getRecord(id: string): Promise<IncidentRecord | undefined> {
  const raw = await tx<IncidentRecord | undefined>(
    RECORDS,
    'readonly',
    (store) => store.get(id) as IDBRequest<IncidentRecord | undefined>,
  );
  return raw ? migrateRecord(raw) : undefined;
}

/** 全レコードを作成日時の新しい順で返す。 */
export async function listRecords(): Promise<IncidentRecord[]> {
  const all = await tx<IncidentRecord[]>(
    RECORDS,
    'readonly',
    (store) => store.getAll() as IDBRequest<IncidentRecord[]>,
  );
  return (all ?? []).map(migrateRecord).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

/**
 * レコードをゴミ箱へ移動する（添付Blobは残す — 復元可能にするため）。
 * 完全削除は emptyTrashItem / hardDeleteRecord で行う。
 */
export async function trashRecord(id: string): Promise<void> {
  const record = await getRecord(id);
  if (!record) return;
  const item: TrashedRecord = { id, record, deletedAt: new Date().toISOString() };
  await tx(TRASH, 'readwrite', (store) => store.put(item));
  await tx(RECORDS, 'readwrite', (store) => store.delete(id));
}

/** レコードと、そのレコードだけが参照する添付Blobを完全に削除する。 */
export async function hardDeleteRecord(id: string): Promise<void> {
  const record = (await getRecord(id)) ?? (await getTrashedRecord(id))?.record;
  await tx(RECORDS, 'readwrite', (store) => store.delete(id));
  await tx(TRASH, 'readwrite', (store) => store.delete(id));
  if (record) {
    for (const att of record.attachments) {
      await deleteAttachmentBlob(att.id);
    }
  }
}

// ---------------------------------------------------------------------------
// trash

export async function getTrashedRecord(id: string): Promise<TrashedRecord | undefined> {
  return tx<TrashedRecord | undefined>(
    TRASH,
    'readonly',
    (store) => store.get(id) as IDBRequest<TrashedRecord | undefined>,
  );
}

/** ゴミ箱一覧（削除日時の新しい順）。保持期間を過ぎたものは自動的に完全削除する。 */
export async function listTrash(): Promise<TrashedRecord[]> {
  const all = await tx<TrashedRecord[]>(
    TRASH,
    'readonly',
    (store) => store.getAll() as IDBRequest<TrashedRecord[]>,
  );
  const items = all ?? [];
  const cutoff = Date.now() - TRASH_RETENTION_MS;
  const fresh: TrashedRecord[] = [];
  for (const item of items) {
    const deletedAtMs = Date.parse(item.deletedAt);
    if (Number.isFinite(deletedAtMs) && deletedAtMs < cutoff) {
      await hardDeleteRecord(item.id);
    } else {
      fresh.push(item);
    }
  }
  return fresh.sort((a, b) => (a.deletedAt < b.deletedAt ? 1 : -1));
}

/** ゴミ箱からレコードを復元する。 */
export async function restoreFromTrash(id: string): Promise<IncidentRecord | undefined> {
  const item = await getTrashedRecord(id);
  if (!item) return undefined;
  await saveRecord(item.record);
  await tx(TRASH, 'readwrite', (store) => store.delete(id));
  return migrateRecord(item.record);
}

// ---------------------------------------------------------------------------
// attachments（Blob本体）

export async function saveAttachmentBlob(id: string, blob: Blob): Promise<void> {
  const row: AttachmentBlobRow = { id, blob };
  await tx(ATTACHMENTS, 'readwrite', (store) => store.put(row));
}

export async function getAttachmentBlob(id: string): Promise<Blob | undefined> {
  const row = await tx<AttachmentBlobRow | undefined>(
    ATTACHMENTS,
    'readonly',
    (store) => store.get(id) as IDBRequest<AttachmentBlobRow | undefined>,
  );
  return row?.blob;
}

export async function deleteAttachmentBlob(id: string): Promise<void> {
  await tx(ATTACHMENTS, 'readwrite', (store) => store.delete(id));
}

// ---------------------------------------------------------------------------
// meta（文字起こしキャッシュ・バックアップ日時など）

export async function setMeta(key: string, value: unknown): Promise<void> {
  const row: MetaRow = { key, value };
  await tx(META, 'readwrite', (store) => store.put(row));
}

export async function getMeta<T>(key: string): Promise<T | undefined> {
  const row = await tx<MetaRow | undefined>(
    META,
    'readonly',
    (store) => store.get(key) as IDBRequest<MetaRow | undefined>,
  );
  return row?.value as T | undefined;
}

export async function deleteMeta(key: string): Promise<void> {
  await tx(META, 'readwrite', (store) => store.delete(key));
}

/** 同一音声の文字起こしキャッシュ（依頼書 §22.2。キーは Blob の SHA-256）。 */
export async function getCachedTranscript(sha256: string): Promise<string | undefined> {
  return getMeta<string>(`transcript:${sha256}`);
}

export async function setCachedTranscript(sha256: string, transcript: string): Promise<void> {
  await setMeta(`transcript:${sha256}`, transcript);
}

/** 最終バックアップ日時（ISO）。 */
export const META_LAST_BACKUP_AT = 'lastBackupAt';
/** サンプルデータ投入済みフラグ。 */
export const META_SAMPLE_LOADED = 'sampleDataLoaded';

// ---------------------------------------------------------------------------
// ストレージ永続化（iOS の IndexedDB 退避対策。依頼書 §21/§26）

export type PersistState = 'granted' | 'denied' | 'unsupported';

/** `navigator.storage.persist()` を要求し、結果を返す。初回起動時に呼ぶ。 */
export async function requestPersistentStorage(): Promise<PersistState> {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.persist) return 'unsupported';
    const granted = await navigator.storage.persist();
    return granted ? 'granted' : 'denied';
  } catch {
    return 'unsupported';
  }
}

/** 現在の永続化状態を（要求せずに）確認する。 */
export async function getPersistState(): Promise<PersistState> {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.persisted) return 'unsupported';
    return (await navigator.storage.persisted()) ? 'granted' : 'denied';
  } catch {
    return 'unsupported';
  }
}

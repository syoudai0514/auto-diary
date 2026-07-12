'use client';

import type { Diary } from './diary';

/**
 * 未保存の日記下書きを IndexedDB に保存する。
 * DB は初期版では日記の本保存には使わない。「まだ外部保存していない下書き」だけを
 * 端末内に退避し、ブラウザを閉じたり通信が切れても入力が消えないようにする。
 */

const DB_NAME = 'voice-diary';
const DB_VERSION = 1;
const STORE = 'drafts';

export interface Draft {
  id: string;
  createdAt: string; // ISO
  updatedAt: string; // ISO
  diary: Diary;
  /** 録音時間（秒）。表示用。 */
  durationSec?: number;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDB().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const store = t.objectStore(STORE);
        const request = fn(store);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        t.oncomplete = () => db.close();
      }),
  );
}

export function newDraftId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `d_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

export async function saveDraft(draft: Draft): Promise<void> {
  await tx('readwrite', (store) => store.put(draft));
}

export async function getDraft(id: string): Promise<Draft | undefined> {
  return tx<Draft | undefined>('readonly', (store) => store.get(id) as IDBRequest<Draft | undefined>);
}

export async function deleteDraft(id: string): Promise<void> {
  await tx('readwrite', (store) => store.delete(id));
}

/**
 * 下書きを保持しておく期間。保存操作（ショートカット起動等）は成功したか
 * この端末からは確認できず、複数のアプリへ保存し直すこともあるため、
 * 保存後もすぐには削除せずこの期間だけ「最近の記録」に残す。
 */
export const DEFAULT_DRAFT_RETENTION_MS = 24 * 60 * 60 * 1000;

/**
 * 保存済みの下書き一覧を、更新日時の新しい順で返す。
 * 作成から maxAgeMs を過ぎた下書きは自動的に削除して一覧から除く。
 */
export async function listDrafts(maxAgeMs: number = DEFAULT_DRAFT_RETENTION_MS): Promise<Draft[]> {
  const all = await tx<Draft[]>('readonly', (store) => store.getAll() as IDBRequest<Draft[]>);
  const drafts = all ?? [];
  const cutoff = Date.now() - maxAgeMs;
  const fresh: Draft[] = [];
  const expiredIds: string[] = [];
  for (const d of drafts) {
    const createdAtMs = Date.parse(d.createdAt);
    if (Number.isFinite(createdAtMs) && createdAtMs < cutoff) {
      expiredIds.push(d.id);
    } else {
      fresh.push(d);
    }
  }
  if (expiredIds.length > 0) {
    await Promise.all(expiredIds.map((id) => deleteDraft(id)));
  }
  return fresh.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

'use client';

import { buildBackupBlob } from './exportData';
import { deleteMeta, getMeta, META_LAST_BACKUP_AT, setMeta } from './db';

/**
 * フォルダを一度指定すると、以降そこへ自動でバックアップJSONを書き込む機能。
 *
 * 仕組み: File System Access API（`showDirectoryPicker`）でユーザーが選んだ
 * フォルダのハンドルを IndexedDB に保存し、データ変更時・アプリ起動時・離脱時に
 * 同じファイル名で上書き保存する。iCloud Drive 内のフォルダを選べば、OS が
 * そのフォルダを iCloud へ同期するため「指定したら常にそこ（iCloud）へ保存」が
 * 実現できる。
 *
 * 対応状況（正直に）:
 * - デスクトップの Chrome / Edge / Brave 等: 対応（本当の自動保存）。
 * - iOS / iPadOS の Safari（iPhone・iPad）: File System Access API 非対応。
 *   Apple がブラウザからのフォルダ自動書き込みを許可していないため、
 *   どのWebアプリでも自動保存はできない。iPhone では設定の「共有して保存」で
 *   iCloud Drive を選ぶ手動バックアップを使う。
 */

const META_DIR_HANDLE = 'autoBackupDirHandle';
/** 上書き保存するためファイル名は固定（毎回同じファイルを更新する）。 */
const BACKUP_FILE_NAME = '事実ノート-backup.json';

// File System Access API の最小型（標準 lib.dom に無いメンバを補う。依存追加はしない）。
type PermissionOpts = { mode?: 'read' | 'readwrite' };
interface FsFileHandle {
  createWritable: () => Promise<{ write: (data: Blob) => Promise<void>; close: () => Promise<void> }>;
}
interface FsDirHandle {
  name: string;
  getFileHandle: (name: string, opts?: { create?: boolean }) => Promise<FsFileHandle>;
  queryPermission?: (opts?: PermissionOpts) => Promise<PermissionState>;
  requestPermission?: (opts?: PermissionOpts) => Promise<PermissionState>;
}
type PickerWindow = Window & {
  showDirectoryPicker?: (opts?: { mode?: 'read' | 'readwrite' }) => Promise<FsDirHandle>;
};

export type AutoBackupResult =
  | 'written' // 書き込み成功
  | 'no_dir' // フォルダ未設定
  | 'needs_permission' // フォルダはあるが権限を再許可する必要がある（ユーザー操作が必要）
  | 'unsupported' // このブラウザは非対応（iPhone 等）
  | 'error';

/** このブラウザでフォルダ自動保存が使えるか。 */
export function supportsDirectoryAutoBackup(): boolean {
  return typeof window !== 'undefined' && typeof (window as PickerWindow).showDirectoryPicker === 'function';
}

async function loadDirHandle(): Promise<FsDirHandle | null> {
  try {
    return (await getMeta<FsDirHandle>(META_DIR_HANDLE)) ?? null;
  } catch {
    return null;
  }
}

async function permissionState(handle: FsDirHandle): Promise<PermissionState> {
  if (!handle.queryPermission) return 'granted';
  try {
    return await handle.queryPermission({ mode: 'readwrite' });
  } catch {
    return 'denied';
  }
}

async function writeToDir(handle: FsDirHandle): Promise<void> {
  const blob = await buildBackupBlob();
  const fileHandle = await handle.getFileHandle(BACKUP_FILE_NAME, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();
  await setMeta(META_LAST_BACKUP_AT, new Date().toISOString());
}

/**
 * 保存先フォルダを選ぶ（ユーザー操作から呼ぶこと）。
 * 選択直後に初回バックアップを書き込み、フォルダ名を返す。
 */
export async function chooseAutoBackupDirectory(): Promise<string> {
  const picker = (window as PickerWindow).showDirectoryPicker;
  if (!picker) throw new Error('unsupported');
  const handle = await picker({ mode: 'readwrite' });
  // 書き込み権限を確実に取得
  if (handle.requestPermission) {
    const state = await handle.requestPermission({ mode: 'readwrite' });
    if (state !== 'granted') throw new Error('permission_denied');
  }
  await setMeta(META_DIR_HANDLE, handle);
  await writeToDir(handle);
  return handle.name;
}

/** 設定済みの保存先フォルダ名（未設定なら null）。 */
export async function getAutoBackupDirName(): Promise<string | null> {
  const handle = await loadDirHandle();
  return handle?.name ?? null;
}

/** 保存先フォルダの設定を解除する（自動保存を止める）。 */
export async function clearAutoBackupDirectory(): Promise<void> {
  await deleteMeta(META_DIR_HANDLE);
}

/**
 * 権限が生きていれば自動でバックアップを書き込む（ユーザー操作なしで呼べる）。
 * 権限が切れている場合は書き込まず 'needs_permission' を返す
 * （再許可にはユーザー操作が必要なため）。
 */
export async function maybeAutoBackup(): Promise<AutoBackupResult> {
  if (!supportsDirectoryAutoBackup()) return 'unsupported';
  const handle = await loadDirHandle();
  if (!handle) return 'no_dir';
  const state = await permissionState(handle);
  if (state !== 'granted') return 'needs_permission';
  try {
    await writeToDir(handle);
    return 'written';
  } catch {
    return 'error';
  }
}

/**
 * 権限が切れているときに再許可して書き込む（ユーザー操作から呼ぶこと）。
 * 成功でフォルダ名を返す。
 */
export async function resumeAutoBackup(): Promise<string> {
  const handle = await loadDirHandle();
  if (!handle) throw new Error('no_dir');
  if (handle.requestPermission) {
    const state = await handle.requestPermission({ mode: 'readwrite' });
    if (state !== 'granted') throw new Error('permission_denied');
  }
  await writeToDir(handle);
  return handle.name;
}

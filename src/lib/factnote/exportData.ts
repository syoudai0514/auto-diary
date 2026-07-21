'use client';

import { FACTNOTE_EXPORT_PREFIX } from './appConfig';
import {
  getMeta,
  listFlatChecks,
  listFutureMemos,
  listPersons,
  listRecords,
  META_LAST_BACKUP_AT,
  setMeta,
} from './db';
import { loadFactnoteProfile, type FactnoteProfile } from './profile';
import {
  FACTNOTE_SCHEMA_VERSION,
  type FlatCheckResult,
  type FutureSelfMemo,
  type IncidentRecord,
  type PersonProfile,
} from './types';

/**
 * JSON一括エクスポート（依頼書 §26 の P0 範囲 + 長期分析データ）。
 * 添付Blobは含まない（P1のZIPバックアップで対応）。
 */

export interface FactnoteExport {
  app: 'factnote';
  schemaVersion: number;
  exportedAt: string; // ISO
  recordCount: number;
  records: IncidentRecord[];
  /** 長期分析データ（客観カルテの人物・未来メモ・フラットチェック履歴）。 */
  persons?: PersonProfile[];
  futureMemos?: FutureSelfMemo[];
  flatChecks?: FlatCheckResult[];
  /** プロフィール（自分の立場・家族構成）。 */
  profile?: FactnoteProfile;
}

/** エクスポート用のデータを組み立てる（純粋関数。テスト対象）。 */
export function buildExportPayload(
  records: IncidentRecord[],
  now: Date = new Date(),
  extras?: {
    persons?: PersonProfile[];
    futureMemos?: FutureSelfMemo[];
    flatChecks?: FlatCheckResult[];
    profile?: FactnoteProfile;
  },
): FactnoteExport {
  return {
    app: 'factnote',
    schemaVersion: FACTNOTE_SCHEMA_VERSION,
    exportedAt: now.toISOString(),
    recordCount: records.length,
    records,
    persons: extras?.persons ?? [],
    futureMemos: extras?.futureMemos ?? [],
    flatChecks: extras?.flatChecks ?? [],
    profile: extras?.profile,
  };
}

export function exportFileName(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${FACTNOTE_EXPORT_PREFIX}-export-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}.json`;
}

async function collectExportBlob(): Promise<{ blob: Blob; count: number; fileName: string }> {
  const [records, persons, futureMemos, flatChecks, profile] = await Promise.all([
    listRecords(),
    listPersons().catch(() => []),
    listFutureMemos().catch(() => []),
    listFlatChecks().catch(() => []),
    loadFactnoteProfile().catch(() => undefined),
  ]);
  const payload = buildExportPayload(records, new Date(), {
    persons,
    futureMemos,
    flatChecks,
    profile,
  });
  return {
    blob: new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
    count: records.length,
    fileName: exportFileName(),
  };
}

/** バックアップ内容の Blob を作る（フォルダ自動保存 autoBackup.ts から使う）。 */
export async function buildBackupBlob(): Promise<Blob> {
  return (await collectExportBlob()).blob;
}

/** 最終バックアップ日時（ISO。未実施なら undefined）。 */
export async function loadLastBackupAt(): Promise<string | undefined> {
  return getMeta<string>(META_LAST_BACKUP_AT).catch(() => undefined);
}

/** バックアップが古い（この期間以上前 or 未実施）か。既定3日。 */
export async function isBackupStale(maxAgeMs = 3 * 24 * 60 * 60 * 1000): Promise<boolean> {
  const last = await loadLastBackupAt();
  if (!last) return true;
  const t = Date.parse(last);
  return !Number.isFinite(t) || Date.now() - t > maxAgeMs;
}

/** Blob を指定ファイル名でダウンロードする（共通）。 */
function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } finally {
    // click 直後の revoke は一部ブラウザでダウンロード失敗するため遅延させる
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}

/** 全記録と長期分析データをJSONファイルとしてダウンロードし、最終バックアップ日時を更新する。 */
export async function exportAllAsJson(): Promise<number> {
  const { blob, count, fileName } = await collectExportBlob();
  downloadBlob(blob, fileName);
  await setMeta(META_LAST_BACKUP_AT, new Date().toISOString());
  return count;
}

function markdownFileName(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${FACTNOTE_EXPORT_PREFIX}-export-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}.md`;
}

/**
 * 全記録を Markdown で書き出す（他のAI・エディタで内容を分析しやすい形式）。
 * 共有シートが使える端末では共有（iCloud等に保存可）、なければダウンロード。
 * バックアップ日時は更新しない（JSONと違い完全な復元用データではないため）。
 */
export async function exportAllAsMarkdown(): Promise<{ count: number; shared: boolean }> {
  const { recordsToMarkdown } = await import('./markdown');
  const records = await listRecords();
  const md = recordsToMarkdown(records);
  const fileName = markdownFileName();
  const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });

  if (canShareBackup()) {
    const file = new File([blob], fileName, { type: 'text/markdown' });
    try {
      await navigator.share({ files: [file], title: '事実ノート（Markdown）' });
      return { count: records.length, shared: true };
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') {
        return { count: records.length, shared: false };
      }
      // 共有不可ならダウンロードにフォールバック
    }
  }
  downloadBlob(blob, fileName);
  return { count: records.length, shared: false };
}

/** 1件の記録を Markdown で書き出す（記録詳細から使う）。 */
export async function exportRecordAsMarkdown(record: IncidentRecord): Promise<{ shared: boolean }> {
  const { recordToMarkdown } = await import('./markdown');
  const md = recordToMarkdown(record);
  const safeTitle = (record.title || '無題の記録').replace(/[\\/:*?"<>|]/g, '_').slice(0, 40);
  const fileName = `${FACTNOTE_EXPORT_PREFIX}-${safeTitle}.md`;
  const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });

  if (canShareBackup()) {
    const file = new File([blob], fileName, { type: 'text/markdown' });
    try {
      await navigator.share({ files: [file], title: record.title || '事実ノート' });
      return { shared: true };
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return { shared: false };
    }
  }
  downloadBlob(blob, fileName);
  return { shared: false };
}

/** この端末でファイル共有（共有シート）が使えるか。 */
export function canShareBackup(): boolean {
  if (typeof navigator === 'undefined' || typeof navigator.share !== 'function') return false;
  try {
    const probe = new File(['{}'], 'probe.json', { type: 'application/json' });
    return typeof navigator.canShare !== 'function' || navigator.canShare({ files: [probe] });
  } catch {
    return false;
  }
}

/**
 * 共有シート経由のバックアップ（iOSでは「"ファイル"に保存」→ iCloud Drive を選べる）。
 * 自動でiCloudへ書き込むAPIはブラウザに存在しないため、これが最短の手段。
 * ユーザーが共有をキャンセルした場合は false を返し、バックアップ日時は更新しない。
 */
export async function shareBackupJson(): Promise<{ shared: boolean; count: number }> {
  const { blob, count, fileName } = await collectExportBlob();
  const file = new File([blob], fileName, { type: 'application/json' });
  try {
    await navigator.share({ files: [file], title: '事実ノートのバックアップ' });
  } catch (e) {
    // キャンセル（AbortError）や非対応。ダウンロードにはフォールバックしない
    if (e instanceof DOMException && e.name === 'AbortError') return { shared: false, count };
    throw e;
  }
  await setMeta(META_LAST_BACKUP_AT, new Date().toISOString());
  return { shared: true, count };
}

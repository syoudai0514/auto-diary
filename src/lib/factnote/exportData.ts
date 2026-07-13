'use client';

import { FACTNOTE_EXPORT_PREFIX } from './appConfig';
import { listRecords, META_LAST_BACKUP_AT, setMeta } from './db';
import { FACTNOTE_SCHEMA_VERSION, type IncidentRecord } from './types';

/**
 * JSON一括エクスポート（依頼書 §26 の P0 範囲）。
 * 添付Blobは含まない（P1のZIPバックアップで対応）。
 */

export interface FactnoteExport {
  app: 'factnote';
  schemaVersion: number;
  exportedAt: string; // ISO
  recordCount: number;
  records: IncidentRecord[];
}

/** エクスポート用のデータを組み立てる（純粋関数。テスト対象）。 */
export function buildExportPayload(records: IncidentRecord[], now: Date = new Date()): FactnoteExport {
  return {
    app: 'factnote',
    schemaVersion: FACTNOTE_SCHEMA_VERSION,
    exportedAt: now.toISOString(),
    recordCount: records.length,
    records,
  };
}

export function exportFileName(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${FACTNOTE_EXPORT_PREFIX}-export-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}.json`;
}

/** 全記録をJSONファイルとしてダウンロードし、最終バックアップ日時を更新する。 */
export async function exportAllAsJson(): Promise<number> {
  const records = await listRecords();
  const payload = buildExportPayload(records);
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = exportFileName();
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } finally {
    // click 直後の revoke は一部ブラウザでダウンロード失敗するため遅延させる
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
  await setMeta(META_LAST_BACKUP_AT, new Date().toISOString());
  return records.length;
}

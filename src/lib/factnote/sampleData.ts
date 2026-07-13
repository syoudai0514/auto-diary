'use client';

import { buildSampleRecords, SAMPLE_ID_PREFIX } from './fixtures';
import { getMeta, hardDeleteRecord, listRecords, META_SAMPLE_LOADED, saveRecord, setMeta } from './db';

/**
 * 開発・画面確認用のサンプルデータ投入（依頼書 §33）。
 * 設定画面から手動で投入・削除する。本番でも誤って混ざらないよう、
 * サンプルのレコードIDは固定プレフィックス付き。
 */

export async function isSampleDataLoaded(): Promise<boolean> {
  return (await getMeta<boolean>(META_SAMPLE_LOADED)) === true;
}

export async function loadSampleData(): Promise<number> {
  const records = buildSampleRecords();
  for (const record of records) {
    await saveRecord(record);
  }
  await setMeta(META_SAMPLE_LOADED, true);
  return records.length;
}

export async function removeSampleData(): Promise<number> {
  const all = await listRecords();
  const samples = all.filter((r) => r.id.startsWith(SAMPLE_ID_PREFIX));
  for (const record of samples) {
    await hardDeleteRecord(record.id);
  }
  await setMeta(META_SAMPLE_LOADED, false);
  return samples.length;
}

'use client';

import { ApiError } from '../api';
import { expandToChunks, MAX_CLIENT_AUDIO_BYTES } from '../audioChunk';
import { combineTranscripts } from '../format';
import { withRetryOn429 } from '../retry';
import {
  factnoteAnalyzeApi,
  factnoteTranscribeAudio,
  sha256OfBlob,
  type FactnoteAnalyzeResult,
} from './api';
import { getCachedTranscript, getRecord, listRecords, saveRecord, setCachedTranscript } from './db';
import { applyAnalysisResult, describeSourceType, recordToContext, sourceTextOf } from './newRecord';
import type { IncidentContext } from './prompts/incidentAnalysis';
import type { IncidentRecord, VerdictLeaning } from './types';

/**
 * バックグラウンドジョブランナー（文字起こし・分析）。
 *
 * モジュールスコープのシングルトンなので、アプリ内で別の画面へ移動しても
 * 処理は継続し、進捗・完了は subscribeFactnoteJobs で購読できる。
 * 各段階の成果（原本・文字起こし・分析）は完了した時点で IndexedDB へ
 * 保存されるため、途中で購読者がいなくなっても結果は失われない。
 *
 * 制約（正直に）: ブラウザのJavaScriptはタブが生きている間だけ動く。
 * アプリ内の画面移動はOKだが、画面ロックや他アプリへの切り替え中は
 * OSに中断されることがある。その場合も原本と完了済みの文字起こしは
 * 保存済みなので、開き直して再試行すれば途中から再開できる
 * （文字起こしキャッシュにより同じ音声の再送はAPIを消費しない）。
 */

export interface FactnoteJob {
  recordId: string;
  kind: 'transcribe' | 'analyze';
  /** 音声の分割準備中か。 */
  preparing: boolean;
  progress: { current: number; total: number };
}

export type FactnoteJobEvent =
  | { type: 'progress'; job: FactnoteJob }
  | {
      type: 'done';
      job: FactnoteJob;
      record: IncidentRecord;
      /** kind='transcribe' のとき: 結合済み文字起こし（空文字=無音）。 */
      transcript?: string;
      /** kind='analyze' のとき: 分析結果。 */
      result?: FactnoteAnalyzeResult;
    }
  | { type: 'error'; job: FactnoteJob; message: string };

type Listener = (event: FactnoteJobEvent) => void;

const jobs = new Map<string, FactnoteJob>();
const listeners = new Set<Listener>();
const cancelledIds = new Set<string>();

export function subscribeFactnoteJobs(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getFactnoteJob(recordId: string): FactnoteJob | undefined {
  return jobs.get(recordId);
}

export function hasActiveFactnoteJobs(): boolean {
  return jobs.size > 0;
}

/**
 * ジョブのキャンセルを要求する。実行中のリクエストは止められないが、
 * 次の区切り（チャンク間・応答受領後）で反映を中止し status を draft に戻す。
 */
export function cancelFactnoteJob(recordId: string): void {
  if (jobs.has(recordId)) cancelledIds.add(recordId);
}

function emit(event: FactnoteJobEvent): void {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch {
      /* リスナーの失敗はジョブに影響させない */
    }
  }
}

async function persistRecord(
  recordId: string,
  mut: (r: IncidentRecord) => IncidentRecord,
): Promise<IncidentRecord | undefined> {
  const record = await getRecord(recordId);
  if (!record) return undefined;
  const next = mut({ ...record, updatedAt: new Date().toISOString() });
  await saveRecord(next);
  return next;
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

export interface TranscribeJobOptions {
  /** 対象レコードID。原本（添付Blob）保存・status='transcribing' 済みであること。 */
  recordId: string;
  items: Array<{ blob: Blob; filename: string }>;
  peopleContext?: string;
}

/** 文字起こしジョブを開始する（既に同レコードのジョブがあればそれを返す）。 */
export function startTranscribeJob(opts: TranscribeJobOptions): FactnoteJob {
  const existing = jobs.get(opts.recordId);
  if (existing) return existing;

  const job: FactnoteJob = {
    recordId: opts.recordId,
    kind: 'transcribe',
    preparing: false,
    progress: { current: 0, total: 0 },
  };
  jobs.set(opts.recordId, job);
  cancelledIds.delete(opts.recordId);

  void (async () => {
    try {
      // 1) チャンク分割（直列。依頼書 §2-2）
      const needsExpansion = opts.items.some((it) => it.blob.size > MAX_CLIENT_AUDIO_BYTES);
      if (needsExpansion) {
        job.preparing = true;
        emit({ type: 'progress', job });
      }
      const expanded: Array<Array<{ blob: Blob; filename: string }>> = [];
      for (const item of opts.items) {
        expanded.push(await expandToChunks(item.blob, item.filename));
      }
      job.preparing = false;

      const totalChunks = expanded.reduce((acc, chunks) => acc + chunks.length, 0);
      job.progress = { current: 0, total: totalChunks };
      emit({ type: 'progress', job });

      // 2) 原本ごとに: キャッシュ確認 → チャンクを直列で文字起こし
      const sourceTexts: string[] = [];
      let done = 0;
      for (let i = 0; i < opts.items.length; i++) {
        if (cancelledIds.has(opts.recordId)) {
          await persistRecord(opts.recordId, (r) => ({ ...r, status: 'draft' }));
          return;
        }
        const hash = await sha256OfBlob(opts.items[i].blob).catch(() => null);
        const cached = hash ? await getCachedTranscript(hash) : undefined;
        if (cached) {
          done += expanded[i].length;
          job.progress = { current: done, total: totalChunks };
          emit({ type: 'progress', job });
          sourceTexts.push(cached);
          continue;
        }
        const parts: string[] = [];
        for (const chunk of expanded[i]) {
          if (cancelledIds.has(opts.recordId)) {
            await persistRecord(opts.recordId, (r) => ({ ...r, status: 'draft' }));
            return;
          }
          done += 1;
          job.progress = { current: done, total: totalChunks };
          emit({ type: 'progress', job });
          parts.push(
            await withRetryOn429(() =>
              factnoteTranscribeAudio(chunk.blob, chunk.filename, opts.peopleContext),
            ),
          );
        }
        const combined = combineTranscripts(parts);
        sourceTexts.push(combined);
        if (hash && combined) await setCachedTranscript(hash, combined);
      }

      // 3) 文字起こしを必ず保存してから完了を通知（依頼書 §11）
      const transcript = combineTranscripts(sourceTexts);
      const record = await persistRecord(opts.recordId, (r) => ({
        ...r,
        transcript: transcript.trim() ? transcript : r.transcript,
        status: 'draft',
      }));
      if (record) emit({ type: 'done', job, record, transcript });
    } catch (err) {
      await persistRecord(opts.recordId, (r) => ({ ...r, status: 'draft' }));
      emit({ type: 'error', job, message: errorMessage(err, '文字起こしに失敗しました。') });
    } finally {
      jobs.delete(opts.recordId);
      cancelledIds.delete(opts.recordId);
    }
  })();

  return job;
}

export interface AnalyzeJobOptions {
  /** 対象レコードID。補足情報の反映・status='analyzing' 済みであること。 */
  recordId: string;
  context: IncidentContext;
  peopleContext?: string;
}

/** 分析ジョブを開始する（既に同レコードのジョブがあればそれを返す）。 */
export function startAnalyzeJob(opts: AnalyzeJobOptions): FactnoteJob {
  const existing = jobs.get(opts.recordId);
  if (existing) return existing;
  const job = registerAnalyzeJob(opts.recordId);
  void runAnalyze(job, opts).catch(() => undefined);
  return job;
}

function registerAnalyzeJob(recordId: string): FactnoteJob {
  const job: FactnoteJob = {
    recordId,
    kind: 'analyze',
    preparing: false,
    progress: { current: 0, total: 0 },
  };
  jobs.set(recordId, job);
  cancelledIds.delete(recordId);
  return job;
}

/**
 * 分析を1件実行する。成功したら反映済みレコードを返し、失敗は例外で返す
 * （単発の分析では購読者へ error イベントで伝え、一括再分析では呼び出し側が集計する）。
 */
async function runAnalyze(
  job: FactnoteJob,
  opts: AnalyzeJobOptions & { maxRetries429?: number },
): Promise<IncidentRecord | undefined> {
  try {
    const current = await getRecord(opts.recordId);
    const sourceText = current ? sourceTextOf(current) : '';
    if (!current || !sourceText) {
      await persistRecord(opts.recordId, (r) => ({ ...r, status: 'draft' }));
      throw new ApiError(400, 'empty_source', '分析する内容がありません。');
    }
    const context = { ...opts.context, sourceType: opts.context.sourceType ?? describeSourceType(current) };
    const result = await withRetryOn429(
      () => factnoteAnalyzeApi(sourceText, context, opts.peopleContext),
      opts.maxRetries429,
    );
    if (cancelledIds.has(opts.recordId)) {
      // キャンセル済みなら結果を反映しない（原本と文字起こしは保持。分析済みなら元の状態に戻す）
      await persistRecord(opts.recordId, (r) => ({ ...r, status: r.analysis ? 'ready' : 'draft' }));
      return undefined;
    }
    const record = await persistRecord(opts.recordId, (r) => applyAnalysisResult(r, result));
    if (record) emit({ type: 'done', job, record, result });
    return record;
  } catch (err) {
    // 既存の分析がある記録は ready に戻す（再分析の失敗で分析済みの状態を失わない）
    await persistRecord(opts.recordId, (r) => ({ ...r, status: r.analysis ? 'ready' : 'draft' }));
    emit({ type: 'error', job, message: errorMessage(err, '分析に失敗しました。') });
    throw err;
  } finally {
    jobs.delete(opts.recordId);
    cancelledIds.delete(opts.recordId);
  }
}

// ---------------------------------------------------------------------------
// 一括再分析（全体の見解画面から実行）

export interface BulkChange {
  recordId: string;
  title: string;
  before?: VerdictLeaning;
  after?: VerdictLeaning;
}

export interface BulkReanalysisState {
  status: 'running' | 'done' | 'cancelled' | 'aborted';
  total: number;
  done: number;
  failed: number;
  currentTitle?: string;
  /** 判定が付いた/変わった記録（新しい判定の記録全件。before が無いのは旧基準・未分析）。 */
  changes: BulkChange[];
  /** 中断した理由（aborted のとき）。 */
  message?: string;
  startedAt: string;
  finishedAt?: string;
}

type BulkListener = (state: BulkReanalysisState | null) => void;

let bulkState: BulkReanalysisState | null = null;
let bulkCancel = false;
const bulkListeners = new Set<BulkListener>();

function emitBulk(): void {
  const snapshot = bulkState ? { ...bulkState, changes: [...bulkState.changes] } : null;
  for (const l of bulkListeners) {
    try {
      l(snapshot);
    } catch {
      /* ignore */
    }
  }
}

export function subscribeBulkReanalysis(listener: BulkListener): () => void {
  bulkListeners.add(listener);
  listener(bulkState ? { ...bulkState, changes: [...bulkState.changes] } : null);
  return () => bulkListeners.delete(listener);
}

export function getBulkReanalysis(): BulkReanalysisState | null {
  return bulkState;
}

/** 完了・中断後の結果表示を閉じる。 */
export function clearBulkReanalysis(): void {
  if (bulkState?.status === 'running') return;
  bulkState = null;
  emitBulk();
}

/** 次の記録へ進む前に止める（実行中の1件は完了まで待つ）。 */
export function cancelBulkReanalysis(): void {
  if (bulkState?.status === 'running') bulkCancel = true;
}

/** 再試行しても直らない、全件に共通する失敗（APIキー未設定・ログイン切れ等）。 */
function isFatalForBulk(err: unknown): boolean {
  if (!(err instanceof ApiError)) return false;
  return err.status === 401 || err.status === 403 || err.code === 'no_api_key' || err.status === 0;
}

/** 画面の自動ロックを抑止する（対応ブラウザのみ。iOS Safari 16.4+）。 */
async function requestWakeLock(): Promise<{ release: () => Promise<void> } | null> {
  try {
    const nav = navigator as Navigator & {
      wakeLock?: { request: (type: 'screen') => Promise<{ release: () => Promise<void> }> };
    };
    return nav.wakeLock ? await nav.wakeLock.request('screen') : null;
  } catch {
    return null;
  }
}

/**
 * 指定した記録を古い順に1件ずつ再分析する（直列。依頼書 §2-2）。
 * 1件ごとに結果を保存するので、途中で止めても完了分は残る。
 */
export function startBulkReanalysis(opts: { recordIds: string[]; peopleContext?: string }): void {
  if (bulkState?.status === 'running' || opts.recordIds.length === 0) return;
  bulkCancel = false;
  bulkState = {
    status: 'running',
    total: opts.recordIds.length,
    done: 0,
    failed: 0,
    changes: [],
    startedAt: new Date().toISOString(),
  };
  emitBulk();

  void (async () => {
    const wakeLock = await requestWakeLock();
    let consecutiveFailures = 0;
    try {
      for (const recordId of opts.recordIds) {
        if (bulkCancel) {
          bulkState = { ...bulkState!, status: 'cancelled' };
          return;
        }
        const record = await getRecord(recordId);
        if (!record || jobs.has(recordId)) {
          bulkState = { ...bulkState!, done: bulkState!.done + 1 };
          emitBulk();
          continue;
        }
        bulkState = { ...bulkState!, currentTitle: record.title || '無題の記録' };
        emitBulk();

        const before = record.analysis?.verdict?.leaning;
        const marked = await persistRecord(recordId, (r) => ({ ...r, status: 'analyzing' }));
        if (!marked) {
          bulkState = { ...bulkState!, done: bulkState!.done + 1 };
          emitBulk();
          continue;
        }
        const job = registerAnalyzeJob(recordId);
        emit({ type: 'progress', job });
        try {
          const updated = await runAnalyze(job, {
            recordId,
            context: recordToContext(record),
            peopleContext: opts.peopleContext,
            // 一括実行ではレート制限に当たりやすいので、待って再試行する回数を増やす
            maxRetries429: 6,
          });
          consecutiveFailures = 0;
          const after = updated?.analysis?.verdict?.leaning;
          bulkState = {
            ...bulkState!,
            done: bulkState!.done + 1,
            changes: updated
              ? [
                  ...bulkState!.changes,
                  { recordId, title: updated.title || '無題の記録', before, after },
                ]
              : bulkState!.changes,
          };
        } catch (err) {
          consecutiveFailures++;
          bulkState = { ...bulkState!, done: bulkState!.done + 1, failed: bulkState!.failed + 1 };
          if (isFatalForBulk(err) || consecutiveFailures >= 3) {
            bulkState = {
              ...bulkState,
              status: 'aborted',
              message:
                err instanceof ApiError && consecutiveFailures < 3
                  ? err.message
                  : '続けて失敗したため中断しました。時間をおいて「再分析」を押すと、残りの記録から再開できます。',
            };
            return;
          }
        }
        emitBulk();
      }
      bulkState = { ...bulkState!, status: 'done' };
    } finally {
      bulkState = { ...bulkState!, currentTitle: undefined, finishedAt: new Date().toISOString() };
      emitBulk();
      await wakeLock?.release().catch(() => undefined);
    }
  })();
}

/**
 * 処理中のまま取り残された記録の復旧。
 * タブの強制終了・リロード等でジョブが消えると、記録が
 * status='transcribing'/'analyzing' のまま残る（原本・完了済みの
 * 文字起こしは保存済み）。実行中ジョブが存在しないのに処理中状態の
 * 記録を 'draft' へ戻し、詳細画面から再実行できるようにする。
 * ホーム・一覧の読み込み時に呼ぶ。
 */
export async function recoverStaleProcessingRecords(): Promise<number> {
  const records = await listRecords();
  let recovered = 0;
  for (const record of records) {
    const processing = record.status === 'transcribing' || record.status === 'analyzing';
    if (processing && !jobs.has(record.id)) {
      await saveRecord({ ...record, status: 'draft', updatedAt: new Date().toISOString() });
      recovered += 1;
    }
  }
  return recovered;
}

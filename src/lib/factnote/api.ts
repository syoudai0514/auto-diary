'use client';

import {
  AI_REQUEST_TIMEOUT_MS,
  ApiError,
  fetchWithTimeout,
  parseError,
  postJson,
} from '../api';
import type { IncidentContext } from './prompts/incidentAnalysis';
import type { AnalysisItem, DiaryMode, IncidentAnalysis } from './types';

/**
 * 事実ノートのAPIクライアント。タイムアウトは既存方針どおり
 * サーバー maxDuration(300s) の少し手前（280s）に揃える（依頼書 §2-4）。
 */

export interface FactnoteAnalyzeResult {
  analysis: IncidentAnalysis;
  title: string;
  isPositiveEvent: boolean;
  isConflict: boolean;
  isRepairAction: boolean;
}

/** 音声チャンク1本を文字起こしする。 */
export async function factnoteTranscribeAudio(
  blob: Blob,
  filename: string,
  peopleContext?: string,
  timeoutMs = AI_REQUEST_TIMEOUT_MS,
): Promise<string> {
  const form = new FormData();
  form.append('file', blob, filename);
  if (peopleContext) form.append('peopleContext', peopleContext);
  let res: Response;
  try {
    res = await fetchWithTimeout('/api/factnote/transcribe', { method: 'POST', body: form }, timeoutMs);
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') {
      throw new ApiError(408, 'timeout', '文字起こしがタイムアウトしました。');
    }
    throw new ApiError(0, 'network', 'ネットワークに接続できませんでした。');
  }
  if (!res.ok) throw await parseError(res);
  const data = await res.json();
  return data.text ?? '';
}

/** 出来事の記録から構造化分析を生成する。 */
export async function factnoteAnalyzeApi(
  sourceText: string,
  context: IncidentContext,
  peopleContext?: string,
): Promise<FactnoteAnalyzeResult> {
  const res = await postJson(
    '/api/factnote/analyze',
    { sourceText, context, peopleContext },
    AI_REQUEST_TIMEOUT_MS,
    '分析がタイムアウトしました。',
  );
  const data = await res.json();
  if (!data?.result?.analysis) {
    throw new ApiError(500, 'invalid_response', 'サーバーからの応答が不正でした。');
  }
  return data.result as FactnoteAnalyzeResult;
}

/** 指定モードの日記を生成する。 */
export async function factnoteDiaryApi(
  mode: DiaryMode,
  sourceText: string,
  analysisSummary?: string,
  peopleContext?: string,
): Promise<{ title: string; body: string }> {
  const res = await postJson(
    '/api/factnote/diary',
    { mode, sourceText, analysisSummary, peopleContext },
    AI_REQUEST_TIMEOUT_MS,
    '日記の生成がタイムアウトしました。',
  );
  const data = await res.json();
  if (typeof data?.diary?.title !== 'string' || typeof data?.diary?.body !== 'string') {
    throw new ApiError(500, 'invalid_response', 'サーバーからの応答が不正でした。');
  }
  return data.diary;
}

/** Blob の SHA-256（文字起こしキャッシュのキー。依頼書 §22.2）。 */
export async function sha256OfBlob(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ---------------------------------------------------------------------------
// 長期分析（客観カルテ / フラットチェック / 未来メモ）

/** 客観カルテのAI講評。送るのはローカル集計テキストのみ（本文・実名は送らない）。 */
export async function factnoteProfileSummaryApi(
  stats: string,
): Promise<{ summary: string; aiModel: string; promptVersion: string }> {
  const res = await postJson(
    '/api/factnote/profile-summary',
    { stats },
    AI_REQUEST_TIMEOUT_MS,
    '講評の生成がタイムアウトしました。',
  );
  const data = await res.json();
  if (typeof data?.summary !== 'string') {
    throw new ApiError(500, 'invalid_response', 'サーバーからの応答が不正でした。');
  }
  return data;
}

export interface FlatCheckAiResponse {
  conciseConclusion: string;
  userImprovementPoints: AnalysisItem[];
  otherPartyProblemPoints: AnalysisItem[];
  unknowns: AnalysisItem[];
  avoidJudgingFromThisIncident: AnalysisItem[];
  improvingPoints: AnalysisItem[];
  aiMessage: string;
  aiModel: string;
  promptVersion: string;
}

/** フラットチェック（AI部分のみ。過去比較・偏り警告はローカル集計値を渡す）。 */
export async function factnoteFlatCheckApi(opts: {
  sourceText: string;
  analysisSummary?: string;
  pastStats: string;
  biasWarnings: string[];
}): Promise<FlatCheckAiResponse> {
  const res = await postJson(
    '/api/factnote/flat-check',
    opts,
    AI_REQUEST_TIMEOUT_MS,
    'フラットチェックがタイムアウトしました。',
  );
  const data = await res.json();
  if (typeof data?.check?.conciseConclusion !== 'string') {
    throw new ApiError(500, 'invalid_response', 'サーバーからの応答が不正でした。');
  }
  return data.check as FlatCheckAiResponse;
}

/** 未来メモのAI下書き（保存はしない — ユーザーの確認・編集が必須）。 */
export async function factnoteMemoDraftApi(purpose: string): Promise<{ title: string; body: string }> {
  const res = await postJson(
    '/api/factnote/memo-draft',
    { purpose },
    AI_REQUEST_TIMEOUT_MS,
    '下書きの生成がタイムアウトしました。',
  );
  const data = await res.json();
  if (typeof data?.draft?.title !== 'string' || typeof data?.draft?.body !== 'string') {
    throw new ApiError(500, 'invalid_response', 'サーバーからの応答が不正でした。');
  }
  return data.draft;
}

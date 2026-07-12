'use client';

import { DiarySchema, type Diary, type DiaryStyleId } from './diary';
import { TalkAnalysisSchema, type TalkAnalysis } from './talk';

export class ApiError extends Error {
  status: number;
  code: string;
  /** 429 のとき、何秒待てば再試行できるか（Retry-After ヘッダー由来）。 */
  retryAfter?: number;
  constructor(status: number, code: string, message: string, retryAfter?: number) {
    super(message);
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
    this.name = 'ApiError';
  }
}

async function parseError(res: Response): Promise<ApiError> {
  let code = 'error';
  let message = '通信に失敗しました。';
  try {
    const data = await res.json();
    code = data?.error ?? code;
    if (data?.message) message = data.message;
  } catch {
    /* ignore */
  }
  const retryAfterRaw = res.headers.get('Retry-After');
  const retryAfter = retryAfterRaw ? Number(retryAfterRaw) : undefined;
  return new ApiError(
    res.status,
    code,
    message,
    Number.isFinite(retryAfter) ? retryAfter : undefined,
  );
}

/** タイムアウト付き fetch。 */
async function fetchWithTimeout(input: RequestInfo, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

/**
 * JSONボディをPOSTし、タイムアウト・ネットワーク断・エラーレスポンスを
 * ApiError に正規化して返す共通ヘルパー。
 */
async function postJson(
  path: string,
  body: unknown,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<Response> {
  let res: Response;
  try {
    res = await fetchWithTimeout(
      path,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
      timeoutMs,
    );
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') {
      throw new ApiError(408, 'timeout', timeoutMessage);
    }
    throw new ApiError(0, 'network', 'ネットワークに接続できませんでした。');
  }
  if (!res.ok) throw await parseError(res);
  return res;
}

/**
 * サーバー応答の diary をスキーマ検証して返す。
 * 想定外の形（デプロイずれ・途中で書き換えられた応答など）を
 * 実行時に検知し、黙って壊れたデータを画面に流さない。
 */
function parseDiaryResponse(data: unknown): Diary {
  const parsed = DiarySchema.safeParse((data as { diary?: unknown })?.diary);
  if (!parsed.success) {
    throw new ApiError(500, 'invalid_response', 'サーバーからの応答が不正でした。');
  }
  return parsed.data;
}

export async function login(username: string, password: string): Promise<void> {
  const res = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) throw await parseError(res);
}

export async function signup(username: string, password: string, inviteCode: string): Promise<void> {
  const res = await fetch('/api/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, inviteCode }),
  });
  if (!res.ok) throw await parseError(res);
}

export async function logout(): Promise<void> {
  await fetch('/api/logout', { method: 'POST' });
}

export async function transcribeAudio(
  blob: Blob,
  filename: string,
  timeoutMs = 180000,
): Promise<string> {
  const form = new FormData();
  form.append('file', blob, filename);
  let res: Response;
  try {
    res = await fetchWithTimeout('/api/transcribe', { method: 'POST', body: form }, timeoutMs);
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

// サーバー側の maxDuration（300秒）に合わせつつ、少し手前でクライアント側の
// タイムアウトを発生させる。ここが短すぎると、サーバー側では正常に完了できる
// はずの遅いリクエストがクライアント都合で失敗扱いになり、ユーザーが再試行して
// Geminiの呼び出し回数が重複してしまう。
const AI_REQUEST_TIMEOUT_MS = 280000;

export async function generateDiaryApi(
  transcript: string,
  style: DiaryStyleId,
  peopleContext?: string,
  timeoutMs = AI_REQUEST_TIMEOUT_MS,
): Promise<Diary> {
  const res = await postJson(
    '/api/generate',
    { transcript, style, peopleContext },
    timeoutMs,
    '日記の生成がタイムアウトしました。',
  );
  return parseDiaryResponse(await res.json());
}

/**
 * 生成済みの日記を、ユーザーからの修正依頼（テキストまたは音声）に従って書き直す。
 */
export async function reviseDiaryApi(
  transcript: string,
  currentDiary: Diary,
  instruction: string,
  style: DiaryStyleId,
  peopleContext?: string,
  timeoutMs = AI_REQUEST_TIMEOUT_MS,
): Promise<Diary> {
  const res = await postJson(
    '/api/diary/revise',
    { transcript, currentDiary, instruction, style, peopleContext },
    timeoutMs,
    '日記の修正がタイムアウトしました。',
  );
  return parseDiaryResponse(await res.json());
}

/** 現在のプロフィール(Markdown)と新しい入力を統合し、更新後のMarkdownを取得する。 */
export async function updateProfileApi(
  currentMarkdown: string,
  newInput: string,
  timeoutMs = AI_REQUEST_TIMEOUT_MS,
): Promise<string> {
  const res = await postJson(
    '/api/profile/update',
    { currentMarkdown, newInput },
    timeoutMs,
    'プロフィールの更新がタイムアウトしました。',
  );
  const data = await res.json();
  return typeof data.markdown === 'string' ? data.markdown : '';
}

/**
 * ふたりの話し合い音声を、話者ラベル（A:/B:）付きで文字起こしする。
 */
export async function transcribeTalkAudio(
  blob: Blob,
  filename: string,
  timeoutMs = 180000,
): Promise<string> {
  const form = new FormData();
  form.append('file', blob, filename);
  let res: Response;
  try {
    res = await fetchWithTimeout('/api/talk/transcribe', { method: 'POST', body: form }, timeoutMs);
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

/**
 * 話者付き文字起こしから、ふたりの話し合いの構造化分析を取得する。
 */
export async function analyzeTalkApi(
  transcript: string,
  speakerA: string,
  speakerB: string,
  peopleContext?: string,
  timeoutMs = AI_REQUEST_TIMEOUT_MS,
): Promise<TalkAnalysis> {
  const res = await postJson(
    '/api/talk/analyze',
    { transcript, speakerA, speakerB, peopleContext },
    timeoutMs,
    '話し合いの分析がタイムアウトしました。',
  );
  const data = await res.json();
  const parsed = TalkAnalysisSchema.safeParse((data as { analysis?: unknown })?.analysis);
  if (!parsed.success) {
    throw new ApiError(500, 'invalid_response', 'サーバーからの応答が不正でした。');
  }
  return parsed.data;
}

/** 自分のGemini APIキーが登録済みかどうかを取得する（キー自体は返らない）。 */
export async function getGeminiKeyStatus(): Promise<{ hasKey: boolean }> {
  const res = await fetch('/api/account/gemini-key');
  if (!res.ok) throw await parseError(res);
  return res.json();
}

/** 自分のGemini APIキーを登録・更新する。 */
export async function saveGeminiKey(apiKey: string): Promise<void> {
  const res = await fetch('/api/account/gemini-key', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey }),
  });
  if (!res.ok) throw await parseError(res);
}

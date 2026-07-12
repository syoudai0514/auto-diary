'use client';

import type { Diary, DiaryStyleId } from './diary';

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

export async function login(password: string): Promise<void> {
  const res = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  if (!res.ok) throw await parseError(res);
}

export async function logout(): Promise<void> {
  await fetch('/api/logout', { method: 'POST' });
}

export async function transcribeAudio(
  blob: Blob,
  filename: string,
  timeoutMs = 120000,
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

export async function generateDiaryApi(
  transcript: string,
  style: DiaryStyleId,
  peopleContext?: string,
  timeoutMs = 60000,
): Promise<Diary> {
  let res: Response;
  try {
    res = await fetchWithTimeout(
      '/api/generate',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript, style, peopleContext }),
      },
      timeoutMs,
    );
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') {
      throw new ApiError(408, 'timeout', '日記の生成がタイムアウトしました。');
    }
    throw new ApiError(0, 'network', 'ネットワークに接続できませんでした。');
  }
  if (!res.ok) throw await parseError(res);
  const data = await res.json();
  return data.diary as Diary;
}

/** 現在のプロフィール(Markdown)と新しい入力を統合し、更新後のMarkdownを取得する。 */
export async function updateProfileApi(
  currentMarkdown: string,
  newInput: string,
  timeoutMs = 60000,
): Promise<string> {
  let res: Response;
  try {
    res = await fetchWithTimeout(
      '/api/profile/update',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentMarkdown, newInput }),
      },
      timeoutMs,
    );
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') {
      throw new ApiError(408, 'timeout', 'プロフィールの更新がタイムアウトしました。');
    }
    throw new ApiError(0, 'network', 'ネットワークに接続できませんでした。');
  }
  if (!res.ok) throw await parseError(res);
  const data = await res.json();
  return data.markdown as string;
}

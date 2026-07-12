'use client';

import { ApiError } from './api';

/**
 * 429（レート制限）のときは少し待って再試行する。
 * Retry-After ヘッダーがあればそれに従い、無ければ既定20秒待つ
 * （Gemini側のレート制限はヘッダーを返さないことがあるため）。
 * Geminiの無料枠は1分あたりのリクエスト数が少なく、続けて操作すると
 * 1回の再試行では間に合わないことがあるため、既定で最大2回まで再試行する。
 */
export async function withRetryOn429<T>(fn: () => Promise<T>, maxRetries = 2): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof ApiError && err.status === 429 && attempt < maxRetries) {
        attempt++;
        const waitSec = err.retryAfter ?? 20;
        const waitMs = Math.min(waitSec, 30) * 1000;
        await new Promise((resolve) => setTimeout(resolve, waitMs));
        continue;
      }
      throw err;
    }
  }
}

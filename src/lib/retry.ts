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

/**
 * 時間をおけば直る一時的な失敗か（制限超過 429 / Gemini の高負荷 503 / タイムアウト系 504）。
 * 502 は含めない: 分析ルートは「安全フィルタでブロック」「出力が途切れた」など、
 * 再試行しても直らない失敗も 502 で返すため、再試行すると同じ内容を無駄に送り続けてしまう。
 */
export function isBusyError(err: unknown): err is ApiError {
  return err instanceof ApiError && [429, 503, 504].includes(err.status);
}

/**
 * 429 に加えて、Geminiの一時的な高負荷（503 UNAVAILABLE「high demand」）と
 * タイムアウト系（504）も、待ってから再試行する。
 * 429 は Retry-After（無ければ20秒）、それ以外は 10・20・40…秒と延ばし、上限は各60秒。
 * 一括処理では、続けて叩かないよう待ち時間そのものが負荷を下げる役にもなる。
 * shouldStop が true を返したら、待たずにその時点のエラーを投げる（中断ボタン用）。
 */
export async function withRetryOnBusy<T>(
  fn: () => Promise<T>,
  maxRetries = 4,
  shouldStop?: () => boolean,
  /** 待機に入る時に呼ぶ（画面に「混み合っているので待機中」と出す用）。 */
  onWait?: (info: { seconds: number; status: number; attempt: number }) => void,
): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      if (!isBusyError(err) || attempt >= maxRetries || shouldStop?.()) throw err;
      const base = err.status === 429 ? (err.retryAfter ?? 20) : 10 * 2 ** attempt;
      attempt++;
      const seconds = Math.min(base, 60);
      onWait?.({ seconds, status: err.status, attempt });
      await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
    }
  }
}

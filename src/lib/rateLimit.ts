/**
 * ごく簡単なインメモリのレート制限（トークンバケット）。
 * 個人利用・単一インスタンス前提の軽量な連続呼び出し防止。
 * サーバーレスではインスタンスごとにリセットされうるが、暴発防止には十分。
 */

interface Bucket {
  tokens: number;
  updatedAt: number;
}

const buckets = new Map<string, Bucket>();

export interface RateLimitOptions {
  /** バケットの最大トークン数（バースト許容量）。 */
  capacity: number;
  /** 1秒あたりに回復するトークン数。 */
  refillPerSec: number;
}

export interface RateLimitResult {
  ok: boolean;
  /** 次に1トークン貯まるまでのおおよその秒数。 */
  retryAfter: number;
}

export function rateLimit(
  key: string,
  opts: RateLimitOptions,
  now: number = Date.now(),
): RateLimitResult {
  const { capacity, refillPerSec } = opts;
  const existing = buckets.get(key);
  let bucket: Bucket = existing ?? { tokens: capacity, updatedAt: now };

  // 経過時間ぶんトークンを回復
  const elapsedSec = Math.max(0, (now - bucket.updatedAt) / 1000);
  bucket.tokens = Math.min(capacity, bucket.tokens + elapsedSec * refillPerSec);
  bucket.updatedAt = now;

  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    buckets.set(key, bucket);
    return { ok: true, retryAfter: 0 };
  }

  buckets.set(key, bucket);
  const need = 1 - bucket.tokens;
  return { ok: false, retryAfter: Math.ceil(need / refillPerSec) };
}

/** テスト用: バケットを全消去。 */
export function _resetRateLimits() {
  buckets.clear();
}

/** リクエストからクライアント識別キーを得る（IP 優先、無ければ固定キー）。 */
export function clientKey(req: Request): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  const real = req.headers.get('x-real-ip');
  if (real) return real;
  return 'local';
}

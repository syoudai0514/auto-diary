import { Redis } from '@upstash/redis';

/**
 * レート制限。
 *
 * - rateLimit(): インメモリのトークンバケット。単一インスタンス内での
 *   連続呼び出し防止（ローカル開発・テスト・Redis未設定時のフォールバック）。
 * - rateLimitDistributed(): Upstash Redis を使った固定ウィンドウ方式。
 *   サーバーレスの複数インスタンスをまたいで制限を効かせる
 *   （ログイン・サインアップの総当たり/招待コード推測対策として重要）。
 *   Redis未設定・Redis障害時はインメモリ実装へフォールバックする
 *   （fail-open: レート制限のためにログインが止まる事態を避け、可用性を優先）。
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

// --- 分散レート制限（Upstash Redis / 固定ウィンドウ） ----------------------

let redisClient: Redis | null | undefined;

function getRateLimitRedis(): Redis | null {
  if (redisClient !== undefined) return redisClient;
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  redisClient = url && token ? new Redis({ url, token, enableAutoPipelining: false }) : null;
  return redisClient;
}

/** テスト用: Redisクライアントのキャッシュを破棄（環境変数の変更を反映させる）。 */
export function _resetRateLimitRedis() {
  redisClient = undefined;
}

/**
 * 複数インスタンスをまたいで効くレート制限。
 * ウィンドウ長は「バケットが満タンから空になるまでの時間」（capacity / refillPerSec）
 * に合わせ、1ウィンドウあたり capacity 回まで許可する。これにより各ルートの
 * 実効レートは従来のトークンバケット設定とほぼ同じになる。
 */
export async function rateLimitDistributed(
  key: string,
  opts: RateLimitOptions,
  now: number = Date.now(),
): Promise<RateLimitResult> {
  const redis = getRateLimitRedis();
  if (!redis) return rateLimit(key, opts, now);

  const windowSec = Math.max(1, Math.round(opts.capacity / opts.refillPerSec));
  const nowSec = Math.floor(now / 1000);
  const windowStart = Math.floor(nowSec / windowSec) * windowSec;
  const redisKey = `rl:${key}:${windowStart}`;

  try {
    const count = await redis.incr(redisKey);
    if (count === 1) {
      // ウィンドウ終了後にキーを掃除する（多少の猶予を持たせる）
      await redis.expire(redisKey, windowSec + 10);
    }
    if (count <= opts.capacity) {
      return { ok: true, retryAfter: 0 };
    }
    return { ok: false, retryAfter: Math.max(1, windowStart + windowSec - nowSec) };
  } catch {
    // Redis障害時はインメモリ実装で継続（インスタンス内の防御は保たれる）
    console.error('[rateLimit] Redisに接続できないためインメモリ制限にフォールバック');
    return rateLimit(key, opts, now);
  }
}

/** リクエストからクライアント識別キーを得る（IP 優先、無ければ固定キー）。 */
export function clientKey(req: Request): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  const real = req.headers.get('x-real-ip');
  if (real) return real;
  return 'local';
}

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * @upstash/redis の Redis クラスを、メモリ上の簡易ストアでモックする。
 * incr / expire のみ（レート制限が使うコマンド）を再現する。
 */
const redisStore = new Map<string, number>();
let redisFailure = false;

vi.mock('@upstash/redis', () => {
  class FakeRedis {
    async incr(key: string): Promise<number> {
      if (redisFailure) throw new Error('connection refused');
      const next = (redisStore.get(key) ?? 0) + 1;
      redisStore.set(key, next);
      return next;
    }
    async expire(_key: string, _sec: number): Promise<number> {
      if (redisFailure) throw new Error('connection refused');
      return 1;
    }
  }
  return { Redis: FakeRedis };
});

import {
  rateLimit,
  rateLimitDistributed,
  _resetRateLimits,
  _resetRateLimitRedis,
} from './rateLimit';

describe('レート制限（インメモリ・トークンバケット）', () => {
  beforeEach(() => _resetRateLimits());

  it('容量までは許可し、超えると拒否する', () => {
    const opts = { capacity: 3, refillPerSec: 0 };
    const now = 1000;
    expect(rateLimit('k', opts, now).ok).toBe(true);
    expect(rateLimit('k', opts, now).ok).toBe(true);
    expect(rateLimit('k', opts, now).ok).toBe(true);
    const blocked = rateLimit('k', opts, now);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfter).toBeGreaterThanOrEqual(0);
  });

  it('時間経過でトークンが回復する', () => {
    const opts = { capacity: 1, refillPerSec: 1 };
    let now = 0;
    expect(rateLimit('k2', opts, now).ok).toBe(true);
    expect(rateLimit('k2', opts, now).ok).toBe(false);
    now += 1500; // 1.5秒後 → 1トークン回復
    expect(rateLimit('k2', opts, now).ok).toBe(true);
  });

  it('キーごとに独立している', () => {
    const opts = { capacity: 1, refillPerSec: 0 };
    expect(rateLimit('a', opts, 0).ok).toBe(true);
    expect(rateLimit('a', opts, 0).ok).toBe(false);
    expect(rateLimit('b', opts, 0).ok).toBe(true);
  });
});

describe('レート制限（分散・固定ウィンドウ）', () => {
  beforeEach(() => {
    _resetRateLimits();
    _resetRateLimitRedis();
    redisStore.clear();
    redisFailure = false;
    process.env.KV_REST_API_URL = 'https://example.upstash.io';
    process.env.KV_REST_API_TOKEN = 'fake-token';
  });

  afterEach(() => {
    delete process.env.KV_REST_API_URL;
    delete process.env.KV_REST_API_TOKEN;
    _resetRateLimitRedis();
  });

  // login相当: capacity 5, refill 5/60 → 60秒ウィンドウで5回まで
  const opts = { capacity: 5, refillPerSec: 5 / 60 };
  const now = 1_000_000_000_000; // 固定時刻

  it('同一ウィンドウ内で容量までは許可し、超えると拒否する', async () => {
    for (let i = 0; i < 5; i++) {
      expect((await rateLimitDistributed('login:1.2.3.4', opts, now)).ok).toBe(true);
    }
    const blocked = await rateLimitDistributed('login:1.2.3.4', opts, now);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfter).toBeGreaterThanOrEqual(1);
    expect(blocked.retryAfter).toBeLessThanOrEqual(60);
  });

  it('次のウィンドウに入るとカウントがリセットされる', async () => {
    for (let i = 0; i < 6; i++) await rateLimitDistributed('k', opts, now);
    expect((await rateLimitDistributed('k', opts, now)).ok).toBe(false);
    // 60秒ウィンドウを跨ぐ
    expect((await rateLimitDistributed('k', opts, now + 61_000)).ok).toBe(true);
  });

  it('キーごとに独立している', async () => {
    for (let i = 0; i < 6; i++) await rateLimitDistributed('user-a', opts, now);
    expect((await rateLimitDistributed('user-a', opts, now)).ok).toBe(false);
    expect((await rateLimitDistributed('user-b', opts, now)).ok).toBe(true);
  });

  it('Redis未設定ならインメモリ実装にフォールバックする', async () => {
    delete process.env.KV_REST_API_URL;
    delete process.env.KV_REST_API_TOKEN;
    _resetRateLimitRedis();
    const result = await rateLimitDistributed('fallback-key', { capacity: 1, refillPerSec: 0 }, now);
    expect(result.ok).toBe(true);
    // Redisは触っていない
    expect(redisStore.size).toBe(0);
    // インメモリ側で2回目は拒否される（フォールバックが実際に効いている）
    expect((await rateLimitDistributed('fallback-key', { capacity: 1, refillPerSec: 0 }, now)).ok).toBe(false);
  });

  it('Redis障害時はfail-open（インメモリにフォールバックして継続）', async () => {
    redisFailure = true;
    const result = await rateLimitDistributed('outage-key', opts, now);
    expect(result.ok).toBe(true); // リクエスト自体は通る
  });
});

import { describe, it, expect, vi, afterEach } from 'vitest';
import { withRetryOn429, withRetryOnBusy } from './retry';
import { ApiError } from './api';

afterEach(() => {
  vi.useRealTimers();
});

describe('withRetryOn429', () => {
  it('成功すればそのまま値を返す', async () => {
    const fn = vi.fn(async () => 'ok');
    expect(await withRetryOn429(fn)).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('429なら待ってから再試行する（Retry-After秒に従う）', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const fn = vi.fn(async () => {
      calls++;
      if (calls === 1) throw new ApiError(429, 'too_many_requests', '混雑', 5);
      return 'recovered';
    });
    const p = withRetryOn429(fn);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await p).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('maxRetries を使い切ったら429をそのまま投げる', async () => {
    vi.useFakeTimers();
    const fn = vi.fn(async () => {
      throw new ApiError(429, 'too_many_requests', '混雑', 1);
    });
    const p = withRetryOn429(fn, 2).catch((e) => e);
    await vi.advanceTimersByTimeAsync(60000);
    const err = await p;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(429);
    expect(fn).toHaveBeenCalledTimes(3); // 初回 + 2回
  });

  it('429以外のエラーは再試行しない', async () => {
    const fn = vi.fn(async () => {
      throw new ApiError(500, 'boom', '失敗');
    });
    const err = await withRetryOn429(fn).catch((e) => e);
    expect(err.status).toBe(500);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('待ち時間は最大30秒に丸められる', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const fn = vi.fn(async () => {
      calls++;
      if (calls === 1) throw new ApiError(429, 'x', '混雑', 9999);
      return 'ok';
    });
    const p = withRetryOn429(fn);
    await vi.advanceTimersByTimeAsync(30000);
    expect(await p).toBe('ok');
  });
});

describe('withRetryOnBusy', () => {
  it('503（Geminiの高負荷）は待って再試行し、回復したら値を返す', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const fn = vi.fn(async () => {
      calls++;
      if (calls <= 2) throw new ApiError(503, 'analysis_failed', '高負荷');
      return 'ok';
    });
    const p = withRetryOnBusy(fn);
    await vi.advanceTimersByTimeAsync(10_000); // 1回目の待ち 10秒
    await vi.advanceTimersByTimeAsync(20_000); // 2回目の待ち 20秒
    expect(await p).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('429 は Retry-After に従い、504 も再試行対象', async () => {
    vi.useFakeTimers();
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(429, 'x', 'x', 3))
      .mockRejectedValueOnce(new ApiError(504, 'x', 'x'))
      .mockResolvedValue('ok');
    const p = withRetryOnBusy(fn);
    await vi.advanceTimersByTimeAsync(3_000); // 429: Retry-After
    await vi.advanceTimersByTimeAsync(20_000); // 504: 2回目の待ち（10 × 2）
    expect(await p).toBe('ok');
  });

  it('待ち時間は上限60秒、回数を使い切ったらそのまま投げる', async () => {
    vi.useFakeTimers();
    const fn = vi.fn(async () => {
      throw new ApiError(503, 'x', '高負荷');
    });
    const p = withRetryOnBusy(fn, 3).catch((e) => e);
    await vi.advanceTimersByTimeAsync(10_000 + 20_000 + 40_000);
    const err = await p;
    expect(err.status).toBe(503);
    expect(fn).toHaveBeenCalledTimes(4);
  });

  it('503/504/429 以外（400・500・502 など）は再試行しない', async () => {
    // 502 は「ブロック」「出力途切れ」など再試行しても直らない失敗にも使われるため対象外
    for (const status of [400, 401, 500, 502]) {
      const fn = vi.fn(async () => {
        throw new ApiError(status, 'x', 'x');
      });
      await withRetryOnBusy(fn).catch(() => undefined);
      expect(fn).toHaveBeenCalledTimes(1);
    }
  });

  it('shouldStop が true なら待たずに投げる', async () => {
    const fn = vi.fn(async () => {
      throw new ApiError(503, 'x', '高負荷');
    });
    const err = await withRetryOnBusy(fn, 4, () => true).catch((e) => e);
    expect(err.status).toBe(503);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

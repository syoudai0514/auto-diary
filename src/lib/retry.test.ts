import { describe, it, expect, vi, afterEach } from 'vitest';
import { withRetryOn429 } from './retry';
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

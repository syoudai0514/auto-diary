import { describe, it, expect, beforeEach } from 'vitest';
import { rateLimit, _resetRateLimits } from './rateLimit';

describe('レート制限', () => {
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

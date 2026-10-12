'use client';

import { getMeta, setMeta } from './db';
import type { OverallReview } from './types';

/**
 * 全体の見解の保存（IndexedDB meta）。最新と、その1つ前を残して変化を比べられるようにする。
 * AIで再生成できる派生データなので、JSONバックアップには含めない。
 */

const KEY_LATEST = 'overallReview:latest';
const KEY_PREVIOUS = 'overallReview:previous';

export async function loadOverallReviews(): Promise<{ latest?: OverallReview; previous?: OverallReview }> {
  const [latest, previous] = await Promise.all([
    getMeta<OverallReview>(KEY_LATEST).catch(() => undefined),
    getMeta<OverallReview>(KEY_PREVIOUS).catch(() => undefined),
  ]);
  return { latest, previous };
}

export async function saveOverallReview(review: OverallReview): Promise<void> {
  const current = await getMeta<OverallReview>(KEY_LATEST).catch(() => undefined);
  if (current) await setMeta(KEY_PREVIOUS, current);
  await setMeta(KEY_LATEST, review);
}

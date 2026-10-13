'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { FactnoteHeader } from '@/components/screens/factnote/common';
import {
  OverallReviewSection,
  ReanalysisCard,
  ShapeSection,
} from '@/components/screens/factnote/OverviewScreen';
import { ApiError } from '@/lib/api';
import { factnoteOverallReviewApi } from '@/lib/factnote/api';
import { listRecords } from '@/lib/factnote/db';
import {
  cancelBulkReanalysis,
  clearBulkReanalysis,
  startBulkReanalysis,
  subscribeBulkReanalysis,
  type BulkReanalysisState,
} from '@/lib/factnote/jobs';
import { loadOverallReviews, saveOverallReview } from '@/lib/factnote/overallReviewStore';
import {
  buildOverviewDigest,
  blockedRecords,
  buildOverviewStats,
  estimateReanalysisMinutes,
  reanalysisTargets,
  resolveOverallReview,
  type ReanalysisMode,
} from '@/lib/factnote/overview';
import { loadFactnoteProfile, profileToPeopleContext } from '@/lib/factnote/profile';
import { withRetryOnBusy } from '@/lib/retry';
import type { IncidentRecord, OverallReview } from '@/lib/factnote/types';

/**
 * 全体の見解: 判定基準の状態と一括再分析 → 記録全体のかたち（ローカル集計）→ AIによる全体の見解。
 */
export default function FactnoteOverviewPage() {
  const [records, setRecords] = useState<IncidentRecord[] | null>(null);
  const [reviews, setReviews] = useState<{ latest?: OverallReview; previous?: OverallReview }>({});
  const [bulk, setBulk] = useState<BulkReanalysisState | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);

  const reload = useCallback(() => {
    listRecords()
      .then(setRecords)
      .catch(() => setRecords([]));
  }, []);

  useEffect(() => {
    reload();
    loadOverallReviews()
      .then(setReviews)
      .catch(() => undefined);
  }, [reload]);

  // 一括再分析の進捗。1件終わるごとに記録を読み直して集計へ反映する
  useEffect(
    () =>
      subscribeBulkReanalysis((state) => {
        setBulk(state);
        reload();
      }),
    [reload],
  );

  const stats = useMemo(() => buildOverviewStats(records ?? []), [records]);
  const recordsById = useMemo(() => new Map((records ?? []).map((r) => [r.id, r])), [records]);
  const blocked = useMemo(() => blockedRecords(records ?? []), [records]);
  const outdatedTargets = useMemo(() => reanalysisTargets(records ?? [], 'outdated'), [records]);
  const allTargets = useMemo(() => reanalysisTargets(records ?? [], 'all'), [records]);

  async function startReanalysis(mode: ReanalysisMode) {
    const targets = mode === 'all' ? allTargets : outdatedTargets;
    const profile = await loadFactnoteProfile().catch(() => undefined);
    startBulkReanalysis({
      recordIds: targets.map((r) => r.id),
      peopleContext: profile ? profileToPeopleContext(profile) : undefined,
    });
  }

  async function generateReview() {
    if (!records) return;
    setReviewLoading(true);
    setReviewError(null);
    try {
      const digest = buildOverviewDigest(records, stats);
      const profile = await loadFactnoteProfile().catch(() => undefined);
      const res = await withRetryOnBusy(() =>
        factnoteOverallReviewApi(digest.text, profile ? profileToPeopleContext(profile) : undefined),
      );
      const outdatedCount = digest.refs.filter((id) => !recordsById.get(id)?.analysis?.verdict).length;
      const review = resolveOverallReview(res.review, {
        refs: digest.refs,
        aiModel: res.aiModel,
        promptVersion: res.promptVersion,
        fingerprint: stats.fingerprint,
        includedCount: digest.includedCount,
        outdatedCount,
      });
      await saveOverallReview(review);
      setReviews((prev) => ({ latest: review, previous: prev.latest }));
    } catch (err) {
      setReviewError(err instanceof ApiError ? err.message : '全体の見解の作成に失敗しました。');
    } finally {
      setReviewLoading(false);
    }
  }

  const analyzedCount = stats.analyzedCurrent + stats.analyzedOutdated;

  return (
    <div className="flex min-h-dvh flex-col pt-safe">
      <FactnoteHeader title="全体の見解" backHref="/factnote/insights" />
      <div className="flex-1 overflow-y-auto px-6 pb-10">
        <p className="pt-1 text-[12.5px] leading-relaxed text-text-secondary">
          すべての記録を通して、どちらの課題が重いか、何が繰り返されているかを見ます。公正とは真ん中に寄せることではなく、両者に同じ物差しを当てることです。
        </p>

        {records === null ? (
          <p className="mt-10 text-center text-[13px] text-text-tertiary">読み込み中…</p>
        ) : records.length === 0 ? (
          <p className="mt-10 text-center text-[14px] text-text-tertiary">まだ記録がありません。</p>
        ) : (
          <>
            <ReanalysisCard
              stats={stats}
              blocked={blocked}
              outdatedTargets={outdatedTargets.length}
              allTargets={allTargets.length}
              estimateMinutes={estimateReanalysisMinutes}
              bulk={bulk}
              onStart={(mode) => void startReanalysis(mode)}
              onCancel={cancelBulkReanalysis}
              onDismiss={clearBulkReanalysis}
            />
            <ShapeSection stats={stats} />
            <OverallReviewSection
              review={reviews.latest}
              previous={reviews.previous}
              stale={!!reviews.latest && reviews.latest.fingerprint !== stats.fingerprint}
              loading={reviewLoading}
              error={reviewError}
              canGenerate={analyzedCount > 0 && bulk?.status !== 'running' && !reviewLoading}
              outdatedCount={stats.analyzedOutdated}
              recordsById={recordsById}
              onGenerate={() => void generateReview()}
            />
          </>
        )}
      </div>
    </div>
  );
}

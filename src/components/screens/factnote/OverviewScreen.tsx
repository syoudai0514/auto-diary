'use client';

import Link from 'next/link';
import { AlertTriangleIcon, CheckIcon, RefreshIcon } from '@/components/icons';
import type { BulkReanalysisState } from '@/lib/factnote/jobs';
import { LEANING_SCALE, type OverviewStats } from '@/lib/factnote/overview';
import {
  RELATIONSHIP_TREND_LABELS,
  RESPONSIBILITY_TENDENCY_LABELS,
  SEVERITY_LABELS,
  VERDICT_LEANING_LABELS,
  type IncidentRecord,
  type OverallReview,
  type RecurringIssue,
  type Severity,
} from '@/lib/factnote/types';
import { formatRecordDate, Section } from './common';
import { LeaningLabel, leaningSide, SeverityBadge } from './Verdict';

/**
 * 「全体の見解」画面の表示部品（状態とAI呼び出しは app/factnote/overview/page.tsx）。
 * 上から: ①判定基準の状態と一括再分析 → ②記録全体のかたち（ローカル集計）→ ③AIによる全体の見解。
 */

const card = 'rounded-card border border-border px-4 py-4';
const primaryButton =
  'flex h-[52px] w-full items-center justify-center gap-2 rounded-full bg-accent text-[15.5px] font-semibold text-accent-on shadow-cta active:opacity-80 disabled:opacity-50';
const ghostButton =
  'flex min-h-[44px] items-center justify-center gap-1.5 text-[13px] text-text-secondary active:opacity-60';

// ---------------------------------------------------------------------------
// ① 判定基準の状態と一括再分析

export function ReanalysisCard({
  stats,
  outdatedTargets,
  allTargets,
  estimateMinutes,
  bulk,
  onStart,
  onCancel,
  onDismiss,
}: {
  stats: OverviewStats;
  outdatedTargets: number;
  allTargets: number;
  estimateMinutes: (count: number) => number;
  bulk: BulkReanalysisState | null;
  onStart: (mode: 'outdated' | 'all') => void;
  onCancel: () => void;
  onDismiss: () => void;
}) {
  return (
    <section className={`mt-5 ${card}`} aria-label="判定基準の状態">
      <div className="text-[13px] font-semibold text-text-secondary">判定基準の状態</div>
      <div className="mt-2.5 grid grid-cols-3 gap-2 text-center">
        <StatTile value={stats.analyzedCurrent} label="最新の基準" tone="accent" />
        <StatTile value={stats.analyzedOutdated} label="旧基準" tone={stats.analyzedOutdated > 0 ? 'warning' : 'muted'} />
        <StatTile value={stats.unanalyzed} label="未分析" tone="muted" />
      </div>

      {bulk?.status === 'running' ? (
        <BulkProgress bulk={bulk} onCancel={onCancel} />
      ) : bulk ? (
        <BulkResult bulk={bulk} onDismiss={onDismiss} />
      ) : outdatedTargets > 0 ? (
        <div className="mt-4">
          <p className="mb-3 text-[12.5px] leading-relaxed text-text-secondary">
            旧基準の分析は、自分側と相手側の指摘を同じくらい並べる傾向がありました。最新の基準では、問題の「重さ」を同じ物差しで比べて判定します。
          </p>
          <button onClick={() => onStart('outdated')} className={primaryButton}>
            <RefreshIcon width={18} height={18} />
            {outdatedTargets}件をまとめて再分析
          </button>
          <p className="mt-1.5 text-center text-[11.5px] text-text-tertiary">
            目安 約{estimateMinutes(outdatedTargets)}分 · 古い記録から順に1件ずつ
          </p>
        </div>
      ) : (
        <p className="mt-3 flex items-center gap-1.5 text-[13px] text-success">
          <CheckIcon width={16} height={16} />
          すべての記録が最新の基準で分析されています
        </p>
      )}

      {!bulk && allTargets > 0 && (
        <details className="mt-2">
          <summary className={`${ghostButton} cursor-pointer list-none`}>すべての記録を分析し直す…</summary>
          <div className="pb-1 pt-1">
            <p className="text-[12px] leading-relaxed text-text-tertiary">
              最新の基準で分析済みの記録も含め、{allTargets}件すべてを分析し直します（目安 約
              {estimateMinutes(allTargets)}分）。直前の分析は各記録に1世代だけ残り、判定の変化を比べられます。
            </p>
            <button
              onClick={() => onStart('all')}
              className="mt-2 h-11 w-full rounded-full border border-border text-[14px] font-semibold active:opacity-70"
            >
              {allTargets}件すべてを分析し直す
            </button>
          </div>
        </details>
      )}
    </section>
  );
}

function StatTile({ value, label, tone }: { value: number; label: string; tone: 'accent' | 'warning' | 'muted' }) {
  const color = tone === 'accent' ? 'text-accent' : tone === 'warning' ? 'text-warning' : 'text-text';
  return (
    <div className="rounded-chip bg-surface px-2 py-2.5">
      <div className={`text-[22px] font-bold leading-none ${color}`}>{value}</div>
      <div className="mt-1 text-[11px] text-text-secondary">{label}</div>
    </div>
  );
}

function BulkProgress({ bulk, onCancel }: { bulk: BulkReanalysisState; onCancel: () => void }) {
  const pct = bulk.total > 0 ? Math.round((bulk.done / bulk.total) * 100) : 0;
  return (
    <div className="mt-4" role="status" aria-live="polite">
      <div className="flex items-baseline justify-between text-[13px]">
        <span className="font-semibold">再分析しています…</span>
        <span className="text-text-secondary">
          {bulk.done} / {bulk.total}件
        </span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface">
        <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${pct}%` }} />
      </div>
      {bulk.currentTitle && (
        <p className="mt-2 truncate text-[12.5px] text-text-secondary">「{bulk.currentTitle}」を分析中</p>
      )}
      {bulk.failed > 0 && <p className="mt-1 text-[12px] text-warning">失敗 {bulk.failed}件（あとで再実行できます）</p>}
      <p className="mt-2 text-[11.5px] leading-relaxed text-text-tertiary">
        この画面を開いたままにしてください。アプリ内の別の画面へ移動しても続きますが、画面ロックや他のアプリへの切り替えで止まることがあります。止まっても完了した分は保存され、もう一度押すと残りから再開します。
      </p>
      <button onClick={onCancel} className={`${ghostButton} mt-1 w-full`}>
        この記録の分析が終わったら止める
      </button>
    </div>
  );
}

function BulkResult({ bulk, onDismiss }: { bulk: BulkReanalysisState; onDismiss: () => void }) {
  const changed = bulk.changes.filter((c) => c.before !== c.after);
  const title =
    bulk.status === 'done'
      ? '再分析が完了しました'
      : bulk.status === 'cancelled'
        ? '再分析を止めました'
        : '再分析を中断しました';
  const succeeded = bulk.done - bulk.failed;
  return (
    <div className="mt-4">
      <p className={`text-[14px] font-semibold ${bulk.status === 'aborted' ? 'text-warning' : ''}`}>{title}</p>
      <p className="mt-1 text-[12.5px] text-text-secondary">
        {succeeded}件を分析しました{bulk.failed > 0 ? `（失敗 ${bulk.failed}件）` : ''}
        {bulk.done < bulk.total ? ` · 残り ${bulk.total - bulk.done}件` : ''}
      </p>
      {bulk.message && <p className="mt-1 text-[12.5px] leading-relaxed text-warning">{bulk.message}</p>}
      {changed.length > 0 && (
        <div className="mt-3">
          <div className="text-[12px] font-semibold text-text-secondary">判定が付いた・変わった記録</div>
          <ul className="mt-1.5 divide-y divide-border">
            {changed.slice(0, 12).map((c) => (
              <li key={c.recordId}>
                <Link
                  href={`/factnote/records/${c.recordId}`}
                  className="flex min-h-[44px] flex-col justify-center py-1.5 active:opacity-60"
                >
                  <span className="truncate text-[13.5px] font-medium">{c.title}</span>
                  <span className="text-[11.5px]">
                    <span className="text-text-tertiary">{c.before ? VERDICT_LEANING_LABELS[c.before] : '判定なし'}</span>
                    <span className="mx-1 text-text-tertiary">→</span>
                    {c.after ? <LeaningLabel leaning={c.after} className="font-semibold" /> : '—'}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {changed.length > 12 && (
            <p className="mt-1 text-[11.5px] text-text-tertiary">ほか {changed.length - 12}件</p>
          )}
        </div>
      )}
      <button onClick={onDismiss} className={`${ghostButton} mt-2 w-full`}>
        閉じる
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ② 記録全体のかたち（ローカル集計。AIを使わない）

export function ShapeSection({ stats }: { stats: OverviewStats }) {
  return (
    <Section title="記録全体のかたち（集計）">
      <div className={card}>
        <div className="text-[13px] font-semibold">衝突ごとの判定</div>
        <LeaningDistribution stats={stats} />
      </div>

      <div className={`mt-3 ${card}`}>
        <div className="text-[13px] font-semibold">指摘された問題の重さ</div>
        <p className="mt-0.5 text-[11.5px] text-text-tertiary">件数より「重い問題がどちらに多いか」を見てください。</p>
        <SeverityRow label="自分側" counts={stats.severity.user} side="user" />
        <SeverityRow label="相手側" counts={stats.severity.other} side="other" />
      </div>

      <div className={`mt-3 ${card}`}>
        <div className="flex items-baseline justify-between">
          <span className="text-[13px] font-semibold">月ごとの推移</span>
          <span className="text-[11px] text-text-tertiary">直近6か月</span>
        </div>
        <MonthlyChart stats={stats} />
        <div className="mt-3 grid grid-cols-4 gap-2 text-center">
          <MiniCount label="衝突" value={stats.conflicts} />
          <MiniCount label="良い出来事" value={stats.positives} />
          <MiniCount label="修復" value={stats.repairs} />
          <MiniCount label="子ども同席の衝突" value={stats.childPresentConflicts} />
        </div>
      </div>

      {(stats.userPatterns.length > 0 || stats.otherPatterns.length > 0) && (
        <div className={`mt-3 ${card}`}>
          <div className="text-[13px] font-semibold">繰り返し記録されたパターン</div>
          <PatternList title="自分側" items={stats.userPatterns} side="user" />
          <PatternList title="相手側" items={stats.otherPatterns} side="other" />
        </div>
      )}

      {stats.biasWarnings.length > 0 && (
        <ul className="mt-3 space-y-1.5 rounded-card bg-warning-soft px-4 py-3 text-[12.5px] leading-relaxed text-text">
          {stats.biasWarnings.map((w) => (
            <li key={w}>・{w}</li>
          ))}
        </ul>
      )}
      {stats.excluded > 0 && (
        <p className="mt-2 text-[11.5px] text-text-tertiary">「カルテから除外」にした記録 {stats.excluded}件は集計に含めていません。</p>
      )}
    </Section>
  );
}

function LeaningDistribution({ stats }: { stats: OverviewStats }) {
  const total = stats.judgedConflicts;
  if (total === 0) {
    return (
      <p className="mt-2 text-[12.5px] leading-relaxed text-text-tertiary">
        最新の基準で判定された衝突の記録はまだありません。上の「まとめて再分析」を行うと表示されます。
      </p>
    );
  }
  return (
    <div className="mt-2.5">
      <div className="flex h-4 overflow-hidden rounded-full" role="img" aria-label="判定の内訳">
        {LEANING_SCALE.map((l) => {
          const n = stats.leaningCounts[l];
          if (n === 0) return null;
          const side = leaningSide(l);
          const color =
            side === 'user' ? 'bg-side-user' : side === 'other' ? 'bg-side-other' : 'bg-text-tertiary';
          const strong = l === 'user_mainly' || l === 'other_mainly' || l === 'comparable';
          return (
            <div
              key={l}
              className={`${color} ${strong ? '' : 'opacity-60'} border-r-2 border-bg last:border-r-0`}
              style={{ width: `${(n / total) * 100}%` }}
            />
          );
        })}
      </div>
      <ul className="mt-2.5 space-y-1 text-[12.5px]">
        {LEANING_SCALE.map((l) => (
          <li key={l} className="flex items-center justify-between">
            <LeaningLabel leaning={l} className="font-medium" />
            <span className="tabular-nums text-text-secondary">{stats.leaningCounts[l]}件</span>
          </li>
        ))}
      </ul>
      {(stats.leaningCounts.no_fault > 0 || stats.leaningCounts.undeterminable > 0) && (
        <p className="mt-2 text-[11.5px] text-text-tertiary">
          ほかに「{VERDICT_LEANING_LABELS.no_fault}」{stats.leaningCounts.no_fault}件 /「
          {VERDICT_LEANING_LABELS.undeterminable}」{stats.leaningCounts.undeterminable}件
        </p>
      )}
      <p className="mt-2 text-[11px] leading-relaxed text-text-tertiary">
        衝突1件ごとの判定の件数です。「誰が何％悪い」という数値ではありません。
      </p>
    </div>
  );
}

const SEVERITY_ORDER: Severity[] = ['serious', 'moderate', 'minor'];

function SeverityRow({
  label,
  counts,
  side,
}: {
  label: string;
  counts: Record<Severity, number>;
  side: 'user' | 'other';
}) {
  return (
    <div className="mt-2.5 flex items-center gap-3">
      <span className={`w-[3.5em] shrink-0 text-[13px] font-semibold ${side === 'user' ? 'text-side-user' : 'text-side-other'}`}>
        {label}
      </span>
      <div className="flex flex-1 gap-1.5">
        {SEVERITY_ORDER.map((s) => (
          <span
            key={s}
            className={`flex-1 rounded-chip px-2 py-1.5 text-center text-[12px] ${
              counts[s] > 0
                ? s === 'serious'
                  ? 'bg-error-soft font-semibold text-error'
                  : s === 'moderate'
                    ? 'bg-warning-soft text-warning'
                    : 'bg-surface text-text-secondary'
                : 'bg-surface text-text-tertiary'
            }`}
          >
            {SEVERITY_LABELS[s]} <span className="tabular-nums">{counts[s]}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function MonthlyChart({ stats }: { stats: OverviewStats }) {
  const max = Math.max(1, ...stats.monthly.map((m) => Math.max(m.conflicts, m.positives + m.repairs)));
  return (
    <div className="mt-3">
      <div className="flex h-[88px] items-end gap-2" role="img" aria-label="月ごとの衝突と良い出来事の件数">
        {stats.monthly.map((m) => (
          <div key={m.month} className="flex flex-1 items-end justify-center gap-[3px]">
            <div
              className="w-[9px] rounded-t-[3px] bg-warning"
              style={{ height: `${(m.conflicts / max) * 80}px`, minHeight: m.conflicts > 0 ? 3 : 0 }}
              title={`衝突 ${m.conflicts}件`}
            />
            <div
              className="w-[9px] rounded-t-[3px] bg-success"
              style={{
                height: `${((m.positives + m.repairs) / max) * 80}px`,
                minHeight: m.positives + m.repairs > 0 ? 3 : 0,
              }}
              title={`良い出来事・修復 ${m.positives + m.repairs}件`}
            />
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-2 border-t border-border pt-1">
        {stats.monthly.map((m) => (
          <div key={m.month} className="flex-1 text-center text-[10.5px] text-text-tertiary">
            {Number(m.month.slice(5))}月
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex justify-center gap-4 text-[11px] text-text-secondary">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-sm bg-warning" />衝突
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-sm bg-success" />良い出来事・修復
        </span>
      </div>
    </div>
  );
}

function MiniCount({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-[17px] font-bold tabular-nums">{value}</div>
      <div className="text-[10.5px] leading-tight text-text-tertiary">{label}</div>
    </div>
  );
}

function PatternList({
  title,
  items,
  side,
}: {
  title: string;
  items: Array<{ id: string; label: string; count: number }>;
  side: 'user' | 'other';
}) {
  return (
    <div className="mt-2.5">
      <div className={`text-[12px] font-semibold ${side === 'user' ? 'text-side-user' : 'text-side-other'}`}>{title}</div>
      {items.length === 0 ? (
        <p className="mt-0.5 text-[12.5px] text-text-tertiary">繰り返しは記録されていません</p>
      ) : (
        <ul className="mt-0.5 space-y-0.5 text-[13px]">
          {items.map((i) => (
            <li key={i.id} className="flex justify-between gap-2">
              <span className="truncate">{i.label}</span>
              <span className="shrink-0 tabular-nums text-text-secondary">{i.count}件</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ③ AIによる全体の見解

export function OverallReviewSection({
  review,
  previous,
  stale,
  loading,
  error,
  canGenerate,
  outdatedCount,
  recordsById,
  onGenerate,
}: {
  review?: OverallReview;
  previous?: OverallReview;
  stale: boolean;
  loading: boolean;
  error: string | null;
  canGenerate: boolean;
  outdatedCount: number;
  recordsById: Map<string, IncidentRecord>;
  onGenerate: () => void;
}) {
  return (
    <Section title="AIによる全体の見解">
      {loading ? (
        <div className={`${card} py-8 text-center`} role="status">
          <div className="mx-auto mb-3 h-10 w-10 animate-spin360 rounded-full border-[3px] border-border border-t-accent" />
          <p className="text-[14px] font-semibold">記録全体を読み通しています…</p>
          <p className="mt-1 text-[12px] text-text-tertiary">数十秒かかることがあります。</p>
        </div>
      ) : !review ? (
        <div className={card}>
          <p className="text-[13.5px] leading-[1.8]">
            すべての記録を通して、どちらの課題が重いか、何が繰り返されているか、うまくいっていることは何かを、率直にまとめます。
          </p>
          <p className="mt-2 text-[11.5px] leading-relaxed text-text-tertiary">
            AIへ送るのは各記録の分析結果の要約とローカル集計だけで、記録の本文・音声・画像は送りません。
          </p>
          {outdatedCount > 0 && canGenerate && (
            <p className="mt-2 rounded-chip bg-warning-soft px-3 py-2 text-[12px] leading-relaxed text-text">
              旧基準の分析が{outdatedCount}件あります。先に「まとめて再分析」をすると、重さを踏まえた見解になります。
            </p>
          )}
          {error && <p className="mt-2 text-[12.5px] text-error">{error}</p>}
          <button onClick={onGenerate} disabled={!canGenerate} className={`mt-4 ${primaryButton}`}>
            全体の見解を作成する
          </button>
          {!canGenerate && (
            <p className="mt-2 text-center text-[11.5px] text-text-tertiary">分析済みの記録ができると作成できます。</p>
          )}
        </div>
      ) : (
        <ReviewBody
          review={review}
          previous={previous}
          stale={stale}
          error={error}
          canGenerate={canGenerate}
          outdatedCount={outdatedCount}
          recordsById={recordsById}
          onGenerate={onGenerate}
        />
      )}
    </Section>
  );
}

function ReviewBody({
  review,
  previous,
  stale,
  error,
  canGenerate,
  outdatedCount,
  recordsById,
  onGenerate,
}: {
  review: OverallReview;
  previous?: OverallReview;
  stale: boolean;
  error: string | null;
  canGenerate: boolean;
  outdatedCount: number;
  recordsById: Map<string, IncidentRecord>;
  onGenerate: () => void;
}) {
  const tendencySide =
    review.responsibilityTendency === 'user_heavier'
      ? 'text-side-user'
      : review.responsibilityTendency === 'other_heavier'
        ? 'text-side-other'
        : 'text-text';
  return (
    <div>
      {stale && (
        <div className="mb-3 flex items-center justify-between gap-3 rounded-card bg-warning-soft px-4 py-3">
          <p className="text-[12.5px] leading-relaxed text-text">
            作成後に記録が追加・更新されました{outdatedCount > 0 ? `（旧基準 ${outdatedCount}件）` : ''}。
          </p>
          <button
            onClick={onGenerate}
            disabled={!canGenerate}
            className="h-9 shrink-0 rounded-full bg-accent px-4 text-[13px] font-semibold text-accent-on active:opacity-80"
          >
            更新する
          </button>
        </div>
      )}

      <div className="rounded-card bg-surface px-4 py-4 text-[15px] leading-[1.9]">{review.overallView}</div>

      <div className="mt-3 grid grid-cols-1 gap-2">
        <div className={card}>
          <div className="text-[11.5px] text-text-tertiary">責任の傾向</div>
          <div className={`mt-0.5 text-[16px] font-bold ${tendencySide}`}>
            {RESPONSIBILITY_TENDENCY_LABELS[review.responsibilityTendency]}
          </div>
          <p className="mt-1 text-[13px] leading-[1.75] text-text-secondary">{review.responsibilityReason}</p>
        </div>
        <div className={card}>
          <div className="text-[11.5px] text-text-tertiary">関係の傾向</div>
          <div className="mt-0.5 text-[16px] font-bold">{RELATIONSHIP_TREND_LABELS[review.relationshipTrend]}</div>
          <p className="mt-1 text-[13px] leading-[1.75] text-text-secondary">{review.trendReason}</p>
        </div>
      </div>

      {previous && (previous.responsibilityTendency !== review.responsibilityTendency || previous.relationshipTrend !== review.relationshipTrend) && (
        <p className="mt-2 text-[11.5px] leading-relaxed text-text-tertiary">
          前回（{formatRecordDate(previous.generatedAt)}）: {RESPONSIBILITY_TENDENCY_LABELS[previous.responsibilityTendency]} /{' '}
          {RELATIONSHIP_TREND_LABELS[previous.relationshipTrend]}
        </p>
      )}

      {review.safetyConcerns && (
        <div className="mt-4 rounded-card bg-error-soft px-4 py-4" role="alert">
          <div className="flex items-center gap-2 text-[14.5px] font-bold text-error">
            <AlertTriangleIcon width={18} height={18} />
            安全について
          </div>
          <p className="mt-1.5 text-[13.5px] leading-[1.8]">{review.safetyConcerns}</p>
        </div>
      )}

      <IssueGroup title="自分側の繰り返しの課題" side="user" issues={review.userRecurringIssues} recordsById={recordsById} />
      <IssueGroup title="相手側の繰り返しの課題" side="other" issues={review.otherRecurringIssues} recordsById={recordsById} />

      <TextList title="うまくいっていること" items={review.strengths} tone="success" />
      <TextList title="衝突が起きやすいきっかけ" items={review.conflictTriggers} />
      {review.childImpact && (
        <Section title="子どもへの影響">
          <p className="text-[14px] leading-[1.8]">{review.childImpact}</p>
        </Section>
      )}
      <NumberedList title="あなたが取り組むと効果が大きいこと" items={review.userFocus} />
      <NumberedList title="相手に求めてよいこと" items={review.requestsToOther} />
      <TextList title="記録からは判断できないこと" items={review.cannotJudge} muted />

      {review.closingMessage && (
        <p className="mt-6 border-l-[3px] border-accent pl-3 text-[14px] leading-[1.85]">{review.closingMessage}</p>
      )}

      {error && <p className="mt-3 text-[12.5px] text-error">{error}</p>}
      <button onClick={onGenerate} disabled={!canGenerate} className={`${ghostButton} mt-4 w-full`}>
        <RefreshIcon width={15} height={15} />
        作り直す
      </button>

      <p className="mt-4 text-[11px] leading-relaxed text-text-tertiary">
        記録に基づく整理であり、診断や法的判断ではありません。記録は一方（あなた）が書いたもので、衝突の方が記録されやすい点に注意してください。
        <br />
        {formatRecordDate(review.generatedAt)}作成 / 要約した記録 {review.includedCount}件
        {review.outdatedCount > 0 ? `（うち旧基準 ${review.outdatedCount}件）` : ''} / モデル {review.aiModel}
      </p>
    </div>
  );
}

function IssueGroup({
  title,
  side,
  issues,
  recordsById,
}: {
  title: string;
  side: 'user' | 'other';
  issues: RecurringIssue[];
  recordsById: Map<string, IncidentRecord>;
}) {
  return (
    <section className="mt-6">
      <h2 className={`mb-2 text-[13px] font-semibold ${side === 'user' ? 'text-side-user' : 'text-side-other'}`}>{title}</h2>
      {issues.length === 0 ? (
        <p className="rounded-card border border-dashed border-border px-4 py-3 text-[13px] text-text-tertiary">
          繰り返し見られる課題は記録されていません。
        </p>
      ) : (
        <ul className="space-y-2">
          {issues.map((issue, i) => (
            <li key={i} className="rounded-card border border-border px-4 py-3">
              <p className="text-[14px] leading-relaxed">{issue.text}</p>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <SeverityBadge severity={issue.severity} />
                <span className="text-[11.5px] text-text-tertiary">{issue.count}件の記録</span>
              </div>
              {issue.recordIds.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {issue.recordIds.slice(0, 6).map((id) => {
                    const r = recordsById.get(id);
                    if (!r) return null;
                    return (
                      <Link
                        key={id}
                        href={`/factnote/records/${id}`}
                        className="inline-flex h-7 max-w-[11rem] items-center rounded-full bg-surface px-2.5 text-[11.5px] text-text-secondary active:opacity-60"
                      >
                        <span className="truncate">
                          {formatRecordDate(r.occurredAt ?? r.createdAt)} {r.title || '無題'}
                        </span>
                      </Link>
                    );
                  })}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function TextList({
  title,
  items,
  tone,
  muted,
}: {
  title: string;
  items: string[];
  tone?: 'success';
  muted?: boolean;
}) {
  if (items.length === 0) return null;
  return (
    <Section title={title}>
      <ul className="space-y-1.5">
        {items.map((t, i) => (
          <li
            key={i}
            className={`flex gap-2 text-[14px] leading-[1.75] ${muted ? 'text-text-secondary' : ''}`}
          >
            <span className={tone === 'success' ? 'text-success' : 'text-text-tertiary'}>・</span>
            {t}
          </li>
        ))}
      </ul>
    </Section>
  );
}

function NumberedList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <Section title={title}>
      <ol className="space-y-2">
        {items.map((t, i) => (
          <li key={i} className="flex gap-2.5 rounded-card bg-surface px-4 py-3 text-[14px] leading-relaxed">
            <span className="font-semibold text-accent">{i + 1}.</span>
            {t}
          </li>
        ))}
      </ol>
    </Section>
  );
}

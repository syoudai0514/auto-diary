'use client';

import { useState } from 'react';
import Link from 'next/link';
import { RefreshIcon } from '@/components/icons';
import {
  REVIEW_PERIOD_LABELS,
  type AggregatedItem,
  type IncidentRecord,
  type ObjectiveProfileSummary,
  type PersonProfile,
  type ReviewPeriod,
} from '@/lib/factnote/types';
import { Badge, FactnoteHeader, Section, formatRecordDate } from './common';

const PERIODS: ReviewPeriod[] = ['7_days', '30_days', '3_months', '6_months', '1_year', 'all'];

export interface AiSummaryState {
  text: string;
  loading: boolean;
  error: string | null;
  fromCache: boolean;
}

/**
 * 人物別の客観カルテ（追加依頼 §5〜§8）。
 * 集計はすべてローカル。AIには集計値だけを送って短い講評を生成する。
 */
export function CarteScreen({
  person,
  summary,
  targetRecords,
  period,
  onPeriodChange,
  aiSummary,
  onGenerateSummary,
}: {
  person: PersonProfile;
  summary: ObjectiveProfileSummary;
  /** 集計対象の記録（テーマタップでの一覧展開に使う）。 */
  targetRecords: IncidentRecord[];
  period: ReviewPeriod;
  onPeriodChange: (p: ReviewPeriod) => void;
  aiSummary: AiSummaryState;
  onGenerateSummary: () => void;
}) {
  const total = summary.totalRecords;
  const pct = (n: number) => (total > 0 ? ` (${Math.round((n / total) * 100)}%)` : '');
  const lastRecordAt = targetRecords[0]?.occurredAt ?? targetRecords[0]?.createdAt;

  return (
    <div className="flex min-h-dvh flex-col pt-safe">
      <FactnoteHeader title={person.displayName} backHref="/factnote/carte" />
      <div className="flex-1 overflow-y-auto px-6 pb-safe">
        <div className="pt-1 text-[12px] text-text-tertiary">
          {person.relationship ?? ''}
          {person.aliases.length > 0 ? ` ・ 別名: ${person.aliases.join('、')}` : ''}
          {lastRecordAt ? ` ・ 最終記録 ${formatRecordDate(lastRecordAt)}` : ''}
        </div>

        {/* 期間切り替え */}
        <div className="-mx-6 mt-3 flex gap-2 overflow-x-auto px-6 pb-1">
          {PERIODS.map((p) => (
            <button
              key={p}
              onClick={() => onPeriodChange(p)}
              className={`h-9 shrink-0 whitespace-nowrap rounded-chip border px-3.5 text-[13px] active:opacity-70 ${
                period === p ? 'border-accent bg-accent text-accent-on' : 'border-border bg-surface text-text'
              }`}
            >
              {REVIEW_PERIOD_LABELS[p]}
            </button>
          ))}
        </div>

        {/* 記録の偏り・件数不足の注意（少ない件数から強い結論を出さない） */}
        {summary.dataBiasWarnings.map((w, i) => (
          <p key={i} className="mt-3 rounded-card bg-warning-soft px-4 py-3 text-[12.5px] leading-relaxed">
            {w}
          </p>
        ))}

        {/* AI講評（集計値のみ送信） */}
        <Section title="AIによる講評">
          {aiSummary.text ? (
            <div className="rounded-card bg-surface px-4 py-4">
              <p className="text-[14px] leading-[1.85]">{aiSummary.text}</p>
              <div className="mt-2 flex items-center justify-between">
                <span className="text-[11px] text-text-tertiary">
                  {aiSummary.fromCache ? '前回生成分（記録に変化があると再生成できます）' : '生成済み'}
                </span>
                <button
                  onClick={onGenerateSummary}
                  disabled={aiSummary.loading}
                  className="flex h-8 items-center gap-1 rounded-full border border-border px-3 text-[12px] active:opacity-60 disabled:opacity-40"
                >
                  <RefreshIcon width={13} height={13} />
                  再生成
                </button>
              </div>
            </div>
          ) : (
            <div className="rounded-card border border-border px-4 py-4">
              <p className="text-[12.5px] leading-relaxed text-text-secondary">
                AIに送られるのは件数・パターンなどの集計値のみで、記録の本文や名前は送信されません。
              </p>
              <button
                onClick={onGenerateSummary}
                disabled={aiSummary.loading || total === 0}
                className="mt-3 h-11 w-full rounded-full bg-accent text-[14px] font-semibold text-accent-on disabled:opacity-40"
              >
                {aiSummary.loading ? '生成中…' : '講評を生成する'}
              </button>
              {aiSummary.error && <p className="mt-2 text-[12px] text-error">{aiSummary.error}</p>}
            </div>
          )}
        </Section>

        {/* サマリー */}
        <Section title={`サマリー（${REVIEW_PERIOD_LABELS[period]}・全${total}件）`}>
          <div className="grid grid-cols-2 gap-2">
            <StatCell label="衝突した出来事" value={`${summary.conflictCount}件${pct(summary.conflictCount)}`} />
            <StatCell label="良い出来事" value={`${summary.positiveEventCount}件${pct(summary.positiveEventCount)}`} />
            <StatCell label="修復行動" value={`${summary.repairActionCount}件${pct(summary.repairActionCount)}`} />
            <StatCell label="謝罪があった記録" value={`${summary.apologyCount}件${pct(summary.apologyCount)}`} />
            <StatCell label="感謝があった記録" value={`${summary.gratitudeCount}件${pct(summary.gratitudeCount)}`} />
            <StatCell label="強い言葉があった記録" value={`${summary.strongLanguageCount}件${pct(summary.strongLanguageCount)}`} />
            <StatCell label="子どもが同席した記録" value={`${summary.childPresentCount}件${pct(summary.childPresentCount)}`} />
            <StatCell label="判断材料不足の記録" value={`${summary.insufficientEvidenceCount}件${pct(summary.insufficientEvidenceCount)}`} />
          </div>
        </Section>

        {/* 最近の傾向（週ごとの簡易表示） */}
        <TrendSection records={targetRecords} />

        <AggregatedSection title="よく出るテーマ" items={summary.commonThemes} records={targetRecords} />
        <AggregatedSection
          title="よく出る表現（発言パターンとして）"
          items={summary.commonExpressions}
          records={targetRecords}
          note="語句の一致による参考値です。発言者の断定はしていません。"
        />
        <AggregatedSection title="よくある衝突の状況" items={summary.conflictPatterns} records={targetRecords} note="記録上の傾向であり、断定ではありません。" />
        <AggregatedSection
          title="自分側の繰り返しパターン"
          items={summary.userPatterns}
          records={targetRecords}
          note="責めるためではなく、仕組みで防ぐための確認です。"
        />
        <AggregatedSection title="相手側の発言・行動パターン" items={summary.otherPartyPatterns} records={targetRecords} note="人格ではなく、記録された発言・行動の集計です。" />
        <AggregatedSection title="良い出来事" items={summary.positiveActions} records={targetRecords} />
        <AggregatedSection title="修復の可能性がある行動" items={summary.repairActions} records={targetRecords} note="意図は断定できません。" />

        <p className="mb-6 mt-10 text-[11px] leading-relaxed text-text-tertiary">
          このカルテは診断ではなく、記録の集計です。一件の出来事や少ない記録から、人物や関係全体を断定しないでください。
        </p>
      </div>
    </div>
  );
}

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-card border border-border px-3 py-2.5">
      <div className="text-[11px] text-text-tertiary">{label}</div>
      <div className="mt-0.5 text-[15px] font-semibold tabular-nums">{value}</div>
    </div>
  );
}

/** 週ごとの簡易傾向（過剰な分析画面にしない — 追加依頼 §5.3）。 */
function TrendSection({ records }: { records: IncidentRecord[] }) {
  if (records.length === 0) return null;
  const now = Date.now();
  const WEEK = 7 * 24 * 60 * 60 * 1000;
  const weeks = Array.from({ length: 8 }, (_, i) => {
    const end = now - i * WEEK;
    const start = end - WEEK;
    const inWeek = records.filter((r) => {
      const t = Date.parse(r.occurredAt ?? r.createdAt);
      return t > start && t <= end;
    });
    return {
      label: i === 0 ? '今週' : `${i}週前`,
      conflict: inWeek.filter((r) => r.isConflict).length,
      positive: inWeek.filter((r) => r.isPositiveEvent).length,
      repair: inWeek.filter((r) => r.isRepairAction).length,
    };
  });
  if (weeks.every((w) => w.conflict + w.positive + w.repair === 0)) return null;
  return (
    <Section title="最近の傾向（直近8週）">
      <div className="rounded-card border border-border px-4 py-3">
        <ul className="space-y-1.5">
          {weeks.map((w) => (
            <li key={w.label} className="flex items-center gap-2 text-[12px]">
              <span className="w-12 shrink-0 text-text-tertiary">{w.label}</span>
              <span className="flex flex-wrap gap-1" aria-label={`衝突${w.conflict}件、良い出来事${w.positive}件、修復${w.repair}件`}>
                {Array.from({ length: w.conflict }).map((_, i) => (
                  <span key={`c${i}`} className="h-3 w-3 rounded-sm bg-warning" title="衝突" />
                ))}
                {Array.from({ length: w.positive }).map((_, i) => (
                  <span key={`p${i}`} className="h-3 w-3 rounded-sm bg-success" title="良い出来事" />
                ))}
                {Array.from({ length: w.repair }).map((_, i) => (
                  <span key={`r${i}`} className="h-3 w-3 rounded-sm bg-accent" title="修復" />
                ))}
              </span>
            </li>
          ))}
        </ul>
        <div className="mt-2 flex gap-3 text-[11px] text-text-tertiary">
          <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-warning" />衝突</span>
          <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-success" />良い出来事</span>
          <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-accent" />修復</span>
        </div>
      </div>
    </Section>
  );
}

/** 集計項目のリスト。タップで該当記録の一覧を展開する（§5.4）。 */
function AggregatedSection({
  title,
  items,
  records,
  note,
}: {
  title: string;
  items: AggregatedItem[];
  records: IncidentRecord[];
  note?: string;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  if (items.length === 0) return null;
  const byId = new Map(records.map((r) => [r.id, r]));
  return (
    <Section title={title}>
      {note && <p className="-mt-1 mb-2 text-[11.5px] text-text-tertiary">{note}</p>}
      <ul className="space-y-2">
        {items.map((item) => {
          const open = openId === item.id;
          const linked = item.recordIds.map((id) => byId.get(id)).filter(Boolean) as IncidentRecord[];
          return (
            <li key={item.id} className="rounded-card border border-border">
              <button
                onClick={() => setOpenId(open ? null : item.id)}
                aria-expanded={open}
                className="flex min-h-[44px] w-full items-center justify-between gap-2 px-4 py-2.5 text-left active:opacity-70"
              >
                <span className="min-w-0">
                  <span className="block text-[14px]">{item.label}</span>
                  {item.description && (
                    <span className="block text-[12px] text-text-tertiary">{item.description}</span>
                  )}
                </span>
                <Badge label={`${item.count}件`} tone={open ? 'accent' : 'neutral'} />
              </button>
              {open && linked.length > 0 && (
                <ul className="border-t border-border px-4 py-1">
                  {linked.map((r) => (
                    <li key={r.id}>
                      <Link
                        href={`/factnote/records/${r.id}`}
                        className="flex min-h-[40px] items-center gap-2 text-[13px] text-text-secondary active:opacity-60"
                      >
                        <span className="text-[11px] text-text-tertiary">
                          {formatRecordDate(r.occurredAt ?? r.createdAt)}
                        </span>
                        <span className="truncate">{r.title || '無題の記録'}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

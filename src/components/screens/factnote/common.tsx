'use client';

import Link from 'next/link';
import {
  ChevronLeftIcon,
  ChevronRightIcon,
} from '@/components/icons';
import {
  CONFIDENCE_LABELS,
  RECORD_SOURCE_LABELS,
  type ConfidenceLevel,
  type IncidentRecord,
} from '@/lib/factnote/types';

/** 事実ノート共通ヘッダー。backHref があれば戻るボタンを表示する。 */
export function FactnoteHeader({
  title,
  backHref,
  right,
}: {
  title: string;
  backHref?: string;
  right?: React.ReactNode;
}) {
  return (
    <header className="flex items-center justify-between gap-3 px-6 pt-4">
      <div className="flex min-w-0 items-center gap-2">
        {backHref && (
          <Link
            href={backHref}
            aria-label="戻る"
            className="-ml-2 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-text active:opacity-60"
          >
            <ChevronLeftIcon width={22} height={22} />
          </Link>
        )}
        <h1 className="truncate text-[22px] font-bold">{title}</h1>
      </div>
      {right}
    </header>
  );
}

type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'error';

const BADGE_TONE_CLASS: Record<BadgeTone, string> = {
  neutral: 'border border-border text-text-secondary',
  accent: 'bg-surface text-accent',
  success: 'bg-surface text-success',
  warning: 'bg-warning-soft text-warning',
  error: 'bg-error-soft text-error',
};

/** 状態バッジ。色だけに頼らずラベル文字で状態を示す（依頼書 §30）。 */
export function Badge({ label, tone = 'neutral' }: { label: string; tone?: BadgeTone }) {
  return (
    <span
      className={`inline-flex h-[22px] items-center whitespace-nowrap rounded-full px-2 text-[11px] font-medium ${BADGE_TONE_CLASS[tone]}`}
    >
      {label}
    </span>
  );
}

/** 確信度バッジ（分析項目に併記。依頼書 §10.3）。 */
export function ConfidenceBadge({ level }: { level: ConfidenceLevel }) {
  const tone: BadgeTone = level === 'high' ? 'success' : level === 'medium' ? 'neutral' : 'warning';
  return <Badge label={CONFIDENCE_LABELS[level]} tone={tone} />;
}

/** セクション見出し + 本体（分析結果・詳細画面で共用）。 */
export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-7">
      <h2 className="mb-2 text-[13px] font-semibold text-text-secondary">{title}</h2>
      {children}
    </section>
  );
}

export function formatRecordDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

/** レコードの状態・種別のバッジ列。 */
export function RecordBadges({ record }: { record: IncidentRecord }) {
  return (
    <div className="mt-1 flex flex-wrap gap-1.5">
      <Badge label={RECORD_SOURCE_LABELS[record.sourceType]} />
      {record.status === 'transcribing' ? (
        <Badge label="文字起こし中…" tone="accent" />
      ) : record.status === 'analyzing' ? (
        <Badge label="分析中…" tone="accent" />
      ) : record.status === 'ready' && record.analysis ? (
        <Badge label="分析済み" tone="accent" />
      ) : record.status === 'error' ? (
        <Badge label="エラー" tone="error" />
      ) : (
        <Badge label="未分析" />
      )}
      {record.isPositiveEvent && <Badge label="良い出来事" tone="success" />}
      {record.isConflict && <Badge label="衝突" tone="warning" />}
      {record.isRepairAction && <Badge label="修復" tone="success" />}
      {record.childrenPresent === 'yes' && <Badge label="子ども同席" />}
      {record.diaryVersions.length > 0 && <Badge label="日記あり" />}
    </div>
  );
}

/** 記録一覧・ホームで共用する1行。 */
export function RecordRow({ record, href }: { record: IncidentRecord; href: string }) {
  return (
    <li className="border-b border-border">
      <Link
        href={href}
        className="flex min-h-[44px] w-full items-center gap-3 py-3.5 text-left active:opacity-60"
      >
        <div className="min-w-0 flex-1">
          <div className="text-[12px] text-text-tertiary">
            {formatRecordDate(record.occurredAt ?? record.createdAt)}
          </div>
          <div className="mt-0.5 truncate text-[16px] font-semibold text-text">
            {record.title || '無題の記録'}
          </div>
          <RecordBadges record={record} />
        </div>
        <ChevronRightIcon width={20} height={20} className="shrink-0 text-text-tertiary" />
      </Link>
    </li>
  );
}

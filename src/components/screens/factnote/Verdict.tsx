'use client';

import {
  EVIDENCE_BASIS_LABELS,
  SEVERITY_LABELS,
  VERDICT_LEANING_LABELS,
  VERDICT_ROBUSTNESS_LABELS,
  type EvidenceBasis,
  type IncidentVerdict,
  type Severity,
  type VerdictLeaning,
} from '@/lib/factnote/types';
import { LEANING_SCALE } from '@/lib/factnote/overview';
import { Badge } from './common';

/**
 * 判定まわりの共通部品（一件の分析と全体の見解で共用）。
 * 色は「自分側 = テラコッタ / 相手側 = 青灰」。善悪を連想させる赤・緑は使わず、
 * 色だけに頼らないよう必ず文字ラベルを併記する（依頼書 §30）。
 */

export function leaningSide(leaning: VerdictLeaning): 'user' | 'other' | 'even' | 'none' {
  if (leaning === 'user_mainly' || leaning === 'user_more') return 'user';
  if (leaning === 'other_mainly' || leaning === 'other_more') return 'other';
  if (leaning === 'comparable') return 'even';
  return 'none';
}

const SIDE_TEXT_CLASS = {
  user: 'text-side-user',
  other: 'text-side-other',
  even: 'text-text',
  none: 'text-text-secondary',
} as const;

/** 5段階の判定スケール（自分側 ←→ 相手側）。スケール外の判定ではマーカーを出さない。 */
export function LeaningScale({ leaning, compact }: { leaning: VerdictLeaning; compact?: boolean }) {
  const index = LEANING_SCALE.indexOf(leaning);
  return (
    <div aria-hidden className={compact ? '' : 'mt-3'}>
      <div className="flex gap-1">
        {LEANING_SCALE.map((l, i) => {
          const active = i === index;
          const side = leaningSide(l);
          const color =
            side === 'user' ? 'bg-side-user' : side === 'other' ? 'bg-side-other' : 'bg-text-tertiary';
          return (
            <div
              key={l}
              className={`h-2.5 flex-1 rounded-full transition-opacity ${color} ${
                index === -1 ? 'opacity-15' : active ? 'opacity-100' : 'opacity-20'
              }`}
            />
          );
        })}
      </div>
      {!compact && (
        <div className="mt-1.5 flex justify-between text-[11px] text-text-tertiary">
          <span>自分側が重い</span>
          <span>同程度</span>
          <span>相手側が重い</span>
        </div>
      )}
    </div>
  );
}

export function LeaningLabel({ leaning, className = '' }: { leaning: VerdictLeaning; className?: string }) {
  return (
    <span className={`font-bold ${SIDE_TEXT_CLASS[leaningSide(leaning)]} ${className}`}>
      {VERDICT_LEANING_LABELS[leaning]}
    </span>
  );
}

export function SeverityBadge({ severity }: { severity: Severity }) {
  return (
    <Badge
      label={SEVERITY_LABELS[severity]}
      tone={severity === 'serious' ? 'error' : severity === 'moderate' ? 'warning' : 'neutral'}
    />
  );
}

export function BasisBadge({ basis }: { basis: EvidenceBasis }) {
  return <Badge label={EVIDENCE_BASIS_LABELS[basis]} tone={basis === 'verified' ? 'success' : 'neutral'} />;
}

/** 一件の出来事の判定カード（分析結果のいちばん上に表示する）。 */
export function VerdictCard({ verdict }: { verdict: IncidentVerdict }) {
  const onScale = LEANING_SCALE.includes(verdict.leaning);
  return (
    <section className="mt-5 rounded-card border border-border bg-surface px-4 py-4" aria-label="今回の判定">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[12px] font-semibold text-text-secondary">今回の判定</span>
        <Badge
          label={VERDICT_ROBUSTNESS_LABELS[verdict.robustness]}
          tone={verdict.robustness === 'firm' ? 'success' : verdict.robustness === 'fragile' ? 'warning' : 'neutral'}
        />
      </div>
      <div className="mt-1.5 text-[19px] leading-snug">
        <LeaningLabel leaning={verdict.leaning} />
      </div>
      {onScale && <LeaningScale leaning={verdict.leaning} />}
      <p className="mt-3 text-[15.5px] font-semibold leading-[1.7]">{verdict.headline}</p>
      <p className="mt-2 text-[13.5px] leading-[1.8] text-text-secondary">{verdict.reasoning}</p>

      <div className="mt-3 space-y-1.5">
        {verdict.roleReversalCheck && (
          <Disclosure title="立場を入れ替えても同じ判定か">{verdict.roleReversalCheck}</Disclosure>
        )}
        {verdict.whatWouldChange && (
          <Disclosure title="判定が変わりうる条件">{verdict.whatWouldChange}</Disclosure>
        )}
      </div>
    </section>
  );
}

export function Disclosure({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details className="group rounded-chip bg-bg px-3 py-2">
      <summary className="flex min-h-[32px] cursor-pointer list-none items-center justify-between text-[12.5px] font-semibold text-text-secondary">
        {title}
        <span className="text-[11px] text-text-tertiary group-open:hidden">開く</span>
        <span className="hidden text-[11px] text-text-tertiary group-open:inline">閉じる</span>
      </summary>
      <div className="pb-1 pt-1 text-[13px] leading-[1.8] text-text">{children}</div>
    </details>
  );
}

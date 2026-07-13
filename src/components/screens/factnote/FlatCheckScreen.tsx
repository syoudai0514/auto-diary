'use client';

import Link from 'next/link';
import { ScaleIcon } from '@/components/icons';
import {
  FLAT_CHECK_SCOPE_LABELS,
  type AnalysisItem,
  type FlatCheckResult,
  type FlatCheckScope,
  type FutureSelfMemo,
  type IncidentRecord,
} from '@/lib/factnote/types';
import { Badge, ConfidenceBadge, FactnoteHeader, Section } from './common';
import { FutureMemoCard } from './FutureMemoCard';

const SCOPES: FlatCheckScope[] = [
  'current_only',
  'current_and_7_days',
  'current_and_30_days',
  'current_and_3_months',
  'current_and_all',
];

/** フラットチェックの対象範囲選択（追加依頼 §11 / §26 の送信範囲の明示）。 */
export function FlatCheckScopeScreen({
  record,
  pastCounts,
  recommended,
  onRun,
}: {
  record: IncidentRecord;
  /** スコープごとの過去記録件数。 */
  pastCounts: Record<FlatCheckScope, number>;
  recommended: FlatCheckScope;
  onRun: (scope: FlatCheckScope) => void;
}) {
  return (
    <div className="flex min-h-dvh flex-col pt-safe">
      <FactnoteHeader title="フラットチェック" backHref={`/factnote/records/${record.id}`} />
      <div className="flex-1 overflow-y-auto px-6 pb-safe">
        <p className="pt-1 text-[13px] leading-relaxed text-text-secondary">
          今回の出来事と、過去の傾向を分けて確認します。比較する範囲を選んでください。
        </p>
        <p className="mt-2 rounded-card border border-border px-3 py-2.5 text-[12px] leading-relaxed text-text-tertiary">
          AIに送信されるのは「今回の記録の本文」と「過去記録の件数・パターンの集計値」だけです。過去の記録の本文は送信されません。
        </p>
        <ul className="mt-4 space-y-2">
          {SCOPES.map((scope) => (
            <li key={scope}>
              <button
                onClick={() => onRun(scope)}
                className="flex min-h-[56px] w-full items-center justify-between gap-2 rounded-card border border-border bg-surface px-4 py-3 text-left active:opacity-70"
              >
                <span>
                  <span className="block text-[15px] font-medium">
                    {FLAT_CHECK_SCOPE_LABELS[scope]}
                    {scope === recommended && (
                      <span className="ml-2 text-[11px] font-semibold text-accent">おすすめ</span>
                    )}
                  </span>
                  <span className="block text-[12px] text-text-tertiary">
                    {scope === 'current_only'
                      ? '過去との比較なし'
                      : `過去の記録 ${pastCounts[scope]}件と比較`}
                  </span>
                </span>
                <ScaleIcon width={18} height={18} className="shrink-0 text-text-tertiary" />
              </button>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-[11.5px] leading-relaxed text-text-tertiary">
          記録が少ない範囲では、長期傾向としての判断はできません。その場合は結果にもその旨が表示されます。
        </p>
      </div>
    </div>
  );
}

/** フラットチェックの結果（追加依頼 §12）。 */
export function FlatCheckResultScreen({
  record,
  result,
  fromCache,
  memos,
  onCloseMemo,
  onRegenerate,
}: {
  record: IncidentRecord;
  result: FlatCheckResult;
  fromCache: boolean;
  /** 表示条件に合致した未来メモ（結論を急いでいる可能性への備え。§18.2）。 */
  memos: FutureSelfMemo[];
  onCloseMemo: (memo: FutureSelfMemo) => void;
  onRegenerate: () => void;
}) {
  const hasSafety = (record.analysis?.safetyFlags.length ?? 0) > 0;
  return (
    <div className="flex min-h-dvh flex-col pt-safe">
      <FactnoteHeader title="フラットチェック" backHref={`/factnote/records/${record.id}`} />
      <div className="flex-1 overflow-y-auto px-6 pb-safe">
        <div className="pt-1 text-[12px] text-text-tertiary">
          対象: {FLAT_CHECK_SCOPE_LABELS[result.scope]}
          {fromCache ? ' ・ 前回の結果（記録に変化がなければ同じ内容です）' : ''}
        </div>

        {/* 安全が最優先（追加依頼 §25） */}
        {hasSafety && (
          <div className="mt-3 rounded-card bg-error-soft px-4 py-3 text-[13px] leading-relaxed" role="alert">
            この記録には安全に関わる内容が含まれています。今すぐ危険がある場合は、結論を考えるより先に、安全な場所への移動・信頼できる人への連絡・警察（110）や相談窓口の利用を優先してください。
          </div>
        )}

        {/* 未来の自分からのメモ（安全問題がある場合は出さない） */}
        {!hasSafety &&
          memos.map((memo) => (
            <div key={memo.id} className="mt-3">
              <FutureMemoCard memo={memo} recordId={record.id} onClose={() => onCloseMemo(memo)} />
            </div>
          ))}

        {/* 最初の結論 */}
        <div className="mt-4 rounded-card bg-surface px-4 py-4 text-[15px] leading-[1.85]">
          {result.conciseConclusion}
        </div>

        <ItemList title="今回の自分側の改善点" items={result.userImprovementPoints} badge="明確な改善点" />
        <ItemList title="今回の相手側の問題点" items={result.otherPartyProblemPoints} badge="相手側の明確な問題" />
        <ItemList title="今回判断できないこと" items={result.unknowns} badge="判断材料不足" />
        <ItemList
          title="今回だけでは判断しない方がいいこと"
          items={result.avoidJudgingFromThisIncident}
          badge="今回限りの可能性"
        />

        {result.pastComparison.length > 0 && (
          <Section title="過去との比較（ローカル集計）">
            <ul className="space-y-2">
              {result.pastComparison.map((item) => (
                <li key={item.id} className="flex items-center justify-between gap-2 rounded-card border border-border px-4 py-2.5">
                  <span className="text-[14px]">{item.label}</span>
                  <Badge label={`${item.count}件`} tone={item.count > 0 ? 'accent' : 'neutral'} />
                </li>
              ))}
            </ul>
          </Section>
        )}

        {result.dataBiasWarnings.length > 0 && (
          <Section title="記録の偏りチェック">
            {result.dataBiasWarnings.map((w, i) => (
              <p key={i} className="mb-2 rounded-card bg-warning-soft px-4 py-3 text-[13px] leading-relaxed">
                {w}
              </p>
            ))}
          </Section>
        )}

        <ItemList title="良くなっている点" items={result.improvingPoints} badge="改善の記録あり" tone="success" />

        <Section title="AIからの一言">
          <p className="rounded-card border-2 border-border px-4 py-4 text-[15px] leading-[1.85]">
            {result.aiMessage}
          </p>
        </Section>

        <div className="mb-6 mt-8 flex flex-col items-center gap-2">
          <button
            onClick={onRegenerate}
            className="min-h-[44px] text-[13px] text-text-secondary active:opacity-60"
          >
            再生成する（AIを再実行）
          </button>
          <Link
            href={`/factnote/records/${record.id}`}
            className="flex h-12 w-full items-center justify-center rounded-full bg-accent text-[15px] font-semibold text-accent-on shadow-cta"
          >
            記録に戻る
          </Link>
          <p className="text-[11px] text-text-tertiary">
            モデル: {result.aiModel} / {new Date(result.createdAt).toLocaleString('ja-JP')}
          </p>
        </div>
      </div>
    </div>
  );
}

function ItemList({
  title,
  items,
  badge,
  tone,
}: {
  title: string;
  items: AnalysisItem[];
  badge?: string;
  tone?: 'success';
}) {
  if (items.length === 0) return null;
  return (
    <Section title={title}>
      <ul className="space-y-2">
        {items.map((it) => (
          <li key={it.id} className="rounded-card border border-border px-4 py-3">
            <p className="text-[14px] leading-relaxed">{it.text}</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {badge && <Badge label={badge} tone={tone ?? 'neutral'} />}
              <ConfidenceBadge level={it.confidence} />
            </div>
          </li>
        ))}
      </ul>
    </Section>
  );
}

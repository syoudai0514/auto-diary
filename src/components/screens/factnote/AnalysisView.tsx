'use client';

import { useState } from 'react';
import { AlertTriangleIcon, CheckIcon, CopyIcon, RefreshIcon } from '@/components/icons';
import { copyText } from '@/lib/clipboard';
import {
  ISSUE_ACTOR_LABELS,
  RESPONSIBILITY_JUDGMENT_LABELS,
  VERDICT_LEANING_LABELS,
  type AnalysisItem,
  type IncidentAnalysis,
  type ResponsibilityItem,
} from '@/lib/factnote/types';
import { Badge, ConfidenceBadge, Section } from './common';
import { BasisBadge, LeaningLabel, SeverityBadge, VerdictCard } from './Verdict';

/**
 * AI分析結果の表示（依頼書 §12 の全セクション + §13 論点別責任 + §6.4 安全確認カード）。
 * 分析フローの結果画面と記録詳細の「分析」タブで共用する。
 *
 * v3 の表示方針: いちばん上に「今回の判定」を置き、各側の問題は件数ではなく重さ
 * （軽微/中程度/重大）と根拠の種類（記録で確認/本人の記憶/推測）で見せる。
 */
export function AnalysisView({
  analysis,
  previousAnalysis,
  onReanalyze,
}: {
  analysis: IncidentAnalysis;
  /** 再分析前の分析（あれば判定の変化を表示する）。 */
  previousAnalysis?: IncidentAnalysis;
  /** 旧基準の分析に「最新の基準で分析し直す」ボタンを出す場合に渡す。 */
  onReanalyze?: () => void;
}) {
  const replies = [
    { label: 'やわらかい', text: analysis.replySuggestions.gentle },
    { label: '標準', text: analysis.replySuggestions.standard },
    { label: '境界線を明確にする', text: analysis.replySuggestions.firm },
  ].filter((r) => r.text.trim().length > 0);

  return (
    <div className="pb-4">
      {analysis.safetyFlags.length > 0 && <SafetyCard analysis={analysis} />}

      {analysis.verdict ? (
        <VerdictCard verdict={analysis.verdict} />
      ) : (
        <LegacyNotice onReanalyze={onReanalyze} />
      )}

      {previousAnalysis && <VerdictChange previous={previousAnalysis} current={analysis} />}

      {/* §12.1 最初の短い見解 */}
      <div className="mt-4 rounded-card bg-surface px-4 py-4 text-[15px] leading-[1.85]">
        {analysis.conciseView}
      </div>

      <IssueSection
        title="自分側の改善点"
        suggestionLabel="次からは"
        items={analysis.userImprovementPoints}
        empty={analysis.verdict ? '今回、自分側に指摘すべき問題はありません。' : undefined}
      />
      <IssueSection
        title="相手側の問題点"
        suggestionLabel="相手が直すとよいこと"
        items={analysis.otherPartyProblemPoints}
        empty={analysis.verdict ? '今回、相手側に指摘すべき問題はありません。' : undefined}
      />

      {analysis.responsibilityBreakdown.length > 0 && (
        <Section title="論点ごとの整理">
          <ul className="space-y-2">
            {analysis.responsibilityBreakdown.map((row) => (
              <ResponsibilityRow key={row.id} row={row} />
            ))}
          </ul>
        </Section>
      )}

      {/* §12.7 論点ごとの結論（旧「バランスの取れた結論」— 釣り合いを取る意味ではない） */}
      <Section title="論点ごとの結論">
        <p className="text-[15px] leading-[1.85]">{analysis.balancedConclusion}</p>
      </Section>

      {/* §12.8 次回の具体的対応（最大3件） */}
      {analysis.nextActions.length > 0 && (
        <Section title="次回の具体的対応">
          <ol className="space-y-2">
            {analysis.nextActions.slice(0, 3).map((action, i) => (
              <li key={i} className="flex gap-2.5 rounded-card bg-surface px-4 py-3 text-[14px] leading-relaxed">
                <span className="font-semibold text-accent">{i + 1}.</span>
                {action}
              </li>
            ))}
          </ol>
        </Section>
      )}

      <ItemsSection title="確認できる事実" items={analysis.verifiedFacts} showEvidence />
      <ItemsSection title="ユーザー本人の認識" items={analysis.userClaims} />
      <ItemsSection title="AIによる推測" items={analysis.aiInferences} />
      <ItemsSection title="不明・確認できない点" items={analysis.unknowns} />

      {/* §12.9 相手へ伝える短文（該当するものだけ） */}
      {replies.length > 0 && (
        <Section title="相手へ伝える短文">
          <div className="space-y-3">
            {replies.map((r) => (
              <ReplyCard key={r.label} label={r.label} text={r.text} />
            ))}
          </div>
          {analysis.verdict && !analysis.replySuggestions.firm.trim() && (
            <p className="mt-2 text-[11.5px] leading-relaxed text-text-tertiary">
              今回は相手に境界線を示す必要がある言動が見当たらないため、「境界線を明確にする」文は作っていません。
            </p>
          )}
        </Section>
      )}

      <ItemsSection title="良い出来事" items={analysis.positiveActions} />
      <ItemsSection title="修復行動" items={analysis.repairActions} />

      {analysis.detectedPatterns.length > 0 && (
        <Section title="検出されたパターン（発言・行動として）">
          <ul className="space-y-2">
            {analysis.detectedPatterns.map((p) => (
              <li key={p.id} className="rounded-card border border-border px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[14px] font-semibold">{p.label}</span>
                  {p.actor && p.actor !== 'unclear' && <Badge label={ISSUE_ACTOR_LABELS[p.actor]} />}
                  <ConfidenceBadge level={p.confidence} />
                </div>
                <p className="mt-1 text-[13px] leading-relaxed text-text-secondary">{p.description}</p>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <p className="mt-8 text-[11px] leading-relaxed text-text-tertiary">
        この分析はAIによる整理であり、診断や法的判断ではありません。判定は「記録が正確だとすれば」という前提に立っています。
        <br />
        モデル: {analysis.aiModel} / 判定基準: {analysis.promptVersion} /{' '}
        {new Date(analysis.generatedAt).toLocaleString('ja-JP')}
      </p>
    </div>
  );
}

/** 旧基準（v1/v2）の分析。判定がないことと、その理由を伝える。 */
function LegacyNotice({ onReanalyze }: { onReanalyze?: () => void }) {
  return (
    <div className="mt-5 rounded-card bg-warning-soft px-4 py-4">
      <p className="text-[14px] font-semibold text-warning">以前の判定基準による分析です</p>
      <p className="mt-1.5 text-[13px] leading-[1.75] text-text">
        以前の分析は、自分側と相手側の指摘を同じくらい並べる傾向があり、どちらの問題が重いかをはっきり示していませんでした。
        最新の基準では、問題の「重さ」を同じ物差しで比べて判定します。
      </p>
      {onReanalyze && (
        <button
          onClick={onReanalyze}
          className="mt-3 flex h-11 items-center gap-1.5 rounded-full bg-accent px-5 text-[14px] font-semibold text-accent-on active:opacity-80"
        >
          <RefreshIcon width={16} height={16} />
          最新の基準で分析し直す
        </button>
      )}
    </div>
  );
}

/** 再分析で判定が変わったかを示す（前回の分析を残してある場合のみ）。 */
function VerdictChange({ previous, current }: { previous: IncidentAnalysis; current: IncidentAnalysis }) {
  const before = previous.verdict?.leaning;
  const after = current.verdict?.leaning;
  if (!after || before === after) return null;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-card border border-border px-4 py-2.5 text-[12.5px]">
      <span className="text-text-tertiary">前回の分析から:</span>
      <span className="text-text-secondary">
        {before ? VERDICT_LEANING_LABELS[before] : `判定なし（旧基準 ${previous.promptVersion}）`}
      </span>
      <span className="text-text-tertiary">→</span>
      <LeaningLabel leaning={after} className="text-[12.5px]" />
    </div>
  );
}

function ResponsibilityRow({ row }: { row: ResponsibilityItem }) {
  return (
    <li className="rounded-card border border-border px-4 py-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-[14px] font-semibold">{row.topic}</span>
        {row.severity && <SeverityBadge severity={row.severity} />}
        {row.basis && <BasisBadge basis={row.basis} />}
      </div>
      <dl className="mt-2 grid grid-cols-[3.5em_1fr] gap-x-2 gap-y-1 text-[13px] leading-relaxed">
        <dt className="text-side-user">自分側</dt>
        <dd className="text-text-secondary">{row.userSide ?? '—'}</dd>
        <dt className="text-side-other">相手側</dt>
        <dd className="text-text-secondary">{row.otherSide ?? '—'}</dd>
        <dt className="text-text-tertiary">判断</dt>
        <dd className="font-medium">{RESPONSIBILITY_JUDGMENT_LABELS[row.judgment]}</dd>
      </dl>
    </li>
  );
}

/** §6.4 安全確認カード。危険の兆候がある場合のみ表示する。 */
function SafetyCard({ analysis }: { analysis: IncidentAnalysis }) {
  return (
    <div className="mt-5 rounded-card bg-error-soft px-4 py-4" role="alert">
      <div className="flex items-center gap-2 text-[15px] font-bold text-error">
        <AlertTriangleIcon width={18} height={18} />
        安全の確認
      </div>
      <ul className="mt-2 space-y-1.5 text-[13.5px] leading-relaxed text-text">
        {analysis.safetyFlags.map((flag) => (
          <li key={flag.id}>{flag.description}</li>
        ))}
      </ul>
      <div className="mt-3 space-y-1 text-[13.5px] leading-relaxed text-text">
        <p>・今すぐ危険がある場合は、その場を離れることを最優先してください。</p>
        <p>・安全な場所へ移動できるか、信頼できる人へ連絡できるかを確認してください。</p>
        <p>・必要に応じて警察（110）・救急（119）・相談窓口（#8008 など）を利用してください。</p>
      </div>
    </div>
  );
}

/** 自分側・相手側の問題（重さ・根拠の種類付き）。空なら「問題なし」を明示する。 */
function IssueSection({
  title,
  items,
  empty,
  suggestionLabel,
}: {
  title: string;
  items: AnalysisItem[];
  empty?: string;
  suggestionLabel: string;
}) {
  if (items.length === 0) {
    if (!empty) return null;
    return (
      <Section title={title}>
        <p className="rounded-card border border-dashed border-border px-4 py-3 text-[13px] text-text-tertiary">
          {empty}
        </p>
      </Section>
    );
  }
  return (
    <Section title={title}>
      <ul className="space-y-2">
        {items.map((it) => (
          <li key={it.id} className="rounded-card border border-border px-4 py-3">
            <p className="text-[14px] leading-relaxed">{it.text}</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {it.severity && <SeverityBadge severity={it.severity} />}
              {it.basis ? <BasisBadge basis={it.basis} /> : <ConfidenceBadge level={it.confidence} />}
            </div>
            {it.suggestion && (
              <div className="mt-2.5 rounded-chip bg-surface px-3 py-2">
                <div className="text-[11px] font-semibold text-accent">{suggestionLabel}</div>
                <p className="mt-0.5 text-[13.5px] leading-[1.75]">{it.suggestion}</p>
              </div>
            )}
          </li>
        ))}
      </ul>
    </Section>
  );
}

function ItemsSection({
  title,
  items,
  showEvidence,
}: {
  title: string;
  items: AnalysisItem[];
  showEvidence?: boolean;
}) {
  if (items.length === 0) return null;
  return (
    <Section title={title}>
      <ul className="space-y-2">
        {items.map((it) => (
          <li key={it.id} className="rounded-card border border-border px-4 py-3">
            <p className="text-[14px] leading-relaxed">{it.text}</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <ConfidenceBadge level={it.confidence} />
              {showEvidence && it.evidenceIds.length > 0 && (
                <span className="text-[11px] text-text-tertiary">根拠: {it.evidenceIds.length}件</span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function ReplyCard({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-card border border-border px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] font-semibold text-text-secondary">{label}</span>
        <button
          onClick={async () => {
            await copyText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className="flex h-8 items-center gap-1 rounded-full border border-border px-3 text-[12px] text-text active:opacity-60"
        >
          {copied ? (
            <>
              <CheckIcon width={14} height={14} className="text-success" />
              コピー済み
            </>
          ) : (
            <>
              <CopyIcon width={14} height={14} />
              コピー
            </>
          )}
        </button>
      </div>
      <p className="mt-1.5 text-[14px] leading-relaxed">{text}</p>
    </div>
  );
}

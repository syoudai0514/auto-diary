'use client';

import { useState } from 'react';
import { AlertTriangleIcon, CheckIcon, CopyIcon } from '@/components/icons';
import { copyText } from '@/lib/clipboard';
import {
  RESPONSIBILITY_JUDGMENT_LABELS,
  type AnalysisItem,
  type IncidentAnalysis,
} from '@/lib/factnote/types';
import { ConfidenceBadge, Section } from './common';

/**
 * AI分析結果の表示（依頼書 §12 の全セクション + §13 論点別責任 + §6.4 安全確認カード）。
 * 分析フローの結果画面と記録詳細の「分析」タブで共用する。
 */
export function AnalysisView({ analysis }: { analysis: IncidentAnalysis }) {
  return (
    <div className="pb-4">
      {analysis.safetyFlags.length > 0 && <SafetyCard analysis={analysis} />}

      {/* §12.1 最初の短い見解 */}
      <div className="mt-5 rounded-card bg-surface px-4 py-4 text-[15px] leading-[1.85]">
        {analysis.conciseView}
      </div>

      <ItemsSection title="確認できる事実" items={analysis.verifiedFacts} showEvidence />
      <ItemsSection title="ユーザー本人の認識" items={analysis.userClaims} />
      <ItemsSection title="AIによる推測" items={analysis.aiInferences} />
      <ItemsSection title="不明・確認できない点" items={analysis.unknowns} />
      <ItemsSection title="自分側の改善点" items={analysis.userImprovementPoints} />
      <ItemsSection title="相手側の問題点" items={analysis.otherPartyProblemPoints} />

      {analysis.responsibilityBreakdown.length > 0 && (
        <Section title="論点別の責任整理">
          <div className="overflow-x-auto rounded-card border border-border">
            <table className="w-full min-w-[420px] text-[13px]">
              <thead>
                <tr className="border-b border-border text-left text-text-tertiary">
                  <th className="px-3 py-2 font-medium">論点</th>
                  <th className="px-3 py-2 font-medium">自分側</th>
                  <th className="px-3 py-2 font-medium">相手側</th>
                  <th className="px-3 py-2 font-medium">判断</th>
                </tr>
              </thead>
              <tbody>
                {analysis.responsibilityBreakdown.map((row) => (
                  <tr key={row.id} className="border-b border-border last:border-b-0">
                    <td className="px-3 py-2.5 align-top font-medium">{row.topic}</td>
                    <td className="px-3 py-2.5 align-top text-text-secondary">{row.userSide ?? '—'}</td>
                    <td className="px-3 py-2.5 align-top text-text-secondary">{row.otherSide ?? '—'}</td>
                    <td className="px-3 py-2.5 align-top text-text-secondary">
                      {RESPONSIBILITY_JUDGMENT_LABELS[row.judgment]}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {/* §12.7 バランスの取れた結論 */}
      <Section title="バランスの取れた結論">
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

      {/* §12.9 相手へ伝える短文（3種） */}
      <Section title="相手へ伝える短文">
        <div className="space-y-3">
          <ReplyCard label="やわらかい" text={analysis.replySuggestions.gentle} />
          <ReplyCard label="標準" text={analysis.replySuggestions.standard} />
          <ReplyCard label="境界線を明確にする" text={analysis.replySuggestions.firm} />
        </div>
      </Section>

      <ItemsSection title="良い出来事" items={analysis.positiveActions} />
      <ItemsSection title="修復行動" items={analysis.repairActions} />

      {analysis.detectedPatterns.length > 0 && (
        <Section title="検出されたパターン（発言・行動として）">
          <ul className="space-y-2">
            {analysis.detectedPatterns.map((p) => (
              <li key={p.id} className="rounded-card border border-border px-4 py-3">
                <div className="flex items-center gap-2">
                  <span className="text-[14px] font-semibold">{p.label}</span>
                  <ConfidenceBadge level={p.confidence} />
                </div>
                <p className="mt-1 text-[13px] leading-relaxed text-text-secondary">{p.description}</p>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <p className="mt-8 text-[11px] leading-relaxed text-text-tertiary">
        この分析はAIによる整理であり、診断や法的判断ではありません。
        <br />
        モデル: {analysis.aiModel} / プロンプト: {analysis.promptVersion} /{' '}
        {new Date(analysis.generatedAt).toLocaleString('ja-JP')}
      </p>
    </div>
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

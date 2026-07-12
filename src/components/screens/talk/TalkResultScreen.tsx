'use client';

import { useState } from 'react';
import type { TalkAnalysis, TalkSide } from '@/lib/talk';
import {
  AlertTriangleIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  CopyIcon,
  ShareIcon,
  TrashIcon,
} from '@/components/icons';
import { Chip } from '@/components/screens/common';

function leansLabel(a: TalkAnalysis): string {
  if (a.verdict.leansToward === 'A') return `${a.sideA.label}の主張がより妥当`;
  if (a.verdict.leansToward === 'B') return `${a.sideB.label}の主張がより妥当`;
  return 'ほぼ五分五分';
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-5">
      <h2 className="mb-2 text-[15px] font-bold text-text">{title}</h2>
      {children}
    </section>
  );
}

function BulletList({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="space-y-1.5">
      {items.map((t) => (
        <li key={t} className="flex gap-2 text-[13.5px] leading-relaxed text-text">
          <span className="text-accent">・</span>
          <span className="flex-1">{t}</span>
        </li>
      ))}
    </ul>
  );
}

function SideCard({ side, advice }: { side: TalkSide; advice: string[] }) {
  return (
    <div className="rounded-card border border-border bg-surface p-4">
      <h3 className="mb-2 text-[14px] font-bold text-accent">{side.label}</h3>
      {side.claims.length > 0 && (
        <div className="mb-2">
          <p className="mb-1 text-[12px] font-semibold text-text-tertiary">言い分</p>
          <BulletList items={side.claims} />
        </div>
      )}
      {side.feelings.length > 0 && (
        <div className="mb-2">
          <p className="mb-1 text-[12px] font-semibold text-text-tertiary">気持ち</p>
          <BulletList items={side.feelings} />
        </div>
      )}
      {side.needs.length > 0 && (
        <div className="mb-2">
          <p className="mb-1 text-[12px] font-semibold text-text-tertiary">本当の望み</p>
          <BulletList items={side.needs} />
        </div>
      )}
      {advice.length > 0 && (
        <div>
          <p className="mb-1 text-[12px] font-semibold text-text-tertiary">改善のヒント</p>
          <BulletList items={advice} />
        </div>
      )}
    </div>
  );
}

/** ふたりの話し合い分析: 結果画面。 */
export function TalkResultScreen({
  analysis,
  transcript,
  onCopyAll,
  onShare,
  onDiscard,
  onBack,
}: {
  analysis: TalkAnalysis;
  transcript: string;
  onCopyAll: () => void;
  onShare: () => void;
  onDiscard: () => void;
  onBack: () => void;
}) {
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  return (
    <div className="flex min-h-dvh flex-col pt-safe">
      <header className="flex items-center gap-2 px-4 pt-4">
        <button
          onClick={onBack}
          aria-label="戻る"
          className="flex h-11 w-11 items-center justify-center rounded-full bg-surface active:opacity-60"
        >
          <ChevronLeftIcon />
        </button>
        <h1 className="flex-1 truncate text-[17px] font-bold">{analysis.title}</h1>
      </header>

      <div className="flex-1 overflow-y-auto px-6 pt-4">
        {analysis.safetyNote && (
          <div className="mb-4 flex gap-2.5 rounded-card bg-warning-soft p-4">
            <AlertTriangleIcon width={18} height={18} className="mt-0.5 shrink-0 text-warning" />
            <p className="text-[13.5px] leading-relaxed text-text">{analysis.safetyNote}</p>
          </div>
        )}

        <p className="text-[14px] leading-relaxed text-text-secondary">{analysis.summary}</p>

        {analysis.topics.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {analysis.topics.map((t) => (
              <span
                key={t}
                className="rounded-full bg-surface px-2.5 py-1 text-[12px] text-text-secondary"
              >
                #{t}
              </span>
            ))}
          </div>
        )}

        <Section title="率直な判定">
          <div className="rounded-card border-2 border-accent bg-surface p-4">
            <p className="mb-2 inline-block rounded-full bg-accent px-3 py-1 text-[12.5px] font-bold text-accent-on">
              {leansLabel(analysis)}
            </p>
            <p className="text-[14px] leading-relaxed text-text">{analysis.verdict.overall}</p>
            {(analysis.verdict.behaviorsA.length > 0 || analysis.verdict.behaviorsB.length > 0) && (
              <div className="mt-3 space-y-2 border-t border-border pt-3">
                {[
                  { label: analysis.sideA.label, behaviors: analysis.verdict.behaviorsA },
                  { label: analysis.sideB.label, behaviors: analysis.verdict.behaviorsB },
                ].map(
                  ({ label, behaviors }) =>
                    behaviors.length > 0 && (
                      <div key={label}>
                        <p className="mb-1 text-[12px] font-semibold text-text-tertiary">
                          {label}の発言・行動
                        </p>
                        {behaviors.map((b) => (
                          <p
                            key={b.behavior}
                            className="mb-1 text-[13px] leading-relaxed text-text"
                          >
                            「{b.behavior}」 — {b.assessment}
                          </p>
                        ))}
                      </div>
                    ),
                )}
              </div>
            )}
          </div>
        </Section>

        <Section title="それぞれの言い分">
          <div className="space-y-3">
            <SideCard side={analysis.sideA} advice={analysis.adviceA} />
            <SideCard side={analysis.sideB} advice={analysis.adviceB} />
          </div>
        </Section>

        {analysis.misunderstandings.length > 0 && (
          <Section title="すれ違いポイント">
            <div className="space-y-3">
              {analysis.misunderstandings.map((m) => (
                <div key={m.point} className="rounded-card border border-border bg-surface p-4">
                  <h3 className="mb-1.5 text-[13.5px] font-bold text-text">{m.point}</h3>
                  <p className="text-[13px] leading-relaxed text-text-secondary">
                    {analysis.sideA.label}: {m.aView}
                  </p>
                  <p className="text-[13px] leading-relaxed text-text-secondary">
                    {analysis.sideB.label}: {m.bView}
                  </p>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-text">{m.explanation}</p>
                </div>
              ))}
            </div>
          </Section>
        )}

        {analysis.commonGround.length > 0 && (
          <Section title="ふたりに共通する願い">
            <div className="rounded-card border border-border bg-surface p-4">
              <BulletList items={analysis.commonGround} />
            </div>
          </Section>
        )}

        {analysis.reconciliationScript.length > 0 && (
          <Section title="仲直りの会話例">
            <div className="space-y-2">
              {analysis.reconciliationScript.map((s, i) => (
                <div key={`${s.speaker}-${i}`} className="rounded-card bg-surface p-3.5">
                  <span className="text-[12px] font-semibold text-accent">{s.speaker}</span>
                  <p className="mt-0.5 text-[14px] leading-relaxed text-text">「{s.line}」</p>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* 元の会話（折りたたみ） */}
        <div className="mt-5">
          <button
            onClick={() => setTranscriptOpen((v) => !v)}
            className="flex w-full items-center justify-between py-2 text-[14px] text-text-secondary"
          >
            <span>元の会話</span>
            <ChevronDownIcon
              width={18}
              height={18}
              className="transition-transform duration-200"
              style={{ transform: transcriptOpen ? 'rotate(180deg)' : 'none' }}
            />
          </button>
          {transcriptOpen && (
            <div className="mt-1 whitespace-pre-wrap rounded-card border border-border bg-surface p-4 text-[13px] leading-relaxed text-text-secondary">
              {transcript}
            </div>
          )}
        </div>

        {/* 操作チップ */}
        <div className="-mx-6 mt-6 flex gap-2 overflow-x-auto px-6 pb-2">
          <Chip icon={<CopyIcon width={16} height={16} />} label="全文コピー" onClick={onCopyAll} />
          <Chip icon={<ShareIcon width={16} height={16} />} label="共有" onClick={onShare} />
          <Chip
            icon={<TrashIcon width={16} height={16} />}
            label="削除して終わる"
            onClick={onDiscard}
            destructive
          />
        </div>

        <p className="mt-2 pb-6 text-[11.5px] leading-relaxed text-text-tertiary">
          この分析はどこにも保存されません。残したい場合は全文コピーをご利用ください。
          AIによる整理であり、最終的な判断はおふたりのものです。
        </p>
      </div>
    </div>
  );
}

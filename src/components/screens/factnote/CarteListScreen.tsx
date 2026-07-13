'use client';

import Link from 'next/link';
import { ChevronRightIcon, UsersIcon } from '@/components/icons';
import type { MergeSuggestion } from '@/lib/factnote/persons';
import type { PersonProfile } from '@/lib/factnote/types';
import { formatRecordDate, FactnoteHeader, Section } from './common';

export interface PersonListEntry {
  person: PersonProfile;
  recordCount: number;
  lastRecordAt?: string;
}

/**
 * 客観カルテ一覧（追加依頼 §28-1）+ 人物統合の候補提示・別名管理（§4 / §28-3）。
 * 統合候補は確定ではなく、ユーザーが承認したときだけ統合する。
 */
export function CarteListScreen({
  entries,
  suggestions,
  onMerge,
  onSplitAlias,
}: {
  entries: PersonListEntry[];
  suggestions: MergeSuggestion[];
  onMerge: (keep: PersonProfile, merge: PersonProfile) => void;
  onSplitAlias: (person: PersonProfile, alias: string) => void;
}) {
  return (
    <div className="flex min-h-dvh flex-col pt-safe">
      <FactnoteHeader title="客観カルテ" backHref="/factnote" />
      <div className="flex-1 overflow-y-auto px-6 pb-safe">
        <p className="pt-1 text-[12.5px] leading-relaxed text-text-secondary">
          記録に登場する人物ごとに、長期的な傾向を整理します。集計は端末内で行われます。
        </p>

        {suggestions.length > 0 && (
          <Section title="同一人物の可能性">
            <ul className="space-y-2">
              {suggestions.map((s) => (
                <li key={`${s.a.id}_${s.b.id}`} className="rounded-card bg-warning-soft px-4 py-3">
                  <p className="text-[13.5px]">{s.reason}</p>
                  <div className="mt-2 flex gap-2">
                    <button
                      onClick={() => onMerge(s.a, s.b)}
                      className="h-10 rounded-full bg-accent px-4 text-[13px] font-semibold text-accent-on active:opacity-80"
                    >
                      「{s.a.displayName}」に統合
                    </button>
                    <button
                      onClick={() => onMerge(s.b, s.a)}
                      className="h-10 rounded-full border border-border px-4 text-[13px] active:opacity-70"
                    >
                      「{s.b.displayName}」に統合
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </Section>
        )}

        <Section title="人物">
          {entries.length === 0 ? (
            <p className="mt-8 text-center text-[14px] text-text-tertiary">
              まだ人物が登録されていません。
              <br />
              記録の補足情報で関係者を選ぶと、ここに表示されます。
            </p>
          ) : (
            <ul>
              {entries.map(({ person, recordCount, lastRecordAt }) => (
                <li key={person.id} className="border-b border-border">
                  <Link
                    href={`/factnote/carte/${person.id}`}
                    className="flex min-h-[56px] w-full items-center gap-3 py-3 active:opacity-60"
                  >
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface text-[15px] font-bold text-accent">
                      {person.displayName.slice(0, 1)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[16px] font-semibold">
                        {person.displayName}
                      </span>
                      <span className="block text-[12px] text-text-tertiary">
                        記録{recordCount}件
                        {lastRecordAt ? ` ・ 最終 ${formatRecordDate(lastRecordAt)}` : ''}
                        {person.aliases.length > 0 ? ` ・ 別名: ${person.aliases.join('、')}` : ''}
                      </span>
                    </span>
                    <ChevronRightIcon width={20} height={20} className="shrink-0 text-text-tertiary" />
                  </Link>
                  {person.aliases.length > 0 && (
                    <div className="-mt-1 mb-2 flex flex-wrap gap-1.5 pl-[52px]">
                      {person.aliases.map((alias) => (
                        <button
                          key={alias}
                          onClick={() => onSplitAlias(person, alias)}
                          className="h-7 rounded-full border border-border px-2.5 text-[11px] text-text-secondary active:opacity-60"
                        >
                          「{alias}」を分離
                        </button>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Section>

        <div className="mt-8 flex items-center gap-2 text-[12px] text-text-tertiary">
          <UsersIcon width={16} height={16} />
          カルテは人物を評価するものではなく、記録上の発言・行動の傾向をまとめるものです。
        </div>
      </div>
    </div>
  );
}

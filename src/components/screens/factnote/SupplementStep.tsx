'use client';

import {
  CHILDREN_OPTIONS,
  EMOTION_OPTIONS,
  LOCATION_OPTIONS,
  PEOPLE_OPTIONS,
  type ChildrenOption,
  type Supplement,
} from '@/lib/factnote/newRecord';
import { FactnoteHeader, Section } from './common';

/**
 * 補足情報入力（依頼書 §9。P0 最小構成: 日時・場所・関係者・子ども同席・感情）。
 * すべて任意 — 分からない項目は飛ばせる。
 */
export function SupplementStep({
  supplement,
  onChange,
  saving,
  onAnalyze,
  onSaveOnly,
}: {
  supplement: Supplement;
  onChange: (s: Supplement) => void;
  saving: boolean;
  onAnalyze: () => void;
  onSaveOnly: () => void;
}) {
  const set = (patch: Partial<Supplement>) => onChange({ ...supplement, ...patch });

  return (
    <div className="flex min-h-dvh flex-col pt-safe">
      <FactnoteHeader title="補足情報" />
      <div className="flex-1 overflow-y-auto px-6 pb-4">
        <p className="pt-1 text-[12.5px] leading-relaxed text-text-secondary">
          分かる項目だけで大丈夫です。すべて任意です。
        </p>

        <Section title="いつ起きたこと？">
          <input
            type="datetime-local"
            value={supplement.occurredAtLocal}
            disabled={supplement.occurredUnknown}
            onChange={(e) => set({ occurredAtLocal: e.target.value })}
            aria-label="発生日時"
            className="h-12 w-full rounded-card border border-border bg-surface px-4 text-[15px] text-text focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-40"
          />
          <label className="mt-2 flex min-h-[44px] items-center gap-3 text-[14px]">
            <input
              type="checkbox"
              checked={supplement.occurredUnknown}
              onChange={(e) => set({ occurredUnknown: e.target.checked })}
              className="h-5 w-5 accent-[var(--c-accent)]"
            />
            時刻は分からない
          </label>
        </Section>

        <Section title="場所">
          <ChipGroup
            options={LOCATION_OPTIONS}
            isSelected={(o) => supplement.location === o}
            onToggle={(o) => set({ location: supplement.location === o ? '' : o })}
          />
        </Section>

        <Section title="関係者（複数可）">
          <ChipGroup
            options={PEOPLE_OPTIONS}
            isSelected={(o) => supplement.people.includes(o)}
            onToggle={(o) =>
              set({
                people: supplement.people.includes(o)
                  ? supplement.people.filter((p) => p !== o)
                  : [...supplement.people, o],
              })
            }
          />
        </Section>

        <Section title="子どもの同席">
          <ChipGroup
            options={CHILDREN_OPTIONS}
            isSelected={(o) => supplement.children === o}
            onToggle={(o) =>
              set({ children: supplement.children === o ? '' : (o as ChildrenOption) })
            }
          />
        </Section>

        <Section title="今の感情（複数可）">
          <ChipGroup
            options={EMOTION_OPTIONS}
            isSelected={(o) => supplement.emotions.includes(o)}
            onToggle={(o) =>
              set({
                emotions: supplement.emotions.includes(o)
                  ? supplement.emotions.filter((e) => e !== o)
                  : [...supplement.emotions, o],
              })
            }
          />
        </Section>
      </div>

      <div className="sticky bottom-0 bg-gradient-to-t from-bg via-bg to-transparent px-6 pb-safe pt-4">
        <button
          onClick={onAnalyze}
          disabled={saving}
          className="h-14 w-full rounded-full bg-accent text-[17px] font-semibold text-accent-on shadow-cta disabled:opacity-40"
        >
          AIで分析する
        </button>
        <button
          onClick={onSaveOnly}
          disabled={saving}
          className="mb-3 mt-2 h-11 w-full rounded-full text-[14px] text-text-secondary disabled:opacity-40"
        >
          分析せずに保存だけする
        </button>
      </div>
    </div>
  );
}

function ChipGroup({
  options,
  isSelected,
  onToggle,
}: {
  options: readonly string[];
  isSelected: (option: string) => boolean;
  onToggle: (option: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((option) => {
        const selected = isSelected(option);
        return (
          <button
            key={option}
            onClick={() => onToggle(option)}
            aria-pressed={selected}
            className={`min-h-[44px] rounded-chip border px-3.5 text-[13.5px] active:opacity-70 ${
              selected ? 'border-accent bg-accent text-accent-on' : 'border-border bg-surface text-text'
            }`}
          >
            {option}
          </button>
        );
      })}
    </div>
  );
}

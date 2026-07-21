'use client';

import { useState } from 'react';
import { AutoTextarea } from '@/components/screens/common';
import {
  CHILDREN_OPTIONS,
  childrenToStored,
  EMOTION_OPTIONS,
  LOCATION_OPTIONS,
  PEOPLE_OPTIONS,
  type ChildrenOption,
} from '@/lib/factnote/newRecord';
import type { IncidentRecord } from '@/lib/factnote/types';
import { FactnoteHeader, Section } from './common';

/** record の子ども同席の保存値を、選択肢ラベルへ逆変換する。 */
function childrenToOption(record: IncidentRecord): ChildrenOption | '' {
  if (record.childrenPresent === 'no') return 'いなかった';
  if (record.childrenPresent === 'unknown') return '不明';
  if (record.childrenPresent === 'yes') {
    const tag = record.childImpactTags[0];
    if (tag === '聞いていた') return '聞いていた';
    if (tag === '聞いていたか不明') return '同席していたが聞いていたか不明';
    return '同席していた';
  }
  return '';
}

function toLocalInput(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * 保存済みの記録の日付・タイトル・内容・補足情報を後から編集する画面。
 * 内容（文章/文字起こし）を変えた場合、分析は詳細の「分析をやり直す」で更新する。
 */
export function FactnoteRecordEditScreen({
  record,
  onSave,
  onCancel,
}: {
  record: IncidentRecord;
  onSave: (updated: IncidentRecord) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(record.title ?? '');
  const [occurredAtLocal, setOccurredAtLocal] = useState(toLocalInput(record.occurredAt));
  const [occurredUnknown, setOccurredUnknown] = useState(!record.occurredAt);
  const [location, setLocation] = useState(record.location ?? '');
  const [people, setPeople] = useState<string[]>(record.people.map((p) => p.displayName));
  const [children, setChildren] = useState<ChildrenOption | ''>(childrenToOption(record));
  const [emotions, setEmotions] = useState<string[]>(record.emotions);

  // 編集対象の本文: 文章入力なら原文、音声なら（修正済み）文字起こし
  const editsRawText = record.sourceType === 'text' || record.sourceType === 'quick_memo';
  const [rawText, setRawText] = useState(record.rawText ?? '');
  const [transcript, setTranscript] = useState(record.correctedTranscript ?? record.transcript ?? '');

  function save() {
    const stored = childrenToStored(children);
    const occurredAt =
      !occurredUnknown && occurredAtLocal ? new Date(occurredAtLocal).toISOString() : undefined;

    let updated: IncidentRecord = {
      ...record,
      title: title.trim() || undefined,
      occurredAt,
      location: location || undefined,
      people: people.map((name, i) => ({ id: `p${i + 1}`, displayName: name, relationship: name })),
      childrenPresent: stored.childrenPresent,
      childImpactTags: stored.childImpactTags,
      emotions,
      updatedAt: new Date().toISOString(),
    };

    if (editsRawText) {
      updated = { ...updated, rawText: rawText.trim() || undefined };
    } else {
      // 音声由来: ユーザー修正として correctedTranscript に保存（原本の transcript は残す）
      const original = record.transcript ?? '';
      updated = {
        ...updated,
        correctedTranscript: transcript.trim() && transcript !== original ? transcript : undefined,
      };
    }
    onSave(updated);
  }

  const analysisWarning = record.analysis
    ? '内容を変えると、いまの分析は古いままになります。保存後、詳細の「分析」タブで「分析をやり直す」ができます。'
    : null;

  return (
    <div className="flex min-h-dvh flex-col pt-safe">
      <FactnoteHeader title="記録を編集" backHref={`/factnote/records/${record.id}`} />
      <div className="flex-1 overflow-y-auto px-6 pb-4">
        <Section title="タイトル">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            aria-label="タイトル"
            placeholder="無題の記録"
            className="h-12 w-full rounded-card border border-border bg-surface px-4 text-[16px] font-semibold focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </Section>

        <Section title="日時">
          <input
            type="datetime-local"
            value={occurredAtLocal}
            disabled={occurredUnknown}
            onChange={(e) => setOccurredAtLocal(e.target.value)}
            aria-label="発生日時"
            className="h-12 w-full rounded-card border border-border bg-surface px-4 text-[15px] focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-40"
          />
          <label className="mt-2 flex min-h-[44px] items-center gap-3 text-[14px]">
            <input
              type="checkbox"
              checked={occurredUnknown}
              onChange={(e) => setOccurredUnknown(e.target.checked)}
              className="h-5 w-5 accent-[var(--c-accent)]"
            />
            日時は分からない
          </label>
        </Section>

        <Section title="内容">
          {analysisWarning && (
            <p className="mb-2 rounded-card bg-warning-soft px-3 py-2 text-[12px] leading-relaxed">
              {analysisWarning}
            </p>
          )}
          {editsRawText ? (
            <AutoTextarea
              value={rawText}
              onChange={setRawText}
              ariaLabel="内容"
              className="min-h-[30dvh] w-full resize-none rounded-card border border-border bg-surface px-4 py-3 text-[15px] leading-[1.85] focus:outline-none focus:ring-1 focus:ring-accent"
            />
          ) : (
            <>
              <AutoTextarea
                value={transcript}
                onChange={setTranscript}
                ariaLabel="文字起こしの内容"
                className="min-h-[30dvh] w-full resize-none rounded-card border border-border bg-surface px-4 py-3 text-[15px] leading-[1.85] focus:outline-none focus:ring-1 focus:ring-accent"
              />
              <p className="mt-1 text-[11.5px] text-text-tertiary">
                元の文字起こしは残り、ここでの修正は「修正済み」として保存されます。
              </p>
            </>
          )}
        </Section>

        <Section title="場所">
          <ChipGroup
            options={LOCATION_OPTIONS}
            isSelected={(o) => location === o}
            onToggle={(o) => setLocation(location === o ? '' : o)}
          />
        </Section>

        <Section title="関係者（複数可）">
          <ChipGroup
            options={PEOPLE_OPTIONS}
            isSelected={(o) => people.includes(o)}
            onToggle={(o) =>
              setPeople(people.includes(o) ? people.filter((p) => p !== o) : [...people, o])
            }
          />
        </Section>

        <Section title="子どもの同席">
          <ChipGroup
            options={CHILDREN_OPTIONS}
            isSelected={(o) => children === o}
            onToggle={(o) => setChildren(children === o ? '' : (o as ChildrenOption))}
          />
        </Section>

        <Section title="感情（複数可）">
          <ChipGroup
            options={EMOTION_OPTIONS}
            isSelected={(o) => emotions.includes(o)}
            onToggle={(o) =>
              setEmotions(emotions.includes(o) ? emotions.filter((e) => e !== o) : [...emotions, o])
            }
          />
        </Section>
      </div>

      <div className="sticky bottom-0 bg-gradient-to-t from-bg via-bg to-transparent px-6 pb-safe pt-4">
        <button
          onClick={save}
          className="h-14 w-full rounded-full bg-accent text-[17px] font-semibold text-accent-on shadow-cta"
        >
          変更を保存
        </button>
        <button
          onClick={onCancel}
          className="mb-3 mt-2 h-11 w-full rounded-full text-[14px] text-text-secondary"
        >
          やめる
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

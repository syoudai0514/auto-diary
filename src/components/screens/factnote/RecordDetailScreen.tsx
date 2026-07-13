'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ScaleIcon, TrashIcon, UsersIcon } from '@/components/icons';
import {
  DIARY_MODE_LABELS,
  RECORD_SOURCE_LABELS,
  type FutureSelfMemo,
  type IncidentRecord,
} from '@/lib/factnote/types';
import { AnalysisView } from './AnalysisView';
import { Badge, FactnoteHeader, RecordBadges, Section, formatRecordDate } from './common';

type Tab = 'diary' | 'analysis' | 'transcript' | 'source';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'diary', label: '日記' },
  { id: 'analysis', label: '分析' },
  { id: 'transcript', label: '文字起こし' },
  { id: 'source', label: '原本' },
];

/**
 * 記録詳細（依頼書 §19）。原本・文字起こし・分析・日記をタブで分離し、
 * 原本とAI生成物が混ざらないようにする。
 */
export function FactnoteRecordDetailScreen({
  record,
  pinnedMemos = [],
  onDelete,
  onUpdate,
}: {
  record: IncidentRecord;
  /** この記録に固定された未来メモ。 */
  pinnedMemos?: FutureSelfMemo[];
  onDelete: () => void;
  /** 分類修正・カルテ除外などの更新（永続化は呼び出し側）。 */
  onUpdate: (record: IncidentRecord) => void;
}) {
  const [tab, setTab] = useState<Tab>(record.analysis ? 'analysis' : 'source');
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  return (
    <div className="flex min-h-dvh flex-col pt-safe">
      <FactnoteHeader title={record.title || '無題の記録'} backHref="/factnote/records" />
      <div className="px-6 pt-1">
        <div className="text-[12px] text-text-tertiary">
          {formatRecordDate(record.occurredAt ?? record.createdAt)}
          {record.location ? ` ・ ${record.location}` : ''}
        </div>
        <RecordBadges record={record} />
      </div>

      <div className="mt-4 border-b border-border px-6">
        <div className="flex gap-1" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`min-h-[44px] px-3 text-[14px] ${
                tab === t.id
                  ? 'border-b-2 border-accent font-semibold text-text'
                  : 'text-text-tertiary'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 pb-safe">
        {/* この記録に固定された未来メモ（本人の言葉。AIと区別して表示） */}
        {pinnedMemos.length > 0 && (
          <div className="mt-4 space-y-2">
            {pinnedMemos.map((memo) => (
              <div key={memo.id} className="rounded-card border-2 border-accent bg-surface px-4 py-3">
                <div className="text-[11px] font-semibold text-accent">未来の自分から（固定）</div>
                <div className="mt-0.5 text-[14px] font-semibold">{memo.title}</div>
                <p className="mt-1 whitespace-pre-wrap text-[13px] leading-[1.8]">{memo.body}</p>
                <p className="mt-1.5 text-[11px] text-text-tertiary">
                  {formatRecordDate(memo.createdAt)}にあなた自身が書いたメモです。
                </p>
              </div>
            ))}
          </div>
        )}

        {tab === 'diary' && <DiaryTab record={record} />}
        {tab === 'analysis' &&
          (record.analysis ? (
            <AnalysisView analysis={record.analysis} />
          ) : (
            <EmptyTab text="まだ分析していません。" />
          ))}
        {tab === 'transcript' && <TranscriptTab record={record} />}
        {tab === 'source' && <SourceTab record={record} />}

        {/* 長期分析への導線と分類の修正（追加依頼 §30） */}
        <Section title="長期分析">
          <div className="space-y-2">
            <Link
              href={`/factnote/flatcheck?recordId=${record.id}`}
              className="flex min-h-[52px] w-full items-center gap-2.5 rounded-card border border-border bg-surface px-4 text-[14.5px] font-medium active:opacity-70"
            >
              <ScaleIcon width={18} height={18} className="text-accent" />
              この出来事をフラットチェック
              <span className="ml-auto text-[11px] text-text-tertiary">過去と比較</span>
            </Link>
            <Link
              href="/factnote/carte"
              className="flex min-h-[52px] w-full items-center gap-2.5 rounded-card border border-border bg-surface px-4 text-[14.5px] font-medium active:opacity-70"
            >
              <UsersIcon width={18} height={18} className="text-accent" />
              関係人物の客観カルテを見る
            </Link>
          </div>
        </Section>

        <Section title="分類の修正（誤分類はここで直せます）">
          <div className="flex flex-wrap gap-2">
            {(
              [
                ['isPositiveEvent', '良い出来事'],
                ['isConflict', '衝突'],
                ['isRepairAction', '修復行動'],
              ] as const
            ).map(([key, label]) => {
              const on = record[key] === true;
              return (
                <button
                  key={key}
                  onClick={() =>
                    onUpdate({ ...record, [key]: !on, updatedAt: new Date().toISOString() })
                  }
                  aria-pressed={on}
                  className={`min-h-[44px] rounded-chip border px-3.5 text-[13px] active:opacity-70 ${
                    on ? 'border-accent bg-accent text-accent-on' : 'border-border bg-surface text-text'
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <label className="mt-3 flex min-h-[44px] items-center gap-3 text-[14px]">
            <input
              type="checkbox"
              checked={record.excludeFromCarte === true}
              onChange={(e) =>
                onUpdate({
                  ...record,
                  excludeFromCarte: e.target.checked,
                  updatedAt: new Date().toISOString(),
                })
              }
              className="h-5 w-5 accent-[var(--c-accent)]"
            />
            この出来事をカルテ集計から除外する
          </label>
        </Section>

        <div className="mb-6 mt-10 flex justify-center">
          {confirmingDelete ? (
            <div className="w-full rounded-card bg-error-soft px-4 py-4 text-center">
              <p className="text-[14px] leading-relaxed">
                「{record.title || '無題の記録'}」をゴミ箱へ移動しますか？
                <br />
                <span className="text-[12px] text-text-secondary">
                  原本・文字起こし・分析・日記が対象です。30日以内なら復元できます。
                </span>
              </p>
              <div className="mt-3 flex justify-center gap-3">
                <button
                  onClick={onDelete}
                  className="h-11 rounded-full bg-error px-5 text-[14px] font-semibold text-white active:opacity-70"
                >
                  ゴミ箱へ移動
                </button>
                <button
                  onClick={() => setConfirmingDelete(false)}
                  className="h-11 rounded-full border border-border px-5 text-[14px] active:opacity-70"
                >
                  キャンセル
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setConfirmingDelete(true)}
              className="flex h-11 items-center gap-1.5 rounded-full px-4 text-[14px] text-error active:opacity-60"
            >
              <TrashIcon width={16} height={16} />
              この記録を削除
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function EmptyTab({ text }: { text: string }) {
  return <div className="mt-16 text-center text-[14px] text-text-tertiary">{text}</div>;
}

function DiaryTab({ record }: { record: IncidentRecord }) {
  if (record.diaryVersions.length === 0) return <EmptyTab text="まだ日記を作成していません。" />;
  return (
    <div className="pb-4">
      {record.diaryVersions.map((d) => (
        <div key={d.id} className="mt-5 rounded-card border border-border px-4 py-4">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge label={DIARY_MODE_LABELS[d.mode]} tone="accent" />
            {d.editedByUser && <Badge label="ユーザー編集済み" />}
            <span className="text-[11px] text-text-tertiary">{formatRecordDate(d.createdAt)}</span>
          </div>
          <h3 className="mt-2 text-[17px] font-bold">{d.title}</h3>
          <p className="mt-2 whitespace-pre-wrap text-[15px] leading-[1.9]">{d.body}</p>
        </div>
      ))}
    </div>
  );
}

function TranscriptTab({ record }: { record: IncidentRecord }) {
  if (!record.transcript && !record.correctedTranscript) {
    return <EmptyTab text="文字起こしはありません。" />;
  }
  return (
    <div className="pb-4">
      {record.correctedTranscript && (
        <Section title="修正済み文字起こし（ユーザー修正）">
          <p className="whitespace-pre-wrap rounded-card bg-surface px-4 py-3 text-[14px] leading-[1.9]">
            {record.correctedTranscript}
          </p>
        </Section>
      )}
      {record.transcript && (
        <Section title="AIによる文字起こし（原本扱い・修正前）">
          <p className="whitespace-pre-wrap rounded-card border border-border px-4 py-3 text-[14px] leading-[1.9] text-text-secondary">
            {record.transcript}
          </p>
        </Section>
      )}
    </div>
  );
}

function SourceTab({ record }: { record: IncidentRecord }) {
  return (
    <div className="pb-4">
      <Section title="記録情報">
        <dl className="space-y-1.5 rounded-card border border-border px-4 py-3 text-[13.5px]">
          <MetaRow label="入力形式" value={RECORD_SOURCE_LABELS[record.sourceType]} />
          <MetaRow label="入力日時" value={new Date(record.createdAt).toLocaleString('ja-JP')} />
          {record.occurredAt && (
            <MetaRow label="発生日時" value={new Date(record.occurredAt).toLocaleString('ja-JP')} />
          )}
          {record.location && <MetaRow label="場所" value={record.location} />}
          {record.people.length > 0 && (
            <MetaRow label="関係者" value={record.people.map((p) => p.displayName).join('、')} />
          )}
          {record.childrenPresent && (
            <MetaRow
              label="子どもの同席"
              value={
                record.childrenPresent === 'yes'
                  ? 'いた'
                  : record.childrenPresent === 'no'
                    ? 'いなかった'
                    : '不明'
              }
            />
          )}
          {record.emotions.length > 0 && <MetaRow label="感情" value={record.emotions.join('、')} />}
        </dl>
      </Section>

      {record.rawText && (
        <Section title="ユーザーが入力した原文">
          <p className="whitespace-pre-wrap rounded-card bg-surface px-4 py-3 text-[14px] leading-[1.9]">
            {record.rawText}
          </p>
        </Section>
      )}

      {record.attachments.length > 0 && (
        <Section title="添付ファイル">
          <ul className="space-y-2">
            {record.attachments.map((a) => (
              <li key={a.id} className="rounded-card border border-border px-4 py-3 text-[13.5px]">
                <div className="font-medium">{a.fileName}</div>
                <div className="mt-0.5 text-[12px] text-text-tertiary">
                  {a.mimeType} ・ {(a.size / 1024 / 1024).toFixed(1)}MB
                  {a.durationSeconds ? ` ・ ${Math.round(a.durationSeconds)}秒` : ''}
                </div>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3">
      <dt className="w-20 shrink-0 text-text-tertiary">{label}</dt>
      <dd className="flex-1">{value}</dd>
    </div>
  );
}

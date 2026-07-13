'use client';

import Link from 'next/link';
import {
  BookIcon,
  FileTextIcon,
  MicIcon,
  ScaleIcon,
  SettingsIcon,
  UploadIcon,
  UsersIcon,
} from '@/components/icons';
import { FACTNOTE_APP_NAME } from '@/lib/factnote/appConfig';
import type { PersistState } from '@/lib/factnote/db';
import type { FutureSelfMemo, IncidentRecord } from '@/lib/factnote/types';
import { FactnoteHeader, RecordRow, formatRecordDate } from './common';
import { FutureMemoCard } from './FutureMemoCard';

/**
 * 事実ノートのホーム（依頼書 §20）。メイン入力を最も目立たせ、
 * 最近の記録・バックアップ状況を控えめに表示する。
 */
export function FactnoteHomeScreen({
  records,
  persistState,
  lastBackupAt,
  dueMemos = [],
  onCloseMemo,
}: {
  records: IncidentRecord[];
  persistState: PersistState;
  lastBackupAt?: string;
  /** 「明日の朝に再表示」の予約が来ている未来メモ。 */
  dueMemos?: FutureSelfMemo[];
  onCloseMemo?: (memo: FutureSelfMemo) => void;
}) {
  const today = new Date();
  const recent = records.slice(0, 5);
  return (
    <div className="flex min-h-dvh flex-col pt-safe">
      <FactnoteHeader
        title={FACTNOTE_APP_NAME}
        right={
          <Link
            href="/factnote/settings"
            aria-label="設定"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-border text-text active:opacity-60"
          >
            <SettingsIcon width={18} height={18} />
          </Link>
        }
      />
      <p className="px-6 pt-1 text-[12px] text-text-tertiary">
        {today.getFullYear()}年{today.getMonth() + 1}月{today.getDate()}日
      </p>

      <div className="flex-1 overflow-y-auto px-6 pt-6">
        {/* 「明日の朝に再表示」を選んだ未来メモ */}
        {dueMemos.map((memo) => (
          <div key={memo.id} className="mb-4">
            <FutureMemoCard memo={memo} onClose={() => onCloseMemo?.(memo)} />
          </div>
        ))}

        <div className="flex items-center justify-between">
          <h2 className="text-[12px] font-medium text-text-tertiary">最近の記録</h2>
          {records.length > 0 && (
            <Link href="/factnote/records" className="text-[12px] font-medium text-accent active:opacity-60">
              すべて見る（{records.length}件）
            </Link>
          )}
        </div>
        {recent.length === 0 ? (
          <div className="mt-20 text-center text-[14px] leading-relaxed text-text-tertiary">
            まだ記録がありません。
            <br />
            下のボタンから、今日あったことを残しましょう。
          </div>
        ) : (
          <ul>
            {recent.map((r) => (
              <RecordRow key={r.id} record={r} href={`/factnote/records/${r.id}`} />
            ))}
          </ul>
        )}

        {/* 長期分析への入口（追加依頼 §29。ホームは情報過多にしない） */}
        {records.length > 0 && (
          <div className="mt-6 space-y-2">
            <Link
              href="/factnote/carte"
              className="flex min-h-[56px] items-center gap-3 rounded-card border border-border bg-surface px-4 active:opacity-70"
            >
              <UsersIcon width={20} height={20} className="shrink-0 text-accent" />
              <span className="min-w-0">
                <span className="block text-[14.5px] font-semibold">客観カルテ</span>
                <span className="block text-[12px] text-text-tertiary">関係を長期的に見る</span>
              </span>
            </Link>
            <Link
              href={`/factnote/flatcheck?recordId=${records[0].id}`}
              className="flex min-h-[56px] items-center gap-3 rounded-card border border-border bg-surface px-4 active:opacity-70"
            >
              <ScaleIcon width={20} height={20} className="shrink-0 text-accent" />
              <span className="min-w-0">
                <span className="block text-[14.5px] font-semibold">フラットチェック</span>
                <span className="block truncate text-[12px] text-text-tertiary">
                  直近の記録「{records[0].title || '無題の記録'}」を過去と比較する
                </span>
              </span>
            </Link>
          </div>
        )}

        {/* バックアップ状況（iOSのIndexedDB退避リスクを正直に伝える。依頼書 §21/§26） */}
        <div className="mb-4 mt-6 rounded-card border border-border px-4 py-3 text-[12px] leading-relaxed text-text-secondary">
          <div>
            最終バックアップ:{' '}
            {lastBackupAt ? formatRecordDate(lastBackupAt) : 'まだありません'}
          </div>
          {persistState !== 'granted' && (
            <div className="mt-1 text-text-tertiary">
              端末の空き容量が減ると、ブラウザが保存データを削除することがあります。設定からエクスポートしておくと安全です。
            </div>
          )}
        </div>
      </div>

      {/* フッター: 親指到達域のメイン入力（依頼書 §8） */}
      <div className="sticky bottom-0 mt-auto bg-gradient-to-t from-bg via-bg to-transparent px-6 pb-safe pt-6">
        <div className="flex flex-col items-center gap-2 pb-3">
          <div className="flex gap-2">
            <Link
              href="/factnote/new?mode=text"
              className="flex h-11 items-center gap-2 rounded-full border border-border bg-surface px-4 text-[14px] font-medium text-text active:opacity-70"
            >
              <FileTextIcon width={18} height={18} />
              文章で入力
            </Link>
            <Link
              href="/factnote/new?mode=file"
              className="flex h-11 items-center gap-2 rounded-full border border-border bg-surface px-4 text-[14px] font-medium text-text active:opacity-70"
            >
              <UploadIcon width={18} height={18} />
              録音ファイル
            </Link>
          </div>
          <Link
            href="/factnote/records"
            className="flex h-11 items-center gap-2 rounded-full border border-border bg-surface px-4 text-[14px] font-medium text-text active:opacity-70"
          >
            <BookIcon width={18} height={18} />
            記録一覧
          </Link>
          <Link
            href="/factnote/new?mode=record"
            aria-label="今のことを話す"
            className="flex h-[76px] w-[76px] items-center justify-center rounded-[38px] bg-accent text-accent-on shadow-cta transition active:scale-[1.08]"
          >
            <MicIcon width={30} height={30} />
          </Link>
          <span className="text-[12px] text-text-tertiary">今のことを話す</span>
        </div>
      </div>
    </div>
  );
}

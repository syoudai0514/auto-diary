'use client';

import type { Diary } from '@/lib/diary';
import { formatTimer } from '@/lib/format';
import {
  BookIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  CopyIcon,
  EditIcon,
  ExternalLinkIcon,
  MicIcon,
  RefreshIcon,
  ShareIcon,
  StopIcon,
  TrashIcon,
} from '@/components/icons';
import { AutoTextarea, Chip } from './common';

export function ResultScreen({
  diary,
  sourceLabel,
  transcriptOpen,
  onToggleTranscript,
  onChangeTitle,
  onChangeBody,
  onBack,
  onCopyTitle,
  onCopyBody,
  onCopyAll,
  onShare,
  appleJournalEnabled,
  onSaveApple,
  onSaveDayOne,
  onSaveOpenApp,
  onRewrite,
  onDelete,
  onPrimarySave,
  reviseOpen,
  reviseInstruction,
  reviseBusy,
  reviseError,
  isRecordingRevise,
  reviseElapsedMs,
  onToggleRevise,
  onChangeReviseInstruction,
  onStartReviseVoice,
  onStopReviseVoice,
  onApplyRevise,
}: {
  diary: Diary;
  sourceLabel: string;
  transcriptOpen: boolean;
  onToggleTranscript: () => void;
  onChangeTitle: (v: string) => void;
  onChangeBody: (v: string) => void;
  onBack: () => void;
  onCopyTitle: () => void;
  onCopyBody: () => void;
  onCopyAll: () => void;
  onShare: () => void;
  appleJournalEnabled: boolean;
  onSaveApple: () => void;
  onSaveDayOne: () => void;
  onSaveOpenApp: () => void;
  onRewrite: () => void;
  onDelete: () => void;
  onPrimarySave: () => void;
  reviseOpen: boolean;
  reviseInstruction: string;
  reviseBusy: 'none' | 'transcribing' | 'revising';
  reviseError: string;
  isRecordingRevise: boolean;
  reviseElapsedMs: number;
  onToggleRevise: () => void;
  onChangeReviseInstruction: (v: string) => void;
  onStartReviseVoice: () => void;
  onStopReviseVoice: () => void;
  onApplyRevise: () => void;
}) {
  return (
    <div className="flex min-h-dvh flex-col pt-safe">
      <header className="flex items-center justify-between px-4 pt-4">
        <button
          onClick={onBack}
          aria-label="戻る"
          className="flex h-11 w-11 items-center justify-center rounded-full bg-surface active:opacity-60"
        >
          <ChevronLeftIcon />
        </button>
        <span className="pr-2 text-[13px] text-text-tertiary">{sourceLabel}</span>
      </header>

      <div className="flex-1 overflow-y-auto px-6 pt-4">
        {/* タイトル */}
        <input
          value={diary.title}
          onChange={(e) => onChangeTitle(e.target.value)}
          aria-label="日記タイトル"
          className="w-full bg-transparent text-[21px] font-bold leading-snug text-text outline-none"
          placeholder="タイトル"
        />
        {/* 本文 */}
        <AutoTextarea
          value={diary.body}
          onChange={onChangeBody}
          ariaLabel="日記本文"
          className="mt-3 w-full resize-none bg-transparent text-[15.5px] leading-[1.95] text-text outline-none"
        />

        {/* 元の文字起こし（折りたたみ） */}
        <div className="mt-5">
          <button
            onClick={onToggleTranscript}
            className="flex w-full items-center justify-between py-2 text-[14px] text-text-secondary"
          >
            <span>元の文字起こし</span>
            <ChevronDownIcon
              width={18}
              height={18}
              className="transition-transform duration-200"
              style={{ transform: transcriptOpen ? 'rotate(180deg)' : 'none' }}
            />
          </button>
          {transcriptOpen && (
            <div className="mt-1 whitespace-pre-wrap rounded-card border border-border bg-surface p-4 text-[13.5px] leading-relaxed text-text-secondary">
              {diary.rawTranscript || '（文字起こしなし）'}
            </div>
          )}
        </div>

        {/* 二次操作: 横スクロールチップ */}
        <div className="-mx-6 mt-6 flex gap-2 overflow-x-auto px-6 pb-2">
          {appleJournalEnabled && (
            <Chip icon={<BookIcon width={16} height={16} />} label="Appleジャーナル" onClick={onSaveApple} />
          )}
          <Chip icon={<BookIcon width={16} height={16} />} label="Day One" onClick={onSaveDayOne} />
          <Chip
            icon={<ExternalLinkIcon width={16} height={16} />}
            label="他のアプリを開く"
            onClick={onSaveOpenApp}
          />
          <Chip icon={<CopyIcon width={16} height={16} />} label="タイトル" onClick={onCopyTitle} />
          <Chip icon={<CopyIcon width={16} height={16} />} label="本文" onClick={onCopyBody} />
          <Chip icon={<CopyIcon width={16} height={16} />} label="全文" onClick={onCopyAll} />
          <Chip icon={<ShareIcon width={16} height={16} />} label="共有" onClick={onShare} />
          <Chip icon={<EditIcon width={16} height={16} />} label="修正を依頼" onClick={onToggleRevise} />
          <Chip icon={<RefreshIcon width={16} height={16} />} label="書き直す" onClick={onRewrite} />
          <Chip
            icon={<TrashIcon width={16} height={16} />}
            label="削除"
            onClick={onDelete}
            destructive
          />
        </div>

        {/* 修正を依頼（テキスト or 音声） */}
        {reviseOpen && (
          <div className="mt-3 rounded-card border border-border bg-surface p-4">
            <h3 className="mb-2 text-[14px] font-semibold text-text">
              どう直したいか教えてください
            </h3>
            <p className="mb-3 text-[12.5px] leading-relaxed text-text-tertiary">
              例:「もっとカジュアルな文体にして」「ゴルフバッグの話は削って」など
            </p>

            {isRecordingRevise ? (
              <div className="flex items-center justify-between rounded-chip border border-border bg-bg px-4 py-3">
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 animate-pulse-dot rounded-full bg-recording" />
                  <span className="tabular text-[15px] font-semibold text-recording">
                    {formatTimer(reviseElapsedMs)}
                  </span>
                </div>
                <button
                  onClick={onStopReviseVoice}
                  aria-label="録音を停止"
                  className="flex h-11 w-11 items-center justify-center rounded-full bg-recording text-white active:scale-95"
                >
                  <StopIcon width={18} height={18} />
                </button>
              </div>
            ) : (
              <textarea
                value={reviseInstruction}
                onChange={(e) => onChangeReviseInstruction(e.target.value)}
                placeholder="修正内容を入力するか、マイクで話してください"
                rows={3}
                className="w-full resize-none rounded-chip border border-border bg-bg p-3 text-[14.5px] leading-relaxed text-text outline-none focus:border-accent"
              />
            )}

            {reviseError && (
              <p role="alert" className="mt-2 text-[13px] text-error">
                {reviseError}
              </p>
            )}

            <div className="mt-3 flex items-center gap-3">
              {!isRecordingRevise && (
                <button
                  onClick={onStartReviseVoice}
                  disabled={reviseBusy !== 'none'}
                  aria-label="音声で修正を依頼"
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border bg-bg text-text active:opacity-70 disabled:opacity-50"
                >
                  <MicIcon width={18} height={18} />
                </button>
              )}
              <button
                onClick={onApplyRevise}
                disabled={
                  reviseBusy !== 'none' || reviseInstruction.trim().length === 0 || isRecordingRevise
                }
                className="flex h-11 flex-1 items-center justify-center rounded-full bg-accent text-[14.5px] font-bold text-accent-on active:scale-[0.99] disabled:opacity-50"
              >
                {reviseBusy === 'transcribing'
                  ? '文字起こし中…'
                  : reviseBusy === 'revising'
                    ? '修正中…'
                    : 'この内容で修正する'}
              </button>
            </div>
          </div>
        )}

        {diary.tags.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {diary.tags.map((t) => (
              <span
                key={t}
                className="rounded-full bg-surface px-2.5 py-1 text-[12px] text-text-secondary"
              >
                #{t}
              </span>
            ))}
          </div>
        )}
        <div className="h-24" />
      </div>

      {/* 主要 CTA: キーボード追従のため sticky */}
      <div className="sticky bottom-0 bg-gradient-to-t from-bg via-bg to-transparent px-6 pb-safe pt-3">
        <button
          onClick={onPrimarySave}
          className="mb-3 flex h-14 w-full items-center justify-center rounded-full bg-accent text-[17px] font-bold text-accent-on shadow-cta active:scale-[0.99]"
        >
          保存する
        </button>
      </div>
    </div>
  );
}

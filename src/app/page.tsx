'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Diary } from '@/lib/diary';
import { DEFAULT_STYLE } from '@/lib/diary';
import { ApiError, generateDiaryApi, transcribeAudio } from '@/lib/api';
import { extForMime, useRecorder } from '@/hooks/useRecorder';
import { loadSettings, type Settings } from '@/lib/settings';
import {
  Draft,
  deleteDraft,
  listDrafts,
  newDraftId,
  saveDraft,
} from '@/lib/drafts';
import { copyText } from '@/lib/clipboard';
import {
  buildDayOneUrl,
  buildShortcutUrl,
  fullText,
  isShortcutUrlTooLong,
  shareData,
  shortcutJson,
} from '@/lib/share';
import { combineTranscripts, formatBytes, formatDate, formatDuration, formatTimer } from '@/lib/format';
import {
  AlertTriangleIcon,
  BookIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  KeyboardIcon,
  MicIcon,
  PauseIcon,
  PlayIcon,
  RefreshIcon,
  SettingsIcon,
  ShareIcon,
  StopIcon,
  TrashIcon,
  UploadIcon,
  XIcon,
} from '@/components/icons';
import { Waveform } from '@/components/Waveform';
import { Toast } from '@/components/Toast';
import { SaveSheet, type SaveChoice } from '@/components/SaveSheet';

type Screen =
  | 'home'
  | 'quick'
  | 'files'
  | 'permission'
  | 'recording'
  | 'transcribing'
  | 'generating'
  | 'result'
  | 'error'
  | 'empty';

/** 日記の元になった入力方法。結果画面のラベル表示に使う。 */
type InputMode = 'record' | 'quick' | 'files';

const MIN_RECORDING_MS = 2000;
const LONG_RECORDING_MS = 20 * 60 * 1000; // 20分の目安

export default function AppPage() {
  const router = useRouter();
  const recorder = useRecorder();

  const [screen, setScreen] = useState<Screen>('home');
  const [settings, setSettings] = useState<Settings>(() => ({
    style: DEFAULT_STYLE,
    saveTarget: 'ask',
    dayoneJournal: '',
  }));
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [diary, setDiary] = useState<Diary | null>(null);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [durationSec, setDurationSec] = useState(0);
  const [transcript, setTranscript] = useState('');
  const [quickText, setQuickText] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [saveSheetOpen, setSaveSheetOpen] = useState(false);
  const [inputMode, setInputMode] = useState<InputMode>('record');
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [transcribeProgress, setTranscribeProgress] = useState({ current: 0, total: 0 });

  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const refreshDrafts = useCallback(async () => {
    try {
      setDrafts(await listDrafts());
    } catch {
      setDrafts([]);
    }
  }, []);

  // 初期ロード: 設定と下書き
  useEffect(() => {
    setSettings(loadSettings());
    void refreshDrafts();
  }, [refreshDrafts]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 1600);
  }, []);

  // 録音中/処理中は離脱を警告
  const busyRef = useRef(false);
  busyRef.current = ['recording', 'transcribing', 'generating'].includes(screen);
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (busyRef.current) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  // --- 録音フロー --------------------------------------------------------
  async function startRecording() {
    const ok = await recorder.start();
    if (!ok) {
      if (recorder.error === 'permission') setScreen('permission');
      else setErrorMsg('録音を開始できませんでした。'), setScreen('error');
      return;
    }
    setScreen('recording');
  }

  async function stopRecording() {
    const blob = await recorder.stop();
    const elapsed = recorder.elapsedMs;
    if (!blob || elapsed < MIN_RECORDING_MS || blob.size < 1024) {
      setScreen('empty');
      return;
    }
    setDurationSec(Math.round(elapsed / 1000));
    await runTranscribeAndGenerate(blob);
  }

  function cancelRecording() {
    recorder.cancel();
    setScreen('home');
  }

  async function runTranscribeAndGenerate(blob: Blob) {
    setScreen('transcribing');
    setInputMode('record');
    let text = '';
    try {
      const filename = `recording.${extForMime(recorder.mimeType)}`;
      text = await transcribeAudio(blob, filename);
    } catch (err) {
      handleApiError(err, '文字起こしに失敗しました。');
      return;
    }
    if (!text.trim()) {
      setScreen('empty');
      return;
    }
    setTranscript(text);
    await runGenerate(text);
  }

  // --- 複数音声ファイルのアップロード -------------------------------------
  function triggerFilePicker() {
    fileInputRef.current?.click();
  }

  function onFilesChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const chosen = Array.from(e.target.files ?? []);
    if (chosen.length > 0) {
      setSelectedFiles((prev) => [...prev, ...chosen]);
      setScreen('files');
    }
    // 同じファイルを選び直しても onChange が発火するようリセット
    e.target.value = '';
  }

  function removeSelectedFile(index: number) {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
  }

  function cancelFiles() {
    setSelectedFiles([]);
    setScreen('home');
  }

  /** 429（レート制限）のときは Retry-After ぶん待って1回だけ再試行する。 */
  async function transcribeWithRetry(file: File): Promise<string> {
    try {
      return await transcribeAudio(file, file.name || 'audio');
    } catch (err) {
      if (err instanceof ApiError && err.status === 429 && err.retryAfter) {
        const waitMs = Math.min(err.retryAfter, 30) * 1000;
        await new Promise((resolve) => setTimeout(resolve, waitMs));
        return transcribeAudio(file, file.name || 'audio');
      }
      throw err;
    }
  }

  async function submitFiles() {
    if (selectedFiles.length === 0) return;
    const files = selectedFiles;
    setScreen('transcribing');
    setInputMode('files');
    setTranscribeProgress({ current: 0, total: files.length });

    const parts: string[] = [];
    try {
      for (let i = 0; i < files.length; i++) {
        setTranscribeProgress({ current: i + 1, total: files.length });
        const text = await transcribeWithRetry(files[i]);
        parts.push(text);
      }
    } catch (err) {
      handleApiError(err, '音声ファイルの文字起こしに失敗しました。');
      return;
    }

    const combined = combineTranscripts(parts);
    if (!combined) {
      setScreen('empty');
      return;
    }
    setTranscript(combined);
    setDurationSec(0);
    setDraftId(null);
    await runGenerate(combined);
  }

  async function runGenerate(text: string) {
    setScreen('generating');
    try {
      const result = await generateDiaryApi(text, settings.style);
      setDiary(result);
      const id = draftId ?? newDraftId();
      setDraftId(id);
      await persistDraft(id, result);
      setTranscriptOpen(false);
      setScreen('result');
    } catch (err) {
      handleApiError(err, '日記の生成に失敗しました。');
    }
  }

  function handleApiError(err: unknown, fallback: string) {
    if (err instanceof ApiError) {
      if (err.status === 401) {
        window.location.assign('/login');
        return;
      }
      setErrorMsg(err.message || fallback);
    } else {
      setErrorMsg(fallback);
    }
    setScreen('error');
  }

  async function persistDraft(id: string, d: Diary) {
    const now = new Date().toISOString();
    const existing = drafts.find((x) => x.id === id);
    const draft: Draft = {
      id,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      diary: d,
      durationSec,
    };
    try {
      await saveDraft(draft);
      await refreshDrafts();
    } catch {
      /* IndexedDB 不可環境では黙って続行 */
    }
  }

  // --- クイック入力（キーボード音声入力） -------------------------------
  async function submitQuick() {
    const text = quickText.trim();
    if (!text) return;
    setTranscript(text);
    setDurationSec(0);
    setDraftId(null);
    setInputMode('quick');
    await runGenerate(text);
  }

  // --- 結果画面の編集 ----------------------------------------------------
  function updateDiary(patch: Partial<Diary>) {
    setDiary((d) => {
      if (!d) return d;
      const next = { ...d, ...patch };
      if (draftId) void persistDraft(draftId, next);
      return next;
    });
  }

  // --- 保存処理 ----------------------------------------------------------
  function currentPayload() {
    if (!diary) return null;
    return {
      title: diary.title,
      body: diary.body,
      tags: diary.tags,
      createdAt: new Date().toISOString(),
    };
  }

  async function saveToApple() {
    const p = currentPayload();
    if (!p) return;
    // URL が長すぎる場合はクリップボード経由の代替方式
    if (isShortcutUrlTooLong(p)) {
      const ok = await copyText(JSON.stringify(shortcutJson(p)));
      if (ok) {
        showToast('内容をコピーしました。ショートカットに貼り付けてください');
      }
    }
    window.location.href = buildShortcutUrl(p);
    await finishSave();
  }

  async function saveToDayOne() {
    if (!diary) return;
    const url = buildDayOneUrl({
      title: diary.title,
      body: diary.body,
      tags: diary.tags,
      journal: settings.dayoneJournal || undefined,
    });
    // Day One 未インストールでもスキームを試み、フォールバックとして本文をコピー
    await copyText(fullText(diary.title, diary.body));
    window.location.href = url;
    await finishSave();
  }

  async function saveToClipboard() {
    if (!diary) return;
    const ok = await copyText(fullText(diary.title, diary.body));
    if (ok) showToast('コピーしました');
    await finishSave();
  }

  async function onPrimarySave() {
    switch (settings.saveTarget) {
      case 'apple':
        return saveToApple();
      case 'dayone':
        return saveToDayOne();
      case 'clipboard':
        return saveToClipboard();
      default:
        setSaveSheetOpen(true);
    }
  }

  async function onSheetSelect(choice: SaveChoice) {
    setSaveSheetOpen(false);
    if (choice === 'apple') return saveToApple();
    if (choice === 'dayone') return saveToDayOne();
    return saveToClipboard();
  }

  /** 保存後の後始末: 下書きを削除しホームへ。 */
  async function finishSave() {
    showToast('保存しました');
    if (draftId) {
      try {
        await deleteDraft(draftId);
      } catch {
        /* noop */
      }
    }
    setTimeout(async () => {
      await refreshDrafts();
      resetToHome();
    }, 900);
  }

  function resetToHome() {
    setDiary(null);
    setDraftId(null);
    setTranscript('');
    setQuickText('');
    setDurationSec(0);
    setSelectedFiles([]);
    setInputMode('record');
    recorder.reset();
    setScreen('home');
  }

  async function discardCurrent() {
    if (draftId) {
      try {
        await deleteDraft(draftId);
      } catch {
        /* noop */
      }
      await refreshDrafts();
    }
    resetToHome();
  }

  async function resumeDraft(d: Draft) {
    setDiary(d.diary);
    setDraftId(d.id);
    setTranscript(d.diary.rawTranscript);
    setDurationSec(d.durationSec ?? 0);
    setSelectedFiles([]);
    setInputMode('record');
    setTranscriptOpen(false);
    setScreen('result');
  }

  async function discardDraft(id: string) {
    try {
      await deleteDraft(id);
    } catch {
      /* noop */
    }
    await refreshDrafts();
  }

  // --- コピー系 ----------------------------------------------------------
  async function copyTitle() {
    if (!diary) return;
    if (await copyText(diary.title)) showToast('タイトルをコピーしました');
  }
  async function copyBody() {
    if (!diary) return;
    if (await copyText(diary.body)) showToast('本文をコピーしました');
  }
  async function copyAll() {
    if (!diary) return;
    if (await copyText(fullText(diary.title, diary.body))) showToast('全文をコピーしました');
  }
  async function shareSheet() {
    if (!diary) return;
    const data = shareData(diary.title, diary.body);
    if (navigator.share) {
      try {
        await navigator.share(data);
      } catch {
        /* ユーザーキャンセルなどは無視 */
      }
    } else {
      if (await copyText(data.text)) showToast('共有できないため全文をコピーしました');
    }
  }

  // =======================================================================
  // 画面描画
  // =======================================================================
  return (
    <main className="mx-auto flex min-h-dvh max-w-[440px] flex-col">
      {screen === 'home' && (
        <HomeScreen
          drafts={drafts}
          onOpenSettings={() => router.push('/settings')}
          onRecord={startRecording}
          onQuick={() => {
            setQuickText('');
            setScreen('quick');
          }}
          onPickFiles={triggerFilePicker}
          onResume={resumeDraft}
          onDiscard={discardDraft}
        />
      )}

      {screen === 'quick' && (
        <QuickScreen
          value={quickText}
          onChange={setQuickText}
          onBack={() => setScreen('home')}
          onSubmit={submitQuick}
        />
      )}

      {screen === 'files' && (
        <FilesScreen
          files={selectedFiles}
          onRemove={removeSelectedFile}
          onAddMore={triggerFilePicker}
          onCancel={cancelFiles}
          onSubmit={submitFiles}
        />
      )}

      {screen === 'permission' && (
        <PermissionScreen onRetry={startRecording} onBack={() => setScreen('home')} />
      )}

      {screen === 'recording' && (
        <RecordingScreen
          elapsedMs={recorder.elapsedMs}
          paused={recorder.status === 'paused'}
          tooLong={recorder.elapsedMs > LONG_RECORDING_MS}
          onPause={recorder.pause}
          onResume={recorder.resume}
          onStop={stopRecording}
          onCancel={cancelRecording}
        />
      )}

      {(screen === 'transcribing' || screen === 'generating') && (
        <ProcessingScreen
          title={screen === 'transcribing' ? '文字起こし中…' : '日記を生成中…'}
          subtitle={
            screen === 'transcribing'
              ? inputMode === 'files' && transcribeProgress.total > 1
                ? `音声ファイルを文字起こし中…（${transcribeProgress.current}/${transcribeProgress.total}）`
                : '話した内容を文字にしています'
              : 'あなたの言葉から日記をまとめています'
          }
          onCancel={resetToHome}
        />
      )}

      {screen === 'empty' && (
        <EmptyScreen onRetry={startRecording} onHome={() => setScreen('home')} />
      )}

      {screen === 'error' && (
        <ErrorScreen
          message={errorMsg}
          canRetry={transcript.length > 0}
          onRetry={() => runGenerate(transcript)}
          onBack={() =>
            setScreen(diary ? 'result' : selectedFiles.length > 0 ? 'files' : 'home')
          }
        />
      )}

      {screen === 'result' && diary && (
        <ResultScreen
          diary={diary}
          sourceLabel={sourceLabel(inputMode, durationSec, selectedFiles.length)}
          transcriptOpen={transcriptOpen}
          onToggleTranscript={() => setTranscriptOpen((v) => !v)}
          onChangeTitle={(t) => updateDiary({ title: t })}
          onChangeBody={(b) => updateDiary({ body: b })}
          onBack={resetToHome}
          onCopyTitle={copyTitle}
          onCopyBody={copyBody}
          onCopyAll={copyAll}
          onShare={shareSheet}
          onSaveApple={saveToApple}
          onSaveDayOne={saveToDayOne}
          onRewrite={() => runGenerate(transcript)}
          onDelete={discardCurrent}
          onPrimarySave={onPrimarySave}
        />
      )}

      <Toast message={toast ?? ''} visible={toast !== null} />
      <SaveSheet
        open={saveSheetOpen}
        onSelect={onSheetSelect}
        onClose={() => setSaveSheetOpen(false)}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*"
        multiple
        className="hidden"
        onChange={onFilesChosen}
      />
    </main>
  );
}

/** 結果画面ヘッダーに出す入力元ラベル（録音時間 / 手入力 / 音声ファイルN件）。 */
function sourceLabel(mode: InputMode, durationSec: number, fileCount: number): string {
  if (mode === 'files') return `音声ファイル${fileCount}件から作成`;
  if (durationSec > 0) return `録音時間 ${formatDuration(durationSec)}`;
  return '手入力';
}

// =========================================================================
// 各画面コンポーネント
// =========================================================================

function HomeScreen({
  drafts,
  onOpenSettings,
  onRecord,
  onQuick,
  onPickFiles,
  onResume,
  onDiscard,
}: {
  drafts: Draft[];
  onOpenSettings: () => void;
  onRecord: () => void;
  onQuick: () => void;
  onPickFiles: () => void;
  onResume: (d: Draft) => void;
  onDiscard: (id: string) => void;
}) {
  const [firstDraft, ...restDrafts] = drafts;
  return (
    <div className="flex min-h-dvh flex-col pt-safe">
      <header className="flex items-center justify-between px-6 pt-4">
        <h1 className="text-[24px] font-bold">日記</h1>
        <button
          onClick={onOpenSettings}
          aria-label="設定"
          className="flex h-9 w-9 items-center justify-center rounded-full border border-border text-text active:opacity-60"
        >
          <SettingsIcon width={18} height={18} />
        </button>
      </header>

      {firstDraft && (
        <div className="mx-6 mt-4 flex items-center gap-3 rounded-card bg-warning-soft px-4 py-3">
          <AlertTriangleIcon width={18} height={18} className="shrink-0 text-warning" />
          <span className="flex-1 text-[13.5px] text-text-secondary">
            保存されていない下書きがあります
          </span>
          <button
            onClick={() => onResume(firstDraft)}
            className="text-[14px] font-semibold text-accent active:opacity-60"
          >
            再開
          </button>
          <button
            onClick={() => onDiscard(firstDraft.id)}
            className="text-[14px] text-text-tertiary active:opacity-60"
          >
            破棄
          </button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-6 pt-6">
        <h2 className="mb-1 text-[12px] font-medium text-text-tertiary">最近の記録</h2>
        {drafts.length === 0 ? (
          <div className="mt-24 text-center text-[14px] leading-relaxed text-text-tertiary">
            まだ記録がありません。
            <br />
            下のボタンから話しはじめましょう。
          </div>
        ) : (
          <ul>
            {restDrafts.map((d) => (
              <DraftRow key={d.id} draft={d} onClick={() => onResume(d)} />
            ))}
            {/* firstDraft はバナーに出るが一覧にも表示 */}
            {firstDraft && <DraftRow draft={firstDraft} onClick={() => onResume(firstDraft)} />}
          </ul>
        )}
      </div>

      {/* フッター: 親指到達域 */}
      <div className="sticky bottom-0 mt-auto bg-gradient-to-t from-bg via-bg to-transparent px-6 pb-safe pt-6">
        <div className="flex flex-col items-center gap-2 pb-3">
          <button
            onClick={onQuick}
            className="flex h-11 items-center gap-2 rounded-full border border-border bg-surface px-5 text-[14px] font-medium text-text active:opacity-70"
          >
            <KeyboardIcon width={18} height={18} />
            すぐ話す（キーボード入力）
          </button>
          <button
            onClick={onPickFiles}
            className="flex h-11 items-center gap-2 rounded-full border border-border bg-surface px-5 text-[14px] font-medium text-text active:opacity-70"
          >
            <UploadIcon width={18} height={18} />
            音声ファイルをアップロード
          </button>
          <button
            onClick={onRecord}
            aria-label="録音して日記化"
            className="flex h-[76px] w-[76px] items-center justify-center rounded-[38px] bg-accent text-accent-on shadow-cta transition active:scale-[1.08]"
          >
            <MicIcon width={30} height={30} />
          </button>
          <span className="text-[12px] text-text-tertiary">録音して日記化</span>
        </div>
      </div>
    </div>
  );
}

function DraftRow({ draft, onClick }: { draft: Draft; onClick: () => void }) {
  return (
    <li className="border-b border-border">
      <button
        onClick={onClick}
        className="flex min-h-[44px] w-full items-center gap-3 py-3.5 text-left active:opacity-60"
      >
        <div className="flex-1">
          <div className="text-[12px] text-text-tertiary">
            {formatDate(draft.createdAt)}
            {draft.durationSec ? ` ・ ${formatDuration(draft.durationSec)}` : ''}
          </div>
          <div className="mt-0.5 text-[16px] font-semibold text-text">
            {draft.diary.title || '無題の日記'}
          </div>
        </div>
        <ChevronRightIcon width={20} height={20} className="text-text-tertiary" />
      </button>
    </li>
  );
}

function QuickScreen({
  value,
  onChange,
  onBack,
  onSubmit,
}: {
  value: string;
  onChange: (v: string) => void;
  onBack: () => void;
  onSubmit: () => void;
}) {
  return (
    <div className="flex min-h-dvh flex-col pt-safe">
      <header className="flex items-center gap-2 px-4 pt-4">
        <button
          onClick={onBack}
          aria-label="戻る"
          className="flex h-11 w-11 items-center justify-center rounded-full active:opacity-60"
        >
          <ChevronLeftIcon />
        </button>
        <h1 className="text-[18px] font-bold">すぐ話す</h1>
      </header>
      <div className="flex-1 px-6 pt-4">
        <p className="mb-3 text-[13px] text-text-secondary">
          キーボードのマイクボタンで音声入力できます。話し終えたら「日記にする」を押してください。
        </p>
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoFocus
          placeholder="今日あったこと、感じたことを話してください…"
          className="h-64 w-full resize-none rounded-card border border-border bg-surface p-4 text-[16px] leading-relaxed text-text outline-none focus:border-accent"
        />
      </div>
      <div className="sticky bottom-0 bg-bg px-6 pb-safe pt-3">
        <button
          onClick={onSubmit}
          disabled={value.trim().length === 0}
          className="mb-3 flex h-14 w-full items-center justify-center rounded-full bg-accent text-[17px] font-bold text-accent-on shadow-cta active:scale-[0.99] disabled:opacity-50"
        >
          日記にする
        </button>
      </div>
    </div>
  );
}

function FilesScreen({
  files,
  onRemove,
  onAddMore,
  onCancel,
  onSubmit,
}: {
  files: File[];
  onRemove: (index: number) => void;
  onAddMore: () => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  return (
    <div className="flex min-h-dvh flex-col pt-safe">
      <header className="flex items-center gap-2 px-4 pt-4">
        <button
          onClick={onCancel}
          aria-label="戻る"
          className="flex h-11 w-11 items-center justify-center rounded-full active:opacity-60"
        >
          <ChevronLeftIcon />
        </button>
        <h1 className="text-[18px] font-bold">音声ファイルから作る</h1>
      </header>
      <div className="flex-1 px-6 pt-4">
        <p className="mb-3 text-[13px] leading-relaxed text-text-secondary">
          選んだ順番につなげて1つの日記にします。ボイスメモなどで録音した音声ファイルを選んでください。
        </p>

        {files.length === 0 ? (
          <div className="mt-16 text-center text-[14px] text-text-tertiary">
            まだファイルが選ばれていません。
          </div>
        ) : (
          <ul className="overflow-hidden rounded-card border border-border bg-surface">
            {files.map((f, i) => (
              <li
                key={`${f.name}-${f.lastModified}-${i}`}
                className={`flex items-center gap-3 px-4 py-3 ${i > 0 ? 'border-t border-border' : ''}`}
              >
                <span className="flex-1 truncate text-[14px] text-text">{f.name}</span>
                <span className="shrink-0 text-[12px] text-text-tertiary">
                  {formatBytes(f.size)}
                </span>
                <button
                  onClick={() => onRemove(i)}
                  aria-label={`${f.name} を削除`}
                  className="flex h-8 w-8 shrink-0 items-center justify-center text-text-tertiary active:opacity-60"
                >
                  <XIcon width={16} height={16} />
                </button>
              </li>
            ))}
          </ul>
        )}

        <button
          onClick={onAddMore}
          className="mt-3 flex h-11 items-center gap-2 rounded-full border border-border bg-surface px-4 text-[14px] font-medium text-text active:opacity-70"
        >
          <UploadIcon width={16} height={16} />
          さらに追加する
        </button>
      </div>
      <div className="sticky bottom-0 bg-bg px-6 pb-safe pt-3">
        <button
          onClick={onSubmit}
          disabled={files.length === 0}
          className="mb-3 flex h-14 w-full items-center justify-center rounded-full bg-accent text-[17px] font-bold text-accent-on shadow-cta active:scale-[0.99] disabled:opacity-50"
        >
          文字起こしして日記にする
        </button>
      </div>
    </div>
  );
}

function PermissionScreen({ onRetry, onBack }: { onRetry: () => void; onBack: () => void }) {
  return (
    <CenterScreen>
      <div className="mb-5 flex h-20 w-20 items-center justify-center rounded-3xl bg-warning-soft text-warning">
        <MicIcon width={34} height={34} />
      </div>
      <h1 className="text-[20px] font-bold">マイクへのアクセスが必要です</h1>
      <p className="mt-2 max-w-[280px] text-[14px] leading-relaxed text-text-secondary">
        録音するにはマイクの許可が必要です。iPhoneの「設定 &gt; Safari &gt; マイク」または
        アプリの権限を確認し、許可してください。
      </p>
      <button
        onClick={onRetry}
        className="mt-7 flex h-13 h-[52px] w-full max-w-[280px] items-center justify-center rounded-full bg-accent text-[16px] font-semibold text-accent-on active:scale-[0.99]"
      >
        もう一度試す
      </button>
      <button onClick={onBack} className="mt-3 min-h-[44px] text-[14px] text-text-secondary">
        あとで
      </button>
    </CenterScreen>
  );
}

function RecordingScreen({
  elapsedMs,
  paused,
  tooLong,
  onPause,
  onResume,
  onStop,
  onCancel,
}: {
  elapsedMs: number;
  paused: boolean;
  tooLong: boolean;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-between pt-safe pb-safe">
      <div className="w-full">
        {tooLong && (
          <div className="mx-6 mt-6 flex items-center gap-2 rounded-card bg-warning-soft px-4 py-3 text-[13px] text-warning">
            <AlertTriangleIcon width={16} height={16} />
            録音が長くなっています。区切って保存すると失敗しにくくなります。
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-6">
        <div className="flex items-center gap-2 text-[15px] font-medium">
          <span
            className={`h-2.5 w-2.5 rounded-full ${
              paused ? 'bg-text-tertiary' : 'animate-pulse-dot bg-recording'
            }`}
          />
          <span className={paused ? 'text-text-tertiary' : 'text-recording'}>
            {paused ? '一時停止中' : '録音中'}
          </span>
        </div>
        <div className="tabular text-[52px] font-bold leading-none">{formatTimer(elapsedMs)}</div>
        <Waveform active={!paused} />
      </div>

      <p className="px-8 text-center text-[12px] text-text-tertiary">
        録音中はこの画面を閉じないでください。
      </p>

      <div className="mb-6 mt-4 flex items-center justify-center gap-7">
        <button
          onClick={onCancel}
          aria-label="キャンセル"
          className="flex h-14 w-14 items-center justify-center rounded-full border border-border bg-surface text-text active:opacity-70"
        >
          <XIcon width={22} height={22} />
        </button>
        <button
          onClick={onStop}
          aria-label="停止して日記化"
          className="flex h-[76px] w-[76px] items-center justify-center rounded-full bg-recording text-white shadow-cta active:scale-[0.97]"
        >
          <StopIcon width={30} height={30} />
        </button>
        {paused ? (
          <button
            onClick={onResume}
            aria-label="再開"
            className="flex h-14 w-14 items-center justify-center rounded-full border border-border bg-surface text-text active:opacity-70"
          >
            <PlayIcon width={22} height={22} />
          </button>
        ) : (
          <button
            onClick={onPause}
            aria-label="一時停止"
            className="flex h-14 w-14 items-center justify-center rounded-full border border-border bg-surface text-text active:opacity-70"
          >
            <PauseIcon width={22} height={22} />
          </button>
        )}
      </div>
    </div>
  );
}

function ProcessingScreen({
  title,
  subtitle,
  onCancel,
}: {
  title: string;
  subtitle: string;
  onCancel: () => void;
}) {
  return (
    <CenterScreen>
      <div className="mb-6 h-16 w-16 animate-spin360 rounded-full border-[3px] border-border border-t-accent" />
      <h1 className="text-[18px] font-bold">{title}</h1>
      <p className="mt-2 text-[13.5px] text-text-secondary">{subtitle}</p>
      <button onClick={onCancel} className="mt-8 min-h-[44px] text-[14px] text-text-secondary">
        キャンセル
      </button>
    </CenterScreen>
  );
}

function EmptyScreen({ onRetry, onHome }: { onRetry: () => void; onHome: () => void }) {
  return (
    <CenterScreen>
      <div className="mb-5 flex h-20 w-20 items-center justify-center rounded-3xl bg-surface text-text-tertiary">
        <MicIcon width={34} height={34} />
      </div>
      <h1 className="text-[20px] font-bold">音声が検出されませんでした</h1>
      <p className="mt-2 max-w-[260px] text-[14px] leading-relaxed text-text-secondary">
        うまく録音できなかったようです。もう一度お試しください。
      </p>
      <button
        onClick={onRetry}
        className="mt-7 flex h-[52px] w-full max-w-[280px] items-center justify-center rounded-full bg-accent text-[16px] font-semibold text-accent-on active:scale-[0.99]"
      >
        もう一度録音する
      </button>
      <button onClick={onHome} className="mt-3 min-h-[44px] text-[14px] text-text-secondary">
        ホームへ
      </button>
    </CenterScreen>
  );
}

function ErrorScreen({
  message,
  canRetry,
  onRetry,
  onBack,
}: {
  message: string;
  canRetry: boolean;
  onRetry: () => void;
  onBack: () => void;
}) {
  return (
    <CenterScreen>
      <div className="mb-5 flex h-20 w-20 items-center justify-center rounded-3xl bg-error-soft text-error">
        <AlertTriangleIcon width={34} height={34} />
      </div>
      <h1 className="text-[20px] font-bold">生成に失敗しました</h1>
      <p className="mt-2 max-w-[280px] text-[14px] leading-relaxed text-text-secondary">
        {message || '通信エラーが発生しました。'}
        {canRetry && (
          <>
            <br />
            文字起こしは保持されています。
          </>
        )}
      </p>
      {canRetry && (
        <button
          onClick={onRetry}
          className="mt-7 flex h-[52px] w-full max-w-[280px] items-center justify-center rounded-full bg-accent text-[16px] font-semibold text-accent-on active:scale-[0.99]"
        >
          再試行
        </button>
      )}
      <button onClick={onBack} className="mt-3 min-h-[44px] text-[14px] text-text-secondary">
        戻る
      </button>
    </CenterScreen>
  );
}

function ResultScreen({
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
  onSaveApple,
  onSaveDayOne,
  onRewrite,
  onDelete,
  onPrimarySave,
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
  onSaveApple: () => void;
  onSaveDayOne: () => void;
  onRewrite: () => void;
  onDelete: () => void;
  onPrimarySave: () => void;
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
          <Chip icon={<BookIcon width={16} height={16} />} label="Appleジャーナル" onClick={onSaveApple} />
          <Chip icon={<BookIcon width={16} height={16} />} label="Day One" onClick={onSaveDayOne} />
          <Chip icon={<CopyIcon width={16} height={16} />} label="タイトル" onClick={onCopyTitle} />
          <Chip icon={<CopyIcon width={16} height={16} />} label="本文" onClick={onCopyBody} />
          <Chip icon={<CopyIcon width={16} height={16} />} label="全文" onClick={onCopyAll} />
          <Chip icon={<ShareIcon width={16} height={16} />} label="共有" onClick={onShare} />
          <Chip icon={<RefreshIcon width={16} height={16} />} label="書き直す" onClick={onRewrite} />
          <Chip
            icon={<TrashIcon width={16} height={16} />}
            label="削除"
            onClick={onDelete}
            destructive
          />
        </div>

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

function Chip({
  icon,
  label,
  onClick,
  destructive,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  destructive?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-chip border border-border bg-surface px-3.5 text-[13px] active:opacity-70 ${
        destructive ? 'text-error' : 'text-text'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

/** 内容に合わせて高さが伸びる textarea。 */
function AutoTextarea({
  value,
  onChange,
  ariaLabel,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  ariaLabel: string;
  className?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight}px`;
    }
  }, [value]);
  return (
    <textarea
      ref={ref}
      value={value}
      aria-label={ariaLabel}
      onChange={(e) => onChange(e.target.value)}
      rows={4}
      className={className}
    />
  );
}

function CenterScreen({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-7 pt-safe pb-safe text-center">
      {children}
    </div>
  );
}

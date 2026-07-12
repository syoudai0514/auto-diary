'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Diary } from '@/lib/diary';
import { ApiError, generateDiaryApi, reviseDiaryApi, transcribeAudio } from '@/lib/api';
import { withRetryOn429 } from '@/lib/retry';
import { extForMime, useRecorder } from '@/hooks/useRecorder';
import { useToast } from '@/hooks/useToast';
import { expandToChunks, MAX_CLIENT_AUDIO_BYTES } from '@/lib/audioChunk';
import { DEFAULT_SETTINGS, loadSettings, type Settings } from '@/lib/settings';
import { loadProfile } from '@/lib/profile';
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
  buildRunShortcutUrl,
  buildShortcutUrl,
  fullText,
  isShortcutUrlTooLong,
  shareData,
  shortcutJson,
  OPEN_APP_SHORTCUT_NAME,
  SHORTCUT_NAME,
} from '@/lib/share';
import { combineTranscripts, sourceLabel } from '@/lib/format';
import { Toast } from '@/components/Toast';
import { SaveSheet, type SaveChoice } from '@/components/SaveSheet';
import { HomeScreen } from '@/components/screens/HomeScreen';
import { QuickScreen } from '@/components/screens/QuickScreen';
import { FilesScreen } from '@/components/screens/FilesScreen';
import { RecordingScreen } from '@/components/screens/RecordingScreen';
import { ResultScreen } from '@/components/screens/ResultScreen';
import {
  EmptyScreen,
  ErrorScreen,
  PermissionScreen,
  ProcessingScreen,
} from '@/components/screens/StatusScreens';

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
  const [settings, setSettings] = useState<Settings>(() => ({ ...DEFAULT_SETTINGS }));
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [diary, setDiary] = useState<Diary | null>(null);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [durationSec, setDurationSec] = useState(0);
  const [transcript, setTranscript] = useState('');
  const [quickText, setQuickText] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [saveSheetOpen, setSaveSheetOpen] = useState(false);
  const [inputMode, setInputMode] = useState<InputMode>('record');
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [transcribeProgress, setTranscribeProgress] = useState({ current: 0, total: 0 });
  const [isPreparingAudio, setIsPreparingAudio] = useState(false);
  const [reviseOpen, setReviseOpen] = useState(false);
  const [reviseInstruction, setReviseInstruction] = useState('');
  const [reviseBusy, setReviseBusy] = useState<'none' | 'transcribing' | 'revising'>('none');
  const [reviseError, setReviseError] = useState('');
  const [profileMarkdown, setProfileMarkdown] = useState('');

  const { toast, showToast } = useToast();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const refreshDrafts = useCallback(async () => {
    try {
      setDrafts(await listDrafts());
    } catch {
      setDrafts([]);
    }
  }, []);

  // 初期ロード: 設定・プロフィール・下書き
  useEffect(() => {
    setSettings(loadSettings());
    setProfileMarkdown(loadProfile().markdown);
    void refreshDrafts();
  }, [refreshDrafts]);

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
    setInputMode('record');
    const filename = `recording.${extForMime(recorder.mimeType)}`;
    await transcribeItemsAndGenerate([{ blob, filename }]);
  }

  function cancelRecording() {
    recorder.cancel();
    setScreen('home');
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

  function transcribeWithRetry(blob: Blob, filename: string): Promise<string> {
    return withRetryOn429(() => transcribeAudio(blob, filename));
  }

  /**
   * 録音・アップロードされた音声（複数可）を文字起こしして日記を生成する共通処理。
   * サイズ上限を超える項目は自動でチャンク分割してから、順番に文字起こしして結合する。
   */
  async function transcribeItemsAndGenerate(rawItems: { blob: Blob; filename: string }[]) {
    setScreen('transcribing');
    setTranscribeProgress({ current: 0, total: 0 });

    let items: { blob: Blob; filename: string }[];
    const needsExpansion = rawItems.some((it) => it.blob.size > MAX_CLIENT_AUDIO_BYTES);
    try {
      if (needsExpansion) setIsPreparingAudio(true);
      // 複数ファイルを同時にデコード・チャンク分割すると、iPhoneでは一度に大量の
      // メモリ（非圧縮PCM・WAVチャンク）を確保することになり不足しうるため、
      // 1ファイルずつ逐次処理する。
      const expanded: { blob: Blob; filename: string }[][] = [];
      for (const it of rawItems) {
        expanded.push(await expandToChunks(it.blob, it.filename));
      }
      items = expanded.flat();
    } catch {
      setErrorMsg('音声の分割処理に失敗しました。この端末では対応していない可能性があります。');
      setScreen('error');
      return;
    } finally {
      setIsPreparingAudio(false);
    }

    setTranscribeProgress({ current: 0, total: items.length });
    const parts: string[] = [];
    try {
      for (let i = 0; i < items.length; i++) {
        setTranscribeProgress({ current: i + 1, total: items.length });
        const text = await transcribeWithRetry(items[i].blob, items[i].filename);
        parts.push(text);
      }
    } catch (err) {
      handleApiError(err, '文字起こしに失敗しました。');
      return;
    }

    const combined = combineTranscripts(parts);
    if (!combined) {
      setScreen('empty');
      return;
    }
    setTranscript(combined);
    await runGenerate(combined);
  }

  async function submitFiles() {
    if (selectedFiles.length === 0) return;
    const files = selectedFiles;
    setInputMode('files');
    setDurationSec(0);
    setDraftId(null);
    await transcribeItemsAndGenerate(files.map((f) => ({ blob: f, filename: f.name || 'audio' })));
  }

  async function runGenerate(text: string) {
    setScreen('generating');
    try {
      const result = await withRetryOn429(() =>
        generateDiaryApi(text, settings.style, profileMarkdown || undefined),
      );
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

  // --- 修正を依頼（テキスト or 音声） -------------------------------------
  function toggleRevise() {
    setReviseOpen((v) => !v);
    setReviseError('');
  }

  function handleReviseError(err: unknown, fallback: string) {
    if (err instanceof ApiError) {
      if (err.status === 401) {
        window.location.assign('/login');
        return;
      }
      setReviseError(err.message || fallback);
    } else {
      setReviseError(fallback);
    }
  }

  async function startReviseVoice() {
    setReviseError('');
    const ok = await recorder.start();
    if (!ok) {
      setReviseError(
        recorder.error === 'permission'
          ? 'マイクへのアクセスが許可されていません。iPhoneの設定を確認してください。'
          : '録音を開始できませんでした。',
      );
    }
  }

  async function stopReviseVoice() {
    const blob = await recorder.stop();
    const elapsed = recorder.elapsedMs;
    recorder.reset();
    if (!blob || elapsed < MIN_RECORDING_MS || blob.size < 1024) {
      setReviseError('音声が短すぎるか、検出されませんでした。');
      return;
    }
    setReviseBusy('transcribing');
    setReviseError('');
    try {
      const filename = `revise-input.${extForMime(recorder.mimeType)}`;
      const text = await transcribeAudio(blob, filename);
      if (!text.trim()) {
        setReviseError('音声を認識できませんでした。');
      } else {
        setReviseInstruction((prev) => (prev ? `${prev}\n${text}` : text));
      }
    } catch (err) {
      handleReviseError(err, '文字起こしに失敗しました。');
    } finally {
      setReviseBusy('none');
    }
  }

  async function applyRevise() {
    if (!diary) return;
    const instruction = reviseInstruction.trim();
    if (!instruction) return;
    setReviseBusy('revising');
    setReviseError('');
    try {
      const updated = await withRetryOn429(() =>
        reviseDiaryApi(transcript, diary, instruction, settings.style, profileMarkdown || undefined),
      );
      setDiary(updated);
      if (draftId) await persistDraft(draftId, updated);
      setReviseInstruction('');
      setReviseOpen(false);
      showToast('修正しました');
    } catch (err) {
      handleReviseError(err, '日記の修正に失敗しました。');
    } finally {
      setReviseBusy('none');
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
    // URL が長すぎると shortcuts:// の起動自体が失敗する（無反応・無言で終わる）ため、
    // その場合は本文を含めない短いURLで起動し、ショートカット側でクリップボードから取得してもらう。
    if (isShortcutUrlTooLong(p)) {
      const ok = await copyText(JSON.stringify(shortcutJson(p)));
      window.location.href = buildRunShortcutUrl(SHORTCUT_NAME);
      await finishSave(
        ok
          ? '内容をコピーしました。ショートカットに貼り付けてください'
          : 'ショートカットを起動しました',
      );
      return;
    }
    window.location.href = buildShortcutUrl(p);
    await finishSave('ショートカットを起動しました。ジャーナルに保存されたか確認してください');
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
    await finishSave('Day Oneを開いています（本文はコピー済みです）');
  }

  async function saveToClipboard() {
    if (!diary) return;
    const ok = await copyText(fullText(diary.title, diary.body));
    await finishSave(ok ? 'コピーしました' : '保存しました');
  }

  /**
   * URLスキーム・共有シートに対応していない日記アプリ向けのフォールバック。
   * 全文をコピーしてから、Shortcuts経由でアプリを開く（本文は手動で貼り付ける）。
   * 事前に「日記アプリを開く」という名前で「アプリを開く」だけのショートカットを
   * 作成しておく必要がある（README参照）。
   */
  async function saveViaOpenApp() {
    if (!diary) return;
    const ok = await copyText(fullText(diary.title, diary.body));
    window.location.href = buildRunShortcutUrl(OPEN_APP_SHORTCUT_NAME);
    await finishSave(ok ? 'コピーしました。アプリを開いています…' : 'アプリを開いています…');
  }

  async function onPrimarySave() {
    switch (settings.saveTarget) {
      case 'apple':
        // 設定で無効化されている（未設定のショートカットで分かりにくいエラーになりうる）場合は
        // 選択し直してもらう。
        if (!settings.appleJournalEnabled) {
          setSaveSheetOpen(true);
          return;
        }
        return saveToApple();
      case 'dayone':
        return saveToDayOne();
      case 'clipboard':
        return saveToClipboard();
      case 'openApp':
        return saveViaOpenApp();
      default:
        setSaveSheetOpen(true);
    }
  }

  async function onSheetSelect(choice: SaveChoice) {
    setSaveSheetOpen(false);
    if (choice === 'apple') return saveToApple();
    if (choice === 'dayone') return saveToDayOne();
    if (choice === 'openApp') return saveViaOpenApp();
    return saveToClipboard();
  }

  /**
   * 保存操作（ショートカット起動・URLスキーム・コピー）を行った直後の後始末。
   * ショートカットやDay One等への保存はURLを開くだけで、実際に保存できたかを
   * このアプリからは確認できない（アプリを何度も渡り歩いて保存する場合もある）ため、
   * ここでは下書きを削除せずホームへ戻すだけにする。下書きは「最近の記録」から
   * 手動で削除するか、一定期間で自動的に消える（listDrafts参照）。
   */
  async function finishSave(message = '保存しました') {
    showToast(message);
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
    setIsPreparingAudio(false);
    setTranscribeProgress({ current: 0, total: 0 });
    setReviseOpen(false);
    setReviseInstruction('');
    setReviseBusy('none');
    setReviseError('');
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
    setReviseOpen(false);
    setReviseInstruction('');
    setReviseError('');
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
          onOpenTalk={() => router.push('/analyze')}
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
          title={
            screen === 'transcribing'
              ? isPreparingAudio
                ? '音声を準備中…'
                : '文字起こし中…'
              : '日記を生成中…'
          }
          subtitle={
            screen === 'transcribing'
              ? isPreparingAudio
                ? '大きな音声を分割しています。少しお待ちください'
                : transcribeProgress.total > 1
                  ? `音声を文字起こし中…（${transcribeProgress.current}/${transcribeProgress.total}）`
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
          appleJournalEnabled={settings.appleJournalEnabled}
          onSaveApple={saveToApple}
          onSaveDayOne={saveToDayOne}
          onSaveOpenApp={saveViaOpenApp}
          onRewrite={() => runGenerate(transcript)}
          onDelete={discardCurrent}
          onPrimarySave={onPrimarySave}
          reviseOpen={reviseOpen}
          reviseInstruction={reviseInstruction}
          reviseBusy={reviseBusy}
          reviseError={reviseError}
          isRecordingRevise={recorder.status === 'recording'}
          reviseElapsedMs={recorder.elapsedMs}
          onToggleRevise={toggleRevise}
          onChangeReviseInstruction={setReviseInstruction}
          onStartReviseVoice={startReviseVoice}
          onStopReviseVoice={stopReviseVoice}
          onApplyRevise={applyRevise}
        />
      )}

      <Toast message={toast ?? ''} visible={toast !== null} />
      <SaveSheet
        open={saveSheetOpen}
        appleJournalEnabled={settings.appleJournalEnabled}
        onSelect={onSheetSelect}
        onClose={() => setSaveSheetOpen(false)}
      />
      <input
        ref={fileInputRef}
        type="file"
        // iOS は audio/* だけだと、拡張子はあってもMIME情報を持たないファイル
        // （Files間の書き出し・Shortcuts経由の保存など）をグレーアウトして選択不可にすることがあるため、
        // 主要な音声拡張子を明示して合わせて許可する（実際の中身チェックはサーバー側で行う）。
        accept="audio/*,.m4a,.mp3,.wav,.aac,.caf,.aiff,.aif,.amr,.flac,.ogg,.opus,.wma,.mp4,.mov"
        multiple
        className="hidden"
        onChange={onFilesChosen}
      />
    </main>
  );
}

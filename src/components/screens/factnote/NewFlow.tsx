'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useRecorder, extForMime, hasRecorderSupport } from '@/hooks/useRecorder';
import { withRetryOn429 } from '@/lib/retry';
import { ApiError } from '@/lib/api';
import { factnoteDiaryApi, type FactnoteAnalyzeResult } from '@/lib/factnote/api';
import {
  deleteAttachmentBlob,
  getRecord,
  hardDeleteRecord,
  listFutureMemos,
  listRecords,
  newFactnoteId,
  saveAttachmentBlob,
  saveRecord,
} from '@/lib/factnote/db';
import { conflictsOnSameDay } from '@/lib/factnote/aggregate';
import { maybeAutoBackup } from '@/lib/factnote/autoBackup';
import {
  cancelFactnoteJob,
  startAnalyzeJob,
  startTranscribeJob,
  subscribeFactnoteJobs,
} from '@/lib/factnote/jobs';
import { matchMemos } from '@/lib/factnote/memoMatch';
import { loadFactnoteProfile, profileToPeopleContext } from '@/lib/factnote/profile';
import {
  applySupplement,
  createEmptyRecord,
  emptySupplement,
  sourceTextOf,
  supplementToContext,
  type Supplement,
} from '@/lib/factnote/newRecord';
import { analysisSummaryForDiary } from '@/lib/factnote/generateFactnoteDiary';
import { FACTNOTE_DIARY_PROMPT_VERSION } from '@/lib/factnote/prompts/diary';
import {
  DIARY_MODE_LABELS,
  type DiaryMode,
  type FutureSelfMemo,
  type IncidentRecord,
  type RecordSource,
} from '@/lib/factnote/types';
import { RecordingScreen } from '@/components/screens/RecordingScreen';
import {
  EmptyScreen,
  ErrorScreen,
  PermissionScreen,
  ProcessingScreen,
} from '@/components/screens/StatusScreens';
import { AutoTextarea } from '@/components/screens/common';
import { CheckIcon, MicIcon, UploadIcon } from '@/components/icons';
import { AnalysisView } from './AnalysisView';
import { FactnoteHeader } from './common';
import { BackupPrompt } from './BackupPrompt';
import { FutureMemoCard, markMemoShown } from './FutureMemoCard';
import { SupplementStep } from './SupplementStep';

export type NewFlowMode = 'text' | 'record' | 'file';

type Step =
  | 'textInput'
  | 'recordIntro'
  | 'recording'
  | 'filePick'
  | 'transcribing'
  | 'review'
  | 'supplement'
  | 'analyzing'
  | 'result'
  | 'diaryMode'
  | 'diaryGenerating'
  | 'diaryEdit'
  | 'saved'
  | 'permission'
  | 'empty'
  | 'error';

const MIN_RECORDING_MS = 2000;
/** 20分を超えたら長すぎ警告（依頼書 §22.2）。 */
const TOO_LONG_MS = 20 * 60 * 1000;

const SOURCE_TYPE: Record<NewFlowMode, RecordSource> = {
  text: 'text',
  record: 'voice_recording',
  file: 'audio_file',
};

const MODE_TITLES: Record<NewFlowMode, string> = {
  text: '文章で入力',
  record: '今のことを話す',
  file: '録音ファイルを読み込む',
};

/**
 * 記録作成フロー（依頼書 §11）: 入力 → 文字起こし → 確認・修正 → 補足情報 →
 * 分析 → 結果 → 日記。文字起こしと原本は完了した時点で必ず IndexedDB へ保存し、
 * 以降のステップが失敗しても失われないようにする。
 */
export function FactnoteNewFlow({ mode }: { mode: NewFlowMode }) {
  const router = useRouter();
  // 録音中は15秒ごとに「ここまでの音声」を保存し、アプリが落ちても話した内容を残す
  const recorder = useRecorder({
    partialIntervalMs: 15_000,
    onPartial: (blob) => void savePartialRecording(blob),
  });

  const [step, setStep] = useState<Step>(
    mode === 'text' ? 'textInput' : mode === 'record' ? 'recordIntro' : 'filePick',
  );
  const [text, setText] = useState('');
  const [editedTranscript, setEditedTranscript] = useState('');
  const [keepAudio, setKeepAudio] = useState(true);
  const [supplement, setSupplement] = useState<Supplement>(() => emptySupplement());
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [isPreparingAudio, setIsPreparingAudio] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [retryTarget, setRetryTarget] = useState<'transcribe' | 'analyze' | 'diary' | null>(null);
  const [analysisResult, setAnalysisResult] = useState<FactnoteAnalyzeResult | null>(null);
  const [diaryMode, setDiaryMode] = useState<DiaryMode>('factual');
  const [diaryTitle, setDiaryTitle] = useState('');
  const [diaryBody, setDiaryBody] = useState('');
  const [saving, setSaving] = useState(false);
  const [matchedMemos, setMatchedMemos] = useState<FutureSelfMemo[]>([]);

  const recordRef = useRef<IncidentRecord | null>(null);
  const generatedDiaryRef = useRef<{ title: string; body: string } | null>(null);
  const pendingBlobsRef = useRef<{ blob: Blob; filename: string }[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  /** プロフィール（話者ラベル・自分側/相手側の判断材料としてAIへ渡す）。 */
  const peopleContextRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    loadFactnoteProfile().then((p) => {
      peopleContextRef.current = profileToPeopleContext(p);
    });
  }, []);

  // バックグラウンドジョブ（文字起こし・分析）の進捗・完了を受けて画面を進める。
  // 画面を離れてもジョブ自体は継続し、結果はIndexedDBへ保存される
  useEffect(() => {
    return subscribeFactnoteJobs((event) => {
      const current = recordRef.current;
      if (!current || event.job.recordId !== current.id) return;
      if (event.type === 'progress') {
        setIsPreparingAudio(event.job.preparing);
        setProgress(event.job.progress);
        return;
      }
      if (event.type === 'done') {
        recordRef.current = event.record;
        if (event.job.kind === 'transcribe') {
          const transcript = event.transcript ?? '';
          if (!transcript.trim()) {
            setStep('empty');
            return;
          }
          setEditedTranscript(transcript);
          setStep('review');
        } else if (event.result) {
          setAnalysisResult(event.result);
          void showMemosAfterAnalysis(event.record, event.result);
          setStep('result');
        }
        return;
      }
      setErrorMsg(event.message);
      setRetryTarget(event.job.kind);
      setStep('error');
    });
    // showMemosAfterAnalysis は state セッターのみに依存するため購読は初回のみでよい
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ensureRecord = useCallback((): IncidentRecord => {
    if (!recordRef.current) recordRef.current = createEmptyRecord(SOURCE_TYPE[mode]);
    return recordRef.current;
  }, [mode]);

  const persist = useCallback(
    async (mut: (r: IncidentRecord) => IncidentRecord): Promise<IncidentRecord> => {
      // 必ずDB上の最新を基点に変更を適用する（バックグラウンドジョブ等が
      // 書き込んだ文字起こし・分析を、古いメモリ上のコピーで上書きしないため）
      const inMemory = ensureRecord();
      const base = (await getRecord(inMemory.id).catch(() => undefined)) ?? inMemory;
      const next = mut({ ...base, updatedAt: new Date().toISOString() });
      recordRef.current = next;
      await saveRecord(next);
      return next;
    },
    [ensureRecord],
  );

  // --- 文章入力の自動保存（依頼書 §8.2） -----------------------------------
  useEffect(() => {
    if (mode !== 'text' || step !== 'textInput' || !text.trim()) return;
    const timer = setTimeout(() => {
      void persist((r) => ({ ...r, rawText: text }));
    }, 800);
    return () => clearTimeout(timer);
  }, [text, mode, step, persist]);

  function handleApiError(err: unknown, fallback: string, target: 'transcribe' | 'analyze' | 'diary') {
    setErrorMsg(err instanceof ApiError ? err.message : fallback);
    setRetryTarget(target);
    setStep('error');
  }

  // --- 録音 -----------------------------------------------------------------
  async function startRecording() {
    if (!hasRecorderSupport()) {
      setErrorMsg('このブラウザは録音に対応していません。文章入力をご利用ください。');
      setRetryTarget(null);
      setStep('error');
      return;
    }
    const ok = await recorder.start();
    if (!ok) {
      setStep('permission');
      return;
    }
    setStep('recording');
  }

  /** 録音途中の自動保存（クラッシュ・タブ強制終了への備え。依頼書 §8.1）。 */
  async function savePartialRecording(blob: Blob) {
    try {
      const record = ensureRecord();
      const attId = `${record.id}-rec`;
      await saveAttachmentBlob(attId, blob);
      await persist((r) => ({
        ...r,
        attachments: r.attachments.some((a) => a.id === attId)
          ? r.attachments.map((a) => (a.id === attId ? { ...a, size: blob.size } : a))
          : [
              ...r.attachments,
              {
                id: attId,
                fileName: `recording-autosave.${extForMime(blob.type || undefined)}`,
                mimeType: blob.type || 'audio/webm',
                size: blob.size,
                createdAt: new Date().toISOString(),
              },
            ],
        evidenceItems:
          r.evidenceItems.length > 0
            ? r.evidenceItems
            : [
                {
                  id: newFactnoteId(),
                  type: 'audio',
                  attachmentId: attId,
                  sourceLabel: '音声',
                  confidence: 'high',
                },
              ],
      }));
    } catch {
      /* 自動保存の失敗は録音を妨げない */
    }
  }

  async function stopRecording() {
    const blob = await recorder.stop();
    const elapsed = recorder.elapsedMs;
    if (!blob || elapsed < MIN_RECORDING_MS || blob.size < 1024) {
      setStep('empty');
      return;
    }
    const filename = `factnote.${extForMime(recorder.mimeType)}`;
    await transcribeBlobs([{ blob, filename }], Math.round(elapsed / 1000));
  }

  // --- ファイル ---------------------------------------------------------------
  function onFilesChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const chosen = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (chosen.length === 0) return;
    void transcribeBlobs(chosen.map((f) => ({ blob: f as Blob, filename: f.name || 'audio' })));
  }

  // --- 文字起こし（バックグラウンドジョブ） -------------------------------------
  async function transcribeBlobs(rawItems: { blob: Blob; filename: string }[], durationSec?: number) {
    pendingBlobsRef.current = rawItems;
    setStep('transcribing');
    setProgress({ current: 0, total: 0 });

    // 原本（音声Blob）を先に保存する。以降どこで失敗しても原本は残る（依頼書 §6.3）
    let record = ensureRecord();
    const partialId = `${record.id}-rec`;
    const hasPartial = record.attachments.some((a) => a.id === partialId);
    if (hasPartial && rawItems.length === 1) {
      // 録音の途中保存がある場合は、同じ添付を最終音声で上書きする
      try {
        await saveAttachmentBlob(partialId, rawItems[0].blob);
        record = await persist((r) => ({
          ...r,
          status: 'transcribing',
          attachments: r.attachments.map((a) =>
            a.id === partialId
              ? {
                  ...a,
                  fileName: rawItems[0].filename,
                  mimeType: rawItems[0].blob.type || a.mimeType,
                  size: rawItems[0].blob.size,
                  durationSeconds: durationSec ?? a.durationSeconds,
                }
              : a,
          ),
        }));
      } catch {
        setErrorMsg('端末への保存に失敗しました。空き容量を確認してください。');
        setRetryTarget(null);
        setStep('error');
        return;
      }
    } else if (record.attachments.length === 0) {
      try {
        const attachments = [...record.attachments];
        for (const item of rawItems) {
          const attId = newFactnoteId();
          await saveAttachmentBlob(attId, item.blob);
          attachments.push({
            id: attId,
            fileName: item.filename,
            mimeType: item.blob.type || 'application/octet-stream',
            size: item.blob.size,
            durationSeconds: durationSec,
            createdAt: new Date().toISOString(),
          });
        }
        record = await persist((r) => ({
          ...r,
          attachments,
          status: 'transcribing',
          evidenceItems:
            r.evidenceItems.length > 0
              ? r.evidenceItems
              : [
                  {
                    id: newFactnoteId(),
                    type: 'audio',
                    attachmentId: attachments[0]?.id,
                    sourceLabel: '音声',
                    confidence: 'high',
                  },
                ],
        }));
      } catch {
        setErrorMsg('端末への保存に失敗しました。空き容量を確認してください。');
        setRetryTarget(null);
        setStep('error');
        return;
      }
    } else {
      record = await persist((r) => ({ ...r, status: 'transcribing' }));
    }

    // 以降はバックグラウンドジョブ。進捗・完了は subscribeFactnoteJobs で受け取る
    startTranscribeJob({
      recordId: record.id,
      items: rawItems,
      peopleContext: peopleContextRef.current,
    });
  }

  function cancelTranscribing() {
    const record = recordRef.current;
    if (record) cancelFactnoteJob(record.id);
    // 直前にジョブが完了していた場合は完了状態を巻き戻さない
    void persist((r) =>
      r.status === 'transcribing' || r.status === 'analyzing' ? { ...r, status: 'draft' } : r,
    ).finally(() => router.push('/factnote'));
  }

  /** 処理を続けたままホームへ戻る（完了すると記録に反映される）。 */
  function continueInBackground() {
    router.push('/factnote');
  }

  // --- 確認・修正 → 補足情報 ---------------------------------------------------
  async function confirmTranscript() {
    const record = ensureRecord();
    const original = record.transcript ?? '';
    await persist((r) => ({
      ...r,
      correctedTranscript:
        editedTranscript.trim() && editedTranscript !== original ? editedTranscript : undefined,
    }));
    if (!keepAudio) {
      // 原音声を残さない選択（依頼書 §8.1）。文字起こしを text 根拠に切り替える
      for (const att of record.attachments) {
        await deleteAttachmentBlob(att.id);
      }
      await persist((r) => ({
        ...r,
        attachments: [],
        evidenceItems: [
          {
            id: newFactnoteId(),
            type: 'text',
            text: editedTranscript,
            sourceLabel: '文字起こし（原音声は削除）',
            confidence: 'high',
          },
        ],
      }));
    }
    setStep('supplement');
  }

  async function confirmTextInput() {
    if (!text.trim()) return;
    await persist((r) => ({
      ...r,
      rawText: text,
      evidenceItems:
        r.evidenceItems.length > 0
          ? r.evidenceItems
          : [
              {
                id: newFactnoteId(),
                type: 'text',
                text,
                sourceLabel: 'ユーザー入力',
                confidence: 'high',
              },
            ],
    }));
    setStep('supplement');
  }

  // --- 分析（バックグラウンドジョブ） --------------------------------------------
  async function runAnalyze() {
    const record = await persist((r) => applySupplement(r, supplement));
    const sourceText = sourceTextOf(record);
    if (!sourceText) {
      setErrorMsg('分析する内容がありません。');
      setRetryTarget(null);
      setStep('error');
      return;
    }
    setStep('analyzing');
    await persist((r) => ({ ...r, status: 'analyzing' }));
    startAnalyzeJob({
      recordId: record.id,
      context: supplementToContext(supplement),
      peopleContext: peopleContextRef.current,
    });
  }

  /** 記録保存直後の未来メモ表示（追加依頼 §18.1）。安全フラグがある場合は出さない（§25）。 */
  async function showMemosAfterAnalysis(saved: IncidentRecord, result: FactnoteAnalyzeResult) {
    if (result.analysis.safetyFlags.length > 0) {
      setMatchedMemos([]);
      return;
    }
    try {
      const [memos, all] = await Promise.all([listFutureMemos(), listRecords()]);
      const matched = matchMemos(memos, {
        record: saved,
        text: sourceTextOf(saved),
        emotions: saved.emotions,
        conflictsToday: conflictsOnSameDay(all, new Date()),
        userIssueCount: result.analysis.userImprovementPoints.length,
        otherIssueCount: result.analysis.otherPartyProblemPoints.length,
      }).slice(0, 2);
      for (const m of matched) await markMemoShown(m, saved.id);
      setMatchedMemos(matched);
    } catch {
      setMatchedMemos([]);
    }
  }

  /** 分析せずローカル保存だけする（依頼書 §28）。 */
  async function saveWithoutAnalysis() {
    setSaving(true);
    const record = await persist((r) => applySupplement(r, supplement));
    void maybeAutoBackup().catch(() => {});
    setSaving(false);
    setStep('saved');
  }

  // --- 日記 -----------------------------------------------------------------------
  async function runGenerateDiary(mode: DiaryMode) {
    const record = ensureRecord();
    setDiaryMode(mode);
    // 「原文のまま」はAIを使わず、入力/文字起こしをそのまま日記本文にする（意訳しない）
    if (mode === 'verbatim') {
      const source = sourceTextOf(record);
      generatedDiaryRef.current = null;
      setDiaryTitle(record.title || source.split('\n')[0]?.slice(0, 40) || '無題');
      setDiaryBody(source);
      setStep('diaryEdit');
      return;
    }
    setStep('diaryGenerating');
    try {
      const diary = await withRetryOn429(() =>
        factnoteDiaryApi(
          mode,
          sourceTextOf(record),
          record.analysis ? analysisSummaryForDiary(record.analysis) : undefined,
          peopleContextRef.current,
        ),
      );
      generatedDiaryRef.current = diary;
      setDiaryTitle(diary.title);
      setDiaryBody(diary.body);
      setStep('diaryEdit');
    } catch (err) {
      handleApiError(err, '日記の生成に失敗しました。', 'diary');
    }
  }

  async function saveDiary() {
    setSaving(true);
    const generated = generatedDiaryRef.current;
    const record = await persist((r) => ({
      ...r,
      diaryVersions: [
        ...r.diaryVersions,
        {
          id: newFactnoteId(),
          mode: diaryMode,
          title: diaryTitle,
          body: diaryBody,
          createdAt: new Date().toISOString(),
          editedByUser: !generated || generated.title !== diaryTitle || generated.body !== diaryBody,
          aiModel: diaryMode === 'verbatim' ? undefined : r.analysis?.aiModel,
          promptVersion: diaryMode === 'verbatim' ? undefined : FACTNOTE_DIARY_PROMPT_VERSION,
        },
      ],
    }));
    void maybeAutoBackup().catch(() => {});
    setSaving(false);
    setStep('saved');
  }

  function retryFromError() {
    if (retryTarget === 'transcribe') {
      void transcribeBlobs(pendingBlobsRef.current);
    } else if (retryTarget === 'analyze') {
      void runAnalyze();
    } else if (retryTarget === 'diary') {
      void runGenerateDiary(diaryMode);
    }
  }

  // --- レンダリング -----------------------------------------------------------------
  if (step === 'textInput') {
    return (
      <div className="flex min-h-dvh flex-col pt-safe">
        <FactnoteHeader title={MODE_TITLES.text} backHref="/factnote" />
        <div className="flex-1 px-6 pt-4">
          <AutoTextarea
            value={text}
            onChange={setText}
            ariaLabel="出来事の内容"
            className="min-h-[40dvh] w-full resize-none rounded-card border border-border bg-surface px-4 py-3 text-[15px] leading-[1.85] text-text placeholder:text-text-tertiary focus:outline-none focus:ring-1 focus:ring-accent"
          />
          <p className="mt-2 text-[12px] text-text-tertiary">
            きれいな文章でなくて大丈夫です。入力は自動保存されます。
          </p>
        </div>
        <div className="sticky bottom-0 bg-gradient-to-t from-bg via-bg to-transparent px-6 pb-safe pt-4">
          <button
            onClick={confirmTextInput}
            disabled={!text.trim()}
            className="mb-3 h-14 w-full rounded-full bg-accent text-[17px] font-semibold text-accent-on shadow-cta disabled:opacity-40"
          >
            次へ（補足情報）
          </button>
        </div>
      </div>
    );
  }

  if (step === 'recordIntro') {
    return (
      <div className="flex min-h-dvh flex-col pt-safe">
        <FactnoteHeader title={MODE_TITLES.record} backHref="/factnote" />
        <div className="flex flex-1 flex-col items-center justify-center gap-6 px-7 text-center">
          <p className="max-w-[280px] text-[14px] leading-relaxed text-text-secondary">
            今あったことを、思いつくまま話してください。
            <br />
            言いよどみや順番の前後は、あとでAIが整理します。
          </p>
          <button
            onClick={startRecording}
            aria-label="録音を開始"
            className="flex h-[88px] w-[88px] items-center justify-center rounded-full bg-accent text-accent-on shadow-cta active:scale-[1.06]"
          >
            <MicIcon width={36} height={36} />
          </button>
          <span className="text-[12px] text-text-tertiary">タップで録音開始</span>
        </div>
      </div>
    );
  }

  if (step === 'recording') {
    return (
      <RecordingScreen
        elapsedMs={recorder.elapsedMs}
        paused={recorder.status === 'paused'}
        tooLong={recorder.elapsedMs > TOO_LONG_MS}
        onPause={recorder.pause}
        onResume={recorder.resume}
        onStop={() => void stopRecording()}
        onCancel={() => {
          recorder.cancel();
          // ユーザーが明示的に破棄した場合、途中保存だけの空レコードは残さない
          const record = recordRef.current;
          if (record && !record.rawText && !record.transcript && record.diaryVersions.length === 0) {
            recordRef.current = null;
            void hardDeleteRecord(record.id);
          }
          setStep('recordIntro');
        }}
      />
    );
  }

  if (step === 'filePick') {
    return (
      <div className="flex min-h-dvh flex-col pt-safe">
        <FactnoteHeader title={MODE_TITLES.file} backHref="/factnote" />
        <div className="flex flex-1 flex-col items-center justify-center gap-5 px-7 text-center">
          <p className="max-w-[300px] text-[14px] leading-relaxed text-text-secondary">
            m4a / mp3 / wav / mp4 / webm / aac などの録音ファイルを読み込めます。
            大きいファイルは自動で分割して送信します。
          </p>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex h-14 items-center gap-2 rounded-full bg-accent px-7 text-[16px] font-semibold text-accent-on shadow-cta active:scale-[0.99]"
          >
            <UploadIcon width={20} height={20} />
            ファイルを選ぶ
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*,video/mp4,.m4a,.mp3,.wav,.mp4,.webm,.aac,.caf,.aiff,.amr,.flac,.ogg,.opus,.wma"
            multiple
            onChange={onFilesChosen}
            className="hidden"
            aria-label="録音ファイルを選択"
          />
        </div>
      </div>
    );
  }

  if (step === 'transcribing') {
    return (
      <ProcessingScreen
        title="音声を文字にしています"
        subtitle={
          isPreparingAudio
            ? '音声を分割しています…'
            : progress.total > 1
              ? `文字起こし中…（${progress.current}/${progress.total}）`
              : 'そのままお待ちください'
        }
        secondaryLabel="バックグラウンドで続ける"
        onSecondary={continueInBackground}
        note="アプリ内なら他の画面に移動しても処理は続き、完了すると記録に反映されます。画面ロックや他のアプリへの切り替え中は中断されることがあります。"
        onCancel={cancelTranscribing}
      />
    );
  }

  if (step === 'review') {
    const record = ensureRecord();
    return (
      <div className="flex min-h-dvh flex-col pt-safe">
        <FactnoteHeader title="文字起こしの確認" />
        <div className="flex-1 overflow-y-auto px-6 pt-4">
          <p className="text-[12.5px] leading-relaxed text-text-secondary">
            聞き取れなかった部分は「[聞き取れず]」と表示されます。誤りがあれば修正してください。
            元の文字起こしも別に保存されます。
          </p>
          <AutoTextarea
            value={editedTranscript}
            onChange={setEditedTranscript}
            ariaLabel="文字起こしの修正"
            className="mt-3 min-h-[40dvh] w-full resize-none rounded-card border border-border bg-surface px-4 py-3 text-[14px] leading-[1.85] text-text focus:outline-none focus:ring-1 focus:ring-accent"
          />
          {record.attachments.length > 0 && (
            <label className="mt-4 flex min-h-[44px] items-center gap-3 text-[14px]">
              <input
                type="checkbox"
                checked={keepAudio}
                onChange={(e) => setKeepAudio(e.target.checked)}
                className="h-5 w-5 accent-[var(--c-accent)]"
              />
              原音声を端末に残す
            </label>
          )}
        </div>
        <div className="sticky bottom-0 bg-gradient-to-t from-bg via-bg to-transparent px-6 pb-safe pt-4">
          <button
            onClick={() => void confirmTranscript()}
            disabled={!editedTranscript.trim()}
            className="mb-3 h-14 w-full rounded-full bg-accent text-[17px] font-semibold text-accent-on shadow-cta disabled:opacity-40"
          >
            次へ（補足情報）
          </button>
        </div>
      </div>
    );
  }

  if (step === 'supplement') {
    return (
      <SupplementStep
        supplement={supplement}
        onChange={setSupplement}
        saving={saving}
        onAnalyze={() => void runAnalyze()}
        onSaveOnly={() => void saveWithoutAnalysis()}
      />
    );
  }

  if (step === 'analyzing') {
    return (
      <ProcessingScreen
        title="事実と解釈を分けています"
        subtitle="確認できる事実・本人の認識・推測・不明点を整理しています"
        secondaryLabel="バックグラウンドで続ける"
        onSecondary={continueInBackground}
        note="アプリ内なら他の画面に移動しても処理は続き、完了すると記録に反映されます。"
        onCancel={() => {
          const record = recordRef.current;
          if (record) cancelFactnoteJob(record.id);
          // 直前にジョブが完了していた場合は完了状態を巻き戻さない
          void persist((r) =>
            r.status === 'transcribing' || r.status === 'analyzing' ? { ...r, status: 'draft' } : r,
          ).finally(() => router.push('/factnote'));
        }}
      />
    );
  }

  if (step === 'result' && analysisResult) {
    const record = ensureRecord();
    return (
      <div className="flex min-h-dvh flex-col pt-safe">
        <FactnoteHeader title={record.title || '分析結果'} />
        <div className="flex-1 overflow-y-auto px-6">
          {matchedMemos.map((memo) => (
            <div key={memo.id} className="mt-4">
              <FutureMemoCard
                memo={memo}
                recordId={record.id}
                onClose={async () => {
                  // カード内の「固定」等がDBを直接更新するため、ローカルの記録を同期する
                  const fresh = await getRecord(record.id);
                  if (fresh) recordRef.current = fresh;
                  setMatchedMemos((ms) => ms.filter((m) => m.id !== memo.id));
                }}
              />
            </div>
          ))}
          <AnalysisView analysis={analysisResult.analysis} />
        </div>
        <div className="sticky bottom-0 bg-gradient-to-t from-bg via-bg to-transparent px-6 pb-safe pt-4">
          <button
            onClick={() => setStep('diaryMode')}
            className="h-14 w-full rounded-full bg-accent text-[17px] font-semibold text-accent-on shadow-cta"
          >
            日記を作成
          </button>
          <button
            onClick={() => router.push(`/factnote/records/${record.id}`)}
            className="mb-3 mt-2 h-11 w-full rounded-full text-[14px] text-text-secondary"
          >
            保存して終了（日記はあとで）
          </button>
        </div>
      </div>
    );
  }

  if (step === 'diaryMode') {
    return (
      <div className="flex min-h-dvh flex-col pt-safe">
        <FactnoteHeader title="日記のモードを選ぶ" />
        <div className="flex-1 px-6 pt-4">
          <ul className="space-y-2">
            {(Object.keys(DIARY_MODE_LABELS) as DiaryMode[]).map((m) => (
              <li key={m}>
                <button
                  onClick={() => void runGenerateDiary(m)}
                  className="min-h-[52px] w-full rounded-card border border-border bg-surface px-4 py-3 text-left active:opacity-70"
                >
                  <span className="block text-[15px] font-medium">{DIARY_MODE_LABELS[m]}</span>
                  {m === 'verbatim' && (
                    <span className="mt-0.5 block text-[12px] text-text-tertiary">
                      入力した文章をそのまま日記にします（AIは書き換えません）
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
          <button
            onClick={() => setStep('result')}
            className="mt-4 min-h-[44px] w-full text-[14px] text-text-secondary"
          >
            分析結果に戻る
          </button>
        </div>
      </div>
    );
  }

  if (step === 'diaryGenerating') {
    return (
      <ProcessingScreen
        title="日記を書いています"
        subtitle={`モード: ${DIARY_MODE_LABELS[diaryMode]}`}
        onCancel={() => setStep('diaryMode')}
      />
    );
  }

  if (step === 'diaryEdit') {
    return (
      <div className="flex min-h-dvh flex-col pt-safe">
        <FactnoteHeader title="日記の確認・編集" />
        <div className="flex-1 overflow-y-auto px-6 pt-4">
          <input
            value={diaryTitle}
            onChange={(e) => setDiaryTitle(e.target.value)}
            aria-label="日記のタイトル"
            className="h-12 w-full rounded-card border border-border bg-surface px-4 text-[17px] font-bold text-text focus:outline-none focus:ring-1 focus:ring-accent"
          />
          <AutoTextarea
            value={diaryBody}
            onChange={setDiaryBody}
            ariaLabel="日記の本文"
            className="mt-3 min-h-[45dvh] w-full resize-none rounded-card border border-border bg-surface px-4 py-3 text-[15px] leading-[1.9] text-text focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>
        <div className="sticky bottom-0 bg-gradient-to-t from-bg via-bg to-transparent px-6 pb-safe pt-4">
          <button
            onClick={() => void saveDiary()}
            disabled={saving || !diaryTitle.trim() || !diaryBody.trim()}
            className="h-14 w-full rounded-full bg-accent text-[17px] font-semibold text-accent-on shadow-cta disabled:opacity-40"
          >
            保存する
          </button>
          <button
            onClick={() => setStep('diaryMode')}
            disabled={saving}
            className="mb-3 mt-2 h-11 w-full rounded-full text-[14px] text-text-secondary"
          >
            別のモードで作り直す
          </button>
        </div>
      </div>
    );
  }

  if (step === 'saved') {
    const record = ensureRecord();
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center px-7 pb-safe pt-safe text-center">
        <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-surface text-success">
          <CheckIcon width={32} height={32} />
        </div>
        <h1 className="text-[20px] font-bold">保存しました</h1>
        <p className="mt-1 max-w-[280px] text-[13.5px] text-text-secondary">
          {record.title || 'この記録'}を端末に保存しました。
        </p>

        {/* いいタイミングでのワンタップ・バックアップ導線 */}
        <div className="mt-6 w-full max-w-[300px]">
          <BackupPrompt />
        </div>

        <div className="mt-8 flex w-full max-w-[300px] flex-col gap-2">
          <button
            onClick={() => router.push(`/factnote/records/${record.id}`)}
            className="h-12 w-full rounded-full bg-accent text-[15px] font-semibold text-accent-on shadow-cta active:opacity-90"
          >
            この記録を見る
          </button>
          <button
            onClick={() => router.push('/factnote')}
            className="h-11 w-full rounded-full text-[14px] text-text-secondary active:opacity-60"
          >
            ホームへ
          </button>
        </div>
      </div>
    );
  }

  if (step === 'permission') {
    return (
      <PermissionScreen onRetry={() => void startRecording()} onBack={() => router.push('/factnote')} />
    );
  }

  if (step === 'empty') {
    return (
      <EmptyScreen
        onRetry={() => {
          recorder.reset();
          setStep(mode === 'file' ? 'filePick' : 'recordIntro');
        }}
        onHome={() => router.push('/factnote')}
      />
    );
  }

  // error
  return (
    <ErrorScreen
      message={errorMsg}
      canRetry={retryTarget !== null}
      onRetry={retryFromError}
      onBack={() => {
        const record = recordRef.current;
        router.push(record ? `/factnote/records/${record.id}` : '/factnote');
      }}
    />
  );
}

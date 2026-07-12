'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, analyzeTalkApi, transcribeTalkAudio } from '@/lib/api';
import { withRetryOn429 } from '@/lib/retry';
import { extForMime, useRecorder } from '@/hooks/useRecorder';
import { useToast } from '@/hooks/useToast';
import { expandToChunks, MAX_CLIENT_AUDIO_BYTES } from '@/lib/audioChunk';
import { loadProfile } from '@/lib/profile';
import { combineTranscripts } from '@/lib/format';
import { talkAnalysisToText, type TalkAnalysis } from '@/lib/talk';
import { copyText } from '@/lib/clipboard';
import { Toast } from '@/components/Toast';
import { RecordingScreen } from '@/components/screens/RecordingScreen';
import { ErrorScreen, ProcessingScreen } from '@/components/screens/StatusScreens';
import { TalkIntroScreen } from '@/components/screens/talk/TalkIntroScreen';
import { TalkSpeakersScreen } from '@/components/screens/talk/TalkSpeakersScreen';
import { TalkResultScreen } from '@/components/screens/talk/TalkResultScreen';

type Screen =
  | 'intro'
  | 'recording'
  | 'transcribing'
  | 'speakers'
  | 'analyzing'
  | 'result'
  | 'error';

const MIN_RECORDING_MS = 2000;
const LONG_RECORDING_MS = 20 * 60 * 1000;

export default function AnalyzePage() {
  const router = useRouter();
  const recorder = useRecorder();
  const { toast, showToast } = useToast();

  const [screen, setScreen] = useState<Screen>('intro');
  const [transcript, setTranscript] = useState('');
  const [speakerA, setSpeakerA] = useState('私');
  const [speakerB, setSpeakerB] = useState('相手');
  const [analysis, setAnalysis] = useState<TalkAnalysis | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [isPreparingAudio, setIsPreparingAudio] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

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

  function resetAll() {
    setTranscript('');
    setAnalysis(null);
    setErrorMsg('');
    setProgress({ current: 0, total: 0 });
    setIsPreparingAudio(false);
    recorder.reset();
    setScreen('intro');
  }

  // --- 録音 ---------------------------------------------------------------
  async function startRecording() {
    const ok = await recorder.start();
    if (!ok) {
      setErrorMsg(
        recorder.error === 'permission'
          ? 'マイクへのアクセスが許可されていません。iPhoneの設定を確認してください。'
          : '録音を開始できませんでした。',
      );
      setScreen('error');
      return;
    }
    setScreen('recording');
  }

  async function stopRecording() {
    const blob = await recorder.stop();
    const elapsed = recorder.elapsedMs;
    if (!blob || elapsed < MIN_RECORDING_MS || blob.size < 1024) {
      setErrorMsg('音声が短すぎるか、検出されませんでした。');
      setScreen('error');
      return;
    }
    const filename = `talk.${extForMime(recorder.mimeType)}`;
    await transcribeItems([{ blob, filename }]);
  }

  function cancelRecording() {
    recorder.cancel();
    setScreen('intro');
  }

  // --- ファイル -------------------------------------------------------------
  function onFilesChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const chosen = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (chosen.length === 0) return;
    void transcribeItems(chosen.map((f) => ({ blob: f as Blob, filename: f.name || 'talk-audio' })));
  }

  // --- 文字起こし → 話者指定 → 分析 ---------------------------------------
  async function transcribeItems(rawItems: { blob: Blob; filename: string }[]) {
    setScreen('transcribing');
    setProgress({ current: 0, total: 0 });

    let items: { blob: Blob; filename: string }[];
    const needsExpansion = rawItems.some((it) => it.blob.size > MAX_CLIENT_AUDIO_BYTES);
    try {
      if (needsExpansion) setIsPreparingAudio(true);
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

    setProgress({ current: 0, total: items.length });
    const parts: string[] = [];
    try {
      for (let i = 0; i < items.length; i++) {
        setProgress({ current: i + 1, total: items.length });
        const text = await withRetryOn429(() =>
          transcribeTalkAudio(items[i].blob, items[i].filename),
        );
        parts.push(text);
      }
    } catch (err) {
      handleApiError(err, '文字起こしに失敗しました。');
      return;
    }

    const combined = combineTranscripts(parts);
    if (!combined) {
      setErrorMsg('会話を聞き取れませんでした。もう一度お試しください。');
      setScreen('error');
      return;
    }
    setTranscript(combined);
    setScreen('speakers');
  }

  async function runAnalyze() {
    setScreen('analyzing');
    try {
      const profileMarkdown = loadProfile().markdown;
      const result = await withRetryOn429(() =>
        analyzeTalkApi(transcript, speakerA, speakerB, profileMarkdown || undefined),
      );
      setAnalysis(result);
      setScreen('result');
    } catch (err) {
      handleApiError(err, '話し合いの分析に失敗しました。');
    }
  }

  // --- 結果の操作 -----------------------------------------------------------
  async function copyAll() {
    if (!analysis) return;
    if (await copyText(talkAnalysisToText(analysis))) showToast('全文をコピーしました');
  }

  async function shareSheet() {
    if (!analysis) return;
    const text = talkAnalysisToText(analysis);
    if (navigator.share) {
      try {
        await navigator.share({ title: analysis.title, text });
      } catch {
        /* ユーザーキャンセルなどは無視 */
      }
    } else {
      if (await copyText(text)) showToast('共有できないため全文をコピーしました');
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-[440px] flex-col">
      {screen === 'intro' && (
        <TalkIntroScreen
          onRecord={startRecording}
          onPickFiles={() => fileInputRef.current?.click()}
          onBack={() => router.push('/')}
        />
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

      {(screen === 'transcribing' || screen === 'analyzing') && (
        <ProcessingScreen
          title={
            screen === 'transcribing'
              ? isPreparingAudio
                ? '音声を準備中…'
                : '会話を聞き取り中…'
              : 'ふたりの話し合いを分析中…'
          }
          subtitle={
            screen === 'transcribing'
              ? isPreparingAudio
                ? '大きな音声を分割しています。少しお待ちください'
                : progress.total > 1
                  ? `話者を聞き分けています…（${progress.current}/${progress.total}）`
                  : '話者を聞き分けています'
              : '言い分・すれ違い・改善のヒントを整理しています'
          }
          onCancel={resetAll}
        />
      )}

      {screen === 'speakers' && (
        <TalkSpeakersScreen
          transcript={transcript}
          speakerA={speakerA}
          speakerB={speakerB}
          onChangeSpeakerA={setSpeakerA}
          onChangeSpeakerB={setSpeakerB}
          onAnalyze={runAnalyze}
          onBack={resetAll}
        />
      )}

      {screen === 'result' && analysis && (
        <TalkResultScreen
          analysis={analysis}
          transcript={transcript}
          onCopyAll={copyAll}
          onShare={shareSheet}
          onDiscard={() => {
            resetAll();
            router.push('/');
          }}
          onBack={() => setScreen('speakers')}
        />
      )}

      {screen === 'error' && (
        <ErrorScreen
          message={errorMsg}
          canRetry={transcript.length > 0}
          onRetry={runAnalyze}
          onBack={resetAll}
        />
      )}

      <Toast message={toast ?? ''} visible={toast !== null} />
      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*,.m4a,.mp3,.wav,.aac,.caf,.aiff,.aif,.amr,.flac,.ogg,.opus,.wma,.mp4,.mov"
        multiple
        className="hidden"
        onChange={onFilesChosen}
      />
    </main>
  );
}

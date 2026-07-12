'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { loadProfile, saveProfile, type Profile } from '@/lib/profile';
import { ApiError, transcribeAudio, updateProfileApi } from '@/lib/api';
import { extForMime, useRecorder } from '@/hooks/useRecorder';
import { formatTimer } from '@/lib/format';
import { ChevronLeftIcon, MicIcon, StopIcon } from '@/components/icons';
import { Toast } from '@/components/Toast';

const MAX_MARKDOWN_CHARS = 8000;
const MAX_INPUT_CHARS = 4000;
const MIN_RECORDING_MS = 1000;

type Busy = 'none' | 'transcribing' | 'updating';

export default function ProfilePage() {
  const router = useRouter();
  const recorder = useRecorder();

  const [profile, setProfile] = useState<Profile>({ markdown: '', updatedAt: '' });
  const [loaded, setLoaded] = useState(false);
  const [newInput, setNewInput] = useState('');
  const [busy, setBusy] = useState<Busy>('none');
  const [error, setError] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setProfile(loadProfile());
    setLoaded(true);
  }, []);

  function showToast(msg: string) {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 1600);
  }

  function onMarkdownChange(v: string) {
    setProfile((p) => ({ ...p, markdown: v.slice(0, MAX_MARKDOWN_CHARS) }));
  }

  function saveManualEdit() {
    const next = { ...profile, updatedAt: new Date().toISOString() };
    setProfile(next);
    saveProfile(next);
    showToast('保存しました');
  }

  async function startVoiceInput() {
    setError('');
    const ok = await recorder.start();
    if (!ok) {
      if (recorder.error === 'permission') {
        setError('マイクへのアクセスが許可されていません。iPhoneの設定を確認してください。');
      } else {
        setError('録音を開始できませんでした。');
      }
    }
  }

  async function stopVoiceInput() {
    const blob = await recorder.stop();
    const elapsed = recorder.elapsedMs;
    recorder.reset();
    if (!blob || elapsed < MIN_RECORDING_MS || blob.size < 1024) {
      setError('音声が短すぎるか、検出されませんでした。');
      return;
    }
    setBusy('transcribing');
    setError('');
    try {
      const filename = `profile-input.${extForMime(recorder.mimeType)}`;
      const text = await transcribeAudio(blob, filename);
      if (!text.trim()) {
        setError('音声を認識できませんでした。');
      } else {
        setNewInput((prev) => (prev ? `${prev}\n${text}` : text).slice(0, MAX_INPUT_CHARS));
      }
    } catch (err) {
      handleError(err, '文字起こしに失敗しました。');
    } finally {
      setBusy('none');
    }
  }

  async function applyNewInput() {
    const text = newInput.trim();
    if (!text) return;
    setBusy('updating');
    setError('');
    try {
      const updated = await updateProfileApi(profile.markdown, text);
      const next: Profile = { markdown: updated, updatedAt: new Date().toISOString() };
      setProfile(next);
      saveProfile(next);
      setNewInput('');
      showToast('プロフィールに反映しました');
    } catch (err) {
      handleError(err, 'プロフィールの更新に失敗しました。');
    } finally {
      setBusy('none');
    }
  }

  function handleError(err: unknown, fallback: string) {
    if (err instanceof ApiError) {
      if (err.status === 401) {
        window.location.assign('/login');
        return;
      }
      setError(err.message || fallback);
    } else {
      setError(fallback);
    }
  }

  if (!loaded) return null;

  return (
    <main className="mx-auto min-h-dvh max-w-[440px] px-6 pt-safe pb-safe">
      <header className="flex h-16 items-center gap-2">
        <button
          onClick={() => router.push('/settings')}
          aria-label="戻る"
          className="flex h-11 w-11 items-center justify-center rounded-full text-text active:opacity-60"
        >
          <ChevronLeftIcon />
        </button>
        <h1 className="text-[20px] font-bold">プロフィール</h1>
      </header>

      <p className="px-1 text-[13px] leading-relaxed text-text-secondary">
        家族構成や自分の立場、性格などを書き溜めておくと、日記を作るときにAIが参考にします。テキストでも音声でも追加でき、追加するたびにAIが既存の内容と整理して統合します。
      </p>

      {/* 現在のプロフィール（直接編集も可） */}
      <section className="mt-5">
        <h2 className="mb-2 px-1 text-[13px] font-semibold text-text-secondary">
          現在のプロフィール
        </h2>
        <textarea
          value={profile.markdown}
          onChange={(e) => onMarkdownChange(e.target.value)}
          placeholder={'まだ何も登録されていません。\n下の欄から情報を追加してください。'}
          rows={10}
          className="w-full resize-none rounded-card border border-border bg-surface p-4 text-[14px] leading-relaxed text-text outline-none focus:border-accent"
        />
        <div className="mt-1.5 flex items-center justify-between px-1">
          <span className="text-[12px] text-text-tertiary">
            {profile.markdown.length}/{MAX_MARKDOWN_CHARS}文字
          </span>
          <button
            onClick={saveManualEdit}
            className="text-[13px] font-semibold text-accent active:opacity-60"
          >
            手動編集を保存
          </button>
        </div>
      </section>

      {/* 情報を追加 */}
      <section className="mt-7">
        <h2 className="mb-2 px-1 text-[13px] font-semibold text-text-secondary">情報を追加</h2>

        {recorder.status === 'recording' ? (
          <div className="flex items-center justify-between rounded-card border border-border bg-surface px-4 py-3.5">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 animate-pulse-dot rounded-full bg-recording" />
              <span className="tabular text-[15px] font-semibold text-recording">
                {formatTimer(recorder.elapsedMs)}
              </span>
            </div>
            <button
              onClick={stopVoiceInput}
              aria-label="録音を停止"
              className="flex h-11 w-11 items-center justify-center rounded-full bg-recording text-white active:scale-95"
            >
              <StopIcon width={18} height={18} />
            </button>
          </div>
        ) : (
          <textarea
            value={newInput}
            onChange={(e) => setNewInput(e.target.value.slice(0, MAX_INPUT_CHARS))}
            placeholder="例: 長男が生まれました。妻はママと呼びます。"
            rows={4}
            className="w-full resize-none rounded-card border border-border bg-surface p-4 text-[15px] leading-relaxed text-text outline-none focus:border-accent"
          />
        )}

        <div className="mt-1.5 px-1 text-[12px] text-text-tertiary">
          {newInput.length}/{MAX_INPUT_CHARS}文字
        </div>

        {error && (
          <p role="alert" className="mt-2 px-1 text-[13px] text-error">
            {error}
          </p>
        )}

        <div className="mt-3 flex items-center gap-3">
          {recorder.status !== 'recording' && (
            <button
              onClick={startVoiceInput}
              disabled={busy !== 'none'}
              aria-label="音声で追加"
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-text active:opacity-70 disabled:opacity-50"
            >
              <MicIcon width={20} height={20} />
            </button>
          )}
          <button
            onClick={applyNewInput}
            disabled={busy !== 'none' || newInput.trim().length === 0 || recorder.status === 'recording'}
            className="flex h-12 flex-1 items-center justify-center rounded-full bg-accent text-[15px] font-bold text-accent-on shadow-cta active:scale-[0.99] disabled:opacity-50"
          >
            {busy === 'transcribing'
              ? '文字起こし中…'
              : busy === 'updating'
                ? 'AIが整理中…'
                : 'AIでまとめて追加'}
          </button>
        </div>
      </section>

      <div className="h-10" />

      <Toast message={toast ?? ''} visible={toast !== null} />
    </main>
  );
}

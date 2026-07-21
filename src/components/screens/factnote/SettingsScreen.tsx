'use client';

import { useEffect, useState } from 'react';
import { CheckIcon, DownloadIcon, FileTextIcon, ShareIcon } from '@/components/icons';
import { getGeminiKeyStatus, saveGeminiKey } from '@/lib/api';
import { FACTNOTE_APP_NAME, FACTNOTE_APP_TAGLINE } from '@/lib/factnote/appConfig';
import type { PersistState } from '@/lib/factnote/db';
import { FACTNOTE_PROFILE_PLACEHOLDER } from '@/lib/factnote/profile';
import { AutoTextarea } from '@/components/screens/common';
import { FactnoteHeader, Section } from './common';
import { LockSettings } from './LockSettings';
import { FactnoteTabBar } from './TabBar';

/**
 * 事実ノートの設定: プロフィール・Gemini APIキー・バックアップ・
 * ストレージ永続化状態・サンプルデータ。
 */
export function FactnoteSettingsScreen({
  persistState,
  sampleLoaded,
  busy,
  message,
  profileMarkdown,
  onSaveProfile,
  onExportJson,
  onExportMarkdown,
  onShareJson,
  canShare,
  autoBackupSupported,
  autoBackupDir,
  onChooseAutoBackupDir,
  onClearAutoBackupDir,
  onLoadSample,
  onRemoveSample,
  onRequestPersist,
}: {
  persistState: PersistState;
  sampleLoaded: boolean;
  busy: boolean;
  message: string | null;
  /** 保存済みのプロフィール本文。 */
  profileMarkdown: string;
  onSaveProfile: (markdown: string) => void;
  onExportJson: () => void;
  /** 全記録を Markdown で書き出す（他ツールでの分析用）。 */
  onExportMarkdown: () => void;
  /** 共有シート経由のバックアップ（iCloud Drive等へ保存できる）。 */
  onShareJson: () => void;
  /** この端末で共有シートが使えるか。 */
  canShare: boolean;
  /** このブラウザでフォルダ自動保存が使えるか（iPhone Safari は不可）。 */
  autoBackupSupported: boolean;
  /** 設定済みの自動保存フォルダ名（未設定なら null）。 */
  autoBackupDir: string | null;
  onChooseAutoBackupDir: () => void;
  onClearAutoBackupDir: () => void;
  onLoadSample: () => void;
  onRemoveSample: () => void;
  onRequestPersist: () => void;
}) {
  const [profileDraft, setProfileDraft] = useState(profileMarkdown);
  useEffect(() => setProfileDraft(profileMarkdown), [profileMarkdown]);
  const [keyStatus, setKeyStatus] = useState<'loading' | 'set' | 'unset'>('loading');
  const [keyInput, setKeyInput] = useState('');
  const [keySaving, setKeySaving] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);

  useEffect(() => {
    getGeminiKeyStatus()
      .then((s) => setKeyStatus(s.hasKey ? 'set' : 'unset'))
      .catch(() => setKeyStatus('unset'));
  }, []);

  async function handleSaveKey() {
    const value = keyInput.trim();
    if (!value) return;
    setKeySaving(true);
    setKeyError(null);
    try {
      await saveGeminiKey(value);
      setKeyStatus('set');
      setKeyInput('');
    } catch (e) {
      setKeyError(e instanceof Error ? e.message : 'APIキーの保存に失敗しました。');
    } finally {
      setKeySaving(false);
    }
  }

  return (
    <div className="flex min-h-dvh flex-col pt-safe">
      <FactnoteHeader title="設定" />

      <div className="flex-1 overflow-y-auto px-6 pb-4">
        <LockSettings />

        <Section title="プロフィール（あなたと登場人物について）">
          <p className="-mt-1 mb-2 text-[12px] leading-relaxed text-text-secondary">
            誰が「自分」で、相手や家族をどう呼ぶかをAIに伝えます。録音の話者ラベルが「A / B」ではなく「私 / 妻」のような呼び名になり、分析での自分側・相手側の判断も正確になります。AI処理のときだけ送信され、サーバーには保存されません。
          </p>
          <AutoTextarea
            value={profileDraft}
            onChange={setProfileDraft}
            ariaLabel="プロフィール"
            className="min-h-[120px] w-full resize-none rounded-card border border-border bg-surface px-4 py-3 text-[14px] leading-[1.8] text-text placeholder:text-text-tertiary focus:outline-none focus:ring-1 focus:ring-accent"
          />
          {!profileDraft.trim() && (
            <pre className="mt-2 whitespace-pre-wrap rounded-card bg-surface px-3 py-2 font-sans text-[12px] leading-relaxed text-text-tertiary">
              {FACTNOTE_PROFILE_PLACEHOLDER}
            </pre>
          )}
          <button
            onClick={() => onSaveProfile(profileDraft)}
            disabled={busy || profileDraft === profileMarkdown}
            className="mt-2 h-11 w-full rounded-full bg-accent text-[14px] font-semibold text-accent-on disabled:opacity-40"
          >
            プロフィールを保存
          </button>
        </Section>

        <Section title="Gemini APIキー">
          <div className="rounded-card border border-border px-4 py-3">
            <div className="flex items-center gap-2 text-[14px]">
              {keyStatus === 'loading' ? (
                <span className="text-text-tertiary">確認中…</span>
              ) : keyStatus === 'set' ? (
                <>
                  <CheckIcon width={16} height={16} className="text-success" />
                  登録済み（サーバーで暗号化保存）
                </>
              ) : (
                <span className="text-text-secondary">未登録 — AI分析には登録が必要です</span>
              )}
            </div>
            <div className="mt-3 flex gap-2">
              <input
                type="password"
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                placeholder={keyStatus === 'set' ? '新しいキーで上書き' : 'AIza…'}
                aria-label="Gemini APIキー"
                autoComplete="off"
                className="h-11 min-w-0 flex-1 rounded-card border border-border bg-bg px-3 text-[14px] focus:outline-none focus:ring-1 focus:ring-accent"
              />
              <button
                onClick={handleSaveKey}
                disabled={keySaving || !keyInput.trim()}
                className="h-11 shrink-0 rounded-full bg-accent px-4 text-[14px] font-semibold text-accent-on disabled:opacity-40"
              >
                保存
              </button>
            </div>
            {keyError && <p className="mt-2 text-[12px] text-error">{keyError}</p>}
            <p className="mt-2 text-[11.5px] leading-relaxed text-text-tertiary">
              Google AI Studio で無料のAPIキーを発行できます。キーはこの端末には保存されず、AI処理のときだけサーバーで使われます。
            </p>
          </div>
        </Section>

        <Section title="バックアップ">
          <div className="space-y-2">
            {canShare && (
              <button
                onClick={onShareJson}
                disabled={busy}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-accent text-[14px] font-semibold text-accent-on shadow-cta active:opacity-90 disabled:opacity-40"
              >
                <ShareIcon width={18} height={18} />
                共有して保存（iCloud Driveなど）
              </button>
            )}
            <button
              onClick={onExportMarkdown}
              disabled={busy}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-card border border-border bg-surface text-[14px] font-medium active:opacity-70 disabled:opacity-40"
            >
              <FileTextIcon width={18} height={18} />
              すべての記録をMarkdownで書き出す
            </button>
            <button
              onClick={onExportJson}
              disabled={busy}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-card border border-border bg-surface text-[14px] font-medium active:opacity-70 disabled:opacity-40"
            >
              <DownloadIcon width={18} height={18} />
              すべての記録をJSONでエクスポート
            </button>
          </div>
          <p className="mt-2 text-[11.5px] leading-relaxed text-text-tertiary">
            記録は端末内にのみ保存されます。
            {canShare
              ? '「共有して保存」→「"ファイル"に保存」→ iCloud Drive を選ぶと、iCloudにバックアップできます。'
              : '端末の空き容量が減るとブラウザが保存データを削除することがあるため、定期的なエクスポートをおすすめします。'}
            <br />
            Markdownは他のAIやエディタで内容を読み書きしやすい形式です（復元用のバックアップはJSONを使ってください）。
          </p>
        </Section>

        <Section title="フォルダへ自動保存">
          {autoBackupSupported ? (
            <div className="rounded-card border border-border px-4 py-3">
              <div className="text-[14px]">
                {autoBackupDir ? (
                  <span className="flex items-center gap-2">
                    <CheckIcon width={16} height={16} className="text-success" />
                    <span>
                      保存先: <strong>{autoBackupDir}</strong>
                    </span>
                  </span>
                ) : (
                  <span className="text-text-secondary">未設定</span>
                )}
              </div>
              <p className="mt-2 text-[11.5px] leading-relaxed text-text-tertiary">
                フォルダを一度選ぶと、記録を変更するたびに自動でそのフォルダへ保存します。
                <strong>iCloud Drive の中のフォルダ</strong>を選べば、iCloudに自動で同期されます。
              </p>
              <div className="mt-3 flex gap-2">
                <button
                  onClick={onChooseAutoBackupDir}
                  disabled={busy}
                  className="h-11 flex-1 rounded-full bg-accent text-[13.5px] font-semibold text-accent-on disabled:opacity-40"
                >
                  {autoBackupDir ? 'フォルダを変更' : 'フォルダを選んで自動保存'}
                </button>
                {autoBackupDir && (
                  <button
                    onClick={onClearAutoBackupDir}
                    disabled={busy}
                    className="h-11 rounded-full border border-border px-4 text-[13.5px] text-error active:opacity-70 disabled:opacity-40"
                  >
                    解除
                  </button>
                )}
              </div>
            </div>
          ) : (
            <p className="rounded-card border border-border px-4 py-3 text-[12px] leading-relaxed text-text-secondary">
              お使いのブラウザ（iPhone / iPad の Safari など）は、アプリが自動でフォルダへ書き込む機能に対応していません。これは Apple の制約で、どのWebアプリでも同じです。iPhone では上の
              <strong>「共有して保存」</strong>で iCloud Drive に保存してください。パソコンの Chrome
              などでこのページを開くと、フォルダを指定した自動保存が使えます。
            </p>
          )}
        </Section>

        <Section title="ストレージ">
          <div className="rounded-card border border-border px-4 py-3 text-[14px]">
            <div>
              保存の永続化:{' '}
              {persistState === 'granted'
                ? '有効（削除されにくい状態）'
                : persistState === 'denied'
                  ? '未許可'
                  : 'この環境では確認できません'}
            </div>
            {persistState === 'denied' && (
              <button
                onClick={onRequestPersist}
                className="mt-2 h-10 rounded-full border border-border px-4 text-[13px] active:opacity-70"
              >
                永続化を要求する
              </button>
            )}
          </div>
        </Section>

        <Section title="サンプルデータ（画面確認用）">
          <div className="flex gap-2">
            <button
              onClick={onLoadSample}
              disabled={busy || sampleLoaded}
              className="h-11 flex-1 rounded-card border border-border bg-surface text-[13.5px] active:opacity-70 disabled:opacity-40"
            >
              架空の10件を投入
            </button>
            <button
              onClick={onRemoveSample}
              disabled={busy || !sampleLoaded}
              className="h-11 flex-1 rounded-card border border-border text-[13.5px] text-error active:opacity-70 disabled:opacity-40"
            >
              サンプルを削除
            </button>
          </div>
        </Section>

        {message && (
          <p className="mt-4 rounded-card bg-surface px-4 py-3 text-[13px] text-text-secondary">{message}</p>
        )}

        <p className="mb-6 mt-10 text-center text-[11px] leading-relaxed text-text-tertiary">
          {FACTNOTE_APP_NAME} — {FACTNOTE_APP_TAGLINE}
        </p>
      </div>
      <FactnoteTabBar />
    </div>
  );
}

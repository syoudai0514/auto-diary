'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { DIARY_STYLES } from '@/lib/diary';
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type SaveTarget, type Settings } from '@/lib/settings';
import { loadTheme, saveTheme, type Theme } from '@/lib/theme';
import { logout, getGeminiKeyStatus, saveGeminiKey, ApiError } from '@/lib/api';
import { ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon } from '@/components/icons';

const SAVE_TARGETS: { id: SaveTarget; label: string }[] = [
  { id: 'apple', label: 'Appleジャーナル' },
  { id: 'dayone', label: 'Day One' },
  { id: 'clipboard', label: 'クリップボード' },
  { id: 'openApp', label: '他の日記アプリを開く（コピー+起動）' },
  { id: 'ask', label: '毎回選ぶ' },
];

const THEMES: { id: Theme; label: string }[] = [
  { id: 'system', label: '端末に合わせる' },
  { id: 'light', label: 'ライト' },
  { id: 'dark', label: 'ダーク' },
];

export default function SettingsPage() {
  const router = useRouter();
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [theme, setThemeState] = useState<Theme>('system');
  const [loaded, setLoaded] = useState(false);

  const [geminiKeyStatus, setGeminiKeyStatus] = useState<'loading' | 'set' | 'unset'>('loading');
  const [geminiKeyInput, setGeminiKeyInput] = useState('');
  const [geminiKeyBusy, setGeminiKeyBusy] = useState(false);
  const [geminiKeyError, setGeminiKeyError] = useState('');
  const [geminiKeySaved, setGeminiKeySaved] = useState(false);

  const [appleInstructionsOpen, setAppleInstructionsOpen] = useState(false);

  useEffect(() => {
    setSettings(loadSettings());
    setThemeState(loadTheme());
    setLoaded(true);
    getGeminiKeyStatus()
      .then((r) => setGeminiKeyStatus(r.hasKey ? 'set' : 'unset'))
      .catch(() => setGeminiKeyStatus('unset'));
  }, []);

  function update(patch: Partial<Settings>) {
    const next = { ...settings, ...patch };
    setSettings(next);
    saveSettings(next);
  }

  function onTheme(t: Theme) {
    setThemeState(t);
    saveTheme(t);
  }

  async function onLogout() {
    await logout();
    window.location.assign('/login');
  }

  async function onSaveGeminiKey() {
    const key = geminiKeyInput.trim();
    if (!key) return;
    setGeminiKeyBusy(true);
    setGeminiKeyError('');
    setGeminiKeySaved(false);
    try {
      await saveGeminiKey(key);
      setGeminiKeyStatus('set');
      setGeminiKeyInput('');
      setGeminiKeySaved(true);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        window.location.assign('/login');
        return;
      }
      setGeminiKeyError('APIキーの保存に失敗しました。もう一度お試しください。');
    } finally {
      setGeminiKeyBusy(false);
    }
  }

  if (!loaded) return null;

  return (
    <main className="mx-auto min-h-dvh max-w-[440px] px-6 pt-safe pb-safe">
      <header className="flex h-16 items-center gap-2">
        <button
          onClick={() => router.push('/')}
          aria-label="戻る"
          className="flex h-11 w-11 items-center justify-center rounded-full text-text active:opacity-60"
        >
          <ChevronLeftIcon />
        </button>
        <h1 className="text-[20px] font-bold">設定</h1>
      </header>

      <section className="mt-4">
        <h2 className="mb-2 px-1 text-[13px] font-semibold text-text-secondary">日記の文体</h2>
        <div className="overflow-hidden rounded-card border border-border bg-surface">
          {DIARY_STYLES.map((s, i) => (
            <button
              key={s.id}
              onClick={() => update({ style: s.id })}
              className={`flex w-full items-center justify-between px-4 py-3.5 text-left text-[15px] ${
                i > 0 ? 'border-t border-border' : ''
              }`}
            >
              <span>{s.label}</span>
              {settings.style === s.id && <span className="text-accent">●</span>}
            </button>
          ))}
        </div>
      </section>

      <section className="mt-7">
        <h2 className="mb-2 px-1 text-[13px] font-semibold text-text-secondary">Appleジャーナル連携</h2>
        <div className="rounded-card border border-border bg-surface p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[15px] font-medium">有効にする</p>
              <p className="mt-0.5 text-[12px] leading-relaxed text-text-tertiary">
                iPhone側で一度だけショートカットの準備が必要です。準備前に有効にすると、保存時にiOSの分かりにくいエラーが出ます。
              </p>
            </div>
            <button
              role="switch"
              aria-checked={settings.appleJournalEnabled}
              aria-label="Appleジャーナル連携を有効にする"
              onClick={() => update({ appleJournalEnabled: !settings.appleJournalEnabled })}
              className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${
                settings.appleJournalEnabled ? 'bg-accent' : 'bg-border'
              }`}
            >
              <span
                className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform ${
                  settings.appleJournalEnabled ? 'translate-x-[22px]' : 'translate-x-0.5'
                }`}
              />
            </button>
          </div>

          <button
            onClick={() => setAppleInstructionsOpen((v) => !v)}
            className="mt-3 flex w-full items-center justify-between text-[13px] font-medium text-accent"
          >
            <span>準備の手順を見る</span>
            <ChevronDownIcon
              width={16}
              height={16}
              className="transition-transform duration-200"
              style={{ transform: appleInstructionsOpen ? 'rotate(180deg)' : 'none' }}
            />
          </button>

          {appleInstructionsOpen && (
            <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-[12.5px] leading-relaxed text-text-secondary">
              <li>iPhoneの「ショートカット」アプリを開く（青いアイコン）</li>
              <li>右上の＋をタップして新しいショートカットを作る</li>
              <li>
                名前を <code className="rounded bg-bg px-1">音声日記を保存</code>{' '}
                にする（このアプリと完全に同じ文字にすること）
              </li>
              <li>「アクションを追加」→「ショートカットの入力」→「ショートカットの入力を受け取る」を追加（受け取る内容にテキストを含める）</li>
              <li>「アクションを追加」→「辞書」→「入力から辞書を取得」を追加（入力は上で受け取ったもの）</li>
              <li>「アクションを追加」→「辞書の値」→「辞書の値を取得」を追加し、キーに title（名前は「タイトル」に）</li>
              <li>もう一つ「辞書の値を取得」を追加し、キーに body（名前は「本文」に）</li>
              <li>「アクションを追加」→「ジャーナル」→「ジャーナル項目を作成」を追加し、本文に「本文」、タイトルに「タイトル」を入れる</li>
              <li>右上の「完了」で保存すれば準備完了。この後、上のスイッチをオンにしてください</li>
            </ol>
          )}
        </div>
      </section>

      <section className="mt-7">
        <h2 className="mb-2 px-1 text-[13px] font-semibold text-text-secondary">標準の保存先</h2>
        <div className="overflow-hidden rounded-card border border-border bg-surface">
          {SAVE_TARGETS.filter((t) => t.id !== 'apple' || settings.appleJournalEnabled).map((t, i) => (
            <button
              key={t.id}
              onClick={() => update({ saveTarget: t.id })}
              className={`flex w-full items-center justify-between px-4 py-3.5 text-left text-[15px] ${
                i > 0 ? 'border-t border-border' : ''
              }`}
            >
              <span>{t.label}</span>
              {settings.saveTarget === t.id && <span className="text-accent">●</span>}
            </button>
          ))}
        </div>
      </section>

      <section className="mt-7">
        <h2 className="mb-2 px-1 text-[13px] font-semibold text-text-secondary">
          自分について・登場人物
        </h2>
        <button
          onClick={() => router.push('/profile')}
          className="flex w-full items-center justify-between rounded-card border border-border bg-surface px-4 py-3.5 text-left text-[15px] active:opacity-70"
        >
          <span>プロフィールを編集</span>
          <ChevronRightIcon width={18} height={18} className="text-text-tertiary" />
        </button>
        <p className="mt-1.5 px-1 text-[12px] text-text-tertiary">
          家族構成や自分の立場をテキスト・音声で登録しておくと、日記生成のときにAIが参考にします。
        </p>
      </section>

      <section className="mt-7">
        <h2 className="mb-2 px-1 text-[13px] font-semibold text-text-secondary">Gemini APIキー</h2>
        <div className="rounded-card border border-border bg-surface p-4">
          <p className="text-[13px] text-text-secondary">
            状態:{' '}
            {geminiKeyStatus === 'loading' && '確認中…'}
            {geminiKeyStatus === 'set' && <span className="font-semibold text-accent">設定済み</span>}
            {geminiKeyStatus === 'unset' && (
              <span className="font-semibold text-error">未設定（文字起こし・日記生成にはキーが必要です）</span>
            )}
          </p>
          <input
            value={geminiKeyInput}
            onChange={(e) => setGeminiKeyInput(e.target.value)}
            placeholder="AIza... で始まるキーを貼り付け"
            aria-label="Gemini APIキー"
            className="mt-3 h-12 w-full rounded-chip border border-border bg-bg px-4 text-[15px] outline-none focus:border-accent"
          />
          {geminiKeyError && <p className="mt-2 text-[12.5px] text-error">{geminiKeyError}</p>}
          {geminiKeySaved && <p className="mt-2 text-[12.5px] text-accent">保存しました</p>}
          <button
            onClick={onSaveGeminiKey}
            disabled={geminiKeyBusy || geminiKeyInput.trim().length === 0}
            className="mt-3 flex h-11 w-full items-center justify-center rounded-full bg-accent text-[14.5px] font-bold text-accent-on active:scale-[0.99] disabled:opacity-50"
          >
            {geminiKeyBusy ? '保存中…' : 'キーを保存'}
          </button>
          <p className="mt-3 text-[12px] leading-relaxed text-text-tertiary">
            自分専用の無料キーを、<a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" className="underline">Google AI Studio</a>
            で取得できます。Googleアカウントでログイン→「Create API key」→ 発行された{' '}
            <code>AIza...</code> から始まるキーをコピーしてここに貼り付けてください（クレジットカード登録不要）。
          </p>
        </div>
      </section>

      <section className="mt-7">
        <h2 className="mb-2 px-1 text-[13px] font-semibold text-text-secondary">
          Day One のジャーナル名（任意）
        </h2>
        <input
          value={settings.dayoneJournal}
          onChange={(e) => update({ dayoneJournal: e.target.value })}
          placeholder="例: 日記"
          className="h-12 w-full rounded-card border border-border bg-surface px-4 text-[15px] outline-none focus:border-accent"
        />
        <p className="mt-1.5 px-1 text-[12px] text-text-tertiary">
          空欄の場合は Day One の既定ジャーナルに保存されます。
        </p>
      </section>

      <section className="mt-7">
        <h2 className="mb-2 px-1 text-[13px] font-semibold text-text-secondary">外観</h2>
        <div className="overflow-hidden rounded-card border border-border bg-surface">
          {THEMES.map((t, i) => (
            <button
              key={t.id}
              onClick={() => onTheme(t.id)}
              className={`flex w-full items-center justify-between px-4 py-3.5 text-left text-[15px] ${
                i > 0 ? 'border-t border-border' : ''
              }`}
            >
              <span>{t.label}</span>
              {theme === t.id && <span className="text-accent">●</span>}
            </button>
          ))}
        </div>
      </section>

      <section className="mt-8 mb-10">
        <button
          onClick={onLogout}
          className="flex h-12 w-full items-center justify-center rounded-card border border-border text-[15px] text-error active:opacity-70"
        >
          ログアウト
        </button>
      </section>
    </main>
  );
}

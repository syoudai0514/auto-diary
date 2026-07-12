'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { DIARY_STYLES } from '@/lib/diary';
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type SaveTarget, type Settings } from '@/lib/settings';
import { loadTheme, saveTheme, type Theme } from '@/lib/theme';
import { logout } from '@/lib/api';
import { ChevronLeftIcon, ChevronRightIcon } from '@/components/icons';

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

  useEffect(() => {
    setSettings(loadSettings());
    setThemeState(loadTheme());
    setLoaded(true);
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
        <h2 className="mb-2 px-1 text-[13px] font-semibold text-text-secondary">標準の保存先</h2>
        <div className="overflow-hidden rounded-card border border-border bg-surface">
          {SAVE_TARGETS.map((t, i) => (
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

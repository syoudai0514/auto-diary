'use client';

import { Suspense, useState, type FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import { login, ApiError } from '@/lib/api';
import { MicIcon } from '@/components/icons';

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const params = useSearchParams();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(password);
      const next = params.get('next') || '/';
      // ミドルウェア再評価のため location 遷移
      window.location.assign(next.startsWith('/') ? next : '/');
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        setError('試行回数が多すぎます。少し待ってからお試しください。');
      } else if (err instanceof ApiError && err.code === 'invalid_password') {
        setError('パスワードが違います。');
      } else {
        setError('ログインに失敗しました。');
      }
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-7 pt-safe pb-safe">
      <div className="w-full max-w-[320px]">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-5 flex h-[72px] w-[72px] items-center justify-center rounded-[22px] bg-accent text-accent-on">
            <MicIcon width={34} height={34} />
          </div>
          <h1 className="text-[22px] font-bold leading-tight">音声日記</h1>
          <p className="mt-2 max-w-[260px] text-[14px] leading-relaxed text-text-secondary">
            あなた専用のアプリです。パスワードを入力してください。
          </p>
        </div>

        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <input
            type="password"
            inputMode="text"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="パスワード"
            aria-label="パスワード"
            className="h-14 w-full rounded-2xl border border-border bg-surface px-5 text-[16px] text-text outline-none focus:border-accent"
          />
          {error && (
            <p role="alert" className="text-[13px] text-error">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={busy || password.length === 0}
            className="mt-1 flex h-14 w-full items-center justify-center rounded-full bg-accent text-[17px] font-semibold text-accent-on shadow-cta transition active:scale-[0.99] disabled:opacity-50"
          >
            {busy ? 'ログイン中…' : 'ログイン'}
          </button>
        </form>
      </div>
    </main>
  );
}

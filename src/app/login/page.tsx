'use client';

import { Suspense, useState, type FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { login, ApiError } from '@/lib/api';
import { safeNextPath } from '@/lib/nextPath';
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
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(username, password);
      // ミドルウェア再評価のため location 遷移
      window.location.assign(safeNextPath(params.get('next')));
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        setError('試行回数が多すぎます。少し待ってからお試しください。');
      } else if (err instanceof ApiError && err.code === 'invalid_password') {
        setError('ユーザー名またはパスワードが違います。');
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
            ユーザー名とパスワードを入力してください。
          </p>
        </div>

        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <input
            type="text"
            inputMode="text"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="ユーザー名"
            aria-label="ユーザー名"
            className="h-14 w-full rounded-2xl border border-border bg-surface px-5 text-[16px] text-text outline-none focus:border-accent"
          />
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
            disabled={busy || username.length === 0 || password.length === 0}
            className="mt-1 flex h-14 w-full items-center justify-center rounded-full bg-accent text-[17px] font-semibold text-accent-on shadow-cta transition active:scale-[0.99] disabled:opacity-50"
          >
            {busy ? 'ログイン中…' : 'ログイン'}
          </button>
        </form>

        <p className="mt-6 text-center text-[13px] text-text-tertiary">
          招待コードをお持ちの方は
          <Link href="/signup" className="ml-1 font-semibold text-accent">
            アカウントを作成
          </Link>
        </p>
      </div>
    </main>
  );
}

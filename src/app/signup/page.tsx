'use client';

import { Suspense, useState, type FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { signup, ApiError } from '@/lib/api';
import { safeNextPath } from '@/lib/nextPath';
import { MicIcon } from '@/components/icons';

export default function SignupPage() {
  return (
    <Suspense fallback={null}>
      <SignupForm />
    </Suspense>
  );
}

function SignupForm() {
  const params = useSearchParams();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await signup(username, password, inviteCode);
      // ミドルウェア再評価のため location 遷移
      window.location.assign(safeNextPath(params.get('next')));
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        setError('試行回数が多すぎます。少し待ってからお試しください。');
      } else if (err instanceof ApiError && err.code === 'invalid_invite') {
        setError('招待コードが違います。');
      } else if (err instanceof ApiError && err.code === 'username_taken') {
        setError('そのユーザー名は既に使われています。');
      } else if (err instanceof ApiError && err.code === 'invalid') {
        setError('ユーザー名は3〜32文字の英数字、パスワードは8文字以上にしてください。');
      } else {
        setError('登録に失敗しました。');
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
          <h1 className="text-[22px] font-bold leading-tight">アカウントを作成</h1>
          <p className="mt-2 max-w-[260px] text-[14px] leading-relaxed text-text-secondary">
            招待コードと、使いたいユーザー名・パスワードを入力してください。
          </p>
        </div>

        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <input
            type="text"
            inputMode="text"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="ユーザー名（英数字、3〜32文字）"
            aria-label="ユーザー名"
            className="h-14 w-full rounded-2xl border border-border bg-surface px-5 text-[16px] text-text outline-none focus:border-accent"
          />
          <input
            type="password"
            inputMode="text"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="パスワード（8文字以上）"
            aria-label="パスワード"
            className="h-14 w-full rounded-2xl border border-border bg-surface px-5 text-[16px] text-text outline-none focus:border-accent"
          />
          <input
            type="text"
            inputMode="text"
            autoComplete="off"
            value={inviteCode}
            onChange={(e) => setInviteCode(e.target.value)}
            placeholder="招待コード"
            aria-label="招待コード"
            className="h-14 w-full rounded-2xl border border-border bg-surface px-5 text-[16px] text-text outline-none focus:border-accent"
          />
          {error && (
            <p role="alert" className="text-[13px] text-error">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={busy || username.length === 0 || password.length === 0 || inviteCode.length === 0}
            className="mt-1 flex h-14 w-full items-center justify-center rounded-full bg-accent text-[17px] font-semibold text-accent-on shadow-cta transition active:scale-[0.99] disabled:opacity-50"
          >
            {busy ? '登録中…' : 'アカウントを作成'}
          </button>
        </form>

        <p className="mt-6 text-center text-[13px] text-text-tertiary">
          すでにアカウントをお持ちの方は
          <Link href="/login" className="ml-1 font-semibold text-accent">
            ログイン
          </Link>
        </p>
      </div>
    </main>
  );
}

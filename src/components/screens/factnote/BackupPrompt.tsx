'use client';

import { useEffect, useState } from 'react';
import { CheckIcon, ShareIcon } from '@/components/icons';
import {
  canShareBackup,
  isBackupStale,
  shareBackupJson,
} from '@/lib/factnote/exportData';
import {
  getAutoBackupDirName,
  maybeAutoBackup,
  supportsDirectoryAutoBackup,
} from '@/lib/factnote/autoBackup';

/**
 * 保存の完了時など「いいタイミング」に、ワンタップでバックアップできる導線。
 *
 * - フォルダ自動保存が設定済み（デスクトップ）: すでに自動保存されるため
 *   「自動保存しました」と静かに表示するだけ。
 * - 共有シートが使える（iPhone 等）: バックアップが古い時だけ、ワンタップの
 *   「iCloud Drive にバックアップ」ボタンを目立たせる（毎回は出さない）。
 * - どちらも無い場合は何も表示しない。
 */
export function BackupPrompt({ compact }: { compact?: boolean }) {
  const [state, setState] = useState<
    'checking' | 'auto_saved' | 'offer' | 'sharing' | 'done' | 'hidden'
  >('checking');
  const [dirName, setDirName] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (supportsDirectoryAutoBackup()) {
        const name = await getAutoBackupDirName().catch(() => null);
        if (name) {
          // 起動時の自動保存で既に書き込まれている想定。念のため一度走らせる
          await maybeAutoBackup().catch(() => {});
          if (!cancelled) {
            setDirName(name);
            setState('auto_saved');
          }
          return;
        }
      }
      if (canShareBackup() && (await isBackupStale())) {
        if (!cancelled) setState('offer');
        return;
      }
      if (!cancelled) setState('hidden');
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (state === 'checking' || state === 'hidden') return null;

  if (state === 'auto_saved') {
    return (
      <div className="flex items-center justify-center gap-1.5 text-[12.5px] text-text-secondary">
        <CheckIcon width={15} height={15} className="text-success" />
        「{dirName}」に自動保存しました
      </div>
    );
  }

  if (state === 'done') {
    return (
      <div className="flex items-center justify-center gap-1.5 text-[12.5px] text-text-secondary">
        <CheckIcon width={15} height={15} className="text-success" />
        iCloud Drive にバックアップしました
      </div>
    );
  }

  // offer / sharing
  return (
    <div className={compact ? '' : 'rounded-card bg-warning-soft px-4 py-3'}>
      {!compact && (
        <p className="mb-2 text-[12.5px] leading-relaxed text-text-secondary">
          しばらくバックアップしていません。今のうちに iCloud に保存しておくと安心です。
        </p>
      )}
      <button
        onClick={async () => {
          setState('sharing');
          try {
            const { shared } = await shareBackupJson();
            setState(shared ? 'done' : 'offer');
          } catch {
            setState('offer');
          }
        }}
        disabled={state === 'sharing'}
        className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-accent text-[14.5px] font-semibold text-accent-on shadow-cta active:opacity-90 disabled:opacity-50"
      >
        <ShareIcon width={18} height={18} />
        {state === 'sharing' ? '準備中…' : 'iCloud Drive にバックアップ'}
      </button>
    </div>
  );
}

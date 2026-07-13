'use client';

import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { FactnoteHeader } from '@/components/screens/factnote/common';

/**
 * 記録作成フロー（入力 → 補足情報 → 文字起こし → 確認 → 分析 → 日記）。
 * Phase 2 でページ内状態機械として実装する。現状は骨格のみ。
 */
export default function FactnoteNewPage() {
  return (
    <Suspense>
      <NewFlow />
    </Suspense>
  );
}

function NewFlow() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const mode = searchParams.get('mode') ?? 'text';
  const label = mode === 'record' ? '今のことを話す' : mode === 'file' ? '録音ファイルを読み込む' : '文章で入力';

  return (
    <div className="flex min-h-dvh flex-col pt-safe">
      <FactnoteHeader title={label} backHref="/factnote" />
      <div className="flex flex-1 flex-col items-center justify-center gap-4 px-7 text-center">
        <p className="text-[14px] leading-relaxed text-text-tertiary">
          この入力フローは現在実装中です（Phase 2）。
        </p>
        <button
          onClick={() => router.push('/factnote')}
          className="h-11 rounded-full border border-border px-5 text-[14px] active:opacity-70"
        >
          ホームへ戻る
        </button>
      </div>
    </div>
  );
}

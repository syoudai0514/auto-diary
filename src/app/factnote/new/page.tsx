'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { FactnoteNewFlow, type NewFlowMode } from '@/components/screens/factnote/NewFlow';

/**
 * 記録作成フロー（入力 → 文字起こし → 確認・修正 → 補足情報 → 分析 → 日記）。
 * mode クエリで入力方法を切り替える（text / record / file）。
 */
export default function FactnoteNewPage() {
  return (
    <Suspense>
      <NewFlowWithMode />
    </Suspense>
  );
}

function NewFlowWithMode() {
  const searchParams = useSearchParams();
  const raw = searchParams.get('mode');
  const mode: NewFlowMode = raw === 'record' || raw === 'file' ? raw : 'text';
  return <FactnoteNewFlow mode={mode} />;
}

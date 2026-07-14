'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronRightIcon, HeartIcon, ScaleIcon, UsersIcon } from '@/components/icons';
import { FactnoteHeader } from '@/components/screens/factnote/common';
import { FactnoteTabBar } from '@/components/screens/factnote/TabBar';
import { listRecords } from '@/lib/factnote/db';
import type { IncidentRecord } from '@/lib/factnote/types';

/**
 * 分析ハブ（下部タブ「分析」）。長期分析3機能への入口をまとめる。
 * 一件ごとの分析は記録の作成フロー・記録詳細から行う。
 */
export default function FactnoteInsightsPage() {
  const [records, setRecords] = useState<IncidentRecord[]>([]);

  useEffect(() => {
    listRecords()
      .then(setRecords)
      .catch(() => setRecords([]));
  }, []);

  const latest = records[0];

  return (
    <div className="flex min-h-dvh flex-col pt-safe">
      <FactnoteHeader title="分析" />
      <div className="flex-1 overflow-y-auto px-6 pb-6">
        <p className="pt-1 text-[12.5px] leading-relaxed text-text-secondary">
          一件の出来事と、長期的なパターンを分けて確認するための機能です。
        </p>

        <div className="mt-5 space-y-3">
          <HubCard
            href="/factnote/carte"
            icon={<UsersIcon width={22} height={22} />}
            title="客観カルテ"
            description="人物ごとに、衝突・良い出来事・修復行動・よく出るテーマや表現を長期的に見る"
            disabled={false}
          />
          <HubCard
            href={latest ? `/factnote/flatcheck?recordId=${latest.id}` : undefined}
            icon={<ScaleIcon width={22} height={22} />}
            title="フラットチェック"
            description={
              latest
                ? `直近の記録「${latest.title || '無題の記録'}」を過去の傾向と比べて、極端な結論を防ぐ`
                : 'まだ記録がありません。記録を作成すると使えます'
            }
            disabled={!latest}
          />
          <HubCard
            href="/factnote/memos"
            icon={<HeartIcon width={22} height={22} />}
            title="未来の自分からのメモ"
            description="冷静な時の自分の言葉を、動揺している時の自分へ届ける"
            disabled={false}
          />
        </div>

        <p className="mt-8 text-[11.5px] leading-relaxed text-text-tertiary">
          どの分析も、あなたや相手を診断・断定するものではありません。記録された事実の整理として使ってください。
        </p>
      </div>
      <FactnoteTabBar />
    </div>
  );
}

function HubCard({
  href,
  icon,
  title,
  description,
  disabled,
}: {
  href?: string;
  icon: React.ReactNode;
  title: string;
  description: string;
  disabled: boolean;
}) {
  const inner = (
    <>
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-surface text-accent">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15.5px] font-semibold">{title}</span>
        <span className="mt-0.5 block text-[12.5px] leading-relaxed text-text-secondary">
          {description}
        </span>
      </span>
      {!disabled && <ChevronRightIcon width={20} height={20} className="shrink-0 text-text-tertiary" />}
    </>
  );
  if (disabled || !href) {
    return (
      <div className="flex min-h-[72px] items-center gap-3 rounded-card border border-border px-4 py-3 opacity-60">
        {inner}
      </div>
    );
  }
  return (
    <Link
      href={href}
      className="flex min-h-[72px] items-center gap-3 rounded-card border border-border bg-surface px-4 py-3 active:opacity-70"
    >
      {inner}
    </Link>
  );
}

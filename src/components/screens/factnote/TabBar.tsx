'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BookIcon, HomeIcon, ScaleIcon, SettingsIcon } from '@/components/icons';

const TABS = [
  { href: '/factnote', label: 'ホーム', icon: HomeIcon },
  { href: '/factnote/records', label: '記録', icon: BookIcon },
  { href: '/factnote/insights', label: '分析', icon: ScaleIcon },
  { href: '/factnote/settings', label: '設定', icon: SettingsIcon },
] as const;

/**
 * 事実ノートの下部タブバー。トップレベル4画面（ホーム/記録/分析/設定）で表示する。
 * 入力フロー・詳細などのサブ画面では表示しない（戻るボタンで移動する）。
 */
export function FactnoteTabBar() {
  const pathname = usePathname() ?? '';
  return (
    <nav
      aria-label="メインナビゲーション"
      className="sticky bottom-0 z-10 border-t border-border bg-bg pb-safe"
    >
      <div className="mx-auto flex max-w-md">
        {TABS.map(({ href, label, icon: Icon }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={`flex min-h-[52px] flex-1 flex-col items-center justify-center gap-0.5 ${
                active ? 'text-accent' : 'text-text-tertiary'
              } active:opacity-60`}
            >
              <Icon width={22} height={22} strokeWidth={active ? 2.2 : 1.9} />
              <span className={`text-[10.5px] ${active ? 'font-semibold' : ''}`}>{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

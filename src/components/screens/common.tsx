'use client';

import { useEffect, useRef } from 'react';

/** 中央寄せの全画面レイアウト（許可・処理中・エラー等の状態画面で共用）。 */
export function CenterScreen({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-7 pt-safe pb-safe text-center">
      {children}
    </div>
  );
}

/** 結果画面の横スクロール操作チップ。 */
export function Chip({
  icon,
  label,
  onClick,
  destructive,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  destructive?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-chip border border-border bg-surface px-3.5 text-[13px] active:opacity-70 ${
        destructive ? 'text-error' : 'text-text'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

/** 内容に合わせて高さが伸びる textarea。 */
export function AutoTextarea({
  value,
  onChange,
  ariaLabel,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  ariaLabel: string;
  className?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight}px`;
    }
  }, [value]);
  return (
    <textarea
      ref={ref}
      value={value}
      aria-label={ariaLabel}
      onChange={(e) => onChange(e.target.value)}
      rows={4}
      className={className}
    />
  );
}

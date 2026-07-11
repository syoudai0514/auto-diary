'use client';

import { CheckIcon } from './icons';

/** 画面下部中央のトースト。保存完了・コピー完了などの短い通知に使う。 */
export function Toast({ message, visible }: { message: string; visible: boolean }) {
  if (!visible) return null;
  return (
    <div
      role="status"
      className="pointer-events-none fixed inset-x-0 bottom-[110px] z-50 flex justify-center px-6"
    >
      <div className="flex items-center gap-2 rounded-full bg-surface px-4 py-2.5 shadow-toast">
        <span className="flex h-5 w-5 animate-pop-in items-center justify-center rounded-full bg-success text-white">
          <CheckIcon width={13} height={13} strokeWidth={3} />
        </span>
        <span className="text-[13.5px] font-semibold text-text">{message}</span>
      </div>
    </div>
  );
}

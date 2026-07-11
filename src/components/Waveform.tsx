'use client';

import { useMemo } from 'react';

/** 録音中の波形（24本のバー、位相をずらして scaleY アニメーション）。装飾的表現。 */
export function Waveform({ active }: { active: boolean }) {
  const bars = useMemo(
    () =>
      Array.from({ length: 24 }, () => ({
        delay: Math.random() * 0.6,
        dur: 0.7 + Math.random() * 0.4,
        base: 12 + Math.random() * 26,
      })),
    [],
  );

  return (
    <div
      className="flex h-10 items-center justify-center gap-[3px]"
      aria-hidden="true"
    >
      {bars.map((b, i) => (
        <span
          key={i}
          className="w-1 rounded-full bg-accent"
          style={{
            height: `${b.base}px`,
            transformOrigin: 'center',
            animation: active
              ? `wf ${b.dur}s ease-in-out ${b.delay}s infinite alternate`
              : 'none',
            opacity: active ? 1 : 0.4,
          }}
        />
      ))}
      <style>{`
        @keyframes wf {
          from { transform: scaleY(0.35); }
          to { transform: scaleY(1); }
        }
        @media (prefers-reduced-motion: reduce) {
          @keyframes wf { from { transform: none; } to { transform: none; } }
        }
      `}</style>
    </div>
  );
}

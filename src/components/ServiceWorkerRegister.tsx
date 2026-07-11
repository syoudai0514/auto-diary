'use client';

import { useEffect } from 'react';
import { applyTheme, loadTheme } from '@/lib/theme';

/** サービスワーカー登録と保存済みテーマの適用を行う（副作用のみ、描画なし）。 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    applyTheme(loadTheme());
    if ('serviceWorker' in navigator) {
      // ページ表示の邪魔をしないよう load 後に登録
      const onLoad = () => {
        navigator.serviceWorker.register('/sw.js').catch(() => {
          /* 登録失敗は致命的でないため無視 */
        });
      };
      if (document.readyState === 'complete') onLoad();
      else window.addEventListener('load', onLoad, { once: true });
    }
  }, []);
  return null;
}

/*
 * 最小構成のサービスワーカー。
 * - PWA としてインストール可能にするために存在する。
 * - アプリシェル（オフラインでも起動できる静的アセット）だけをキャッシュする。
 * - 音声・日記本文などの機微データや API 応答はキャッシュしない（プライバシー配慮）。
 */
const CACHE = 'voice-diary-shell-v2';
const APP_SHELL = [
  '/manifest.webmanifest',
  '/factnote-manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(APP_SHELL)).catch(() => {}),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // API・認証・POST などはネットワークのみ（キャッシュしない）
  if (req.method !== 'GET' || url.pathname.startsWith('/api/')) {
    return;
  }

  // 静的アイコン/マニフェストは cache-first
  if (APP_SHELL.includes(url.pathname)) {
    event.respondWith(
      caches.match(req).then((cached) => cached || fetch(req)),
    );
    return;
  }

  // それ以外はネットワーク優先、失敗時のみキャッシュ（あれば）
  event.respondWith(
    fetch(req).catch(() => caches.match(req).then((c) => c || Response.error())),
  );
});

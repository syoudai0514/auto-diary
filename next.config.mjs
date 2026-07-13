/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // 事実ノート専用デプロイ（別Vercelプロジェクト）では NEXT_PUBLIC_APP_VARIANT=factnote を
  // 設定してルートを事実ノートへ向ける。未設定なら既存の音声日記のまま（影響なし）。
  async redirects() {
    if (process.env.NEXT_PUBLIC_APP_VARIANT === 'factnote') {
      return [{ source: '/', destination: '/factnote', permanent: false }];
    }
    return [];
  },
  // 音声ファイルのアップロードに備えてボディサイズ上限を明示（Server Actions未使用だが将来のため）
  async headers() {
    return [
      {
        // Service Worker はスコープ全体を制御できるよう no-cache で配信する
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
    ];
  },
};

export default nextConfig;

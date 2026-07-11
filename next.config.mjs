/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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

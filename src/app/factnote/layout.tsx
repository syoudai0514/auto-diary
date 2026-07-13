import type { Metadata } from 'next';
import { FACTNOTE_APP_NAME, FACTNOTE_APP_TAGLINE } from '@/lib/factnote/appConfig';

/**
 * 独自の manifest を持たせ、iOSの「ホーム画面に追加」時に既存アプリ（/）ではなく
 * /factnote が起動URLになるようにする。`manifest` はルートレイアウトの値を
 * このセクション配下でのみ上書きする（Next.jsのmetadataはページ単位で最も
 * 具体的な値が使われる）。
 */
export const metadata: Metadata = {
  title: FACTNOTE_APP_NAME,
  description: FACTNOTE_APP_TAGLINE,
  manifest: '/factnote-manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: FACTNOTE_APP_NAME,
  },
};

export default function FactnoteLayout({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto w-full max-w-md animate-screen-in">{children}</div>;
}

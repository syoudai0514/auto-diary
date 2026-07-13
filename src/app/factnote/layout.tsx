import type { Metadata } from 'next';
import { FACTNOTE_APP_NAME, FACTNOTE_APP_TAGLINE } from '@/lib/factnote/appConfig';

export const metadata: Metadata = {
  title: FACTNOTE_APP_NAME,
  description: FACTNOTE_APP_TAGLINE,
};

export default function FactnoteLayout({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto w-full max-w-md animate-screen-in">{children}</div>;
}

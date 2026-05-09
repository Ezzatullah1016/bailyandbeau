import '@fontsource/plus-jakarta-sans';
import '@fontsource/cormorant-garamond';
import '@fontsource/jost';
import '@fontsource/baloo-2';
import '@fontsource/karla';
import '@fontsource-variable/newsreader';
import '@fontsource-variable/nunito';

import type { Metadata } from 'next';
import './globals.css';
import { AppShell } from './AppShell';
import { CookieBanner } from '@/components/CookieBanner';

export const metadata: Metadata = {
  title: 'Bailey & Beau',
  description: 'Bailey & Beau reading platform.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <AppShell>{children}</AppShell>
        <CookieBanner />
      </body>
    </html>
  );
}

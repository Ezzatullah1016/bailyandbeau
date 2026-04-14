import type { Metadata } from 'next';
import './globals.css';
import { AppShell } from './AppShell';
import { Newsreader, Plus_Jakarta_Sans, Cormorant_Garamond, Jost } from 'next/font/google';

const newsreader = Newsreader({ subsets: ['latin'], style: ['normal', 'italic'], weight: ['400', '600', '700'], variable: '--font-newsreader' });
const jakarta = Plus_Jakarta_Sans({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-jakarta' });
const cormorant = Cormorant_Garamond({ subsets: ['latin'], style: ['normal', 'italic'], weight: ['400', '600', '700'], variable: '--font-cormorant' });
const jost = Jost({ subsets: ['latin'], weight: ['300', '400', '500', '600'], variable: '--font-jost' });

export const metadata: Metadata = {
  title: 'Bailey & Beau',
  description: 'Foundation frontend scaffold for the Bailey & Beau reading platform.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${newsreader.variable} ${jakarta.variable} ${cormorant.variable} ${jost.variable}`}>
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
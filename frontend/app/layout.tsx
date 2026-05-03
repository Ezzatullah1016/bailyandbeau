import type { Metadata } from 'next';
import './globals.css';
import { AppShell } from './AppShell';
import { Plus_Jakarta_Sans, Cormorant_Garamond, Jost, Baloo_2, Karla } from 'next/font/google';

const jakarta = Plus_Jakarta_Sans({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-jakarta' });
const cormorant = Cormorant_Garamond({ subsets: ['latin'], style: ['normal', 'italic'], weight: ['400', '600', '700'], variable: '--font-cormorant' });
const jost = Jost({ subsets: ['latin'], weight: ['300', '400', '500', '600'], variable: '--font-jost' });
const baloo = Baloo_2({ subsets: ['latin'], weight: ['400', '500', '600', '700', '800'], variable: '--font-baloo' });
const karla = Karla({ subsets: ['latin'], weight: ['300', '400', '500', '600', '700'], variable: '--font-karla' });

export const metadata: Metadata = {
  title: 'Bailey & Beau',
  description: 'Bailey & Beau reading platform.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${jakarta.variable} ${cormorant.variable} ${jost.variable} ${baloo.variable} ${karla.variable}`}>
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}

import type { Metadata } from 'next';
import './globals.css';
import { AppShell } from './AppShell';
import { Baloo_2, Karla } from 'next/font/google';

const baloo = Baloo_2({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-baloo',
});
const karla = Karla({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-karla',
});

export const metadata: Metadata = {
  title: 'Bailey & Beau',
  description: 'Bailey & Beau reading platform.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${baloo.variable} ${karla.variable}`}>
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}

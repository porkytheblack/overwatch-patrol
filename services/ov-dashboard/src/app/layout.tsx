import type { Metadata } from 'next';
import localFont from 'next/font/local';
import './globals.css';

// Self-hosted Inter + JetBrains Mono variable fonts. We used to use
// `next/font/google`, but that fetches from fonts.gstatic.com at build/compile
// time — and the GFW blocks Google entirely, so dev startup hangs on first
// compile for operators in China. The .woff2 files are the latin-subset
// variable fonts Google was serving (v20 / v24), checked into ./fonts/.
const inter = localFont({
  src: './fonts/Inter-Variable.woff2',
  variable: '--font-inter',
  display: 'swap',
  weight: '100 900',
});

const mono = localFont({
  src: './fonts/JetBrainsMono-Variable.woff2',
  variable: '--font-mono',
  display: 'swap',
  weight: '100 800',
});

export const metadata: Metadata = {
  title: 'OVERWATCH PATROL',
  description: 'Autonomous single-robot surveillance built on dimos.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`dark ${inter.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}

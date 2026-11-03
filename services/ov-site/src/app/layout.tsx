import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import { siteUrl } from '@/lib/site';
import './globals.css';

// next/font downloads the woff2 at build time and self-hosts it.
const inter = Inter({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-inter', display: 'swap' });
const mono = JetBrains_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-mono', display: 'swap' });

const title = 'Overwatch — Autonomous security, installed and operated';
const description =
  'Autonomous patrol robots, custom control software, and WhatsApp and Telegram command channels — surveyed, installed, and provisioned on your site.';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title,
  description,
  openGraph: { title, description, type: 'website', siteName: 'Overwatch' },
  twitter: { card: 'summary_large_image', title, description },
};

export const viewport: Viewport = {
  themeColor: '#0a0a0a',
  colorScheme: 'dark',
};

// Set before first paint so [data-reveal] content is only hidden when JS can reveal it.
const jsFlag = `document.documentElement.setAttribute('data-js','')`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: jsFlag }} />
      </head>
      <body>{children}</body>
    </html>
  );
}

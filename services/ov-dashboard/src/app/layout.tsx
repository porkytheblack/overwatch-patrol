import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'OVERWATCH PATROL',
  description: 'Autonomous single-robot surveillance built on dimos.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500&family=JetBrains+Mono:wght@400;500&display=swap"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}

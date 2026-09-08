import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Tibo Alerts — a fresh start, without refreshing X',
  description:
    'Free, open-source Codex reset alerts by email and browser push. Announcement times, in your timezone.',
  manifest: '/manifest.webmanifest',
  icons: { icon: '/icon.svg', apple: '/icon-180.png' },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

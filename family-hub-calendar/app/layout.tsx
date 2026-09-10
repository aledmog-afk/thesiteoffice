import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Family Hub',
  description: 'Shared family calendar, chores, meals and lists.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // The wall tablet is a fixed-layout display; pinch-zooming it is always an
  // accident. Phones still get the browser's own accessibility zoom.
  maximumScale: 1,
  themeColor: '#0f172a',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-full bg-slate-100 text-slate-900 antialiased">{children}</body>
    </html>
  );
}

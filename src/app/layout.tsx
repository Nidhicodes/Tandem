import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Tandem',
  description: 'Trade in tandem with the best perp traders. One passkey, no seed phrase.',
  appleWebApp: { capable: true, title: 'Tandem', statusBarStyle: 'black-translucent' },
};

export const viewport: Viewport = {
  themeColor: '#07080c',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover', // draw under the notch; content is padded with safe-area insets
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-4 px-4 pb-[calc(env(safe-area-inset-bottom)+6rem)] pt-[calc(env(safe-area-inset-top)+1rem)]">
          {children}
        </main>
      </body>
    </html>
  );
}

import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Tandem',
  description: 'Trade in tandem with the best perp traders. One passkey, no seed phrase.',
  appleWebApp: { capable: true, title: 'Tandem', statusBarStyle: 'black-translucent' },
};

export const viewport: Viewport = { themeColor: '#0b0d12', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-4 px-5 py-8">{children}</main>
      </body>
    </html>
  );
}

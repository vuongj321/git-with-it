import type { Metadata } from 'next';
import { IBM_Plex_Mono, Newsreader, Source_Sans_3 } from 'next/font/google';
import { SessionProvider } from './session-provider';
import { Providers } from './providers';
import './globals.css';

const display = Newsreader({
  subsets: ['latin'],
  variable: '--font-display',
  weight: ['400', '600', '700'],
});

const sans = Source_Sans_3({
  subsets: ['latin'],
  variable: '--font-sans',
  weight: ['400', '500', '600'],
});

const mono = IBM_Plex_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  weight: ['400', '500'],
});

export const metadata: Metadata = {
  title: 'Git With It',
  description: 'Software evolution platform — metrics, graphs, and timelines',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} ${mono.variable}`}>
      <body>
        <SessionProvider>
          <Providers>{children}</Providers>
        </SessionProvider>
      </body>
    </html>
  );
}

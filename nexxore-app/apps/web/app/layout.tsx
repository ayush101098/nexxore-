import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import { SiteShell } from '@nexxore/ui';
import { RegimeBridge } from '@/components/RegimeBridge';
import { SITE } from '@/lib/site';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});

const mono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: {
    default: `${SITE.name} | Autonomous DeFi Execution Infrastructure`,
    template: `%s | ${SITE.name}`,
  },
  description: SITE.description,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // data-regime seeds the accent system on first paint; RegimeBridge keeps it
  // live from /v1/index/current (Prompt 05). Fonts feed the design tokens.
  return (
    <html
      lang="en"
      data-regime="transition"
      className={`${inter.variable} ${mono.variable}`}
    >
      <body className="bg-base font-sans text-fg-primary antialiased">
        <RegimeBridge>
          <SiteShell>{children}</SiteShell>
        </RegimeBridge>
      </body>
    </html>
  );
}

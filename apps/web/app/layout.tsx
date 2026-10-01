import type { Metadata, Viewport } from 'next';
import { IBM_Plex_Mono } from 'next/font/google';
import './globals.css';
import { PrivyGate } from '@/components/PrivyGate';
import { WalletProvider } from '@/components/WalletProvider';
import { fetchConfig } from '@/lib/api';

const mono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-mono',
  display: 'swap',
});

export async function generateMetadata(): Promise<Metadata> {
  const config = await fetchConfig();
  return {
    title: `${config.productName} — a passport and an account for every AI agent`,
    description: config.tagline.en,
    metadataBase: new URL(config.siteUrl),
    openGraph: {
      title: `${config.productName} — a passport and an account for every AI agent`,
      description: config.tagline.en,
      url: config.siteUrl,
      type: 'website',
      images: [{ url: '/og.png', width: 1200, height: 630 }],
    },
    twitter: {
      card: 'summary_large_image',
      title: `${config.productName} — a passport and an account for every AI agent`,
      description: config.tagline.en,
      images: ['/og.png'],
    },
  };
}

export const viewport: Viewport = {
  themeColor: '#f2f3ef',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={mono.variable}>
      <body>
        {/* Signs JavaScript in before anything paints, so scroll-reveal CSS
            only hides content on pages that can also show it again. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{if(!matchMedia('(prefers-reduced-motion: reduce)').matches)document.documentElement.classList.add('motion')}catch(e){}",
          }}
        />
        <PrivyGate>
          <WalletProvider>{children}</WalletProvider>
        </PrivyGate>
      </body>
    </html>
  );
}

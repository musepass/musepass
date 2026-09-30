import type { Metadata, Viewport } from 'next';
import { IBM_Plex_Mono } from 'next/font/google';
import './globals.css';
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
    title: `${config.productName} — a name every AI can carry`,
    description: config.tagline.en,
    metadataBase: new URL(config.siteUrl),
    openGraph: {
      title: config.productName,
      description: config.tagline.en,
      url: config.siteUrl,
      type: 'website',
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
        <WalletProvider>{children}</WalletProvider>
      </body>
    </html>
  );
}

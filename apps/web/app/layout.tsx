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
    title: `${config.productName} — 给每个 AI 一个可信的名字`,
    description: config.tagline.zh,
    metadataBase: new URL(config.siteUrl),
    openGraph: {
      title: config.productName,
      description: config.tagline.zh,
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
    <html lang="zh-CN" className={mono.variable}>
      <body>
        <WalletProvider>{children}</WalletProvider>
      </body>
    </html>
  );
}

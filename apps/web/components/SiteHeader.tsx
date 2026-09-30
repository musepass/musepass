import Link from 'next/link';
import type { PublicConfig } from '@/lib/api';
import { BrandMark } from './BrandMark';
import { WalletButton } from './WalletButton';

export function SiteHeader({
  config,
  expectedChainId,
}: {
  config: PublicConfig;
  /**
   * Which network the wallet should be on for this page. The site's own flows
   * run on the L2 that holds the names; the one-time setup page runs on
   * Ethereum mainnet, because that is where ENS lives. Defaulting to the L2
   * would tell a correctly connected owner that their network is wrong.
   */
  expectedChainId?: number;
}) {
  return (
    <header className="header">
      <Link href="/#top" className="brand">
        <BrandMark />
        <span className="brand-name">{config.productName}</span>
      </Link>
      <nav className="nav" aria-label="Main">
        <Link href="/#how">How it works</Link>
        <Link href="/#record">Track record</Link>
        <Link href="/#prompt">Paste into your AI</Link>
        <Link href="/#pricing">Pricing</Link>
        <Link href="/#faq">FAQ</Link>
        <WalletButton expectedChainId={expectedChainId ?? config.chain.chainId} />
      </nav>
    </header>
  );
}

import Link from 'next/link';
import type { PublicConfig } from '@/lib/api';
import { BrandMark } from './BrandMark';
import { WalletButton } from './WalletButton';

export function SiteHeader({
  config,
  expectedChainIds,
}: {
  config: PublicConfig;
  /**
   * Which networks this page can be used from. Most of the site runs on the L2
   * that holds the names; the one-time setup page runs on Ethereum mainnet, and
   * the name page needs both — the card lives on the L2, the primary name on
   * mainnet. Anything else is a genuine mistake and gets a warning.
   */
  expectedChainIds?: number[];
}) {
  return (
    <header className="header">
      <Link href="/#top" className="brand">
        <BrandMark />
        <span className="brand-name">{config.productName}</span>
      </Link>
      <nav className="nav" aria-label="Main">
        <Link href="/#how">How it works</Link>
        <Link href="/#use-cases">Use cases</Link>
        <Link href="/#pricing">Pricing</Link>
        <Link href="/docs">Docs</Link>
        <Link href="/trust">Trust</Link>
        <Link href="/my">My names</Link>
        <Link className="btn btn-sm btn-primary" href="/claim">
          Claim free
        </Link>
        {/* Wallet connect stays available but not first: most visitors arrive
            without a wallet, and the nav should not imply they need one. */}
        <WalletButton expectedChainIds={expectedChainIds ?? [config.chain.chainId]} />
      </nav>
    </header>
  );
}

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
      <nav className="nav" aria-label="主导航">
        <Link href="/#how">怎么注册</Link>
        <Link href="/#record">履历</Link>
        <Link href="/#prompt">粘给 AI</Link>
        <Link href="/#pricing">价格</Link>
        <Link href="/#faq">常见问题</Link>
        <WalletButton expectedChainId={expectedChainId ?? config.chain.chainId} />
      </nav>
    </header>
  );
}

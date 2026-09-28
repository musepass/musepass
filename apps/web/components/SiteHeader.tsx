import Link from 'next/link';
import type { PublicConfig } from '@/lib/api';
import { BrandMark } from './BrandMark';
import { WalletButton } from './WalletButton';

export function SiteHeader({ config }: { config: PublicConfig }) {
  return (
    <header className="header">
      <Link href="/#top" className="brand">
        <BrandMark />
        <span className="brand-name">{config.productName}</span>
      </Link>
      <nav className="nav" aria-label="主导航">
        <Link href="/#how">怎么注册</Link>
        <Link href="/#record">履历</Link>
        <Link href="/#pricing">价格</Link>
        <Link href="/#faq">常见问题</Link>
        <WalletButton expectedChainId={config.chain.chainId} />
      </nav>
    </header>
  );
}

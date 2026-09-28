import Link from 'next/link';
import type { PublicConfig } from '@/lib/api';

export function SiteFooter({ config }: { config: PublicConfig }) {
  return (
    <footer className="footer">
      <span>{config.legalDisclaimer.zh}</span>
      <nav aria-label="页脚">
        <Link href="/terms">服务条款</Link>
        <Link href="/privacy">隐私政策</Link>
        <Link href="/developers">开发者文档</Link>
      </nav>
    </footer>
  );
}

import Link from 'next/link';
import type { PublicConfig } from '@/lib/api';

export function SiteFooter({ config }: { config: PublicConfig }) {
  return (
    <footer className="footer">
      <span>{config.legalDisclaimer.zh}</span>
      <nav aria-label="页脚">
        <Link href="/verify">自己验证履历</Link>
        <Link href="/anchors">已锚定批次</Link>
        <Link href="/terms">服务条款</Link>
        <Link href="/privacy">隐私政策</Link>
        <Link href="/developers">开发者文档</Link>
      </nav>
    </footer>
  );
}

import Link from 'next/link';
import type { PublicConfig } from '@/lib/api';

export function SiteFooter({ config }: { config: PublicConfig }) {
  return (
    <footer className="footer">
      <span>{config.legalDisclaimer.en}</span>
      <nav aria-label="Footer">
        <Link href="/verify">Verify a record</Link>
        <Link href="/anchors">Anchored batches</Link>
        <Link href="/terms">Terms</Link>
        <Link href="/privacy">Privacy</Link>
        <Link href="/docs">Docs</Link>
        <Link href="/trust">Trust</Link>
      </nav>
    </footer>
  );
}

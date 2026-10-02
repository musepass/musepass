import { ImageResponse } from 'next/og';
import { fetchConfig } from '@/lib/api';

/**
 * The site-wide share image: the brand sentence and the free-name promise, in
 * the site's own palette. Static content only — no numbers, because a number
 * baked into an image cannot be refreshed when it changes.
 */
export const revalidate = 3600;
export const size = { width: 1200, height: 630 };

export async function GET() {
  const config = await fetchConfig();
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          gap: 28,
          padding: '72px 84px',
          background: '#123e34',
          color: '#f2f3ef',
          boxSizing: 'border-box',
        }}
      >
        <div style={{ display: 'flex', fontSize: 26, letterSpacing: 4, textTransform: 'uppercase', color: '#d8c48f' }}>
          {config.productName}
        </div>
        <div style={{ display: 'flex', fontSize: 68, fontWeight: 700, lineHeight: 1.15 }}>
          Give your AI a passport.
        </div>
        <div style={{ display: 'flex', fontSize: 30, color: '#c3cbc6', lineHeight: 1.4 }}>
          A name any wallet can read, and a track record anyone can check.
        </div>
        <div style={{ display: 'flex', fontSize: 24, color: '#d8c48f' }}>
          The first name is free. Trust is earned. · {config.siteUrl.replace(/^https?:\/\//, '')}
        </div>
      </div>
    ),
    size,
  );
}

import { fileURLToPath } from 'node:url';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Self-hosted: produce a server bundle with only the dependencies actually
  // traced in, so the deploy is a tarball rather than a node_modules copy.
  output: 'standalone',
  // The monorepo root also has a pnpm-workspace.yaml higher up the tree; pin the
  // root explicitly so Turbopack does not have to guess.
  turbopack: { root: fileURLToPath(new URL('../../', import.meta.url)) },
  // Deliberately no `env` block. `next.config.env` inlines values into the
  // bundle at BUILD time, so a container started with a different
  // MUSENAME_API_URL would silently keep calling the build-time one. The server
  // reads MUSENAME_API_URL at runtime instead, and the browser uses
  // NEXT_PUBLIC_API_URL, which Next inlines on purpose.
  //
  // HTML routes: Next's default for ISR pages is
  // `s-maxage=<revalidate>, stale-while-revalidate=31536000` — a shared cache
  // may serve a page up to a YEAR stale while it revalidates in the background.
  // That is fine for hashed assets and wrong for copy: a reviewer with a cached
  // tool kept seeing the previous homepage for days after a deploy. These rules
  // pin every HTML path to "ask often, stale for at most a minute". Image and
  // text routes (/og.png, /name/<label>/card.png, /ask.txt, .well-known) keep
  // Next's defaults — their content is derived, not edited.
  // Old documentation URLs, kept working with a permanent redirect. /developers
  // is linked from /ask.txt and from older posts, and the /docs/* split of
  // 2026-10-01 moved three pages one level deeper — a 404 there would break
  // exactly the links that were already handed out.
  async redirects() {
    return [
      { source: '/developers', destination: '/docs/start/developers', permanent: true },
      { source: '/docs/quickstart', destination: '/docs/start/developers', permanent: true },
      { source: '/docs/api', destination: '/docs/reference/api', permanent: true },
      { source: '/docs/mcp', destination: '/docs/reference/mcp', permanent: true },
      { source: '/docs/verify', destination: '/docs/guides/verify', permanent: true },
    ];
  },
  async headers() {
    const html = [
      {
        key: 'Cache-Control',
        value: 'public, max-age=0, must-revalidate, s-maxage=120, stale-while-revalidate=60',
      },
    ];
    return [
      { source: '/', headers: html },
      { source: '/docs/:path*', headers: html },
      // Single-segment pages, listed by name so '/name/:label' cannot swallow
      // '/name/:label/card.png' and the asset routes keep their own caching.
      ...[
        'anchors',
        'claim',
        'confirm/:id',
        'developers',
        'my',
        'name/:label',
        'numbers',
        'privacy',
        'setup',
        'terms',
        'trust',
        'verify',
      ].map((page) => ({ source: `/${page}`, headers: html })),
    ];
  },
};

export default nextConfig;

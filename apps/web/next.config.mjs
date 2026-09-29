import { fileURLToPath } from 'node:url';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // The monorepo root also has a pnpm-workspace.yaml higher up the tree; pin the
  // root explicitly so Turbopack does not have to guess.
  turbopack: { root: fileURLToPath(new URL('../../', import.meta.url)) },
  // Deliberately no `env` block. `next.config.env` inlines values into the
  // bundle at BUILD time, so a container started with a different
  // MUSENAME_API_URL would silently keep calling the build-time one. The server
  // reads MUSENAME_API_URL at runtime instead, and the browser uses
  // NEXT_PUBLIC_API_URL, which Next inlines on purpose.
};

export default nextConfig;

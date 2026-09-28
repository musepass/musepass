import { fileURLToPath } from 'node:url';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // The monorepo root also has a pnpm-workspace.yaml higher up the tree; pin the
  // root explicitly so Turbopack does not have to guess.
  turbopack: { root: fileURLToPath(new URL('../../', import.meta.url)) },
  env: {
    // Read by both the server and the client so the API URL is configured once.
    MUSENAME_API_URL: process.env.MUSENAME_API_URL ?? 'http://localhost:3001',
  },
};

export default nextConfig;

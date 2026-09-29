import { fetchConfig } from '@/lib/api';
import { buildWellKnown } from '@/lib/wellKnown';

/**
 * https://<domain>/.well-known/musename.json
 *
 * The binding a Web2 caller needs: this domain, this ENS root, this chain, this
 * registry, and how to verify a name without trusting the server that answered.
 * It is deliberately boring — no capability claims, and a `notVerified` list —
 * because a discovery document is exactly where products tend to overstate.
 */
export const revalidate = 3600;

export async function GET() {
  const config = await fetchConfig();
  return Response.json(buildWellKnown(config), {
    headers: {
      'cache-control': 'public, max-age=300, stale-while-revalidate=3600',
      'content-type': 'application/json; charset=utf-8',
    },
  });
}

import { fetchConfig } from '@/lib/api';
import { buildWellKnown } from '@/lib/wellKnown';

/**
 * https://<domain>/.well-known/musepass.json
 *
 * Same discovery document as the legacy /.well-known/musename.json, under the
 * current brand. The old address still serves the same bytes: it is quoted in
 * ask.txt versions people may have copied already, so it stays rather than
 * redirecting — a JSON reader should not have to follow a redirect to verify us.
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

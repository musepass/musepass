import { ASK_TXT } from '@/lib/agentPrompt';

/**
 * https://<domain>/ask.txt
 *
 * The file an AI reads by itself. Plain text, stable URL, no HTML to parse, no
 * JavaScript to run — the same idea as musefly.lol/muse.txt, and the reason the
 * prompt people copy stays short: the long version lives here, where an agent
 * can fetch it.
 */
export const dynamic = 'force-static';

export function GET() {
  return new Response(ASK_TXT, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=300',
    },
  });
}

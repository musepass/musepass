import { PrivyClient } from '@privy-io/server-auth';

/**
 * Server-side verification of Privy access tokens — the only thing the API
 * needs from Privy. It never creates wallets, signs or sends anything; those
 * stay with the client and the issuer.
 *
 * Configured through PRIVY_APP_ID / PRIVY_APP_SECRET. When they are absent the
 * feature reports as off and every Privy-dependent check degrades to "not
 * invited", which is the pre-Privy behaviour.
 */

export interface PrivyIdentity {
  privyUserId: string;
  /** Lowercased X username without @, when the user logged in with X. */
  xHandle: string | null;
  /** The embedded wallet address Privy created for this user, if any. */
  walletAddress: string | null;
}

export class PrivyAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PrivyAuthError';
  }
}

let cachedClient: PrivyClient | null | undefined;

function getClient(): PrivyClient | null {
  if (cachedClient !== undefined) return cachedClient;
  const appId = process.env.PRIVY_APP_ID;
  const appSecret = process.env.PRIVY_APP_SECRET;
  cachedClient = appId && appSecret ? new PrivyClient(appId, appSecret) : null;
  return cachedClient;
}

export function privyConfigured(): boolean {
  return getClient() !== null;
}

/**
 * Verifies an access token against Privy and returns the identity it carries.
 * Throws PrivyAuthError on anything that does not verify — the caller decides
 * whether that is a 401 (the auth endpoint) or just "no invitation" (claim).
 */
export async function verifyPrivyIdentity(accessToken: string): Promise<PrivyIdentity> {
  const privy = getClient();
  if (!privy) throw new PrivyAuthError('Privy is not configured');
  if (!accessToken || accessToken.length > 4096) throw new PrivyAuthError('Missing access token');

  let privyUserId: string;
  try {
    const claims = await privy.verifyAuthToken(accessToken);
    privyUserId = claims.userId;
  } catch (error) {
    throw new PrivyAuthError(
      `Access token did not verify: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  try {
    const user = await privy.getUser(privyUserId);
    const accounts = user.linkedAccounts ?? [];
    const xAccount = accounts.find((a) => a.type === 'twitter_oauth') as
      | { username?: string }
      | undefined;
    const xHandle = (xAccount?.username ?? '').replace(/^@/, '').toLowerCase() || null;
    // user.wallet is the embedded wallet when one exists; a linked external
    // wallet never counts as the identity's own wallet.
    const walletAddress = user.wallet?.address ?? null;
    return { privyUserId, xHandle, walletAddress };
  } catch (error) {
    throw new PrivyAuthError(
      `Privy user could not be read: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

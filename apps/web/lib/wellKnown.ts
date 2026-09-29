import type { PublicConfig } from './api';

/**
 * The document a Web2 integrator finds without reading our documentation.
 *
 * The plan in docs/plans/web2-side-2026-09-29.md argues that the buyers here
 * are Web2 systems — a merchant, a market, a fraud desk — and that they arrive
 * through the domain, not through a chain explorer. So the domain publishes
 * what it is bound to: which ENS root, which chain, which registry, where the
 * API lives, and how to check a name without trusting this server.
 *
 * Two rules keep it honest:
 *
 *   1. Everything is either config (a brand rename stays a config change) or a
 *      chain fact that apps/web/test/wellKnown.test.ts compares against
 *      deployments/robinhood.json on every test run. A hardcoded address that
 *      drifts from the deployment record fails the build.
 *   2. It states what is *not* verified. A discovery document that only lists
 *      capabilities is marketing; this one carries the caveats, because the
 *      promise of the product is that the record says what is true.
 */
export interface WellKnownDocument {
  $comment: string;
  service: string;
  site: string;
  rootEnsName: string;
  api: { base: string; nameLookup: string; namePage: string };
  chain: {
    name: string;
    chainId: number;
    registry: string | null;
    registrar: string | null;
    explorer: string | null;
  };
  gateway: string;
  verification: {
    summary: string;
    steps: Array<{ what: string; how: string }>;
    offlineVerifier: string;
  };
  publishedFields: string;
  notVerified: Array<{ claim: string; why: string }>;
  contact: string;
  legalDisclaimer: { zh: string; en: string };
}

/**
 * The gateway host is baked into the L1 resolver's constructor arguments, so it
 * cannot come from config without risking a mismatch. deployments/robinhood.json
 * is the source of truth and the test compares this against it.
 */
export const GATEWAY_URL = 'https://gw.musename.xyz';

export function buildWellKnown(config: PublicConfig): WellKnownDocument {
  const site = config.siteUrl.replace(/\/$/, '');
  return {
    $comment:
      'Discovery document for Web2 callers. Everything factual here is verifiable from the chain; see the verification steps. Built from config plus the deployment record.',
    service: config.productName,
    site,
    rootEnsName: config.rootName,
    api: {
      base: `${site}/v1`,
      nameLookup: `${site}/v1/names/{name}`,
      namePage: `${site}/name/{label}`,
    },
    chain: {
      name: config.chain.name,
      chainId: config.chain.chainId,
      registry: config.l2Registry,
      registrar: config.registrar,
      explorer: config.chain.explorer,
    },
    gateway: GATEWAY_URL,
    verification: {
      summary:
        'A name is a subname of an ENS root. The L2 registry answers who owns it, and the card is an ENS text record, so its hash can be recomputed from the raw bytes.',
      steps: [
        {
          what: 'Who owns the name right now',
          how: `cast call ${config.l2Registry ?? '<registry>'} "owner(bytes32)(address)" <node> --rpc-url <l2 rpc>  # node = makeNode(baseNode, label)`,
        },
        {
          what: 'That the card you were served is the card on chain',
          how: 'read the text record with key musename.card, recompute the content hash, and compare it with the contentHash in the API response',
        },
        {
          what: 'That a batch of records existed at a point in time',
          how: 'read the anchor transaction calldata (tag, merkle root, count, timestamp) and recompute the root over the records you were given',
        },
      ],
      offlineVerifier: `${site}/verify`,
    },
    publishedFields:
      'Card fields are per-field opt-in. The API serves only what the owner published; anything absent was never made public.',
    notVerified: [
      {
        claim: 'the operator behind a name',
        why: 'We do not run identity or business verification. An unverified operator is not a verified one, and nothing here says otherwise.',
      },
      {
        claim: 'an independent verdict',
        why: 'The only verifier today is our own engine, from the same team. Calling that independent would be false.',
      },
      {
        claim: 'an on-chain record contract',
        why: 'Records are not in a contract yet; there is one merkle-root anchor inside a zero-value transaction. See the trust model.',
      },
    ],
    contact: config.supportEmail,
    legalDisclaimer: config.legalDisclaimer,
  };
}

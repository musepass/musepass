import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { cors } from 'hono/cors';
import type { Address, Hex } from 'viem';
import {
  CARD_TEXT_KEY,
  applyVisibility,
  buildEip712Domain,
  cardContentHash,
  cardDataUri,
  cardTextSignaturePayload,
  checkClaimQuota,
  checkLabel,
  defaultVisibility,
  envelopeContentHash,
  findInvitation,
  invitedShortNameDecision,
  INVITED_MAX_UNITS,
  isMusePassError,
  labelFromFullName,
  namehash,
  normalizeLabel,
  parseCardDataUri,
  quotePurchase,
  registerMessage,
  toBaseUnits,
  validateCard,
  verifyCardTextSignature,
  verifyRegisterSignature,
  type BilingualText,
  type Invitation,
  type LabelIssue,
  type VisibilityMap,
} from '@musename/core';
import { isAddress } from 'viem';
import type { ChainReader, MusenameDeps } from './deps.js';
import { privyConfigured, verifyPrivyIdentity } from './auth/privy.js';
import { createLogger, requestObservability, type Logger } from './observability.js';

export interface ApiMeta {
  asOf: string;
  chain: string;
  chainId: number;
  verified: boolean;
  root: string;
}

interface RateBucket {
  count: number;
  resetAt: number;
}

/** Turn any internal name into the label the registry expects. */
function toLabel(raw: string, rootName: string): string {
  const decoded = decodeURIComponent(raw).trim();
  if (decoded.toLowerCase().endsWith(`.${rootName.toLowerCase()}`)) {
    return labelFromFullName(decoded, rootName).normalized;
  }
  return normalizeLabel(decoded).normalized;
}

function boom(
  code: string,
  message: string,
  summary: BilingualText,
): { code: string; message: string; summary: BilingualText } {
  return { code, message, summary };
}

export function createApp(deps: MusenameDeps) {
  const { config, reservedIndex, chain, names, requests, cards, sponsorship, invitationClaims, purchases, certificationIntents, indexKind, clock } = deps;
  const app = new Hono();
  const buckets = new Map<string, RateBucket>();

  const logger: Logger = deps.logger ?? createLogger();
  app.use('*', requestObservability(logger));

  // The web app runs on its own origin, so the API has to say who may call it.
  // The list comes from config (brand site URL plus local dev ports) and can be
  // overridden with MUSENAME_ALLOWED_ORIGINS.
  const allowedOrigins = new Set(config.allowedOrigins);
  app.use(
    '/v1/*',
    cors({
      origin: (origin) => (origin && allowedOrigins.has(origin) ? origin : null),
      allowMethods: ['GET', 'POST', 'OPTIONS'],
      allowHeaders: ['Content-Type'],
      maxAge: 600,
    }),
  );

  /** Tokens are stored only as a hash: a database leak must not hand out confirm links. */
  const hashToken = (token: string): string =>
    createHash('sha256').update(token).digest('hex');

  const meta = (verified: boolean): ApiMeta => ({
    asOf: clock().toISOString(),
    chain: config.chains.l2.name,
    chainId: config.chains.l2.chainId,
    verified,
    root: config.brand.rootName,
  });

  const registrarAddress = (config.chains.l2.registrar ?? '') as Address | '';
  const eip712Domain = registrarAddress
    ? buildEip712Domain({
        productName: config.brand.productName,
        chainId: config.chains.l2.chainId,
        verifyingContract: registrarAddress,
      })
    : null;

  function rateLimit(c: Context, key: string, limitPerHour: number): boolean {
    const now = clock().getTime();
    const bucketKey = `${key}`;
    const bucket = buckets.get(bucketKey);
    if (!bucket || bucket.resetAt <= now) {
      buckets.set(bucketKey, { count: 1, resetAt: now + 60 * 60 * 1000 });
      return true;
    }
    if (bucket.count >= limitPerHour) return false;
    bucket.count += 1;
    return true;
  }

  /**
   * D17: the invitation as it stands *now* — the config row, overridden by the
   * spend record if the wallet already used it. The database wins over the
   * config file so that pushing a fresh config can never revive a used
   * invitation.
   */
  async function invitationFor(wallet: string): Promise<Invitation | null> {
    const row = findInvitation(config.invitations.invitations, { wallet });
    let claim = null;
    try {
      claim = await invitationClaims.findByWallet(wallet as Address);
    } catch {
      // A short name should not become claimable because our own index is
      // down; fall through with the config row only, which is the stricter view.
    }
    if (!claim) return row;
    return {
      ...row,
      wallet: row?.wallet ?? wallet,
      claimedAt: claim.claimedAt.toISOString(),
      claimedLabel: claim.claimedLabel,
      txHash: claim.txHash,
    };
  }

  /**
   * D18: the genesis cover numbers the first 1,000 names that published a card,
   * in the order the registrar registered them. Nothing is minted and nothing
   * is stored: the number is a derived view of two chain facts — the
   * NameRegistered order and whether a card text record exists — so the day
   * the list is worth checking, anyone can recompute it from the chain.
   *
   * Cached for five minutes, like the event scan it reads. The card check is
   * one read per registered name per refresh, which is fine at the current
   * scale and needs an index before it is fine at a thousand.
   */
  const GENESIS_COVER_CAPACITY = 1000;
  let genesisCache: {
    numbered: Array<{ label: string; number: number }>;
    byLabel: Map<string, number>;
    expiresAt: number;
  } | null = null;

  async function genesisCover() {
    if (genesisCache && genesisCache.expiresAt > Date.now()) return genesisCache;
    const registered = [...(await chain.listNames())].sort(
      (a, b) => a.blockNumber - b.blockNumber,
    );
    const numbered: Array<{ label: string; number: number }> = [];
    const byLabel = new Map<string, number>();
    for (const entry of registered) {
      if (numbered.length >= GENESIS_COVER_CAPACITY) break;
      let hasCard = false;
      try {
        hasCard = Boolean(await chain.readText(entry.label, CARD_TEXT_KEY));
      } catch {
        // An unreadable record is treated as no card, same as the name page.
        hasCard = false;
      }
      if (!hasCard) continue;
      const number = numbered.length + 1;
      numbered.push({ label: entry.label, number });
      byLabel.set(entry.label, number);
    }
    genesisCache = { numbered, byLabel, expiresAt: Date.now() + 5 * 60 * 1000 };
    return genesisCache;
  }

  app.get('/healthz', (c) =>
    c.json({
      status: 'ok',
      asOf: clock().toISOString(),
      chain: config.chains.l2.name,
      registrarConfigured: Boolean(registrarAddress),
    }),
  );

  /* ------------------------------------------------------------------ */
  /* GET /v1/config                                                      */
  /* ------------------------------------------------------------------ */
  /**
   * Everything a front end needs to render brand text, build the EIP-712
   * domain and show prices. Published so the front end never hardcodes a brand
   * name, a root name or a price: renaming the product stays a config change.
   */
  app.get('/v1/config', (c) => {
    const { brand, chains, pricing, limits } = config;
    return c.json({
      summary: {
        zh: `这是 ${brand.productName} 的公开配置。`,
        en: `Public configuration for ${brand.productName}.`,
      },
      data: {
        productName: brand.productName,
        tagline: brand.tagline,
        rootName: brand.rootName,
        siteUrl: brand.siteUrl,
        supportEmail: brand.supportEmail,
        legalDisclaimer: brand.legalDisclaimer,
        exampleLabel: brand.naming.exampleLabel,
        chain: {
          name: chains.l2.name,
          chainId: chains.l2.chainId,
          explorer: chains.l2.explorer ?? null,
        },
        registrar: registrarAddress || null,
        l2Registry: chains.l2.l2Registry ?? null,
        usdc: chains.l2.usdc ?? null,
        payment: (() => {
          // D19: only publish payment facts when the rail is actually enabled.
          const purchase = pricing.purchase;
          if (!purchase?.enabled) return null;
          return {
            currency: purchase.currency,
            token: purchase.token,
            tokenDecimals: purchase.tokenDecimals,
            treasury: purchase.treasury,
            quoteTtlMinutes: purchase.quoteTtlMinutes,
            additionalNameEnabled: purchase.additionalNameEnabled,
            additionalNameUsd: pricing.additionalName?.priceUsd ?? null,
          };
        })(),
        pricing: {
          currency: pricing.currency,
          freeMinUnits: pricing.freeTier.minUnits,
          lengthMetric: limits.lengthMetric,
          premiumTiers: pricing.premiumTiers.map((tier) => ({
            id: tier.id,
            minUnits: tier.minCodePoints,
            maxUnits: tier.maxCodePoints,
            priceUsd: tier.priceUsd,
            // D19: only the 4-character tier is sellable, and only while the
            // purchase rail is enabled. Tiers 1–3 stay project-reserved.
            sellable:
              tier.maxCodePoints === 4 &&
              tier.status !== 'placeholder' &&
              Boolean(pricing.purchase?.enabled),
          })),
          certificationMonthlyUsd: pricing.certification.monthlyUsd,
        },
        limits: {
          freeNamesPerWallet: limits.freeNamesPerWallet,
          minLabelUnits: limits.minLabelUnitsPremium,
          maxLabelBytes: limits.maxLabelBytes,
          confirmTokenTtlMinutes: limits.registrationRequest.confirmTokenTtlMinutes,
        },
        // Honest feature flags: the front end must not promise what is not built.
        features: {
          cards: false,
          trackRecord: false,
          // Derived from config (D19), not hardcoded: it is true exactly when
          // the purchase routes above are open for business.
          premiumPurchase: Boolean(pricing.purchase?.enabled),
          aiRegistration: true,
        },
      },
      errors: [],
      meta: meta(false),
    });
  });

  /* ------------------------------------------------------------------ */
  /* GET /v1/names/{name}/available                                      */
  /* ------------------------------------------------------------------ */
  app.get('/v1/metrics', async (c) => {
    /**
     * The public scoreboard, and the honest part of it: the numbers below are
     * the ones this service can actually compute. Everything it cannot measure
     * yet is listed in `notMeasured` with the reason, because a dashboard that
     * quietly omits half the picture is the same failure mode as an overstated
     * homepage.
     *
     * Source: our index, not the chain. The chain has the final word on who owns
     * a name; these counts describe what this service has seen and served.
     */
    /**
     * Two sources, labelled. The chain decides how many names exist; the index
     * only knows what this service saw, and can legitimately be empty (a memory
     * index is emptied by a restart). The earlier version of this endpoint
     * counted the index alone, which would have published "0 names" while the
     * chain held one.
     */
    const rows = await names.listAll();
    let chainNames: Awaited<ReturnType<ChainReader['listNames']>> = [];
    let chainError: string | null = null;
    try {
      chainNames = await chain.listNames();
    } catch (error) {
      // A scoreboard that cannot reach the chain must say so, not report zero.
      chainError = error instanceof Error ? error.message.slice(0, 120) : String(error).slice(0, 120);
    }
    const byTier: Record<string, number> = { free: 0, premium: 0, enterprise: 0 };
    const byChannel: Record<string, number> = { web: 0, mcp: 0 };
    const byStatus: Record<string, number> = { active: 0, expired: 0, reserved: 0 };

    let withCard = 0;
    let firstRegisteredAt: string | null = null;
    for (const row of rows) {
      byTier[row.tier] = (byTier[row.tier] ?? 0) + 1;
      byChannel[row.registeredVia] = (byChannel[row.registeredVia] ?? 0) + 1;
      byStatus[row.status] = (byStatus[row.status] ?? 0) + 1;
      const stamp = row.registeredAt.toISOString();
      if (firstRegisteredAt === null || stamp < firstRegisteredAt) firstRegisteredAt = stamp;
      const versions = await cards.listVersions(row.id);
      if (versions.length > 0) withCard += 1;
    }

    const chainCount = chainNames.length;
    const indexedOwners = new Set(rows.map((row) => row.ownerAddress.toLowerCase()));
    const ownersOnChain = new Set(chainNames.map((entry) => entry.owner.toLowerCase()));

    // The giveaway budget, published: the caps are rules, and the usage is one
    // query against the sponsorship ledger. If a cap is near, this is where a
    // stranger can see it before the claim endpoint starts refusing.
    const startOfDay = new Date(clock());
    startOfDay.setUTCHours(0, 0, 0, 0);
    const sevenDaysAgo = new Date(startOfDay.getTime() - 7 * 24 * 60 * 60 * 1000);
    const [sponsoredToday, sponsoredLifetime, purchaseTotals, certIntents, certIntentsRecent] = await Promise.all([
      sponsorship.countPlatformSince(startOfDay),
      sponsorship.countPlatformLifetime(),
      purchases.purchaseTotals(),
      certificationIntents.countAll().catch(() => null),
      certificationIntents.countSince(sevenDaysAgo).catch(() => null),
    ]);

    // Fourteen UTC day buckets ending today, zero-filled. Computed from the
    // index rows above, so it inherits their honesty label: with a memory index
    // it describes this process, not the chain.
    const daily: { date: string; registrations: number }[] = [];
    const todayUtc = new Date(clock());
    todayUtc.setUTCHours(0, 0, 0, 0);
    const dayMs = 24 * 60 * 60 * 1000;
    for (let offset = 13; offset >= 0; offset -= 1) {
      const bucket = new Date(todayUtc.getTime() - offset * dayMs);
      daily.push({ date: bucket.toISOString().slice(0, 10), registrations: 0 });
    }
    const dailyIndex = new Map(daily.map((entry, i) => [entry.date, i]));
    for (const row of rows) {
      const key = row.registeredAt.toISOString().slice(0, 10);
      const i = dailyIndex.get(key);
      if (i !== undefined) daily[i].registrations += 1;
    }

    return c.json(
      {
        summary: {
          zh: chainError
            ? `链上暂时读不到名字数量；索引里有 ${rows.length} 条。`
            : `链上 ${chainCount} 个名字，索引里 ${rows.length} 条（其中 ${withCard} 个发布了名片）。`,
          en: chainError
            ? `The chain count is unavailable right now; the index holds ${rows.length} rows.`
            : `${chainCount} names on chain, ${rows.length} rows in the index (${withCard} with a published card).`,
        },
        data: {
          /** What the chain says. This is the number a stranger can verify. */
          chain: {
            names: chainError ? null : chainCount,
            firstRegisteredBlock: chainNames[0]?.blockNumber ?? null,
            owners: ownersOnChain.size,
            error: chainError,
            howToCheck: 'read the registrar NameRegistered events, or run `pnpm snapshot:names`',
          },
          /** What this service has indexed. Useful, but not the truth about the world. */
          index: {
            kind: indexKind,
            names: rows.length,
            owners: indexedOwners.size,
            ...(indexKind === 'memory'
              ? {
                  warning:
                    'a memory index is emptied by a restart, so these counts describe this process, not the chain',
                }
              : {}),
          },
          namesWithCard: withCard,
          /** Paid purchases: settled quotes only. Open quotes are not revenue. */
          purchases: {
            settled: purchaseTotals.count,
            revenueUsd: purchaseTotals.totalUsd,
            currency: config.pricing.purchase?.currency ?? 'USDG',
            lastSettledAt: purchaseTotals.lastSettledAt?.toISOString() ?? null,
            note: 'settled purchases only; a quote that expired or failed is not counted',
          },
          /** Registrations per UTC day, last 14 days, from the same index as above. */
          dailyRegistrations: daily,
          /** Demand for the unbuilt certification tier. Counts only, never contacts. */
          certificationIntents: {
            total: certIntents,
            last7Days: certIntentsRecent,
            note: 'sign-ups to be told when certification opens; contacts are not published',
          },
          /** The free-name giveaway: caps and how much of them is spent. */
          budget: {
            freeNamesTotalCap: config.limits.freeNamesTotalCap,
            sponsoredToday,
            platformPerDay: config.limits.sponsorship.platformPerDay,
            sponsoredLifetime,
            estimatedSpentUsd: Number(
              (sponsoredLifetime * config.limits.sponsorship.estimatedGasUsdPerName).toFixed(2),
            ),
            totalCapUsd: config.limits.sponsorship.platformTotalCapUsd,
            note: 'free claims pause when the count cap or the USD cap is reached; both are published here',
          },
          byTier,
          byChannel,
          byStatus,
          firstRegisteredAt,
          /** Anything a token story would want and this service cannot prove yet. */
          /** Anything a token story would want and this service cannot prove yet. */
          notMeasured: [
            {
              id: 'queries_by_others',
              metric: 'queries by anyone other than us',
              why: 'we do not count API or MCP calls by caller yet, and self-tests would inflate it',
            },
            {
              id: 'records',
              metric: 'records and their verdicts',
              why: 'the record registry is written and tested but not deployed, so there is nothing to read',
            },
            {
              id: 'external_verifier_records',
              metric: 'records issued by an outside verifier',
              why: 'the only verifier today is our own engine; calling that independent would be false',
            },
            {
              id: 'unique_users',
              metric: 'unique users',
              why: 'a name is a wallet address, and one person can hold many; counting them as people would be a guess',
            },
          ],
        },
        errors: [],
        meta: meta(false),
      },
      200,
      { 'cache-control': 'public, max-age=60' },
    );
  });

  /**
   * Which names a wallet owns.
   *
   * The chain already knows, and the event scan behind `listNames` is cached for
   * five minutes, so this is a filter rather than a new source of truth. It
   * exists because a name you cannot find again is a name you cannot use: before
   * this, the only way back to a name was to remember its label.
   */
  app.get('/v1/names', async (c) => {
    const owner = (c.req.query('owner') ?? '').trim();
    if (!isAddress(owner)) {
      return c.json(
        {
          summary: {
            zh: '需要一个钱包地址（0x… 40 位十六进制）才能列出名字。',
            en: 'I need a wallet address (0x…, 40 hex characters) to list names.',
          },
          errors: [
            boom('BAD_OWNER', 'owner must be an address', {
              zh: '地址格式不对。',
              en: 'That address is not valid.',
            }),
          ],
          meta: meta(false),
        },
        400,
      );
    }

    try {
      const all = await chain.listNames();
      const mine = all
        .filter((entry) => entry.owner.toLowerCase() === owner.toLowerCase())
        .map((entry) => ({
          label: entry.label,
          fullName: `${entry.label}.${config.brand.rootName}`,
          owner: entry.owner,
          txHash: entry.txHash,
          blockNumber: entry.blockNumber,
        }));

      return c.json(
        {
          summary: {
            zh: mine.length > 0 ? `这个钱包有 ${mine.length} 个名字。` : '这个钱包还没有名字。',
            en:
              mine.length > 0
                ? `This wallet holds ${mine.length} name(s).`
                : 'This wallet does not hold a name yet.',
          },
          data: { owner, count: mine.length, names: mine, rootName: config.brand.rootName },
          errors: [],
          meta: meta(true),
        },
        200,
        { 'cache-control': 'public, max-age=60' },
      );
    } catch (error) {
      // Read-only, and the message says what happened rather than guessing.
      return c.json(
        {
          summary: {
            zh: '链上暂时读不到，稍后再试。',
            en: 'The chain could not be read just now; try again shortly.',
          },
          errors: [
            boom('CHAIN_ERROR', error instanceof Error ? error.message : 'chain read failed', {
              zh: '链上暂时读不到。',
              en: 'The chain could not be read.',
            }),
          ],
          meta: meta(false),
        },
        502,
      );
    }
  });

  /**
   * D17, in public: how many invitations exist and how many are spent.
   *
   * Counts only. The list itself — which wallets, which X handles — is the one
   * thing this endpoint must never return: publishing it would tell everyone
   * who was considered worth inviting, and would hand spammers a target list.
   * The claim count comes from the spend ledger, not from the config file, so
   * pushing a fresh config cannot change history.
   */
  app.get('/v1/invitations', async (c) => {
    const rows = config.invitations.invitations.filter((row) => !row.$example);
    const claimedInConfig = new Set(
      rows.filter((row) => row.claimedAt).map((row) => (row.wallet ?? '').trim().toLowerCase()),
    );
    let spent: string[];
    try {
      spent = await invitationClaims.listClaimedWallets();
    } catch {
      spent = [];
    }
    const claimed = new Set([...claimedInConfig, ...spent.map((wallet) => wallet.toLowerCase())]);

    const issued = rows.length;
    const claimedCount = claimed.size;

    return c.json(
      {
        summary: {
          zh: `这次邀请一共 ${issued} 个名额，已经用掉 ${claimedCount} 个。`,
          en: `This campaign has ${issued} invitations and ${claimedCount} of them are spent.`,
        },
        data: {
          campaign: config.invitations.campaign ?? null,
          opens: config.invitations.opens ?? null,
          closes: config.invitations.closes ?? null,
          issued,
          claimed: claimedCount,
          remaining: Math.max(issued - claimedCount, 0),
          rule: config.invitations.rules?.freeLabelUnits ?? null,
          /** The spend ledger is part of the index, so the count says which one. */
          claimsSource: indexKind,
          noteEn: 'Counts only. The invited wallets and handles are not published, on purpose.',
          noteZh: '只公开数量。受邀钱包与 handle 名单有意不公开。',
        },
        errors: [],
        meta: meta(false),
      },
      200,
      { 'cache-control': 'public, max-age=60' },
    );
  });

  /**
   * Certification is designed, not running (phase 5, $5/month decided). This
   * endpoint exists so demand can register itself while it is honest to ask:
   * an email is stored, nothing is charged, and no promise of a launch date is
   * made. Contacts stay private — only counts are published via /v1/metrics.
   */
  app.post('/v1/certification/intent', async (c) => {
    const ip = (c.req.header('x-forwarded-for') ?? '').split(',')[0].trim();
    if (ip && !rateLimit(c, `cert-intent:${ip}`, config.limits.rateLimits.certificationIntentsPerHourPerIp)) {
      return c.json(
        {
          summary: {
            zh: '这个 IP 提交得太频繁，一小时后再试。',
            en: 'Too many sign-ups from this address; try again in an hour.',
          },
          errors: [
            boom('RATE_LIMITED', 'too many certification intent submissions from this IP', {
              zh: '提交太频繁，稍后再试。',
              en: 'Too many submissions; try again later.',
            }),
          ],
          meta: meta(false),
        },
        429,
      );
    }

    const body = await c.req.json().catch(() => null) as { contact?: unknown; note?: unknown } | null;
    const contact = typeof body?.contact === 'string' ? body.contact.trim() : '';
    const note = typeof body?.note === 'string' ? body.note.trim().slice(0, 500) : null;

    const emailShape = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailShape.test(contact) || contact.length > 254) {
      return c.json(
        {
          summary: {
            zh: '需要一个看起来像邮箱的联系方式。',
            en: 'A contact that looks like an email address is required.',
          },
          errors: [
            boom('INVALID_CONTACT', 'contact must be an email address', {
              zh: '联系方式必须是邮箱。',
              en: 'The contact must be an email address.',
            }),
          ],
          meta: meta(false),
        },
        422,
      );
    }

    await certificationIntents.insert({ contact, note });
    const total = await certificationIntents.countAll();
    return c.json(
      {
        summary: {
          zh: `已登记。认证上线时会通知你。目前共 ${total} 人登记。`,
          en: `Signed up. You will be told when certification opens. ${total} people are on the list so far.`,
        },
        data: { ok: true, totalIntents: total },
        errors: [],
        meta: meta(false),
      },
      201,
    );
  });

  /**
   * The genesis cover list, so anyone can check the ordering without trusting
   * a name page: labels in registration order, numbered from 1, capped at the
   * first 1,000 that published a card.
   */
  app.get('/v1/genesis', async (c) => {
    let cover;
    try {
      cover = await genesisCover();
    } catch (error) {
      return c.json(
        {
          summary: {
            zh: '链上暂时读不到，封面编号查不了，稍后再试。',
            en: 'The chain could not be read just now; the cover numbers are unavailable.',
          },
          errors: [
            boom('CHAIN_UNAVAILABLE', error instanceof Error ? error.message : String(error), {
              zh: '链上暂时读不到。',
              en: 'The chain could not be read.',
            }),
          ],
          meta: meta(false),
        },
        502,
      );
    }
    return c.json(
      {
        summary: {
          zh: `创世封面已发出 ${cover.numbered.length} 个编号（上限 ${GENESIS_COVER_CAPACITY}）。`,
          en: `${cover.numbered.length} genesis cover numbers issued so far (capacity ${GENESIS_COVER_CAPACITY}).`,
        },
        data: {
          capacity: GENESIS_COVER_CAPACITY,
          numberedCount: cover.numbered.length,
          numbered: cover.numbered,
          ordering:
            'NameRegistered event order (ascending block number); a name is numbered only after it published a card',
          noteEn:
            'A derived view of chain facts, recomputed from the registrar events and the card text records; nothing is minted.',
        },
        errors: [],
        meta: meta(true),
      },
      200,
      { 'cache-control': 'public, max-age=60' },
    );
  });

  app.get('/v1/names/:name/available', async (c) => {
    const rawName = c.req.param('name');
    const limit = config.limits.rateLimits.availabilityPerMinutePerIp;
    const ip = c.req.header('x-forwarded-for') ?? 'local';
    if (!rateLimit(c, `availability:${ip}`, limit * 60)) {
      return c.json(
        {
          summary: {
            zh: '查询太频繁了，请稍后再试。',
            en: 'Too many lookups; please retry shortly.',
          },
          errors: [boom('RATE_LIMITED', 'availability rate limit exceeded', {
            zh: '查询太频繁了，请稍后再试。',
            en: 'Too many lookups; please retry shortly.',
          })],
          meta: meta(false),
        },
        429,
      );
    }

    let label: string | null = null;
    let onChainFree: boolean | null = null;
    let chainError: string | null = null;

    try {
      label = toLabel(rawName, config.brand.rootName);
      onChainFree = await chain.isLabelAvailable(label);
    } catch (error) {
      if (isMusePassError(error) && error.code !== 'INVALID_CONFIG') {
        label = null;
      } else {
        chainError = error instanceof Error ? error.message : String(error);
      }
    }

    // D17: with ?owner=0x… the answer says whether *this wallet* may take the
    // name, which is what the claim page needs for a 3–4 character name.
    const ownerQuery = (c.req.query('owner') ?? '').trim();
    if (ownerQuery && !isAddress(ownerQuery)) {
      return c.json(
        {
          summary: {
            zh: 'owner 参数需要一个钱包地址（0x… 40 位十六进制）。',
            en: 'The owner parameter must be a wallet address (0x…, 40 hex characters).',
          },
          errors: [
            boom('BAD_OWNER', 'owner must be an address', {
              zh: '地址格式不对。',
              en: 'That address is not valid.',
            }),
          ],
          meta: meta(false),
        },
        400,
      );
    }
    const invitation = ownerQuery ? await invitationFor(ownerQuery) : null;

    // D17, the X side: an invitation can name an X handle instead of a wallet.
    // This lookup is display-only — the authoritative check happens at claim
    // time against a verified Privy access token.
    const xQuery = (c.req.query('x') ?? '').trim().replace(/^@/, '').toLowerCase();
    const handleInvitation =
      !invitation && xQuery && /^[a-z0-9_]{1,30}$/.test(xQuery)
        ? findInvitation(config.invitations.invitations, { xHandle: xQuery })
        : null;
    const effectiveInvitation = invitation ?? handleInvitation;

    const result = checkLabel(label ?? rawName, { config, reservedIndex, onChainFree, invitation: effectiveInvitation });
    const invited =
      (ownerQuery || handleInvitation) && result.units !== null
        ? invitedShortNameDecision(effectiveInvitation, result.units).allowed
        : null;

    // D19: what the same wallet would pay if it bought the name instead of
    // claiming it. Display-only, like `invited`; the authoritative quote comes
    // from POST /v1/names/purchase/quote.
    let purchase: { kind: string; priceUsd: number } | null = null;
    if (ownerQuery && result.units !== null && config.pricing.purchase?.enabled) {
      const ownerHasName = (await names.listByOwner(ownerQuery as Address)).length > 0;
      const purchaseQuote = quotePurchase(result.units, ownerHasName, config.pricing);
      // 'free-first' is not an offer to buy — showing it here would put a $0
      // price next to "use the claim flow".
      if (purchaseQuote && purchaseQuote.kind !== 'free-first') {
        purchase = { kind: purchaseQuote.kind, priceUsd: purchaseQuote.priceUsd };
      }
    }

    let suggestions: string[] = [];
    if (!result.policyOk || result.available === false) {
      const base = result.label ?? 'name';
      suggestions = [];
      for (const candidate of [
        ...Array.from({ length: 8 }, (_unused, index) => `${base}${index + 1}`),
        `${base}-${config.brand.naming.exampleLabel}`,
        `the${base}`,
      ]) {
        if (suggestions.length >= 3) break;
        try {
          const normalized = normalizeLabel(candidate).normalized;
          const check = checkLabel(normalized, { config, reservedIndex });
          if (!check.policyOk) continue;
          if (await chain.isLabelAvailable(normalized)) suggestions.push(normalized);
        } catch {
          continue;
        }
      }
    }

    return c.json({
      summary: result.summary,
      data: {
        label: result.label,
        fullName: result.fullName,
        available: result.available,
        policyOk: result.policyOk,
        onChainFree: result.onChainFree,
        price: result.price,
        units: result.units,
        reserved: result.reserved
          ? { category: result.reserved.category, appealable: result.reserved.appealable }
          : null,
        invited,
        purchase,
        suggestions,
      },
      errors: result.issues.map((issue: LabelIssue) => ({
        code: issue.code,
        message: issue.message,
      })),
      meta: meta(chainError === null && result.onChainFree !== null),
      ...(chainError ? { chainError } : {}),
    });
  });

  /* ------------------------------------------------------------------ */
  /* GET /v1/names/{name}                                                */
  /* ------------------------------------------------------------------ */

  /* ------------------------------------------------------------------ */
  /* PUT /v1/names/{name}/card                                           */
  /* ------------------------------------------------------------------ */
  /**
   * Card version history. The chain holds every version — the resolver writes
   * text records into versioned storage — but reading that back is awkward, so
   * this lists what was published through us. It says so when the name is not
   * in the index rather than implying there is no history.
   */
  app.get('/v1/names/:name/card/versions', async (c) => {
    let label: string;
    try {
      label = toLabel(c.req.param('name'), config.brand.rootName);
    } catch (error) {
      return c.json(
        {
          summary: { zh: '这个名字不合规。', en: 'That name is not valid.' },
          errors: [
            boom(
              isMusePassError(error) ? error.code : 'INVALID_NAME',
              error instanceof Error ? error.message : String(error),
              { zh: '这个名字不合规。', en: 'That name is not valid.' },
            ),
          ],
          meta: meta(false),
        },
        400,
      );
    }

    const indexed = await names.findByNormalized(label);
    if (!indexed) {
      return c.json({
        summary: {
          zh: `${label} 不在我们的索引里，所以查不到历史——只有通过我们 API 发布过的名片才有记录。链上可能仍有版本，需要用事件索引才能读到。`,
          en: `${label} is not in our index, so there is no history here. Records published directly to the registry are not visible to us.`,
        },
        data: { label, versions: [], indexed: false },
        errors: [],
        meta: meta(true),
      });
    }

    const versions = await cards.listVersions(indexed.id);
    return c.json({
      summary:
        versions.length === 0
          ? { zh: `${label} 还没有发布过名片。`, en: `${label} has no published card yet.` }
          : {
              zh: `${label} 的名片改过 ${versions.length} 次，最新一版指纹 ${versions[0].contentHash.slice(0, 10)}…。`,
              en: `${label} has ${versions.length} published card versions.`,
            },
      data: {
        label,
        indexed: true,
        versions: versions.map((version) => ({
          version: version.version,
          contentHash: version.contentHash,
          visibility: version.visibility,
          publishedAt: version.createdAt.toISOString(),
        })),
        noteZh: '链上也保留着每一版（解析器的文本记录是版本化的）；这里列的是通过我们发布的那部分。',
        noteEn:
          'The chain keeps every version too; this lists the ones published through this API.',
      },
      errors: [],
      meta: meta(true),
    });
  });

  /**
   * Publish an ERC-8004 card to the name's on-chain text record.
   *
   * The owner signs; we sponsor the transaction. Nothing here can publish a
   * card for a name the signer does not own: the registry checks that itself,
   * and we check it first so the caller gets a sentence instead of a revert.
   */
  app.put('/v1/names/:name/card', async (c) => {
    const l2Registry = config.chains.l2.l2Registry;
    if (!l2Registry) {
      return c.json(
        {
          summary: {
            zh: '服务还没配置好（缺少注册表地址），名片暂时不能发布。',
            en: 'The service is not configured yet; cards cannot be published.',
          },
          errors: [
            boom('NOT_CONFIGURED', 'l2Registry is missing from config', {
              zh: '服务还没配置好。',
              en: 'The service is not configured.',
            }),
          ],
          meta: meta(false),
        },
        503,
      );
    }

    let body: Record<string, unknown>;
    try {
      body = (await c.req.json()) as Record<string, unknown>;
    } catch {
      return c.json(
        {
          summary: { zh: '请求格式不对。', en: 'The request body is not valid JSON.' },
          errors: [
            boom('BAD_REQUEST', 'invalid JSON body', {
              zh: '请求格式不对。',
              en: 'The request body is not valid JSON.',
            }),
          ],
          meta: meta(false),
        },
        400,
      );
    }

    let label: string;
    try {
      label = toLabel(c.req.param('name'), config.brand.rootName);
    } catch (error) {
      return c.json(
        {
          summary: { zh: '这个名字不合规。', en: 'That name is not valid.' },
          errors: [
            boom(
              isMusePassError(error) ? error.code : 'INVALID_NAME',
              error instanceof Error ? error.message : String(error),
              { zh: '这个名字不合规。', en: 'That name is not valid.' },
            ),
          ],
          meta: meta(false),
        },
        400,
      );
    }

    const signer = typeof body.signer === 'string' ? body.signer : '';
    const signature = typeof body.signature === 'string' ? body.signature : '';
    const expiration = body.expiration;
    if (!isAddress(signer) || !signature || expiration === undefined) {
      return c.json(
        {
          summary: {
            zh: '缺少发布所需的信息（钱包地址、签名或有效期）。',
            en: 'Missing signer, signature or expiration.',
          },
          errors: [
            boom('BAD_REQUEST', 'signer, signature and expiration are required', {
              zh: '缺少发布所需的信息。',
              en: 'Missing signer, signature or expiration.',
            }),
          ],
          meta: meta(false),
        },
        400,
      );
    }

    // Store exactly what the owner signs. Any normalisation here (adding a
    // timestamp, defaulting visibility) would change the bytes they signed and
    // make the signature impossible to produce off chain.
    const validation = validateCard(body.card);
    if (!validation.ok) {
      return c.json(
        {
          summary: {
            zh: '这张名片还缺必填内容，补齐后才能发布。',
            en: 'The card is missing required fields.',
          },
          data: { invalid: validation.errors },
          errors: validation.errors.map((message) => ({ code: 'INVALID_CARD', message })),
          meta: meta(false),
        },
        400,
      );
    }

    // The record value is self-contained, so it cannot rot when a pinning
    // service disappears (ERC-8004 explicitly allows a base64 data URI). It
    // is the public view of the card plus the hash of the whole card — private
    // fields are not in the bytes the owner signs and never reach the chain.
    const value = cardDataUri(validation.card);
    const node = namehash(validation.card.name);
    const payload = cardTextSignaturePayload({
      registry: l2Registry as `0x${string}`,
      node,
      key: CARD_TEXT_KEY,
      value,
      expiration: BigInt(expiration as string | number),
    });

    let signatureValid = false;
    try {
      signatureValid = await verifyCardTextSignature({
        address: signer,
        payload,
        signature: signature as `0x${string}`,
      });
    } catch (error) {
      return c.json(
        {
          summary: { zh: '签名没法验证，请重新签名。', en: 'The signature could not be checked.' },
          errors: [
            boom('INVALID_SIGNATURE', error instanceof Error ? error.message : 'unreadable', {
              zh: '签名没法验证，请重新签名。',
              en: 'The signature could not be checked.',
            }),
          ],
          meta: meta(false),
        },
        401,
      );
    }

    if (!signatureValid) {
      return c.json(
        {
          summary: {
            zh: '签名和这张名片对不上。注意：要签的是原始哈希，不是加过前缀的哈希。',
            en: 'The signature does not match this card.',
          },
          errors: [
            boom('INVALID_SIGNATURE', 'signature does not match the card record', {
              zh: '签名和这张名片对不上。',
              en: 'The signature does not match this card.',
            }),
          ],
          meta: meta(false),
        },
        401,
      );
    }

    const owner = await chain.getOwner(label);
    if (!owner || owner.toLowerCase() !== signer.toLowerCase()) {
      return c.json(
        {
          summary: {
            zh: '只有名字的主人才能为它发布名片。',
            en: 'Only the owner of the name can publish a card for it.',
          },
          errors: [
            boom('NOT_OWNER', `signer is not the owner of ${label}`, {
              zh: '只有名字的主人才能为它发布名片。',
              en: 'Only the owner of the name can publish a card for it.',
            }),
          ],
          meta: meta(true),
        },
        403,
      );
    }

    try {
      const { txHash } = await chain.writeText({
        label,
        key: CARD_TEXT_KEY,
        value,
        expiration: BigInt(expiration as string | number),
        signer,
        signature: signature as `0x${string}`,
      });

      // Record the version we just published. If the name predates the index
      // there is nothing to attach it to, which is why this is best effort.
      const indexed = await names.findByNormalized(label);
      if (indexed) {
        await cards.addVersion({
          nameId: indexed.id,
          contentHash: cardContentHash(validation.card),
          visibility: {
            ...defaultVisibility(),
            ...((validation.card.musename as { visibility?: Partial<VisibilityMap> } | undefined)
              ?.visibility ?? {}),
          },
        });
      }

      return c.json(
        {
          summary: {
            zh: `名片的公开部分已经写进链上了，${label}.${config.brand.rootName} 的任何访问者都能读到；私密字段没有上链。`,
            en: `The public part of the card is on chain, readable by anyone visiting ${label}.${config.brand.rootName}; private fields were never written.`,
          },
          data: {
            label,
            fullName: validation.card.name,
            txHash,
            contentHash: cardContentHash(validation.card),
            recordBytes: value.length,
            visibility: {
              ...defaultVisibility(),
              ...((validation.card.musename as { visibility?: Partial<VisibilityMap> } | undefined)
                ?.visibility ?? {}),
            },
            warnings: validation.warnings,
          },
          errors: [],
          meta: meta(true),
        },
        201,
      );
    } catch (error) {
      return c.json(
        {
          summary: {
            zh: '写链失败，名片没有被发布，可以再试一次。',
            en: 'Publishing failed; nothing was written and you can retry.',
          },
          errors: [
            boom('CHAIN_ERROR', error instanceof Error ? error.message : String(error), {
              zh: '写链失败，名片没有被发布。',
              en: 'Publishing failed; nothing was written.',
            }),
          ],
          meta: meta(false),
        },
        502,
      );
    }
  });

  app.get('/v1/names/:name', async (c) => {
    const rawName = c.req.param('name');

    let label: string;
    try {
      label = toLabel(rawName, config.brand.rootName);
    } catch (error) {
      return c.json(
        {
          summary: { zh: '这个名字不合规。', en: 'That name is not valid.' },
          errors: [
            boom(
              isMusePassError(error) ? error.code : 'INVALID_NAME',
              error instanceof Error ? error.message : String(error),
              { zh: '这个名字不合规。', en: 'That name is not valid.' },
            ),
          ],
          meta: meta(false),
        },
        400,
      );
    }

    let owner: Awaited<ReturnType<ChainReader['getOwner']>>;
    let indexed: Awaited<ReturnType<MusenameDeps['names']['findByNormalized']>>;
    try {
      [owner, indexed] = await Promise.all([
        chain.getOwner(label),
        names.findByNormalized(label),
      ]);
    } catch (error) {
      // A name page that cannot reach the chain must say so, not return a 500
      // that looks like a bug in our own service.
      return c.json(
        {
          summary: {
            zh: '链上暂时读不到这个名字，请稍后再刷新。',
            en: 'The chain is not reachable right now; please refresh in a moment.',
          },
          errors: [
            boom('CHAIN_UNAVAILABLE', error instanceof Error ? error.message : String(error), {
              zh: '链上暂时读不到这个名字。',
              en: 'The chain is not reachable right now.',
            }),
          ],
          meta: meta(false),
        },
        503,
      );
    }

    // The card lives on chain, so it is read from there rather than from our
    // index — the index can lag, the registry cannot lie. Since the envelope
    // change, the chain record is already the public view (private fields are
    // never written); records from before the change carry the whole card and
    // are still redacted here on read.
    let card: unknown = null;
    if (owner) {
      try {
        const record = await chain.readText(label, CARD_TEXT_KEY);
        const parsed = record ? parseCardDataUri(record) : null;
        if (parsed) {
          const envelopeHash = envelopeContentHash(parsed);
          if (envelopeHash) {
            const { musename: _envelope, ...publicView } = parsed as unknown as Record<string, unknown>;
            card = { ...publicView, address: owner, contentHash: envelopeHash };
          } else {
            const visibility = {
              ...defaultVisibility(),
              ...((parsed.musename as { visibility?: Partial<VisibilityMap> } | undefined)?.visibility ??
                {}),
            };
            card = {
              ...applyVisibility(
                { card: parsed, ensName: `${label}.${config.brand.rootName}`, ownerAddress: owner },
                visibility,
                'public',
              ),
              contentHash: cardContentHash(parsed),
            };
          }
        }
      } catch {
        // A missing or unreadable record is not an error: it means no card yet.
        card = null;
      }
    }

    if (!owner) {
      return c.json(
        {
          summary: {
            zh: `${label} 还没有被注册。`,
            en: `${label} is not registered yet.`,
          },
          data: { label, fullName: `${label}.${config.brand.rootName}`, owner: null, card: null, genesis: null },
          errors: [],
          meta: meta(true),
        },
        404,
      );
    }

    // Genesis cover number (D18): derived, cached, and only for a name that
    // published a card. Unavailable chain means "no number shown", not an
    // error — the rest of the page is still true without it.
    let genesisNumber: number | null = null;
    try {
      genesisNumber = (await genesisCover()).byLabel.get(label) ?? null;
    } catch {
      genesisNumber = null;
    }

    return c.json({
      summary: {
        zh: `${label} 属于 ${owner}。`,
        en: `${label} belongs to ${owner}.`,
      },
      data: {
        label,
        fullName: `${label}.${config.brand.rootName}`,
        owner,
        card,
        genesis: genesisNumber === null ? null : { number: genesisNumber },
        trackRecord: null,
        index: indexed
          ? {
              tier: indexed.tier,
              registeredAt: indexed.registeredAt.toISOString(),
              registeredVia: indexed.registeredVia,
            }
          : null,
      },
      errors: [],
      meta: meta(true),
    });
  });

  /* ------------------------------------------------------------------ */
  /* POST /v1/names/claim                                                */
  /* ------------------------------------------------------------------ */

  /* ------------------------------------------------------------------ */
  /* POST /v1/requests  — an AI asks for a name on its owner's behalf    */
  /* ------------------------------------------------------------------ */
  app.post('/v1/requests', async (c) => {
    let body: Record<string, unknown>;
    try {
      body = (await c.req.json()) as Record<string, unknown>;
    } catch {
      return c.json(
        {
          summary: { zh: '请求格式不对。', en: 'The request body is not valid JSON.' },
          errors: [
            boom('BAD_REQUEST', 'invalid JSON body', {
              zh: '请求格式不对。',
              en: 'The request body is not valid JSON.',
            }),
          ],
          meta: meta(false),
        },
        400,
      );
    }

    const rawLabel = typeof body.label === 'string' ? body.label : '';
    const requestedFor = typeof body.requestedFor === 'string' ? body.requestedFor.trim() : '';
    const host = typeof body.host === 'string' && body.host.trim() ? body.host.trim() : null;

    if (!requestedFor) {
      return c.json(
        {
          summary: {
            zh: '需要告诉我这个名字要给谁——主人的邮箱或钱包地址。',
            en: 'Tell me who this name is for: the owner email or wallet address.',
          },
          errors: [
            boom('BAD_REQUEST', 'requestedFor is required', {
              zh: '需要告诉我这个名字要给谁——主人的邮箱或钱包地址。',
              en: 'Tell me who this name is for: the owner email or wallet address.',
            }),
          ],
          meta: meta(false),
        },
        400,
      );
    }

    let label: string;
    try {
      label = normalizeLabel(rawLabel).normalized;
    } catch (error) {
      return c.json(
        {
          summary: { zh: '这个名字不合规，换一个吧。', en: 'That name is not valid; pick another.' },
          errors: [
            boom(
              isMusePassError(error) ? error.code : 'INVALID_NAME',
              error instanceof Error ? error.message : String(error),
              { zh: '这个名字不合规，换一个吧。', en: 'That name is not valid; pick another.' },
            ),
          ],
          meta: meta(false),
        },
        400,
      );
    }

    let onChainFree: boolean;
    try {
      onChainFree = await chain.isLabelAvailable(label);
    } catch (error) {
      return c.json(
        {
          summary: {
            zh: '链上暂时查不通，请稍后再试。',
            en: 'The chain is not reachable right now; please retry.',
          },
          errors: [
            boom('CHAIN_UNAVAILABLE', error instanceof Error ? error.message : String(error), {
              zh: '链上暂时查不通，请稍后再试。',
              en: 'The chain is not reachable right now; please retry.',
            }),
          ],
          meta: meta(false),
        },
        503,
      );
    }

    const policy = checkLabel(label, { config, reservedIndex, onChainFree });
    if (!policy.policyOk || !onChainFree) {
      return c.json(
        {
          summary: policy.summary,
          data: { label, fullName: policy.fullName },
          errors: policy.issues.map((issue) => ({ code: issue.code, message: issue.message })),
          meta: meta(true),
        },
        409,
      );
    }

    const { maxOpenRequestsPerHost, maxOpenRequestsPerOwner, confirmTokenTtlMinutes } =
      config.limits.registrationRequest;

    if (host) {
      const open = await requests.countOpenByHost(host);
      if (open >= maxOpenRequestsPerHost) {
        return c.json(
          {
            summary: {
              zh: '这个 AI 待确认的注册请求太多了，先让主人处理几个。',
              en: 'This AI has too many requests waiting for confirmation.',
            },
            errors: [
              boom('RATE_LIMITED', `host has ${open} open requests`, {
                zh: '这个 AI 待确认的注册请求太多了，先让主人处理几个。',
                en: 'This AI has too many requests waiting for confirmation.',
              }),
            ],
            meta: meta(true),
          },
          429,
        );
      }
    }

    const openForSubject = await requests.countOpenBySubject(requestedFor);
    if (openForSubject >= maxOpenRequestsPerOwner) {
      return c.json(
        {
          summary: {
            zh: '这位主人已经有待确认的注册请求了，先确认或等它过期。',
            en: 'This owner already has a request waiting for confirmation.',
          },
          errors: [
            boom('RATE_LIMITED', `subject has ${openForSubject} open requests`, {
              zh: '这位主人已经有待确认的注册请求了，先确认或等它过期。',
              en: 'This owner already has a request waiting for confirmation.',
            }),
          ],
          meta: meta(true),
        },
        429,
      );
    }

    const id = randomUUID();
    const token = randomBytes(32).toString('hex');
    const now = clock();
    const expiresAt = new Date(now.getTime() + confirmTokenTtlMinutes * 60 * 1000);

    await requests.insert({
      id,
      label,
      requestedByHost: host,
      requestedFor,
      confirmTokenHash: hashToken(token),
      expiresAt,
      status: 'pending',
      confirmedAt: null,
    });

    const confirmUrl = `${config.brand.siteUrl.replace(/\/$/, '')}/confirm/${id}?token=${token}`;

    return c.json(
      {
        summary: {
          zh: `我已经把 ${label}.${config.brand.rootName} 准备好了，请把下面这条链接交给主人确认，${confirmTokenTtlMinutes} 分钟内有效。`,
          en: `I have prepared ${label}.${config.brand.rootName}. Give this link to the owner to confirm; it expires in ${confirmTokenTtlMinutes} minutes.`,
        },
        data: {
          requestId: id,
          label,
          fullName: `${label}.${config.brand.rootName}`,
          confirmUrl,
          expiresAt: expiresAt.toISOString(),
          requestedFor,
          requestedByHost: host,
        },
        errors: [],
        meta: meta(true),
      },
      201,
    );
  });

  /* ------------------------------------------------------------------ */
  /* GET /v1/requests/{id}                                               */
  /* ------------------------------------------------------------------ */
  app.get('/v1/requests/:id', async (c) => {
    const request = await requests.findById(c.req.param('id'));
    if (!request) {
      return c.json(
        {
          summary: { zh: '没有这个注册请求。', en: 'No such registration request.' },
          errors: [
            boom('NOT_FOUND', 'unknown request id', {
              zh: '没有这个注册请求。',
              en: 'No such registration request.',
            }),
          ],
          meta: meta(false),
        },
        404,
      );
    }

    const expired = request.status === 'pending' && request.expiresAt <= clock();
    const status = expired ? 'expired' : request.status;

    return c.json({
      summary: {
        zh:
          status === 'confirmed'
            ? `${request.label} 已经注册好了。`
            : status === 'expired'
              ? '这个确认链接已经过期了，重新发起一次就可以。'
              : '还在等主人确认。',
        en:
          status === 'confirmed'
            ? `${request.label} has been registered.`
            : status === 'expired'
              ? 'This confirmation link has expired; just start again.'
              : 'Waiting for the owner to confirm.',
      },
      data: {
        requestId: request.id,
        label: request.label,
        fullName: `${request.label}.${config.brand.rootName}`,
        status,
        requestedFor: request.requestedFor,
        requestedByHost: request.requestedByHost,
        expiresAt: request.expiresAt.toISOString(),
        confirmedAt: request.confirmedAt?.toISOString() ?? null,
      },
      errors: [],
      meta: meta(true),
    });
  });

  /* ------------------------------------------------------------------ */
  /* POST /v1/auth/privy/verify                                          */
  /* ------------------------------------------------------------------ */
  app.post('/v1/auth/privy/verify', async (c) => {
    const ip = (c.req.header('x-forwarded-for') ?? 'local').split(',')[0].trim();
    if (!rateLimit(c, `privy-verify:${ip}`, 60)) {
      return c.json(
        {
          summary: {
            zh: '验证太频繁了，请稍后再试。',
            en: 'Too many verification attempts; please retry later.',
          },
          errors: [
            boom('RATE_LIMITED', 'privy verify rate limit exceeded', {
              zh: '验证太频繁了，请稍后再试。',
              en: 'Too many verification attempts; please retry later.',
            }),
          ],
          meta: meta(false),
        },
        429,
      );
    }

    if (!privyConfigured()) {
      return c.json(
        {
          summary: {
            zh: 'X 登录还没有配置。',
            en: 'Signing in with X is not configured on this service.',
          },
          errors: [
            boom('NOT_CONFIGURED', 'privy credentials are not set', {
              zh: 'X 登录还没有配置。',
              en: 'Signing in with X is not configured on this service.',
            }),
          ],
          meta: meta(false),
        },
        503,
      );
    }

    let body: Record<string, unknown>;
    try {
      body = (await c.req.json()) as Record<string, unknown>;
    } catch {
      return c.json(
        {
          summary: { zh: '请求格式不对。', en: 'The request body is not valid JSON.' },
          errors: [boom('BAD_REQUEST', 'invalid JSON body', { zh: '请求格式不对。', en: 'The request body is not valid JSON.' })],
          meta: meta(false),
        },
        400,
      );
    }

    const accessToken = typeof body.accessToken === 'string' ? body.accessToken : '';
    try {
      const identity = await verifyPrivyIdentity(accessToken);
      return c.json({
        summary: { zh: '登录已验证。', en: 'The sign-in was verified.' },
        data: {
          privyUserId: identity.privyUserId,
          xHandle: identity.xHandle,
          walletAddress: identity.walletAddress,
        },
        errors: [],
        meta: meta(true),
      });
    } catch {
      return c.json(
        {
          summary: {
            zh: '登录凭证无效或已过期。',
            en: 'That sign-in is not valid or has expired; sign in again.',
          },
          errors: [
            boom('INVALID_TOKEN', 'privy access token did not verify', {
              zh: '登录凭证无效或已过期。',
              en: 'That sign-in is not valid or has expired; sign in again.',
            }),
          ],
          meta: meta(false),
        },
        401,
      );
    }
  });

  /* ------------------------------------------------------------------ */
  /* POST /v1/names/claim                                                */
  /* ------------------------------------------------------------------ */
  app.post('/v1/names/claim', async (c) => {
    if (!eip712Domain || !registrarAddress) {
      return c.json(
        {
          summary: {
            zh: '服务还没配置好，暂时不能发放名字。',
            en: 'The service is not configured yet and cannot issue names.',
          },
          errors: [
            boom('NOT_CONFIGURED', 'registrar address is missing from config', {
              zh: '服务还没配置好，暂时不能发放名字。',
              en: 'The service is not configured yet and cannot issue names.',
            }),
          ],
          meta: meta(false),
        },
        503,
      );
    }

    let body: Record<string, unknown>;
    try {
      body = (await c.req.json()) as Record<string, unknown>;
    } catch {
      return c.json(
        {
          summary: { zh: '请求格式不对。', en: 'The request body is not valid JSON.' },
          errors: [boom('BAD_REQUEST', 'invalid JSON body', { zh: '请求格式不对。', en: 'The request body is not valid JSON.' })],
          meta: meta(false),
        },
        400,
      );
    }

    const rawLabel = typeof body.label === 'string' ? body.label : '';
    const owner = typeof body.owner === 'string' ? (body.owner as Address) : null;
    const signature = typeof body.signature === 'string' ? (body.signature as Hex) : null;
    const deadlineRaw = body.deadline;
    const via = body.via === 'mcp' ? 'mcp' : 'web';
    const agentHost = typeof body.agentHost === 'string' ? body.agentHost : null;

    if (!owner || !signature || !/^0x[0-9a-fA-F]{40}$/.test(owner) || deadlineRaw === undefined) {
      return c.json(
        {
          summary: {
            zh: '缺少领取所需的信息（名字、地址或签名）。',
            en: 'Missing one of: label, owner address or signature.',
          },
          errors: [
            boom('BAD_REQUEST', 'label, owner, deadline and signature are required', {
              zh: '缺少领取所需的信息（名字、地址或签名）。',
              en: 'Missing one of: label, owner address or signature.',
            }),
          ],
          meta: meta(false),
        },
        400,
      );
    }

    let deadline: bigint;
    try {
      deadline = BigInt(deadlineRaw as string | number | bigint);
    } catch {
      return c.json(
        {
          summary: { zh: '签名有效期格式不对。', en: 'The deadline is not a valid number.' },
          errors: [boom('BAD_REQUEST', 'deadline must be a unix timestamp', { zh: '签名有效期格式不对。', en: 'The deadline is not a valid number.' })],
          meta: meta(false),
        },
        400,
      );
    }

    // 1. signature first: never do side effects for an unauthenticated caller.
    let signatureValid = false;
    try {
      signatureValid = await verifyRegisterSignature({
        address: owner,
        signature,
        domain: eip712Domain,
        message: registerMessage({ label: rawLabel, owner, deadline }),
        // Use the injected clock so expiry is testable and consistent with the
        // quotas, which are computed from the same clock.
        now: BigInt(Math.floor(clock().getTime() / 1000)),
      });
    } catch (error) {
      return c.json(
        {
          summary: { zh: '签名已经过期了，请重新签名。', en: 'That signature has expired; please sign again.' },
          errors: [
            boom(
              isMusePassError(error) ? error.code : 'INVALID_SIGNATURE',
              error instanceof Error ? error.message : String(error),
              { zh: '签名已经过期了，请重新签名。', en: 'That signature has expired; please sign again.' },
            ),
          ],
          meta: meta(false),
        },
        401,
      );
    }

    if (!signatureValid) {
      return c.json(
        {
          summary: {
            zh: '签名和这个名字或地址对不上。',
            en: 'The signature does not match this name and address.',
          },
          errors: [
            boom('INVALID_SIGNATURE', 'signature does not match label/owner/deadline', {
              zh: '签名和这个名字或地址对不上。',
              en: 'The signature does not match this name and address.',
            }),
          ],
          meta: meta(false),
        },
        401,
      );
    }

    // 2. policy and the on-chain view.
    let label: string;
    try {
      label = normalizeLabel(rawLabel).normalized;
    } catch (error) {
      return c.json(
        {
          summary: { zh: '这个名字不合规。', en: 'That name is not valid.' },
          errors: [
            boom(
              isMusePassError(error) ? error.code : 'INVALID_NAME',
              error instanceof Error ? error.message : String(error),
              { zh: '这个名字不合规。', en: 'That name is not valid.' },
            ),
          ],
          meta: meta(false),
        },
        400,
      );
    }

    let onChainFree: boolean;
    try {
      onChainFree = await chain.isLabelAvailable(label);
    } catch (error) {
      return c.json(
        {
          summary: {
            zh: '链上暂时查不通，没有做任何修改，请稍后再试。',
            en: 'The chain is not reachable right now; nothing was changed, please retry.',
          },
          errors: [
            boom('CHAIN_UNAVAILABLE', error instanceof Error ? error.message : String(error), {
              zh: '链上暂时查不通，没有做任何修改，请稍后再试。',
              en: 'The chain is not reachable right now; nothing was changed, please retry.',
            }),
          ],
          meta: meta(false),
        },
        503,
      );
    }
    // 2b. D17, the authoritative check: a 3–4 unit name exists only through an
    //     invitation, and one invitation is ever worth one name. The signature
    //     above decided who `owner` is, so this cannot be spoofed by the body.
    //     An invitation can name the wallet directly, or an X handle — in that
    //     case the client attaches a Privy access token, which is verified here
    //     so a bare "x=@anyone" in the body proves nothing.
    let invitation = await invitationFor(owner);
    const privyAccessToken =
      typeof body.privyAccessToken === 'string' ? body.privyAccessToken : null;
    if (!invitation && privyAccessToken) {
      try {
        const identity = await verifyPrivyIdentity(privyAccessToken);
        if (identity.xHandle) {
          const row = findInvitation(config.invitations.invitations, {
            xHandle: identity.xHandle,
          });
          if (row) invitation = row;
        }
      } catch {
        // A token that does not verify simply means: not invited. The claim
        // continues under the ordinary rules instead of failing.
      }
    }
    const policy = checkLabel(label, { config, reservedIndex, onChainFree, invitation });

    // Idempotency: the same owner asking again is not an error.
    const existing = await names.findByNormalized(label);
    if (existing && existing.ownerAddress.toLowerCase() === owner.toLowerCase()) {
      return c.json({
        summary: {
          zh: `${label} 已经是你的了。`,
          en: `${label} is already yours.`,
        },
        data: {
          label,
          fullName: existing.fullName,
          owner,
          tier: existing.tier,
          txHash: existing.txHash,
          alreadyRegistered: true,
        },
        errors: [],
        meta: meta(true),
      });
    }

    // 2c. Same rule, as a rejection with its own code: the checkLabel pass above
    //     already waived the premium gate when the invitation allows it, so this
    //     branch is what an already-served wallet hits.
    const units = policy.units ?? 0;
    let usedInvitation = false;
    if (units > 0 && units <= INVITED_MAX_UNITS) {
      const decision = invitedShortNameDecision(invitation, units);
      if (!decision.allowed) {
        return c.json(
          {
            summary: {
              zh:
                decision.code === 'ALREADY_CLAIMED'
                  ? '这个邀请已经用过了，一个邀请只能领一个名字。'
                  : decision.code === 'PROJECT_RESERVED'
                    ? '1–2 字符的名字由项目保留，不对外发放。'
                    : '3–4 字符的名字只发给受邀的钱包。',
              en:
                decision.code === 'ALREADY_CLAIMED'
                  ? 'This invitation has already been used; one invitation is worth one name.'
                  : decision.code === 'PROJECT_RESERVED'
                    ? 'One and two character names are held by the project and are never given away.'
                    : 'Short names (3–4 characters) are only given to invited wallets.',
            },
            data: { label, suggestions: [] },
            errors: [
              boom(decision.code, decision.reason, {
                zh: '这次领取没有创建任何名字。',
                en: 'No name was created.',
              }),
            ],
            meta: meta(true),
          },
          decision.code === 'ALREADY_CLAIMED' ? 409 : 403,
        );
      }
      usedInvitation = true;
    }

    if (!policy.policyOk || !onChainFree) {
      return c.json(
        {
          summary: policy.summary,
          data: { label, suggestions: [] },
          errors: policy.issues.map((issue) => ({ code: issue.code, message: issue.message })),
          meta: meta(true),
        },
        409,
      );
    }

    // 3. If an AI started this, the confirmation token has to match too. The
    //    token proves the person clicking is the person the AI asked for; the
    //    signature above proves they are the wallet that will own the name.
    const requestId = typeof body.requestId === 'string' ? body.requestId : null;
    const confirmToken = typeof body.confirmToken === 'string' ? body.confirmToken : null;
    let confirmedRequestId: string | null = null;

    if (requestId) {
      const request = await requests.findById(requestId);
      if (!request) {
        return c.json(
          {
            summary: { zh: '没有这个注册请求。', en: 'No such registration request.' },
            errors: [
              boom('NOT_FOUND', 'unknown request id', {
                zh: '没有这个注册请求。',
                en: 'No such registration request.',
              }),
            ],
            meta: meta(false),
          },
          404,
        );
      }
      if (request.label !== label) {
        return c.json(
          {
            summary: {
              zh: '这个确认链接是给另一个名字的。',
              en: 'This confirmation link is for a different name.',
            },
            errors: [
              boom('REQUEST_MISMATCH', 'request label does not match', {
                zh: '这个确认链接是给另一个名字的。',
                en: 'This confirmation link is for a different name.',
              }),
            ],
            meta: meta(false),
          },
          409,
        );
      }
      if (request.status === 'confirmed') {
        return c.json(
          {
            summary: {
              zh: '这个请求已经确认过了。',
              en: 'This request has already been confirmed.',
            },
            errors: [
              boom('REQUEST_ALREADY_CONFIRMED', 'request already confirmed', {
                zh: '这个请求已经确认过了。',
                en: 'This request has already been confirmed.',
              }),
            ],
            meta: meta(false),
          },
          409,
        );
      }
      if (request.status !== 'pending' || request.expiresAt <= clock()) {
        if (request.status === 'pending') await requests.markStatus(request.id, 'expired', clock());
        return c.json(
          {
            summary: {
              zh: '这个确认链接已经过期了，让 AI 重新发起一次就行。',
              en: 'This confirmation link has expired; ask the AI to start again.',
            },
            errors: [
              boom('EXPIRED', 'confirmation link expired', {
                zh: '这个确认链接已经过期了，让 AI 重新发起一次就行。',
                en: 'This confirmation link has expired; ask the AI to start again.',
              }),
            ],
            meta: meta(false),
          },
          410,
        );
      }
      if (!confirmToken || hashToken(confirmToken) !== request.confirmTokenHash) {
        return c.json(
          {
            summary: {
              zh: '确认链接里的口令不对，请用 AI 给你的那条完整链接。',
              en: 'The token in the link is wrong; use the full link your AI gave you.',
            },
            errors: [
              boom('INVALID_TOKEN', 'confirmation token mismatch', {
                zh: '确认链接里的口令不对，请用 AI 给你的那条完整链接。',
                en: 'The token in the link is wrong; use the full link your AI gave you.',
              }),
            ],
            meta: meta(false),
          },
          403,
        );
      }
      confirmedRequestId = request.id;
    }

    // Sponsorship is invitation-only: every registration the issuer pays for
    // is tied to an invitation (by wallet, or by a Privy-verified X handle).
    // An uninvited wallet gets nothing issued, at any label length. Reserved,
    // taken and request-token answers came earlier; this is the last stop
    // before the issuer's gas is counted.
    if (!invitation) {
      return c.json(
        {
          summary: {
            zh: '名字仅通过邀请发放；这个钱包或 X 账号目前没有邀请。',
            en: 'Names are issued by invitation; this wallet or X handle has none.',
          },
          data: { label, suggestions: [] },
          errors: [
            boom('NOT_INVITED', 'no invitation for this wallet or X handle', {
              zh: '这次领取没有创建任何名字。',
              en: 'No name was created.',
            }),
          ],
          meta: meta(true),
        },
        403,
      );
    }

    // 4. sponsorship budget.
    const startOfDay = new Date(clock());
    startOfDay.setUTCHours(0, 0, 0, 0);
    const [walletFreeNames, walletSponsoredToday, walletSponsoredLifetime, platformSponsoredToday, platformSponsoredLifetime] =
      await Promise.all([
        names.listByOwner(owner).then((rows) => rows.length),
        sponsorship.countForWalletSince(owner, startOfDay),
        sponsorship.countForWalletLifetime(owner),
        sponsorship.countPlatformSince(startOfDay),
        sponsorship.countPlatformLifetime(),
      ]);

    const quotaIssues = checkClaimQuota(
      {
        walletFreeNames,
        walletSponsoredToday,
        walletSponsoredLifetime,
        platformSponsoredToday,
        platformSponsoredLifetime,
      },
      config,
    );
    if (quotaIssues.length > 0) {
      return c.json(
        {
          summary: {
            zh: '这个钱包的免费额度已经用完了。',
            en: 'This wallet has used up its free allowance.',
          },
          errors: quotaIssues.map((issue) => ({ code: issue.code, message: issue.message })),
          meta: meta(true),
        },
        429,
      );
    }

    if (!rateLimit(c, `claim:${owner.toLowerCase()}`, config.limits.rateLimits.claimPerHourPerWallet)) {
      return c.json(
        {
          summary: { zh: '领取太频繁了，请稍后再试。', en: 'Too many claims; please retry later.' },
          errors: [
            boom('RATE_LIMITED', 'claim rate limit exceeded', {
              zh: '领取太频繁了，请稍后再试。',
              en: 'Too many claims; please retry later.',
            }),
          ],
          meta: meta(true),
        },
        429,
      );
    }

    // A wallet limit does not stop a script that mints a wallet per claim, so
    // external traffic is also limited per originating IP. Calls without a
    // forwarded client address are server-to-server (the MCP app) and are left
    // to the wallet and budget quotas above.
    const clientIp = (c.req.header('x-forwarded-for') ?? '').split(',')[0].trim();
    if (clientIp && !rateLimit(c, `claim-ip:${clientIp}`, config.limits.rateLimits.claimPerHourPerIp)) {
      return c.json(
        {
          summary: {
            zh: '这个网络地址的领取次数太多了，请稍后再试。',
            en: 'Too many claims from this network address; please retry later.',
          },
          errors: [
            boom('RATE_LIMITED', 'claim rate limit exceeded for this address', {
              zh: '这个网络地址的领取次数太多了，请稍后再试。',
              en: 'Too many claims from this network address; please retry later.',
            }),
          ],
          meta: meta(true),
        },
        429,
      );
    }

    // 5. issue.
    let txHash: Hex;
    let node: Hex;
    try {
      const result = await chain.register({ label, owner, deadline, signature });
      txHash = result.txHash;
      node = result.node;
    } catch (error) {
      return c.json(
        {
          summary: {
            zh: '发放失败，名字没有被创建，可以再试一次。',
            en: 'Issuing failed; nothing was created and you can retry.',
          },
          errors: [
            boom('CHAIN_ERROR', error instanceof Error ? error.message : String(error), {
              zh: '发放失败，名字没有被创建，可以再试一次。',
              en: 'Issuing failed; nothing was created and you can retry.',
            }),
          ],
          meta: meta(false),
        },
        502,
      );
    }

    const record = await names.insert({
      label,
      fullName: `${label}.${config.brand.rootName}`,
      normalized: label,
      ownerAddress: owner,
      tier: policy.price?.tier ?? 'free',
      status: 'active',
      registeredVia: via,
      agentHost,
      txHash,
    });
    await sponsorship.record({ wallet: owner, txHash, nameId: record.id });
    if (usedInvitation) {
      // Only after the chain accepted the registration: a failed claim must not
      // spend the invitation. If the process dies between the two, the name
      // exists unindexed and the invitation reads unused — the reconciliation
      // job is the place that catches it, same as the name index. The spend is
      // recorded under the claiming wallet, so an X-handle invitation cannot be
      // replayed by the same embedded wallet either.
      await invitationClaims.markClaimed({
        wallet: owner,
        claimedLabel: label,
        txHash,
        claimedAt: clock(),
      });
    }
    if (confirmedRequestId) {
      await requests.markStatus(confirmedRequestId, 'confirmed', clock());
    }

    return c.json(
      {
        summary: {
          zh: `搞定，${label}.${config.brand.rootName} 现在是你的了。`,
          en: `Done: ${label}.${config.brand.rootName} now belongs to you.`,
        },
        data: {
          label,
          fullName: record.fullName,
          owner,
          node,
          txHash,
          tier: record.tier,
          alreadyRegistered: false,
        },
        errors: [],
        meta: meta(true),
      },
      201,
    );
  });

  /* ------------------------------------------------------------------ */
  /* POST /v1/names/purchase/quote  (D19)                                */
  /* ------------------------------------------------------------------ */
  /**
   * Locks a price for one label and one payer. The response carries everything
   * a wallet or an agent needs to pay on-chain (token, treasury, amount) plus
   * the EIP-712 domain hint for the register signature. No invitation is
   * consulted: paid purchase is open to everyone, invited or not.
   */
  app.post('/v1/names/purchase/quote', async (c) => {
    const purchase = config.pricing.purchase;
    if (!purchase?.enabled) {
      return c.json(
        {
          summary: {
            zh: '付费购买还没有开放。',
            en: 'Paid purchase is not open yet.',
          },
          errors: [
            boom('PURCHASE_NOT_ENABLED', 'purchase is disabled in config', {
              zh: '付费购买还没有开放。',
              en: 'Paid purchase is not open yet.',
            }),
          ],
          meta: meta(false),
        },
        503,
      );
    }

    let body: Record<string, unknown>;
    try {
      body = (await c.req.json()) as Record<string, unknown>;
    } catch {
      return c.json(
        {
          summary: { zh: '请求格式不对。', en: 'The request body is not valid JSON.' },
          errors: [boom('BAD_REQUEST', 'invalid JSON body', { zh: '请求格式不对。', en: 'The request body is not valid JSON.' })],
          meta: meta(false),
        },
        400,
      );
    }

    const rawLabel = typeof body.label === 'string' ? body.label : '';
    const owner = typeof body.owner === 'string' ? (body.owner as Address) : null;
    if (!rawLabel || !owner || !/^0x[0-9a-fA-F]{40}$/.test(owner)) {
      return c.json(
        {
          summary: {
            zh: '缺少名字或钱包地址。',
            en: 'Missing label or owner address.',
          },
          errors: [
            boom('BAD_REQUEST', 'label and owner are required', {
              zh: '缺少名字或钱包地址。',
              en: 'Missing label or owner address.',
            }),
          ],
          meta: meta(false),
        },
        400,
      );
    }

    let label: string;
    try {
      label = normalizeLabel(rawLabel).normalized;
    } catch (error) {
      return c.json(
        {
          summary: { zh: '这个名字不合规。', en: 'That name is not valid.' },
          errors: [
            boom(
              isMusePassError(error) ? error.code : 'INVALID_NAME',
              error instanceof Error ? error.message : String(error),
              { zh: '这个名字不合规。', en: 'That name is not valid.' },
            ),
          ],
          meta: meta(false),
        },
        400,
      );
    }

    const ip = (c.req.header('x-forwarded-for') ?? '').split(',')[0].trim();
    if (ip && !rateLimit(c, `purchase-ip:${ip}`, config.limits.rateLimits.claimPerHourPerIp)) {
      return c.json(
        {
          summary: { zh: '太频繁了，请稍后再试。', en: 'Too many requests; please retry later.' },
          errors: [
            boom('RATE_LIMITED', 'purchase rate limit exceeded for this address', {
              zh: '太频繁了，请稍后再试。',
              en: 'Too many requests; please retry later.',
            }),
          ],
          meta: meta(true),
        },
        429,
      );
    }
    if (!rateLimit(c, `purchase:${owner.toLowerCase()}`, config.limits.rateLimits.claimPerHourPerWallet)) {
      return c.json(
        {
          summary: { zh: '太频繁了，请稍后再试。', en: 'Too many requests; please retry later.' },
          errors: [
            boom('RATE_LIMITED', 'purchase rate limit exceeded', {
              zh: '太频繁了，请稍后再试。',
              en: 'Too many requests; please retry later.',
            }),
          ],
          meta: meta(true),
        },
        429,
      );
    }

    // Policy. allowPremium is only ever true for the 4-unit tier (D19); the
    // 1–3 character names stay project-reserved on the purchase rail too.
    const unitsOnly = checkLabel(label, { config, reservedIndex });
    const units = unitsOnly.units ?? 0;
    if (units > 0 && units < 4) {
      return c.json(
        {
          summary: {
            zh: '1–3 字符的名字由项目保留，暂不出售。',
            en: 'Names of 1–3 characters are held by the project and are not for sale.',
          },
          data: { label, suggestions: [] },
          errors: [
            boom('NOT_PURCHASABLE', 'labels shorter than 4 units are not purchasable (D19)', {
              zh: '1–3 字符的名字由项目保留，暂不出售。',
              en: 'Names of 1–3 characters are held by the project and are not for sale.',
            }),
          ],
          meta: meta(true),
        },
        403,
      );
    }

    let onChainFree: boolean;
    try {
      onChainFree = await chain.isLabelAvailable(label);
    } catch (error) {
      return c.json(
        {
          summary: {
            zh: '链上暂时查不通，请稍后再试。',
            en: 'The chain is not reachable right now; please retry.',
          },
          errors: [
            boom('CHAIN_UNAVAILABLE', error instanceof Error ? error.message : String(error), {
              zh: '链上暂时查不通，请稍后再试。',
              en: 'The chain is not reachable right now; please retry.',
            }),
          ],
          meta: meta(false),
        },
        503,
      );
    }

    const policy = checkLabel(label, {
      config,
      reservedIndex,
      onChainFree,
      invitation: null,
      allowPremium: units === 4,
    });
    if (!policy.policyOk || !onChainFree) {
      return c.json(
        {
          summary: policy.summary,
          data: { label, suggestions: [] },
          errors: policy.issues.map((issue) => ({ code: issue.code, message: issue.message })),
          meta: meta(true),
        },
        409,
      );
    }

    const ownerHasName = (await names.listByOwner(owner)).length > 0;
    const quote = quotePurchase(units, ownerHasName, config.pricing);
    if (!quote) {
      return c.json(
        {
          summary: {
            zh: '这个名字目前不能购买。',
            en: 'This name cannot be bought at the moment.',
          },
          data: { label, suggestions: [] },
          errors: [
            boom('NOT_PURCHASABLE', 'no purchasable price for this label', {
              zh: '这个名字目前不能购买。',
              en: 'This name cannot be bought at the moment.',
            }),
          ],
          meta: meta(true),
        },
        403,
      );
    }
    if (quote.kind === 'free-first') {
      return c.json(
        {
          summary: {
            zh: '你的第一个长名字是免费的（需要邀请）；请走免费领取，不用付钱。',
            en: 'Your first long name is free (by invitation); use the claim flow instead of paying.',
          },
          data: { label, suggestions: [] },
          errors: [
            boom('FREE_NAME_USE_CLAIM', 'first long name per wallet is free; use the claim flow', {
              zh: '你的第一个长名字是免费的（需要邀请）；请走免费领取，不用付钱。',
              en: 'Your first long name is free (by invitation); use the claim flow instead of paying.',
            }),
          ],
          meta: meta(true),
        },
        409,
      );
    }

    const maxOpen = config.limits.purchase?.maxOpenQuotesPerOwner ?? 5;
    if ((await purchases.countOpenByOwner(owner)) >= maxOpen) {
      return c.json(
        {
          summary: {
            zh: '打开的报价太多了，先完成或等待现有的报价过期。',
            en: 'Too many open quotes; finish or let the existing ones expire first.',
          },
          errors: [
            boom('TOO_MANY_OPEN_QUOTES', `more than ${maxOpen} open quotes for this wallet`, {
              zh: '打开的报价太多了，先完成或等待现有的报价过期。',
              en: 'Too many open quotes; finish or let the existing ones expire first.',
            }),
          ],
          meta: meta(true),
        },
        429,
      );
    }

    const expiresAt = new Date(clock().getTime() + purchase.quoteTtlMinutes * 60 * 1000);
    const stored = await purchases.insertQuote({
      id: randomUUID(),
      label,
      owner,
      kind: quote.kind,
      priceUsd: quote.priceUsd,
      amountBaseUnits: toBaseUnits(quote.priceUsd, purchase.tokenDecimals),
      token: purchase.token as Address,
      treasury: purchase.treasury as Address,
      chainId: config.chains.l2.chainId,
      expiresAt,
    });

    return c.json(
      {
        summary: {
          zh: `${label} 的价格已锁定 ${purchase.quoteTtlMinutes} 分钟：${quote.priceUsd} ${purchase.currency}。`,
          en: `Price locked for ${label} (${quote.priceUsd} ${purchase.currency}) for ${purchase.quoteTtlMinutes} minutes.`,
        },
        data: {
          quoteId: stored.id,
          label,
          fullName: `${label}.${config.brand.rootName}`,
          kind: stored.kind,
          priceUsd: stored.priceUsd,
          currency: purchase.currency,
          amountBaseUnits: stored.amountBaseUnits,
          token: stored.token,
          tokenDecimals: purchase.tokenDecimals,
          treasury: stored.treasury,
          chainId: stored.chainId,
          payer: owner,
          expiresAt: stored.expiresAt.toISOString(),
          registerTypedDataHint: eip712Domain
            ? { domain: eip712Domain, primaryType: 'Register' }
            : null,
        },
        errors: [],
        meta: meta(true),
      },
      201,
    );
  });

  /* ------------------------------------------------------------------ */
  /* POST /v1/names/purchase  (D19)                                      */
  /* ------------------------------------------------------------------ */
  /**
   * Settles a paid purchase: verifies the register signature, the quote, the
   * on-chain payment and the payment's uniqueness — in that order — then has
   * the issuer sponsor the registration. The NOT_INVITED gate of the claim
   * route is deliberately absent: paying is the invitation-free path.
   */
  app.post('/v1/names/purchase', async (c) => {
    const purchase = config.pricing.purchase;
    if (!purchase?.enabled || !eip712Domain || !registrarAddress) {
      return c.json(
        {
          summary: { zh: '付费购买还没有开放。', en: 'Paid purchase is not open yet.' },
          errors: [
            boom('PURCHASE_NOT_ENABLED', 'purchase is disabled in config', {
              zh: '付费购买还没有开放。',
              en: 'Paid purchase is not open yet.',
            }),
          ],
          meta: meta(false),
        },
        503,
      );
    }

    let body: Record<string, unknown>;
    try {
      body = (await c.req.json()) as Record<string, unknown>;
    } catch {
      return c.json(
        {
          summary: { zh: '请求格式不对。', en: 'The request body is not valid JSON.' },
          errors: [boom('BAD_REQUEST', 'invalid JSON body', { zh: '请求格式不对。', en: 'The request body is not valid JSON.' })],
          meta: meta(false),
        },
        400,
      );
    }

    const rawLabel = typeof body.label === 'string' ? body.label : '';
    const owner = typeof body.owner === 'string' ? (body.owner as Address) : null;
    const signature = typeof body.signature === 'string' ? (body.signature as Hex) : null;
    const quoteId = typeof body.quoteId === 'string' ? body.quoteId : null;
    const paymentTxHash = typeof body.paymentTxHash === 'string' ? (body.paymentTxHash as Hex) : null;
    const deadlineRaw = body.deadline;
    const via = body.via === 'mcp' ? 'mcp' : 'web';
    const agentHost = typeof body.agentHost === 'string' ? body.agentHost : null;

    if (
      !rawLabel ||
      !owner ||
      !/^0x[0-9a-fA-F]{40}$/.test(owner) ||
      !signature ||
      !quoteId ||
      !paymentTxHash ||
      !/^0x[0-9a-fA-F]{64}$/.test(paymentTxHash) ||
      deadlineRaw === undefined
    ) {
      return c.json(
        {
          summary: {
            zh: '缺少购买所需的信息（名字、地址、签名、报价或付款交易）。',
            en: 'Missing one of: label, owner, signature, quote or payment transaction.',
          },
          errors: [
            boom('BAD_REQUEST', 'label, owner, deadline, signature, quoteId and paymentTxHash are required', {
              zh: '缺少购买所需的信息（名字、地址、签名、报价或付款交易）。',
              en: 'Missing one of: label, owner, signature, quote or payment transaction.',
            }),
          ],
          meta: meta(false),
        },
        400,
      );
    }

    let deadline: bigint;
    try {
      deadline = BigInt(deadlineRaw as string | number | bigint);
    } catch {
      return c.json(
        {
          summary: { zh: '签名有效期格式不对。', en: 'The deadline is not a valid number.' },
          errors: [boom('BAD_REQUEST', 'deadline must be a unix timestamp', { zh: '签名有效期格式不对。', en: 'The deadline is not a valid number.' })],
          meta: meta(false),
        },
        400,
      );
    }

    // 1. Signature first, exactly like the claim route.
    let signatureValid = false;
    try {
      signatureValid = await verifyRegisterSignature({
        address: owner,
        signature,
        domain: eip712Domain,
        message: registerMessage({ label: rawLabel, owner, deadline }),
        now: BigInt(Math.floor(clock().getTime() / 1000)),
      });
    } catch (error) {
      return c.json(
        {
          summary: { zh: '签名已经过期了，请重新签名。', en: 'That signature has expired; please sign again.' },
          errors: [
            boom(
              isMusePassError(error) ? error.code : 'INVALID_SIGNATURE',
              error instanceof Error ? error.message : String(error),
              { zh: '签名已经过期了，请重新签名。', en: 'That signature has expired; please sign again.' },
            ),
          ],
          meta: meta(false),
        },
        401,
      );
    }
    if (!signatureValid) {
      return c.json(
        {
          summary: {
            zh: '签名和这个名字或地址对不上。',
            en: 'The signature does not match this name and address.',
          },
          errors: [
            boom('INVALID_SIGNATURE', 'signature does not match label/owner/deadline', {
              zh: '签名和这个名字或地址对不上。',
              en: 'The signature does not match this name and address.',
            }),
          ],
          meta: meta(false),
        },
        401,
      );
    }

    let label: string;
    try {
      label = normalizeLabel(rawLabel).normalized;
    } catch (error) {
      return c.json(
        {
          summary: { zh: '这个名字不合规。', en: 'That name is not valid.' },
          errors: [
            boom(
              isMusePassError(error) ? error.code : 'INVALID_NAME',
              error instanceof Error ? error.message : String(error),
              { zh: '这个名字不合规。', en: 'That name is not valid.' },
            ),
          ],
          meta: meta(false),
        },
        400,
      );
    }

    // 2. The quote: right label, right owner, still open, not expired.
    const quote = await purchases.findQuote(quoteId);
    if (!quote) {
      return c.json(
        {
          summary: { zh: '没有这个报价。', en: 'No such purchase quote.' },
          errors: [
            boom('NOT_FOUND', 'unknown quote id', { zh: '没有这个报价。', en: 'No such purchase quote.' }),
          ],
          meta: meta(false),
        },
        404,
      );
    }
    if (quote.status === 'settled' && quote.owner.toLowerCase() === owner.toLowerCase() && quote.label === label) {
      // Idempotent: the same wallet asking again about its settled purchase.
      return c.json({
        summary: {
          zh: `${label} 已经买好、注册完成了。`,
          en: `${label} is already bought and registered.`,
        },
        data: {
          label,
          fullName: `${label}.${config.brand.rootName}`,
          owner,
          txHash: quote.registerTxHash,
          paymentTxHash: quote.paymentTxHash,
          quoteId: quote.id,
          paid: true,
          alreadyRegistered: true,
        },
        errors: [],
        meta: meta(true),
      });
    }
    if (quote.label !== label || quote.owner.toLowerCase() !== owner.toLowerCase()) {
      return c.json(
        {
          summary: {
            zh: '这个报价是给另一个名字或另一个钱包的。',
            en: 'This quote is for a different name or wallet.',
          },
          errors: [
            boom('QUOTE_MISMATCH', 'quote does not match label/owner', {
              zh: '这个报价是给另一个名字或另一个钱包的。',
              en: 'This quote is for a different name or wallet.',
            }),
          ],
          meta: meta(false),
        },
        409,
      );
    }
    if (quote.status !== 'open' && quote.status !== 'settling') {
      return c.json(
        {
          summary: { zh: '这个报价已经失效了。', en: 'This quote is no longer open.' },
          errors: [
            boom('QUOTE_NOT_OPEN', `quote status is ${quote.status}`, {
              zh: '这个报价已经失效了。',
              en: 'This quote is no longer open.',
            }),
          ],
          meta: meta(false),
        },
        409,
      );
    }
    if (quote.expiresAt <= clock()) {
      if (quote.status === 'open') await purchases.markStatus(quote.id, 'expired', clock());
      return c.json(
        {
          summary: {
            zh: '报价过期了，请重新获取一个新的报价；已付的钱不会被再次要求。',
            en: 'The quote expired; request a new one. An already-bound payment is never charged again.',
          },
          errors: [
            boom('EXPIRED', 'purchase quote expired', {
              zh: '报价过期了，请重新获取一个新的报价；已付的钱不会被再次要求。',
              en: 'The quote expired; request a new one. An already-bound payment is never charged again.',
            }),
          ],
          meta: meta(false),
        },
        410,
      );
    }

    // 3. The label must still be free. If it was taken after payment, the money
    //    is at the treasury; say so and keep the quote for the support refund.
    let onChainFree: boolean;
    try {
      onChainFree = await chain.isLabelAvailable(label);
    } catch (error) {
      return c.json(
        {
          summary: {
            zh: '链上暂时查不通，没有做任何修改，请稍后再试。',
            en: 'The chain is not reachable right now; nothing was changed, please retry.',
          },
          errors: [
            boom('CHAIN_UNAVAILABLE', error instanceof Error ? error.message : String(error), {
              zh: '链上暂时查不通，没有做任何修改，请稍后再试。',
              en: 'The chain is not reachable right now; nothing was changed, please retry.',
            }),
          ],
          meta: meta(false),
        },
        503,
      );
    }
    if (!onChainFree) {
      return c.json(
        {
          summary: {
            zh: `付款之后 ${label} 被别人注册了。你的钱在国库地址上，联系 ${config.brand.supportEmail} 安排退款。`,
            en: `${label} was taken after your payment. Your money is at the treasury; contact ${config.brand.supportEmail} for a refund.`,
          },
          data: { label, treasury: quote.treasury, paymentTxHash: quote.paymentTxHash ?? paymentTxHash },
          errors: [
            boom('NAME_TAKEN', 'label was registered between quote and purchase', {
              zh: `名字在付款后被别人注册了；联系 ${config.brand.supportEmail} 退款。`,
              en: `The name was taken after payment; contact ${config.brand.supportEmail} for a refund.`,
            }),
          ],
          meta: meta(true),
        },
        409,
      );
    }

    const policy = checkLabel(label, {
      config,
      reservedIndex,
      onChainFree,
      invitation: null,
      allowPremium: true,
    });
    if (!policy.policyOk) {
      return c.json(
        {
          summary: policy.summary,
          data: { label, suggestions: [] },
          errors: policy.issues.map((issue) => ({ code: issue.code, message: issue.message })),
          meta: meta(true),
        },
        409,
      );
    }

    // 4. Rate limits and the paid daily cap. No invitation check by design.
    const startOfDay = new Date(clock());
    startOfDay.setUTCHours(0, 0, 0, 0);
    const perDay = config.limits.purchase?.perDayPerWallet ?? 20;
    if ((await purchases.countSettledForOwnerSince(owner, startOfDay)) >= perDay) {
      return c.json(
        {
          summary: {
            zh: `今天已经买了 ${perDay} 个名字，明天再继续。`,
            en: `You already bought ${perDay} names today; continue tomorrow.`,
          },
          errors: [
            boom('PURCHASE_LIMIT', `daily purchase cap of ${perDay} reached`, {
              zh: `今天已经买了 ${perDay} 个名字，明天再继续。`,
              en: `You already bought ${perDay} names today; continue tomorrow.`,
            }),
          ],
          meta: meta(true),
        },
        429,
      );
    }
    if (!rateLimit(c, `purchase:${owner.toLowerCase()}`, config.limits.rateLimits.claimPerHourPerWallet)) {
      return c.json(
        {
          summary: { zh: '太频繁了，请稍后再试。', en: 'Too many requests; please retry later.' },
          errors: [
            boom('RATE_LIMITED', 'purchase rate limit exceeded', {
              zh: '太频繁了，请稍后再试。',
              en: 'Too many requests; please retry later.',
            }),
          ],
          meta: meta(true),
        },
        429,
      );
    }
    const clientIp = (c.req.header('x-forwarded-for') ?? '').split(',')[0].trim();
    if (clientIp && !rateLimit(c, `purchase-ip:${clientIp}`, config.limits.rateLimits.claimPerHourPerIp)) {
      return c.json(
        {
          summary: { zh: '太频繁了，请稍后再试。', en: 'Too many requests; please retry later.' },
          errors: [
            boom('RATE_LIMITED', 'purchase rate limit exceeded for this address', {
              zh: '太频繁了，请稍后再试。',
              en: 'Too many requests; please retry later.',
            }),
          ],
          meta: meta(true),
        },
        429,
      );
    }

    // 5. Verify the payment on-chain, then bind it to this quote.
    const verified = await chain.verifyPayment({
      txHash: paymentTxHash,
      token: quote.token,
      from: owner,
      to: quote.treasury,
      minAmount: BigInt(quote.amountBaseUnits),
    });
    if (!verified.ok) {
      const copy: Record<string, BilingualText> = {
        NOT_FOUND: {
          zh: '链上还查不到这笔付款；等交易确认后再重新提交，报价仍然有效。',
          en: 'The payment transaction is not visible yet; wait for it to confirm and resubmit. The quote stays open.',
        },
        REVERTED: {
          zh: '这笔付款交易失败了，请重新付款后再提交。',
          en: 'The payment transaction reverted; pay again and resubmit.',
        },
        WRONG_TOKEN: {
          zh: '付款用的代币不对：必须用 USDG。',
          en: 'Wrong token: payment must be in USDG.',
        },
        WRONG_FROM: {
          zh: '付款的钱包和注册的钱包不是同一个。',
          en: 'The payment came from a different wallet than the one registering.',
        },
        WRONG_TO: {
          zh: '收款地址不对：钱必须付到报价里的国库地址。',
          en: 'Wrong recipient: the payment must go to the treasury address in the quote.',
        },
        INSUFFICIENT: {
          zh: '付款金额不足。',
          en: 'The paid amount is below the quoted price.',
        },
      };
      const status = verified.reason === 'NOT_FOUND' ? 409 : 402;
      return c.json(
        {
          summary: copy[verified.reason],
          data: { quoteId: quote.id, expectedAmountBaseUnits: quote.amountBaseUnits, token: quote.token, treasury: quote.treasury },
          errors: [
            boom(`PAYMENT_${verified.reason}`, `payment verification failed: ${verified.reason}`, copy[verified.reason]),
          ],
          meta: meta(false),
        },
        status,
      );
    }

    // 6. Bind the payment (double-spend guard) and sponsor the registration.
    const settled = await purchases.settleQuote(quote.id, paymentTxHash, clock());
    if (!settled) {
      return c.json(
        {
          summary: {
            zh: '这笔付款交易已经用过了一次，一笔付款只能买一个名字。',
            en: 'This payment transaction was already used; one payment buys exactly one name.',
          },
          data: { quoteId: quote.id },
          errors: [
            boom('PAYMENT_ALREADY_USED', 'payment tx hash is bound to another purchase', {
              zh: '这笔付款交易已经用过了一次，一笔付款只能买一个名字。',
              en: 'This payment transaction was already used; one payment buys exactly one name.',
            }),
          ],
          meta: meta(true),
        },
        409,
      );
    }

    let txHash: Hex;
    let node: Hex;
    try {
      const result = await chain.register({ label, owner, deadline, signature });
      txHash = result.txHash;
      node = result.node;
    } catch (error) {
      // Registration failed: reopen so the same payment can be retried.
      await purchases.reopenQuote(quote.id);
      return c.json(
        {
          summary: {
            zh: '注册失败了，钱不会被要求再付一次；用同一个报价重试即可。',
            en: 'Registration failed and you will not be charged again; retry with the same quote.',
          },
          data: { quoteId: quote.id, paymentTxHash },
          errors: [
            boom('CHAIN_ERROR', error instanceof Error ? error.message : String(error), {
              zh: '注册失败了，钱不会被要求再付一次；用同一个报价重试即可。',
              en: 'Registration failed and you will not be charged again; retry with the same quote.',
            }),
          ],
          meta: meta(false),
        },
        502,
      );
    }

    const record = await names.insert({
      label,
      fullName: `${label}.${config.brand.rootName}`,
      normalized: label,
      ownerAddress: owner,
      tier: quote.kind === 'tier-4' ? 'premium' : 'free',
      status: 'active',
      registeredVia: via,
      agentHost,
      txHash,
    });
    await sponsorship.record({ wallet: owner, txHash, nameId: record.id, paid: true });
    await purchases.markSettled(quote.id, txHash, clock());

    return c.json(
      {
        summary: {
          zh: `搞定，${label}.${config.brand.rootName} 现在是你的了。`,
          en: `Done: ${label}.${config.brand.rootName} now belongs to you.`,
        },
        data: {
          label,
          fullName: record.fullName,
          owner,
          node,
          txHash,
          paymentTxHash,
          quoteId: quote.id,
          tier: record.tier,
          paid: true,
          alreadyRegistered: false,
        },
        errors: [],
        meta: meta(true),
      },
      201,
    );
  });

  app.notFound((c) =>
    c.json(
      {
        summary: { zh: '没有这个接口。', en: 'No such endpoint.' },
        errors: [boom('NOT_FOUND', 'unknown route', { zh: '没有这个接口。', en: 'No such endpoint.' })],
        meta: meta(false),
      },
      404,
    ),
  );

  return app;
}

export type MusenameApp = ReturnType<typeof createApp>;

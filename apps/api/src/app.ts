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
  isMuseNameError,
  labelFromFullName,
  namehash,
  normalizeLabel,
  parseCardDataUri,
  registerMessage,
  validateCard,
  verifyCardTextSignature,
  verifyRegisterSignature,
  type BilingualText,
  type LabelIssue,
  type VisibilityMap,
} from '@musename/core';
import { isAddress } from 'viem';
import type { ChainReader, MusenameDeps } from './deps.js';
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
  const { config, reservedIndex, chain, names, requests, cards, sponsorship, clock } = deps;
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
        pricing: {
          currency: pricing.currency,
          freeMinUnits: pricing.freeTier.minUnits,
          lengthMetric: limits.lengthMetric,
          premiumTiers: pricing.premiumTiers.map((tier) => ({
            id: tier.id,
            minUnits: tier.minCodePoints,
            maxUnits: tier.maxCodePoints,
            priceUsd: tier.priceUsd,
            // Phase 1 refuses to sell premium names, so the front end must not
            // offer a purchase even though a price exists.
            sellable: tier.status !== 'placeholder',
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
          premiumPurchase: false,
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
      if (isMuseNameError(error) && error.code !== 'INVALID_CONFIG') {
        label = null;
      } else {
        chainError = error instanceof Error ? error.message : String(error);
      }
    }

    const result = checkLabel(label ?? rawName, { config, reservedIndex, onChainFree });

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
              isMuseNameError(error) ? error.code : 'INVALID_NAME',
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
              isMuseNameError(error) ? error.code : 'INVALID_NAME',
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
    // service disappears (ERC-8004 explicitly allows a base64 data URI).
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
            zh: `名片已经写进链上了，${label}.${config.brand.rootName} 的任何访问者都能读到。`,
            en: `The card is on chain; anyone reading ${label}.${config.brand.rootName} can see it.`,
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
              isMuseNameError(error) ? error.code : 'INVALID_NAME',
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
    // index — the index can lag, the registry cannot lie.
    let card: unknown = null;
    if (owner) {
      try {
        const record = await chain.readText(label, CARD_TEXT_KEY);
        const parsed = record ? parseCardDataUri(record) : null;
        if (parsed) {
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
          data: { label, fullName: `${label}.${config.brand.rootName}`, owner: null, card: null },
          errors: [],
          meta: meta(true),
        },
        404,
      );
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
              isMuseNameError(error) ? error.code : 'INVALID_NAME',
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
              isMuseNameError(error) ? error.code : 'INVALID_SIGNATURE',
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
              isMuseNameError(error) ? error.code : 'INVALID_NAME',
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
    const policy = checkLabel(label, { config, reservedIndex, onChainFree });

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

    // 4. sponsorship budget.
    const startOfDay = new Date(clock());
    startOfDay.setUTCHours(0, 0, 0, 0);
    const [walletFreeNames, walletSponsoredToday, walletSponsoredLifetime, platformSponsoredToday] =
      await Promise.all([
        names.listByOwner(owner).then((rows) => rows.length),
        sponsorship.countForWalletSince(owner, startOfDay),
        sponsorship.countForWalletLifetime(owner),
        sponsorship.countPlatformSince(startOfDay),
      ]);

    const quotaIssues = checkClaimQuota(
      { walletFreeNames, walletSponsoredToday, walletSponsoredLifetime, platformSponsoredToday },
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

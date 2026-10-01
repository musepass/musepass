/**
 * Typed client for the MusePass API.
 *
 * Every endpoint answers with the same envelope, so the front end never has to
 * guess: read `summary` to show a sentence, `data` for structure, `errors` for
 * machine readable reasons, and `meta.verified` to know whether the chain was
 * actually consulted.
 */

/**
 * Client for the MusePass API, shared by server components and client
 * components. The API is the only place the front end gets chain state from.
 */
export interface ApiSummary {
  zh: string;
  en: string;
}

export interface ApiErrorEntry {
  code: string;
  message: string;
}

export interface ApiMeta {
  asOf: string;
  chain: string;
  chainId: number;
  verified: boolean;
  root: string;
}

export interface ApiEnvelope<T> {
  summary: ApiSummary;
  data: T;
  errors: ApiErrorEntry[];
  meta: ApiMeta;
}

export interface PriceQuote {
  tier: 'free' | 'premium';
  tierId: string;
  priceUsd: number;
  currency: string;
  active: boolean;
}

export interface AvailabilityData {
  label: string | null;
  fullName: string | null;
  available: boolean | null;
  policyOk: boolean;
  onChainFree: boolean | null;
  price: PriceQuote | null;
  units: number | null;
  reserved: { category: string; appealable: boolean } | null;
  /** Null when the query did not say who is asking (no ?owner=). */
  invited: boolean | null;
  suggestions: string[];
}

export interface ClaimData {
  label: string;
  fullName: string;
  owner: `0x${string}`;
  node?: `0x${string}`;
  txHash: `0x${string}` | null;
  tier: string;
  alreadyRegistered: boolean;
}

/**
 * A card as the API serves it: only the fields the owner published, plus the
 * content hash so a reader can verify the record independently.
 */
export interface RedactedCard {
  name?: string;
  address?: string;
  description?: string;
  image?: string;
  services?: Array<{ name: string; endpoint: string; version?: string }>;
  x402Support?: boolean;
  active?: boolean;
  registrations?: Array<{ agentId: number; agentRegistry: string }>;
  supportedTrust?: string[];
  owner?: string;
  host?: string;
  contact?: string;
  payoutAddress?: string;
  trackRecordEndpoint?: string;
  contentHash?: string;
}

export interface NameData {
  label: string;
  fullName: string;
  owner: `0x${string}` | null;
  card: RedactedCard | null;
  /** D18: genesis cover number, only for a card-publishing name in the first 1,000. */
  genesis?: { number: number } | null;
  trackRecord: unknown | null;
  index?: { tier: string; registeredAt: string; registeredVia: string } | null;
}

export type RequestStatus = 'pending' | 'confirmed' | 'expired' | 'rejected';

export interface RequestData {
  requestId: string;
  label: string;
  fullName: string;
  status: RequestStatus;
  requestedFor: string;
  requestedByHost: string | null;
  expiresAt: string;
  confirmedAt: string | null;
}

export interface PublicConfig {
  productName: string;
  /** English only: the site must not render Chinese. The API may still send zh. */
  tagline: { en: string; zh?: string };
  rootName: string;
  siteUrl: string;
  supportEmail: string;
  legalDisclaimer: { en: string; zh?: string };
  exampleLabel: string;
  chain: { name: string; chainId: number; explorer: string | null };
  registrar: string | null;
  l2Registry: string | null;
  usdc: string | null;
  pricing: {
    currency: string;
    freeMinUnits: number;
    lengthMetric: 'display-width' | 'code-points';
    premiumTiers: Array<{
      id: string;
      minUnits: number;
      maxUnits: number;
      priceUsd: number;
      sellable: boolean;
    }>;
    certificationMonthlyUsd: number;
  };
  limits: {
    freeNamesPerWallet: number;
    minLabelUnits: number;
    maxLabelBytes: number;
    confirmTokenTtlMinutes: number;
  };
  features: {
    cards: boolean;
    trackRecord: boolean;
    premiumPurchase: boolean;
    aiRegistration: boolean;
  };
}

/** Used when the API cannot be reached so the landing page still renders. */
export const FALLBACK_CONFIG: PublicConfig = {
  productName: 'MusePass',
  tagline: {
    en: 'Give your AI a passport: a name any wallet can read and a track record anyone can check. Names are issued by invitation.',
  },
  rootName: 'musepass.eth',
  siteUrl: 'https://musepass.xyz',
  supportEmail: 'support@musepass.xyz',
  legalDisclaimer: {
    en: 'MusePass is an independent project, not affiliated with Meta.',
  },
  exampleLabel: 'atlas',
  // The product moved to Robinhood Chain on 2026-09-29; a stale fallback would
  // send an integrator to the wrong explorer whenever the API is unreachable.
  // `apps/web/test/wellKnown.test.ts` compares these against config/chains.json.
  chain: { name: 'robinhood', chainId: 4663, explorer: 'https://robinhoodchain.blockscout.com' },
  registrar: '0xb1e8a90e5a9b1c8e69242bc70d928789d89c02b7',
  l2Registry: '0x4b959e1fb5567caa7fe21d0d2a7f870af705b792',
  usdc: null,
  pricing: {
    currency: 'USDC',
    freeMinUnits: 5,
    lengthMetric: 'display-width',
    // Mirrors config/pricing.json (D15). It cannot be empty: the landing page is
    // prerendered, and when the API is not reachable at build time the page falls
    // back to this object — which is how the price ladder rendered as a blank
    // space on a page that looked fine. `brandSurfaces.test.ts` compares these
    // against the config file on every test run.
    premiumTiers: [
      { id: 'tier-1', minUnits: 1, maxUnits: 1, priceUsd: 500, sellable: false },
      { id: 'tier-2', minUnits: 2, maxUnits: 2, priceUsd: 100, sellable: false },
      { id: 'tier-3', minUnits: 3, maxUnits: 3, priceUsd: 20, sellable: false },
      { id: 'tier-4', minUnits: 4, maxUnits: 4, priceUsd: 5, sellable: false },
    ],
    certificationMonthlyUsd: 5,
  },
  limits: {
    freeNamesPerWallet: 1,
    minLabelUnits: 1,
    maxLabelBytes: 255,
    confirmTokenTtlMinutes: 15,
  },
  features: { cards: false, trackRecord: false, premiumPurchase: false, aiRegistration: true },
};

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

export function apiBaseUrl(): string {
  // In the browser: same origin, always. The site and the API are served from
  // one host (`/v1/` is a path, not a domain), so a relative URL works wherever
  // the page was loaded from. That is not a detail — the first version baked in
  // `https://gw.musename.xyz` at build time, and when that DNS record briefly
  // disappeared, every button on the site stopped working while the site itself
  // still loaded, which is the most confusing possible failure.
  //
  // On the server: MUSENAME_API_URL, because a server component talking to
  // localhost should not take a round trip through the public hostname.
  // NEXT_PUBLIC_API_URL is still honoured if somebody sets it on purpose, for a
  // deployment that really does split the two.
  if (typeof window !== 'undefined') {
    const override = process.env.NEXT_PUBLIC_API_URL;
    return override ? override.replace(/\/$/, '') : '';
  }
  const base = process.env.MUSENAME_API_URL ?? 'http://localhost:3001';
  return base.replace(/\/$/, '');
}

interface RequestOptions {
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  options: RequestOptions = {},
): Promise<ApiEnvelope<T>> {
  const doFetch = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 8000);

  try {
    const response = await doFetch(apiBaseUrl() + path, {
      ...init,
      signal: controller.signal,
      headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
    });

    let payload: ApiEnvelope<T>;
    try {
      payload = (await response.json()) as ApiEnvelope<T>;
    } catch {
      throw new ApiError('BAD_RESPONSE', `The service returned something unreadable (HTTP ${response.status})`, response.status);
    }

    if (!response.ok && (!payload.errors || payload.errors.length === 0)) {
      throw new ApiError(
        'HTTP_ERROR',
        payload.summary?.en ?? `Request failed (HTTP ${response.status})`,
        response.status,
      );
    }
    return payload;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new ApiError('TIMEOUT', 'The service took too long to answer. Try again shortly.', 0);
    }
    throw new ApiError('NETWORK', 'Could not reach the name service. Check your connection or try again.', 0);
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * `owner` is optional: with it the answer also says whether *this wallet* may
 * take the name, which is how an invited wallet learns a 3–4 character name is
 * free for it.
 */
export function checkAvailability(
  name: string,
  owner?: string | null,
  options?: RequestOptions,
  xHandle?: string | null,
) {
  const params = new URLSearchParams();
  if (owner) params.set('owner', owner);
  if (xHandle) params.set('x', xHandle);
  const query = params.size > 0 ? `?${params.toString()}` : '';
  return request<AvailabilityData>(
    `/v1/names/${encodeURIComponent(name)}/available${query}`,
    {},
    options,
  );
}

export function fetchName(name: string, options?: RequestOptions) {
  return request<NameData>(`/v1/names/${encodeURIComponent(name)}`, {}, options);
}

export interface MetricsData {
  chain: {
    names: number | null;
    firstRegisteredBlock: number | null;
    owners: number;
    error: string | null;
    howToCheck: string;
  };
  index: { kind: 'memory' | 'postgres'; names: number; owners: number; warning?: string };
  namesWithCard: number;
  budget?: {
    freeNamesTotalCap: number;
    sponsoredToday: number;
    platformPerDay: number;
    sponsoredLifetime: number;
    estimatedSpentUsd: number;
    totalCapUsd: number;
    note: string;
  };
  byTier: Record<string, number>;
  byChannel: Record<string, number>;
  byStatus: Record<string, number>;
  firstRegisteredAt: string | null;
  notMeasured: Array<{ id: string; metric: string; why: string }>;
}

export function fetchMetrics(options?: RequestOptions) {
  return request<MetricsData>('/v1/metrics', {}, options);
}

export interface InvitationsData {
  campaign: string | null;
  opens: string | null;
  closes: string | null;
  issued: number;
  claimed: number;
  remaining: number;
  rule: { min: number; max: number } | null;
  claimsSource: 'memory' | 'postgres';
  noteEn: string;
}

/** Counts only — the API never publishes which wallets or handles are invited. */
export function fetchInvitations(options?: RequestOptions) {
  return request<InvitationsData>('/v1/invitations', {}, options);
}

export function fetchRequest(id: string, options?: RequestOptions) {
  return request<RequestData>(`/v1/requests/${encodeURIComponent(id)}`, {}, options);
}

export interface ClaimPayload {
  label: string;
  owner: string;
  deadline: number;
  signature: string;
  via?: 'web' | 'mcp';
  requestId?: string | null;
  confirmToken?: string | null;
  /** Proves the X login behind an X-handle invitation, when that is the path. */
  privyAccessToken?: string | null;
}

export function submitClaim(payload: ClaimPayload, options?: RequestOptions) {
  return request<ClaimData>(
    '/v1/names/claim',
    { method: 'POST', body: JSON.stringify(payload) },
    options,
  );
}

export interface PublishCardPayload {
  card: unknown;
  expiration: number;
  signer: string;
  signature: string;
}

export interface PublishCardData {
  label: string;
  fullName: string;
  txHash: `0x${string}`;
  contentHash: `0x${string}`;
  recordBytes: number;
  visibility: Record<string, string>;
  warnings: string[];
}

export function publishCard(name: string, payload: PublishCardPayload, options?: RequestOptions) {
  return request<PublishCardData>(
    `/v1/names/${encodeURIComponent(name)}/card`,
    { method: 'PUT', body: JSON.stringify(payload) },
    options,
  );
}

/**
 * Drop every Chinese string from anything the browser will receive.
 *
 * The API answers in several languages on purpose, and the config it returns
 * carries both. The site is English-only, and the config travels to the browser
 * inside the rendered payload — so a `zh` field nobody renders still ends up in
 * the HTML. Removing the translations here is the difference between "we do not
 * display Chinese" and "the page does not contain Chinese".
 *
 * Belt and braces: any string containing a CJK character is dropped, and any
 * key with nothing left is dropped with it.
 */
const CJK_CHAR = /[\u1100-\u11ff\u2e80-\u2fdf\u3000-\u303f\u3040-\u30ff\u3130-\u318f\u3400-\u4dbf\u4e00-\u9fff\ua960-\ua97f\uac00-\ud7ff\uf900-\ufaff\ufe30-\ufe4f\uff00-\uffef]/;

export function stripChinese<T>(value: T): T {
  if (typeof value === 'string') {
    return value.replace(CJK_CHAR, '') as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.filter((entry) => !(typeof entry === 'string' && CJK_CHAR.test(entry))).map(stripChinese) as unknown as T;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (typeof entry === 'string' && CJK_CHAR.test(entry)) continue;
      out[key] = stripChinese(entry);
    }
    return out as T;
  }
  return value;
}

export async function fetchConfig(options?: RequestOptions): Promise<PublicConfig> {
  try {
    const payload = await request<PublicConfig>('/v1/config', {}, options);
    return stripChinese(payload.data ?? FALLBACK_CONFIG);
  } catch {
    // The landing page must render even when the API is down.
    return stripChinese(FALLBACK_CONFIG);
  }
}

export interface OwnedName {
  label: string;
  fullName: string;
  owner: string;
  txHash: string | null;
  blockNumber: number;
}

export interface OwnedNamesData {
  owner: string;
  count: number;
  names: OwnedName[];
  rootName: string;
}

/** The names a wallet holds, read from the registrar's events. */
export async function fetchOwnedNames(owner: string, options?: RequestOptions) {
  return request<OwnedNamesData>(`/v1/names?owner=${encodeURIComponent(owner)}`, {}, options);
}

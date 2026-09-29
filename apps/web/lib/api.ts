/**
 * Typed client for the MuseName API.
 *
 * Every endpoint answers with the same envelope, so the front end never has to
 * guess: read `summary` to show a sentence, `data` for structure, `errors` for
 * machine readable reasons, and `meta.verified` to know whether the chain was
 * actually consulted.
 */

/**
 * Client for the MuseName API, shared by server components and client
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
  tagline: { zh: string; en: string };
  rootName: string;
  siteUrl: string;
  supportEmail: string;
  legalDisclaimer: { zh: string; en: string };
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
  productName: 'MuseName',
  tagline: { zh: '给每个 AI 一个可信的名字', en: 'Give every AI a name worth trusting' },
  rootName: 'musename.eth',
  siteUrl: 'https://musename.xyz',
  supportEmail: 'support@musename.xyz',
  legalDisclaimer: {
    zh: 'MuseName 是独立项目，与 Meta 及其任何产品无关。',
    en: 'MuseName is an independent project, not affiliated with Meta.',
  },
  exampleLabel: 'xiaoming',
  chain: { name: 'base', chainId: 8453, explorer: 'https://basescan.org' },
  registrar: null,
  l2Registry: null,
  usdc: null,
  pricing: {
    currency: 'USDC',
    freeMinUnits: 5,
    lengthMetric: 'display-width',
    premiumTiers: [],
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
  // NEXT_PUBLIC_* is inlined for the browser; MUSENAME_API_URL is read at
  // runtime on the server, so one build can be pointed at any environment.
  const base =
    process.env.NEXT_PUBLIC_API_URL ??
    process.env.MUSENAME_API_URL ??
    'http://localhost:3001';
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
      throw new ApiError('BAD_RESPONSE', `服务返回了无法解析的内容 (HTTP ${response.status})`, response.status);
    }

    if (!response.ok && (!payload.errors || payload.errors.length === 0)) {
      throw new ApiError(
        'HTTP_ERROR',
        payload.summary?.zh ?? `请求失败 (HTTP ${response.status})`,
        response.status,
      );
    }
    return payload;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new ApiError('TIMEOUT', '服务响应太慢，请稍后再试。', 0);
    }
    throw new ApiError('NETWORK', '连不上名字服务，请检查网络或稍后再试。', 0);
  } finally {
    clearTimeout(timeout);
  }
}

export function checkAvailability(name: string, options?: RequestOptions) {
  return request<AvailabilityData>(`/v1/names/${encodeURIComponent(name)}/available`, {}, options);
}

export function fetchName(name: string, options?: RequestOptions) {
  return request<NameData>(`/v1/names/${encodeURIComponent(name)}`, {}, options);
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

export async function fetchConfig(options?: RequestOptions): Promise<PublicConfig> {
  try {
    const payload = await request<PublicConfig>('/v1/config', {}, options);
    return payload.data ?? FALLBACK_CONFIG;
  } catch {
    // The landing page must render even when the API is down.
    return FALLBACK_CONFIG;
  }
}

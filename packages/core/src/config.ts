import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { MusePassError } from './errors.js';

export interface BrandConfig {
  productName: string;
  tagline: { en: string; zh: string };
  siteUrl: string;
  supportEmail: string;
  /** ENS root name, e.g. `musepass.eth`. Comes from config so a rename is a config change only. */
  rootName: string;
  legalDisclaimer: { en: string; zh: string };
  naming: { subnameSuffix: string; exampleLabel: string };
  /** Fallback identity if the primary brand has to be retired. See docs/decisions.md D7. */
  backupBrand?: { productName: string; rootName: string; siteUrl: string };
}

export interface ChainInfo {
  name: string;
  chainId: number;
  rpcEnv: string;
  explorer?: string;
  durinRegistryFactory?: string;
  durinL1Resolver?: string;
  l2Registry?: string;
  registrar?: string;
  usdc?: string;
  /** Resolved from `rpcEnv` at load time. */
  rpcUrl?: string;
}

export interface ChainsConfig {
  l1: ChainInfo;
  l2: ChainInfo;
  l2Testnet: ChainInfo;
}

export interface PremiumTier {
  id: string;
  minCodePoints: number;
  maxCodePoints: number;
  priceUsd: number;
  status: string;
}

export interface PricingConfig {
  currency: string;
  freeTier: { minUnits: number };
  premiumTiers: PremiumTier[];
  certification: { monthlyUsd: number; status: string; phase: number };
}

export interface LimitsConfig {
  freeNamesPerWallet: number;
  /** 'display-width' counts East Asian wide characters as two columns. */
  lengthMetric: 'display-width' | 'code-points';
  minLabelUnitsPremium: number;
  maxLabelBytes: number;
  labelPolicy: {
    allowEmoji: boolean;
    disallowMixedConfusableScripts: boolean;
    disallowEdgeHyphen: boolean;
  };
  sponsorship: {
    perWalletPerDay: number;
    perWalletLifetime: number;
    platformPerDay: number;
    platformTotalCapUsd: number;
    estimatedGasUsdPerName: number;
  };
  registrationRequest: {
    confirmTokenTtlMinutes: number;
    maxOpenRequestsPerHost: number;
    maxOpenRequestsPerOwner: number;
  };
  rateLimits: {
    availabilityPerMinutePerIp: number;
    claimPerHourPerWallet: number;
    mcpRequestsPerHourPerHost: number;
  };
}

export interface ReservedCategory {
  note?: string;
  labels: string[];
  patterns: string[];
}

export interface ReservedConfig {
  version: number;
  reviewStatus?: string;
  categories: Record<string, ReservedCategory>;
  appeal?: { allowed: boolean; channel: string; slaHours: number };
}

export interface MusenameConfig {
  configDir: string;
  brand: BrandConfig;
  chains: ChainsConfig;
  pricing: PricingConfig;
  limits: LimitsConfig;
  reserved: ReservedConfig;
  /** D17: who may take a three or four character name for free. */
  invitations: InvitationsConfig;
  /** Origins allowed to call the API from a browser. Config, not code. */
  allowedOrigins: string[];
}

export interface InvitationsConfig {
  campaign?: string;
  opens?: string | null;
  closes?: string | null;
  rules?: { freeLabelUnits?: { min: number; max: number } };
  invitations: Invitation[];
}

import type { Invitation } from './invitations.js';

export interface LoadConfigOptions {
  configDir?: string;
  env?: Record<string, string | undefined>;
}

function readJson<T>(path: string): T {
  if (!existsSync(path)) {
    throw new MusePassError('INVALID_CONFIG', `config file not found: ${path}`, { path });
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch (error) {
    throw new MusePassError('INVALID_CONFIG', `config file is not valid JSON: ${path}`, {
      path,
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Walks upwards looking for `config/brand.json`. Lets every app and script load
 * the same config without hardcoding a relative path.
 */
export function findRepoRoot(startDir: string = process.cwd()): string {
  let current = resolve(startDir);
  for (let depth = 0; depth < 12; depth += 1) {
    if (existsSync(join(current, 'config', 'brand.json'))) return current;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new MusePassError('INVALID_CONFIG', `could not find repo root from ${startDir}`, { startDir });
}

export function resolveConfigDir(options: LoadConfigOptions = {}): string {
  const env = options.env ?? process.env;
  if (options.configDir) return resolve(options.configDir);
  if (env.MUSENAME_CONFIG_DIR) return resolve(env.MUSENAME_CONFIG_DIR);
  return join(findRepoRoot(), 'config');
}

function applyEnvOverrides(config: MusenameConfig, env: Record<string, string | undefined>): MusenameConfig {
  const brand = { ...config.brand };
  if (env.MUSENAME_BRAND) brand.productName = env.MUSENAME_BRAND;

  const withRpc = (chain: ChainInfo): ChainInfo => ({
    ...chain,
    rpcUrl: env[chain.rpcEnv] ?? chain.rpcUrl,
  });

  const l2 = withRpc(config.chains.l2);
  const l2Testnet = withRpc(config.chains.l2Testnet);
  const l1 = withRpc(config.chains.l1);

  if (env.MUSENAME_L2_REGISTRY) l2.l2Registry = env.MUSENAME_L2_REGISTRY;
  if (env.MUSENAME_REGISTRAR) l2.registrar = env.MUSENAME_REGISTRAR;
  // Lets `pnpm verify:local` and any local node stand in for Base without
  // editing config/chains.json.
  if (env.MUSENAME_L2_CHAIN_ID) l2.chainId = Number(env.MUSENAME_L2_CHAIN_ID);
  if (env.MUSENAME_RPC_URL) l2.rpcUrl = env.MUSENAME_RPC_URL;
  if (env.MUSENAME_L1_RESOLVER) l1.durinL1Resolver = env.MUSENAME_L1_RESOLVER;

  // Pointing the network at a testnet should also bring that testnet's
  // addresses along. Without this, `MUSENAME_L2_CHAIN_ID=84532` would talk to
  // Base Sepolia while still reading the (empty) mainnet address slots.
  if (l2.chainId === l2Testnet.chainId) {
    if (!l2.l2Registry) l2.l2Registry = l2Testnet.l2Registry;
    if (!l2.registrar) l2.registrar = l2Testnet.registrar;
    if (!l2.usdc) l2.usdc = l2Testnet.usdc;
    if (!l2.explorer) l2.explorer = l2Testnet.explorer;
  }

  return { ...config, brand, chains: { l1, l2, l2Testnet } };
}

function assertShape(config: MusenameConfig): void {
  const require = (condition: unknown, message: string, details?: Record<string, unknown>) => {
    if (!condition) throw new MusePassError('INVALID_CONFIG', message, details ?? {});
  };

  require(config.brand?.productName, 'config/brand.json: productName is required');
  require(config.brand?.rootName, 'config/brand.json: rootName is required');
  require(
    typeof config.brand.rootName === 'string' && config.brand.rootName.endsWith('.eth'),
    'config/brand.json: rootName must be a .eth name',
    { rootName: config.brand?.rootName },
  );
  require(config.chains?.l2?.chainId, 'config/chains.json: l2.chainId is required');
  require(config.chains?.l1?.chainId, 'config/chains.json: l1.chainId is required');
  require(config.limits?.freeNamesPerWallet >= 0, 'config/limits.json: freeNamesPerWallet is required');
  require(config.limits?.maxLabelBytes > 0, 'config/limits.json: maxLabelBytes is required');
  require(config.pricing?.freeTier, 'config/pricing.json: freeTier is required');
  require(config.reserved?.categories, 'config/reserved-names.json: categories are required');
}

export function loadConfig(options: LoadConfigOptions = {}): MusenameConfig {
  const env = options.env ?? process.env;
  const configDir = resolveConfigDir(options);

  const config: MusenameConfig = {
    configDir,
    brand: readJson<BrandConfig>(join(configDir, 'brand.json')),
    chains: readJson<ChainsConfig>(join(configDir, 'chains.json')),
    pricing: readJson<PricingConfig>(join(configDir, 'pricing.json')),
    limits: readJson<LimitsConfig>(join(configDir, 'limits.json')),
    reserved: readJson<ReservedConfig>(join(configDir, 'reserved-names.json')),
    invitations: readJson<InvitationsConfig>(join(configDir, 'invitations.json')),
    allowedOrigins: [],
  };

  assertShape(config);
  return applyEnvOverrides({ ...config, allowedOrigins: resolveAllowedOrigins(config, env) }, env);
}

function resolveAllowedOrigins(
  config: MusenameConfig,
  env: Record<string, string | undefined>,
): string[] {
  if (env.MUSENAME_ALLOWED_ORIGINS) {
    return env.MUSENAME_ALLOWED_ORIGINS.split(',')
      .map((origin) => origin.trim())
      .filter(Boolean);
  }
  const origins = new Set<string>();
  try {
    origins.add(new URL(config.brand.siteUrl).origin);
  } catch {
    // A malformed siteUrl should not stop the API from booting.
  }
  if (config.chains.l2.explorer) {
    try {
      origins.add(new URL(config.chains.l2.explorer).origin);
    } catch {
      // ignore
    }
  }
  for (const dev of ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:3100']) {
    origins.add(dev);
  }
  return [...origins];
}

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { MuseNameError } from './errors.js';

export interface BrandConfig {
  productName: string;
  tagline: { en: string; zh: string };
  siteUrl: string;
  supportEmail: string;
  /** ENS root name, e.g. `musename.eth`. Comes from config so a rename is a config change only. */
  rootName: string;
  legalDisclaimer: { en: string; zh: string };
  naming: { subnameSuffix: string; exampleLabel: string };
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
}

export interface LoadConfigOptions {
  configDir?: string;
  env?: Record<string, string | undefined>;
}

function readJson<T>(path: string): T {
  if (!existsSync(path)) {
    throw new MuseNameError('INVALID_CONFIG', `config file not found: ${path}`, { path });
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch (error) {
    throw new MuseNameError('INVALID_CONFIG', `config file is not valid JSON: ${path}`, {
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
  throw new MuseNameError('INVALID_CONFIG', `could not find repo root from ${startDir}`, { startDir });
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
  if (env.MUSENAME_L1_RESOLVER) l1.durinL1Resolver = env.MUSENAME_L1_RESOLVER;

  return { ...config, brand, chains: { l1, l2, l2Testnet } };
}

function assertShape(config: MusenameConfig): void {
  const require = (condition: unknown, message: string, details?: Record<string, unknown>) => {
    if (!condition) throw new MuseNameError('INVALID_CONFIG', message, details ?? {});
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
  };

  assertShape(config);
  return applyEnvOverrides(config, env);
}

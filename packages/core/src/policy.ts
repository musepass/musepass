import type { MusenameConfig } from './config.js';
import { checkScriptMixing, hasEmoji } from './confusables.js';
import { isMusePassError, type MusePassErrorCode } from './errors.js';
import { invitedShortNameDecision, type Invitation } from './invitations.js';
import { fullNameFromLabel, measureLength, normalizeLabel } from './normalize.js';
import { quoteLabel, type PriceQuote } from './pricing.js';
import { checkReserved, type ReservedHit, type ReservedIndex } from './reserved.js';

export interface BilingualText {
  zh: string;
  en: string;
}

export interface LabelIssue {
  code: MusePassErrorCode;
  message: string;
  field?: string;
}

export interface LabelCheckResult {
  summary: BilingualText;
  /** True when every rule this module can check without the chain passed. */
  policyOk: boolean;
  /** Null when the caller did not supply an on-chain read. */
  available: boolean | null;
  onChainFree: boolean | null;
  /** Normalized label; null when normalization itself failed. */
  label: string | null;
  fullName: string | null;
  codePoints: number | null;
  /** Length in the configured metric (display width by default). */
  units: number | null;
  bytes: number | null;
  price: PriceQuote | null;
  reserved: ReservedHit | null;
  issues: LabelIssue[];
}

export interface LabelCheckOptions {
  config: MusenameConfig;
  reservedIndex: ReservedIndex;
  /** Result of the on-chain availability read. Undefined/null means "not checked yet". */
  onChainFree?: boolean | null;
  /** Phase 1 rejects anything that is not a free name; phase 6 turns this on. */
  allowPremium?: boolean;
  /**
   * D17: an unclaimed invitation makes a 3–4 unit name free for the wallet it
   * belongs to. Without it (the default) short names stay behind the premium
   * gate, exactly as before.
   */
  invitation?: Invitation | null;
}

const SUMMARY: Record<string, BilingualText> = {
  ok: { zh: '这个名字可以用。', en: 'This name is available.' },
  taken: { zh: '这个名字已经被注册了。', en: 'This name is already taken.' },
  reserved: { zh: '这个名字被保留，需要人工审核后才能发放。', en: 'This name is reserved and needs manual review.' },
  tooShort: { zh: '这个名字太短了，免费名字至少 5 个字符。', en: 'This name is too short: free names need at least 5 characters.' },
  premium: { zh: '这个名字属于靓号，目前还没开放购买。', en: 'This name is a premium name and is not on sale yet.' },
  empty: { zh: '没有收到名字。', en: 'No name was provided.' },
  invalid: { zh: '这个名字不合规，换一个吧。', en: 'This name is not valid; please pick another one.' },
  invalidChars: { zh: '这个名字里有 ENS 不支持的字符。', en: 'This name contains characters ENS does not allow.' },
  mixedScript: { zh: '这个名字混用了长得像的不同文字，可能被用来冒充别人。', en: 'This name mixes look-alike scripts and could be used to impersonate someone.' },
  emoji: { zh: '名字里暂时不能包含表情符号。', en: 'Names cannot contain emoji yet.' },
  tooLong: { zh: '这个名字太长了。', en: 'This name is too long.' },
};

function issueToSummary(issue: LabelIssue): BilingualText {
  switch (issue.code) {
    case 'EMPTY_LABEL':
      return SUMMARY.empty;
    case 'INVALID_NAME':
      return SUMMARY.invalid;
    case 'INVALID_CHARACTER':
      return SUMMARY.invalidChars;
    case 'MIXED_SCRIPT':
      return SUMMARY.mixedScript;
    case 'EMOJI_NOT_ALLOWED':
      return SUMMARY.emoji;
    case 'LABEL_TOO_SHORT':
      return SUMMARY.tooShort;
    case 'LABEL_TOO_LONG':
    case 'LABEL_TOO_MANY_BYTES':
      return SUMMARY.tooLong;
    case 'NOT_FREE_TIER':
    case 'QUOTA_EXCEEDED':
    case 'SPONSORSHIP_EXCEEDED':
      return SUMMARY.premium;
    case 'RESERVED_NAME':
      return SUMMARY.reserved;
    case 'NAME_TAKEN':
      return SUMMARY.taken;
    default:
      return SUMMARY.invalid;
  }
}

/**
 * One place that answers "can this exact string become a name?".
 *
 * Order matters: normalization first (it decides what the label even is), then
 * length, then look-alike scripts, then the reserved list, then the chain.
 */
export function checkLabel(rawLabel: string, options: LabelCheckOptions): LabelCheckResult {
  const { config, reservedIndex } = options;
  const onChainFree = options.onChainFree ?? null;
  const issues: LabelIssue[] = [];

  let label: string | null = null;
  let fullName: string | null = null;
  let codePoints: number | null = null;
  let units: number | null = null;
  let bytes: number | null = null;
  let price: PriceQuote | null = null;
  let reserved: ReservedHit | null = null;

  try {
    const normalized = normalizeLabel(typeof rawLabel === 'string' ? rawLabel : '');
    label = normalized.normalized;
    codePoints = normalized.codePoints;
    units = measureLength(normalized.normalized, config.limits.lengthMetric);
    bytes = normalized.bytes;
    fullName = fullNameFromLabel(normalized.normalized, config.brand.rootName);
  } catch (error) {
    const code: MusePassErrorCode = isMusePassError(error) ? error.code : 'INVALID_NAME';
    const message = error instanceof Error ? error.message : String(error);
    issues.push({ code, message });
  }

  if (label !== null && codePoints !== null && units !== null) {
    if (bytes !== null && bytes > config.limits.maxLabelBytes) {
      issues.push({
        code: 'LABEL_TOO_MANY_BYTES',
        message: `label is ${bytes} bytes, the registry limit is ${config.limits.maxLabelBytes}`,
      });
    }

    if (units < config.limits.minLabelUnitsPremium) {
      issues.push({
        code: 'LABEL_TOO_SHORT',
        message: `label measures ${units}, the minimum is ${config.limits.minLabelUnitsPremium}`,
      });
    }

    price = quoteLabel(units, config.pricing);

    if (price.tier === 'premium') {
      const invite = invitedShortNameDecision(options.invitation ?? null, units);
      if (invite.allowed) {
        // The invitation, not the ladder, pays for this name: the price a
        // front end shows and the tier the API records both say free.
        price = {
          tier: 'free',
          tierId: 'invited-short',
          priceUsd: 0,
          currency: config.pricing.currency,
          active: true,
        };
      } else if (!options.allowPremium) {
        issues.push({
          code: 'NOT_FREE_TIER',
          message: `label measures ${units}, free names need at least ${config.pricing.freeTier.minUnits}`,
        });
      } else if (!price.active) {
        issues.push({ code: 'NOT_FREE_TIER', message: `premium tier ${price.tierId} is not on sale yet` });
      }
    }

    if (config.limits.labelPolicy.disallowMixedConfusableScripts) {
      const scriptCheck = checkScriptMixing(label, true);
      if (!scriptCheck.ok) {
        issues.push({
          code: 'MIXED_SCRIPT',
          message: `label mixes ${scriptCheck.conflict?.join(' + ')}`,
        });
      }
    }

    if (!config.limits.labelPolicy.allowEmoji && hasEmoji(label)) {
      issues.push({ code: 'EMOJI_NOT_ALLOWED', message: 'label contains emoji' });
    }

    // `-aguang` / `aguang-` are valid ENS labels but read like a typo or a
    // spoof of the real name, so the policy rejects them.
    if (
      config.limits.labelPolicy.disallowEdgeHyphen &&
      (label.startsWith('-') || label.endsWith('-'))
    ) {
      issues.push({
        code: 'INVALID_NAME',
        message: 'label must not start or end with a hyphen',
      });
    }

    reserved = checkReserved(label, reservedIndex, config.reserved);
    if (reserved) {
      issues.push({
        code: 'RESERVED_NAME',
        message: `label matches the reserved ${reserved.category} list (${reserved.matched})`,
      });
    }
  }

  const taken = onChainFree === false;
  // "Taken" is an availability fact, not a rule violation, so it is reported as
  // an issue (every consumer needs a machine readable reason) while policyOk
  // keeps meaning "this name breaks no rule".
  const policyOk = issues.length === 0;
  if (taken) {
    issues.push({
      code: 'NAME_TAKEN',
      message: 'name is already registered on chain',
      field: 'onChainFree',
    });
  }
  const available = onChainFree === null ? null : policyOk && !taken;

  let summary: BilingualText;
  if (issues.length > 0) summary = issueToSummary(issues[0]);
  else if (taken) summary = SUMMARY.taken;
  else if (available === null)
    summary = {
      zh: '这个名字符合规则、可以用，正在和链上核对是否已被占用。',
      en: 'This name passes the rules and looks available; the chain is still being checked.',
    };
  else summary = SUMMARY.ok;

  return {
    summary,
    policyOk,
    available,
    onChainFree,
    label,
    fullName,
    codePoints,
    units,
    bytes,
    price,
    reserved,
    issues,
  };
}

export interface ClaimQuotaState {
  walletFreeNames: number;
  walletSponsoredToday: number;
  walletSponsoredLifetime: number;
  platformSponsoredToday: number;
}

/**
 * Rule: sponsorship is capped per wallet, per day and platform-wide so that a
 * scripted caller cannot drain the sponsoring wallet.
 */
export function checkClaimQuota(state: ClaimQuotaState, config: MusenameConfig): LabelIssue[] {
  const issues: LabelIssue[] = [];
  const { sponsorship, freeNamesPerWallet } = config.limits;

  if (state.walletFreeNames >= freeNamesPerWallet) {
    issues.push({
      code: 'QUOTA_EXCEEDED',
      message: `this wallet already has ${state.walletFreeNames} free names, the limit is ${freeNamesPerWallet}`,
      field: 'walletFreeNames',
    });
  }
  if (state.walletSponsoredToday >= sponsorship.perWalletPerDay) {
    issues.push({
      code: 'SPONSORSHIP_EXCEEDED',
      message: `this wallet already used ${state.walletSponsoredToday} sponsored registrations today`,
      field: 'walletSponsoredToday',
    });
  }
  if (state.walletSponsoredLifetime >= sponsorship.perWalletLifetime) {
    issues.push({
      code: 'SPONSORSHIP_EXCEEDED',
      message: `this wallet reached the lifetime sponsorship limit of ${sponsorship.perWalletLifetime}`,
      field: 'walletSponsoredLifetime',
    });
  }
  if (state.platformSponsoredToday >= sponsorship.platformPerDay) {
    issues.push({
      code: 'SPONSORSHIP_EXCEEDED',
      message: `the platform sponsorship budget for today (${sponsorship.platformPerDay}) is used up`,
      field: 'platformSponsoredToday',
    });
  }

  return issues;
}

/**
 * Deterministic name suggestions for the "that name is taken" path.
 *
 * `isUsable` must apply *both* the on-chain read and the policy checks — the
 * caller owns that because only it can reach the chain. Passing a predicate
 * that only checks availability would happily suggest a reserved name.
 */
export function suggestLabels(
  base: string,
  isUsable: (candidate: string) => boolean,
  count = 3,
): string[] {
  const year = new Date().getUTCFullYear();
  // Bounded, ordered candidate pool. Cheap names first: numbered variants read
  // as "the same person, different slot", which is what a user wants to see.
  const candidates: string[] = [
    ...Array.from({ length: 20 }, (_unused, index) => `${base}${index + 1}`),
    ...Array.from({ length: 10 }, (_unused, index) => `${base}-${index + 1}`),
    `${base}${year}`,
    `the${base}`,
    `${base}hq`,
  ];

  const accepted: string[] = [];
  for (const candidate of candidates) {
    if (accepted.length >= count) break;
    try {
      const normalized = normalizeLabel(candidate);
      if (!isUsable(normalized.normalized)) continue;
      accepted.push(normalized.normalized);
    } catch {
      continue;
    }
  }
  return accepted;
}

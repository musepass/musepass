/**
 * The claim register, as code.
 *
 * Two rules in `docs/review/README.md` §6 are the reason this file exists:
 *
 *   1. Only write what is true today.
 *   2. Sample data is DEMO, real data is REAL.
 *
 * A sentence like "we cannot modify or freeze your name" is not a matter of
 * taste. On 2026-09-29 the chain showed that the registry's owner is an
 * operating hot wallet, and that the owner can add itself as a registrar
 * (`addRegistrar` does not revert). So that sentence is *false* until the
 * ownership moves, and the way to keep it out of the copy is a named gate
 * rather than somebody remembering.
 *
 * Flipping a gate from closed to open requires evidence, checked at load time:
 * a gate that says `allowed: true` with no `evidence` throws. That is the point
 * — the only way to publish a stronger claim is to record what makes it true.
 */

export interface ClaimRule {
  id: string;
  /** What the phrase asserts, in one line, for whoever reads the failure. */
  asserts: string;
  /** Gate that must be open first. `null` means "never, in any phase". */
  gate: string | null;
  patterns: RegExp[];
}

export interface ClaimGate {
  allowed: boolean;
  /** Required when `allowed` is true: the on-chain or measured fact behind it. */
  evidence?: string;
  /** Human sentence for the report when this gate is closed. */
  blockedBecause?: string;
  /** ISO date the state last changed. */
  updated?: string;
}

export interface ClaimGates {
  gates: Record<string, ClaimGate>;
  /** Convenience map used by `checkClaims`; derived from `gates`. */
  open: Record<string, boolean>;
  updated?: string;
  note?: string;
}

/**
 * The rules. Ids are stable; they appear in waivers, so renaming one is a
 * breaking change for every file that quotes a forbidden sentence on purpose.
 */
export const CLAIM_RULES: ClaimRule[] = [
  {
    id: 'name-not-modifiable',
    asserts: 'a name can never be edited, frozen or moved away from its owner',
    gate: 'nameImmutability',
    patterns: [
      /不可修改/,
      /不能修改/,
      /无法修改/,
      /不可冻结/,
      /不能冻结/,
      /不可被(?:修改|冻结|转走)/,
      /cannot\s+(?:move|freeze|edit|modify|change)\s+(?:a|the|your)\s+name/i,
      /immutable\s+ownership/i,
    ],
  },
  {
    id: 'platform-cannot-modify',
    asserts: 'the platform is unable to edit or take back a name it issued',
    gate: 'nameImmutability',
    patterns: [
      /平台(?:地址)?(?:永远|都)?(?:不是|不能|无法|不会)(?:修改|改动|改|转走|收回|冻结)/,
      /我们无法(?:收回|转走|修改|冻结)/,
      /we cannot (?:take|move|freeze|edit|modify) (?:a|the|your) name/i,
    ],
  },
  {
    id: 'record-not-modifiable',
    asserts: 'a published record can never be changed or deleted',
    gate: 'recordContract',
    patterns: [
      /谁都改不了/,
      /记录(?:永远)?(?:只增不改|不可删改|改不了)/,
      /records?\s+(?:can\s+)?never\s+be\s+(?:changed|deleted)/i,
    ],
  },
  {
    id: 'record-contract-live',
    asserts: 'the on-chain record contract is deployed and in use',
    gate: 'recordContract',
    patterns: [
      /记录合约已(?:上线|部署|生效)/,
      /信誉记录已(?:上线|开放)/,
      /record contract is live/i,
    ],
  },
  {
    id: 'independent-verifier',
    asserts: 'an outside party, not us, produced the verdict',
    gate: 'externalVerifier',
    patterns: [
      /独立验证方/,
      /第三方验证/,
      /外部验证方(?:已|已经)?(?:接入|出具)/,
      /由第三方(?:独立)?(?:验证|审计)/,
      /independently\s+verifi(?:ed|es)/i,
      /independent\s+verifier/i,
    ],
  },
  {
    id: 'audited',
    asserts: 'the contracts have been through an external audit',
    gate: 'externalAudit',
    patterns: [/已(?:通过)?(?:外部)?审计/, /审计(?:已)?完成/, /audited\s+by/i],
  },
  {
    id: 'standard-formal-claim',
    asserts: 'a draft we submitted is a formal, approved standard',
    gate: 'standardMerged',
    patterns: [
      /(正式|已合并|已经合并|已通过)的?\s*ERC-?\d{3,5}/,
      /ERC-?\d{3,5}\s*(?:已|已经)?(?:正式发布|合并|生效|通过)/,
      /(?:proposed|authored)[^.]{0,20}(?:formal|merged)\s+ERC/i,
    ],
  },
  {
    id: 'registration-live',
    asserts: 'registering a name through us works right now',
    gate: 'sponsorKey',
    patterns: [
      /注册(?:已|已经)(?:可用|上线|能用)/,
      /一句话注册(?:已|已经)?(?:可用|上线|做好)/,
      /registrations?\s+(?:is|are)\s+(?:live|working)/i,
    ],
  },
  {
    id: 'credit-score',
    asserts: 'we score creditworthiness (a regulated activity we are not in)',
    gate: null,
    patterns: [/信用分/, /信用评级/, /credit\s+score/i, /credit\s+rating/i],
  },
  {
    id: 'guaranteed-return',
    asserts: 'a financial return is guaranteed',
    gate: null,
    patterns: [/保证收益/, /保本/, /稳赚/, /guaranteed\s+(?:return|profit|yield)/i],
  },
];

export interface ClaimFinding {
  ruleId: string;
  gate: string | null;
  file: string;
  line: number;
  column: number;
  /** The line the phrase was found on, trimmed. */
  text: string;
  /** The exact characters the rule matched. */
  phrase: string;
  /** True when the gate is open, so this is not a violation. */
  allowed: boolean;
}

export interface ClaimWaiver {
  ruleId: string;
  file: string;
  line: number;
  reason: string;
  scope: 'line' | 'file' | 'block';
}

export interface ClaimReport {
  /** Every match, including the allowed and the waived ones. */
  findings: ClaimFinding[];
  /** Matches whose gate is closed and that nobody waived. */
  violations: ClaimFinding[];
  waivers: ClaimWaiver[];
  open: Record<string, boolean>;
}

/**
 * A waiver is written into the file that needs it, so the reason travels with
 * the sentence and shows up in review:
 *
 *   `<!-- claims-allow: name-not-modifiable — quoting the review that banned it -->`
 *
 * `claims-allow:` exempts the line it sits on. `claims-allow-block:` exempts
 * everything up to `claims-allow-end:` on a line of its own. `claims-allow-file:`
 * exempts the whole file. All three require a reason after a spaced dash; a bare
 * waiver is ignored, so it cannot be used as a mute button.
 */
const WAIVER = /claims-allow(-file|-block)?:\s*([a-z0-9-]+?)\s+[—–-]\s+(\S.{2,})/;
const BLOCK_END = /claims-allow-end:\s*([a-z0-9-*]+?)\s*(?:-->|\*\/|$)/;

export function loadClaimGates(raw: unknown): ClaimGates {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('claims gates: expected a JSON object');
  }
  const record = raw as { gates?: unknown; note?: unknown; updated?: unknown };
  if (typeof record.gates !== 'object' || record.gates === null) {
    throw new Error('claims gates: missing "gates"');
  }
  const gates: Record<string, ClaimGate> = {};
  const open: Record<string, boolean> = {};
  for (const [id, value] of Object.entries(record.gates as Record<string, unknown>)) {
    if (typeof value !== 'object' || value === null) {
      throw new Error(`claims gates: "${id}" must be an object`);
    }
    const gate = value as ClaimGate;
    if (typeof gate.allowed !== 'boolean') {
      throw new Error(`claims gates: "${id}.allowed" must be a boolean`);
    }
    if (gate.allowed && !(typeof gate.evidence === 'string' && gate.evidence.trim().length >= 8)) {
      throw new Error(
        `claims gates: "${id}" is open but has no evidence. ` +
          'Record the on-chain fact or measurement that makes it true before opening a gate.',
      );
    }
    gates[id] = gate;
    open[id] = gate.allowed;
  }
  return {
    gates,
    open,
    updated: typeof record.updated === 'string' ? record.updated : undefined,
    note: typeof record.note === 'string' ? record.note : undefined,
  };
}

/** Rule ids an open gate no longer applies to, so callers can explain a skip. */
export function rulesBlockedBy(gates: ClaimGates, gateId: string): ClaimRule[] {
  return CLAIM_RULES.filter((rule) => rule.gate === gateId && !gates.open[gateId]);
}

export function checkClaims(
  files: Iterable<{ path: string; text: string }>,
  gates: ClaimGates,
): ClaimReport {
  const findings: ClaimFinding[] = [];
  const waivers: ClaimWaiver[] = [];
  const fileScope = new Map<string, Set<string>>();
  const blocks = new Map<string, { ruleId: string; start: number; end: number }[]>();

  const collected = [...files];

  for (const file of collected) {
    const fileWaivers = new Set<string>();
    const openBlocks: { ruleId: string; start: number; end: number }[] = [];
    for (const [index, line] of file.text.split('\n').entries()) {
      const lineNumber = index + 1;
      const end = BLOCK_END.exec(line);
      if (end) {
        for (const block of openBlocks.splice(0)) {
          if (end[1] === '*' || block.ruleId === end[1]) block.end = lineNumber;
          else openBlocks.push(block);
        }
        continue;
      }
      const match = WAIVER.exec(line);
      if (!match) continue;
      const [, isFileScope, ruleId, reason] = match;
      const clean = reason.replace(/\s*(?:-->|\*\/\}?)\s*$/, '').trim();
      const waiver: ClaimWaiver = {
        ruleId,
        file: file.path,
        line: lineNumber,
        reason: clean,
        scope: isFileScope === '-file' ? 'file' : isFileScope === '-block' ? 'block' : 'line',
      };
      if (waiver.reason.length < 3) continue;
      waivers.push(waiver);
      if (waiver.scope === 'file') fileWaivers.add(ruleId);
      if (waiver.scope === 'block') {
        const list = blocks.get(file.path) ?? [];
        const block = { ruleId, start: lineNumber, end: Number.MAX_SAFE_INTEGER };
        list.push(block);
        blocks.set(file.path, list);
        openBlocks.push(block);
      }
    }
    if (fileWaivers.size > 0) fileScope.set(file.path, fileWaivers);
  }

  const waivedLines = new Set(
    waivers
      .filter((waiver) => waiver.scope === 'line')
      .map((waiver) => `${waiver.file}:${waiver.line}:${waiver.ruleId}`),
  );

  for (const file of collected) {
    const lines = file.text.split('\n');
    const fileBlocks = blocks.get(file.path) ?? [];
    const ruleOrder = new Map(CLAIM_RULES.map((rule, index) => [rule.id, index]));
    for (const [index, line] of lines.entries()) {
      const lineNumber = index + 1;
      // Rules overlap on purpose — "we cannot modify your name" is both an
      // independence-of-ownership claim and a platform-power claim — so the
      // report keeps the first rule that matched a span, not every rule.
      const candidates: { start: number; end: number; order: number; finding: ClaimFinding }[] = [];
      for (const rule of CLAIM_RULES) {
        const allowed = rule.gate === null ? false : gates.open[rule.gate] === true;
        if (allowed) continue;
        if (fileScope.get(file.path)?.has(rule.id)) continue;
        if (waivedLines.has(`${file.path}:${lineNumber}:${rule.id}`)) continue;
        if (fileBlocks.some((block) => block.ruleId === rule.id && lineNumber >= block.start && lineNumber <= block.end)) {
          continue;
        }
        for (const pattern of rule.patterns) {
          const match = pattern.exec(line);
          if (!match) continue;
          candidates.push({
            start: match.index,
            end: match.index + match[0].length,
            order: ruleOrder.get(rule.id) ?? 0,
            finding: {
              ruleId: rule.id,
              gate: rule.gate,
              file: file.path,
              line: lineNumber,
              column: match.index + 1,
              text: line.trim(),
              phrase: match[0],
              allowed: false,
            },
          });
        }
      }
      candidates.sort((a, b) => a.start - b.start || a.order - b.order);
      const accepted: typeof candidates = [];
      for (const candidate of candidates) {
        if (accepted.some((other) => candidate.start < other.end && other.start < candidate.end)) continue;
        accepted.push(candidate);
      }
      for (const candidate of accepted.sort((a, b) => a.order - b.order || a.start - b.start)) {
        findings.push(candidate.finding);
      }
    }
  }

  return { findings, violations: findings.filter((finding) => !finding.allowed), waivers, open: gates.open };
}

/**
 * Surfaces that a stranger reads as *our* claim. A hard failure here stops the
 * release; the same phrase inside `docs/review/` is how we discuss the rule, so
 * those files are reported as warnings by the scanner instead.
 */
export const PUBLISHING_SURFACES = [
  'README.md',
  'config/brand.json',
  'contracts/README.md',
  'docs/integration.md',
  'docs/status.md',
  'docs/pitch.md',
] as const;

export const PUBLISHING_DIRECTORIES = ['launch-kit', 'apps/web/app', 'apps/web/components'] as const;

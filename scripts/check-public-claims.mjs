#!/usr/bin/env node
/**
 * Fail the build when the copy says something the chain does not.
 *
 *   node scripts/check-public-claims.mjs            # human readable
 *   node scripts/check-public-claims.mjs --json     # for a report
 *   node scripts/check-public-claims.mjs --all      # also inspect docs/ (warnings)
 *
 * Two tiers, because the same sentence is a lie on the homepage and a
 * quotation inside the review notes:
 *
 *   hard     files a stranger reads as our claim: README, the web app, the
 *            launch kit, config. A hit here exits 1.
 *   warning  docs/, package READMEs. Reported with a count, does not fail
 *            unless --strict is passed.
 *
 * The rules and the gate file live in `packages/core` and `config/`; this file
 * only walks the tree. Run `pnpm --filter @musename/core build` first.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PUBLISHING_DIRECTORIES, PUBLISHING_SURFACES, checkClaims, loadClaimGates, rulesBlockedBy } from '../packages/core/dist/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

const asJson = process.argv.includes('--json');
const strict = process.argv.includes('--strict');
const includeDocs = process.argv.includes('--all') || strict;

const TEXT_EXTENSIONS = ['.md', '.tsx', '.ts', '.json', '.mjs', '.txt'];
const SKIP_DIRECTORIES = new Set(['node_modules', '.git', 'dist', '.next', 'out', 'cache', 'coverage']);

function walk(relativePath) {
  const absolute = resolve(repoRoot, relativePath);
  let stats;
  try {
    stats = statSync(absolute);
  } catch {
    return [];
  }
  if (stats.isFile()) return [relativePath];
  const files = [];
  for (const entry of readdirSync(absolute)) {
    if (SKIP_DIRECTORIES.has(entry)) continue;
    const child = join(relativePath, entry);
    const childStats = statSync(resolve(repoRoot, child));
    if (childStats.isDirectory()) files.push(...walk(child));
    else if (TEXT_EXTENSIONS.some((extension) => entry.endsWith(extension))) files.push(child);
  }
  return files;
}

function read(relativePath) {
  return { path: relativePath, text: readFileSync(resolve(repoRoot, relativePath), 'utf8') };
}

const gatesPath = resolve(repoRoot, 'config', 'claims-gates.json');
const gates = loadClaimGates(JSON.parse(readFileSync(gatesPath, 'utf8')));

const hardFiles = new Set([
  ...PUBLISHING_SURFACES,
  ...PUBLISHING_DIRECTORIES.flatMap((directory) => walk(directory)),
]);

const warningFiles = includeDocs
  ? walk('docs')
      .concat(walk('apps/api/README.md'), walk('apps/gateway/README.md'), walk('apps/mcp/README.md'), walk('apps/web/README.md'))
      .concat(walk('packages/core/README.md'), walk('packages/verify/README.md'))
      .filter((file) => !hardFiles.has(file))
  : [];

const hard = checkClaims([...hardFiles].sort().map(read), gates);
const soft = checkClaims(warningFiles.sort().map(read), gates);

/**
 * §6 rule 5: public surfaces must say we are not Meta. It is a presence rule,
 * so it cannot ride on the phrase rules.
 */
const REQUIRED = [
  {
    id: 'meta-disclaimer',
    file: 'config/brand.json',
    needle: '与 Meta 及其任何产品无关',
    because: 'review §6 rule 5: the site must state it is unaffiliated with Meta',
  },
  {
    id: 'meta-disclaimer-rendered',
    file: 'apps/web/components/SiteFooter.tsx',
    needle: 'legalDisclaimer',
    because: 'the disclaimer has to reach the page, not just live in config',
  },
  // The slogan whitelist (2026-09-30 review): <title>, the share description
  // and the hero heading may only use the approved sentences, so the check is
  // inverted — the approved sentence must be present in the file that renders
  // it, and the retired slogans are banned as phrases everywhere.
  {
    id: 'slogan-title',
    file: 'apps/web/app/layout.tsx',
    needle: 'a passport and an account for every AI agent',
    because: 'the page title must use the approved brand sentence',
  },
  {
    id: 'slogan-share-description',
    file: 'config/brand.json',
    needle: 'Give your AI a passport: a name any wallet can read and a track record anyone can check',
    because: 'meta/og/twitter descriptions must use the approved share description',
  },
  {
    id: 'slogan-hero',
    file: 'apps/web/components/HeroSection.tsx',
    needle: 'a passport.',
    because: 'the hero heading must be the approved "Give your AI a passport."',
  },
  // Example-labelling: every demo card or demo record must say it is an example.
  {
    id: 'example-card',
    file: 'apps/web/components/CardMock.tsx',
    needle: 'Example — no real name',
    because: 'the hero card shows invented data; the label is what keeps it honest',
  },
  {
    id: 'example-record',
    file: 'apps/web/app/page.tsx',
    needle: '— example',
    because: 'the homepage record sample shows an invented record; it must say so',
  },
  // Free-name policy (D20, 2026-10-02): every wallet gets one free long name
  // (5+ characters); invitations cover short ones. The homepage must carry the
  // free sentence, so the policy cannot quietly vanish.
  {
    id: 'free-name-policy',
    file: 'apps/web/app/page.tsx',
    needle: 'The first name is free',
    because: 'the free rail is open to every wallet; the homepage has to say so',
  },
  // Terms (2026-10-02): the paid rail is live (D19), so the terms must state
  // the real prices, the receive-only treasury, and the refund path for a
  // payment that landed but could not be issued.
  {
    id: 'terms-purchase-refund',
    file: 'apps/web/app/terms/page.tsx',
    needle: 'payment is returned to the address that sent it',
    because: 'a paid rail with no stated refund path for failed issuance is a lie of omission',
  },
  // Terms (2026-10-02): D20 opened registration to every wallet, so
  // impersonation is the predictable abuse; the complaint path and its SLA
  // must exist in writing before it is needed.
  {
    id: 'terms-impersonation-sla',
    file: 'apps/web/app/terms/page.tsx',
    needle: 'we answer within 48 hours',
    because: 'anyone can claim a name; the complaint route and its SLA have to be findable',
  },
];

const missing = [];
for (const requirement of REQUIRED) {
  const text = readFileSync(resolve(repoRoot, requirement.file), 'utf8');
  if (!text.includes(requirement.needle)) missing.push(requirement);
}

const closedGates = Object.entries(gates.gates).filter(([, gate]) => !gate.allowed);

if (asJson) {
  console.log(
    JSON.stringify(
      {
        gates: gates.gates,
        hard: hard.violations,
        warnings: soft.violations,
        waivers: [...hard.waivers, ...soft.waivers],
        missing,
        scanned: { hard: [...hardFiles].length, warning: warningFiles.length },
      },
      null,
      2,
    ),
  );
} else {
  console.log('public claims check');
  console.log(`  gates: ${closedGates.map(([id]) => `${id}=closed`).join(' ') || 'all open'}`);
  console.log(`  scanned: ${hardFiles.size} publishing file(s), ${warningFiles.length} doc file(s)`);
  console.log('');

  const printFindings = (findings) => {
    for (const finding of findings) {
      console.log(`  ${finding.file}:${finding.line}:${finding.column}  ${finding.ruleId}`);
      console.log(`    says: ${finding.phrase}`);
      console.log(`    text: ${finding.text.slice(0, 140)}`);
      const rule = rulesBlockedBy(gates, finding.gate ?? '').find((entry) => entry.id === finding.ruleId);
      if (rule) console.log(`    why it is blocked: ${rule.asserts}`);
      const gate = finding.gate ? gates.gates[finding.gate] : undefined;
      if (gate?.blockedBecause) console.log(`    gate ${finding.gate}: ${gate.blockedBecause}`);
      console.log(`    fix: delete it, soften it, or waive it with a reason (claims-allow: …)`);
      console.log('');
    }
  };

  if (hard.violations.length > 0) {
    console.log(`publishing surfaces — ${hard.violations.length} violation(s):`);
    printFindings(hard.violations);
  } else {
    console.log('publishing surfaces — clean');
  }

  if (warningFiles.length > 0) {
    console.log(`docs — ${soft.violations.length} warning(s) (a quote is not a claim):`);
    const byFile = new Map();
    for (const finding of soft.violations) {
      byFile.set(finding.file, (byFile.get(finding.file) ?? 0) + 1);
    }
    for (const [file, count] of [...byFile].sort()) console.log(`  ${count}  ${file}`);
    console.log('');
  }

  if (missing.length > 0) {
    console.log('required statements — missing:');
    for (const requirement of missing) console.log(`  ${requirement.file}: ${requirement.because}`);
    console.log('');
  }

  const waived = [...hard.waivers, ...soft.waivers];
  if (waived.length > 0) {
    console.log(`waivers in force — ${waived.length}:`);
    for (const waiver of waived) {
      console.log(`  ${waiver.file}:${waiver.line}  ${waiver.ruleId} (${waiver.scope}) — ${waiver.reason}`);
    }
    console.log('');
  }
}

const failed = hard.violations.length > 0 || missing.length > 0 || (strict && soft.violations.length > 0);
if (!asJson) {
  console.log(failed ? 'FAIL — copy and reality disagree' : 'ok — every published claim passes its gate');
}
process.exit(failed ? 1 : 0);

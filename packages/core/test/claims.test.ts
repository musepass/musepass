import { describe, expect, it } from 'vitest';
import {
  CLAIM_RULES,
  PUBLISHING_DIRECTORIES,
  PUBLISHING_SURFACES,
  checkClaims,
  loadClaimGates,
  rulesBlockedBy,
} from '../src/claims.js';

const closedGates = loadClaimGates({
  updated: '2026-09-29',
  gates: {
    nameImmutability: { allowed: false, blockedBecause: 'the registry admin is a hot wallet' },
    recordContract: { allowed: false },
    externalVerifier: { allowed: false },
    externalAudit: { allowed: false },
  },
});

const openGates = loadClaimGates({
  gates: {
    nameImmutability: { allowed: true, evidence: 'tx 0xdeadbeef moved admin to a 2-of-3' },
    recordContract: { allowed: false },
    externalVerifier: { allowed: false },
    externalAudit: { allowed: false },
  },
});

describe('claim register', () => {
  it('catches the sentence the chain made false', () => {
    const report = checkClaims(
      [
        { path: 'README.md', text: '平台地址不是 registrar，因此无法修改任何已发放的名字' },
        { path: 'apps/web/app/page.tsx', text: '平台不会冻结你的名字。' },
      ],
      closedGates,
    );
    expect(report.violations.map((violation) => violation.ruleId)).toEqual([
      'name-not-modifiable',
      'platform-cannot-modify',
    ]);
    expect(report.violations[0].line).toBe(1);
    expect(report.violations[0].phrase).toBe('无法修改');
    expect(report.violations[1].phrase).toBe('平台不会冻结');
  });

  it('says nothing once the gate is open', () => {
    const report = checkClaims([{ path: 'README.md', text: '无法修改任何已发放的名字' }], openGates);
    expect(report.violations).toHaveLength(0);
  });

  it('refuses to open a gate without evidence', () => {
    expect(() => loadClaimGates({ gates: { nameImmutability: { allowed: true } } })).toThrow(
      /no evidence/,
    );
  });

  it('rejects a gate file that is not shaped like one', () => {
    expect(() => loadClaimGates({ gates: { x: 'yes' } })).toThrow(/must be an object/);
    expect(() => loadClaimGates({ nope: true })).toThrow(/missing "gates"/);
  });

  it('keeps the wording rules no gate can open', () => {
    const report = checkClaims(
      [
        { path: 'apps/web/app/page.tsx', text: '你的 AI 信用分：92' },
        { path: 'README.md', text: 'stablecoin yield, guaranteed profit' },
      ],
      openGates,
    );
    expect(report.violations.map((violation) => violation.ruleId).sort()).toEqual([
      'credit-score',
      'guaranteed-return',
    ]);
    // Wording rules no gate can open: the two originals plus the ban list that
    // grew out of the 2026-09-30 review (survival-independence, cannot-be-changed,
    // retired-slogan).
    expect(CLAIM_RULES.filter((rule) => rule.gate === null)).toHaveLength(5);
  });

  it('flags an independence claim while we are still the only verifier', () => {
    const report = checkClaims(
      [{ path: 'apps/web/app/page.tsx', text: '由第三方验证后写入链上' }],
      closedGates,
    );
    expect(report.violations[0]?.ruleId).toBe('independent-verifier');
  });

  it('flags a draft being sold as a formal standard', () => {
    const report = checkClaims(
      [
        { path: 'docs/pitch.md', text: '我们提出的正式 ERC-8412 已经在用了。' },
        { path: 'docs/pitch.md', text: 'ERC-8412 已合并。' },
      ],
      closedGates,
    );
    expect(report.violations.map((violation) => violation.ruleId)).toEqual([
      'standard-formal-claim',
      'standard-formal-claim',
    ]);
    expect(report.violations[0].phrase).toBe('正式 ERC-8412');
  });

  it('lets the honest version of the same sentence through', () => {
    const report = checkClaims(
      [{ path: 'docs/pitch.md', text: '我们提交了 PR #2002，开放中，尚未合并。' }],
      closedGates,
    );
    expect(report.violations).toHaveLength(0);
  });

  it('flags a registration flow that is called live while the sponsor key is missing', () => {
    const report = checkClaims(
      [{ path: 'docs/pitch.md', text: '一句话注册已经做好。' }],
      closedGates,
    );
    expect(report.violations[0]?.ruleId).toBe('registration-live');

    const honest = checkClaims(
      [{ path: 'docs/pitch.md', text: '流程已实现，线上发放暂时不可用。' }],
      closedGates,
    );
    expect(honest.violations).toHaveLength(0);
  });

  it('lets a file quote a banned sentence when it says why', () => {
    const text = [
      '<!-- claims-allow-block: name-not-modifiable — quoting the review that banned it -->',
      '评审要求删掉 “这个名字无法修改” 这句话。',
      '<!-- claims-allow-end: name-not-modifiable -->',
    ].join('\n');
    const report = checkClaims([{ path: 'docs/review/README.md', text }], closedGates);
    expect(report.violations).toHaveLength(0);
    expect(report.waivers[0]).toMatchObject({
      ruleId: 'name-not-modifiable',
      file: 'docs/review/README.md',
      line: 1,
      reason: 'quoting the review that banned it',
      scope: 'block',
    });
  });

  it('lets a line carry its own waiver', () => {
    const text = '这个名字无法修改。 <!-- claims-allow: name-not-modifiable — quoted from the review -->';
    const report = checkClaims([{ path: 'docs/review/README.md', text }], closedGates);
    expect(report.violations).toHaveLength(0);
    expect(report.waivers[0].scope).toBe('line');
  });

  it('closes a block at its end marker', () => {
    const text = [
      '<!-- claims-allow-block: name-not-modifiable — quote -->',
      '这个名字无法修改。',
      '<!-- claims-allow-end: name-not-modifiable -->',
      '这个名字无法修改。',
    ].join('\n');
    const report = checkClaims([{ path: 'docs/review/README.md', text }], closedGates);
    expect(report.violations.map((violation) => violation.line)).toEqual([4]);
  });

  it('ignores a waiver with no reason, so it cannot be a mute button', () => {
    const text = '<!-- claims-allow: name-not-modifiable -->\n我们无法修改你的名字。';
    const report = checkClaims([{ path: 'docs/review/README.md', text }], closedGates);
    expect(report.waivers).toHaveLength(0);
    expect(report.violations.length).toBeGreaterThan(0);
  });

  it('supports a whole-file waiver, and reports it', () => {
    const text = [
      '<!-- claims-allow-file: credit-score — this page explains why we do not use that word -->',
      '我们不用 信用分 这个词。',
    ].join('\n');
    const report = checkClaims([{ path: 'docs/x.md', text }], closedGates);
    expect(report.violations).toHaveLength(0);
    expect(report.waivers[0].scope).toBe('file');
  });

  it('reports where and what, not just that', () => {
    const report = checkClaims(
      [{ path: 'apps/web/app/page.tsx', text: '第一行\n  保证收益，锁仓 30 天' }],
      closedGates,
    );
    const [finding] = report.violations;
    expect(finding.line).toBe(2);
    expect(finding.column).toBe(3);
    expect(finding.text).toBe('保证收益，锁仓 30 天');
    expect(finding.gate).toBeNull();
  });

  it('knows which rules a closed gate is holding back', () => {
    const blocked = rulesBlockedBy(closedGates, 'nameImmutability').map((rule) => rule.id);
    expect(blocked).toEqual(['name-not-modifiable', 'platform-cannot-modify', 'cannot-touch-names']);
  });

  it('lists the surfaces a stranger reads as our claim', () => {
    expect(PUBLISHING_SURFACES).toContain('README.md');
    expect(PUBLISHING_SURFACES).toContain('contracts/README.md');
    expect([...PUBLISHING_DIRECTORIES]).toContain('apps/web/app');
    // ask.txt is a published surface even though it is generated in lib/
    expect([...PUBLISHING_DIRECTORIES]).toContain('apps/web/lib');
  });
});

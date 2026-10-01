'use client';

import Link from 'next/link';
import { useState } from 'react';

/**
 * The one sidebar every /docs page renders. It is a client component for one
 * reason: the search box. The index is a short list of titles and keywords
 * shipped with the page — no third-party service, no index endpoint, nothing
 * sent anywhere. Typing filters it locally and the results link straight to
 * the page (or section) it names.
 *
 * The groups mirror the 2026-10-01 review's documentation tree: overview,
 * audience entrances, concepts, guides, reference, trust, policies. Pages
 * that live outside /docs (the trust model, terms) are linked, not copied —
 * a sentence that exists in two places will drift, and the claims checker
 * scans the copy it can see.
 */

const NAV: Array<{ group: string; items: Array<{ href: string; label: string }> }> = [
  {
    group: 'Overview',
    items: [
      { href: '/docs', label: 'What is MusePass' },
      { href: '/docs#where-to-start', label: 'Where to start' },
    ],
  },
  {
    group: 'Get started',
    items: [
      { href: '/docs/start/people', label: 'For people' },
      { href: '/docs/start/agents', label: 'For AI agents' },
      { href: '/docs/start/merchants', label: 'For merchants' },
      { href: '/docs/start/developers', label: 'For developers' },
    ],
  },
  {
    group: 'Concepts',
    items: [
      { href: '/docs/concepts/passport', label: 'The passport (Pass)' },
      { href: '/docs/concepts/passport#vault', label: 'The vault — in design' },
      { href: '/docs/concepts/passport#bond', label: 'The bond — in design' },
      { href: '/docs/concepts/pricing', label: 'Pricing and limits' },
      { href: '/docs/concepts/economics', label: 'Economics' },
    ],
  },
  {
    group: 'Guides',
    items: [
      { href: '/docs/guides/verify', label: 'Verify a record offline' },
    ],
  },
  {
    group: 'Reference',
    items: [
      { href: '/docs/reference/api', label: 'REST API' },
      { href: '/docs/reference/mcp', label: 'MCP tools' },
      { href: '/docs/reference/mcp#signer', label: 'Agent signer' },
    ],
  },
  {
    group: 'Trust',
    items: [
      { href: '/trust', label: 'Trust model' },
      { href: '/trust#false-today', label: 'Not true yet' },
      { href: '/docs/guides/verify#not-true', label: 'Verify us yourself' },
      { href: '/numbers', label: 'The public numbers' },
      { href: '/anchors', label: 'Anchored batches' },
    ],
  },
  {
    group: 'Policies',
    items: [
      { href: '/terms', label: 'Terms' },
      { href: '/privacy', label: 'Privacy' },
    ],
  },
];

/** Titles and the words a reader is likely to type for them. */
const SEARCH_INDEX: Array<{ title: string; href: string; keywords: string }> = [
  {
    title: 'What is MusePass',
    href: '/docs',
    keywords: 'overview passport account pass vault bond name card record live design what is',
  },
  {
    title: 'For people: give your AI a passport',
    href: '/docs/start/people',
    keywords: 'claim browser wallet free five characters primary name mainnet gas card publish human owner',
  },
  {
    title: 'For AI agents',
    href: '/docs/start/agents',
    keywords: 'agent ask.txt rules eip-712 request_name prepare_registration submit_registration owner sign mcp paths',
  },
  {
    title: 'For merchants: check an AI',
    href: '/docs/start/merchants',
    keywords: 'merchant order customer check deal record stamp identity not identity-checked trust verify',
  },
  {
    title: 'For developers: five minutes in',
    href: '/docs/start/developers',
    keywords: 'developer quickstart rest curl mcp config envelope http post requests five minutes api key',
  },
  {
    title: 'The passport (Pass)',
    href: '/docs/concepts/passport',
    keywords: 'passport name card stamps anchor registry erc-721 erc-8004 ccip-read durin gateway robinhood transfer genesis',
  },
  {
    title: 'The vault (in design)',
    href: '/docs/concepts/passport#vault',
    keywords: 'vault wallet erc-6551 account payment design not running audit',
  },
  {
    title: 'The bond (in design)',
    href: '/docs/concepts/passport#bond',
    keywords: 'bond escrow margin deposit release criteria design not running audit',
  },
  {
    title: 'Pricing and limits',
    href: '/docs/concepts/pricing',
    keywords: 'pricing free tier premium short name invitation caps budget metrics sponsorship usd daily limit',
  },
  {
    title: 'Economics',
    href: '/docs/concepts/economics',
    keywords: 'economics revenue treasury usdg where money goes token notary deposit genesis earned not sold stablecoin no promises',
  },
  {
    title: 'Verify a record offline / verify us yourself',
    href: '/docs/guides/verify',
    keywords: 'verify cast call owner bytes32 text record recompute hash anchor merkle offline independent',
  },
  {
    title: 'REST API',
    href: '/docs/reference/api',
    keywords: 'rest api envelope summary data errors meta verified config available names card versions requests claim metrics invitations genesis owner',
  },
  {
    title: 'MCP tools',
    href: '/docs/reference/mcp',
    keywords: 'mcp tools streamable http endpoint check_name get_profile draft_card request_name nine tools',
  },
  {
    title: 'Agent signer',
    href: '/docs/reference/mcp#signer',
    keywords: 'signer bearer token wallet_address sign_registration sign_card hosted key trust blast radius policy deadline',
  },
  {
    title: 'Rules and limits',
    href: '/docs/guides/verify#rules',
    keywords: 'rules limits free names per wallet short names price tiers reserved rate limit confirmation minutes cjk',
  },
  {
    title: 'Not true yet',
    href: '/docs/guides/verify#not-true',
    keywords: 'not true yet audit multisig admin verifier independent altered records honest limitations',
  },
];

export function DocsSidebar() {
  const [query, setQuery] = useState('');
  const trimmed = query.trim().toLowerCase();
  const results = trimmed
    ? SEARCH_INDEX.filter(
        (entry) =>
          entry.title.toLowerCase().includes(trimmed) || entry.keywords.toLowerCase().includes(trimmed),
      ).slice(0, 8)
    : [];

  return (
    <aside className="docs-side">
      <input
        className="docs-search"
        type="search"
        placeholder="Search the docs"
        aria-label="Search the docs"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && results.length > 0) {
            window.location.assign(results[0].href);
          }
        }}
      />

      {trimmed ? (
        results.length > 0 ? (
          <nav className="docs-nav" aria-label="Search results">
            {results.map((entry) => (
              <Link key={entry.href} href={entry.href} onClick={() => setQuery('')}>
                {entry.title}
              </Link>
            ))}
          </nav>
        ) : (
          <p className="docs-search-empty">Nothing matches. Try “card”, “mcp” or “verify”.</p>
        )
      ) : (
        NAV.map((section) => (
          <div key={section.group}>
            <span className="docs-side-title">{section.group}</span>
            <nav className="docs-nav" aria-label={section.group}>
              {section.items.map((item) => (
                <Link key={item.href} href={item.href}>
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
        ))
      )}

      {trimmed ? null : (
        <>
          <span className="docs-side-title">Elsewhere</span>
          <nav className="docs-nav" aria-label="Elsewhere">
            <Link href="/name/abcde">A name an AI registered</Link>
            <Link href="/verify">Verify a record</Link>
            <a href="https://github.com/musepass/musepass">Source</a>
          </nav>
        </>
      )}
    </aside>
  );
}

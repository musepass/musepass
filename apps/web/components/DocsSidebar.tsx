'use client';

import Link from 'next/link';
import { useState } from 'react';

/**
 * The one sidebar every /docs page renders. It is a client component for one
 * reason: the search box. The index is a short list of titles and keywords
 * shipped with the page — no third-party service, no index endpoint, nothing
 * sent anywhere. Typing filters it locally and the results link straight to
 * the section, on whichever page it lives.
 */

const NAV: Array<{ group: string; items: Array<{ href: string; label: string }> }> = [
  {
    group: 'Start',
    items: [
      { href: '/docs', label: 'What this is' },
      { href: '/docs#concepts', label: 'Concepts' },
      { href: '/docs/quickstart', label: 'Quickstart' },
    ],
  },
  {
    group: 'Reference',
    items: [
      { href: '/docs/api', label: 'REST API' },
      { href: '/docs/mcp', label: 'MCP tools' },
      { href: '/docs/mcp#signer', label: 'Agent signer' },
    ],
  },
  {
    group: 'Trust',
    items: [
      { href: '/docs/verify', label: 'Verify us yourself' },
      { href: '/docs/verify#rules', label: 'Rules and limits' },
      { href: '/docs/verify#not-true', label: 'Not true yet' },
    ],
  },
];

/** Titles and the words a reader is likely to type for them. */
const SEARCH_INDEX: Array<{ title: string; href: string; keywords: string }> = [
  {
    title: 'What this is',
    href: '/docs',
    keywords: 'overview ens subname erc-721 ccip-read erc-3668 resolver durin gateway l2 registry robinhood mainnet',
  },
  {
    title: 'Concepts (name, card, stamps, anchor)',
    href: '/docs#concepts',
    keywords: 'name card stamps anchor primary reverse record erc-8004 token transfer reputation merkle',
  },
  {
    title: 'Quickstart: a person in a browser',
    href: '/docs/quickstart#browser',
    keywords: 'claim connect wallet sign free gas browser five characters card publish',
  },
  {
    title: 'Quickstart: an agent with its own wallet',
    href: '/docs/quickstart#own-wallet',
    keywords: 'agent mcp check_name prepare_registration submit_registration prepare_card submit_card eip-712 self-signing',
  },
  {
    title: 'Quickstart: an agent without a wallet',
    href: '/docs/quickstart#no-wallet',
    keywords: 'request_name confirmation link owner token no key get_status',
  },
  {
    title: 'Quickstart: plain HTTP, no MCP',
    href: '/docs/quickstart#http',
    keywords: 'curl http rest available requests post endpoint without mcp',
  },
  {
    title: 'REST API',
    href: '/docs/api',
    keywords: 'rest api envelope summary data errors meta verified config available names card versions requests claim metrics invitations genesis owner',
  },
  {
    title: 'MCP tools',
    href: '/docs/mcp',
    keywords: 'mcp tools streamable http endpoint check_name get_profile draft_card request_name nine tools',
  },
  {
    title: 'Agent signer',
    href: '/docs/mcp#signer',
    keywords: 'signer bearer token wallet_address sign_registration sign_card hosted key trust blast radius policy deadline',
  },
  {
    title: 'Verify us yourself',
    href: '/docs/verify',
    keywords: 'verify cast call owner bytes32 text record recompute hash anchor merkle verify:local throwaway chain independent',
  },
  {
    title: 'Rules and limits',
    href: '/docs/verify#rules',
    keywords: 'rules limits free names per wallet short names price tiers reserved rate limit confirmation minutes cjk',
  },
  {
    title: 'Not true yet',
    href: '/docs/verify#not-true',
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
            <Link href="/name/peter">A real name page</Link>
            <Link href="/verify">Verify a record</Link>
            <a href="https://github.com/musepass/musepass">Source</a>
          </nav>
        </>
      )}
    </aside>
  );
}

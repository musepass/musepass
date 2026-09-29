import type { NameData, PublicConfig } from './api';

/**
 * Structured data for a name page, for the crawler the plan calls a free
 * acquisition channel.
 *
 * The rule that makes it safe: it only carries what the card already publishes.
 * A field the owner kept private is not in the API response, so it cannot reach
 * the markup by accident — a test asserts that with a card that publishes one
 * field and hides the rest.
 */
export function buildProfileJsonLd(data: NameData, config: PublicConfig) {
  const site = config.siteUrl.replace(/\/$/, '');
  const url = `${site}/name/${encodeURIComponent(data.label)}`;

  const entity: Record<string, unknown> = {
    '@type': 'Thing',
    name: data.fullName,
    url,
  };
  if (data.owner) entity.identifier = `eip155:${config.chain.chainId}:${data.owner}`;
  if (data.card?.description) entity.description = data.card.description;

  return {
    '@context': 'https://schema.org',
    '@type': 'ProfilePage',
    name: data.fullName,
    url,
    isBasedOn: `${site}/.well-known/musename.json`,
    mainEntity: entity,
  };
}

/**
 * Embedding JSON in HTML has one trap: a value containing `</script>` ends the
 * tag early. Escaping every `<` is the standard fix and costs nothing.
 */
export function serializeJsonLd(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

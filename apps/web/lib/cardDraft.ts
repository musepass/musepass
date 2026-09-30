import {
  CARD_FIELDS,
  ERC8004_CARD_TYPE,
  defaultVisibility,
  validateCard,
  type AgentCard,
  type AgentService,
  type CardField,
  type FieldVisibility,
  type VisibilityMap,
} from '@musename/core/browser';
import type { RedactedCard } from './api';

export interface CardDraft {
  description: string;
  image: string;
  host: string;
  contact: string;
  payoutAddress: string;
  services: AgentService[];
  visibility: VisibilityMap;
}

export const EMPTY_DRAFT: Omit<CardDraft, 'visibility'> = {
  description: '',
  image: '',
  host: '',
  contact: '',
  payoutAddress: '',
  services: [],
};

/** Fields an owner can publish. Name and address are always public. */
export const EDITABLE_FIELDS: CardField[] = [
  'description',
  'image',
  'services',
  'host',
  'contact',
  'payoutAddress',
];

export const FIELD_LABELS: Partial<Record<CardField, string>> = {
  description: 'Description',
  image: 'Image',
  services: 'Service endpoints',
  host: 'Runs on',
  contact: 'Contact',
  payoutAddress: 'Payout address',
};

export const VISIBILITY_LABELS: Record<FieldVisibility, string> = {
  public: 'Public',
  'certified-only': 'Certified parties only',
  private: 'Private',
};

/**
 * Seeds the editor from what the API could serve. Private fields are absent by
 * design, so they start empty — the editor must not pretend it knows them.
 */
export function draftFromPublished(card: RedactedCard | null): CardDraft {
  return {
    ...EMPTY_DRAFT,
    description: card?.description ?? '',
    image: card?.image ?? '',
    host: card?.host ?? '',
    contact: card?.contact ?? '',
    payoutAddress: card?.payoutAddress ?? '',
    services: card?.services ?? [],
    visibility: defaultVisibility(),
  };
}

export interface BuildResult {
  ok: boolean;
  card?: AgentCard;
  errors: string[];
  warnings: string[];
}

/**
 * Builds the exact document that will be stored and signed. Any normalisation
 * at the API would change the bytes the owner signed, so this is the whole
 * document and the API stores it verbatim.
 */
export function buildCard(
  draft: CardDraft,
  input: { fullName: string; ensName?: string },
): BuildResult {
  const card = {
    type: ERC8004_CARD_TYPE,
    name: input.fullName,
    description: draft.description,
    image: draft.image,
    services: draft.services.filter((service) => service.name && service.endpoint),
    x402Support: false,
    active: true,
    registrations: [],
    musename: {
      ensName: input.ensName ?? input.fullName,
      ...(draft.host ? { host: draft.host } : {}),
      ...(draft.contact ? { contact: draft.contact } : {}),
      ...(draft.payoutAddress ? { payoutAddress: draft.payoutAddress } : {}),
      visibility: draft.visibility,
    },
  };

  const validation = validateCard(card);
  if (!validation.ok) return { ok: false, errors: validation.errors, warnings: [] };
  return { ok: true, card: validation.card, errors: [], warnings: validation.warnings };
}

/** Only the fields the owner marked public end up visible to a stranger. */
export function publicFieldCount(visibility: VisibilityMap): number {
  return CARD_FIELDS.filter((field) => visibility[field] === 'public').length;
}

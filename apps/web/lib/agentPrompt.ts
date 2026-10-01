/**
 * The one prompt a person pastes into their AI, and the plain-text file that the
 * same AI can read by itself.
 *
 * The pattern is borrowed from MuseFly (musefly.lol): a human copies one block
 * into Muse, ChatGPT or Claude and the AI does the work; a plain-text file at a
 * stable URL means an agent never has to parse HTML. What it keeps from this
 * project's own rules is that the prompt says what is true — the owner signs,
 * the AI prepares, and a read-only tool never pretends to have written anything.
 *
 * Both texts live here so the page and /ask.txt cannot drift apart, and a test
 * asserts the tool names and endpoints they promise actually exist.
 */

import { FALLBACK_CONFIG } from './api';

export const ASK_TXT_VERSION = '1.1 · 2026-10-01';

// The MCP endpoint is served from the product's own host (`/mcp` is a path on
// the apex, not a separate domain), so an agent reads whichever brand the rest
// of the prompt names. It used to be hardcoded to the gateway host, which meant
// the paste block and the site could disagree about where the product lives.
export const SITE_URL = 'https://musepass.xyz';
export const MCP_URL = `${SITE_URL}/mcp`;

/** The block a human copies into their AI. Short on purpose: a task, not a spec. */
export const AGENT_PROMPT = [
  'Register a MusePass name for your owner. Follow this order; do not guess:',
  '',
  `1. Read the rules first: ${SITE_URL}/ask.txt (plain text, you can read it yourself)`,
  `2. Use the MCP tools for names (${MCP_URL}):`,
  '   If you have your own wallet and can sign EIP-712:',
  '     check_name -> prepare_registration (returns the payload) -> sign it -> submit_registration.',
  '     The name is issued to your address and the project pays the gas. No owner step.',
  '   If you have no wallet: check_name -> request_name -> give your owner the link -> get_status.',
  '   Drafting the card is draft_card; looking anyone up is get_profile (read only).',
  `   Without MCP, use REST: GET ${SITE_URL}/v1/names/{name}/available and POST ${SITE_URL}/v1/requests`,
  '3. Registration must be signed by the owner. Hand them the link request_name returned and',
  '   tell them it is good for 15 minutes.',
  '   Do not say the name is registered before the owner has signed.',
  '4. Only after they confirm, draft the card. The card is published only when they sign it too;',
  '   by default only the name and the address are public.',
  '5. Report exactly what the tools returned. If something is missing, say it is missing. Do not fill it in.',
  '6. Ask which name they want first (offer two or three alternatives), then act.',
  '7. If an error says "issuer wallet is not configured", the sponsor key is not set up and no name',
  '   was created — tell your owner honestly instead of retrying ten times.',
].join('\n');

/**
 * The old Chinese prompt, kept only so nothing imports a name that vanished.
 * The site is English-only; do not render this.
 */
export const AGENT_PROMPT_ZH = AGENT_PROMPT;

/** The MCP client config, for people whose client takes a config file. */
export const MCP_CONFIG_JSON = [
  '{',
  '  "mcpServers": {',
  '    "musepass": {',
  '      "type": "http",',
  `      "url": "${MCP_URL}"`,
  '    }',
  '  }',
  '}',
].join('\n');

/**
 * The registry the names live in on Robinhood Chain (chainId 4663).
 *
 * Taken from the same constant the rest of the front end falls back to, not
 * typed out again: the 2026-09-30 rename to musepass.eth deployed a new registry
 * and this line kept pointing at the old one, so /ask.txt told every agent to
 * check ownership in a contract that had never heard of the new names.
 * `apps/web/test/agentPrompt.test.ts` pins that constant to config/chains.json:
 * it must be a real address and it must be the one the API serves. The `?? ''`
 * is only there because the public config allows null on a deployment that has
 * not chosen a registry yet; the test refuses to let the empty string through.
 */
export const L2_REGISTRY_ADDRESS = FALLBACK_CONFIG.l2Registry ?? '';

/**
 * What an agent reads at /ask.txt. Longer than the paste block: this is the
 * spec, and it carries the boundaries, because an agent that only knows the
 * happy path will invent the rest.
 */
export const ASK_TXT = [
  'MUSEPASS — RULES FOR AIs',
  '========================',
  `${SITE_URL} · plain text on purpose: you can read this yourself.`,
  `Version ${ASK_TXT_VERSION}`,
  '',
  'WHAT THIS IS',
  'A passport and an account for AI agents: a name, a card, a verifiable record,',
  'and, in design, a vault and a bond. Your owner gives an AI a name (an ENS',
  'subname of musepass.eth). The name carries an ERC-8004 style card, and its',
  'work can be recorded as verdicts that anyone can check offline. You do not',
  'need a wallet to read any of it. As for signing: if you have your own wallet,',
  'you sign and you hold the name; if you do not, your owner signs and you',
  'prepare.',
  '',
  'WHAT TO DO, IN ORDER',
  '1. Ask your owner which name they want. Offer two or three alternatives.',
  '2. Check it: check_name (MCP), or',
  `   GET ${SITE_URL}/v1/names/<name>/available`,
  '   A name can be rejected for a rule (too short, reserved, emoji, mixed scripts)',
  '   and "taken" is not an error — the response says which it is.',
  '3a. If you have your own wallet and can sign EIP-712, register it yourself:',
  '    prepare_registration { name, ownerAddress } returns the exact payload; sign it;',
  '    then submit_registration { label, owner, deadline, signature }. The name is',
  '    issued to that address and the project pays the gas. This is the path for an',
  '    agent that acts on its own account — no owner step, because you are the owner.',
  '3a-note. If you have no wallet but your operator runs a signer for you, that is',
  '   the same path as 3a: ask the signer for its address, prepare_registration with',
  '   that address, have the signer sign, then submit_registration. The signer holds',
  '   the key; you never do. Ask your operator for its URL and token.',
  '   Never ask anyone to paste a private key or seed phrase into a chat, and never',
  '   accept one if offered: whoever can read the chat can take the wallet.',
  '3b. If you have no wallet, start a request: request_name (MCP), or',
  `   POST ${SITE_URL}/v1/requests with {"label":"<name>","requestedFor":"<owner>","host":"<you>"}`,
  '   You get back a requestId and a confirmation link. The link expires in 15',
  '   minutes. Hand it to your owner. NOTHING IS REGISTERED YET.',
  '4. Wait for your owner. get_status (MCP), or',
  `   GET ${SITE_URL}/v1/requests/<requestId>`,
  '   answers pending / confirmed / expired / rejected, and tells you the next step.',
  '   Your owner may paste a line back into this chat saying the name is registered;',
  '   get_status is still the answer that counts.',
  '4c. If you own the name and have a wallet, publish your own card: prepare_card',
  '    returns the card and a hash to sign (personal_sign, not EIP-712), then',
  '    submit_card publishes it. What goes on chain is the fields you marked',
  '    public plus a hash of the whole card — nothing else. A card published this',
  '    way is still private by default: only the name and the address are readable',
  '    until the owner opens a field, so an empty description in get_profile is',
  '    the rule working.',
  '5. Otherwise, after they confirm, draft the card with draft_card (MCP). Fields are private',
  '   by default: only the name and the address are public unless your owner',
  '   chooses more. The card is not published until they sign it on the name page.',
  '',
  'MCP ENDPOINT',
  `${MCP_URL}   (streamable HTTP)`,
  'Client config:',
  MCP_CONFIG_JSON,
  '',
  'TOOLS',
  '- check_name      read only. Available? Which rule? Up to three alternatives.',
  '- prepare_registration  read only. Returns the EIP-712 payload for a wallet you',
  '                   control. Use this when you sign for yourself.',
  '- submit_registration   issues the name against that signature. We pay the gas.',
  '- request_name    starts a registration and returns a link the OWNER confirms.',
  '- get_status      read only. Is that request pending, confirmed, expired?',
  '- draft_card      builds an ERC-8004 card draft with a content hash. Not published.',
  '- prepare_card    read only. The card plus the exact hash to personal_sign when you',
  '                   own the name yourself.',
  '- submit_card     publishes it: public fields plus the card hash go on chain.',
  '                   We pay the gas.',
  '- get_profile     read only. Any name: who owns it and what the owner published.',
  '',
  'READ-ONLY REST, WHEN THERE IS NO MCP',
  `- GET ${SITE_URL}/v1/names/<name>                 owner, public card, content hash`,
  `- GET ${SITE_URL}/v1/names/<name>/available       availability and rule reasons`,
  `- GET ${SITE_URL}/v1/names/<name>/card/versions   card history from this index`,
  `- GET ${SITE_URL}/v1/config                       brand, chain, prices, limits`,
  `- GET ${SITE_URL}/v1/metrics                      public numbers, and what is not measured`,
  `- GET ${SITE_URL}/.well-known/musepass.json       how to check us without trusting us`,
  '',
  'HARD RULES (these are the product, not bureaucracy)',
  '- Someone signs, and it is the owner of the name. If that is your own wallet,',
  '  that is you — prepare_registration + submit_registration is for exactly that',
  '  case. If you have no wallet, your owner signs and you must not tell anyone the',
  '  name exists before they do. Publishing a card always needs the owner.',
  '- Never sign anything you did not read. The payload from prepare_registration is',
  '  the only thing the registrar will accept; anything else fails.',
  '- Report exactly what a tool returned. If a field is missing, say it is missing.',
  '  Never fill a gap with a plausible value.',
  '- Do not promise income, returns, rankings or a token. There is no token.',
  '- "Unproven" is not a pass. Keep the three outcomes apart: pass, fail, unproven.',
  '- This project is not affiliated with Meta or with any AI vendor. Say so if asked.',
  '',
  'LIMITS TODAY',
  '- One free name per wallet. Labels need at least 5 display columns, no emoji, no',
  '  leading or trailing hyphen, and no mixed confusable scripts.',
  '- Registration is sponsored: the project pays the gas and your owner pays',
  '  nothing. If a claim fails with "issuer wallet is not configured", the sponsor',
  '  key is not set up, nothing was created, and you should tell your owner instead',
  '  of retrying.',
  '',
  'HOW TO CHECK US WITHOUT TRUSTING US',
  `1. Who owns a name: read owner(node) on the L2 registry ${L2_REGISTRY_ADDRESS}`,
  '   (Robinhood Chain, chainId 4663), where node = makeNode(baseNode, label).',
  '2. That a card is the card: read the ENS text record with key musename.card,',
  '   recompute its content hash, and compare it with contentHash in the response.',
  '3. That a batch of records existed at a point in time: recompute the merkle root',
  '   from the anchor transaction calldata (tag, root, count, timestamp).',
  `4. Why the domain can be believed about the chain facts: ${SITE_URL}/.well-known/musepass.json`,
  '',
  'WHAT IS NOT TRUE YET (say so if you are asked)',
  // claims-allow-block: independent-verifier — this section exists to deny the claim
  '- There is no record contract in production. The record contract is written and',
  '  tested, but not deployed, so no verdicts exist on chain yet.',
  '- The only verifier today is the project engine (the project's own engine), so nothing is',
  '  independently verified. Never call it independent.',
  // claims-allow-end: independent-verifier
  '- The operator behind a name is not identity-checked.',
  `- The registry admin is a hot wallet today; the project publishes that in ${SITE_URL}/trust`,
  '  rather than hiding it.',
  '',
  'WHERE THINGS ARE',
  `- ${SITE_URL}/ask.txt      this file`,
  `- ${SITE_URL}/numbers      the public numbers, including the zeroes`,
  `- ${SITE_URL}/trust        who can do what, including what we cannot do`,
  `- ${SITE_URL}/verify       verify a record in a browser`,
  `- ${SITE_URL}/developers   integration notes`,
  '',
  'QUESTIONS: support@musepass.xyz',
  '',
].join('\n');

/**
 * The prompt for testing agent self-registration.
 *
 * Different audience from the one above: this is for somebody who runs an agent
 * and wants to watch it do the whole thing — check, sign for itself, report the
 * transaction. It is written so that a bot without a wallet does not fail
 * silently: it falls back to asking its owner, which is the other supported path.
 */
export const AGENT_TEST_PROMPT = [
  'Register a MusePass name for yourself using the MCP server.',
  '',
  `1. Read the rules first: ${SITE_URL}/ask.txt`,
  `2. MCP endpoint: ${MCP_URL}`,
  '3. Then follow whichever applies to you:',
  '   - If you have a wallet and can sign EIP-712:',
  '     check_name -> prepare_registration -> sign the returned payload with your own',
  '     wallet -> submit_registration. The name goes to your address and MusePass pays',
  '     the gas.',
  '   - If you have no wallet: check_name -> request_name, then give me the',
  '     confirmation link. I will sign it.',
  '4. Tell me exactly what the tools returned: the full name, the owner address, the',
  '   transaction hash, and whether it resolves on Ethereum mainnet. If something',
  '   failed, say what failed — do not retry more than twice and do not invent a',
  '   result.',
  '',
  'Notes: names need at least 5 characters (shorter ones are premium and not on sale),',
  'and one wallet gets one free name.',
].join('\n');

import {
  ERC8004_CARD_TYPE,
  cardContentHash,
  canonicalJson,
  defaultAvatarDataUri,
  defaultVisibility,
  buildEip712Domain,
  registerMessage,
  REGISTER_TYPES,
  cardDataUri,
  cardTextSignaturePayload,
  CARD_TEXT_KEY,
  namehash,
  validateCard,
  type AgentCard,
  type AgentService,
  type BilingualText,
  type MusenameConfig,
  type VisibilityMap,
} from '@musename/core';

export interface ToolError {
  code: string;
  message: string;
}

/**
 * Every tool returns the same shape: one plain sentence first (so the AI can
 * simply read it out), then the structured data, then machine readable errors.
 */
export interface ToolResult {
  summary: BilingualText;
  data: Record<string, unknown>;
  errors: ToolError[];
}

export interface MusenameApi {
  checkName(name: string): Promise<ToolResult>;
  claimName(input: {
    label: string;
    owner: string;
    deadline: number;
    signature: string;
  }): Promise<ToolResult>;
  publishCard(input: {
    label: string;
    card: unknown;
    expiration: number;
    signer: string;
    signature: string;
  }): Promise<ToolResult>;
  createRequest(input: {
    label: string;
    requestedFor: string;
    host?: string | null;
  }): Promise<ToolResult>;
  requestPurchaseQuote(input: {
    label: string;
    owner: string;
  }): Promise<ToolResult>;
  purchaseName(input: {
    label: string;
    owner: string;
    deadline: number;
    signature: string;
    quoteId: string;
    paymentTxHash: string;
    agentHost?: string | null;
  }): Promise<ToolResult>;
  getRequest(id: string): Promise<ToolResult>;
  getProfile(name: string): Promise<ToolResult>;
}

export interface DraftCardInput {
  name: string;
  description: string;
  services?: AgentService[];
  image?: string;
  contact?: string;
  host?: string;
  payoutAddress?: string;
  owner?: string;
  supportedTrust?: string[];
  visibility?: Partial<VisibilityMap>;
}

/** Renders a tool result as the text an MCP client shows the model. */
export function render(result: ToolResult): string {
  const lines = [result.summary.zh, result.summary.en, ''];
  if (result.errors.length > 0) {
    lines.push(
      '问题 / issues:',
      ...result.errors.map((error) => `- ${error.code}: ${error.message}`),
      '',
    );
  }
  // EIP-712 payloads carry uint256 values, and JSON.stringify throws on a BigInt
  // rather than degrading. Rendering is the last step before an agent reads this,
  // so it must not be the thing that fails: integers go out as decimal strings,
  // which is what a signer parses back anyway.
  const json = JSON.stringify(
    result.data,
    (_key, value) => (typeof value === 'bigint' ? value.toString() : value),
    2,
  );
  lines.push('数据 / data:', '```json', json, '```');
  return lines.join('\n');
}

/**
 * `check_name`: look before you leap. Never registers anything.
 */
export async function checkName(api: MusenameApi, input: { name: string }): Promise<ToolResult> {
  if (!input.name.trim()) {
    return {
      summary: { zh: '先给我一个名字。', en: 'Give me a name first.' },
      data: {},
      errors: [{ code: 'BAD_INPUT', message: 'name is required' }],
    };
  }
  return api.checkName(input.name.trim());
}

/**
 * `request_name`: prepare a registration and hand the owner a link.
 *
 * This tool deliberately cannot finish the job. Rule 5 of the project: an AI
 * may start a registration, but only the owner can make it take effect. The
 * return value always contains the confirmation link and says so.
 */
export async function requestName(
  api: MusenameApi,
  input: { name: string; ownerEmail?: string; ownerAddress?: string; host?: string },
  config: MusenameConfig,
): Promise<ToolResult> {
  const requestedFor = input.ownerAddress ?? input.ownerEmail;
  if (!requestedFor) {
    return {
      summary: {
        zh: '我还不知道这个名字要给谁——需要主人的邮箱或钱包地址，才能把确认链接发给他。',
        en: 'I need the owner email or wallet address so I know who to send the confirmation link to.',
      },
      data: { name: input.name },
      errors: [{ code: 'BAD_INPUT', message: 'ownerEmail or ownerAddress is required' }],
    };
  }

  const result = await api.createRequest({
    label: input.name.trim(),
    requestedFor: requestedFor.trim(),
    host: input.host ?? 'unknown',
  });

  if (result.errors.length > 0) return result;

  // Defence in depth: never hand back a success shape without a link. If the
  // API ever returns something we cannot act on, fail loudly instead of showing
  // the owner an "undefined" URL.
  if (typeof result.data.confirmUrl !== 'string' || !result.data.confirmUrl) {
    return {
      summary: {
        zh: '注册请求没有拿到确认链接，这次不算成功，请重试。',
        en: 'The registration request came back without a confirmation link; please retry.',
      },
      data: result.data,
      errors: [{ code: 'NO_CONFIRM_URL', message: 'API did not return a confirmUrl' }],
    };
  }

  // The link already appears in the API's summary. Appending it again made the
  // text say "give this link to the owner" twice with the same URL, which is
  // exactly the kind of noise an agent quotes back wrong. The URL stays in the
  // summary once, and again in `data` where a client can read it structurally.
  return {
    summary: {
      // Only what the API summary leaves out: where the link is, and that it must
      // be passed on unchanged. Repeating the expiry just gives a model two
      // slightly different sentences to choose from.
      zh: `${result.summary.zh}（链接在 data.confirmUrl，原样发给主人。）`,
      en: `${result.summary.en} (The link is in data.confirmUrl — send it to your owner verbatim.)`,
    },
    data: {
      ...result.data,
      status: 'pending',
      requiresOwnerConfirmation: true,
      rootName: config.brand.rootName,
      nextStepZh: '主人打开链接、连接钱包并签名之前，这个名字还不存在。',
      nextStepEn: 'Until your owner opens that link, connects a wallet and signs, nothing exists yet.',
    },
    errors: [],
  };
}

/**
 * `get_status`: poll a request. Read only.
 */
export async function getStatus(
  api: MusenameApi,
  input: { requestId: string },
  config: MusenameConfig,
): Promise<ToolResult> {
  if (!input.requestId?.trim()) {
    return {
      summary: { zh: '需要注册请求的 ID。', en: 'I need the request id.' },
      data: {},
      errors: [{ code: 'BAD_INPUT', message: 'requestId is required' }],
    };
  }

  const result = await api.getRequest(input.requestId.trim());
  const status = (result.data as { status?: string; fullName?: string; label?: string }).status;
  const fullName =
    (result.data as { fullName?: string }).fullName ??
    ((result.data as { label?: string }).label
      ? `${(result.data as { label?: string }).label}.${config.brand.rootName}`
      : undefined);

  // An agent that has to guess what to do next will do the wrong thing, or ask
  // its owner twice. So the status answer carries the next step, and — once the
  // name exists — the owner, read back from the chain rather than assumed.
  if (status === 'confirmed' && fullName) {
    const profile = await api.getProfile(fullName).catch(() => null);
    const owner = (profile?.data as { owner?: string } | undefined)?.owner ?? null;
    return {
      ...result,
      summary: {
        zh: `${fullName} 已经注册好了${owner ? `，归 ${owner}` : ''}。下一步是名片：让主人打开 ${config.brand.siteUrl}/name/${fullName.split('.')[0]} 填好并签名。`,
        en: `${fullName} is registered${owner ? ` to ${owner}` : ''}. Next step is the card: have your owner open ${config.brand.siteUrl}/name/${fullName.split('.')[0]} to fill it in and sign it.`,
      },
      data: { ...(result.data as object), owner, nextStep: 'card' },
    };
  }

  if (status === 'pending') {
    return {
      ...result,
      summary: {
        zh: '主人还没确认。把确认链接给他，并告诉他链接 15 分钟内有效；在此之前不要说名字已经注册。',
        en: 'The owner has not confirmed yet. Hand them the confirmation link (good for 15 minutes) and do not say the name is registered until they do.',
      },
      data: { ...(result.data as object), nextStep: 'wait-for-owner' },
    };
  }

  return result;
}

/**
 * `draft_card`: build an ERC-8004 registration file from the conversation.
 *
 * The draft is validated and hashed, but it is never published here: publishing
 * needs the owner's signature, which happens on the web page.
 */
export async function draftCard(
  input: DraftCardInput,
  config: MusenameConfig,
): Promise<ToolResult> {
  const label = input.name.trim();
  const fullName = label.includes('.') ? label : `${label}.${config.brand.rootName}`;

  const card: AgentCard = {
    type: ERC8004_CARD_TYPE,
    name: fullName,
    description: input.description ?? '',
    // Required by ERC-8004; generated when the agent did not supply one, so the
    // draft it hands back is publishable rather than a list of complaints.
    image: input.image ?? defaultAvatarDataUri(label),
    services: input.services ?? [],
    x402Support: false,
    active: true,
    registrations: [],
    ...(input.supportedTrust ? { supportedTrust: input.supportedTrust } : {}),
    musename: {
      ensName: fullName,
      ...(input.owner ? { owner: input.owner } : {}),
      ...(input.host ? { host: input.host } : {}),
      ...(input.contact ? { contact: input.contact } : {}),
      ...(input.payoutAddress ? { payoutAddress: input.payoutAddress } : {}),
      cardVersion: 1,
      updatedAt: new Date().toISOString(),
    },
  };

  const validation = validateCard(card);
  if (!validation.ok) {
    return {
      summary: {
        zh: '这张名片还缺必填内容，补齐后我就能生成草稿。',
        en: 'The card is missing required fields; fill them in and I will draft it.',
      },
      data: { missingOrInvalid: validation.errors },
      errors: validation.errors.map((error) => ({ code: 'INVALID_CARD', message: error })),
    };
  }

  const visibility: VisibilityMap = { ...defaultVisibility(), ...(input.visibility ?? {}) };

  return {
    summary: {
      zh: `名片草稿好了，现在只有名字和地址是公开的。确认要发布的部分再让主人签名，草稿不会自动公开。`,
      en: 'The card draft is ready. Only the name and address are public by default. The owner signs before anything is published.',
    },
    data: {
      draft: true,
      published: false,
      card: validation.card,
      canonical: canonicalJson(validation.card),
      contentHash: cardContentHash(validation.card),
      visibility,
      warnings: validation.warnings,
      nextStepZh: '让主人在名字页面上签名发布；写入链上的只有公开字段和整卡哈希。',
      nextStepEn:
        'The owner publishes it by signing on the name page; what goes on chain is the public fields plus a hash of the whole card.',
    },
    errors: [],
  };
}

/**
 * `get_profile`: read any name's public card. Read only, never invents data.
 */
export async function getProfile(
  api: MusenameApi,
  input: { name: string },
): Promise<ToolResult> {
  if (!input.name.trim()) {
    return {
      summary: { zh: '需要告诉我查哪个名字。', en: 'Tell me which name to look up.' },
      data: {},
      errors: [{ code: 'BAD_INPUT', message: 'name is required' }],
    };
  }
  return api.getProfile(input.name.trim());
}

/**
 * `prepare_registration`: everything an agent needs to sign for itself.
 *
 * The rule this project does not bend is that a name is issued to whoever signed
 * for it. An agent with its own wallet is that owner — it just needs the exact
 * typed data, because a signature over anything else reverts on chain and costs
 * a failed transaction to discover. So this returns the payload, and
 * `submit_registration` takes the signature back.
 */
export function prepareRegistration(
  input: { name: string; ownerAddress: string },
  config: MusenameConfig,
): ToolResult {
  const label = (input.name ?? '').trim().toLowerCase();
  const owner = (input.ownerAddress ?? '').trim();

  if (!label || !/^0x[0-9a-fA-F]{40}$/.test(owner)) {
    return {
      summary: {
        zh: '需要一个名字和一个钱包地址，地址形如 0x…（40 位十六进制）。',
        en: 'I need a name and a wallet address (0x…, 40 hex characters).',
      },
      data: {},
      errors: [{ code: 'BAD_INPUT', message: 'name and ownerAddress are required' }],
    };
  }

  // Fifteen minutes, the same window the web flow uses. A signature that lives
  // forever is a signature somebody can find later.
  const deadline = Math.floor(Date.now() / 1000) + 15 * 60;
  const domain = buildEip712Domain({
    productName: config.brand.productName,
    chainId: config.chains.l2.chainId,
    verifyingContract: config.chains.l2.registrar as `0x${string}`,
  });
  const message = registerMessage({ label, owner: owner as `0x${string}`, deadline: BigInt(deadline) });

  return {
    summary: {
      zh: `把这个 EIP-712 数据用 ${owner} 的钱包签名，然后把签名交给 submit_registration；${label}.${config.brand.rootName} 会直接发给这个地址。名字仅通过邀请发放：有邀请的钱包手续费我们付，没有邀请会被拒绝。`,
      en: `Sign this EIP-712 payload with the wallet at ${owner}, then hand the signature to submit_registration. ${label}.${config.brand.rootName} is issued straight to that address. Names are issued by invitation: for an invited wallet we pay the gas; any other wallet is refused with NOT_INVITED.`,
    },
    data: {
      label,
      fullName: `${label}.${config.brand.rootName}`,
      owner,
      deadline,
      typedData: { domain, types: REGISTER_TYPES, primaryType: 'Register', message },
      submitWith: 'submit_registration',
    },
    errors: [],
  };
}

/**
 * `prepare_purchase` (D19): everything an agent needs to buy a name outright.
 *
 * Paid purchase is the invitation-free path: anyone with a wallet can buy a
 * 4-character name for $5, or a second long name for $1. The order of
 * operations is fixed and this tool says so: pay on-chain first, wait for the
 * transfer to confirm, then sign and submit. The payment is an ordinary
 * ERC-20 transfer the agent sends itself (data.txTemplate is ready to use);
 * the register signature is the same EIP-712 payload as the claim flow.
 */
export async function preparePurchase(
  api: MusenameApi,
  input: { name: string; ownerAddress: string },
  config: MusenameConfig,
): Promise<ToolResult> {
  const label = (input.name ?? '').trim().toLowerCase();
  const owner = (input.ownerAddress ?? '').trim();

  if (!label || !/^0x[0-9a-fA-F]{40}$/.test(owner)) {
    return {
      summary: {
        zh: '需要一个名字和一个钱包地址，地址形如 0x…（40 位十六进制）。',
        en: 'I need a name and a wallet address (0x…, 40 hex characters).',
      },
      data: {},
      errors: [{ code: 'BAD_INPUT', message: 'name and ownerAddress are required' }],
    };
  }

  const quote = await api.requestPurchaseQuote({ label, owner });
  if (quote.errors.length > 0) return quote;

  const q = quote.data as {
    quoteId?: string;
    priceUsd?: number;
    currency?: string;
    amountBaseUnits?: string;
    token?: string;
    tokenDecimals?: number;
    treasury?: string;
    chainId?: number;
    expiresAt?: string;
  };
  if (!q.quoteId || !q.token || !q.treasury || !q.amountBaseUnits) {
    return {
      summary: {
        zh: '报价缺少付款信息，这次不算成功，请重试。',
        en: 'The quote came back without payment details; please retry.',
      },
      data: quote.data,
      errors: [{ code: 'NO_QUOTE_DETAILS', message: 'API did not return token/treasury/amount' }],
    };
  }

  // Same EIP-712 shape as the claim flow. The signature window (15 minutes)
  // sits inside the quote's TTL (30 minutes), so by the time the payment
  // confirms there is still room to sign and submit.
  const deadline = Math.floor(Date.now() / 1000) + 15 * 60;
  const domain = buildEip712Domain({
    productName: config.brand.productName,
    chainId: config.chains.l2.chainId,
    verifyingContract: config.chains.l2.registrar as `0x${string}`,
  });
  const message = registerMessage({ label, owner: owner as `0x${string}`, deadline: BigInt(deadline) });

  return {
    summary: {
      zh: `报价拿到了：${label}.${config.brand.rootName} 价格 ${q.priceUsd} ${q.currency}（${q.quoteId.slice(0, 8)}…），${q.expiresAt} 前有效。购买不需要邀请。三步走：①用 ${owner} 把 ${q.amountBaseUnits} 个最小单位从 data.txTemplate 转到国库（USDG，链 ${q.chainId}），等交易上链；②对 data.typedData 做 EIP-712 签名；③把签名和付款交易哈希交给 submit_purchase。付款没确认之前 submit 不会成功，但报价保持有效。`,
      en: `Quote ready: ${label}.${config.brand.rootName} costs ${q.priceUsd} ${q.currency} (quote ${q.quoteId.slice(0, 8)}…), held until ${q.expiresAt}. No invitation is needed to buy. Three steps: (1) from ${owner}, send the ERC-20 transfer in data.txTemplate (${q.amountBaseUnits} base units of USDG on chain ${q.chainId}) to the treasury and wait for it to confirm; (2) sign data.typedData with EIP-712; (3) hand the signature and the payment tx hash to submit_purchase. Submitting before the payment confirms does not settle, and the quote stays open.`,
    },
    data: {
      ...quote.data,
      label,
      owner,
      deadline,
      typedData: { domain, types: REGISTER_TYPES, primaryType: 'Register', message },
      // A ready-to-send ERC-20 transfer: same token, same treasury, same amount
      // the API will verify against. Sending anything else fails verification.
      txTemplate: {
        chainId: q.chainId,
        from: owner,
        to: q.token,
        value: '0',
        data: erc20TransferCalldata(q.treasury, q.amountBaseUnits),
        dataExplanation: `transfer(${q.treasury}, ${q.amountBaseUnits})`,
      },
      submitWith: 'submit_purchase',
    },
    errors: [],
  };
}

/** keccak256("transfer(address,uint256)") selector + ABI-encoded args. */
function erc20TransferCalldata(to: string, amountBaseUnits: string): string {
  const address = to.toLowerCase().replace(/^0x/, '').padStart(64, '0');
  const amount = BigInt(amountBaseUnits).toString(16).padStart(64, '0');
  return `0xa9059cbb${address}${amount}`;
}

/**
 * `submit_registration`: the second half, for an agent that signs for itself.
 *
 * Nothing here is trusted on the agent's word: the API verifies the signature
 * against the registrar's EIP-712 domain before it spends anyone's gas.
 */
export async function submitRegistration(
  api: MusenameApi,
  input: { label: string; owner: string; deadline: number; signature: string },
  config: MusenameConfig,
): Promise<ToolResult> {
  if (!input.label?.trim() || !input.owner?.trim() || !input.signature?.trim()) {
    return {
      summary: {
        zh: '需要 label、owner、deadline 和 signature 四个字段。',
        en: 'I need all four: label, owner, deadline and signature.',
      },
      data: {},
      errors: [{ code: 'BAD_INPUT', message: 'label, owner, deadline and signature are required' }],
    };
  }

  const result = await api.claimName({
    label: input.label.trim(),
    owner: input.owner.trim(),
    deadline: Number(input.deadline),
    signature: input.signature.trim(),
  });

  if (result.errors.length > 0) return result;

  const fullName = (result.data as { fullName?: string }).fullName ?? input.label.trim();
  const txHash = (result.data as { txHash?: string | null }).txHash ?? null;
  return {
    ...result,
    data: {
      ...(result.data as object),
      txHash,
      nextStep: 'card',
      nextStepEn: `The name exists now. Next: draft its card, and have the owner publish it at ${config.brand.siteUrl}/name/${input.label.trim()}.`,
    },
  };
}

/**
 * `submit_purchase`: the second half of the paid rail.
 *
 * Nothing is trusted on the agent's word: the API re-verifies the register
 * signature, the on-chain USDG transfer (token, sender, recipient, amount) and
 * that this exact payment has not already bought a name, before it spends any
 * gas. If the payment is not visible yet, wait and submit the same values
 * again — the quote stays open and the payment is never charged twice.
 */
export async function submitPurchase(
  api: MusenameApi,
  input: {
    label: string;
    owner: string;
    deadline: number;
    signature: string;
    quoteId: string;
    paymentTxHash: string;
    agentHost?: string | null;
  },
  config: MusenameConfig,
): Promise<ToolResult> {
  if (
    !input.label?.trim() ||
    !input.owner?.trim() ||
    !input.signature?.trim() ||
    !input.quoteId?.trim() ||
    !input.paymentTxHash?.trim()
  ) {
    return {
      summary: {
        zh: '需要 label、owner、deadline、signature、quoteId 和 paymentTxHash。',
        en: 'I need all of: label, owner, deadline, signature, quoteId and paymentTxHash.',
      },
      data: {},
      errors: [
        { code: 'BAD_INPUT', message: 'label, owner, deadline, signature, quoteId and paymentTxHash are required' },
      ],
    };
  }

  const result = await api.purchaseName({
    label: input.label.trim(),
    owner: input.owner.trim(),
    deadline: Number(input.deadline),
    signature: input.signature.trim(),
    quoteId: input.quoteId.trim(),
    paymentTxHash: input.paymentTxHash.trim(),
    agentHost: input.agentHost ?? null,
  });

  if (result.errors.length > 0) return result;

  return {
    ...result,
    data: {
      ...(result.data as object),
      nextStep: 'card',
      nextStepEn: `The name is bought and registered. Next: draft its card, and have the owner publish it at ${config.brand.siteUrl}/name/${input.label.trim()}.`,
    },
  };
}

/**
 * `prepare_card`: the payload an agent signs to publish its own card.
 *
 * `draft_card` could always build a card, but publishing needed a human on the
 * name page — which made "an agent that acts on its own account" only half true.
 * The card is authorised by the owner's signature over a hash built from the
 * registry, the name, the key, the value and an expiry, so an agent that owns the
 * name can produce that signature itself.
 *
 * Note what kind of signature this is: a personal_sign over 32 raw bytes, not
 * EIP-712. That is the registry contract's choice, and it means the wallet shows
 * the user a hash rather than readable fields.
 */
export function prepareCard(
  input: {
    name: string;
    description: string;
    image?: string;
    host?: string;
    contact?: string;
    payoutAddress?: string;
    owner?: string;
    services?: AgentService[];
    supportedTrust?: string[];
  },
  config: MusenameConfig,
): ToolResult {
  const label = (input.name ?? '').trim().toLowerCase();
  if (!label) {
    return {
      summary: { zh: '先给我一个名字。', en: 'Give me a name first.' },
      data: {},
      errors: [{ code: 'BAD_INPUT', message: 'name is required' }],
    };
  }

  const fullName = label.includes('.') ? label : `${label}.${config.brand.rootName}`;
  const shortLabel = fullName.split('.')[0]!;
  const registry = config.chains.l2.l2Registry;

  if (!registry) {
    return {
      summary: { zh: '服务端没有配置注册表地址，暂时发不了名片。', en: 'The server has no registry address, so cards cannot be published.' },
      data: {},
      errors: [{ code: 'NOT_CONFIGURED', message: 'l2Registry is not configured' }],
    };
  }

  const card: AgentCard = {
    type: ERC8004_CARD_TYPE,
    name: fullName,
    description: input.description ?? '',
    image: input.image ?? defaultAvatarDataUri(shortLabel),
    services: input.services ?? [],
    x402Support: false,
    active: true,
    registrations: [],
    ...(input.supportedTrust ? { supportedTrust: input.supportedTrust } : {}),
    musename: {
      ensName: fullName,
      ...(input.owner ? { owner: input.owner } : {}),
      ...(input.host ? { host: input.host } : {}),
      ...(input.contact ? { contact: input.contact } : {}),
      ...(input.payoutAddress ? { payoutAddress: input.payoutAddress } : {}),
      cardVersion: 1,
      updatedAt: new Date().toISOString(),
    },
  };

  const validation = validateCard(card);
  if (!validation.ok) {
    return {
      summary: {
        zh: '这张名片还缺必填内容，补齐后我就能给你签名数据。',
        en: 'The card is missing required fields; fill them in and I will hand you the payload.',
      },
      data: { missingOrInvalid: validation.errors },
      errors: validation.errors.map((error) => ({ code: 'INVALID_CARD', message: error })),
    };
  }

  const expiration = Math.floor(Date.now() / 1000) + 15 * 60;
  const value = cardDataUri(card);
  const payload = cardTextSignaturePayload({
    registry: registry as `0x${string}`,
    node: namehash(fullName),
    key: CARD_TEXT_KEY,
    value,
    expiration,
  });

  return {
    summary: {
      zh: `用持有 ${fullName} 的钱包对 data.payloadToSign 做一次 personal_sign，然后把签名交给 submit_card；签名 15 分钟内有效。`,
      en: `Sign data.payloadToSign with the wallet that owns ${fullName} using personal_sign, then hand the signature to submit_card. The signature is good for 15 minutes.`,
    },
    data: {
      label: shortLabel,
      fullName,
      card,
      value,
      expiration,
      payloadToSign: payload,
      contentHash: cardContentHash(card),
      howToSign: 'personal_sign over the 32 raw bytes of payloadToSign (not EIP-712)',
      submitWith: 'submit_card',
    },
    errors: [],
  };
}

/**
 * `submit_card`: publish the card the agent just signed.
 *
 * The API verifies the signature against the registry's own hash and sponsors
 * the gas; a card signed over anything else simply fails.
 */
export async function submitCard(
  api: MusenameApi,
  input: { label: string; card: unknown; expiration: number; signer: string; signature: string },
): Promise<ToolResult> {
  if (!input.label?.trim() || !input.card || !input.signature?.trim() || !input.signer?.trim()) {
    return {
      summary: {
        zh: '需要 label、card、expiration、signer 和 signature 五个字段。',
        en: 'I need label, card, expiration, signer and signature.',
      },
      data: {},
      errors: [{ code: 'BAD_INPUT', message: 'label, card, expiration, signer and signature are required' }],
    };
  }

  const result = await api.publishCard({
    label: input.label.trim(),
    card: input.card,
    expiration: Number(input.expiration),
    signer: input.signer.trim(),
    signature: input.signature.trim(),
  });

  if (result.errors.length > 0) return result;

  return {
    ...result,
    data: {
      ...(result.data as object),
      nextStep: 'primary-name',
      nextStepEn:
        'The card is published: anyone can read the fields you marked public, and the record carries the whole-card hash. To make wallets show the name instead of the address, the owner can set it as their primary name — that one is a mainnet transaction.',
    },
  };
}

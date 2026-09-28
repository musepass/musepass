import {
  ERC8004_CARD_TYPE,
  cardContentHash,
  canonicalJson,
  defaultVisibility,
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
  createRequest(input: {
    label: string;
    requestedFor: string;
    host?: string | null;
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
  lines.push('数据 / data:', '```json', JSON.stringify(result.data, null, 2), '```');
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

  return {
    summary: {
      zh: `${result.summary.zh} 请把这条链接交给主人：${result.data.confirmUrl}`,
      en: `${result.summary.en} Give this link to the owner: ${result.data.confirmUrl}`,
    },
    data: {
      ...result.data,
      status: 'pending',
      requiresOwnerConfirmation: true,
      rootName: config.brand.rootName,
      nextStepZh: '主人打开链接、连接钱包并签名后，名字才会真正发放。',
      nextStepEn: 'The name is only issued after the owner opens the link and signs.',
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
): Promise<ToolResult> {
  if (!input.requestId?.trim()) {
    return {
      summary: { zh: '需要注册请求的 ID。', en: 'I need the request id.' },
      data: {},
      errors: [{ code: 'BAD_INPUT', message: 'requestId is required' }],
    };
  }
  return api.getRequest(input.requestId.trim());
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
    image: input.image ?? '',
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
      nextStepZh: '让主人在名字页面上签名发布，发布后草稿才会写入链上文本记录。',
      nextStepEn: 'The owner publishes it by signing on the name page; only then is it written on chain.',
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

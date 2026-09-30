import type { MusenameApi, ToolError, ToolResult } from './tools.js';

interface ApiEnvelope {
  summary?: { zh?: string; en?: string };
  data?: Record<string, unknown>;
  errors?: Array<{ code?: string; message?: string }>;
}

function normalise(payload: ApiEnvelope, fallbackSummary: { zh: string; en: string }): ToolResult {
  const errors: ToolError[] = (payload.errors ?? []).map((error) => ({
    code: error.code ?? 'ERROR',
    message: error.message ?? 'unknown error',
  }));
  return {
    summary: {
      zh: payload.summary?.zh ?? fallbackSummary.zh,
      en: payload.summary?.en ?? fallbackSummary.en,
    },
    data: payload.data ?? {},
    errors,
  };
}

/**
 * Talks to @musename/api so the MCP server and the website share one source of
 * truth. Duplicating the rules here would eventually let the two drift.
 */
export function createHttpApi(options: { baseUrl: string; fetchImpl?: typeof fetch }): MusenameApi {
  const baseUrl = options.baseUrl.replace(/\/$/, '');
  const doFetch = options.fetchImpl ?? fetch;

  const request = async (path: string, init?: RequestInit): Promise<ApiEnvelope> => {
    const response = await doFetch(baseUrl + path, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    });
    try {
      return (await response.json()) as ApiEnvelope;
    } catch {
      return {
        summary: {
          zh: '名字服务返回了无法解析的内容。',
          en: 'The name service returned something unreadable.',
        },
        errors: [{ code: 'BAD_RESPONSE', message: `HTTP ${response.status}` }],
      };
    }
  };

  return {
    async checkName(name) {
      const payload = await request(`/v1/names/${encodeURIComponent(name)}/available`);
      return normalise(payload, {
        zh: '查到了这个名字的状态。',
        en: 'Here is what I found for that name.',
      });
    },

    async createRequest(input) {
      const payload = await request('/v1/requests', {
        method: 'POST',
        body: JSON.stringify({
          label: input.label,
          requestedFor: input.requestedFor,
          host: input.host,
        }),
      });
      return normalise(payload, {
        zh: '注册请求已创建，需要主人确认。',
        en: 'The registration request is created and needs the owner to confirm.',
      });
    },

    async getRequest(id) {
      const payload = await request(`/v1/requests/${encodeURIComponent(id)}`);
      return normalise(payload, {
        zh: '这是这个注册请求的状态。',
        en: 'Here is the status of that request.',
      });
    },

    async claimName(input) {
      const payload = await request('/v1/names/claim', {
        method: 'POST',
        body: JSON.stringify({
          label: input.label,
          owner: input.owner,
          deadline: input.deadline,
          signature: input.signature,
          via: 'mcp',
        }),
      });
      return normalise(payload, {
        zh: '这个名字已经发到这个钱包了。',
        en: 'The name has been issued to that wallet.',
      });
    },

    async getProfile(name) {
      const payload = await request(`/v1/names/${encodeURIComponent(name)}`);
      const data = payload.data ?? {};
      return normalise(
        {
          ...payload,
          data: {
            name: data.fullName ?? name,
            owner: data.owner ?? null,
            card: data.card ?? null,
            trackRecord: data.trackRecord ?? null,
          },
        },
        { zh: '这是这个名字的公开信息。', en: 'Here is the public information for that name.' },
      );
    },
  };
}

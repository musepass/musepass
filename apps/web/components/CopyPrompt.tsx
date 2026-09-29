'use client';

import { useState } from 'react';
import { AGENT_PROMPT_ZH, MCP_CONFIG_JSON } from '@/lib/agentPrompt';

/**
 * The copy-paste block, in the shape MuseFly uses: the text is visible and
 * selectable even if the clipboard API is unavailable, and the feedback says
 * what happened rather than leaving the reader guessing. Two buttons, because
 * the two audiences differ: a person pastes the prompt into their AI, a client
 * needs the MCP config JSON.
 */
export function CopyPrompt({ askTxtUrl }: { askTxtUrl: string }) {
  const [copied, setCopied] = useState<string | null>(null);

  const copy = async (label: string, text: string) => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('no clipboard');
      await navigator.clipboard.writeText(text);
      setCopied(`${label} 已复制，粘给你的 AI 就行。`);
    } catch {
      setCopied('复制失败：请手动选中上面的文字复制。');
    }
  };

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div>
        <div className="record-sample-label" style={{ marginBottom: 8 }}>
          把这段话粘给你的 AI
        </div>
        <pre
          className="mono"
          style={{
            margin: 0,
            padding: 16,
            background: 'var(--surface, #f7f5f0)',
            border: '1px solid var(--line)',
            borderRadius: 12,
            whiteSpace: 'pre-wrap',
            fontSize: 14,
            lineHeight: 1.6,
            overflowX: 'auto',
          }}
        >
          {AGENT_PROMPT_ZH}
        </pre>
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button className="btn btn-primary" type="button" onClick={() => copy('提示词', AGENT_PROMPT_ZH)}>
          复制提示词
        </button>
        <button className="btn" type="button" onClick={() => copy('MCP 配置', MCP_CONFIG_JSON)}>
          复制 MCP 配置
        </button>
        <a className="btn" href={askTxtUrl} target="_blank" rel="noreferrer">
          读取 ask.txt（给 AI 的完整规则）
        </a>
      </div>

      {copied ? (
        <p className="body-2" style={{ margin: 0, fontSize: 14 }}>
          {copied}
        </p>
      ) : (
        <p className="body-2" style={{ margin: 0, fontSize: 14, opacity: 0.8 }}>
          AI 会自己去读 <span className="mono">/ask.txt</span>；领取名字那一步仍然需要你本人签名，AI 只能准备。
        </p>
      )}
    </div>
  );
}

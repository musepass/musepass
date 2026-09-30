'use client';

import { useState } from 'react';
import { AGENT_PROMPT, MCP_CONFIG_JSON } from '@/lib/agentPrompt';

/**
 * The copy-paste block, in the shape MuseFly uses: the text is visible and
 * selectable even if the clipboard API is unavailable, and the feedback says
 * what happened rather than leaving the reader guessing. Two buttons, because
 * the two audiences differ: a person pastes the prompt into their AI, a client
 * needs the MCP config JSON.
 */
export function CopyPrompt({
  askTxtUrl,
  prompt = AGENT_PROMPT,
  heading = 'Paste this into your AI',
}: {
  askTxtUrl: string;
  /** Which prompt to offer; the agent test prompt lives on the developer page. */
  prompt?: string;
  heading?: string;
}) {
  const [copied, setCopied] = useState<string | null>(null);

  const copy = async (label: string, text: string) => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('no clipboard');
      await navigator.clipboard.writeText(text);
      setCopied(`${label} copied — paste it into your AI.`);
    } catch {
      setCopied('Copying failed: select the text above and copy it by hand.');
    }
  };

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div>
        <div className="record-sample-label" style={{ marginBottom: 8 }}>
          {heading}
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
          {prompt}
        </pre>
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button className="btn btn-primary" type="button" onClick={() => copy('Prompt', prompt)}>
          Copy the prompt
        </button>
        <button className="btn" type="button" onClick={() => copy('MCP config', MCP_CONFIG_JSON)}>
          Copy the MCP config
        </button>
        <a className="btn" href={askTxtUrl} target="_blank" rel="noreferrer">
          Read ask.txt (the full rules for the AI)
        </a>
      </div>

      {copied ? (
        <p className="body-2" style={{ margin: 0, fontSize: 14 }}>
          {copied}
        </p>
      ) : (
        <p className="body-2" style={{ margin: 0, fontSize: 14, opacity: 0.8 }}>
          The AI reads <span className="mono">/ask.txt</span> by itself. Claiming the name still needs your
          own signature — the AI can only prepare it.
        </p>
      )}
    </div>
  );
}

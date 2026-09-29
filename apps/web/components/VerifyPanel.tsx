'use client';

import { useState } from 'react';

import { runVerification, type VerifiedCase } from '@/lib/verifyCase';
import { VERIFY_EXAMPLES } from '@/lib/verifyExamples';

const EXAMPLES = [
  { key: 'valid-satisfied', label: '一个站得住的履历', hint: '草案向量 valid-satisfied' },
  { key: 'o2-met-without-evidence', label: '一个被推翻的履历', hint: '草案向量 o2-met-without-evidence' },
] as const;

/**
 * The verifier, in the reader's browser. It never calls us: the documents the
 * user pastes are the only input, and the verdict is computed locally.
 */
export function VerifyPanel() {
  const [text, setText] = useState('');
  const [verified, setVerified] = useState<VerifiedCase | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(input: string) {
    setBusy(true);
    setError(null);
    setVerified(null);
    const outcome = await runVerification(input);
    if (outcome.ok) setVerified(outcome);
    else setError(outcome.error);
    setBusy(false);
  }

  return (
    <div className="panel" style={{ display: 'grid', gap: 16 }}>
      <div>
        <h1 className="h2">自己验证一条履历</h1>
        <p className="body-2">
          粘贴一条履历的 JSON：链上那条记录（chain），加上公开发布的三份文档（criteria / bundle /
          attestation）。验证<strong>在你的浏览器里算</strong>，不经过我们的服务器，也不需要联网。
          这很重要，因为「别人替你算结论」和「你自己算出来」不是一回事。
        </p>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {EXAMPLES.map((example) => (
          <button
            key={example.key}
            type="button"
            className="btn btn-sm"
            onClick={() => {
              const value = JSON.stringify(VERIFY_EXAMPLES[example.key], null, 2);
              setText(value);
              void run(value);
            }}
          >
            载入{example.label}
          </button>
        ))}
      </div>

      <label className="field">
        <span className="body-2">履历 JSON</span>
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={14}
          spellCheck={false}
          className="mono"
          placeholder='{"chain":{…},"criteria":{…},"bundle":{…},"attestation":{…}}'
          style={{ width: '100%', fontSize: 12 }}
        />
      </label>

      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" className="btn btn-primary" disabled={busy || text.trim() === ''} onClick={() => void run(text)}>
          {busy ? '计算中…' : '验证'}
        </button>
        <button type="button" className="btn" onClick={() => setText('')} disabled={text === ''}>
          清空
        </button>
      </div>

      {error ? <div className="notice notice-error">{error}</div> : null}

      {verified ? (
        <div className={verified.result.valid ? 'notice notice-ok' : 'notice notice-error'}>
          <strong>{verified.result.valid ? '这条履历站得住。' : '这条履历被推翻了。'}</strong>
          {verified.result.violations.length > 0 ? (
            <ul>
              {verified.result.violations.map((violation, index) => (
                <li key={index} className="mono" style={{ fontSize: 12 }}>
                  {violation.rule}: {violation.detail}
                </li>
              ))}
            </ul>
          ) : null}
          {verified.result.unchecked.length > 0 ? (
            <p className="body-2">
              有 {verified.result.unchecked.length} 条这个验证器判定不了（不算错，也不算对）：
              {verified.result.unchecked.join('；')}
            </p>
          ) : null}
        </div>
      ) : null}

      <details>
        <summary className="body-2">这里到底在验什么？</summary>
        <p className="body-2">
          按 ERC-8412 草案逐条对账：标准是否在证据之前登记、每条 MET 的义务有没有证据覆盖、
          豁免是不是由豁免权签的、结论能不能由判定规则推出来、公开文档的摘要和链上登记的是不是同一份。
          实现和向量都钉在草案的某个 commit 上（见 <span className="mono">docs/reference/</span>），
          因为草案还在 review，编码可能变。
        </p>
      </details>
    </div>
  );
}

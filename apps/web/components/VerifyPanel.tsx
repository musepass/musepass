'use client';

import { useState } from 'react';

import { runVerification, type VerifiedCase } from '@/lib/verifyCase';
import { VERIFY_EXAMPLES } from '@/lib/verifyExamples';

const EXAMPLES = [
  { key: 'valid-satisfied', label: 'a record that stands up', hint: 'draft vector valid-satisfied' },
  { key: 'o2-met-without-evidence', label: 'a refuted record', hint: 'draft vector o2-met-without-evidence' },
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
        <h1 className="h2">Verify a record yourself</h1>
        <p className="body-2">
          Paste the JSON for one record: what the chain says (chain) plus the three published documents
          (criteria / bundle / attestation). The verdict is <strong>computed in your browser</strong>, with
          no request to our server and no network needed. That matters, because “someone else ran the
          numbers for you” and “you ran them yourself” are not the same thing.
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
            Load {example.label}
          </button>
        ))}
      </div>

      <label className="field">
        <span className="body-2">Record JSON</span>
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
          {busy ? 'Computing…' : 'Verify'}
        </button>
        <button type="button" className="btn" onClick={() => setText('')} disabled={text === ''}>
          Clear
        </button>
      </div>

      {error ? <div className="notice notice-error">{error}</div> : null}

      {verified ? (
        <div className={verified.result.valid ? 'notice notice-ok' : 'notice notice-error'}>
          <strong>{verified.result.valid ? 'This record stands up.' : 'This record is refuted.'}</strong>
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
              {verified.result.unchecked.length} thing(s) this verifier cannot decide — that is neither a
              pass nor a failure: {verified.result.unchecked.join('; ')}
            </p>
          ) : null}
        </div>
      ) : null}

      <details>
        <summary className="body-2">What is actually being checked here?</summary>
        <p className="body-2">
          It works through the ERC-8412 draft rule by rule: whether the criteria were registered before the
          evidence, whether every MET obligation actually has covering evidence, whether waivers carry the
          waiver authority's signature, whether the verdict follows from the decision rule, and whether the
          published documents hash to what the chain recorded. The implementation and its test vectors are
          pinned to one commit of the draft (see <span className="mono">docs/reference/</span>), because the
          draft is still under review and the encoding can change.
        </p>
      </details>
    </div>
  );
}

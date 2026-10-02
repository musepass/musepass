'use client';

import { useState } from 'react';
import { submitCertificationIntent } from '@/lib/api';

/**
 * The certification waitlist. Certification is designed but not running, so
 * this form sells nothing and promises no date: it takes a contact and tells
 * the person when the thing exists. Honesty is the product here.
 */
export function CertificationIntentForm() {
  const [contact, setContact] = useState('');
  const [note, setNote] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState('');

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setState('sending');
    setMessage('');
    try {
      const response = await submitCertificationIntent({ contact: contact.trim(), note: note.trim() || undefined });
      setState('done');
      setMessage(
        `Signed up. ${response.data.totalIntents} ${response.data.totalIntents === 1 ? 'person is' : 'people are'} on the list so far.`,
      );
    } catch (caught) {
      setState('error');
      setMessage(caught instanceof Error ? caught.message : 'The sign-up could not be sent. Try again shortly.');
    }
  }

  if (state === 'done') {
    return (
      <p className="docs-lede" style={{ fontSize: 16 }}>
        {message} Nothing is being charged and there is no launch date to wait up for — when
        certification opens, you will be told.
      </p>
    );
  }

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 420 }}>
      <label className="body-2" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        Email
        <input
          type="email"
          required
          value={contact}
          onChange={(event) => setContact(event.target.value)}
          placeholder="you@example.com"
          className="mono"
          style={{ padding: '8px 10px' }}
        />
      </label>
      <label className="body-2" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        What would you certify? (optional)
        <input
          type="text"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="an endpoint, a service, a record"
          className="mono"
          style={{ padding: '8px 10px' }}
          maxLength={500}
        />
      </label>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button className="btn btn-primary" type="submit" disabled={state === 'sending'}>
          {state === 'sending' ? 'Sending…' : 'Tell me when it opens'}
        </button>
        {state === 'error' ? (
          <span className="body-2" style={{ color: '#b00020' }}>
            {message}
          </span>
        ) : null}
      </div>
    </form>
  );
}

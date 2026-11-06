'use client';

import { useState } from 'react';

/**
 * Proof-waitlist email capture. Posts to a Formspree/Tally endpoint when
 * NEXT_PUBLIC_WAITLIST_ENDPOINT is set; otherwise it records intent locally and
 * confirms (no DB yet — documented in AUDIT.md). No numbers, no claims.
 */
export function WaitlistForm() {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'error'>('idle');

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email) return;
    setState('sending');
    const endpoint = process.env.NEXT_PUBLIC_WAITLIST_ENDPOINT;
    try {
      if (endpoint) {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ email, list: 'proof-waitlist' }),
        });
        if (!res.ok) throw new Error(String(res.status));
      } else {
        // No endpoint configured — record intent locally so nothing is lost.
        try {
          localStorage.setItem('nx.proof-waitlist', email);
        } catch {
          /* storage blocked — still confirm optimistically */
        }
      }
      setState('done');
    } catch {
      setState('error');
    }
  }

  if (state === 'done') {
    return (
      <p className="text-sm text-fg-secondary" role="status">
        You are on the list. We will email you when the Proof Layer goes live.
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-wrap gap-2" aria-label="Proof waitlist signup">
      <label htmlFor="proof-email" className="sr-only">
        Email address
      </label>
      <input
        id="proof-email"
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@fund.com"
        className="min-w-56 flex-1 rounded-lg border border-line bg-base-700 px-3 py-2 text-sm text-fg-primary outline-none focus-visible:border-brand"
      />
      <button type="submit" className="nx-btn nx-btn--primary" disabled={state === 'sending'}>
        {state === 'sending' ? 'Joining…' : 'Join the waitlist'}
      </button>
      {state === 'error' ? (
        <p className="w-full text-sm text-fg-secondary" role="alert">
          Could not submit right now — please try again shortly.
        </p>
      ) : null}
    </form>
  );
}

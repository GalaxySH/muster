/**
 * The test-recipient guard for outbound email. Outside production, `sendEmail`
 * only delivers to addresses on the EMAIL_TEST_RECIPIENTS allowlist: local dev
 * can hold a live Resend key and a copy of the real roster, so without this a
 * test click could email a real student or the team list. Pure so the rule is
 * unit tested; `resend.ts` decides when it applies.
 */

/** Parse the EMAIL_TEST_RECIPIENTS value into a lowercase set. */
export function parseTestRecipients(raw: string): Set<string> {
  return new Set(
    raw
      .split(/[\s,]+/)
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

export interface GuardedRecipients {
  /** The main recipient, or null when the message must not be sent at all. */
  to: string | null;
  cc: string[];
  /** Every address the guard removed, for the log line. */
  dropped: string[];
}

/**
 * Filter a message's recipients through the allowlist. `allow` null means no
 * guard (production). A main recipient that isn't allowed blocks the whole
 * message rather than promoting a cc, so a test never reaches anyone it wasn't
 * addressed to.
 */
export function guardRecipients(
  { to, cc }: { to: string; cc: string[] },
  allow: Set<string> | null,
): GuardedRecipients {
  if (!allow) return { to, cc, dropped: [] };
  const ok = (e: string) => allow.has(e.trim().toLowerCase());
  if (!ok(to)) return { to: null, cc: [], dropped: [to, ...cc] };
  return { to, cc: cc.filter(ok), dropped: cc.filter((e) => !ok(e)) };
}

import type { Metadata } from "next";
import { redeemAndSignIn } from "@/lib/auth/magic-link-actions";
import { StudentPage } from "@/components/student/StudentPage";
import { ButtonLink, Card, Notice } from "@/components/student/ui";
import { FormSubmitButton } from "@/components/student/FormControls";

export const metadata: Metadata = { title: "Sign-in link" };

/**
 * Magic-link redemption: the "Confirm it's you" step (PLAN §11). Visiting the
 * link (GET) does NOT consume the token; the user re-enters their email and
 * submits, which hands token+email to the `magic-link` provider for atomic
 * single-use redemption. The re-entry also defeats mail-scanner link previews.
 * An optional `email` param prefills the field (only the admin-minted
 * test-account links carry it; emailed links never do). Prefill is cosmetic:
 * redemption still requires the token to be bound to that exact email.
 */
export default async function RedeemPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string; email?: string }>;
}) {
  const { token, error, email } = await searchParams;

  if (!token) {
    return (
      <StudentPage width="narrow" home="none">
        <Card>
          <h1>Sign-in link</h1>
          <p>This sign-in link is missing or invalid.</p>
          <ButtonLink href="/signin" block>
            Request a new link
          </ButtonLink>
        </Card>
      </StudentPage>
    );
  }

  return (
    <StudentPage width="narrow" home="none">
      {error && (
        <Notice tone="danger" role="alert">
          <p>That link is invalid, expired, or already used.</p>
        </Notice>
      )}
      <Card>
        <h1>Confirm it&apos;s you</h1>
        <form action={redeemAndSignIn} className="sf-stack">
          <input type="hidden" name="token" defaultValue={token} />
          <div className="sf-field">
            <label htmlFor="redeem-email" className="sf-label">
              Your wisc.edu email
            </label>
            <input
              id="redeem-email"
              type="email"
              name="email"
              placeholder="you@wisc.edu"
              defaultValue={email ?? ""}
              autoComplete="email"
              required
              className="sf-input"
              aria-describedby="redeem-email-hint"
            />
            <p id="redeem-email-hint" className="sf-hint">
              Re-enter the <strong>@wisc.edu</strong> email this link was sent to, to finish
              signing in.
            </p>
          </div>
          <FormSubmitButton block pendingLabel="Signing you in…">
            Sign in
          </FormSubmitButton>
        </form>
      </Card>
      {error && (
        <ButtonLink href="/signin" variant="secondary" block>
          Request a new link
        </ButtonLink>
      )}
    </StudentPage>
  );
}

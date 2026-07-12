import Link from "next/link";
import { redeemAndSignIn } from "@/lib/auth/magic-link-actions";
import { Page } from "@/components/ui";

/**
 * Magic-link redemption: the "Confirm it's you" step (PLAN §11). Visiting the
 * link (GET) does NOT consume the token; the user re-enters their email and
 * submits, which hands token+email to the `magic-link` provider for atomic
 * single-use redemption. The re-entry also defeats mail-scanner link previews.
 */
export default async function RedeemPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const { token, error } = await searchParams;

  if (!token) {
    return (
      <Page width="narrow">
        <h1>Sign-in link</h1>
        <p>This sign-in link is missing or invalid.</p>
        <p>
          <Link href="/signin">Request a new link</Link>
        </p>
      </Page>
    );
  }

  return (
    <Page width="narrow">
      <h1>Confirm it&apos;s you</h1>
      {error && (
        <p style={{ color: "var(--color-text-danger, #b00)" }}>
          That link is invalid, expired, or already used.
        </p>
      )}
      <p style={{ color: "#555" }}>
        Re-enter the <strong>@wisc.edu</strong> email this link was sent to, to finish signing in.
      </p>
      <form action={redeemAndSignIn} style={{ display: "grid", gap: 8, maxWidth: 360 }}>
        <input type="hidden" name="token" defaultValue={token} />
        <input
          type="email"
          name="email"
          placeholder="you@wisc.edu"
          required
          style={{ padding: 8, borderRadius: 6, border: "1px solid #ccc", fontSize: 14 }}
        />
        <button type="submit">Sign in</button>
      </form>
      {error && (
        <p style={{ marginTop: 14, fontSize: 13 }}>
          <Link href="/signin">Request a new link</Link>
        </p>
      )}
    </Page>
  );
}

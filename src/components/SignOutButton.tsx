import { signOutAction } from "@/lib/auth/actions";
import { SubmitButton, SubmitTextLink } from "@/components/SubmitButton";

export function SignOutButton() {
  return (
    <form action={signOutAction}>
      <SubmitButton variant="secondary" pendingLabel="Signing out…">
        Sign out
      </SubmitButton>
    </form>
  );
}

/** Sign out as a text link, for sitting beside the signed-in email in a header. */
export function SignOutLink() {
  return (
    <form action={signOutAction} style={{ display: "inline" }}>
      <SubmitTextLink pendingLabel="Signing out…">Sign out</SubmitTextLink>
    </form>
  );
}

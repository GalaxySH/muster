import { signOutAction } from "@/lib/auth/actions";
import { SubmitTextLink } from "@/components/SubmitButton";

/** Sign out as a text link, for sitting beside the signed-in email in a header. */
export function SignOutLink() {
  return (
    <form action={signOutAction} className="inline-form">
      <SubmitTextLink pendingLabel="Signing out…">Sign out</SubmitTextLink>
    </form>
  );
}

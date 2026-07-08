import { signOutAction } from "@/lib/auth/actions";
import { SubmitButton } from "@/components/SubmitButton";

export function SignOutButton() {
  return (
    <form action={signOutAction}>
      <SubmitButton variant="secondary" pendingLabel="Signing out…">
        Sign out
      </SubmitButton>
    </form>
  );
}

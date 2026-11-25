import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { devLoginEnabled } from "@/lib/env";
import { devSignInAction } from "@/lib/auth/actions";
import { StudentPage } from "@/components/student/StudentPage";
import { Card, Notice } from "@/components/student/ui";
import { FormSubmitButton } from "@/components/student/FormControls";

export const metadata: Metadata = { title: "Dev login" };

// Env-gated redirect; never statically prerender.
export const dynamic = "force-dynamic";

/**
 * DEV ONLY sign-in bypass (no OAuth). The route redirects to /signin unless the
 * env-gated bypass is active; it can never render in prod. Throwaway test
 * accounts are managed on /admin/test-users (sign in as an admin first).
 */
export default function DevLoginPage() {
  if (!devLoginEnabled) redirect("/signin");

  return (
    <StudentPage width="narrow" home="none">
      <h1>Dev login</h1>
      <Notice tone="warning" role="note" title="Local testing only.">
        <p>
          This bypasses Google OAuth and is disabled in production. Enter any{" "}
          <code>@wisc.edu</code> email to sign in as that identity.
        </p>
      </Notice>
      <Card>
        <form action={devSignInAction} className="sf-stack">
          <div className="sf-field">
            <label htmlFor="dev-email" className="sf-label">
              Email
            </label>
            <input
              id="dev-email"
              type="email"
              name="email"
              defaultValue="stu@wisc.edu"
              required
              className="sf-input"
            />
          </div>
          <FormSubmitButton block pendingLabel="Signing you in…">
            Sign in
          </FormSubmitButton>
        </form>
      </Card>
      <p className="sf-muted sf-small">
        Test accounts are managed at <code>/admin/test-users</code> (sign in as an admin first).
      </p>
    </StudentPage>
  );
}

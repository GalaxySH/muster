import Link from "next/link";
import { redirect } from "next/navigation";
import { getAppSession } from "@/lib/auth/session";
import { AppHeader, Crumb } from "@/components/AppHeader";
import { Page } from "@/components/ui";
import { listTestAccounts } from "@/lib/test-accounts/data";
import {
  createTestAccount,
  deleteTestAccount,
  signInAsTestAccount,
  type TestAccountError,
} from "@/lib/test-accounts/actions";
import { TEST_ACCOUNT_DOMAIN } from "@/lib/test-accounts/email";
import { POSITIONS } from "@/lib/config/positions";

// DB-backed (the test-account list) — never statically prerender.
export const dynamic = "force-dynamic";

const ERROR_COPY: Record<TestAccountError, string> = {
  forbidden: "Admins only.",
  "invalid-name": "Enter a display name with at least one letter or digit.",
  "invalid-position": "Pick a valid position.",
  exists: "An account with that name already exists — pick a different name.",
  "not-found": "That test account no longer exists (or isn't a test account).",
  signin: "Sign-in as the test account failed — try again.",
};

/**
 * Admin manager for throwaway test accounts (the production successor of the
 * /dev-login manager): create a student in any position, sign in as it to walk
 * the whole student flow (e.g. to train admins), then delete it. Accounts are
 * off-roster, in an always-open group, on a synthetic non-deliverable email
 * domain — invisible in responses/exports and reachable only from this page.
 */
export default async function AdminTestUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await getAppSession();
  if (!session) redirect("/signin?callbackUrl=/admin/test-users");
  if (!session.isAdmin) redirect("/me");

  const { error } = await searchParams;
  const errorMessage = error ? (ERROR_COPY[error as TestAccountError] ?? "Something went wrong.") : null;
  const accounts = await listTestAccounts();

  return (
    <Page>
      <AppHeader>
        <Crumb href="/admin" label="Admin" />
      </AppHeader>
      <h1>Test accounts</h1>
      <p style={{ color: "#555" }}>
        Create throwaway accounts to walkthrough the app. Fill out the details, sign in as the student, and navigate through the flow. Test accounts are not on the roster and are in an always-open group, so they never appear in the response list or other tracking.
      </p>
      <p style={banner}>
        <strong>Sign in as replaces your admin session.</strong> To return, sign out and sign
        back in with Google. Test-account emails end in <code>@{TEST_ACCOUNT_DOMAIN}</code>{" "}
        and can only be signed into from this page.
      </p>

      {errorMessage && <p style={errorBanner}>{errorMessage}</p>}

      <section style={card}>
        <h2 style={{ fontSize: 16, marginTop: 0 }}>Create a test account</h2>
        <form action={createTestAccount} style={{ display: "grid", gap: 8, maxWidth: 420 }}>
          <input type="text" name="name" placeholder="Display name, e.g. Training Barista" required style={field} />
          <p style={{ margin: 0, fontSize: 13, color: "#777" }}>
            The sign-in email is derived from the name, e.g.{" "}
            <code>training-barista@{TEST_ACCOUNT_DOMAIN}</code>.
          </p>
          <select name="position" defaultValue={POSITIONS[0]?.id} style={field}>
            {POSITIONS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <label style={{ fontSize: 14 }}>
            <input type="checkbox" name="international" /> International student
          </label>
          <button type="submit" style={{ justifySelf: "start" }}>
            Create test account
          </button>
        </form>
      </section>

      {accounts.length > 0 && (
        <ul style={{ listStyle: "none", padding: 0, margin: "1.2rem 0 0", display: "grid", gap: 8 }}>
          {accounts.map((a) => (
            <li key={a.email} style={row}>
              <div style={{ fontSize: 14 }}>
                <strong>{a.displayName}</strong>{" "}
                <span style={{ color: "#777" }}>
                  {a.email}
                  {a.positionName ? ` · ${a.positionName}` : ""}
                  {a.status ? ` · ${a.status}` : ""}
                </span>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <Link href={`/admin/students/${encodeURIComponent(a.email)}`} style={{ fontSize: 14 }}>
                  View response
                </Link>
                {a.canSignInAs && (
                  <form action={signInAsTestAccount}>
                    <input type="hidden" name="email" value={a.email} />
                    <button type="submit">Sign in as</button>
                  </form>
                )}
                <form action={deleteTestAccount}>
                  <input type="hidden" name="email" value={a.email} />
                  <button type="submit" style={{ color: "#b00" }}>
                    Delete
                  </button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Page>
  );
}

const banner: React.CSSProperties = {
  background: "#fff4d6",
  border: "1px solid #e0c060",
  borderRadius: 6,
  padding: "0.6rem 0.9rem",
  fontSize: 14,
};
const errorBanner: React.CSSProperties = {
  background: "#fdecea",
  border: "1px solid #d9756b",
  borderRadius: 6,
  padding: "0.6rem 0.9rem",
  fontSize: 14,
};
const card: React.CSSProperties = {
  border: "1px solid #e2e2e2",
  borderRadius: 8,
  padding: "1rem 1.2rem",
  marginTop: "1.2rem",
};
const field: React.CSSProperties = { padding: 8, borderRadius: 6, border: "1px solid #ccc", fontSize: 14 };
const row: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
  border: "1px solid #e2e2e2",
  borderRadius: 6,
  padding: "0.5rem 0.7rem",
};

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
import { POSITIONS } from "@/lib/config/positions";

// DB-backed (the test-account list); never statically prerender.
export const dynamic = "force-dynamic";

/** Today's calendar date in campus time (America/Chicago) as yyyy-mm-dd, for the hire-date default. */
function todayIsoChicago(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date());
}

const ERROR_COPY: Record<TestAccountError, string> = {
  forbidden: "Admins only.",
  "invalid-name": "Enter a display name with at least one letter or digit.",
  "invalid-position": "Pick a valid position.",
  exists: "An account with that name already exists. Pick a different name.",
  "not-found": "That test account no longer exists (or isn't a test account).",
  signin: "Sign-in as the test account failed. Try again.",
};

/**
 * Admin manager for throwaway test accounts (the production successor of the
 * /dev-login manager): create a student in any position, sign in as it to walk
 * the whole student flow (e.g. to train admins), then delete it. Accounts are
 * off-roster, in a dedicated "Test accounts" group (initially wide open;
 * window editable on /admin/groups), on a synthetic non-deliverable email
 * domain, invisible in responses/exports and reachable only from this page.
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
        Create throwaway accounts to walk through the app. Fill out the details, sign in as
        the student, and preview the form as they would see it. The accounts are not tracked and are in the <strong>Test accounts</strong> group. Edit the group&apos;s form window on{" "}<Link href="/admin/groups">Groups &amp; form windows</Link>.
      </p>
      <p style={banner}>
        <strong>Sign in as replaces your admin session.</strong> To return, sign out and sign
        back in with Google.
      </p>

      {errorMessage && <p style={errorBanner}>{errorMessage}</p>}

      <section style={card}>
        <h2 style={{ fontSize: 16, marginTop: 0 }}>Create a test account</h2>
        <form action={createTestAccount} style={{ display: "grid", gap: 8, maxWidth: 420 }}>
          <input type="text" name="name" placeholder="Display name, e.g. Training Barista" required style={field} />
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
          <label style={{ fontSize: 14, display: "grid", gap: 4 }}>
            Hire date
            <input type="date" name="hiredOn" defaultValue={todayIsoChicago()} style={field} />
          </label>
          <button type="submit" style={{ justifySelf: "start" }}>
            Create test account
          </button>
        </form>
      </section>

      {accounts.length > 0 && (
        <div style={{ overflowX: "auto", marginTop: "1.2rem" }}>
          <table style={{ width: "100%", minWidth: 560, borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--color-text-secondary)", fontSize: 13 }}>
                <th style={th}>Account</th>
                <th style={th}>Position</th>
                <th style={th}>Status</th>
                <th style={{ ...th, textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => (
                <tr key={a.email} style={{ borderTop: "0.5px solid var(--color-border-tertiary)" }}>
                  <td style={td}>
                    <div style={{ fontWeight: 500 }}>{a.displayName}</div>
                    <div
                      style={{
                        fontSize: 12,
                        color: "var(--color-text-tertiary)",
                        overflowWrap: "anywhere",
                      }}
                    >
                      {a.email}
                    </div>
                  </td>
                  <td style={td}>{a.positionName ?? "—"}</td>
                  <td style={td}>
                    {a.status ? (
                      <span style={a.status === "submitted" ? submittedBadge : draftBadge}>
                        {a.status}
                      </span>
                    ) : (
                      <span style={{ color: "var(--color-text-tertiary)" }}>—</span>
                    )}
                  </td>
                  <td style={{ ...td, whiteSpace: "nowrap" }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "flex-end" }}>
                      <Link href={`/admin/students/${encodeURIComponent(a.email)}`}>
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
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
const th: React.CSSProperties = { padding: "6px 10px", whiteSpace: "nowrap" };
const td: React.CSSProperties = { padding: "8px 10px", verticalAlign: "top" };
const badge: React.CSSProperties = { borderRadius: 10, padding: "1px 8px", fontSize: 12 };
const submittedBadge: React.CSSProperties = { ...badge, background: "#e6f4ea", color: "var(--color-text-success)" };
const draftBadge: React.CSSProperties = { ...badge, background: "var(--color-background-secondary)", color: "var(--color-text-secondary)" };

import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getAppSession } from "@/lib/auth/session";
import { AdminPage } from "@/components/admin/AdminPage";
import { Button, CheckRow, EmptyMark, Field, Notice, Panel, Pill } from "@/components/admin/ui";
import { listTestAccounts } from "@/lib/test-accounts/data";
import {
  createTestAccount,
  deleteTestAccount,
  signInAsTestAccount,
  mintTestAccountLink,
  type TestAccountError,
} from "@/lib/test-accounts/actions";
import { isTestAccountEmail } from "@/lib/test-accounts/email";
import { positionOptions } from "@/lib/positions/data";
import { workingTermId } from "@/lib/terms/working";
import { MagicLinkCopy } from "@/components/admin/MagicLinkCopy";
import { env } from "@/lib/env";

export const metadata: Metadata = { title: "Test accounts" };

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
  searchParams: Promise<{ error?: string; token?: string; for?: string }>;
}) {
  const session = await getAppSession();
  if (!session) redirect("/signin?callbackUrl=/admin/test-users");
  if (!session.isAdmin) redirect("/me");

  const { error, token, for: linkFor } = await searchParams;
  const errorMessage = error
    ? (ERROR_COPY[error as TestAccountError] ?? "Something went wrong.")
    : null;
  // The URL is assembled HERE from our own base + redeem path (the params carry
  // only token + email), so a crafted query can never plant a foreign link.
  const magicLinkUrl =
    token && linkFor && isTestAccountEmail(linkFor)
      ? `${env.NEXTAUTH_URL}/magic/redeem?token=${encodeURIComponent(token)}&email=${encodeURIComponent(linkFor)}`
      : null;
  const [accounts, positions] = await Promise.all([
    listTestAccounts(),
    positionOptions(await workingTermId()),
  ]);

  return (
    <AdminPage
      title="Test accounts"
      width="form"
      description={
        <>
          Create throwaway accounts to walk through the app. Fill out the details, sign in as the
          student, and preview the form as they would see it. The accounts are not tracked and are
          in the <strong>Test accounts</strong> group. Edit the group&apos;s form window on{" "}
          <Link href="/admin/groups">Groups and windows</Link>.
        </>
      }
    >
      <div className="ad-stack">
        <Notice tone="warning" title="Sign in as replaces your admin session.">
          To return, sign out and sign back in with Google. To stay signed in here, use{" "}
          <strong>Get link</strong> and open the link in a private or incognito window instead.
        </Notice>

        {errorMessage && (
          <Notice tone="danger" role="alert">
            {errorMessage}
          </Notice>
        )}

        {magicLinkUrl && (
          <Panel title={<>Sign-in link for {linkFor}</>}>
            <p className="ad-muted">
              Open this link in a private or incognito window to use the test account while staying
              signed in here as admin. It works once and expires in 1 day.
            </p>
            <MagicLinkCopy url={magicLinkUrl} />
          </Panel>
        )}

        <Panel title="Create a test account">
          <form action={createTestAccount} className="ad-se-create">
            <Field label="Display name">
              <input type="text" name="name" placeholder="e.g. Training Barista" required />
            </Field>
            <Field label="Position">
              <select name="position" defaultValue={positions[0]?.id}>
                {positions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
            <CheckRow label="International student">
              <input type="checkbox" name="international" />
            </CheckRow>
            <Field label="Hire date">
              <input type="date" name="hiredOn" defaultValue={todayIsoChicago()} />
            </Field>
            <Button type="submit" variant="primary" size="md">
              Create test account
            </Button>
          </form>
        </Panel>

        {accounts.length > 0 && (
          <Panel flush title="Accounts" aside={accounts.length}>
            <table className="ad-table ad-table--stack ad-table--middle">
              <thead>
                <tr>
                  <th scope="col">Account</th>
                  <th scope="col">Position</th>
                  <th scope="col">Status</th>
                  <th scope="col" className="ad-num">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((a) => (
                  <tr key={a.email}>
                    <td data-label="Account">
                      <div className="ad-strong">{a.displayName}</div>
                      <div className="ad-email">{a.email}</div>
                    </td>
                    <td data-label="Position">{a.positionName ?? <EmptyMark />}</td>
                    <td data-label="Status">
                      {a.status ? (
                        <Pill tone={a.status === "submitted" ? "success" : undefined}>
                          {a.status}
                        </Pill>
                      ) : (
                        <EmptyMark />
                      )}
                    </td>
                    <td>
                      <div className="ad-row ad-se-row-actions">
                        <Link
                          href={`/admin/students/${encodeURIComponent(a.email)}`}
                          aria-label={`View response for ${a.displayName}`}
                        >
                          View response
                        </Link>
                        {a.canManage && (
                          <>
                            <form action={signInAsTestAccount}>
                              <input type="hidden" name="email" value={a.email} />
                              <Button type="submit" aria-label={`Sign in as ${a.displayName}`}>
                                Sign in as
                              </Button>
                            </form>
                            <form action={mintTestAccountLink}>
                              <input type="hidden" name="email" value={a.email} />
                              <Button type="submit" aria-label={`Get link for ${a.displayName}`}>
                                Get link
                              </Button>
                            </form>
                            <form action={deleteTestAccount}>
                              <input type="hidden" name="email" value={a.email} />
                              <Button
                                type="submit"
                                variant="danger"
                                aria-label={`Delete ${a.displayName}`}
                              >
                                Delete
                              </Button>
                            </form>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        )}
      </div>
    </AdminPage>
  );
}

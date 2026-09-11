import { redirect } from "next/navigation";
import Link from "next/link";
import { getAppSession } from "@/lib/auth/session";
import { loadFlowState } from "@/lib/flow/data";
import { confirmRosterInfo } from "@/lib/flow/actions";
import { SignOutButton } from "@/components/SignOutButton";
import { AppHeader } from "@/components/AppHeader";
import { InfoCard, Page, PrimaryLink } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { FormWindowBanner, NoGroupNotice, ReadOnlyNotice } from "@/components/FormWindowBanner";
import { contactLabel } from "@/lib/env";
import { REQUIRED_CLOSE_CLAIMS } from "@/lib/domain/close-claims";
import { getChangeRequestsEnabled } from "@/lib/settings";

export default async function MePage() {
  const session = await getAppSession();
  if (!session) redirect("/signin?callbackUrl=/me");

  const [flow, changeRequestsEnabled] = await Promise.all([
    loadFlowState(session.email),
    getChangeRequestsEnabled(),
  ]);
  // Admins are staff, so they have no roster row and no form to fill out. Give them the
  // dashboard rather than the off-roster notice meant for students.
  const adminHome = !flow.onRoster && session.isAdmin;

  return (
    <Page>
      <AppHeader isHome />
      <p style={{ color: "#555" }}>
        {session.name ? `${session.name} · ` : ""}
        {session.email}
      </p>

      {adminHome ? (
        <InfoCard title="You're signed in as an admin">
          <PrimaryLink href="/admin">Open the admin dashboard</PrimaryLink>
        </InfoCard>
      ) : !flow.onRoster ? (
        <InfoCard title="We don't recognize this account">
          <p style={{ margin: 0 }}>
            You&apos;re signed in but are not a known employee. If this is a mistake, contact{" "}
            <strong>{contactLabel}</strong>.
          </p>
        </InfoCard>
      ) : flow.access.kind === "no-group" ? (
        <NoGroupNotice />
      ) : (
        <div>
          <FormWindowBanner
            state={flow.access.state}
            opensAt={flow.access.opensAt}
            closesAt={flow.access.closesAt}
          />

          {(flow.status.kind === "done" || flow.status.kind === "continue") && flow.closes.required && flow.closes.count < REQUIRED_CLOSE_CLAIMS && (
            <InfoCard tone="danger" title="Weekend closes still needed">
              <p style={{ marginTop: 0 }}>
                Shift Leads are required to work {REQUIRED_CLOSE_CLAIMS} weekend closes this semester.
                You have picked {flow.closes.count}. Spots are first come first served.
              </p>
              {flow.access.canEdit &&
                (flow.status.kind === "done" ||
                (flow.status.kind === "continue" &&
                  (flow.status.href === "/travel" || flow.status.href === "/closes")) ? (
                  <PrimaryLink href="/closes">Pick your closes</PrimaryLink>
                ) : (
                  <p style={{ margin: 0, fontSize: 14 }}>
                    Finish the earlier form steps first.
                  </p>
                ))}
            </InfoCard>
          )}

          {flow.status.kind === "done" ? (
            <section>
              <p style={{ color: "#196127" }}>
                ✓ You&apos;ve submitted your preferences
                {flow.access.canEdit
                  ? ""
                  : flow.access.kind === "windowed" && flow.access.lockedAfterSubmit
                    ? ", they're now locked. Contact the scheduler directly to make changes going forward."
                    : "."}
              </p>
              <p style={{ marginBottom: 6 }}>
                {flow.access.canEdit ? "Review or update your responses:" : "Review your responses:"}
              </p>
              <ul style={reviewList}>
                <li>
                  <Link href="/intro">Introduction</Link>
                </li>
                <li>
                  <Link href="/course-schedule">Course schedule &amp; activities</Link>
                </li>
                <li>
                  <Link href="/availability">Availability</Link>
                </li>
                <li>
                  <Link href="/travel">Travel excusals</Link>
                </li>
                {flow.closes.required && (
                  <li>
                    <Link href="/closes">Weekend closes</Link>
                  </li>
                )}
              </ul>
            </section>
          ) : !flow.access.canEdit ? (
            <ReadOnlyNotice state={flow.access.state} />
          ) : flow.status.kind === "not-started" ? (
            <InfoCard title="First, confirm your info">
              <p style={{ marginTop: 0 }}>Here&apos;s what we have:</p>
              <ul style={{ margin: "0 0 10px", paddingLeft: "1.2rem", display: "grid", gap: 4 }}>
                <li>Name: <strong>{flow.displayName}</strong></li>
                <li>Position: <strong>{flow.positionName ?? "not set yet"}</strong></li>
                <li>{flow.international ? "International" : "Domestic"} student</li>
              </ul>
              <form action={confirmRosterInfo}>
                <SubmitButton pendingLabel="One moment…" style={{ marginBottom: 10 }}>
                  Yes, that&apos;s me
                </SubmitButton>
              </form>
              <p style={{ fontSize: 13, color: "#666", marginBottom: 0 }}>
                Something look wrong? Email <strong>{contactLabel}</strong> before continuing.
              </p>
            </InfoCard>
          ) : (
            <InfoCard title="Pick up where you left off">
              <p style={{ marginTop: 0 }}>
                You&apos;ve started but haven&apos;t submitted yet. Next up: {flow.status.stepLabel}.
              </p>
              <PrimaryLink href={flow.status.href}>Continue</PrimaryLink>
            </InfoCard>
          )}
        </div>
      )}

      {flow.onRoster && (
        <InfoCard title="Schedule changes" style={{ marginTop: 20 }}>
          <p style={{ margin: 0 }}>
            {changeRequestsEnabled ? (
              <>
                Need a change to your work schedule during the semester?{" "}
                <Link href="/change-requests">Send a change request</Link>.
              </>
            ) : (
              <>Need a change to your work schedule during the semester? Send us an email.</>
            )}
          </p>
        </InfoCard>
      )}

      {!adminHome && (
        <p style={{ marginTop: 20 }}>
          For any questions, contact <strong>{contactLabel}</strong> or come into the office.
        </p>
      )}

      {flow.onRoster && session.isAdmin && (
        <InfoCard title="Admin access" style={{ marginTop: 20 }}>
          <p style={{ margin: 0 }}>
            You have admin access. <Link href="/admin">Open the admin dashboard</Link>.
          </p>
        </InfoCard>
      )}
      <SignOutButton />
    </Page>
  );
}

const reviewList: React.CSSProperties = {
  margin: 0,
  paddingLeft: "1.2rem",
  display: "grid",
  gap: 6,
};

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faChevronRight } from "@awesome.me/kit-925f6dce39/icons/classic/solid";
import { getAppSession } from "@/lib/auth/session";
import { signOutAction } from "@/lib/auth/actions";
import { loadFlowState } from "@/lib/flow/data";
import { confirmRosterInfo } from "@/lib/flow/actions";
import { AdminHomeRedirect } from "@/components/AdminHomeRedirect";
import { StudentPage } from "@/components/student/StudentPage";
import { ButtonLink, Card, Notice, Pill } from "@/components/student/ui";
import { FormSubmitButton } from "@/components/student/FormControls";
import { FormWindowBanner, NoGroupNotice, ReadOnlyNotice } from "@/components/FormWindowBanner";
import { contactLabel } from "@/lib/env";
import { getChangeRequestsEnabled } from "@/lib/settings";
import { currentTermId } from "@/lib/terms/working";
import { getTerm } from "@/lib/terms/term-id";
import { getDb } from "@/lib/db";
import { systemMessageTone } from "@/lib/domain/terms";
import { APP_TIME_ZONE } from "@/lib/domain/time";
import { formatCutoffDate } from "@/lib/domain/travel";

export const metadata: Metadata = { title: "Home" };

/** "Fri, Dec 19", in the app's own time zone so the server's doesn't decide the day. */
function dueLabel(closesAt: Date): string {
  return closesAt.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: APP_TIME_ZONE,
  });
}

export default async function MePage() {
  const session = await getAppSession();
  if (!session) redirect("/signin?callbackUrl=/me");

  const termId = await currentTermId();
  const [flow, changeRequestsEnabled, term] = await Promise.all([
    loadFlowState(session.email, termId),
    getChangeRequestsEnabled(),
    getTerm(getDb(), termId),
  ]);
  // Admins are staff, so they have no roster row and no form to fill out. Give them the
  // dashboard rather than the off-roster notice meant for students, and take them there
  // after a moment, since it is the only place this page leads.
  const adminHome = !flow.onRoster && session.isAdmin;

  const reviewSteps = [
    { href: "/intro", label: "Introduction" },
    { href: "/course-schedule", label: "Course schedule and activities" },
    { href: "/availability", label: "Availability" },
    { href: "/travel", label: "Travel excusals" },
    ...(flow.onRoster && flow.closes.required
      ? [{ href: "/closes", label: "Weekend closes" }]
      : []),
  ];
  // The roster may list a name as "Last, First".
  const fullName = flow.onRoster ? flow.displayName : (session.name ?? "");
  const firstName = (fullName.includes(",") ? fullName.split(",")[1]! : fullName)
    .trim()
    .split(/\s+/)[0];

  return (
    <StudentPage home="none">
      <h1>{firstName ? `Hi, ${firstName}` : "Welcome"}</h1>
      <p className="sf-muted sf-small">Signed in as {session.email}</p>

      {flow.onRoster && term.systemMessage && (
        <Notice tone={systemMessageTone(term.systemMessageTone)} role="note">
          <p className="sf-prewrap">{term.systemMessage}</p>
        </Notice>
      )}

      {adminHome ? (
        <Card>
          <h2>You&apos;re signed in as an admin</h2>
          <AdminHomeRedirect href="/admin" />
        </Card>
      ) : !flow.onRoster ? (
        <Notice tone="warning" title="We don't recognize this account">
          <p>
            You&apos;re signed in but are not a known employee. If this is a mistake, contact{" "}
            <strong>{contactLabel}</strong>.
          </p>
        </Notice>
      ) : flow.access.kind === "no-group" ? (
        <NoGroupNotice />
      ) : (
        <>
          <FormWindowBanner
            state={flow.access.state}
            opensAt={flow.access.opensAt}
            closesAt={flow.access.closesAt}
          />

          {flow.access.travelOpenUntil && (
            <Notice tone="info" title="Travel is still open">
              <p>
                You can still add travel before {formatCutoffDate(flow.access.travelOpenUntil)}.
              </p>
              <p>
                <ButtonLink href="/travel" small>
                  Add travel
                </ButtonLink>
              </p>
            </Notice>
          )}

          {(flow.status.kind === "done" || flow.status.kind === "continue") &&
            flow.closes.required &&
            flow.closes.count < flow.closes.needed && (
              <Notice tone="danger" title="Weekend closes still needed">
                <p>
                  You are required to work {flow.closes.needed} weekend{" "}
                  {flow.closes.needed === 1 ? "close" : "closes"} this semester. You have picked{" "}
                  {flow.closes.count}. Spots are first come first served.
                </p>
                {flow.access.canEdit &&
                  (flow.status.kind === "done" ||
                  (flow.status.kind === "continue" &&
                    (flow.status.href === "/travel" || flow.status.href === "/closes")) ? (
                    <p>
                      <ButtonLink href="/closes" small>
                        Pick your closes
                      </ButtonLink>
                    </p>
                  ) : (
                    <p className="sf-small">Finish the earlier form steps first.</p>
                  ))}
              </Notice>
            )}

          {flow.status.kind === "done" ? (
            <>
              <Card>
                <div className="sf-card-head">
                  <h2>Your availability form</h2>
                  <Pill tone="success">Submitted</Pill>
                </div>
                <p>
                  {flow.access.canEdit
                    ? "You've submitted your preferences. You can still review or update them."
                    : flow.access.lockedAfterSubmit
                      ? "You've submitted your preferences and they're now locked. Contact the scheduler directly to make changes going forward."
                      : "You've submitted your preferences."}
                </p>
              </Card>
              <h2>
                {flow.access.canEdit ? "Review or update your responses" : "Review your responses"}
              </h2>
              <ul className="sf-rows">
                {reviewSteps.map((s) => (
                  <li key={s.href}>
                    <Link href={s.href} className="sf-row">
                      <span className="sf-row-main">{s.label}</span>
                      <FontAwesomeIcon
                        icon={faChevronRight}
                        className="sf-row-chevron"
                        aria-hidden
                      />
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          ) : !flow.access.canEdit ? (
            // The travel notice above already says what they can still change.
            flow.access.travelOpenUntil ? null : (
              <ReadOnlyNotice state={flow.access.state} />
            )
          ) : flow.status.kind === "not-started" ? (
            <Card>
              <div className="sf-card-head">
                <h2>First, confirm your info</h2>
                {flow.access.closesAt && <Pill>Due {dueLabel(flow.access.closesAt)}</Pill>}
              </div>
              <dl className="sf-dl">
                <dt>Name</dt>
                <dd>{flow.displayName}</dd>
                <dt>Position</dt>
                <dd>{flow.positionName ?? "Not set yet"}</dd>
                <dt>Student type</dt>
                <dd>{flow.international ? "International" : "Domestic"}</dd>
              </dl>
              <form action={confirmRosterInfo}>
                <FormSubmitButton block pendingLabel="One moment…">
                  Yes, that&apos;s me
                </FormSubmitButton>
              </form>
              <p className="sf-small sf-muted sf-gap-top">
                Something look wrong? Email <strong>{contactLabel}</strong> before continuing.
              </p>
            </Card>
          ) : (
            <Card>
              <div className="sf-card-head">
                <h2>Pick up where you left off</h2>
                {flow.access.closesAt ? (
                  <Pill tone="warning">Due {dueLabel(flow.access.closesAt)}</Pill>
                ) : (
                  <Pill tone="warning">Not submitted</Pill>
                )}
              </div>
              <p>
                You&apos;ve started but haven&apos;t submitted yet. Next up: {flow.status.stepLabel}
                .
              </p>
              <ButtonLink href={flow.status.href} block>
                Continue
              </ButtonLink>
            </Card>
          )}
        </>
      )}

      {flow.onRoster && (
        <Card>
          <h2>Schedule changes</h2>
          <p>
            {changeRequestsEnabled ? (
              <>
                Need a change to your work schedule during the semester?{" "}
                <Link href="/change-requests">Send a change request</Link>.
              </>
            ) : (
              <>Need a change to your work schedule during the semester? Send us an email.</>
            )}
          </p>
        </Card>
      )}

      {flow.onRoster && session.isAdmin && (
        <Card>
          <h2>Admin access</h2>
          <p>
            You have admin access. <Link href="/admin">Open the admin dashboard</Link>.
          </p>
        </Card>
      )}

      {!adminHome && (
        <p className="sf-muted">
          For any questions, contact <strong>{contactLabel}</strong> or come into the office.
        </p>
      )}

      <form action={signOutAction}>
        <FormSubmitButton variant="secondary" pendingLabel="Signing out…">
          Sign out
        </FormSubmitButton>
      </form>
    </StudentPage>
  );
}

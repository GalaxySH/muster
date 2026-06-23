import { redirect } from "next/navigation";
import Link from "next/link";
import { getAppSession } from "@/lib/auth/session";
import { loadFlowState } from "@/lib/flow/data";
import { confirmRosterInfo } from "@/lib/flow/actions";
import { SignOutButton } from "@/components/SignOutButton";
import { AppHeader } from "@/components/AppHeader";
import { PrimaryLink } from "@/components/ui";
import { FormWindowBanner, NoGroupNotice } from "@/components/FormWindowBanner";
import { CONTACT_EMAIL } from "@/components/evidence/shared";

export default async function MePage() {
  const session = await getAppSession();
  if (!session) redirect("/signin?callbackUrl=/me");

  const flow = await loadFlowState(session.email);

  return (
    <main style={{ padding: "2rem", maxWidth: 640 }}>
      <AppHeader isHome />
      <h1>Profile</h1>
      <p style={{ color: "#555" }}>
        {session.name ? `${session.name} · ` : ""}
        {session.email}
      </p>

      {!flow.onRoster ? (
        <p>
          You&apos;re signed in but are not a known employee. If this is a mistake, contact <strong>{CONTACT_EMAIL}</strong>.
        </p>
      ) : flow.access.kind === "no-group" ? (
        <NoGroupNotice />
      ) : (
        <div>
          <FormWindowBanner
            state={flow.access.state}
            opensAt={flow.access.opensAt}
            closesAt={flow.access.closesAt}
          />

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
              </ul>
            </section>
          ) : !flow.access.canEdit ? (
            <p style={{ color: "#555" }}>
              Your access window isn&apos;t open for editing right now. Check back during the window
              shown above.
            </p>
          ) : flow.status.kind === "not-started" ? (
            <section style={highlightBox}>
              <h2 style={{ fontSize: 16, marginTop: 0 }}>First, confirm your info</h2>
              <p style={{ marginTop: 0 }}>Here&apos;s what we have:</p>
              <ul style={{ margin: "0 0 10px", paddingLeft: "1.2rem", display: "grid", gap: 4 }}>
                <li>Name: <strong>{flow.displayName}</strong></li>
                <li>Position: <strong>{flow.positionName ?? "not set yet"}</strong></li>
                {flow.international && <li>International student</li>}
              </ul>
              <form action={confirmRosterInfo}>
                <button type="submit" style={primaryButton}>
                  Yes, that&apos;s me
                </button>
              </form>
              <p style={{ fontSize: 13, color: "#666", marginBottom: 0 }}>
                Something look wrong? Email <strong>{CONTACT_EMAIL}</strong> before continuing.
              </p>
            </section>
          ) : (
            <section style={highlightBox}>
              <h2 style={{ fontSize: 16, marginTop: 0 }}>Pick up where you left off</h2>
              <p style={{ marginTop: 0 }}>
                You&apos;ve started but haven&apos;t submitted yet. Next up: {flow.status.stepLabel}.
              </p>
              <PrimaryLink href={flow.status.href}>Continue</PrimaryLink>
            </section>
          )}
        </div>
      )}

      <p style={{ marginTop: 20 }}>
        For any questions, contact <strong>{CONTACT_EMAIL}</strong> or come into the office.
      </p>

      {session.isAdmin && (
        <p style={{ marginTop: 20 }}>
          You have admin access. <Link href="/admin">Admin dashboard</Link>
        </p>
      )}
      <SignOutButton />
    </main>
  );
}

const reviewList: React.CSSProperties = {
  margin: 0,
  paddingLeft: "1.2rem",
  display: "grid",
  gap: 6,
};
const highlightBox: React.CSSProperties = {
  background: "#e7f0fb",
  border: "1px solid #b6d2f2",
  borderRadius: 8,
  padding: "1rem 1.2rem",
  margin: "0.5rem 0 1rem",
};
const primaryButton: React.CSSProperties = {
  background: "#1a66cc",
  color: "#fff",
  border: "none",
  borderRadius: 6,
  padding: "0.55rem 1.1rem",
  fontSize: 15,
  cursor: "pointer",
  marginBottom: 10,
};

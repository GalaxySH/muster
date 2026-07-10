import { redirect } from "next/navigation";
import Link from "next/link";
import { getAppSession } from "@/lib/auth/session";
import { findStudentByEmail } from "@/lib/roster/lookup";
import { resolveStudentAccess } from "@/lib/groups/data";
import { loadWizardNav } from "@/lib/flow/data";
import { hasCloseInventory, loadCloseBoard } from "@/lib/closes/data";
import { REQUIRED_CLOSE_CLAIMS, SHIFT_LEAD_POSITION_ID } from "@/lib/domain/close-claims";
import { CloseClaimBoard } from "@/components/closes/CloseClaimBoard";
import { FormWindowBanner, NoGroupNotice, SubmittedLockBanner } from "@/components/FormWindowBanner";
import { AppHeader } from "@/components/AppHeader";
import { WizardSteps } from "@/components/WizardSteps";
import { Page } from "@/components/ui";

/**
 * SL-only wizard step (PLAN §18a): claim weekend close shifts from the dated
 * inventory. Non-Shift-Leads (and everyone, until an admin generates slots)
 * are bounced to /me; the claim actions enforce the same server-side.
 */
export default async function ClosesPage() {
  const session = await getAppSession();
  if (!session) redirect("/signin?callbackUrl=/closes");

  const student = await findStudentByEmail(session.email);
  if (!student) redirect("/me");
  if (student.positionId !== SHIFT_LEAD_POSITION_ID || !(await hasCloseInventory()))
    redirect("/me");

  const [access, nav, board] = await Promise.all([
    resolveStudentAccess(student.email),
    loadWizardNav(student.email),
    loadCloseBoard(student.email),
  ]);

  if (access.access === "no-group") {
    return (
      <Page>
        <h1>Weekend closes</h1>
        <NoGroupNotice />
        <Link href="/me">Back</Link>
      </Page>
    );
  }

  return (
    <Page>
      <AppHeader>
        <WizardSteps steps={nav.steps} current="closes" reachable={nav.reachable} />
      </AppHeader>
      {access.lockedAfterSubmit ? (
        <SubmittedLockBanner />
      ) : (
        <FormWindowBanner state={access.state} opensAt={access.opensAt} closesAt={access.closesAt} />
      )}
      <h1>Weekend closes</h1>
      <p style={{ color: "#555" }}>
        Every Shift Lead is required to work {REQUIRED_CLOSE_CLAIMS} weekend close shifts this semester.
        Pick your shifts below. Each shift has a limited number of spots, and they are first come first served.
      </p>
      <CloseClaimBoard initial={board} editable={access.canEdit} submitted={access.submitted} />
    </Page>
  );
}

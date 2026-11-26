/**
 * What an admin gets at the top of every page: the semester they are working in
 * (and the control to select another), the student finder, and a banner
 * whenever that semester is not the one students are filling in
 * (docs/semester-domains-plan.md §2.9). The admin console's shell renders it in
 * its top bar, and the student pages render it for an admin who is filling a
 * form in for someone. Renders nothing for anyone else. Server-rendered: the
 * roster is read only once the session is known to be an admin's, so it never
 * reaches a student's page.
 */
import { getAppSession } from "@/lib/auth/session";
import { listRosterNames } from "@/lib/roster/lookup";
import { SignOutLink } from "./SignOutButton";
import { StudentQuickSearch } from "./StudentQuickSearch";
import { SelectTermButton, TermSwitcher } from "./TermSwitcher";
import { currentTermId, listTerms, workingTermId } from "@/lib/terms/working";

export async function AdminTools({
  account = false,
}: {
  /** Also show who is signed in, with the way to sign out. */
  account?: boolean;
}) {
  const session = await getAppSession();
  if (!session?.isAdmin) return null;
  const [students, terms, workingId, currentId] = await Promise.all([
    listRosterNames(),
    listTerms(),
    workingTermId(),
    currentTermId(),
  ]);
  const nameOf = (id: string) => terms.find((t) => t.id === id)?.name;

  return (
    <div className="admin-tools">
      {workingId !== currentId && (
        <div role="status" className="term-banner">
          <span>
            You are working in <strong>{nameOf(workingId)}</strong>. Students are filling in{" "}
            {nameOf(currentId)}.
          </span>
          <SelectTermButton termId={currentId} label={`Back to ${nameOf(currentId)}`} />
        </div>
      )}
      <StudentQuickSearch students={students} />
      <TermSwitcher terms={terms} workingId={workingId} />
      {account && (
        <span className="admin-tools-account">
          <span className="admin-tools-email">{session.email}</span>
          <SignOutLink />
        </span>
      )}
    </div>
  );
}

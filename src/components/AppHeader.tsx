/**
 * The shared top-of-page header. A Home element is always present (the user's
 * requirement); optional `children` render as additional breadcrumb crumbs after
 * it: the wizard step breadcrumb on the form flow, or an "Admin" crumb on admin
 * pages. For an admin, the semester they are working in (and the control to
 * select another) and the student finder sit on the right, and a banner runs
 * across the top whenever that semester is not the one students are filling in
 * (docs/semester-domains-plan.md §2.9). Server-rendered: the roster is read only once the
 * session is known to be an admin's, so it never reaches a student's page.
 */
import Link from "next/link";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faHouse } from "@awesome.me/kit-925f6dce39/icons/sharp-duotone/solid";
import { getAppSession } from "@/lib/auth/session";
import { listRosterNames } from "@/lib/roster/lookup";
import { StudentQuickSearch } from "./StudentQuickSearch";
import { SelectTermButton, TermSwitcher } from "./TermSwitcher";
import { currentTermId, listTerms, workingTermId } from "@/lib/terms/working";

export async function AppHeader({
  homeHref = "/me",
  isHome = false,
  children,
}: {
  /** Where Home points (app home is /me). */
  homeHref?: string;
  /** On the home page itself, render Home as a plain label rather than a self-link. */
  isHome?: boolean;
  /** Extra breadcrumb crumbs rendered after Home. */
  children?: React.ReactNode;
}) {
  const session = await getAppSession();
  const admin = session?.isAdmin
    ? await Promise.all([listRosterNames(), listTerms(), workingTermId(), currentTermId()])
    : null;
  const [students, terms, workingId, currentId] = admin ?? [null, [], "", ""];
  const nameOf = (id: string) => terms.find((t) => t.id === id)?.name;

  const home = (
    <span style={{ fontWeight: 500 }}>
      <FontAwesomeIcon icon={faHouse} /> Home
    </span>
  );
  return (
    <header className="app-header">
      {workingId !== currentId && (
        <div role="status" className="term-banner">
          <span>
            You are working in <strong>{nameOf(workingId)}</strong>. Students are filling in{" "}
            {nameOf(currentId)}.
          </span>
          <SelectTermButton termId={currentId} label={`Back to ${nameOf(currentId)}`} />
        </div>
      )}
      <nav
        aria-label="Breadcrumb"
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 8,
          fontSize: 14,
        }}
      >
        {isHome ? (
          <span aria-current="page" style={{ color: "#444", fontWeight: 500 }}>
            <FontAwesomeIcon icon={faHouse} /> Home
          </span>
        ) : (
          <Link href={homeHref} style={{ color: "#1a66cc", textDecoration: "none" }}>
            {home}
          </Link>
        )}
        {children}
      </nav>
      {students && (
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginLeft: "auto", minWidth: 0 }}>
          <TermSwitcher terms={terms} workingId={workingId} />
          <StudentQuickSearch students={students} />
        </div>
      )}
    </header>
  );
}

/** A single breadcrumb crumb (with its leading separator) for use inside AppHeader. */
export function Crumb({ href, label }: { href: string; label: string }) {
  return (
    <>
      <span aria-hidden style={{ color: "#ccc" }}>
        ·
      </span>
      <Link href={href} style={{ color: "#1a66cc", textDecoration: "none" }}>
        {label}
      </Link>
    </>
  );
}

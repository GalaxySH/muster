/**
 * The shared top-of-page header. A Home element is always present (the user's
 * requirement); optional `children` render as additional breadcrumb crumbs after
 * it: the wizard step breadcrumb on the form flow, or an "Admin" crumb on admin
 * pages. For an admin, the current semester's name and the student finder sit
 * on the right, so they always know which term they are working in and can
 * look anyone up from any page. Server-rendered: the roster is read only once the
 * session is known to be an admin's, so it never reaches a student's page.
 */
import Link from "next/link";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faHouse } from "@awesome.me/kit-925f6dce39/icons/sharp-duotone/solid";
import { getAppSession } from "@/lib/auth/session";
import { listRosterNames } from "@/lib/roster/lookup";
import { StudentQuickSearch } from "./StudentQuickSearch";
import { currentTerm } from "@/lib/terms/current";

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
  const [students, term] = session?.isAdmin
    ? await Promise.all([listRosterNames(), currentTerm()])
    : [null, null];

  const home = (
    <span style={{ fontWeight: 500 }}>
      <FontAwesomeIcon icon={faHouse} /> Home
    </span>
  );
  return (
    <header className="app-header">
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
          <span style={{ fontSize: 13, color: "var(--color-text-secondary)", whiteSpace: "nowrap" }}>
            {term.name}
          </span>
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

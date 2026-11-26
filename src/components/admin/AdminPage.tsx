import Link from "next/link";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faChevronLeft } from "@awesome.me/kit-925f6dce39/icons/classic/solid";
import { AdminTools } from "@/components/AdminTools";
import { getAppSession } from "@/lib/auth/session";
import { getAdminPrefsCached } from "@/lib/admin/preferences";
import type { AdminTheme } from "@/lib/admin/preferences-shape";
import { AdminNav, type NavCount } from "./AdminNav";
import { ThemeToggle } from "./ThemeToggle";

/** The signed-in admin's theme, or null to follow the device. A read that fails never breaks the page. */
async function ownTheme(): Promise<AdminTheme | null> {
  try {
    const session = await getAppSession();
    if (!session?.isAdmin) return null;
    return (await getAdminPrefsCached(session.email)).theme;
  } catch {
    return null;
  }
}

/**
 * The shell every admin page renders in: the section rail, the top bar (student
 * finder, semester, who is signed in) and the `.ad` scope the console's design
 * system (app/admin.css) hangs off.
 *
 *   - `full`: tables, the overview, a student's page, the schedule
 *   - `form`: settings and other pages that are mostly fields
 *
 * `title` renders the page's one `<h1>`; a page that draws its own (a student's
 * page, whose heading is the student) leaves it out. `back` is the list a page
 * was opened from. `actions` sit on the title row, right-aligned. `rail="icons"`
 * starts the rail folded to its icons, for a page that needs the width.
 *
 * Each page still does its own sign-in and admin check before rendering this.
 *
 * The admin's saved theme is rendered as `data-theme` on the root, so the page
 * arrives in it with no flash; without one, admin.css follows the device.
 */
export async function AdminPage({
  title,
  description,
  back,
  actions,
  width = "full",
  navCounts,
  rail = "full",
  children,
}: {
  title?: React.ReactNode;
  /** One short line under the title. */
  description?: React.ReactNode;
  back?: { href: string; label: string };
  actions?: React.ReactNode;
  width?: "full" | "form";
  /** Counts for the rail. Only the overview loads them. */
  navCounts?: Record<string, NavCount>;
  rail?: "full" | "icons";
  children: React.ReactNode;
}) {
  const theme = await ownTheme();
  return (
    <div className="ad" data-theme={theme ?? undefined}>
      <a href="#main" className="ad-skip">
        Skip to content
      </a>
      <AdminNav counts={navCounts} icons={rail === "icons"} />
      <div className="ad-body">
        <header className="ad-topbar">
          <AdminTools account />
          <ThemeToggle theme={theme} />
        </header>
        <main
          id="main"
          className={width === "form" ? "ad-main ad-main--form" : "ad-main"}
          tabIndex={-1}
        >
          {back && (
            <Link href={back.href} className="ad-back">
              <FontAwesomeIcon icon={faChevronLeft} aria-hidden /> {back.label}
            </Link>
          )}
          {(title != null || actions) && (
            <div className="ad-pagehead">
              <div className="ad-pagehead-text">
                {title != null && <h1 className="ad-title">{title}</h1>}
                {description && <p className="ad-description">{description}</p>}
              </div>
              {actions && <div className="ad-pagehead-actions">{actions}</div>}
            </div>
          )}
          {children}
        </main>
      </div>
    </div>
  );
}

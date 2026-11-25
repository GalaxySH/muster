import Link from "next/link";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faHouse } from "@awesome.me/kit-925f6dce39/icons/classic/solid";
import { getAppSession } from "@/lib/auth/session";
import { AppHeader } from "@/components/AppHeader";
import type { WizardNav } from "@/lib/flow/data";
import type { WizardStepKey } from "@/lib/flow/steps";
import { StepProgress } from "./StepProgress";

/**
 * The shell every student page renders in: the top bar, the form-step progress
 * on the pages that belong to the flow, and the `.sf` scope the student design
 * system (app/student.css) hangs off.
 *
 *   - `narrow`: sign-in and other single-card pages
 *   - `default`: reading and the form steps
 *   - `wide`: the availability grid, which puts two grids side by side
 *
 * An admin also gets the console's own header row (semester switcher, student
 * finder, the other-semester banner), since they reach these pages when they
 * fill a form in for a student.
 */
export async function StudentPage({
  width = "default",
  home = "link",
  nav,
  current,
  progressLabel,
  stepsDone,
  children,
}: {
  width?: "narrow" | "default" | "wide";
  /** "link" shows Home in the top bar; "none" leaves it off (the hub itself, and signed-out pages). */
  home?: "link" | "none";
  /** The student's steps, from `loadWizardNav`. Pass it on pages that are part of the form flow. */
  nav?: WizardNav;
  current?: WizardStepKey;
  /** Names the page in the progress bar when it is not one of the numbered steps. */
  progressLabel?: string;
  /** The page comes after every step (the final review), so they all show as done. */
  stepsDone?: boolean;
  children: React.ReactNode;
}) {
  const session = await getAppSession();
  return (
    <div className={`sf sf--${width}`}>
      <a href="#main" className="sf-skip">
        Skip to content
      </a>
      <header className="sf-topbar">
        <div className="sf-topbar-inner">
          <Link href={session ? "/me" : "/"} className="sf-brand">
            <span>Muster</span>
          </Link>
          {home === "link" && (
            <Link href="/me" className="sf-topbar-link">
              <FontAwesomeIcon icon={faHouse} aria-hidden /> Home
            </Link>
          )}
        </div>
      </header>
      {nav && (
        <StepProgress
          steps={nav.steps}
          reachable={nav.reachable}
          current={current}
          label={progressLabel}
          allDone={stepsDone}
        />
      )}
      {session?.isAdmin && (
        <div className="sf-admin-tools">
          <AppHeader />
        </div>
      )}
      <main id="main" className="sf-main" tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}

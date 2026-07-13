/**
 * Pure wizard-flow logic (PLAN §4, §18a, §18b). The student onboarding flow is
 * a linear progression:
 *
 *   intro → course-schedule → availability → travel [→ closes] → exit
 *
 * `intro` (orientation) and `exit` (final submit) bookend the data steps. The
 * `closes` step (SL weekend-close picking, §18a) exists only for Shift Leads
 * once an admin has generated a close inventory; everyone else gets the three
 * base steps. This module is pure (no I/O) so it can be unit-tested and shared
 * by the server data loader and the page components. The "where do I resume?"
 * decision is inferred from persisted data; there is no progress column.
 */
import { closeClaimsComplete } from "@/lib/domain/close-claims";

/** The base data-entry steps, in order (intro/exit are not counted here). */
export const WIZARD_STEPS = [
  { key: "course-schedule", href: "/course-schedule", label: "Course schedule" },
  { key: "availability", href: "/availability", label: "Availability" },
  { key: "travel", href: "/travel", label: "Travel" },
] as const;

/** SL-only close-picking step (PLAN §18a), appended after travel. */
export const CLOSES_STEP = { key: "closes", href: "/closes", label: "Weekend closes" } as const;

export type WizardStepKey = (typeof WIZARD_STEPS)[number]["key"] | (typeof CLOSES_STEP)["key"];

export interface WizardStep {
  key: WizardStepKey;
  href: string;
  label: string;
}

/** The data steps this student walks; `includeCloses` = SL + inventory exists. */
export function wizardSteps(includeCloses: boolean): WizardStep[] {
  return includeCloses ? [...WIZARD_STEPS, CLOSES_STEP] : [...WIZARD_STEPS];
}

/** The href of the step after `key` in `steps`, or "/exit" after the last. */
export function nextHref(key: WizardStepKey, steps: WizardStep[]): string {
  const i = steps.findIndex((s) => s.key === key);
  const next = steps[i + 1];
  return next ? next.href : "/exit";
}

export interface FlowInputs {
  /** submissions.status === "submitted": the student finished the wizard. */
  submitted: boolean;
  /**
   * The student confirmed their roster info on /me (submissions.confirmed_at).
   * A submission row alone doesn't mean they started: an admin can create one on
   * their behalf, and the student still owes the confirmation.
   */
  hasConfirmed: boolean;
  /** A course schedule has been uploaded. */
  hasCourseSchedule: boolean;
  /** The saved availability passes hard rules AND has desired hours (could "continue"). */
  availabilityComplete: boolean;
  /** The closes step applies: Shift Lead + a generated close inventory (§18a). */
  closesRequired: boolean;
  /** Close claims held; only meaningful when closesRequired. */
  closeClaimCount: number;
}

export type FlowStatus =
  | { kind: "done" }
  | { kind: "not-started" }
  | { kind: "continue"; href: string; stepLabel: string };

/**
 * Decide what the student sees on /me:
 *  - done         → finished (status submitted); show review links.
 *  - not-started  → hasn't confirmed their roster info; show the confirm box.
 *  - continue     → partway through; deep-link to the first incomplete step.
 *
 * An admin may have started the submission (draft row, course schedule uploaded)
 * before the student's first sign-in, so "started" means confirmed, never "a row
 * exists".
 */
export function flowStatus(i: FlowInputs): FlowStatus {
  if (i.submitted) return { kind: "done" };
  if (!i.hasConfirmed) return { kind: "not-started" };
  // Confirmed their info but haven't uploaded anything yet; resume at the intro,
  // which is where confirming sent them, not mid-flow.
  if (!i.hasCourseSchedule)
    return { kind: "continue", href: "/intro", stepLabel: "the introduction" };
  if (!i.availabilityComplete)
    return { kind: "continue", href: "/availability", stepLabel: "your availability" };
  // A shift lead who started picking closes but hasn't finished clearly passed
  // travel already; send them back to the board. With no picks yet, travel is
  // still the next unvisited step (travel completion itself is un-inferable).
  if (i.closesRequired && i.closeClaimCount > 0 && !closeClaimsComplete(i.closeClaimCount))
    return { kind: "continue", href: CLOSES_STEP.href, stepLabel: "your weekend closes" };
  return { kind: "continue", href: "/travel", stepLabel: "travel & finishing up" };
}

/**
 * Which wizard steps the student may navigate to (PLAN §4). Mirrors the per-step
 * "Next" gates so the breadcrumb can't jump ahead of the data: availability needs
 * a course schedule; travel (and closes, for SLs) needs that plus a complete
 * availability. Once submitted, everything is open for review. Used to disable
 * locked breadcrumb crumbs the same way a locked "Next" button is hidden.
 */
export function reachableStepKeys(
  i: Pick<
    FlowInputs,
    "submitted" | "hasCourseSchedule" | "availabilityComplete" | "closesRequired"
  >,
): WizardStepKey[] {
  if (i.submitted) return wizardSteps(i.closesRequired).map((s) => s.key);
  const keys: WizardStepKey[] = ["course-schedule"];
  if (i.hasCourseSchedule) keys.push("availability");
  if (i.hasCourseSchedule && i.availabilityComplete) {
    keys.push("travel");
    if (i.closesRequired) keys.push("closes");
  }
  return keys;
}

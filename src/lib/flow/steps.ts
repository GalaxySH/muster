/**
 * Pure wizard-flow logic (PLAN §4, §18b). The student onboarding flow is a linear
 * progression:
 *
 *   intro → course-schedule → availability → travel → exit
 *
 * `intro` (orientation) and `exit` (final submit) bookend three "data" steps.
 * This module is pure (no I/O) so it can be unit-tested and shared by the server
 * data loader and the page components. The "where do I resume?" decision is
 * inferred from persisted data; there is no separate progress column.
 */

/** The three data-entry steps, in order (intro/exit are not counted here). */
export const WIZARD_STEPS = [
  { key: "course-schedule", href: "/course-schedule", label: "Course schedule" },
  { key: "availability", href: "/availability", label: "Availability" },
  { key: "travel", href: "/travel", label: "Travel" },
] as const;

export type WizardStepKey = (typeof WIZARD_STEPS)[number]["key"];

/** 1-based position of a step (for "Step N of 3" copy). */
export function stepNumber(key: WizardStepKey): number {
  return WIZARD_STEPS.findIndex((s) => s.key === key) + 1;
}

/** The href of the step before `key`, or "/intro" before the first data step. */
export function prevHref(key: WizardStepKey): string {
  const i = WIZARD_STEPS.findIndex((s) => s.key === key);
  const prev = WIZARD_STEPS[i - 1];
  return prev ? prev.href : "/intro";
}

/** The href of the step after `key`, or "/exit" after the last data step. */
export function nextHref(key: WizardStepKey): string {
  const i = WIZARD_STEPS.findIndex((s) => s.key === key);
  const next = WIZARD_STEPS[i + 1];
  return next ? next.href : "/exit";
}

export interface FlowInputs {
  /** submissions.status === "submitted": the student finished the wizard. */
  submitted: boolean;
  /** A submission row exists at all (they've started, e.g. confirmed the intro). */
  hasSubmissionRow: boolean;
  /** A course schedule has been uploaded. */
  hasCourseSchedule: boolean;
  /** The saved availability passes hard rules AND has desired hours (could "continue"). */
  availabilityComplete: boolean;
}

export type FlowStatus =
  | { kind: "done" }
  | { kind: "not-started" }
  | { kind: "continue"; href: string; stepLabel: string };

/**
 * Decide what the student sees on /me:
 *  - done         → finished (status submitted); show review links.
 *  - not-started  → no submission row and nothing uploaded; show the confirm box.
 *  - continue     → partway through; deep-link to the first incomplete step.
 */
export function flowStatus(i: FlowInputs): FlowStatus {
  if (i.submitted) return { kind: "done" };
  if (!i.hasSubmissionRow && !i.hasCourseSchedule) return { kind: "not-started" };
  // Confirmed their info (a draft row exists) but haven't uploaded anything yet;
  // resume at the intro, which is where confirming sent them, not mid-flow.
  if (!i.hasCourseSchedule)
    return { kind: "continue", href: "/intro", stepLabel: "the introduction" };
  if (!i.availabilityComplete)
    return { kind: "continue", href: "/availability", stepLabel: "your availability" };
  return { kind: "continue", href: "/travel", stepLabel: "travel & finishing up" };
}

/**
 * Which wizard steps the student may navigate to (PLAN §4). Mirrors the per-step
 * "Next" gates so the breadcrumb can't jump ahead of the data: availability needs
 * a course schedule, travel needs that plus a complete availability. Once
 * submitted, everything is open for review. Used to disable locked breadcrumb
 * crumbs the same way a locked "Next" button is hidden.
 */
export function reachableStepKeys(
  i: Pick<FlowInputs, "submitted" | "hasCourseSchedule" | "availabilityComplete">,
): WizardStepKey[] {
  if (i.submitted) return WIZARD_STEPS.map((s) => s.key);
  const keys: WizardStepKey[] = ["course-schedule"];
  if (i.hasCourseSchedule) keys.push("availability");
  if (i.hasCourseSchedule && i.availabilityComplete) keys.push("travel");
  return keys;
}

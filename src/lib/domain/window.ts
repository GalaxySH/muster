/**
 * Form-window state machine (PLAN.md §13).
 *
 * A student's group carries an open/close window. This pure helper turns the
 * window's dates + the current time into an editability state, shared by the
 * server (authority) and the UI (banner/read-only). No I/O, no DB — the window
 * dates and group membership are resolved elsewhere; this is just the math.
 *
 * Membership ("does the student have a group at all?") is a separate gate
 * handled server-side; this module only answers "given a window, can they edit
 * right now?". An unset window (either bound null) is `unconfigured` and locks
 * the form — the secure default, so a freshly-seeded group isn't open by
 * accident (PLAN §13).
 */

export type WindowState = "before" | "open" | "closed" | "unconfigured";

/**
 * Editability of a window at `now`. The open interval is half-open
 * `[opensAt, closesAt)`: editable from the instant it opens, locked the instant
 * it closes. A missing bound (either null) means the admin hasn't scheduled the
 * window yet → `unconfigured`.
 */
export function windowState(
  opensAt: Date | null,
  closesAt: Date | null,
  now: Date,
): WindowState {
  if (!opensAt || !closesAt) return "unconfigured";
  const t = now.getTime();
  if (t < opensAt.getTime()) return "before";
  if (t >= closesAt.getTime()) return "closed";
  return "open";
}

/** Only an open window permits edits; before/closed/unconfigured all lock it. */
export function canEditInWindow(state: WindowState): boolean {
  return state === "open";
}

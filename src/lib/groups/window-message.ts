/**
 * User-facing copy for the form-access gates (PLAN.md §13). Pure — shared by the
 * server actions (error strings) and the student pages (banners) so the wording
 * stays in one place. Date formatting happens here; pages render server-side so
 * there's no client/server locale mismatch.
 */
import type { WindowState } from "@/lib/domain/window";

export const NO_GROUP_MESSAGE =
  "You don't have access to the availability form yet. Ask your scheduler to add you to a group.";

/** Shown when a student has submitted and their group locks editing afterward. */
export const SUBMITTED_LOCK_MESSAGE =
  "You've already submitted your availability, so it's now locked. Contact your scheduler if you need to change anything.";

function fmt(d: Date | null): string {
  if (!d) return "";
  return d.toLocaleString("en-US", {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export interface LockedMessage {
  title: string;
  detail: string;
}

/** Banner copy for a locked (non-open) window. `open` returns empty strings. */
export function lockedMessage(
  state: WindowState,
  opensAt: Date | null,
  closesAt: Date | null,
): LockedMessage {
  switch (state) {
    case "before":
      return {
        title: "The availability form isn't open yet.",
        detail: opensAt ? `It opens ${fmt(opensAt)}.` : "",
      };
    case "closed":
      return {
        title: "The availability form is closed.",
        detail: closesAt ? `It closed ${fmt(closesAt)}.` : "",
      };
    case "unconfigured":
      return {
        title: "Your availability window hasn't been scheduled yet.",
        detail: "Check back later, or ask your scheduler when the form opens.",
      };
    case "open":
      return { title: "", detail: "" };
  }
}

/** A single-line version of the locked reason, for server-action error lists. */
export function lockedReasonLine(
  state: WindowState,
  opensAt: Date | null,
  closesAt: Date | null,
): string {
  const { title, detail } = lockedMessage(state, opensAt, closesAt);
  return [title, detail].filter(Boolean).join(" ");
}

/**
 * The short line a stored lifecycle flag shows on a student's page. The stored
 * `detail` stays the full record (it is written by positions/apply-change.ts
 * and positions/orphans.ts, and older rows say it in older words); this only
 * shortens it for reading, so it works on any row ever written.
 *
 * Anything the page already shows elsewhere is left out: the grid marks the
 * orphaned picks, and the check lines under the flags list what fails.
 */
import type { DbFlagType } from "@/lib/db/schema";

const n = (count: string, one: string, many: string) => `${count} ${count === "1" ? one : many}`;

/** Each stored sentence and its short form; "" drops it. */
const POSITION_CHANGE_RULES: [RegExp, (...m: string[]) => string][] = [
  [/^Position changed from (.+) to (.+)\.$/, (_, from, to) => `${from} to ${to}.`],
  [/^Position changed from (.+)\.$/, (_, from) => `Moved off ${from}.`],
  [/^Position set to (.+)\.$/, (_, to) => `Set to ${to}.`],
  [/^(.+) has no shifts set up yet, so shift picks are unchanged\.$/, () => "Picks unchanged."],
  [/^The new title has no position yet, so shift picks are unchanged\.$/, () => "Picks unchanged."],
  [/^0 picks moved to the new position\.$/, () => ""],
  [/^(\d+) picks? moved to the new position\.$/, (_, c) => `${n(c, "pick", "picks")} moved.`],
  [
    /^(\d+) picks? did not fit and stayed on the old position\.$/,
    (_, c) => `${n(c, "pick", "picks")} left on the old position.`,
  ],
  [/^Review and clear them on the grid\.$/, () => ""],
  [
    /^(\d+) scheduled shifts? (?:was|were) removed\.$/,
    (_, c) => `${n(c, "scheduled shift", "scheduled shifts")} removed.`,
  ],
  [
    /^(\d+) weekend closes? (?:was|were) opened up\.$/,
    (_, c) => `${n(c, "weekend close", "weekend closes")} released.`,
  ],
];

function shortPositionChange(detail: string): string {
  // Sentences end in ". " followed by a capital or a digit; names may hold dots
  // ("St. Clair") but never a dot, space and capital in the stored copy.
  const sentences = detail.split(/(?<=\.)\s+(?=[A-Z0-9])/);
  return sentences
    .map((s) => {
      for (const [re, fn] of POSITION_CHANGE_RULES) {
        const m = s.match(re);
        if (m) return fn(...m);
      }
      return s;
    })
    .filter(Boolean)
    .join(" ");
}

/**
 * The line to show beside the flag's pill, or null for the pill alone.
 * `hasInternalCopy`: the revalidation flag judges the internal copy when one
 * exists, which the check lines below do not, so only then is its list news.
 */
export function shortFlagDetail(
  type: DbFlagType,
  detail: string,
  { hasInternalCopy }: { hasInternalCopy: boolean },
): string | null {
  switch (type) {
    case "position_change":
      return shortPositionChange(detail);
    case "orphaned_selection": {
      const count = detail.match(/^(\d+) picks?\b/)?.[1];
      if (!count) return detail;
      return count === "1"
        ? "1 pick on a shift they can't work."
        : `${count} picks on shifts they can't work.`;
    }
    case "revalidation_failed": {
      if (!hasInternalCopy) return null;
      const list = detail.replace(/^Availability no longer passes checks:\s*/, "");
      return `Internal copy: ${list}`;
    }
    default:
      return detail;
  }
}

/**
 * The schedule fill colors every admin surface shares: engine rows green,
 * manual rows violet. One module so the per-student editor grid, the popup
 * grid, and any future surface can never drift apart.
 */
import type { AssignmentSource } from "@/lib/domain/scheduling/types";

export const ENGINE_COLOR = "#2e9e5b";
export const MANUAL_COLOR = "#8a4fd3";

/** The fill for one assignment row's source. */
export function sourceColor(source: AssignmentSource): string {
  return source === "manual" ? MANUAL_COLOR : ENGINE_COLOR;
}

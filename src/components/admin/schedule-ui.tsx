/**
 * The admin vocabulary that only the schedule surfaces speak: the fill colors,
 * the frozen label, and the health bar.
 *
 * Split out of ./ui.tsx because everything here type-depends on the generator,
 * and ./ui.tsx is imported by admin pages that have nothing to do with a
 * schedule. Keeping the two apart is what lets a travel page or a responses
 * page import the shared kit without pulling the engine's vocabulary in with
 * it (plan item A2). Anything generator-shaped belongs here, not there.
 *
 * Hook-free, so server pages and client components can both import it. Colors
 * go through the globals.css tokens, except the two schedule fills, which are
 * fixed hues rather than theme roles.
 */
import type { HealthBar, HealthTone } from "@/lib/admin/schedule-health-view";
import type { FrozenReason } from "@/lib/domain/scheduling/run-warnings";
import type { AssignmentSource } from "@/lib/domain/scheduling/types";
import { barTrackStyle } from "@/components/admin/ui";

/**
 * The schedule fill colors every admin surface shares: engine rows green,
 * manual rows violet. One module so the per-student editor grid, the popup
 * grid, and any future surface can never drift apart.
 */
export const ENGINE_COLOR = "#2e9e5b";
export const MANUAL_COLOR = "#8a4fd3";

/** The fill for one assignment row's source. */
export function sourceColor(source: AssignmentSource): string {
  return source === "manual" ? MANUAL_COLOR : ENGINE_COLOR;
}

/** Why a student's shifts did not move. See FrozenReason for the split. */
export const FROZEN_LABEL: Record<FrozenReason, string> = {
  marked: "kept",
  "out-of-scope": "not in this update",
  kept: "kept",
};

/** Text color for a health tone: red for danger, amber for warning, plain otherwise. */
export const toneColor = (tone: HealthTone): string =>
  tone === "danger"
    ? "var(--color-text-danger)"
    : tone === "warning"
      ? "var(--color-text-warning)"
      : "var(--color-text-primary)";

/** The same three tones as a bar fill, where the warning reads better as a wash. */
export const barColor = (tone: HealthTone): string =>
  tone === "danger"
    ? "var(--color-text-danger)"
    : tone === "warning"
      ? "var(--color-background-warning)"
      : "var(--color-text-info)";

/**
 * One hand-rolled bar: label and figure on a line, the track under them. Shared
 * with the analytics funnel's shape on purpose, and hand-rolled on purpose:
 * these pages carry no chart library.
 */
export function Bar({ bar }: { bar: HealthBar }) {
  return (
    <div style={{ padding: "6px 0", borderTop: "0.5px solid var(--color-border-tertiary)" }}>
      <div
        style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}
      >
        <span style={{ color: toneColor(bar.tone) }}>{bar.label}</span>
        <span style={{ color: "var(--color-text-secondary)" }}>{bar.caption}</span>
      </div>
      <div style={barTrackStyle}>
        <div
          style={{
            width: `${bar.percent}%`,
            height: "100%",
            borderRadius: 3,
            background: barColor(bar.tone),
          }}
        />
      </div>
    </div>
  );
}

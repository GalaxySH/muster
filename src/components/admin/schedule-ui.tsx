/**
 * The admin vocabulary that only the schedule surfaces speak: the frozen label
 * and the health bar.
 *
 * Split out of ./ui.tsx because everything here type-depends on the generator,
 * and ./ui.tsx is imported by admin pages that have nothing to do with a
 * schedule. Keeping the two apart is what lets a travel page or a responses
 * page import the shared kit without pulling the engine's vocabulary in with
 * it (plan item A2). Anything generator-shaped belongs here, not there.
 *
 * Hook-free, so server pages and client components can both import it. Every
 * colour is a console token (app/admin.css), so these only resolve inside the
 * console's `.ad` root, which is the only place they are rendered.
 */
import type { HealthBar } from "@/lib/admin/schedule-health-view";
import type { FrozenReason } from "@/lib/domain/scheduling/run-warnings";

/** Why a student's shifts did not move. See FrozenReason for the split. */
export const FROZEN_LABEL: Record<FrozenReason, string> = {
  marked: "kept",
  "out-of-scope": "not in this update",
  kept: "kept",
};

const TONE_TEXT_CLASS = { danger: "ad-danger-text", warning: "ad-warning-text" } as const;
const TONE_FILL_CLASS = {
  danger: "ad-bar-fill ad-bar-fill--danger",
  warning: "ad-bar-fill ad-bar-fill--warning",
} as const;

/**
 * One hand-rolled bar: label and figure on a line, the track under them. Shared
 * with the analytics funnel's shape on purpose, and hand-rolled on purpose:
 * these pages carry no chart library.
 */
export function Bar({ bar }: { bar: HealthBar }) {
  return (
    <div className="ad-gr-bar">
      <div className="ad-gr-bar-head">
        <span className={bar.tone ? TONE_TEXT_CLASS[bar.tone] : undefined}>{bar.label}</span>
        <span className="ad-muted">{bar.caption}</span>
      </div>
      <div className="ad-bar">
        <div
          className={bar.tone ? TONE_FILL_CLASS[bar.tone] : "ad-bar-fill"}
          style={{ width: `${bar.percent}%` }}
        />
      </div>
    </div>
  );
}

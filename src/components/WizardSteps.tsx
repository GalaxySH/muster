import Link from "next/link";
import { WIZARD_STEPS, type WizardStepKey } from "@/lib/flow/steps";

/**
 * The onboarding-wizard breadcrumb (course schedule → availability → travel). This
 * is the flow's navigation: a step is a link only when it's unlocked, so the
 * breadcrumb can't jump ahead of the data, the same gate the per-step "Next"
 * buttons enforce. `reachable` lists the unlocked step keys (omit to make every
 * step a link). The current step is bold; locked steps are muted, non-clickable.
 * Rendered inside AppHeader (after Home), so each step carries a leading `·`.
 * Pure/server, no client state.
 */
export function WizardSteps({
  current,
  reachable,
}: {
  current?: WizardStepKey;
  reachable?: WizardStepKey[];
}) {
  return (
    <>
      {WIZARD_STEPS.map((s, i) => {
        const active = s.key === current;
        const unlocked = reachable === undefined || reachable.includes(s.key);
        const label = `${i + 1}. ${s.label}`;
        return (
          <span key={s.key} style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
            <span aria-hidden style={{ color: "#ccc" }}>
              ·
            </span>
            {active ? (
              <span aria-current="step" style={{ fontWeight: 700, color: "#1a2233" }}>
                {label}
              </span>
            ) : unlocked ? (
              <Link href={s.href} style={{ color: "#1a66cc", textDecoration: "none" }}>
                {label}
              </Link>
            ) : (
              <span aria-disabled style={{ color: "#bbb" }} title="Finish the earlier steps first">
                {label}
              </span>
            )}
          </span>
        );
      })}
    </>
  );
}

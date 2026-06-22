import { WIZARD_STEPS, type WizardStepKey } from "@/lib/flow/steps";

/**
 * Linear progress indicator for the three data steps of the onboarding wizard
 * (course schedule → availability → travel). Pure/server — no client state.
 */
export function WizardSteps({ current }: { current: WizardStepKey }) {
  return (
    <nav
      aria-label="Progress"
      style={{ display: "flex", flexWrap: "wrap", gap: 8, fontSize: 13, margin: "0 0 14px" }}
    >
      {WIZARD_STEPS.map((s, i) => {
        const active = s.key === current;
        return (
          <span key={s.key} style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
            {i > 0 && <span aria-hidden style={{ color: "#bbb" }}>→</span>}
            <span
              aria-current={active ? "step" : undefined}
              style={{ fontWeight: active ? 700 : 400, color: active ? "#1a66cc" : "#999" }}
            >
              {i + 1}. {s.label}
            </span>
          </span>
        );
      })}
    </nav>
  );
}

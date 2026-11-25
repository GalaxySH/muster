import Link from "next/link";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCheck, faLock } from "@awesome.me/kit-925f6dce39/icons/classic/solid";
import type { WizardStep, WizardStepKey } from "@/lib/flow/steps";
import { VisuallyHidden } from "./ui";

/**
 * The form flow's step indicator: "Step 2 of 3" plus a row of numbered dots.
 * It is also the flow's navigation. A step links only when it is unlocked, the
 * same gate the per-step Continue buttons enforce, so it can't jump ahead of
 * the data. `steps` and `reachable` come from `loadWizardNav`.
 *
 * `current` is unset on the pages that bookend the steps (the introduction and
 * the final review), which pass their own `label` instead. The final review
 * also passes `allDone`: every step is behind it.
 */
export function StepProgress({
  steps,
  current,
  reachable,
  label,
  allDone = false,
}: {
  steps: WizardStep[];
  current?: WizardStepKey;
  reachable: WizardStepKey[];
  label?: string;
  allDone?: boolean;
}) {
  const currentIndex = steps.findIndex((s) => s.key === current);
  // A step is finished when a later one has been unlocked.
  const furthest = Math.max(-1, ...steps.map((s, i) => (reachable.includes(s.key) ? i : -1)));
  return (
    <nav aria-label="Form steps" className="sf-progress">
      <div className="sf-progress-inner">
        <p className="sf-progress-label">
          {currentIndex >= 0 ? (
            <>
              Step {currentIndex + 1} of {steps.length}:{" "}
              <strong>{steps[currentIndex]!.label}</strong>
            </>
          ) : (
            <strong>{label}</strong>
          )}
        </p>
        <ol className="sf-steps">
          {steps.map((s, i) => {
            const isCurrent = i === currentIndex;
            const unlocked = reachable.includes(s.key);
            const done = unlocked && !isCurrent && (allDone || i < furthest);
            const state = isCurrent ? "current" : unlocked ? "reached" : "locked";
            const dot = (
              <span className="sf-step-dot" aria-hidden>
                {done ? (
                  <FontAwesomeIcon icon={faCheck} />
                ) : unlocked || isCurrent ? (
                  i + 1
                ) : (
                  <FontAwesomeIcon icon={faLock} />
                )}
              </span>
            );
            const note = done
              ? ", done"
              : unlocked || isCurrent
                ? ""
                : ", finish the earlier steps first";
            // The whole name is one piece of hidden text, so it is read without
            // gaps. The label shown beside the dot on a wide screen repeats it.
            const name = (
              <>
                <VisuallyHidden>{`Step ${i + 1}: ${s.label}${note}`}</VisuallyHidden>
                <span className="sf-step-name" aria-hidden>
                  {s.label}
                </span>
              </>
            );
            return (
              <li
                key={s.key}
                className={`sf-step sf-step--${state}${done ? " sf-step--done" : ""}`}
              >
                {isCurrent ? (
                  <span className="sf-step-target" aria-current="step">
                    {dot}
                    {name}
                  </span>
                ) : unlocked ? (
                  <Link href={s.href} className="sf-step-target">
                    {dot}
                    {name}
                  </Link>
                ) : (
                  <span className="sf-step-target">
                    {dot}
                    {name}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      </div>
    </nav>
  );
}

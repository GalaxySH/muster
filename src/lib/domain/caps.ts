/**
 * Scheduler-side weekly hour cap (PLAN.md §5 #3, §10).
 *
 * NOT an entry constraint; students may select more than their cap. It's used
 * as a target hint (e.g. the "Max" shortcut for desired hours) and as context
 * in the admin view.
 *
 * Since 1.15 **generation** enforces it as a hard ceiling: the engine refuses
 * any placement that would carry a student's cycle-averaged week past their cap
 * (`scheduling/engine.ts`) and the improvement pass refuses any move that would
 * (`scheduling/improve.ts`), on the same boundary `isOverMaxHours` reads, so
 * sitting exactly on the cap is fine. Manual edits still only WARN, because the
 * schedule belongs to the scheduler, and the read-time over-max flag keeps
 * anyone they push over it visible.
 */
export const DOMESTIC_HOUR_CAP = 30;
export const INTERNATIONAL_HOUR_CAP = 20;

export function hourCap(international: boolean): number {
  return international ? INTERNATIONAL_HOUR_CAP : DOMESTIC_HOUR_CAP;
}

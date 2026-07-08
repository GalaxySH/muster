/**
 * Scheduler-side weekly hour cap (PLAN.md §5 #3, §10).
 *
 * NOT an entry constraint; students may select more than their cap. It's used
 * as a target hint (e.g. the "Max" shortcut for desired hours) and as context
 * in the admin view.
 */
export const DOMESTIC_HOUR_CAP = 30;
export const INTERNATIONAL_HOUR_CAP = 20;

export function hourCap(international: boolean): number {
  return international ? INTERNATIONAL_HOUR_CAP : DOMESTIC_HOUR_CAP;
}

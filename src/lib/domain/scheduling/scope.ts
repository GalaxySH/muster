/**
 * Run scope: which slice of the roster a run re-solved.
 *
 * Scoping is expressed entirely through the freeze the engine already
 * understands. Everyone outside the scope is marked scheduled for that run, so
 * their rows carry forward verbatim and the engine never learns that scoping
 * exists. Two consequences fall out of that and both matter:
 *
 * - A scoped run is still a complete run. It holds everybody who had rows, not
 *   just the slice, so nothing downstream has to special-case a partial record.
 * - The whole student list must still reach the engine. Filtering it instead
 *   would put every omitted student into the run's dropped list, which reads as
 *   "left the roster".
 *
 * Scope says what *moved*; it never says what the run *contains*.
 */

/** Positions this run re-solved. Empty is not a scope; use null for the whole roster. */
export interface ScheduleScope {
  positionIds: string[];
}

/** Anything holding a position that the freeze can be applied to. */
interface Scopeable {
  positionId: string | null;
  scheduled: boolean;
}

/**
 * Null out an empty or absent scope so callers have one shape to test for:
 * null is the whole roster. Ids are de-duplicated and sorted so a scope
 * round-trips through storage identically however the admin picked it.
 */
export function normalizeScope(scope: ScheduleScope | null | undefined): ScheduleScope | null {
  const ids = [...new Set(scope?.positionIds ?? [])].filter((id) => id.length > 0).sort();
  return ids.length > 0 ? { positionIds: ids } : null;
}

/**
 * True when this position was re-solved by the run. A student with no position
 * is in no scope at all, but is also never frozen by `applyScopeFreeze` (see
 * there for why), so this only ever reports on real positions.
 */
export function isInScope(positionId: string | null, scope: ScheduleScope | null): boolean {
  if (!scope) return true;
  return positionId !== null && scope.positionIds.includes(positionId);
}

/**
 * Freeze everyone outside the scope for this run only. Nothing is written to
 * `submissions.scheduled`; this is the same in-memory transform repair mode
 * uses, with a different predicate.
 *
 * Students with no position are deliberately left alone. They can never be in
 * scope, but freezing them would move them out of the run report's
 * "no position" warning and into its frozen list, hiding a data problem the
 * admin needs to see. Unfrozen they reach the engine, get skipped for want of a
 * position, and keep reporting exactly as they do in an unscoped run.
 */
export function applyScopeFreeze<T extends Scopeable>(
  students: T[],
  scope: ScheduleScope | null,
): T[] {
  if (!scope) return students;
  return students.map((s) =>
    s.positionId !== null && !isInScope(s.positionId, scope) ? { ...s, scheduled: true } : s,
  );
}

export function serializeScope(scope: ScheduleScope | null): string | null {
  return scope ? JSON.stringify(scope) : null;
}

/** Never throws: an unreadable scope degrades to "whole roster", which is how every pre-scoping run reads. */
export function parseScope(json: string | null | undefined): ScheduleScope | null {
  if (!json) return null;
  try {
    const parsed: unknown = JSON.parse(json);
    if (typeof parsed !== "object" || parsed === null) return null;
    const ids = (parsed as { positionIds?: unknown }).positionIds;
    if (!Array.isArray(ids)) return null;
    return normalizeScope({
      positionIds: ids.filter((id): id is string => typeof id === "string"),
    });
  } catch {
    return null;
  }
}

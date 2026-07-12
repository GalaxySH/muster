/**
 * Position alias-chain resolution (roadmap 3.3).
 *
 * A position can be marked as an alias of another via mergedIntoId; writes
 * always canonicalize, so no stored data points at an alias. This module
 * resolves an id through the chain and guards the rule that keeps chains
 * flat: aliasing TO an alias is refused, which also prevents new cycles.
 */

/** The minimal shape of a positions row for alias resolution. */
export interface AliasRow {
  id: string;
  mergedIntoId: string | null;
}

/**
 * Follow mergedIntoId links from `id` to the canonical position id. A row
 * with no alias link resolves to itself, as does an id with no row. Chains
 * stay flat by construction; if a cycle exists anyway, resolution stops at
 * the last id reached before revisiting one, so it never loops forever.
 */
export function resolveAlias(id: string, rows: readonly AliasRow[]): string {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const visited = new Set([id]);
  let current = id;
  for (;;) {
    const next = byId.get(current)?.mergedIntoId ?? null;
    if (next === null || visited.has(next)) return current;
    visited.add(next);
    current = next;
  }
}

/** Whether a position may be chosen as an alias target: an alias itself may not. */
export function canAliasTo(targetRow: AliasRow): boolean {
  return targetRow.mergedIntoId === null;
}

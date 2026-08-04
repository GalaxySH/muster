/**
 * INITIAL W2W -> Muster position mapping seed
 * (docs/w2w-shift-plan-roundtrip.md §4). Insert-only-when-empty, same as the
 * position config: after seeding the DB row set is authoritative.
 *
 * Dock Stocker is a W2W-only position: Muster has no dock role, its rows ride
 * the Stocker 7:00-10:30 weekday block, and fillOrder 1 puts them after the
 * plain Stocker rows when a shared block cell is filled.
 */
export interface W2wPositionMapSeed {
  w2wPositionId: string;
  w2wPositionName: string;
  musterPositionId: string;
  fillOrder: number;
}

export const W2W_POSITION_MAP_SEED: readonly W2wPositionMapSeed[] = [
  {
    w2wPositionId: "762425946",
    w2wPositionName: "GDEC - SL",
    musterPositionId: "shift-lead",
    fillOrder: 0,
  },
  {
    w2wPositionId: "762431352",
    w2wPositionName: "GDEC - CA",
    musterPositionId: "culinary-assistant",
    fillOrder: 0,
  },
  {
    w2wPositionId: "762423778",
    w2wPositionName: "GDEC - Dishwasher",
    musterPositionId: "dishwasher",
    fillOrder: 0,
  },
  {
    w2wPositionId: "762428649",
    w2wPositionName: "GDEC - Market Cash",
    musterPositionId: "cashier",
    fillOrder: 0,
  },
  {
    w2wPositionId: "762428585",
    w2wPositionName: "GDEC - Stocker",
    musterPositionId: "stocker",
    fillOrder: 0,
  },
  {
    w2wPositionId: "951921404",
    w2wPositionName: "GDEC - Dock Stocker",
    musterPositionId: "stocker",
    fillOrder: 1,
  },
  {
    w2wPositionId: "762431386",
    w2wPositionName: "GDEC - R&C TM",
    // Retail & Cafe Team Member is Muster's Barista, the same answer the
    // roster title map gives ("retail and cafe team member" -> barista). This
    // named a position id that never existed until v1.11, so both seed paths
    // silently dropped the row and these shifts could never be filled.
    musterPositionId: "barista",
    fillOrder: 0,
  },
];

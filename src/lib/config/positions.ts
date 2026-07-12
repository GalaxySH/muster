/**
 * INITIAL position + shift-block seed fixture (PLAN.md §6.1, §6.3).
 *
 * This is only the starting config: `db:seed` inserts it once into an empty
 * database, and from then on the DB is authoritative (admins edit positions
 * and blocks on /admin/positions; the rules engine reads them at runtime).
 * Times use the `6:45a`/`8p` notation; open/close are DERIVED from the set
 * (see ../domain/blocks), never declared here.
 */
import { parseTime } from "@/lib/domain/time";
import type { DayType, Position, ShiftBlock } from "@/lib/domain/types";

type RangeSpec = readonly [start: string, end: string];

function blockSet(positionId: string, dayType: DayType, specs: readonly RangeSpec[]): ShiftBlock[] {
  const dt = dayType === "weekday" ? "wd" : "we";
  return specs.map(([start, end]) => ({
    id: `${positionId}-${dt}-${start.replace(":", "")}-${end.replace(":", "")}`,
    positionId,
    dayType,
    start: parseTime(start),
    end: parseTime(end),
  }));
}

const DEFAULT_MIN_HOURS = 10;
const DEFAULT_MIN_DAYS = 2;

export interface PositionConfig {
  position: Position;
  blocks: ShiftBlock[];
}

function position(
  id: string,
  name: string,
  overrides: Partial<Omit<Position, "id" | "name">> = {},
): Position {
  return {
    id,
    name,
    minHours: DEFAULT_MIN_HOURS,
    minDays: DEFAULT_MIN_DAYS,
    weekendExempt: false,
    ...overrides,
  };
}

export const POSITION_CONFIGS: readonly PositionConfig[] = [
  {
    position: position("shift-lead", "Shift Lead", { minHours: 15, minDays: 3 }),
    blocks: [
      ...blockSet("shift-lead", "weekday", [
        ["6a", "9:30a"],
        ["7a", "11:30a"],
        ["10a", "12:45p"],
        ["10a", "2p"],
        ["12:30p", "3p"],
        ["2p", "5p"],
        ["3:30p", "7p"],
        ["5p", "10p"],
        ["7p", "11:30p"],
      ]),
      ...blockSet("shift-lead", "weekend", [
        ["8a", "12p"],
        ["11a", "3p"],
        ["2p", "6p"],
        ["5p", "10p"],
        ["6p", "11:30p"],
      ]),
    ],
  },
  {
    position: position("culinary-assistant", "Culinary Assistant"),
    blocks: [
      ...blockSet("culinary-assistant", "weekday", [
        ["6:30a", "10:15a"],
        ["10a", "12:45p"],
        ["12:30p", "2:30p"],
        ["2:15p", "5p"],
        ["4:45p", "8p"],
        ["7:45p", "11:30p"],
      ]),
      ...blockSet("culinary-assistant", "weekend", [
        ["8:30a", "11a"],
        ["10:30a", "2:15p"],
        ["2p", "5p"],
        ["4:45p", "8p"],
        ["7:45p", "11:30p"],
      ]),
    ],
  },
  {
    // Weekday-only; no weekend block set → exempt from the weekend rule.
    position: position("barista", "Barista", { weekendExempt: true }),
    blocks: blockSet("barista", "weekday", [
      ["6:15a", "10a"],
      ["9:45a", "12:45p"],
      ["12:30p", "2:45p"],
      ["2:30p", "5p"],
    ]),
  },
  {
    // Market Cash + Flamingo Cash merged; venue resolved scheduler-side.
    position: position("cashier", "Cashier"),
    blocks: [
      ...blockSet("cashier", "weekday", [
        ["6:45a", "10a"],
        ["9:45a", "12:45p"],
        ["10:45a", "12:45p"],
        ["12:30p", "2:30p"],
        ["2:30p", "5:15p"],
        ["5p", "8:30p"],
        ["8p", "11:30p"],
      ]),
      ...blockSet("cashier", "weekend", [
        ["8:45a", "12:30p"],
        ["9:45a", "12:45p"],
        ["10:45a", "12:45p"],
        ["12:30p", "2:30p"],
        ["2:30p", "5:15p"],
        ["5p", "8:30p"],
        ["8p", "11:30p"],
      ]),
    ],
  },
  {
    position: position("dishwasher", "Dishwasher"),
    blocks: [
      ...blockSet("dishwasher", "weekday", [
        ["7a", "10:15a"],
        ["10a", "12:45p"],
        ["12:30p", "2:30p"],
        ["2p", "5p"],
        ["4:30p", "8p"],
        ["7:45p", "11:30p"],
      ]),
      ...blockSet("dishwasher", "weekend", [
        ["8:30a", "11a"],
        ["10:30a", "2:15p"],
        ["2p", "5p"],
        ["4:45p", "8p"],
        ["7:45p", "11:30p"],
      ]),
    ],
  },
  {
    // Dock Stocker + Stocker merged.
    position: position("stocker", "Stocker"),
    blocks: [
      ...blockSet("stocker", "weekday", [
        ["8:30a", "10:15a"],
        ["10a", "12:45p"],
        ["12:30p", "2:30p"],
        ["2:15p", "5p"],
        ["4:45p", "8p"],
        ["7:45p", "11:30p"],
      ]),
      ...blockSet("stocker", "weekend", [
        ["8:30a", "11a"],
        ["10:30a", "2:15p"],
        ["2p", "5p"],
        ["4:45p", "8p"],
        ["7:45p", "11:30p"],
      ]),
    ],
  },
];

export const POSITIONS: readonly Position[] = POSITION_CONFIGS.map((c) => c.position);
export const SHIFT_BLOCKS: readonly ShiftBlock[] = POSITION_CONFIGS.flatMap((c) => c.blocks);

export function blocksFor(positionId: string): ShiftBlock[] {
  return SHIFT_BLOCKS.filter((b) => b.positionId === positionId);
}

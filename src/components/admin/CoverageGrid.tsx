/**
 * The coverage grid: one table per day-type, one cell per (block × day), graded
 * against the block's target staffing.
 *
 * Shared by /admin/schedule (every position) and the per-student page (that
 * student's position), so the two readings of the same numbers can never drift
 * apart. `assignedCells` picks which number a cell shows: pass a run's seat
 * counts to show what the schedule put there, or null to show how many students
 * could work it.
 */
import { SlotCell } from "@/components/admin/SlotCell";
import { Pill, cx } from "@/components/admin/ui";
import { demandCellKey } from "@/lib/domain/demand";
import {
  assignedCellCount,
  coverageStatus,
  type CoverageRow,
} from "@/lib/domain/scheduling/coverage";
import { formatSpan } from "@/lib/domain/time";
import { DAY_LABEL, type DayType } from "@/lib/domain/types";
import type { AssignedCellCounts } from "@/lib/schedule/data";

/** Seats a run fills per cell, keyed by demandCellKey; null shows availability instead. */
export type AssignedCellMap = ReadonlyMap<string, AssignedCellCounts> | null;

const DAY_TYPES: { dayType: DayType; label: string }[] = [
  { dayType: "weekday", label: "Weekdays" },
  { dayType: "weekend", label: "Weekends" },
];

export function CoverageGrid({
  rows,
  assignedCells,
  stacked = false,
  compact = false,
  positionName,
}: {
  rows: readonly CoverageRow[];
  assignedCells: AssignedCellMap;
  /**
   * Weekdays above Weekends instead of side by side, for a narrow card. Each
   * table still scrolls sideways on its own when it is wider than the card.
   */
  stacked?: boolean;
  /**
   * Tighter columns for the per-student card: no Target column and no
   * tier/close pills on the Shift column, so the grid needs less horizontal
   * scrolling next to a single position's other cards.
   */
  compact?: boolean;
  /** Whose shifts these are, for the name of each cell. */
  positionName?: string;
}) {
  if (rows.length === 0) {
    return <p className="ad-muted">No blocks configured.</p>;
  }

  const tableClass = cx(
    "ad-table ad-gr-cov-table",
    stacked && "ad-gr-cov-table--fill",
    compact && "ad-gr-cov-table--compact",
  );
  // On the schedule page each grid sits in a panel with its own heading. The
  // compact one, on a student page, opens from a disclosure with none above it.
  const Heading = compact ? "h2" : "h3";

  return (
    <div className={stacked ? "ad-gr-cov-layout ad-gr-cov-layout--stacked" : "ad-gr-cov-layout"}>
      {DAY_TYPES.map(({ dayType, label }) => {
        const dayRows = rows.filter((r) => r.dayType === dayType);
        if (dayRows.length === 0) return null;
        return (
          <div key={dayType} className="ad-gr-cov-block">
            <Heading>{label}</Heading>
            <table className={tableClass}>
              <thead>
                <tr>
                  <th scope="col">Shift</th>
                  {!compact && (
                    <th scope="col" className="ad-center">
                      Target
                    </th>
                  )}
                  {dayRows[0]!.cells.map((c) => (
                    <th key={c.day} scope="col" className="ad-center">
                      {DAY_LABEL[c.day]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dayRows.map((row) => (
                  <CoverageTableRow
                    key={row.blockId}
                    row={row}
                    assignedCells={assignedCells}
                    compact={compact}
                    positionName={positionName}
                  />
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}

function CoverageTableRow({
  row,
  assignedCells,
  compact,
  positionName,
}: {
  row: CoverageRow;
  assignedCells: AssignedCellMap;
  compact: boolean;
  positionName?: string;
}) {
  return (
    <tr>
      <th scope="row">
        {formatSpan(row.start, row.end)}
        {!compact && row.tier === "night" && (
          <>
            {" "}
            <Pill>Night</Pill>
          </>
        )}
        {!compact && row.tier === "evening" && (
          <>
            {" "}
            <Pill>Evening</Pill>
          </>
        )}
        {!compact && row.isClose && (
          <>
            {" "}
            <Pill tone="info">Close</Pill>
          </>
        )}
      </th>
      {!compact && <td className="ad-center ad-muted">{row.target ?? "-"}</td>}
      {row.cells.map((cell) => {
        const counts = assignedCells?.get(demandCellKey(row.blockId, cell.day));
        const assigned = assignedCells ? assignedCellCount(row.dayType, counts) : 0;
        const status = assignedCells ? coverageStatus(assigned, cell.target) : cell.status;
        const shown = !assignedCells
          ? String(cell.count)
          : row.dayType === "weekend"
            ? `${counts?.a ?? 0}·${counts?.b ?? 0}`
            : String(assigned);
        return (
          <SlotCell
            key={cell.day}
            blockId={row.blockId}
            day={cell.day}
            dayLabel={DAY_LABEL[cell.day]}
            shiftLabel={formatSpan(row.start, row.end)}
            supply={cell.count}
            positionName={positionName}
            value={cell.target === null ? shown : `${shown}/${cell.target}`}
            className={`ad-center ad-gr-cov ad-gr-cov--${status}`}
          >
            {shown}
            {cell.target !== null && <span className="ad-gr-cov-target">/{cell.target}</span>}
          </SlotCell>
        );
      })}
    </tr>
  );
}

/** What the cell colors mean. Reads the same under either set of numbers. */
export function CoverageLegend() {
  return (
    <>
      <span className="ad-pill ad-gr-cov--ok">meets target</span>{" "}
      <span className="ad-pill ad-gr-cov--short">short</span>{" "}
      <span className="ad-pill ad-gr-cov--severe">under half</span>{" "}
      <span className="ad-pill">no target</span>
    </>
  );
}

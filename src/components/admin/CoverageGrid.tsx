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
import { tableTdStyle, tableThStyle } from "@/components/admin/ui";
import { demandCellKey } from "@/lib/domain/demand";
import {
  assignedCellCount,
  coverageStatus,
  type CoverageRow,
  type CoverageStatus,
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
}: {
  rows: readonly CoverageRow[];
  assignedCells: AssignedCellMap;
}) {
  if (rows.length === 0) {
    return (
      <p style={{ margin: 0, fontSize: 13, color: "var(--color-text-secondary)" }}>
        No blocks configured.
      </p>
    );
  }

  return (
    <div style={{ display: "flex", gap: 28, flexWrap: "wrap", alignItems: "flex-start" }}>
      {DAY_TYPES.map(({ dayType, label }) => {
        const dayRows = rows.filter((r) => r.dayType === dayType);
        if (dayRows.length === 0) return null;
        return (
          <div key={dayType} style={{ overflowX: "auto" }}>
            <h3 style={{ fontSize: 14, margin: "0 0 6px" }}>{label}</h3>
            <table style={{ borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={{ ...tableThStyle, textAlign: "left" }}>Shift</th>
                  <th style={tableThStyle}>Target</th>
                  {dayRows[0]!.cells.map((c) => (
                    <th key={c.day} style={tableThStyle}>
                      {DAY_LABEL[c.day]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dayRows.map((row) => (
                  <CoverageTableRow key={row.blockId} row={row} assignedCells={assignedCells} />
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
}: {
  row: CoverageRow;
  assignedCells: AssignedCellMap;
}) {
  return (
    <tr>
      <td style={{ ...tableTdStyle, textAlign: "left", whiteSpace: "nowrap" }}>
        {formatSpan(row.start, row.end)}
        {row.tier === "night" && <span style={nightTag}>Night</span>}
        {row.tier === "evening" && <span style={eveningTag}>Evening</span>}
        {row.isClose && <span style={closeTag}>Close</span>}
      </td>
      <td style={{ ...tableTdStyle, color: "var(--color-text-secondary)" }}>{row.target ?? "-"}</td>
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
            style={{ ...tableTdStyle, ...coverageStatusStyles[status] }}
          >
            {shown}
            {cell.target !== null && <span style={{ opacity: 0.65 }}>/{cell.target}</span>}
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
      <span style={{ ...legendChip, ...coverageStatusStyles.ok }}>meets target</span>{" "}
      <span style={{ ...legendChip, ...coverageStatusStyles.short }}>short</span>{" "}
      <span style={{ ...legendChip, ...coverageStatusStyles.severe }}>under half</span>{" "}
      <span style={legendChip}>no target</span>
    </>
  );
}

export const coverageStatusStyles: Record<CoverageStatus, React.CSSProperties> = {
  ok: { background: "#e6f4ea", color: "#196127" },
  short: { background: "#fff4e0", color: "#8a5a00" },
  severe: { background: "#fce8e6", color: "#b3261e" },
  none: { color: "var(--color-text-secondary)" },
};

export const legendChip: React.CSSProperties = {
  borderRadius: 10,
  padding: "1px 8px",
  fontSize: 12,
  background: "var(--color-background-secondary)",
  color: "inherit",
  textDecoration: "none",
};

const tagBase: React.CSSProperties = {
  borderRadius: 10,
  padding: "1px 8px",
  fontSize: 11,
  marginLeft: 6,
  whiteSpace: "nowrap",
};
const nightTag: React.CSSProperties = { ...tagBase, background: "#efeafd", color: "#5b3fbf" };
const eveningTag: React.CSSProperties = { ...tagBase, background: "#fff4e0", color: "#8a5a00" };
const closeTag: React.CSSProperties = { ...tagBase, background: "#e7f0fb", color: "#1a66cc" };

import { redirect } from "next/navigation";
import { getAppSession } from "@/lib/auth/session";
import { AppHeader, Crumb } from "@/components/AppHeader";
import { Page } from "@/components/ui";
import { SectionLabel, StatTile, cardsGridStyle, panelStyle } from "@/components/admin/ui";
import { GenerateScheduleButton } from "@/components/admin/GenerateScheduleButton";
import { ScheduleStudentTable } from "@/components/admin/ScheduleStudentTable";
import {
  loadCoverage,
  loadCurrentSchedule,
  type CurrentSchedule,
  type PositionCoverage,
} from "@/lib/schedule/data";
import {
  assignedCellCount,
  coverageStatus,
  summarizeAssignedCoverage,
  type CoverageRow,
  type CoverageStatus,
  type CoverageSummary,
} from "@/lib/domain/coverage";
import { demandCellKey } from "@/lib/domain/demand";
import { formatSpan } from "@/lib/domain/time";
import { DAY_LABEL, type DayType } from "@/lib/domain/types";

/** Counts move with every submission and run; never serve a cached page. */
export const dynamic = "force-dynamic";

/**
 * Admin: schedule coverage and the recommended schedule (roadmap 5.1;
 * docs/schedule-generation-plan.md Phases A and B). Before a run exists the
 * grid shows selection supply per (block × day) cell; once one is generated it
 * grades the run's assigned seats against the targets, with supply in the cell
 * tooltip, and lists every student's recommended shifts below.
 */
export default async function AdminSchedulePage() {
  const session = await getAppSession();
  if (!session) redirect("/signin?callbackUrl=/admin/schedule");
  if (!session.isAdmin) redirect("/me");

  const [coverage, schedule] = await Promise.all([loadCoverage(), loadCurrentSchedule()]);
  const summaryOf = (p: PositionCoverage): CoverageSummary =>
    schedule ? summarizeAssignedCoverage(p.rows, schedule.assignedCells) : p.summary;
  const totals = coverage.reduce(
    (acc, p) => {
      const s = summaryOf(p);
      return {
        targetedCells: acc.targetedCells + s.targetedCells,
        shortCells: acc.shortCells + s.shortCells,
        missing: acc.missing + s.missing,
        responders: acc.responders + p.responders,
        roster: acc.roster + p.rosterCount,
      };
    },
    { targetedCells: 0, shortCells: 0, missing: 0, responders: 0, roster: 0 },
  );

  return (
    <Page width="full">
      <AppHeader>
        <Crumb href="/admin" label="Admin" />
      </AppHeader>
      <h1>Schedule</h1>
      <p style={{ color: "var(--color-text-secondary)", maxWidth: 720 }}>
        {schedule
          ? "Each cell shows how many students the current schedule puts on that shift, against the target staffing where one is set. Hover a cell to see how many students could work it. Weekend cells show both rotation weeks as A·B."
          : "Each cell counts the submitted students who could work that shift on that day, next to the target staffing where one is set. Set targets per block on the Positions and shift blocks page."}
      </p>

      <SchedulePanel schedule={schedule} responders={totals.responders} />

      <div style={{ ...cardsGridStyle, maxWidth: 720 }}>
        <StatTile
          label="Responses in"
          value={totals.responders}
          sub={`of ${totals.roster} on the roster`}
        />
        <StatTile
          label="Cells with a target"
          value={totals.targetedCells}
          sub={totals.targetedCells === 0 ? "no targets set yet" : undefined}
          subTone={totals.targetedCells === 0 ? "warning" : undefined}
        />
        <StatTile
          label="Cells short"
          value={totals.shortCells}
          sub={totals.missing > 0 ? `${totals.missing} people missing in total` : undefined}
          subTone={totals.shortCells > 0 ? "danger" : undefined}
        />
      </div>

      <p style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
        <span style={{ ...legendChip, ...statusStyles.ok }}>meets target</span>{" "}
        <span style={{ ...legendChip, ...statusStyles.short }}>short</span>{" "}
        <span style={{ ...legendChip, ...statusStyles.severe }}>under half</span>{" "}
        <span style={legendChip}>no target</span>
      </p>

      {coverage.map((p) => (
        <PositionSection
          key={p.positionId}
          coverage={p}
          schedule={schedule}
          summary={summaryOf(p)}
        />
      ))}

      {schedule && <StudentTable schedule={schedule} />}
    </Page>
  );
}

function SchedulePanel({
  schedule,
  responders,
}: {
  schedule: CurrentSchedule | null;
  responders: number;
}) {
  if (!schedule) {
    return (
      <section style={{ ...panelStyle, marginTop: 14, maxWidth: 720 }}>
        <SectionLabel>Recommended schedule</SectionLabel>
        <p style={{ margin: "0 0 10px", fontSize: 13, color: "var(--color-text-secondary)" }}>
          No schedule has been generated yet. Responses are placed in the order they came in,
          later shifts first.
        </p>
        <GenerateScheduleButton hasRun={false} />
      </section>
    );
  }

  const { report } = schedule;
  const placed = report.students.filter((s) => s.assignedMinutes > 0).length;
  const frozen = report.students.filter((s) => s.frozen).length;
  const notes: string[] = [];
  if (report.droppedStudents.length > 0) {
    notes.push(`${report.droppedStudents.length} left the roster and were dropped`);
  }
  if (report.droppedBlockGone > 0) {
    notes.push(`${report.droppedBlockGone} kept shifts pointed at removed blocks and were dropped`);
  }
  if (report.skippedNoPosition.length > 0) {
    notes.push(`${report.skippedNoPosition.length} skipped with no position set`);
  }
  if (report.belowMinDays > 0) {
    notes.push(`${report.belowMinDays} could not span their minimum days`);
  }

  return (
    <section style={{ ...panelStyle, marginTop: 14, maxWidth: 720 }}>
      <SectionLabel
        action={
          <a href="/admin/schedule/export" style={{ fontSize: 13 }}>
            Download CSV
          </a>
        }
      >
        Recommended schedule
      </SectionLabel>
      <p style={{ margin: "0 0 10px", fontSize: 13, color: "var(--color-text-secondary)" }}>
        Generated {schedule.generatedAt.toLocaleString("en-US")} by {schedule.generatedBy}.{" "}
        {schedule.totalAssignments} assignments across {placed} of {responders} responses.
        {frozen > 0 && ` ${frozen} marked scheduled and kept as is.`}
        {report.shortOfTarget > 0 && ` ${report.shortOfTarget} students are short of their hours.`}
      </p>
      {notes.length > 0 && (
        <p style={{ margin: "0 0 10px", fontSize: 13, color: "var(--color-text-danger)" }}>
          {notes.join("; ")}.
        </p>
      )}
      <GenerateScheduleButton hasRun />
    </section>
  );
}

function PositionSection({
  coverage,
  schedule,
  summary,
}: {
  coverage: PositionCoverage;
  schedule: CurrentSchedule | null;
  summary: CoverageSummary;
}) {
  const { positionName, rosterCount, responders, rows } = coverage;
  const dayTypes: { dayType: DayType; label: string }[] = [
    { dayType: "weekday", label: "Weekdays" },
    { dayType: "weekend", label: "Weekends" },
  ];

  return (
    <section style={{ ...panelStyle, marginTop: 14 }}>
      <SectionLabel
        action={
          summary.missing > 0 ? (
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text-danger)" }}>
              {summary.missing} people short across {summary.shortCells} cell
              {summary.shortCells === 1 ? "" : "s"}
            </span>
          ) : undefined
        }
      >
        {positionName}
        <span
          style={{
            marginLeft: 10,
            fontSize: 13,
            fontWeight: 400,
            color: "var(--color-text-secondary)",
          }}
        >
          {responders} of {rosterCount} responded
        </span>
      </SectionLabel>

      {rows.length === 0 && (
        <p style={{ margin: 0, fontSize: 13, color: "var(--color-text-secondary)" }}>
          No blocks configured.
        </p>
      )}

      <div style={{ display: "flex", gap: 28, flexWrap: "wrap", alignItems: "flex-start" }}>
        {dayTypes.map(({ dayType, label }) => {
          const dayRows = rows.filter((r) => r.dayType === dayType);
          if (dayRows.length === 0) return null;
          return (
            <div key={dayType} style={{ overflowX: "auto" }}>
              <h3 style={{ fontSize: 14, margin: "0 0 6px" }}>{label}</h3>
              <table style={{ borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr>
                    <th style={{ ...cellTh, textAlign: "left" }}>Shift</th>
                    <th style={cellTh}>Target</th>
                    {dayRows[0]!.cells.map((c) => (
                      <th key={c.day} style={cellTh}>
                        {DAY_LABEL[c.day]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {dayRows.map((row) => (
                    <CoverageTableRow key={row.blockId} row={row} schedule={schedule} />
                  ))}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function CoverageTableRow({
  row,
  schedule,
}: {
  row: CoverageRow;
  schedule: CurrentSchedule | null;
}) {
  return (
    <tr>
      <td style={{ ...cellTd, textAlign: "left", whiteSpace: "nowrap" }}>
        {formatSpan(row.start, row.end)}
        {row.tier === "night" && <span style={nightTag}>Night</span>}
        {row.tier === "evening" && <span style={eveningTag}>Evening</span>}
        {row.isClose && <span style={closeTag}>Close</span>}
      </td>
      <td style={{ ...cellTd, color: "var(--color-text-secondary)" }}>{row.target ?? "-"}</td>
      {row.cells.map((cell) => {
        if (!schedule) {
          return (
            <td key={cell.day} style={{ ...cellTd, ...statusStyles[cell.status] }}>
              {cell.count}
              {cell.target !== null && <span style={{ opacity: 0.65 }}>/{cell.target}</span>}
            </td>
          );
        }
        const counts = schedule.assignedCells.get(demandCellKey(row.blockId, cell.day));
        const assigned = assignedCellCount(row.dayType, counts);
        const status = coverageStatus(assigned, cell.target);
        const shown =
          row.dayType === "weekend" ? `${counts?.a ?? 0}·${counts?.b ?? 0}` : String(assigned);
        return (
          <td
            key={cell.day}
            title={`${cell.count} could work this shift`}
            style={{ ...cellTd, ...statusStyles[status] }}
          >
            {shown}
            {cell.target !== null && <span style={{ opacity: 0.65 }}>/{cell.target}</span>}
          </td>
        );
      })}
    </tr>
  );
}

function StudentTable({ schedule }: { schedule: CurrentSchedule }) {
  return (
    <section style={{ ...panelStyle, marginTop: 14 }}>
      <SectionLabel>Students</SectionLabel>
      <ScheduleStudentTable students={schedule.students} />
    </section>
  );
}

const statusStyles: Record<CoverageStatus, React.CSSProperties> = {
  ok: { background: "#e6f4ea", color: "#196127" },
  short: { background: "#fff4e0", color: "#8a5a00" },
  severe: { background: "#fce8e6", color: "#b3261e" },
  none: { color: "var(--color-text-secondary)" },
};

const cellTh: React.CSSProperties = {
  padding: "4px 10px",
  fontWeight: 600,
  color: "var(--color-text-secondary)",
  borderBottom: "1px solid var(--color-border-secondary)",
  textAlign: "center",
};

const cellTd: React.CSSProperties = {
  padding: "4px 10px",
  textAlign: "center",
  borderBottom: "1px solid var(--color-border-secondary)",
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

const legendChip: React.CSSProperties = {
  borderRadius: 10,
  padding: "1px 8px",
  fontSize: 12,
  background: "var(--color-background-secondary)",
};

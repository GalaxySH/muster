import Link from "next/link";
import { redirect } from "next/navigation";
import { getAppSession } from "@/lib/auth/session";
import { AppHeader, Crumb } from "@/components/AppHeader";
import { Page } from "@/components/ui";
import {
  SectionLabel,
  StatTile,
  bannerStyle,
  cardsGridStyle,
  panelStyle,
  successPillStyle,
} from "@/components/admin/ui";
import { GenerateScheduleButton } from "@/components/admin/GenerateScheduleButton";
import { RestoreRunButton } from "@/components/admin/RestoreRunButton";
import { ScheduleParamsForm } from "@/components/admin/ScheduleParamsForm";
import { ScheduleStudentTable } from "@/components/admin/ScheduleStudentTable";
import { SheetControls } from "@/components/admin/SheetControls";
import { getSchedulingParams } from "@/lib/settings";
import { rebuildScheduleSheet } from "@/lib/schedule/actions";
import {
  listScheduleRuns,
  loadCoverage,
  loadCurrentSchedule,
  loadFrozenMismatches,
  loadRunDiff,
  loadScheduleStaleness,
  type CurrentSchedule,
  type FrozenMismatchView,
  type PositionCoverage,
  type RunDiffData,
  type ScheduleRunListItem,
} from "@/lib/schedule/data";
import { getLastSheetSync, getSheetUrl, SCHEDULE_SHEET } from "@/lib/admin/sheet-sync";
import {
  assignedCellCount,
  coverageStatus,
  summarizeAssignedCoverage,
  type CoverageRow,
  type CoverageStatus,
  type CoverageSummary,
} from "@/lib/domain/coverage";
import { demandCellKey } from "@/lib/domain/demand";
import { hoursLabel } from "@/lib/domain/config-validation";
import { stalenessMessage, type StudentRunDiff } from "@/lib/domain/scheduling/diff";
import type { ProblemGroup } from "@/lib/domain/scheduling/problems";
import type { Cohort } from "@/lib/domain/scheduling/types";
import { formatSpan } from "@/lib/domain/time";
import { DAY_LABEL, type DayType } from "@/lib/domain/types";

/** Counts move with every submission and run; never serve a cached page. */
export const dynamic = "force-dynamic";

/**
 * Admin: schedule coverage and the recommended schedule (roadmap 5.1;
 * docs/schedule-generation-plan.md Phases A to C). Before a run exists the
 * grid shows selection supply per (block × day) cell; once one is generated it
 * grades the run's assigned seats against the targets, with supply in the cell
 * tooltip, and lists every student's recommended shifts below, plus the run
 * history with restore, the run diff picker, and the Muster Schedule sheet.
 */
export default async function AdminSchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ before?: string; after?: string }>;
}) {
  const session = await getAppSession();
  if (!session) redirect("/signin?callbackUrl=/admin/schedule");
  if (!session.isAdmin) redirect("/me");

  const [sp, coverage, schedule, params, runs, sheetUrl, sheetSyncedAt, mismatches] =
    await Promise.all([
      searchParams,
      loadCoverage(),
      loadCurrentSchedule(),
      getSchedulingParams(),
      listScheduleRuns(),
      getSheetUrl(SCHEDULE_SHEET),
      getLastSheetSync(SCHEDULE_SHEET),
      loadFrozenMismatches(),
    ]);
  const staleness = schedule ? await loadScheduleStaleness(schedule.generatedAt) : null;
  const staleLine = staleness ? stalenessMessage(staleness.newSubmissions, staleness.edited) : null;

  // Diff picker: any two runs, defaulting to current vs the newest other run.
  const runIds = new Set(runs.map((r) => r.id));
  const defaultAfter = runs.find((r) => r.status === "current")?.id ?? runs[0]?.id;
  const afterId = sp.after && runIds.has(sp.after) ? sp.after : defaultAfter;
  const defaultBefore = runs.find((r) => r.id !== afterId)?.id;
  const beforeId = sp.before && runIds.has(sp.before) ? sp.before : defaultBefore;
  const diffData =
    beforeId && afterId && beforeId !== afterId ? await loadRunDiff(beforeId, afterId) : null;
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

      <SchedulePanel
        schedule={schedule}
        responders={totals.responders}
        staleLine={staleLine}
        sheetUrl={sheetUrl}
        sheetSyncedAt={sheetSyncedAt}
      />

      <section style={{ ...panelStyle, marginTop: 14, maxWidth: 720 }}>
        <SectionLabel>Generation settings</SectionLabel>
        <ScheduleParamsForm initial={params} />
      </section>

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

      {runs.length > 0 && <RunHistorySection runs={runs} />}

      {runs.length > 1 && beforeId && afterId ? (
        <DiffSection
          runs={runs}
          beforeId={beforeId}
          afterId={afterId}
          data={diffData}
          mismatches={mismatches}
        />
      ) : (
        mismatches.length > 0 && (
          <section style={{ ...panelStyle, marginTop: 14, maxWidth: 720 }}>
            <MismatchList mismatches={mismatches} />
          </section>
        )
      )}
    </Page>
  );
}

function SchedulePanel({
  schedule,
  responders,
  staleLine,
  sheetUrl,
  sheetSyncedAt,
}: {
  schedule: CurrentSchedule | null;
  responders: number;
  staleLine: string | null;
  sheetUrl: string | null;
  sheetSyncedAt: Date | null;
}) {
  if (!schedule) {
    return (
      <section style={{ ...panelStyle, marginTop: 14, maxWidth: 720 }}>
        <SectionLabel>Recommended schedule</SectionLabel>
        <p style={{ margin: "0 0 10px", fontSize: 13, color: "var(--color-text-secondary)" }}>
          No schedule has been generated yet. Responses are placed in the order they came in, later
          shifts first.
        </p>
        <GenerateScheduleButton hasRun={false} />
      </section>
    );
  }

  const { report, problems } = schedule;
  // Counted off the enriched rows so responders and non-responders can be told
  // apart; they map one to one from the run's report.
  const placed = schedule.students.filter((s) => s.assignedMinutes > 0 && s.submitted).length;
  const withoutResponse = schedule.students.filter(
    (s) => s.assignedMinutes > 0 && !s.submitted,
  ).length;
  const frozen = schedule.students.filter((s) => s.frozen).length;

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
        {withoutResponse > 0 && ` ${withoutResponse} more scheduled without a response.`}
        {frozen > 0 && ` ${frozen} marked scheduled and kept as is.`}
        {report.params &&
          ` Used max ${report.params.dayCapHours}h per day, night priority ${report.params.nightPriority}, evening ${report.params.eveningPriority}.`}
      </p>
      {(problems.length > 0 || report.droppedBlockGone > 0) && (
        <div style={{ margin: "0 0 10px", fontSize: 13, color: "var(--color-text-danger)" }}>
          {problems.map((group) => (
            <ProblemWarning key={group.kind} group={group} />
          ))}
          {report.droppedBlockGone > 0 && (
            <p style={{ margin: "0 0 4px" }}>
              {report.droppedBlockGone} kept shifts pointed at removed blocks and were dropped.
            </p>
          )}
        </div>
      )}
      {staleLine && <div style={{ ...bannerStyle, marginBottom: 10 }}>{staleLine}</div>}
      <GenerateScheduleButton hasRun />
      <div style={{ marginTop: 12, marginBottom: -14 }}>
        <SheetControls
          sheetUrl={sheetUrl}
          lastSyncedAtMs={sheetSyncedAt ? sheetSyncedAt.getTime() : null}
          rebuild={rebuildScheduleSheet}
        />
      </div>
    </section>
  );
}

/** One warning line that expands to the affected students. */
function ProblemWarning({ group }: { group: ProblemGroup }) {
  return (
    <details style={{ margin: "0 0 4px" }}>
      <summary style={{ cursor: "pointer" }}>{group.label}.</summary>
      <ul style={{ margin: "4px 0 8px", paddingLeft: 24 }}>
        {group.students.map((s) => (
          <li key={s.email}>
            <Link href={`/admin/students/${encodeURIComponent(s.email)}`}>{s.name}</Link>{" "}
            <span style={{ color: "var(--color-text-secondary)" }}>{s.email}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

const ROTATION_LABEL: Record<Cohort, string> = {
  weekday: "",
  a: "week A",
  b: "week B",
  every: "every weekend",
};

const fmtRunTime = (d: Date) =>
  d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

function RunHistorySection({ runs }: { runs: ScheduleRunListItem[] }) {
  return (
    <section style={{ ...panelStyle, marginTop: 14, maxWidth: 900 }}>
      <SectionLabel>Run history</SectionLabel>
      <p style={{ margin: "0 0 10px", fontSize: 13, color: "var(--color-text-secondary)" }}>
        Every kept run, newest first. Restoring makes an earlier run the current schedule again; the
        replaced run stays here.
      </p>
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", fontSize: 13, width: "100%" }}>
          <thead>
            <tr>
              <th style={{ ...cellTh, textAlign: "left" }}>Generated</th>
              <th style={{ ...cellTh, textAlign: "left" }}>By</th>
              <th style={cellTh}>Assignments</th>
              <th style={cellTh}>Students</th>
              <th style={cellTh}>Short of hours</th>
              <th style={{ ...cellTh, textAlign: "left" }}>Restored</th>
              <th style={{ ...cellTh, textAlign: "left" }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id}>
                <td style={{ ...cellTd, textAlign: "left", whiteSpace: "nowrap" }}>
                  {fmtRunTime(r.generatedAt)}
                </td>
                <td style={{ ...cellTd, textAlign: "left" }}>{r.generatedBy}</td>
                <td style={cellTd}>{r.assignments}</td>
                <td style={cellTd}>{r.students}</td>
                <td style={cellTd}>{r.shortOfTarget}</td>
                <td style={{ ...cellTd, textAlign: "left", whiteSpace: "nowrap" }}>
                  {r.restoredAt ? `${fmtRunTime(r.restoredAt)} by ${r.restoredBy}` : "-"}
                </td>
                <td style={{ ...cellTd, textAlign: "left" }}>
                  {r.status === "current" ? (
                    <span style={successPillStyle}>current</span>
                  ) : (
                    <RestoreRunButton runId={r.id} />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function DiffSection({
  runs,
  beforeId,
  afterId,
  data,
  mismatches,
}: {
  runs: ScheduleRunListItem[];
  beforeId: string;
  afterId: string;
  data: RunDiffData | null;
  mismatches: FrozenMismatchView[];
}) {
  const runLabel = (r: ScheduleRunListItem) =>
    `${fmtRunTime(r.generatedAt)}${r.status === "current" ? " (current)" : ""}`;

  return (
    <section id="diff" style={{ ...panelStyle, marginTop: 14, maxWidth: 900 }}>
      <SectionLabel>Compare runs</SectionLabel>
      <form
        method="get"
        action="/admin/schedule#diff"
        style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", fontSize: 13 }}
      >
        <label>
          From{" "}
          <select name="before" defaultValue={beforeId}>
            {runs.map((r) => (
              <option key={r.id} value={r.id}>
                {runLabel(r)}
              </option>
            ))}
          </select>
        </label>
        <label>
          to{" "}
          <select name="after" defaultValue={afterId}>
            {runs.map((r) => (
              <option key={r.id} value={r.id}>
                {runLabel(r)}
              </option>
            ))}
          </select>
        </label>
        <button type="submit">Compare</button>
      </form>

      {data === null ? (
        <p style={{ margin: "12px 0 0", fontSize: 13, color: "var(--color-text-secondary)" }}>
          Pick two different runs to compare.
        </p>
      ) : (
        <DiffResult data={data} />
      )}

      {mismatches.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <MismatchList mismatches={mismatches} />
        </div>
      )}
    </section>
  );
}

function DiffResult({ data }: { data: RunDiffData }) {
  const { diff, names, spans } = data;
  return (
    <div style={{ marginTop: 12 }}>
      <p style={{ margin: "0 0 10px", fontSize: 13 }}>
        {diff.added} shifts added, {diff.removed} removed, {diff.moved} moved between rotation
        weeks. {diff.unchanged} students unchanged.
      </p>
      {diff.students.length === 0 ? (
        <p style={{ margin: 0, fontSize: 13, color: "var(--color-text-secondary)" }}>
          The two runs hold the same schedule.
        </p>
      ) : (
        diff.students.map((s) => (
          <StudentDiffRow key={s.email} s={s} name={names.get(s.email) ?? s.email} spans={spans} />
        ))
      )}
    </div>
  );
}

function StudentDiffRow({
  s,
  name,
  spans,
}: {
  s: StudentRunDiff;
  name: string;
  spans: Map<string, { start: number; end: number }>;
}) {
  const rollup = [
    delta("hours", s.before?.assignedMinutes ?? null, s.after?.assignedMinutes ?? null, (m) =>
      hoursLabel(m),
    ),
    delta("days", s.before?.daysUsed ?? null, s.after?.daysUsed ?? null, String),
    rotationDelta(s.before?.cohort ?? null, s.after?.cohort ?? null),
  ].filter((part): part is string => part !== null);

  return (
    <details style={{ marginBottom: 6 }}>
      <summary style={{ cursor: "pointer", fontSize: 13 }}>
        <strong>{name}</strong>
        {s.before === null && s.after !== null && " (new in this run)"}
        {s.after === null && s.before !== null && " (not in this run)"}
        {rollup.length > 0 && ` ${rollup.join(", ")}`}
        {s.changes.length > 0 &&
          ` (${s.changes.length} ${s.changes.length === 1 ? "change" : "changes"})`}
      </summary>
      <ul style={{ margin: "6px 0 8px", paddingLeft: 26, fontSize: 13 }}>
        {s.changes.map((c) => {
          const span = spans.get(c.blockId);
          const time = span ? formatSpan(span.start, span.end) : c.blockId;
          const rotation = c.cohort !== "weekday" ? ` (${ROTATION_LABEL[c.cohort]})` : "";
          return (
            <li key={`${c.kind}|${c.blockId}|${c.day}`}>
              {c.kind === "added" && `Added ${DAY_LABEL[c.day]} ${time}${rotation}`}
              {c.kind === "removed" && `Removed ${DAY_LABEL[c.day]} ${time}${rotation}`}
              {c.kind === "moved" &&
                `Moved ${DAY_LABEL[c.day]} ${time} from ${ROTATION_LABEL[c.fromCohort!]} to ${ROTATION_LABEL[c.cohort]}`}
              {c.source === "manual" && " [manual]"}
            </li>
          );
        })}
        {s.changes.length === 0 && (
          <li style={{ color: "var(--color-text-secondary)" }}>No shift changes.</li>
        )}
      </ul>
    </details>
  );
}

/** "10 to 12.5 hours" when the value changed, null when it did not. */
function delta(
  label: string,
  before: number | null,
  after: number | null,
  fmt: (n: number) => string,
): string | null {
  if (before === null || after === null) return null;
  const from = fmt(before);
  const to = fmt(after);
  // Compare the labels, not the raw minutes, so a change smaller than the
  // rounding never renders as "12.5 to 12.5 hours".
  if (from === to) return null;
  return `${from} to ${to} ${label}`;
}

function rotationDelta(before: Cohort | null, after: Cohort | null): string | null {
  if (before === after || before === null || after === null) return null;
  return `${ROTATION_LABEL[before]} to ${ROTATION_LABEL[after]}`;
}

function MismatchList({ mismatches }: { mismatches: FrozenMismatchView[] }) {
  return (
    <div>
      <SectionLabel>Kept shifts outside current picks</SectionLabel>
      <p style={{ margin: "0 0 8px", fontSize: 13, color: "var(--color-text-secondary)" }}>
        These students are marked scheduled, so their shifts were kept, but they have since changed
        their availability and no longer pick these cells.
      </p>
      <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13 }}>
        {mismatches.map((m) => (
          <li key={m.email}>
            <Link href={`/admin/students/${encodeURIComponent(m.email)}`}>{m.displayName}</Link>
            {": "}
            {m.cells.map((c) => `${DAY_LABEL[c.day]} ${formatSpan(c.start, c.end)}`).join(", ")}
          </li>
        ))}
      </ul>
    </div>
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

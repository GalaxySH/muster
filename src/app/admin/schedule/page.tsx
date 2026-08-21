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
  formatDayLabel,
  keptTagStyle,
  manualTagStyle,
  panelStyle,
  successPillStyle,
} from "@/components/admin/ui";
import { FROZEN_LABEL } from "@/components/admin/schedule-ui";
import { GenerateScheduleButton } from "@/components/admin/GenerateScheduleButton";
import { ScheduleHealth } from "@/components/admin/ScheduleHealth";
import { PinRunButton } from "@/components/admin/PinRunButton";
import { RestoreRunButton } from "@/components/admin/RestoreRunButton";
import { SaveRunButton } from "@/components/admin/SaveRunButton";
import { ScheduleParamsForm } from "@/components/admin/ScheduleParamsForm";
import { ScheduleStudentTable } from "@/components/admin/ScheduleStudentTable";
import { SheetControls } from "@/components/admin/SheetControls";
import { SlotCell } from "@/components/admin/SlotCell";
import { getSchedulingParams } from "@/lib/settings";
import { rebuildScheduleSheet } from "@/lib/schedule/actions";
import {
  listScheduleRuns,
  loadCoverage,
  loadCurrentSchedule,
  loadFrozenMismatches,
  loadRunDiff,
  loadScheduleStaleness,
  loadScopeLedger,
  type CurrentSchedule,
  type FrozenMismatchView,
  type PositionCoverage,
  type PositionLedgerRow,
  type RunDiffData,
  type ScheduleRunListItem,
} from "@/lib/schedule/data";
import {
  laborFindingSections,
  type LaborFindingSection,
  type LaborFindingView,
} from "@/lib/domain/scheduling/run-warnings";
import { isReadableRunStats } from "@/lib/admin/schedule-health-view";
import { getLastSheetSync, getSheetUrl, SCHEDULE_SHEET } from "@/lib/admin/sheet-sync";
import { getCurrentPlan } from "@/lib/w2w/plan-data";
import {
  assignedCellCount,
  coverageStatus,
  summarizeAssignedCoverage,
  type CoverageRow,
  type CoverageStatus,
  type CoverageSummary,
} from "@/lib/domain/scheduling/coverage";
import { SHIFT_LEAD_POSITION_ID } from "@/lib/domain/close-claims";
import { demandCellKey } from "@/lib/domain/demand";
import { hoursLabel } from "@/lib/domain/config-validation";
import { stalenessMessage, type StudentRunDiff } from "@/lib/domain/scheduling/diff";
import { storedSchedulingParams } from "@/lib/domain/scheduling/params";
import type { ProblemGroup } from "@/lib/domain/scheduling/problems";
import type { Cohort, LateStartWarning } from "@/lib/domain/scheduling/types";
import { formatSpan } from "@/lib/domain/time";
import { DAY_LABEL, type DayType } from "@/lib/domain/types";

/** Counts move with every submission and run; never serve a cached page. */
export const dynamic = "force-dynamic";

/**
 * Admin: schedule coverage and the recommended schedule (roadmap 5.1;
 * docs/schedule-generation-plan.md Phases A to C). The coverage grid has two
 * modes: availability counts the submitted students who could work each (block
 * × day) cell, scheduled counts the seats the current run put in it, graded
 * against the targets with supply in the cell tooltip. Before any run exists
 * only availability is possible; afterwards `?grid=` switches between them and
 * scheduled is the default. Below the grids: every student's recommended
 * shifts, the run history with restore, the run diff picker, and the Muster
 * Schedule sheet.
 */
export default async function AdminSchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ before?: string; after?: string; grid?: string }>;
}) {
  const session = await getAppSession();
  if (!session) redirect("/signin?callbackUrl=/admin/schedule");
  if (!session.isAdmin) redirect("/me");

  const [sp, coverage, schedule, params, runs, sheetUrl, sheetSyncedAt, mismatches, plan, ledger] =
    await Promise.all([
      searchParams,
      loadCoverage(),
      loadCurrentSchedule(),
      getSchedulingParams(),
      listScheduleRuns(),
      getSheetUrl(SCHEDULE_SHEET),
      getLastSheetSync(SCHEDULE_SHEET),
      loadFrozenMismatches(),
      getCurrentPlan(),
      loadScopeLedger(),
    ]);
  const scopePositions = coverage.map((c) => ({ id: c.positionId, name: c.positionName }));
  const positionNames = new Map(scopePositions.map((p) => [p.id, p.name]));
  const hasPlan = plan !== null;
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
  // Which grid the reader asked for. With no run there is nothing to show but
  // availability, so the param is ignored rather than offering an empty grid;
  // with one, scheduled stays the default the way it was before the toggle.
  const gridMode: GridMode = !schedule
    ? "availability"
    : sp.grid === "availability"
      ? "availability"
      : "scheduled";
  // The grids and their two tiles read THIS, so availability mode falls into the
  // same null branches the page took before any run existed. Everything else on
  // the page keeps the real run.
  const gridSchedule = gridMode === "scheduled" ? schedule : null;
  const summaryOf = (p: PositionCoverage): CoverageSummary =>
    gridSchedule ? summarizeAssignedCoverage(p.rows, gridSchedule.assignedCells) : p.summary;
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
        {gridMode === "scheduled"
          ? "Each cell shows how many students the current schedule puts on that shift, against the target staffing where one is set. Click a cell to see everyone who could work it. Weekend cells show both rotation weeks as A·B."
          : "Each cell counts the submitted students who could work that shift on that day, next to the target staffing where one is set. Click a cell to see who they are. Set targets per block on the Positions and shift blocks page."}
      </p>
      <p style={{ fontSize: 14, marginTop: -6 }}>
        <Link href="/admin/schedule/plan">W2W shift plan</Link>: import the shift budget from W2W
        and export the filled schedule back.
      </p>

      <SchedulePanel
        schedule={schedule}
        responders={totals.responders}
        staleLine={staleLine}
        sheetUrl={sheetUrl}
        sheetSyncedAt={sheetSyncedAt}
        hasPlan={hasPlan}
        positions={scopePositions}
      />
      <ScopeLedgerPanel ledger={ledger} />
      <ScheduleHealthSection schedule={schedule} positionNames={positionNames} />

      <section style={{ ...panelStyle, marginTop: 14, maxWidth: 720 }}>
        <SectionLabel>Generation settings</SectionLabel>
        {/* Shift Lead is not offered in the cross-coverage pool: the statistics
            drop the lead id from it and measure new leads on their own floor,
            so a ticked box there would look like a setting and do nothing. */}
        <ScheduleParamsForm
          initial={params}
          positions={scopePositions.filter((p) => p.id !== SHIFT_LEAD_POSITION_ID)}
        />
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
        {/* Only worth offering once a run exists: before that there is one grid.
            The four status chips below apply to both modes and never move. */}
        {schedule && (
          <span style={{ marginRight: 10 }}>
            <GridModeLink mode="scheduled" active={gridMode} before={sp.before} after={sp.after} />{" "}
            <GridModeLink
              mode="availability"
              active={gridMode}
              before={sp.before}
              after={sp.after}
            />
          </span>
        )}
        <span style={{ ...legendChip, ...statusStyles.ok }}>meets target</span>{" "}
        <span style={{ ...legendChip, ...statusStyles.short }}>short</span>{" "}
        <span style={{ ...legendChip, ...statusStyles.severe }}>under half</span>{" "}
        <span style={legendChip}>no target</span>
      </p>

      {coverage.map((p) => (
        <PositionSection
          key={p.positionId}
          coverage={p}
          schedule={gridSchedule}
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
          grid={gridMode}
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

/** Which numbers the coverage grids show: the run's seats, or who could work. */
type GridMode = "scheduled" | "availability";

const GRID_MODE_LABEL: Record<GridMode, string> = {
  scheduled: "Scheduled",
  availability: "Availability",
};

/**
 * One half of the grid switch. The diff picker's own params ride along, so
 * switching grids does not throw away the pair of runs being compared.
 */
function GridModeLink({
  mode,
  active,
  before,
  after,
}: {
  mode: GridMode;
  active: GridMode;
  before?: string;
  after?: string;
}) {
  const params = new URLSearchParams();
  if (before) params.set("before", before);
  if (after) params.set("after", after);
  params.set("grid", mode);
  return (
    <Link
      href={`/admin/schedule?${params.toString()}`}
      style={mode === active ? activeLegendChip : legendChip}
    >
      {GRID_MODE_LABEL[mode]}
    </Link>
  );
}

function SchedulePanel({
  schedule,
  responders,
  staleLine,
  sheetUrl,
  sheetSyncedAt,
  hasPlan,
  positions,
}: {
  schedule: CurrentSchedule | null;
  responders: number;
  staleLine: string | null;
  sheetUrl: string | null;
  sheetSyncedAt: Date | null;
  hasPlan: boolean;
  positions: { id: string; name: string }[];
}) {
  if (!schedule) {
    return (
      <section style={{ ...panelStyle, marginTop: 14, maxWidth: 720 }}>
        <SectionLabel>Recommended schedule</SectionLabel>
        <p style={{ margin: "0 0 10px", fontSize: 13, color: "var(--color-text-secondary)" }}>
          No schedule has been generated yet. Responses are placed in the order they came in, later
          shifts first.
        </p>
        <GenerateScheduleButton hasRun={false} hasPlan={hasPlan} positions={positions} />
      </section>
    );
  }

  const { report, problems } = schedule;
  // Split on what the run itself recorded, so a fill-in who submits later still
  // reads as one here rather than being folded in with the responders.
  const worked = report.students.filter((s) => s.assignedMinutes > 0);
  const placed = worked.filter((s) => !s.fillIn).length;
  const withoutResponse = worked.filter((s) => s.fillIn).length;
  // The engine reports one `frozen` flag for three different reasons; the read
  // layer has already split them (see FrozenReason), so count off that rather
  // than subtracting the repair count out of the total.
  const frozen = schedule.students.filter((s) => s.frozenReason === "marked").length;
  const outOfScope = schedule.students.filter((s) => s.frozenReason === "out-of-scope").length;
  const planKept = schedule.students.filter((s) => s.frozenReason === "kept").length;
  const nameByEmail = new Map(schedule.students.map((s) => [s.email, s.displayName]));
  // Backfilled, so a run stored before the labor knobs existed shows the values
  // it is now judged against rather than a line full of blanks.
  const knobs = report.params ? storedSchedulingParams(report.params) : null;
  const scopeNames = schedule.scope
    ? positions
        .filter((p) => schedule.scope!.positionIds.includes(p.id))
        .map((p) => p.name)
        .join(", ")
    : null;

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
        {/* Says "not changed", not "kept their shifts": on the first run of a
            cycle the out-of-scope students have no shifts yet to keep. */}
        {outOfScope > 0 &&
          ` This update only covered ${scopeNames}, so ${outOfScope} people in other positions were not changed.`}
        {planKept > 0 &&
          ` ${planKept} kept in place from the imported W2W plan (this run only; a plain update re-solves them).`}
        {report.returners &&
          ` ${report.returners.count} returners were placed before new students.`}
        {report.anneal &&
          ` The optimizer filled ${report.anneal.gainedSeats} more seats, over ` +
            `${report.anneal.iterations.toLocaleString("en-US")} rounds with seed ${report.anneal.seed}.`}
        {report.anneal !== undefined &&
          report.anneal.trimmedStudents > 0 &&
          ` ${report.anneal.trimmedStudents} people had hours above their target trimmed back.`}
        {knobs &&
          ` Used max ${knobs.dayCapHours}h per day, night priority ${knobs.nightPriority}, evening ${knobs.eveningPriority}, rest ${knobs.minRestHours}h/${knobs.preferredRestHours}h, days ${knobs.preferredDaysPerWeek}/${knobs.maxDaysPerWeek}, run cap ${knobs.maxConsecutiveDays}.`}
      </p>
      {/* Without hire dates everyone counts as a new student, so the ordering
          quietly becomes plain first come first served. Say so. */}
      {report.returners && report.returners.unknownHireDate > 0 && (
        <div style={{ ...bannerStyle, marginBottom: 10 }}>
          {report.returners.unknownHireDate} people have no start date on the roster, so they were
          scheduled as new students. Re-import the roster from the PCPL workbook to fix this.
        </div>
      )}
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
      <LateStartWarnings
        lateStarts={report.lateStarts ?? []}
        nameOf={(email) => nameByEmail.get(email) ?? email}
      />
      <LaborFindings findings={schedule.laborFindings} />
      {staleLine && <div style={{ ...bannerStyle, marginBottom: 10 }}>{staleLine}</div>}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <GenerateScheduleButton hasRun hasPlan={hasPlan} positions={positions} />
        <SaveRunButton />
      </div>
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

/**
 * The run's stored health figures. A run generated before stats existed has
 * none of its own, and so does one stamped under a snapshot version this build
 * cannot read (a rollback meeting a newer run). Both take the same quiet line:
 * regenerating is how the admin gets the section back, and neither is allowed
 * to take the rest of the page down.
 */
function ScheduleHealthSection({
  schedule,
  positionNames,
}: {
  schedule: CurrentSchedule | null;
  positionNames: ReadonlyMap<string, string>;
}) {
  if (!schedule) return null;
  if (!isReadableRunStats(schedule.report.stats)) {
    return (
      <p style={{ margin: "10px 0 0", fontSize: 13, color: "var(--color-text-secondary)" }}>
        Update the schedule to see health statistics.
      </p>
    );
  }
  return <ScheduleHealth stats={schedule.report.stats} positionNames={positionNames} />;
}

/**
 * Which positions have been updated recently and what has changed under them
 * since. Only worth showing once a scoped run exists: with whole-roster updates
 * every line says the same thing, so it would be noise.
 */
function ScopeLedgerPanel({ ledger }: { ledger: PositionLedgerRow[] }) {
  const behind = ledger.filter((r) => r.newSubmissions > 0 || r.edited > 0);
  const anyScoped = new Set(ledger.map((r) => r.lastSolvedAt?.getTime() ?? 0)).size > 1;
  if (!anyScoped && behind.length === 0) return null;

  return (
    <section style={{ ...panelStyle, marginTop: 14, maxWidth: 720 }}>
      <SectionLabel>Updated by position</SectionLabel>
      <table style={{ borderCollapse: "collapse", fontSize: 13, width: "100%" }}>
        <thead>
          <tr>
            <th style={{ ...cellTh, textAlign: "left" }}>Position</th>
            <th style={{ ...cellTh, textAlign: "left" }}>Last updated</th>
            <th style={cellTh}>Changed since</th>
          </tr>
        </thead>
        <tbody>
          {ledger.map((row) => (
            <tr key={row.positionId}>
              <td style={{ ...cellTd, textAlign: "left" }}>{row.positionName}</td>
              <td style={{ ...cellTd, textAlign: "left", color: "var(--color-text-secondary)" }}>
                {row.lastSolvedAt ? row.lastSolvedAt.toLocaleString("en-US") : "Never"}
              </td>
              <td
                style={{
                  ...cellTd,
                  color:
                    row.newSubmissions + row.edited > 0
                      ? "var(--color-text-warning)"
                      : "var(--color-text-secondary)",
                }}
              >
                {changedLabel(row)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** "3 new, 1 edited", or "Nothing" when the slice is up to date. */
function changedLabel(row: PositionLedgerRow): string {
  const parts: string[] = [];
  if (row.newSubmissions > 0) parts.push(`${row.newSubmissions} new`);
  if (row.edited > 0) parts.push(`${row.edited} edited`);
  return parts.length > 0 ? parts.join(", ") : "Nothing";
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

/**
 * Students hired after their position's shifts resume. The engine is dateless,
 * so their generated week is a template the scheduler has to trim by hand.
 */
function LateStartWarnings({
  lateStarts,
  nameOf,
}: {
  lateStarts: LateStartWarning[];
  nameOf: (email: string) => string;
}) {
  if (lateStarts.length === 0) return null;
  const n = lateStarts.length;
  return (
    <div style={{ margin: "0 0 10px", fontSize: 13, color: "var(--color-text-warning)" }}>
      <details>
        <summary style={{ cursor: "pointer" }}>
          {n} {n === 1 ? "student starts" : "students start"} after the schedule begins.
        </summary>
        <p style={{ margin: "4px 0 0" }}>Edit their shifts by hand in W2W.</p>
        <ul style={{ margin: "4px 0 8px", paddingLeft: 24 }}>
          {lateStarts.map((w) => (
            <li key={w.email}>
              <Link href={`/admin/students/${encodeURIComponent(w.email)}`}>{nameOf(w.email)}</Link>{" "}
              starts {formatDayLabel(w.hiredOn)}, after shifts resume{" "}
              {formatDayLabel(w.expectedStart)}.
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

/** Hard labor rule breaks first, then the soft preferences. */
function laborSectionLabel(section: LaborFindingSection): string {
  const n = section.students;
  return section.severity === "hard"
    ? `${n} ${n === 1 ? "student breaks" : "students break"} a labor rule`
    : `${n} ${n === 1 ? "student is" : "students are"} outside a preferred limit`;
}

/**
 * The read-time validator's verdicts on the run as it stands now, hand edits
 * included (`domain/scheduling/validate.ts`).
 */
function LaborFindings({ findings }: { findings: LaborFindingView[] }) {
  const sections = laborFindingSections(findings);
  if (sections.length === 0) return null;
  const lines = sections.flatMap((s) => s.lines);
  const anyFrozen = lines.some((l) => l.frozenReason !== null);
  const anyManual = lines.some((l) => l.involvesManual);
  return (
    <div style={{ margin: "0 0 10px", fontSize: 13 }}>
      {sections.map((section) => (
        <details
          key={section.severity}
          style={{
            margin: "0 0 4px",
            color:
              section.severity === "hard"
                ? "var(--color-text-danger)"
                : "var(--color-text-warning)",
          }}
        >
          <summary style={{ cursor: "pointer" }}>{laborSectionLabel(section)}.</summary>
          <ul style={{ margin: "4px 0 8px", paddingLeft: 24 }}>
            {section.lines.map((line, i) => (
              <li key={`${line.email}|${i}`}>
                <Link href={`/admin/students/${encodeURIComponent(line.email)}`}>
                  {line.displayName}
                </Link>
                {": "}
                {line.message}
                {line.frozenReason && (
                  <span style={keptTagStyle}>{FROZEN_LABEL[line.frozenReason]}</span>
                )}
                {line.involvesManual && <span style={manualTagStyle}>manual</span>}
              </li>
            ))}
          </ul>
        </details>
      ))}
      {(anyFrozen || anyManual) && (
        <p style={{ margin: "0 0 4px", color: "var(--color-text-secondary)" }}>
          {anyFrozen && anyManual
            ? "Kept and hand-edited shifts are included."
            : anyFrozen
              ? "Kept shifts are included."
              : "Hand-edited shifts are included."}
        </p>
      )}
    </div>
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
        replaced run stays here. Pinned runs are kept regardless of age.
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
              <th style={cellTh}>Below min</th>
              <th style={{ ...cellTh, textAlign: "left" }}>Restored</th>
              <th style={{ ...cellTh, textAlign: "left" }}>Pinned</th>
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
                {/* Runs stored before the counter existed have nothing to show. */}
                <td style={cellTd}>{r.belowMinHours ?? "-"}</td>
                <td style={{ ...cellTd, textAlign: "left", whiteSpace: "nowrap" }}>
                  {r.restoredAt ? `${fmtRunTime(r.restoredAt)} by ${r.restoredBy}` : "-"}
                </td>
                <td style={{ ...cellTd, textAlign: "left" }}>
                  <PinRunButton runId={r.id} pinned={r.pinned} />
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
  grid,
  data,
  mismatches,
}: {
  runs: ScheduleRunListItem[];
  beforeId: string;
  afterId: string;
  /** The grid mode in force, so comparing runs does not switch grids underneath. */
  grid: GridMode;
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
        {/* A GET form submits its own fields and nothing else, so without this
            the two selects would wipe ?grid= and bounce the reader back to the
            scheduled grid. GridModeLink carries the run pair the other way;
            this is the same preservation in the other direction. Only the
            non-default mode needs saying. */}
        {grid === "availability" && <input type="hidden" name="grid" value="availability" />}
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
        const counts = schedule?.assignedCells.get(demandCellKey(row.blockId, cell.day));
        const assigned = schedule ? assignedCellCount(row.dayType, counts) : 0;
        const status = schedule ? coverageStatus(assigned, cell.target) : cell.status;
        const shown = !schedule
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
            style={{ ...cellTd, ...statusStyles[status] }}
          >
            {shown}
            {cell.target !== null && <span style={{ opacity: 0.65 }}>/{cell.target}</span>}
          </SlotCell>
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
  color: "inherit",
  textDecoration: "none",
};

/** The grid mode currently on screen: filled, so the pair reads as one switch. */
const activeLegendChip: React.CSSProperties = {
  ...legendChip,
  background: "var(--color-background-info)",
  color: "var(--color-text-info)",
  fontWeight: 600,
};

import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getAppSession } from "@/lib/auth/session";
import { AdminPage } from "@/components/admin/AdminPage";
import {
  ButtonLink,
  Disclosure,
  Notice,
  PageSettings,
  Panel,
  Pill,
  Stat,
  StatStrip,
  Status,
  formatDayLabel,
} from "@/components/admin/ui";
import { FROZEN_LABEL } from "@/components/admin/schedule-ui";
import { GenerateScheduleButton } from "@/components/admin/GenerateScheduleButton";
import { ScheduleHealth } from "@/components/admin/ScheduleHealth";
import { PinRunButton } from "@/components/admin/PinRunButton";
import { RestoreRunButton } from "@/components/admin/RestoreRunButton";
import { SaveRunButton } from "@/components/admin/SaveRunButton";
import { ClearScheduleButton } from "@/components/admin/ClearScheduleButton";
import { ScheduleParamsForm } from "@/components/admin/ScheduleParamsForm";
import { ScheduleStudentTable } from "@/components/admin/ScheduleStudentTable";
import { SheetControls } from "@/components/admin/SheetControls";
import { CoverageGrid, CoverageLegend } from "@/components/admin/CoverageGrid";
import { getSchedulingParams } from "@/lib/settings";
import { workingTermId } from "@/lib/terms/working";
import { rebuildScheduleSheet } from "@/lib/schedule/actions";
import {
  countScheduledMarks,
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
} from "@/lib/domain/scheduling/run-warnings";
import { isReadableRunStats } from "@/lib/admin/schedule-health-view";
import { getLastSheetSync, getSheetUrl, SCHEDULE_SHEET } from "@/lib/admin/sheet-sync";
import { getCurrentPlan } from "@/lib/w2w/plan-data";
import { summarizeAssignedCoverage, type CoverageSummary } from "@/lib/domain/scheduling/coverage";
import { hoursLabel } from "@/lib/domain/config-validation";
import { stalenessMessage, type StudentRunDiff } from "@/lib/domain/scheduling/diff";
import { storedSchedulingParams } from "@/lib/domain/scheduling/params";
import type { ProblemGroup } from "@/lib/domain/scheduling/problems";
import type { Cohort, LateStartWarning } from "@/lib/domain/scheduling/types";
import { formatSpan } from "@/lib/domain/time";
import { DAY_LABEL } from "@/lib/domain/types";

export const metadata: Metadata = { title: "Schedule" };

/** Counts move with every submission and run; never serve a cached page. */
export const dynamic = "force-dynamic";

/**
 * Admin: schedule coverage and the recommended schedule (roadmap 5.1;
 * docs/schedule-generation-plan.md Phases A to C). The coverage grid has two
 * modes: availability counts the submitted students who could work each (block
 * × day) cell, scheduled counts the seats the current run put in it, graded
 * against the targets with supply in the cell tooltip. Before any run exists
 * only availability is possible; afterwards `?grid=` switches between them and
 * scheduled is the default.
 *
 * Top to bottom: the run and its actions, what is wrong with it, the three
 * figures, the grids, every student's recommended shifts. The generation
 * settings, the per-position ledger, the run history with restore and the run
 * diff picker sit closed under those.
 */
export default async function AdminSchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ before?: string; after?: string; grid?: string }>;
}) {
  const session = await getAppSession();
  if (!session) redirect("/signin?callbackUrl=/admin/schedule");
  if (!session.isAdmin) redirect("/me");

  const termId = await workingTermId();
  const [
    sp,
    coverage,
    schedule,
    params,
    runs,
    sheetUrl,
    sheetSyncedAt,
    mismatches,
    plan,
    ledger,
    markedScheduled,
  ] = await Promise.all([
    searchParams,
    loadCoverage(),
    loadCurrentSchedule(termId),
    getSchedulingParams(termId),
    listScheduleRuns(),
    getSheetUrl(SCHEDULE_SHEET, termId),
    getLastSheetSync(SCHEDULE_SHEET, termId),
    loadFrozenMismatches(),
    getCurrentPlan(termId),
    loadScopeLedger(),
    countScheduledMarks(),
  ]);
  const scopePositions = coverage.map((c) => ({ id: c.positionId, name: c.positionName }));
  // The positions whose holders pick weekend closes: Shift Lead, by flag.
  const leadPositionIds = coverage.filter((c) => c.picksCloses).map((c) => c.positionId);
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
    <AdminPage
      title="Schedule"
      description={
        gridMode === "scheduled"
          ? "Each cell shows how many students the current schedule puts on that shift, against the target staffing where one is set."
          : "Each cell counts the submitted students who could work that shift on that day, next to the target staffing where one is set."
      }
      actions={<ButtonLink href="/admin/schedule/plan">W2W shift plan</ButtonLink>}
    >
      <div className="ad-stack">
        <Disclosure panel={false} title="About this page">
          <div className="ad-sc-prose ad-muted">
            <p>
              {gridMode === "scheduled"
                ? "Each cell shows how many students the current schedule puts on that shift, against the target staffing where one is set. Click a cell to see everyone who could work it. Weekend cells show both rotation weeks as A·B."
                : "Each cell counts the submitted students who could work that shift on that day, next to the target staffing where one is set. Click a cell to see who they are. Set targets per block on the Positions and shifts page."}
            </p>
            <p>
              <Link href="/admin/schedule/plan">W2W shift plan</Link>: import the shift budget from
              W2W and export the filled schedule back.
            </p>
          </div>
        </Disclosure>

        <SchedulePanel
          schedule={schedule}
          responders={totals.responders}
          staleLine={staleLine}
          sheetUrl={sheetUrl}
          sheetSyncedAt={sheetSyncedAt}
          hasPlan={hasPlan}
          positions={scopePositions}
          runs={runs}
          markedScheduled={markedScheduled}
        />
        {mismatches.length > 0 && <MismatchList mismatches={mismatches} />}

        <PageSettings
          summary={`Max ${params.dayCapHours}h a day, ${params.minRestHours}h rest, up to ${params.maxDaysPerWeek} days a week`}
        >
          <div className="ad-stack">
            <h2>Generation settings</h2>
            {/* Shift Lead is not offered in the cross-coverage pool: the statistics
                drop the lead id from it and measure new leads on their own floor,
                so a ticked box there would look like a setting and do nothing. */}
            <ScheduleParamsForm
              initial={params}
              positions={scopePositions.filter((p) => !leadPositionIds.includes(p.id))}
              leadPositionIds={leadPositionIds}
            />
            <p className="ad-help">
              Target staffing is set per block on{" "}
              <Link href="/admin/positions">Positions and shifts</Link>.
            </p>
          </div>
        </PageSettings>

        <ScheduleHealthSection schedule={schedule} positionNames={positionNames} />

        <StatStrip>
          <Stat
            label="Responses in"
            value={totals.responders}
            sub={`of ${totals.roster} on the roster`}
          />
          <Stat
            label="Cells with a target"
            value={totals.targetedCells}
            sub={totals.targetedCells === 0 ? "no targets set yet" : undefined}
            subTone={totals.targetedCells === 0 ? "warning" : undefined}
          />
          <Stat
            label="Cells short"
            value={totals.shortCells}
            sub={totals.missing > 0 ? `${totals.missing} people missing in total` : undefined}
            subTone={totals.shortCells > 0 ? "danger" : undefined}
          />
        </StatStrip>

        <div className="ad-sc-gridbar">
          {/* Only worth offering once a run exists: before that there is one grid.
              The four status chips beside it apply to both modes and never move. */}
          {schedule && (
            <span className="ad-seg" role="group" aria-label="Grid numbers">
              <GridModeLink
                mode="scheduled"
                active={gridMode}
                before={sp.before}
                after={sp.after}
              />
              <GridModeLink
                mode="availability"
                active={gridMode}
                before={sp.before}
                after={sp.after}
              />
            </span>
          )}
          <span className="ad-sc-legend">
            <CoverageLegend />
          </span>
          {coverage.length > 1 && (
            <nav className="ad-sc-jump" aria-label="Positions">
              {coverage.map((p) => (
                <a key={p.positionId} href={`#${positionAnchor(p.positionId)}`}>
                  {p.positionName}
                </a>
              ))}
            </nav>
          )}
        </div>

        <div className="ad-sc-grids">
          {coverage.map((p) => (
            <PositionSection
              key={p.positionId}
              coverage={p}
              schedule={gridSchedule}
              summary={summaryOf(p)}
            />
          ))}
        </div>

        {schedule && (
          <Panel flush title="Students">
            <ScheduleStudentTable students={schedule.students} />
          </Panel>
        )}

        <ScopeLedgerPanel ledger={ledger} />

        {runs.length > 0 && <RunHistorySection runs={runs} />}

        {runs.length > 1 && beforeId && afterId && (
          <DiffSection
            runs={runs}
            beforeId={beforeId}
            afterId={afterId}
            grid={gridMode}
            data={diffData}
            open={Boolean(sp.before || sp.after)}
          />
        )}
      </div>
    </AdminPage>
  );
}

/** Which numbers the coverage grids show: the run's seats, or who could work. */
type GridMode = "scheduled" | "availability";

const GRID_MODE_LABEL: Record<GridMode, string> = {
  scheduled: "Scheduled",
  availability: "Availability",
};

/** The id a position's grid panel carries, for the jump links above the grids. */
const positionAnchor = (positionId: string) => `position-${encodeURIComponent(positionId)}`;

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
      aria-current={mode === active ? "true" : undefined}
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
  runs,
  markedScheduled,
}: {
  schedule: CurrentSchedule | null;
  responders: number;
  staleLine: string | null;
  sheetUrl: string | null;
  sheetSyncedAt: Date | null;
  hasPlan: boolean;
  positions: { id: string; name: string }[];
  runs: ScheduleRunListItem[];
  markedScheduled: number;
}) {
  const currentRun = runs.find((r) => r.status === "current");
  // Saving and clearing act on whatever run is current, so they sit with the
  // run. Both need a run to exist, as the history they used to head did.
  const keepActions = runs.length > 0 && (
    <>
      <SaveRunButton />
      {currentRun && <PinRunButton runId={currentRun.id} pinned={currentRun.pinned} current />}
      <ClearScheduleButton markedScheduled={markedScheduled} />
    </>
  );

  if (!schedule) {
    return (
      <Panel title="Recommended schedule">
        <div className="ad-stack">
          <p className="ad-sc-summary">
            No schedule has been generated yet. Responses are placed in the order they came in,
            later shifts first.
          </p>
          <div className="ad-sc-runbar">
            <GenerateScheduleButton hasRun={false} hasPlan={hasPlan} positions={positions} />
            {keepActions && <div className="ad-row">{keepActions}</div>}
          </div>
        </div>
      </Panel>
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
  const lateStarts = report.lateStarts ?? [];
  // The read-time validator's verdicts on the run as it stands now, hand edits
  // included (`domain/scheduling/validate.ts`).
  const laborSections = laborFindingSections(schedule.laborFindings);
  const hasProblems =
    problems.length > 0 ||
    report.droppedBlockGone > 0 ||
    lateStarts.length > 0 ||
    laborSections.length > 0;
  const hasBuildNotes = Boolean(report.returners || report.anneal || knobs);

  return (
    <Panel title="Recommended schedule">
      <div className="ad-stack">
        <div className="ad-sc-runbar">
          <GenerateScheduleButton hasRun hasPlan={hasPlan} positions={positions} />
          <div className="ad-row">
            <SheetControls
              sheetUrl={sheetUrl}
              lastSyncedAtMs={sheetSyncedAt ? sheetSyncedAt.getTime() : null}
              rebuild={rebuildScheduleSheet}
              leading={
                <a href="/admin/schedule/export" className="ad-btn">
                  Download CSV
                </a>
              }
            />
            {keepActions}
          </div>
        </div>

        <p className="ad-sc-summary">
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
        </p>

        {staleLine && <Notice tone="warning">{staleLine}</Notice>}
        {/* Without hire dates everyone counts as a new student, so the ordering
            quietly becomes plain first come first served. Say so. */}
        {report.returners && report.returners.unknownHireDate > 0 && (
          <Notice tone="warning">
            {report.returners.unknownHireDate} people have no start date on the roster, so they were
            scheduled as new students. Re-import the roster from the PCPL workbook to fix this.
          </Notice>
        )}
        {schedule.offRosterStudents > 0 && (
          <Notice tone="warning">
            {schedule.offRosterStudents === 1
              ? "1 student in this schedule has left the roster and is not shown."
              : `${schedule.offRosterStudents} students in this schedule have left the roster and are not shown.`}
          </Notice>
        )}

        {hasProblems && (
          <div>
            <ul className="ad-list-reset ad-sc-problems">
              {problems.map((group) => (
                <ProblemWarning key={group.kind} group={group} />
              ))}
              {report.droppedBlockGone > 0 && (
                <ProblemRow
                  tone="danger"
                  label={`${report.droppedBlockGone} kept shifts pointed at removed blocks and were dropped.`}
                />
              )}
              <LateStartWarnings
                lateStarts={lateStarts}
                nameOf={(email) => nameByEmail.get(email) ?? email}
              />
              <LaborFindings sections={laborSections} />
            </ul>
            <LaborFindingsNote sections={laborSections} />
          </div>
        )}

        {hasBuildNotes && (
          <Disclosure panel={false} title="How this run was built">
            <p className="ad-sc-summary">
              {report.returners &&
                `${report.returners.count} returners were placed before new students. `}
              {report.anneal &&
                `The optimizer filled ${report.anneal.gainedSeats} more seats, over ` +
                  `${report.anneal.iterations.toLocaleString("en-US")} rounds with seed ${report.anneal.seed}. `}
              {report.anneal !== undefined &&
                report.anneal.trimmedStudents > 0 &&
                `${report.anneal.trimmedStudents} people had hours above their target trimmed back. `}
              {knobs &&
                `Used max ${knobs.dayCapHours}h per day, night priority ${knobs.nightPriority}, evening ${knobs.eveningPriority}, rest ${knobs.minRestHours}h/${knobs.preferredRestHours}h, days ${knobs.preferredDaysPerWeek}/${knobs.maxDaysPerWeek}, run cap ${knobs.maxConsecutiveDays}.`}
            </p>
          </Disclosure>
        )}
      </div>
    </Panel>
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
    return <p className="ad-muted">Update the schedule to see health statistics.</p>;
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
    <Disclosure
      title="Updated by position"
      summary={behind.length > 0 ? `${behind.length} changed since` : undefined}
    >
      <table className="ad-table ad-table--stack">
        <thead>
          <tr>
            <th scope="col">Position</th>
            <th scope="col">Last updated</th>
            <th scope="col">Changed since</th>
          </tr>
        </thead>
        <tbody>
          {ledger.map((row) => (
            <tr key={row.positionId}>
              <td data-label="Position">{row.positionName}</td>
              <td data-label="Last updated" className="ad-muted">
                {row.lastSolvedAt ? row.lastSolvedAt.toLocaleString("en-US") : "Never"}
              </td>
              <td
                data-label="Changed since"
                className={
                  row.newSubmissions + row.edited > 0 ? "ad-warning-text ad-strong" : "ad-muted"
                }
              >
                {changedLabel(row)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Disclosure>
  );
}

/** "3 new, 1 edited", or "Nothing" when the slice is up to date. */
function changedLabel(row: PositionLedgerRow): string {
  const parts: string[] = [];
  if (row.newSubmissions > 0) parts.push(`${row.newSubmissions} new`);
  if (row.edited > 0) parts.push(`${row.edited} edited`);
  return parts.length > 0 ? parts.join(", ") : "Nothing";
}

/**
 * One problem with the run: a tinted row with a bar on its leading edge. With
 * children it opens in place to the people it is about.
 */
function ProblemRow({
  tone,
  label,
  children,
}: {
  tone: "danger" | "warning";
  label: React.ReactNode;
  children?: React.ReactNode;
}) {
  const status = <Status tone={tone}>{label}</Status>;
  return (
    <li
      className={
        tone === "danger"
          ? "ad-entry ad-entry--danger ad-sc-problem"
          : "ad-entry ad-entry--warning ad-sc-problem"
      }
    >
      {children ? (
        <Disclosure panel={false} title={status}>
          {children}
        </Disclosure>
      ) : (
        status
      )}
    </li>
  );
}

/** One warning line that expands to the affected students. */
function ProblemWarning({ group }: { group: ProblemGroup }) {
  return (
    <ProblemRow tone="danger" label={`${group.label}.`}>
      <ul className="ad-bullets ad-sc-people">
        {group.students.map((s) => (
          <li key={s.email}>
            <Link href={`/admin/students/${encodeURIComponent(s.email)}`}>{s.name}</Link>{" "}
            <span className="ad-muted">{s.email}</span>
          </li>
        ))}
      </ul>
    </ProblemRow>
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
    <ProblemRow
      tone="warning"
      label={`${n} ${n === 1 ? "student starts" : "students start"} after the schedule begins.`}
    >
      <p>Edit their shifts by hand in W2W.</p>
      <ul className="ad-bullets ad-sc-people">
        {lateStarts.map((w) => (
          <li key={w.email}>
            <Link href={`/admin/students/${encodeURIComponent(w.email)}`}>{nameOf(w.email)}</Link>{" "}
            starts {formatDayLabel(w.hiredOn)}, after shifts resume{" "}
            {formatDayLabel(w.expectedStart)}.
          </li>
        ))}
      </ul>
    </ProblemRow>
  );
}

/** Hard labor rule breaks first, then the soft preferences. */
function laborSectionLabel(section: LaborFindingSection): string {
  const n = section.students;
  return section.severity === "hard"
    ? `${n} ${n === 1 ? "student breaks" : "students break"} a labor rule`
    : `${n} ${n === 1 ? "student is" : "students are"} outside a preferred limit`;
}

/** One row per severity, each opening to its lines. */
function LaborFindings({ sections }: { sections: LaborFindingSection[] }) {
  return sections.map((section) => (
    <ProblemRow
      key={section.severity}
      tone={section.severity === "hard" ? "danger" : "warning"}
      label={`${laborSectionLabel(section)}.`}
    >
      <ul className="ad-bullets ad-sc-people">
        {section.lines.map((line, i) => (
          <li key={`${line.email}|${i}`}>
            <Link href={`/admin/students/${encodeURIComponent(line.email)}`}>
              {line.displayName}
            </Link>
            {": "}
            {line.message}
            {line.frozenReason && (
              <>
                {" "}
                <Pill>{FROZEN_LABEL[line.frozenReason]}</Pill>
              </>
            )}
            {line.involvesManual && (
              <>
                {" "}
                <Pill tone="manual">manual</Pill>
              </>
            )}
          </li>
        ))}
      </ul>
    </ProblemRow>
  ));
}

/** Says when the labor findings count kept or hand-edited shifts. */
function LaborFindingsNote({ sections }: { sections: LaborFindingSection[] }) {
  const lines = sections.flatMap((s) => s.lines);
  const anyFrozen = lines.some((l) => l.frozenReason !== null);
  const anyManual = lines.some((l) => l.involvesManual);
  if (!anyFrozen && !anyManual) return null;
  return (
    <p className="ad-help">
      {anyFrozen && anyManual
        ? "Kept and hand-edited shifts are included."
        : anyFrozen
          ? "Kept shifts are included."
          : "Hand-edited shifts are included."}
    </p>
  );
}

const ROTATION_LABEL: Record<Cohort, string> = {
  weekday: "",
  a: "week A",
  b: "week B",
  every: "every weekend",
};

/** Runs nothing solved. Tagged so their zeroed counts are not read as findings. */
const RUN_ORIGIN_LABEL = {
  cleared: "cleared",
  "w2w-plan": "from W2W plan",
} as const;

const fmtRunTime = (d: Date) =>
  d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

function RunHistorySection({ runs }: { runs: ScheduleRunListItem[] }) {
  return (
    <Disclosure
      title="Run history"
      summary={`${runs.length} ${runs.length === 1 ? "run" : "runs"}`}
    >
      <div className="ad-stack">
        <p className="ad-help">
          Every kept run, newest first. Restoring makes an earlier run the current schedule again;
          the replaced run stays here. Pinned runs are kept regardless of age.
        </p>
        <div className="ad-scroll-x">
          <table className="ad-table ad-table--stack ad-table--zebra ad-table--middle">
            <thead>
              <tr>
                <th scope="col">Generated</th>
                <th scope="col">By</th>
                <th scope="col" className="ad-num">
                  Assignments
                </th>
                <th scope="col" className="ad-num">
                  Students
                </th>
                <th scope="col" className="ad-num">
                  Short of hours
                </th>
                <th scope="col" className="ad-num">
                  Below min
                </th>
                <th scope="col">Restored</th>
                <th scope="col">Pinned</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id}>
                  <td data-label="Generated" className="ad-nowrap">
                    {fmtRunTime(r.generatedAt)}
                    {r.origin && (
                      <>
                        {" "}
                        <Pill tone="manual">{RUN_ORIGIN_LABEL[r.origin]}</Pill>
                      </>
                    )}
                  </td>
                  <td data-label="By">{r.generatedBy}</td>
                  <td data-label="Assignments" className="ad-num">
                    {r.assignments}
                  </td>
                  <td data-label="Students" className="ad-num">
                    {r.students}
                  </td>
                  <td data-label="Short of hours" className="ad-num">
                    {r.shortOfTarget}
                  </td>
                  {/* Runs stored before the counter existed have nothing to show. */}
                  <td data-label="Below min" className="ad-num">
                    {r.belowMinHours ?? "-"}
                  </td>
                  <td data-label="Restored" className="ad-nowrap">
                    {r.restoredAt ? `${fmtRunTime(r.restoredAt)} by ${r.restoredBy}` : "-"}
                  </td>
                  <td data-label="Pinned">
                    <PinRunButton runId={r.id} pinned={r.pinned} />
                  </td>
                  <td data-label="Status">
                    {r.status === "current" ? (
                      <Pill tone="success">current</Pill>
                    ) : (
                      <RestoreRunButton runId={r.id} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Disclosure>
  );
}

function DiffSection({
  runs,
  beforeId,
  afterId,
  grid,
  data,
  open,
}: {
  runs: ScheduleRunListItem[];
  beforeId: string;
  afterId: string;
  /** The grid mode in force, so comparing runs does not switch grids underneath. */
  grid: GridMode;
  data: RunDiffData | null;
  /** Open when the reader has picked a pair, so Compare lands on its result. */
  open: boolean;
}) {
  const runLabel = (r: ScheduleRunListItem) =>
    `${fmtRunTime(r.generatedAt)}${r.status === "current" ? " (current)" : ""}`;

  return (
    <Disclosure id="diff" title="Compare runs" open={open}>
      <div className="ad-stack">
        <form method="get" action="/admin/schedule#diff" className="ad-row">
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
          <button type="submit" className="ad-btn">
            Compare
          </button>
        </form>

        {data === null ? (
          <p className="ad-muted">Pick two different runs to compare.</p>
        ) : (
          <DiffResult data={data} />
        )}
      </div>
    </Disclosure>
  );
}

function DiffResult({ data }: { data: RunDiffData }) {
  const { diff, names, spans } = data;
  return (
    <div className="ad-stack ad-stack--tight">
      <p>
        {diff.added} shifts added, {diff.removed} removed, {diff.moved} moved between rotation
        weeks. {diff.unchanged} students unchanged.
      </p>
      {diff.students.length === 0 ? (
        <p className="ad-muted">The two runs hold the same schedule.</p>
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
    <Disclosure
      panel={false}
      title={
        <span className="ad-sc-inline">
          <strong>{name}</strong>
          {s.before === null && s.after !== null && " (new in this run)"}
          {s.after === null && s.before !== null && " (not in this run)"}
          {rollup.length > 0 && ` ${rollup.join(", ")}`}
          {s.changes.length > 0 &&
            ` (${s.changes.length} ${s.changes.length === 1 ? "change" : "changes"})`}
        </span>
      }
    >
      <ul className="ad-bullets ad-sc-people">
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
        {s.changes.length === 0 && <li className="ad-muted">No shift changes.</li>}
      </ul>
    </Disclosure>
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

/** Marked students whose kept shifts they no longer pick: a thing to notice. */
function MismatchList({ mismatches }: { mismatches: FrozenMismatchView[] }) {
  return (
    <Notice tone="warning" title="Kept shifts outside current picks">
      <p>
        These students are marked scheduled, so their shifts were kept, but they have since changed
        their availability and no longer pick these cells.
      </p>
      <ul className="ad-bullets ad-sc-people">
        {mismatches.map((m) => (
          <li key={m.email}>
            <Link href={`/admin/students/${encodeURIComponent(m.email)}`}>{m.displayName}</Link>
            {": "}
            {m.cells.map((c) => `${DAY_LABEL[c.day]} ${formatSpan(c.start, c.end)}`).join(", ")}
          </li>
        ))}
      </ul>
    </Notice>
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
  const { positionId, positionName, rosterCount, responders, rows } = coverage;

  return (
    <Panel
      id={positionAnchor(positionId)}
      className="ad-scroll-x"
      title={positionName}
      aside={
        <>
          <span>
            {responders} of {rosterCount} responded
          </span>
          {summary.missing > 0 && (
            <span className="ad-danger-text ad-strong">
              <Status tone="danger">
                {summary.missing} people short across {summary.shortCells} cell
                {summary.shortCells === 1 ? "" : "s"}
              </Status>
            </span>
          )}
        </>
      }
    >
      <CoverageGrid
        rows={rows}
        assignedCells={schedule?.assignedCells ?? null}
        positionName={positionName}
      />
    </Panel>
  );
}

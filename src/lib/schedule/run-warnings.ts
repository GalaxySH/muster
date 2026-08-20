/**
 * Pure derivations behind a run's warnings, kept out of the I/O in ./data.ts
 * and ./actions.ts.
 *
 * Two things live here. `lateStartWarnings` compares a student's hire date
 * against the day their position goes back to work, both as `yyyy-mm-dd`
 * strings. The two sides reach that form differently. `positions.return_date`
 * is stored as a string and stays one (see the schema comment), so never build
 * a Date from it. `students.hired_on` is a `date` column the driver hands back
 * as a Date pinned to LOCAL midnight, so its day is read with local getters
 * (`localDay`). The rest wires the independent validator
 * (domain/scheduling/validate.ts) to a stored run: assignment rows in,
 * display-ready findings out, and never a throw, since a run whose report or
 * blocks are unreadable must still render its page.
 */
import { storedSchedulingParams, type SchedulingParams } from "@/lib/domain/scheduling/params";
import {
  validateRunLabor,
  type StudentLaborFinding,
  type ValidatorLimits,
  type ValidatorRow,
} from "@/lib/domain/scheduling/validate";
import type {
  AssignmentSource,
  Cohort,
  EngineReport,
  LateStartWarning,
} from "@/lib/domain/scheduling/types";
import type { Day } from "@/lib/domain/types";

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * The `yyyy-mm-dd` of a Date read in the local frame. A `date` column comes
 * back from the driver as `new Date(y, m - 1, d)`, midnight local time, so the
 * local getters are the exact inverse of how it was built. `toISOString` would
 * read the UTC frame instead and land a day early anywhere east of UTC.
 */
export function localDay(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export interface LateStartInput {
  /** Every assignment row the run holds, including frozen and manual carries. */
  assignments: readonly { studentEmail: string }[];
  /** Hire date per student; null (or missing) means unknown. */
  hiredOn: ReadonlyMap<string, Date | null>;
  positionOf: ReadonlyMap<string, string | null>;
  /** `positions.return_date` per position id, already a `yyyy-mm-dd` string. */
  returnDateOf: ReadonlyMap<string, string | null>;
  /** The `yyyy-mm-dd` threshold for a position with no return date. */
  defaultStart: string;
}

/**
 * Students holding at least one row whose hire date lands after their position
 * has resumed. Ordered by email so a re-run of the same inputs stores the same
 * list. A student with no hire date is never flagged: unknown reads as "no
 * information", and the report's `unknownHireDate` count already tells the
 * admin how many of those the run had.
 */
export function lateStartWarnings(input: LateStartInput): LateStartWarning[] {
  const emails = [...new Set(input.assignments.map((a) => a.studentEmail))].sort();
  const warnings: LateStartWarning[] = [];
  for (const email of emails) {
    const hired = input.hiredOn.get(email);
    if (!hired) continue;
    const positionId = input.positionOf.get(email) ?? null;
    const expectedStart =
      (positionId === null ? null : input.returnDateOf.get(positionId)) ?? input.defaultStart;
    const hiredOn = localDay(hired);
    if (hiredOn > expectedStart) warnings.push({ email, hiredOn, expectedStart, positionId });
  }
  return warnings;
}

/** One of a run's assignment rows, joined to its block's times. */
export interface RunLaborRow {
  studentEmail: string;
  blockId: string;
  day: Day;
  cohort: Cohort;
  start: number;
  end: number;
  source: AssignmentSource;
}

/**
 * Why a frozen student did not move, split apart at read time so the engine
 * never has to know scoping exists. The engine reports one `frozen` boolean;
 * the read layer derives these three cases from it plus the run's stored scope
 * and the student's live toggle:
 *
 * - `marked` — an admin marked them scheduled, so no run will move them.
 * - `out-of-scope` — this run only re-solved other positions. They are not
 *   protected from the next unscoped run.
 * - `kept` — frozen for neither reason, which today means a repair run held
 *   them on the imported plan, or they were unmarked after the run.
 */
export type FrozenReason = "marked" | "out-of-scope" | "kept";

/** A validator finding with the student's name and freeze reason resolved. */
export interface LaborFindingView extends StudentLaborFinding {
  displayName: string;
  /** How the run held them in place, or null when it did not. */
  frozenReason: FrozenReason | null;
}

/** What `runLaborFindings` needs about a student beyond their rows. */
export interface LaborFindingLookup {
  /** Display name for an email; return the email itself when unknown. */
  nameOf: (email: string) => string;
  /**
   * Why the run held this student in place, or null when nothing is known
   * about them. Null on a student the run did freeze reads as plain `kept`.
   */
  frozenReasonOf: (email: string) => FrozenReason | null;
}

/**
 * The validator's bounds from a run's snapshotted params, put through the same
 * backfill-and-validate the stored settings get, so a run generated before the
 * labor params existed is judged against today's defaults and an incoherent
 * stored pair falls back to them wholesale. The 40h weekly cap is not here: it
 * is payroll law and a constant inside the validator.
 */
export function validatorLimits(params: Partial<SchedulingParams> | undefined): ValidatorLimits {
  const p = storedSchedulingParams(params);
  return {
    dayCapMinutes: p.dayCapHours * 60,
    maxConsecutiveDays: p.maxConsecutiveDays,
    maxDaysPerWeek: p.maxDaysPerWeek,
    preferredDaysPerWeek: p.preferredDaysPerWeek,
    minRestMinutes: p.minRestHours * 60,
    preferredRestMinutes: p.preferredRestHours * 60,
  };
}

/**
 * Re-check a stored run's rows against the labor rules. Frozen comes from the
 * report's per-student entries, which is the only record of who was held in
 * place; the rows themselves carry only who wrote them. An old or corrupt
 * report costs only the frozen marks, since those are display-only: the rows
 * still get judged. A validator failure is the one case with nothing to show,
 * and it is logged rather than swallowed, so a run never renders clean because
 * the check quietly died. This runs on every page load of the schedule.
 */
export function runLaborFindings(
  rows: readonly RunLaborRow[],
  report: Pick<EngineReport, "students" | "params">,
  lookup: LaborFindingLookup,
): LaborFindingView[] {
  let frozen = new Set<string>();
  try {
    frozen = new Set((report.students ?? []).filter((s) => s.frozen).map((s) => s.email));
  } catch {
    // A report too broken to list its students still leaves rows worth judging.
  }
  const validatorRows: ValidatorRow[] = rows.map((row) => ({
    studentEmail: row.studentEmail,
    blockId: row.blockId,
    day: row.day,
    cohort: row.cohort,
    start: row.start,
    end: row.end,
    source: row.source,
    frozen: frozen.has(row.studentEmail),
  }));
  try {
    return validateRunLabor(validatorRows, validatorLimits(report.params)).map((finding) => ({
      ...finding,
      displayName: lookup.nameOf(finding.email),
      // A frozen student the read layer knows nothing about is still kept.
      frozenReason: finding.frozen ? (lookup.frozenReasonOf(finding.email) ?? "kept") : null,
    }));
  } catch (e) {
    console.error("labor validation failed", e);
    return [];
  }
}

/** One violation as the run panel lists it. */
export interface LaborFindingLine {
  email: string;
  displayName: string;
  /** How the run held the student in place, or null when it did not. */
  frozenReason: FrozenReason | null;
  message: string;
  /** A hand-edited row contributes to this violation. */
  involvesManual: boolean;
}

export interface LaborFindingSection {
  severity: "hard" | "soft";
  lines: LaborFindingLine[];
  /** Distinct students behind `lines`. */
  students: number;
}

/**
 * Findings flattened to one line per violation, hard rules first, keeping the
 * validator's by-email order. Sections with nothing in them are dropped.
 */
export function laborFindingSections(findings: readonly LaborFindingView[]): LaborFindingSection[] {
  const severities: LaborFindingSection["severity"][] = ["hard", "soft"];
  return severities
    .map((severity) => {
      const lines: LaborFindingLine[] = [];
      for (const finding of findings) {
        for (const violation of finding.violations) {
          if (violation.severity !== severity) continue;
          lines.push({
            email: finding.email,
            displayName: finding.displayName,
            frozenReason: finding.frozenReason,
            message: violation.message,
            involvesManual: violation.involvesManual,
          });
        }
      }
      return { severity, lines, students: new Set(lines.map((l) => l.email)).size };
    })
    .filter((section) => section.lines.length > 0);
}

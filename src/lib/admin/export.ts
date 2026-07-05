/**
 * Pure builders for the responses export (PLAN.md §10): one comprehensive row
 * per submission, used for BOTH the in-app CSV download and the running Google
 * Sheet in Drive. Kept free of I/O so it's unit-testable; the server loader
 * (`export-data.ts`) feeds it `ExportAggregate`s.
 *
 * Proof columns are Drive web links (`drive.google.com/file/d/<id>/view`) rather
 * than the app's auth-proxy URL, so folder members can open them straight from
 * the spreadsheet without the app.
 */
import { computeCapacity, distinctSelectedDays } from "@/lib/domain/capacity";
import { formatTime } from "@/lib/domain/time";
import { ALL_DAYS, type Day, type Position, type SelectedShift, type ShiftBlock } from "@/lib/domain/types";
import { hourCap } from "./summary";

export interface ExportTravel {
  startDate: string;
  endDate: string;
  excused: boolean;
  note: string | null;
  proofFileId: string;
}

export interface ExportAggregate {
  email: string;
  displayName: string;
  international: boolean;
  onRoster: boolean;
  positionName: string | null;
  position: Position | null;
  blocks: ShiftBlock[];
  status: "draft" | "submitted";
  scheduled: boolean;
  desiredHours: number | null;
  everyWeekendOptIn: boolean;
  submittedAt: Date | null;
  updatedAt: Date;
  studentNotes: string;
  schedulerNotes: string;
  selection: SelectedShift[];
  autoAssigned: SelectedShift[];
  flags: { type: string; detail: string }[];
  courseScheduleFileId: string | null;
  extracurricularNotes: string;
  extracurricularFileIds: string[];
  travel: ExportTravel[];
}

export const EXPORT_HEADERS = [
  "Name",
  "Email",
  "Position",
  "International",
  "Status",
  "Scheduled",
  "Submitted",
  "Last edited",
  "Desired hours",
  "Every weekend",
  "Pref. capacity (h)",
  "Days covered",
  "Min hours",
  "Hour cap",
  "Selections",
  "Auto-assigned weekend",
  "Flags",
  "Student notes",
  "Scheduler notes",
  "Course schedule",
  "Extracurricular notes",
  "Extracurricular proofs",
  "Travel",
] as const;

const DAY_LABEL: Record<Day, string> = {
  mon: "Mon",
  tue: "Tue",
  wed: "Wed",
  thu: "Thu",
  fri: "Fri",
  sat: "Sat",
  sun: "Sun",
};
const DAY_INDEX = new Map<Day, number>(ALL_DAYS.map((d, i) => [d, i]));

const driveLink = (fileId: string) => `https://drive.google.com/file/d/${fileId}/view`;
const yesNo = (b: boolean) => (b ? "yes" : "no");
// Full UTC timestamp (date + h:m:s) for timestamp columns, e.g. "2026-08-12 10:00:00".
const fmtTimestamp = (d: Date | null) =>
  d ? new Date(d).toISOString().slice(0, 19).replace("T", " ") : "";
const round1 = (n: number) => (Math.round(n * 10) / 10).toString();

function describeCells(cells: readonly SelectedShift[], blocks: readonly ShiftBlock[]): string {
  const byId = new Map(blocks.map((b) => [b.id, b]));
  return [...cells]
    .sort((a, b) => {
      const da = DAY_INDEX.get(a.day) ?? 0;
      const db = DAY_INDEX.get(b.day) ?? 0;
      if (da !== db) return da - db;
      return (byId.get(a.blockId)?.start ?? 0) - (byId.get(b.blockId)?.start ?? 0);
    })
    .map((c) => {
      const block = byId.get(c.blockId);
      return block
        ? `${DAY_LABEL[c.day]} ${formatTime(block.start)}–${formatTime(block.end)}`
        : DAY_LABEL[c.day];
    })
    .join("; ");
}

/** Build the export matrix: header row + one row per aggregate. */
export function buildExportMatrix(rows: readonly ExportAggregate[]): string[][] {
  const matrix: string[][] = [[...EXPORT_HEADERS]];

  for (const r of rows) {
    const capacity =
      r.blocks.length > 0
        ? computeCapacity(r.selection, r.blocks, { everyWeekendOptIn: r.everyWeekendOptIn })
            .weeklyAverageHours
        : 0;
    const daysCovered = distinctSelectedDays(r.selection).size;

    matrix.push([
      r.displayName,
      r.email,
      r.positionName ?? "",
      yesNo(r.international),
      r.status,
      yesNo(r.scheduled),
      fmtTimestamp(r.submittedAt),
      fmtTimestamp(r.updatedAt),
      r.desiredHours != null ? String(r.desiredHours) : "",
      yesNo(r.everyWeekendOptIn),
      round1(capacity),
      String(daysCovered),
      r.position ? String(r.position.minHours) : "",
      r.position ? String(hourCap(r.international)) : "",
      describeCells(r.selection, r.blocks),
      describeCells(r.autoAssigned, r.blocks),
      r.flags.map((f) => f.detail || f.type).join(" | "),
      r.studentNotes,
      r.schedulerNotes,
      r.courseScheduleFileId ? driveLink(r.courseScheduleFileId) : "",
      r.extracurricularNotes,
      r.extracurricularFileIds.map(driveLink).join(" "),
      r.travel
        .map(
          (t) =>
            `${t.startDate}→${t.endDate} (${t.excused ? "excused" : "late"}) ${driveLink(t.proofFileId)}`,
        )
        .join(" | "),
    ]);
  }

  return matrix;
}

/** Serialize a matrix to RFC-4180 CSV (CRLF rows, quotes doubled). */
export function toCsv(matrix: readonly string[][]): string {
  return matrix.map((row) => row.map(csvCell).join(",")).join("\r\n");
}

function csvCell(value: string): string {
  // Neutralize spreadsheet formula/DDE injection (OWASP CSV injection): student-
  // controlled free text (notes, display name) can reach a cell start. A cell whose
  // first char is a formula/command trigger (= + - @) or a leading tab/CR can
  // execute or exfiltrate row data when the CSV is opened in Excel/LibreOffice.
  // Prefixing a single quote forces the app to treat the whole cell as text. Empty
  // cells are left untouched.
  let cell = value;
  if (cell !== "" && /^[=+\-@\t\r]/.test(cell)) {
    cell = `'${cell}`;
  }
  if (/[",\r\n]/.test(cell)) {
    return `"${cell.replace(/"/g, '""')}"`;
  }
  return cell;
}

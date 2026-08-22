/**
 * Parser for a W2W schedule export (docs/w2w-shift-plan-roundtrip.md §2).
 *
 * One dated week, one CSV row per budgeted seat. The parser is all-or-nothing
 * on anything it cannot place: a row whose date or time does not read refuses
 * the whole upload, because a silently dropped row would break the row-count
 * invariant the export side depends on (budget safety). Pure; the bytes-to-text
 * step lives with the upload handler.
 */
import { parseCsv } from "../csv";
import type { Day } from "../types";
import type { W2wParseIssue, W2wParseResult, W2wPlanRow } from "./types";

/** Columns a plan cannot be read without. Date/Day Of Week are checked as a pair. */
const REQUIRED_COLUMNS = [
  ["position id", "Position ID"],
  ["position name", "Position Name"],
  ["start time", "Start Time"],
  ["end time", "End Time"],
] as const;

/** getUTCDay() order: Sunday is 0. The numeric fallback assumes the same. */
const DAY_BY_INDEX: readonly Day[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

const DAY_BY_NAME: Readonly<Record<string, Day>> = {
  sunday: "sun",
  sun: "sun",
  monday: "mon",
  mon: "mon",
  tuesday: "tue",
  tue: "tue",
  wednesday: "wed",
  wed: "wed",
  thursday: "thu",
  thu: "thu",
  friday: "fri",
  fri: "fri",
  saturday: "sat",
  sat: "sat",
};

/** "8:00 AM" / "08:00 AM" to minutes since midnight; null when unreadable. */
function parseTime(text: string): number | null {
  const m = /^(\d{1,2}):(\d{2})\s*(am|pm)$/i.exec(text);
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour < 1 || hour > 12 || minute > 59) return null;
  return ((hour % 12) + (m[3]!.toLowerCase() === "pm" ? 12 : 0)) * 60 + minute;
}

/**
 * "m/d/yyyy" to its calendar day of week, or null when unreadable. Uses the
 * date parts through Date.UTC so the host timezone can never shift the day,
 * and rejects rollover dates like 2/30 instead of landing on a wrong day.
 */
function parseDateDay(text: string): Day | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  if (!m) return null;
  const month = Number(m[1]);
  const dayOfMonth = Number(m[2]);
  const year = Number(m[3]);
  const date = new Date(Date.UTC(year, month - 1, dayOfMonth));
  const rolledOver =
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== dayOfMonth;
  return rolledOver ? null : DAY_BY_INDEX[date.getUTCDay()]!;
}

/**
 * Parse a W2W schedule export into plan rows. Structural problems (missing
 * columns, no data, an unreadable date or time) refuse the whole upload;
 * per-row oddities that still place the row come back as issues.
 */
export function parseW2wPlan(csvText: string): W2wParseResult {
  const grid = parseCsv(csvText);
  const headerIndex = grid.findIndex((cells) => cells.some((c) => c.trim() !== ""));
  if (headerIndex === -1) {
    return { ok: false, reason: "The file is empty." };
  }

  const columns = new Map<string, number>();
  grid[headerIndex]!.forEach((name, i) => {
    const key = name.trim().toLowerCase();
    if (key !== "" && !columns.has(key)) columns.set(key, i);
  });

  const missing: string[] = REQUIRED_COLUMNS.filter(([key]) => !columns.has(key)).map(
    ([, label]) => label,
  );
  if (!columns.has("date") && !columns.has("day of week")) {
    missing.push("Date or Day Of Week");
  }
  if (missing.length > 0) {
    return {
      ok: false,
      reason: `This does not look like a W2W schedule export. Missing column(s): ${missing.join(", ")}.`,
    };
  }

  const rows: W2wPlanRow[] = [];
  const issues: W2wParseIssue[] = [];
  // A plan is one week: seeing the same weekday under two dates means the
  // export spans multiple weeks, which would silently multiply every seat.
  const datesByDay = new Map<Day, string>();

  for (let r = headerIndex + 1; r < grid.length; r++) {
    const cells = grid[r]!;
    if (cells.every((c) => c.trim() === "")) continue;
    // 1-based data row number, counted from the header so it matches the file.
    const rowNumber = r - headerIndex;
    const cell = (key: string): string => {
      const i = columns.get(key);
      return i === undefined ? "" : (cells[i] ?? "").trim();
    };

    let day: Day;
    const dateText = cell("date");
    if (dateText !== "") {
      // The numeric Day Of Week column is relative to the W2W account's
      // start-of-week setting, so when a date is present it always wins.
      const parsed = parseDateDay(dateText);
      if (parsed === null) {
        return { ok: false, reason: `Row ${rowNumber}: could not read the date "${dateText}".` };
      }
      day = parsed;
      const seenDate = datesByDay.get(day);
      if (seenDate === undefined) {
        datesByDay.set(day, dateText);
      } else if (seenDate !== dateText) {
        return {
          ok: false,
          reason: `The file covers more than one week (${seenDate} and ${dateText} fall on the same weekday). Export a single week from W2W.`,
        };
      }
    } else {
      const dowText = cell("day of week");
      if (dowText === "") {
        return { ok: false, reason: `Row ${rowNumber}: has no date and no day of week.` };
      }
      if (/^\d+$/.test(dowText)) {
        const index = Number(dowText);
        if (index > 6) {
          return {
            ok: false,
            reason: `Row ${rowNumber}: day of week "${dowText}" is not between 0 and 6.`,
          };
        }
        day = DAY_BY_INDEX[index]!;
        issues.push({
          row: rowNumber,
          message: `No date on this row; read day of week ${dowText} as ${day} assuming the week starts on Sunday.`,
        });
      } else {
        const named = DAY_BY_NAME[dowText.toLowerCase()];
        if (named === undefined) {
          return {
            ok: false,
            reason: `Row ${rowNumber}: could not read the day of week "${dowText}".`,
          };
        }
        day = named;
      }
    }

    const startTime = cell("start time");
    const endTime = cell("end time");
    const startMinutes = parseTime(startTime);
    if (startMinutes === null) {
      return {
        ok: false,
        reason: `Row ${rowNumber}: could not read the start time "${startTime}".`,
      };
    }
    const endMinutes = parseTime(endTime);
    if (endMinutes === null) {
      return { ok: false, reason: `Row ${rowNumber}: could not read the end time "${endTime}".` };
    }

    rows.push({
      seq: rows.length,
      w2wPositionId: cell("position id"),
      w2wPositionName: cell("position name"),
      category: cell("category"),
      description: cell("shift description"),
      day,
      startTime,
      endTime,
      duration: cell("duration"),
      startMinutes,
      endMinutes,
      employeeName: cell("employee name"),
      employeeNumber: cell("employee number"),
    });
  }

  if (rows.length === 0) {
    return { ok: false, reason: "The file has a header but no shift rows." };
  }

  return { ok: true, rows, issues };
}

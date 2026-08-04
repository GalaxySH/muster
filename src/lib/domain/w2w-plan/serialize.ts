/**
 * Serialize a filled plan back into W2W's upload dialect
 * (docs/w2w-shift-plan-roundtrip.md §3). Same column set as the schedule
 * export the plan came from, with the dated identity blanked: Date must be
 * empty (W2W prefers it over Day Of Week when both are present) and Day Of
 * Week becomes a full day name, which is independent of the account's
 * start-of-week setting. Passthrough values are emitted verbatim; rows keep
 * source order, so the file's row count is the imported plan's row count.
 */
import type { Day } from "../types";
import type { FilledRow } from "./fill";

const W2W_DAY_NAME: Record<Day, string> = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
};

export const W2W_UPLOAD_HEADER = [
  "Shift ID",
  "Schedule ID",
  "Employee Number",
  "Position ID",
  "Position Name",
  "Category",
  "Shift Description",
  "Date",
  "Start Time",
  "End Time",
  "Duration",
  "Day Of Week",
  "Employee Name",
] as const;

/** Quote only when the value would otherwise break the row. */
function csvField(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replaceAll('"', '""')}"`;
  return value;
}

export function serializeW2wUpload(rows: FilledRow[]): string {
  const lines = [W2W_UPLOAD_HEADER.map((h) => `"${h}"`).join(",")];
  for (const row of [...rows].sort((a, b) => a.seq - b.seq)) {
    lines.push(
      [
        "", // Shift ID identifies the source week's shifts; meaningless on upload
        "", // Schedule ID likewise
        csvField(row.filledEmployeeNumber),
        csvField(row.w2wPositionId),
        csvField(row.w2wPositionName),
        csvField(row.category),
        csvField(row.description),
        "", // Date stays empty so Day Of Week places the shift
        csvField(row.startTime),
        csvField(row.endTime),
        csvField(row.duration),
        W2W_DAY_NAME[row.day],
        csvField(row.filledEmployeeName),
      ].join(","),
    );
  }
  return lines.join("\r\n") + "\r\n";
}

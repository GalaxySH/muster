import { describe, it, expect } from "vitest";
import { parseW2wPlan } from "./parse";

/**
 * The full header of a real W2W schedule export. Fixture people are invented.
 * The fixture week is 12/20/2026 (a Sunday) through 12/26/2026.
 */
const HEADER =
  '"Shift ID","Schedule ID","Employee Number","Position ID","Position Name",' +
  '"Category","Shift Description","Date","Start Time","End Time","Duration",' +
  '"Day Of Week","Employee Name"';

interface RowSpec {
  shiftId?: string;
  scheduleId?: string;
  employeeNumber?: string;
  positionId?: string;
  positionName?: string;
  category?: string;
  description?: string;
  date?: string;
  start?: string;
  end?: string;
  duration?: string;
  dow?: string;
  employeeName?: string;
}

function dataRow(spec: RowSpec = {}): string {
  return [
    spec.shiftId ?? "555001",
    spec.scheduleId ?? "9001",
    spec.employeeNumber ?? "",
    spec.positionId ?? "762431352",
    spec.positionName ?? "GDEC - CA",
    spec.category ?? "",
    spec.description ?? "",
    spec.date ?? "12/21/2026",
    spec.start ?? "08:00 AM",
    spec.end ?? "11:00 AM",
    spec.duration ?? "3.00",
    spec.dow ?? "1",
    spec.employeeName ?? "",
  ]
    .map((cell) => `"${cell}"`)
    .join(",");
}

function csvOf(...rows: string[]): string {
  return [HEADER, ...rows].join("\n") + "\n";
}

describe("parseW2wPlan", () => {
  it("parses a well-formed export", () => {
    const result = parseW2wPlan(
      csvOf(
        dataRow({ employeeName: "Ada Quartz", description: "Opener" }),
        dataRow({ date: "12/22/2026", start: "04:00 PM", end: "08:30 PM", dow: "2" }),
      ),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.issues).toEqual([]);
    expect(result.rows).toHaveLength(2);
    const [first, second] = result.rows;
    expect(first).toMatchObject({
      seq: 0,
      w2wPositionId: "762431352",
      w2wPositionName: "GDEC - CA",
      description: "Opener",
      day: "mon",
      startTime: "08:00 AM",
      endTime: "11:00 AM",
      duration: "3.00",
      startMinutes: 8 * 60,
      endMinutes: 11 * 60,
      employeeName: "Ada Quartz",
      employeeNumber: "",
    });
    expect(second).toMatchObject({
      seq: 1,
      day: "tue",
      startMinutes: 16 * 60,
      endMinutes: 20 * 60 + 30,
    });
  });

  it("accepts reordered, case-varied headers and ignores unknown columns", () => {
    const csv =
      "POSITION NAME,Mystery Column,start time,End Time,position id,Date\n" +
      "GDEC - SL,whatever,07:00 PM,11:30 PM,762425946,12/25/2026\n";
    const result = parseW2wPlan(csv);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0]).toMatchObject({
      w2wPositionName: "GDEC - SL",
      day: "fri",
      startMinutes: 19 * 60,
      endMinutes: 23 * 60 + 30,
      employeeName: "",
      category: "",
    });
  });

  it("refuses when a required column is missing", () => {
    const csv =
      '"Position Name","Start Time","End Time","Date"\n"GDEC - CA","08:00 AM","11:00 AM","12/21/2026"\n';
    const result = parseW2wPlan(csv);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("Position ID");
  });

  it("refuses when both Date and Day Of Week are missing", () => {
    const csv =
      '"Position ID","Position Name","Start Time","End Time"\n"1","GDEC - CA","08:00 AM","11:00 AM"\n';
    const result = parseW2wPlan(csv);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("Date or Day Of Week");
  });

  it("refuses an empty file and a header-only file", () => {
    expect(parseW2wPlan("")).toMatchObject({ ok: false });
    expect(parseW2wPlan(HEADER + "\n")).toMatchObject({ ok: false });
  });

  it("keeps commas inside quoted fields", () => {
    const result = parseW2wPlan(csvOf(dataRow({ description: "Dinner, close crew" })));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0]!.description).toBe("Dinner, close crew");
  });

  it("reads CRLF line endings", () => {
    const csv = [HEADER, dataRow(), dataRow({ date: "12/22/2026" })].join("\r\n") + "\r\n";
    const result = parseW2wPlan(csv);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toHaveLength(2);
    expect(result.rows[1]!.day).toBe("tue");
  });

  it("derives the day from the date, timezone-independently", () => {
    // 12/20/2026 is a Sunday and 12/26/2026 a Saturday.
    const result = parseW2wPlan(
      csvOf(dataRow({ date: "12/20/2026", dow: "" }), dataRow({ date: "12/26/2026", dow: "" })),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows.map((r) => r.day)).toEqual(["sun", "sat"]);
  });

  it("keeps the date-derived day when the numeric day of week disagrees", () => {
    // An account whose week starts on Monday would emit 0 for a Monday date.
    const result = parseW2wPlan(csvOf(dataRow({ date: "12/21/2026", dow: "0" })));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0]!.day).toBe("mon");
    expect(result.issues).toEqual([]);
  });

  it("falls back to a numeric day of week and notes the assumption", () => {
    const result = parseW2wPlan(
      csvOf(dataRow({ date: "", dow: "0" }), dataRow({ date: "", dow: "6" })),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows.map((r) => r.day)).toEqual(["sun", "sat"]);
    expect(result.issues).toHaveLength(2);
    expect(result.issues[0]).toMatchObject({ row: 1 });
    expect(result.issues[0]!.message).toContain("Sunday");
    expect(result.issues[1]).toMatchObject({ row: 2 });
  });

  it("accepts day names, full or abbreviated, any case, with no issue", () => {
    const result = parseW2wPlan(
      csvOf(dataRow({ date: "", dow: "Monday" }), dataRow({ date: "", dow: "THU" })),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows.map((r) => r.day)).toEqual(["mon", "thu"]);
    expect(result.issues).toEqual([]);
  });

  it("refuses a numeric day of week outside 0 to 6", () => {
    const result = parseW2wPlan(csvOf(dataRow({ date: "", dow: "7" })));
    expect(result).toMatchObject({ ok: false });
  });

  it("refuses the whole upload when a time does not parse, naming the row", () => {
    const result = parseW2wPlan(csvOf(dataRow(), dataRow({ start: "25:00" })));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("Row 2");
    expect(result.reason).toContain("25:00");
  });

  it("refuses the whole upload when a date does not parse, naming the row", () => {
    const result = parseW2wPlan(csvOf(dataRow({ date: "2026-12-21" })));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("Row 1");
  });

  it("refuses a rollover date like 2/30 instead of shifting the day", () => {
    const result = parseW2wPlan(csvOf(dataRow({ date: "2/30/2026" })));
    expect(result).toMatchObject({ ok: false });
  });

  it("refuses a row with neither a date nor a day of week", () => {
    const result = parseW2wPlan(csvOf(dataRow({ date: "", dow: "" })));
    expect(result).toMatchObject({ ok: false });
  });

  it("reads single-digit hours and 12 o'clock edge times", () => {
    const result = parseW2wPlan(
      csvOf(
        dataRow({ start: "8:00 AM", end: "12:00 PM" }),
        dataRow({ start: "12:00 AM", end: "12:30 PM" }),
      ),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0]).toMatchObject({ startMinutes: 480, endMinutes: 720 });
    expect(result.rows[1]).toMatchObject({ startMinutes: 0, endMinutes: 750 });
  });

  it("defaults absent optional columns to empty strings", () => {
    const csv =
      '"Position ID","Position Name","Start Time","End Time","Date"\n' +
      '"762425946","GDEC - SL","07:00 PM","11:30 PM","12/25/2026"\n';
    const result = parseW2wPlan(csv);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0]).toMatchObject({
      category: "",
      description: "",
      duration: "",
      employeeName: "",
      employeeNumber: "",
    });
  });

  it("trims whitespace-only cells to empty strings and skips blank lines", () => {
    const csv = csvOf(
      dataRow({ employeeName: "   ", category: "  " }),
      "",
      dataRow({ date: "12/22/2026" }),
    );
    const result = parseW2wPlan(csv);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({ employeeName: "", category: "" });
    expect(result.rows[1]!.seq).toBe(1);
  });

  it("refuses a file spanning more than one week", () => {
    // Same weekday under two dates: 12/21 and 12/28 are both Mondays.
    const result = parseW2wPlan(
      csvOf(dataRow({ date: "12/21/2026" }), dataRow({ date: "12/28/2026" })),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("more than one week");
  });

  it("accepts duplicate rows on the same date (multiple seats)", () => {
    const result = parseW2wPlan(csvOf(dataRow(), dataRow()));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.rows).toHaveLength(2);
  });
});
